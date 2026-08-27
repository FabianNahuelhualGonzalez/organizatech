import type { AuthAccountType, AuthMode } from "./auth-route";

export const GOOGLE_OAUTH_FLOW = "google-oauth" as const;
export const GOOGLE_OAUTH_INTENT_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_OAUTH_INTENT_PREFIX = "organizatech:google-oauth:intent:";

export interface GoogleOAuthIntent {
  readonly id: string;
  readonly mode: AuthMode;
  readonly portal: AuthAccountType;
  readonly createdAt: number;
}

export interface OAuthIntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createGoogleOAuthIntent(input: {
  mode: AuthMode;
  portal: AuthAccountType;
  now?: number;
  randomBytes?: (length: number) => Uint8Array;
}): GoogleOAuthIntent {
  const bytes = input.randomBytes?.(16) ?? crypto.getRandomValues(new Uint8Array(16));
  if (bytes.length < 16) throw new Error("OAuth intent entropy is insufficient.");
  return {
    id: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
    mode: input.mode,
    portal: input.portal,
    createdAt: input.now ?? Date.now(),
  };
}

export function persistGoogleOAuthIntent(storage: OAuthIntentStorage, intent: GoogleOAuthIntent) {
  storage.setItem(`${GOOGLE_OAUTH_INTENT_PREFIX}${intent.id}`, JSON.stringify(intent));
}

export function consumeGoogleOAuthIntent(
  storage: OAuthIntentStorage,
  intentId: string,
  now = Date.now(),
): GoogleOAuthIntent | null {
  if (!/^[a-f0-9]{32,}$/.test(intentId)) return null;
  const key = `${GOOGLE_OAUTH_INTENT_PREFIX}${intentId}`;
  const serialized = storage.getItem(key);
  storage.removeItem(key);
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<GoogleOAuthIntent>;
    if (
      value.id !== intentId
      || (value.mode !== "login" && value.mode !== "registro")
      || (value.portal !== "usuario" && value.portal !== "coach")
      || typeof value.createdAt !== "number"
      || !Number.isSafeInteger(value.createdAt)
      || value.createdAt > now
      || now - value.createdAt > GOOGLE_OAUTH_INTENT_TTL_MS
    ) return null;
    return value as GoogleOAuthIntent;
  } catch {
    return null;
  }
}

export function buildGoogleOAuthCallbackUrl(origin: string, intentId: string): string {
  if (!/^[a-f0-9]{32,}$/.test(intentId)) throw new Error("OAuth intent is invalid.");
  const source = new URL(origin);
  if (!/^https?:$/.test(source.protocol) || source.username || source.password) {
    throw new Error("OAuth origin is invalid.");
  }
  const callback = new URL("/login", source.origin);
  callback.searchParams.set("flow", GOOGLE_OAUTH_FLOW);
  callback.searchParams.set("intent", intentId);
  return callback.toString();
}

export function parseGoogleOAuthCallback(input: { pathname: string; search: string }) {
  const params = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search);
  if (input.pathname !== "/login" || params.get("flow") !== GOOGLE_OAUTH_FLOW) return null;
  const code = params.get("code");
  const intentId = params.get("intent");
  if (!code || !intentId || !/^[a-f0-9]{32,}$/.test(intentId)) return { invalid: true } as const;
  return { invalid: false, code, intentId } as const;
}
