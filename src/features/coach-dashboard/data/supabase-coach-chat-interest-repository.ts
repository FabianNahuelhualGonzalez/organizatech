import { createClient } from "@supabase/supabase-js";
import {
  CoachChatInterestError,
  type CoachChatInterestOperation,
  type CoachChatInterestPinnedClient,
} from "./coach-chat-interest-contract";
import { createCoachChatInterestRepository } from "./coach-chat-interest-repository";

interface AuthUser { readonly id: string }

interface Principal {
  readonly auth: {
    getSession(): PromiseLike<{
      readonly data: { readonly session: { readonly user: AuthUser; readonly access_token: string } | null };
      readonly error: unknown;
    }>;
    getUser(accessToken: string): PromiseLike<{
      readonly data: { readonly user: AuthUser | null };
      readonly error: unknown;
    }>;
  };
}

export interface CoachChatInterestRuntimeInput {
  readonly configuration: { readonly url: string; readonly publicKey: string };
  readonly principal: Principal;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly fetch?: typeof fetch;
  readonly timeoutMilliseconds?: number;
}

function normalizeConfiguration(configuration: CoachChatInterestRuntimeInput["configuration"]) {
  try {
    const url = new URL(configuration.url.trim().replace(/\/(?:rest|auth)\/v1\/?$/, ""));
    const publicKey = configuration.publicKey.trim();
    const localHttp = url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
      || !publicKey || /\s/.test(publicKey) || publicKey.startsWith("sb_secret_")) {
      throw new CoachChatInterestError("invalid_input");
    }
    return { url: url.href, publicKey };
  } catch {
    throw new CoachChatInterestError("invalid_input");
  }
}

/** Captures a verified user and token for each RPC without consulting mutable SDK Auth state. */
export function createSupabaseCoachChatInterestRepository(input: CoachChatInterestRuntimeInput) {
  const { url, publicKey } = normalizeConfiguration(input.configuration);
  const { principal, expectedUserId, isCurrent, fetch: request } = input;

  const captureOperation = async (signal: AbortSignal): Promise<CoachChatInterestOperation> => {
    const assertCurrent = () => {
      if (signal.aborted) throw new CoachChatInterestError("timeout");
      if (!isCurrent()) throw new CoachChatInterestError("operation_stale");
    };
    assertCurrent();
    const sessionResult = await principal.auth.getSession();
    assertCurrent();
    const session = sessionResult.data.session;
    if (sessionResult.error || !session || session.user.id !== expectedUserId || !session.access_token) {
      throw new CoachChatInterestError("forbidden");
    }
    const token = session.access_token;
    const userResult = await principal.auth.getUser(token);
    assertCurrent();
    if (userResult.error || userResult.data.user?.id !== expectedUserId) {
      throw new CoachChatInterestError("forbidden");
    }
    const client = createClient(url, publicKey, {
      accessToken: async () => token,
      global: request ? { fetch: request } : undefined,
    });
    const pinned: CoachChatInterestPinnedClient = {
      rpc: (name, args, rpcSignal) => client.rpc(name, args).abortSignal(rpcSignal).retry(false),
    };
    return { client: pinned, isCurrent };
  };

  return createCoachChatInterestRepository({ captureOperation, timeoutMilliseconds: input.timeoutMilliseconds });
}
