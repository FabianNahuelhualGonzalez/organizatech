import { createClient } from "@supabase/supabase-js";
import { CoachInvitationsError, type CoachInvitationsIdentity } from "./coach-invitations-contract";
import type { CoachInvitationsPrincipal } from "./coach-invitations-operation";
import { uuid } from "./coach-invitations-validation";

export interface CoachPublicRpcRuntimeInput {
  readonly configuration: {
    readonly url: string;
    /** Existing public publishable key or legacy anon key, never a private key. */
    readonly publicKey: string;
  };
  readonly principal: CoachInvitationsPrincipal;
  readonly expectedIdentity: CoachInvitationsIdentity;
  readonly isCurrent: (snapshot: CoachInvitationsIdentity) => boolean;
  readonly fetch?: typeof fetch;
  readonly timeoutMilliseconds?: number;
}

/** Configuration guard only; the server authenticates the API key and user. */
function isPublicKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).role === "anon";
  } catch { return false; }
}

/** Shared by narrow Coach repositories; no env, storage or Auth I/O. */
export function snapshotCoachPublicRpcRuntime(input: CoachPublicRpcRuntimeInput) {
  try {
    const url = new URL(input.configuration.url.trim().replace(/\/(?:rest|auth)\/v1\/?$/, ""));
    const publicKey = input.configuration.publicKey.trim();
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
      || !isPublicKey(publicKey)) throw new CoachInvitationsError("invalid_input");
    const identity = Object.freeze({ userId: uuid(input.expectedIdentity.userId, "invalid_input"),
      generation: input.expectedIdentity.generation });
    if (!Number.isSafeInteger(identity.generation) || identity.generation < 0) throw new CoachInvitationsError("invalid_input");
    return Object.freeze({ url: url.href, publicKey, identity });
  } catch { throw new CoachInvitationsError("invalid_input"); }
}

/** Only compose behind an audited RPC allowlist, after principal verification.
 * accessToken bypasses SDK Auth initialization, storage, listeners and refresh. */
export function createPinnedCoachRpcPort(configuration: { readonly url: string; readonly publicKey: string },
  accessToken: string, request?: typeof fetch) {
  const client = createClient(configuration.url, configuration.publicKey, {
    accessToken: async () => accessToken,
    global: request ? { fetch: request } : undefined,
  });
  return {
    rpc: (name: string, args: Readonly<Record<string, string | number | null>>, options: { readonly get: false; readonly head: false }) => ({
      abortSignal: (signal: AbortSignal) => client.rpc(name, args, options).abortSignal(signal).retry(false),
    }),
  };
}
