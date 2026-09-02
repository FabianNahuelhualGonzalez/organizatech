import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requestWelcomeEmailBestEffort } from "@/features/auth/data/request-welcome-email";
import type {
  CoachRegistrationWritePayload,
  GoogleUserRegistrationWritePayload,
} from "@/features/auth/model/auth-form";
import { runSupabasePrincipalIdentityOperation } from "@/lib/supabase/auth-identity-operation";
import { getBrowserSessionStorage } from "@/lib/storage/browser-storage";

import {
  buildGoogleOAuthCallbackUrl,
  consumeGoogleOAuthIntent,
  createGoogleOAuthIntent,
  persistGoogleOAuthIntent,
  type GoogleOAuthIntent,
  type OAuthIntentStorage,
} from "../model/google-oauth-intent";
import type { AuthAccountType, AuthMode } from "../model/auth-route";

const PKCE_STORAGE_PREFIX = "organizatech:google-oauth:pkce:";

export interface GoogleOAuthOperationGuard {
  isCurrent(): boolean;
}

export interface GoogleOAuthPendingOperation {
  readonly intent: GoogleOAuthIntent;
  readonly userId: string;
  assertPrincipalAvailable(principal: SupabaseClient, guard: GoogleOAuthOperationGuard): Promise<void>;
  registerUser(
    payload: GoogleUserRegistrationWritePayload,
    guard: GoogleOAuthOperationGuard,
  ): Promise<void>;
  registerCoach(
    payload: CoachRegistrationWritePayload,
    guard: GoogleOAuthOperationGuard,
  ): Promise<void>;
  transferToPrincipal(
    principal: SupabaseClient,
    guard: GoogleOAuthOperationGuard,
  ): Promise<void>;
}

export class GoogleOAuthStaleOperationError extends Error {
  constructor() {
    super("Google OAuth operation is stale.");
    this.name = "GoogleOAuthStaleOperationError";
  }
}

export function isGoogleOAuthStaleOperationError(error: unknown) {
  return error instanceof GoogleOAuthStaleOperationError;
}

function requireConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return { url, key };
}

function scopedStorage(intentId: string, storage: OAuthIntentStorage) {
  const storageKey = `${PKCE_STORAGE_PREFIX}${intentId}`;
  const verifierKey = `${storageKey}-code-verifier`;
  const memory = new Map<string, string>();
  return {
    getItem(key: string) {
      return key === verifierKey ? storage.getItem(key) : memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (key === verifierKey) {
        storage.setItem(key, value);
        return;
      }
      memory.set(key, value);
    },
    removeItem(key: string) {
      if (key === verifierKey) {
        storage.removeItem(key);
        return;
      }
      memory.delete(key);
    },
  };
}

export function createTransientGoogleOAuthClient(
  intentId: string,
  storage: OAuthIntentStorage,
): SupabaseClient {
  const { url, key } = requireConfiguration();
  const storageKey = `${PKCE_STORAGE_PREFIX}${intentId}`;
  return createClient(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey,
      storage: scopedStorage(intentId, storage),
    },
  });
}

export async function startGoogleOAuth(input: {
  readonly mode: AuthMode;
  readonly portal: AuthAccountType;
}) {
  const origin = window.location.origin;
  const storage = getBrowserSessionStorage();
  if (!storage) throw new Error("OAuth storage is unavailable.");
  const intent = createGoogleOAuthIntent(input);
  persistGoogleOAuthIntent(storage, intent);
  const client = createTransientGoogleOAuthClient(intent.id, storage);
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: buildGoogleOAuthCallbackUrl(origin, intent.id),
      scopes: "openid email profile",
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}

export async function completeGoogleOAuth(input: {
  readonly code: string;
  readonly intentId: string;
  readonly storage: OAuthIntentStorage;
  readonly guard: GoogleOAuthOperationGuard;
  readonly transientClient?: SupabaseClient;
}): Promise<GoogleOAuthPendingOperation> {
  assertCurrent(input.guard);
  const intent = consumeGoogleOAuthIntent(input.storage, input.intentId);
  if (!intent) throw new Error("OAuth intent is invalid or expired.");
  const transient = input.transientClient
    ?? createTransientGoogleOAuthClient(intent.id, input.storage);
  assertCurrent(input.guard);
  const { data, error } = await transient.auth.exchangeCodeForSession(input.code);
  assertCurrent(input.guard);
  const sessionUserId = data.session?.user.id;
  const userId = data.user?.id;
  if (error || !sessionUserId || !userId || sessionUserId !== userId) {
    throw error ?? new Error("OAuth session is invalid.");
  }
  assertGoogleIdentityEvidence(data.user, userId);
  await assertTransientIdentity(transient, userId, input.guard);
  assertCurrent(input.guard);

  return createPendingOperation({ intent, transient, userId });
}

function createPendingOperation(input: {
  intent: GoogleOAuthIntent;
  transient: SupabaseClient;
  userId: string;
}): GoogleOAuthPendingOperation {
  const { intent, transient, userId } = input;

  async function register(
    functionName: "register_own_google_user" | "register_own_google_coach",
    payload: Record<string, string>,
    guard: GoogleOAuthOperationGuard,
  ) {
    await assertTransientIdentity(transient, userId, guard);
    assertCurrent(guard);
    const { data, error } = await transient.rpc(functionName, payload);
    assertCurrent(guard);
    if (error) throw error;
    const rowUserId = readRegistrationUserId(data);
    if (rowUserId !== userId) throw new Error("Google registration identity mismatch.");
    await assertTransientIdentity(transient, userId, guard);
    assertCurrent(guard);
    await requestWelcomeEmailBestEffort(transient);
    assertCurrent(guard);
  }

  return Object.freeze({
    intent,
    userId,

    async assertPrincipalAvailable(principal: SupabaseClient, guard: GoogleOAuthOperationGuard) {
      await assertTransientIdentity(transient, userId, guard);
      const principalUserId = await readPrincipalUserId(principal, guard);
      if (principalUserId && principalUserId !== userId) {
        throw new GoogleOAuthStaleOperationError();
      }
    },

    registerUser(payload: GoogleUserRegistrationWritePayload, guard: GoogleOAuthOperationGuard) {
      return register("register_own_google_user", {
        p_first_name: payload.first_name,
        p_last_name: payload.last_name,
        p_birth_date: payload.birth_date,
        p_gender: payload.gender,
        p_phone_number: payload.phone_number,
      }, guard);
    },

    registerCoach(payload: CoachRegistrationWritePayload, guard: GoogleOAuthOperationGuard) {
      return register("register_own_google_coach", {
        p_first_name: payload.first_name,
        p_last_name: payload.last_name,
        p_birth_date: payload.birth_date,
        p_gender: payload.gender,
        p_phone_number: payload.phone_number,
        p_professional_title: payload.professional_title,
        p_contact_email: payload.contact_email,
      }, guard);
    },

    async transferToPrincipal(principal: SupabaseClient, guard: GoogleOAuthOperationGuard) {
      await assertTransientIdentity(transient, userId, guard);
      const sessionResult = await transient.auth.getSession();
      assertCurrent(guard);
      const session = sessionResult.data.session;
      if (sessionResult.error || !session || session.user.id !== userId) {
        throw sessionResult.error ?? new Error("OAuth session is unavailable.");
      }

      await runSupabasePrincipalIdentityOperation(async () => {
        const principalUserId = await readPrincipalUserId(principal, guard);
        assertCurrent(guard);
        if (principalUserId && principalUserId !== userId) {
          throw new GoogleOAuthStaleOperationError();
        }
        if (principalUserId === userId) return;

        const activation = principal.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
        const activated = await activation;
        assertCurrent(guard);
        if (
          activated.error
          || activated.data.user?.id !== userId
          || activated.data.session?.user.id !== userId
        ) {
          throw activated.error ?? new Error("OAuth session transfer failed.");
        }
        assertGoogleIdentityEvidence(activated.data.user, userId);
        const activatedUserId = await readPrincipalUserId(principal, guard);
        if (activatedUserId !== userId) throw new GoogleOAuthStaleOperationError();
      });
    },
  });
}

async function assertTransientIdentity(
  client: SupabaseClient,
  expectedUserId: string,
  guard: GoogleOAuthOperationGuard,
) {
  assertCurrent(guard);
  const userResult = await client.auth.getUser();
  assertCurrent(guard);
  if (userResult.error || userResult.data.user?.id !== expectedUserId) {
    throw userResult.error ?? new Error("OAuth identity changed.");
  }
  assertGoogleIdentityEvidence(userResult.data.user, expectedUserId);

  const sessionResult = await client.auth.getSession();
  assertCurrent(guard);
  if (sessionResult.error || sessionResult.data.session?.user.id !== expectedUserId) {
    throw sessionResult.error ?? new Error("OAuth session changed.");
  }
}

async function readPrincipalUserId(
  principal: SupabaseClient,
  guard: GoogleOAuthOperationGuard,
): Promise<string | null> {
  assertCurrent(guard);
  const userResult = await principal.auth.getUser();
  assertCurrent(guard);
  if (userResult.error && !isMissingSessionError(userResult.error)) throw userResult.error;
  const userId = userResult.data.user?.id ?? null;

  const sessionResult = await principal.auth.getSession();
  assertCurrent(guard);
  if (sessionResult.error) throw sessionResult.error;
  const sessionUserId = sessionResult.data.session?.user.id ?? null;
  if (userId !== sessionUserId) {
    if (!userId && !sessionUserId) return null;
    throw new GoogleOAuthStaleOperationError();
  }
  return userId;
}

function assertGoogleIdentityEvidence(user: User, expectedUserId: string) {
  const hasGoogleIdentity = user.identities?.some(
    (identity) => identity.provider === "google" && identity.user_id === expectedUserId,
  );
  if (!hasGoogleIdentity) throw new Error("Google identity evidence is missing.");
}

function readRegistrationUserId(value: unknown): string | null {
  const row = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!row || typeof row !== "object" || !("user_id" in row)) return null;
  return typeof row.user_id === "string" ? row.user_id : null;
}

function assertCurrent(guard: GoogleOAuthOperationGuard) {
  if (!guard.isCurrent()) throw new GoogleOAuthStaleOperationError();
}

function isMissingSessionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "").toLowerCase() : "";
  return code === "session_not_found" || message.includes("auth session missing");
}
