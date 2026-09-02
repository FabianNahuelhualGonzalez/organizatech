import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import {
  createResilientSupabaseAuthFetch,
  type SupabaseAuthRefreshIdentityScope,
} from "./auth-resilience";
import { hasSafeSupabasePrincipalIdentityCoordination } from "./auth-identity-operation";

let browserClient: SupabaseClient | null = null;
let nextSupabaseAuthSessionEpoch = 0;
let activeSupabaseAuthIdentity: {
  scope: SupabaseAuthRefreshIdentityScope;
  refreshToken: string;
} | null = null;
const authoritativeRefreshRejections = new Map<string, {
  scope: SupabaseAuthRefreshIdentityScope;
  expiresAt: number;
}>();

const AUTHORITATIVE_REFRESH_REJECTION_WINDOW_MILLISECONDS = 10_000;
const MAX_AUTHORITATIVE_REFRESH_REJECTIONS = 16;
const MAX_STORED_SUPABASE_SESSION_LENGTH = 128 * 1024;
const MAX_STORED_REFRESH_TOKEN_LENGTH = 4_096;

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return Boolean(url && anonKey);
}

export function getSupabaseBrowserClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  if (!browserClient) {
    browserClient = initializeSupabaseBrowserAuthIfCoordinated(() => {
      seedSupabaseAuthIdentityFromStorage(url);
      return createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
        global: {
          fetch: createResilientSupabaseAuthFetch({
            authOrigin: url,
            captureRefreshIdentityScope() {
              return activeSupabaseAuthIdentity?.scope ?? null;
            },
            onTerminalRefreshRejection(_status, identityScope) {
              if (!identityScope) return;
              recordAuthoritativeRefreshRejection(identityScope);
            },
          }),
        },
      });
    });
  }

  return browserClient;
}

/**
 * Mantiene el guard exactamente delante de toda inicialización Auth. Se exporta para probar que
 * un browser sin Web Locks no ejecuta ni el factory, ni lecturas de storage, ni auto-refresh.
 */
export function initializeSupabaseBrowserAuthIfCoordinated<T>(
  initialize: () => T,
): T | null {
  if (!hasSafeSupabasePrincipalIdentityCoordination()) return null;
  return initialize();
}

export function getActiveSupabaseAuthIdentityScope(): SupabaseAuthRefreshIdentityScope | null {
  return activeSupabaseAuthIdentity?.scope ?? null;
}

export type SupabaseIdentityLocalSignOutResult = {
  error: unknown | null;
  identityChanged: boolean;
};

interface SupabaseAuthAtomicSignOutInternals {
  initializePromise: Promise<unknown> | null;
  lockAcquireTimeout: number | undefined;
  _acquireLock<T>(timeout: number | undefined, operation: () => Promise<T>): Promise<T>;
  _useSession<T>(operation: (result: {
    data: { session: Session | null };
    error: unknown | null;
  }) => Promise<T>): Promise<T>;
  _signOut(options: { scope: "local" }): Promise<{ error: unknown | null }>;
}

class SupabaseAtomicIdentitySignOutUnavailableError extends Error {
  constructor() {
    super("No se pudo cerrar de forma segura la sesión esperada.");
    this.name = "SupabaseAtomicIdentitySignOutUnavailableError";
  }
}

/**
 * Valida y cierra la sesión dentro del mismo lock de storage que usa auth-js para refresh y
 * signOut. Así, un refresh A1→A2 no puede entrar entre la última comparación y la eliminación.
 * Los miembros internos quedan aislados aquí y cualquier cambio incompatible de auth-js falla
 * cerrado, sin ejecutar el signOut público no condicional.
 */
export async function signOutSupabaseAuthIdentityLocallyIfCurrent(
  auth: SupabaseClient["auth"],
  expectedScope: SupabaseAuthRefreshIdentityScope,
): Promise<SupabaseIdentityLocalSignOutResult> {
  const expectedIdentity = activeSupabaseAuthIdentity;
  if (!expectedIdentity || !isSameAuthIdentityScope(expectedIdentity.scope, expectedScope)) {
    return { error: null, identityChanged: true };
  }

  const internals = auth as unknown as Partial<SupabaseAuthAtomicSignOutInternals>;
  const lockAcquireTimeout = internals.lockAcquireTimeout;
  const hasCompatibleLockAcquireTimeout = lockAcquireTimeout === undefined
    || (typeof lockAcquireTimeout === "number" && Number.isFinite(lockAcquireTimeout));
  if (
    !internals.initializePromise
    || !hasCompatibleLockAcquireTimeout
    || typeof internals._acquireLock !== "function"
    || typeof internals._useSession !== "function"
    || typeof internals._signOut !== "function"
  ) {
    return { error: new SupabaseAtomicIdentitySignOutUnavailableError(), identityChanged: false };
  }

  try {
    await internals.initializePromise;
    return await internals._acquireLock(lockAcquireTimeout, async () => {
      const lockedExpectedIdentity = activeSupabaseAuthIdentity;
      if (
        !lockedExpectedIdentity
        || !isSameAuthIdentityScope(lockedExpectedIdentity.scope, expectedScope)
        || lockedExpectedIdentity.refreshToken !== expectedIdentity.refreshToken
      ) {
        return { error: null, identityChanged: true };
      }

      return internals._useSession!(async (sessionResult) => {
        const session = sessionResult.data.session;
        if (sessionResult.error) {
          return { error: sessionResult.error, identityChanged: false };
        }
        if (
          !session
          || session.user.id.toLowerCase() !== expectedScope.userId.toLowerCase()
          || session.refresh_token !== lockedExpectedIdentity.refreshToken
        ) {
          return { error: null, identityChanged: true };
        }

        const signOutResult = await internals._signOut!({ scope: "local" });
        return { error: signOutResult.error, identityChanged: false };
      });
    });
  } catch (error) {
    return { error, identityChanged: false };
  }
}

export function recordSupabaseAuthIdentity(
  session: Pick<Session, "refresh_token" | "user"> | null,
): SupabaseAuthRefreshIdentityScope | null {
  if (!session?.refresh_token || !session.user.id) {
    activeSupabaseAuthIdentity = null;
    return null;
  }
  if (
    activeSupabaseAuthIdentity?.scope.userId === session.user.id
    && activeSupabaseAuthIdentity.refreshToken === session.refresh_token
  ) {
    return activeSupabaseAuthIdentity.scope;
  }

  nextSupabaseAuthSessionEpoch += 1;
  const scope = Object.freeze({
    userId: session.user.id,
    sessionEpoch: nextSupabaseAuthSessionEpoch,
  });
  activeSupabaseAuthIdentity = { scope, refreshToken: session.refresh_token };
  return scope;
}

export function consumeAuthoritativeRefreshRejection(
  expectedScope: SupabaseAuthRefreshIdentityScope | null,
): boolean {
  const now = Date.now();
  pruneAuthoritativeRefreshRejections(now);
  if (!expectedScope) return false;
  const key = authIdentityScopeKey(expectedScope);
  const rejection = authoritativeRefreshRejections.get(key);
  if (!rejection) return false;
  authoritativeRefreshRejections.delete(key);
  return rejection.expiresAt >= now;
}

export function recordAuthoritativeRefreshRejection(
  scope: SupabaseAuthRefreshIdentityScope,
  expiresAt = Date.now() + AUTHORITATIVE_REFRESH_REJECTION_WINDOW_MILLISECONDS,
): void {
  const now = Date.now();
  pruneAuthoritativeRefreshRejections(now);
  const key = authIdentityScopeKey(scope);
  if (!authoritativeRefreshRejections.has(key)) {
    while (authoritativeRefreshRejections.size >= MAX_AUTHORITATIVE_REFRESH_REJECTIONS) {
      const oldestKey = authoritativeRefreshRejections.keys().next().value;
      if (typeof oldestKey !== "string") break;
      authoritativeRefreshRejections.delete(oldestKey);
    }
  }
  authoritativeRefreshRejections.set(key, { scope, expiresAt });
}

export function seedSupabaseAuthIdentityFromStorage(
  supabaseUrl: string,
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
): SupabaseAuthRefreshIdentityScope | null {
  if (activeSupabaseAuthIdentity) return activeSupabaseAuthIdentity.scope;
  const storedIdentity = readStoredSupabaseAuthIdentity(supabaseUrl, storage);
  if (!storedIdentity) return null;
  return recordSupabaseAuthIdentity({
    refresh_token: storedIdentity.refreshToken,
    user: { id: storedIdentity.userId } as Session["user"],
  });
}

export function readStoredSupabaseAuthIdentity(
  supabaseUrl: string,
  storage: Pick<Storage, "getItem"> | null,
): { userId: string; refreshToken: string } | null {
  if (!storage) return null;
  const storageKey = getSupabaseAuthStorageKey(supabaseUrl);
  if (!storageKey) return null;
  try {
    const serialized = storage.getItem(storageKey);
    if (
      !serialized
      || serialized.length > MAX_STORED_SUPABASE_SESSION_LENGTH
    ) {
      return null;
    }
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || !isRecord(value.user)) return null;
    const userId = readStoredUserId(value.user.id);
    const refreshToken = readStoredRefreshToken(value.refresh_token);
    return userId && refreshToken ? { userId, refreshToken } : null;
  } catch {
    return null;
  }
}

function normalizeSupabaseUrl(url: string | undefined) {
  if (!url) return url;
  return url.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
}

function authIdentityScopeKey(scope: SupabaseAuthRefreshIdentityScope): string {
  return `${scope.sessionEpoch}:${scope.userId}`;
}

function isSameAuthIdentityScope(
  left: SupabaseAuthRefreshIdentityScope,
  right: SupabaseAuthRefreshIdentityScope,
): boolean {
  return left.sessionEpoch === right.sessionEpoch
    && left.userId.toLowerCase() === right.userId.toLowerCase();
}

function pruneAuthoritativeRefreshRejections(now: number): void {
  for (const [key, rejection] of authoritativeRefreshRejections) {
    if (rejection.expiresAt < now) authoritativeRefreshRejections.delete(key);
  }
}

function readBrowserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSupabaseAuthStorageKey(supabaseUrl: string): string | null {
  try {
    const projectNamespace = new URL(supabaseUrl).hostname.split(".")[0]?.toLowerCase() ?? "";
    if (!/^[a-z0-9-]{1,63}$/.test(projectNamespace)) return null;
    return `sb-${projectNamespace}-auth-token`;
  } catch {
    return null;
  }
}

function readStoredUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const userId = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(userId)
    ? userId
    : null;
}

function readStoredRefreshToken(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  if (value.length < 8 || value.length > MAX_STORED_REFRESH_TOKEN_LENGTH) return null;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
