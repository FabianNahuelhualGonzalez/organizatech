import { createClient, type Session, type User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  CoachLinkAcceptResult,
  CoachLinkActiveResult,
  CoachLinkLookupResult,
} from "../model/coach-linking";

type RpcName =
  | "lookup_own_coach_invitation"
  | "read_own_active_coach_link"
  | "accept_own_coach_invitation";

type RepositoryErrorCode = "session_expired" | "unavailable" | "invalid_response";

export class CoachLinkingRepositoryError extends Error {
  constructor(readonly code: RepositoryErrorCode) {
    super(code);
    this.name = "CoachLinkingRepositoryError";
  }
}

export interface CoachLinkingDataClient {
  rpc(name: RpcName, args?: Readonly<Record<string, unknown>>): {
    abortSignal(signal: AbortSignal): Promise<{ readonly data: unknown; readonly error: unknown }>;
  };
  readonly functions: {
    invoke(name: "send-coach-link-emails", options: { readonly body: Readonly<Record<string, never>> }):
      Promise<{ readonly data: unknown; readonly error: unknown }>;
  };
}

interface PrincipalClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
}

const LOOKUP_STATUSES = new Set([
  "valido", "ya_aceptado", "invalido", "ya_usado", "no_corresponde", "vencido",
  "cancelado", "ya_tiene_coach", "error_red",
]);
const ACCEPT_STATUSES = new Set([
  "linked", "already_linked", "invalido", "ya_usado", "no_corresponde", "vencido",
  "cancelado", "ya_tiene_coach", "error_red",
]);

function principalClient(): PrincipalClient | null {
  return getSupabaseBrowserClient() as unknown as PrincipalClient | null;
}

function pinnedClient(accessToken: string): CoachLinkingDataClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publicKey) throw new CoachLinkingRepositoryError("unavailable");
  return createClient(url, publicKey, {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as CoachLinkingDataClient;
}

async function captureOperation(expectedUserId: string) {
  const principal = principalClient();
  if (!principal) throw new CoachLinkingRepositoryError("unavailable");
  const sessionResult = await principal.auth.getSession();
  const session = sessionResult.data.session;
  if (sessionResult.error || !session?.access_token || session.user.id !== expectedUserId) {
    throw new CoachLinkingRepositoryError("session_expired");
  }
  const token = session.access_token;
  const verify = async () => {
    const result = await principal.auth.getUser(token);
    if (result.error || result.data.user?.id !== expectedUserId) {
      throw new CoachLinkingRepositoryError("session_expired");
    }
  };
  await verify();
  return { client: pinnedClient(token), verify };
}

function exactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoachLinkingRepositoryError("invalid_response");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CoachLinkingRepositoryError("invalid_response");
  }
  return value as Record<string, unknown>;
}

function coachName(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || Array.from(value).length < 1
    || Array.from(value).length > 201 || /\u0000|[\uD800-\uDFFF]/u.test(value)) {
    throw new CoachLinkingRepositoryError("invalid_response");
  }
  return value;
}

function parseLookup(value: unknown): CoachLinkLookupResult {
  const row = exactRecord(value);
  if (typeof row.status !== "string" || !LOOKUP_STATUSES.has(row.status)) {
    throw new CoachLinkingRepositoryError("invalid_response");
  }
  if (row.status === "valido" || row.status === "ya_aceptado") {
    if (Reflect.ownKeys(row).length !== 2) throw new CoachLinkingRepositoryError("invalid_response");
    return { status: row.status, coachName: coachName(row.coachName) };
  }
  if (Reflect.ownKeys(row).length !== 1) throw new CoachLinkingRepositoryError("invalid_response");
  return { status: row.status as Exclude<CoachLinkLookupResult["status"], "valido" | "ya_aceptado"> };
}

function parseAccept(value: unknown): CoachLinkAcceptResult {
  const row = exactRecord(value);
  if (typeof row.status !== "string" || !ACCEPT_STATUSES.has(row.status)) {
    throw new CoachLinkingRepositoryError("invalid_response");
  }
  if (row.status === "linked" || row.status === "already_linked") {
    if (Reflect.ownKeys(row).length !== 2) throw new CoachLinkingRepositoryError("invalid_response");
    return { status: row.status, coachName: coachName(row.coachName) };
  }
  if (Reflect.ownKeys(row).length !== 1) throw new CoachLinkingRepositoryError("invalid_response");
  return { status: row.status as Exclude<CoachLinkAcceptResult["status"], "linked" | "already_linked"> };
}

function parseActive(value: unknown): CoachLinkActiveResult {
  const row = exactRecord(value);
  if (row.status === "none" && Reflect.ownKeys(row).length === 1) return { status: "none" };
  if (row.status === "linked" && Reflect.ownKeys(row).length === 2) {
    return { status: "linked", coachName: coachName(row.coachName) };
  }
  throw new CoachLinkingRepositoryError("invalid_response");
}

async function rpc(expectedUserId: string, name: RpcName, args: Readonly<Record<string, unknown>>, signal: AbortSignal) {
  const operation = await captureOperation(expectedUserId);
  const result = await operation.client.rpc(name, args).abortSignal(signal);
  if (result.error) throw new CoachLinkingRepositoryError("unavailable");
  await operation.verify();
  return result.data;
}

export const coachLinkingRepository = {
  async readActive(expectedUserId: string, signal: AbortSignal) {
    return parseActive(await rpc(expectedUserId, "read_own_active_coach_link", {}, signal));
  },
  async lookup(expectedUserId: string, code: string, signal: AbortSignal) {
    return parseLookup(await rpc(expectedUserId, "lookup_own_coach_invitation", { p_code: code }, signal));
  },
  async accept(expectedUserId: string, code: string, requestId: string, signal: AbortSignal) {
    return parseAccept(await rpc(expectedUserId, "accept_own_coach_invitation", {
      p_code: code,
      p_request_id: requestId,
    }, signal));
  },
  async dispatchPendingEmails(expectedUserId: string) {
    const operation = await captureOperation(expectedUserId);
    const result = await operation.client.functions.invoke("send-coach-link-emails", { body: {} });
    if (result.error) throw new CoachLinkingRepositoryError("unavailable");
    await operation.verify();
  },
};

export type CoachLinkingRepository = typeof coachLinkingRepository;
