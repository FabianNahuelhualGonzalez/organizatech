import { createClient } from "@supabase/supabase-js";
import { CoachPreferencesError, type CoachPreferencesPinnedClient } from "./coach-preferences-contract";
import { captureCoachPreferencesOperation, type CoachPreferencesPrincipal } from "./coach-preferences-operation";
import { createCoachPreferencesRepository } from "./coach-preferences-repository";

interface PublicSupabaseConfiguration {
  readonly url: string;
  /** Only the publishable/legacy anon key already configured for the frontend. */
  readonly publicKey: string;
}

function normalizeConfiguration(configuration: PublicSupabaseConfiguration) {
  try {
    const url = new URL(configuration.url.trim().replace(/\/(?:rest|auth)\/v1\/?$/, ""));
    const publicKey = configuration.publicKey.trim();
    const localHttp = url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHttp && url.protocol !== "https:") || url.username || url.password || url.search || url.hash
      || !publicKey || /\s/.test(publicKey) || publicKey.startsWith("sb_secret_")) {
      throw new CoachPreferencesError("invalid_input");
    }
    return { url: url.href, publicKey };
  } catch {
    throw new CoachPreferencesError("invalid_input");
  }
}

/** Real SDK transport, still separate from screen wiring and session ownership. */
export function createSupabaseCoachPreferencesRepository(input: {
  readonly configuration: PublicSupabaseConfiguration;
  readonly principal: CoachPreferencesPrincipal;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly fetch?: typeof fetch;
  readonly timeoutMilliseconds?: number;
}) {
  // Snapshot configuration/dependencies once; never re-read mutable environment or form objects.
  const { url, publicKey } = normalizeConfiguration(input.configuration);
  const { principal, expectedUserId, isCurrent, fetch: request } = input;

  function createPinnedClient(accessToken: string): CoachPreferencesPinnedClient {
    const client = createClient(url, publicKey, {
      // This SDK option bypasses its Auth client completely: no storage, Auth listeners or refresh.
      accessToken: async () => accessToken,
      global: request ? { fetch: request } : undefined,
    });
    return {
      // POST only; retries are explicitly disabled, including for read RPCs.
      rpc: (name, args, signal) => client.rpc(name, args).abortSignal(signal).retry(false),
    };
  }

  return createCoachPreferencesRepository({
    timeoutMilliseconds: input.timeoutMilliseconds,
    captureOperation: (signal) => captureCoachPreferencesOperation({
      principal, expectedUserId, isCurrent, createPinnedClient, signal,
    }),
  });
}
