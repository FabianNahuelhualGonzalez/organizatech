import { createClient, type Session, type User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface UserRegistrationRow {
  readonly user_id?: unknown;
}

interface CoachUserProfileActivationPrincipalClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
}

export interface CoachUserProfileActivationDataClient {
  from(table: "user_registrations"): {
    select(columns: "user_id"): {
      eq(column: "user_id", value: string): {
        maybeSingle(): Promise<{
          readonly data: UserRegistrationRow | null;
          readonly error: unknown;
        }>;
      };
    };
  };
  rpc(name: "register_own_user"): Promise<{
    readonly data: UserRegistrationRow | null;
    readonly error: unknown;
  }>;
}

export interface CoachUserProfileActivationClient
  extends CoachUserProfileActivationPrincipalClient, CoachUserProfileActivationDataClient {}

export class CoachUserProfileActivationError extends Error {
  constructor(readonly code: "forbidden" | "unavailable") {
    super(code);
    this.name = "CoachUserProfileActivationError";
  }
}

async function capture(client: CoachUserProfileActivationPrincipalClient, expectedUserId: string) {
  const sessionResult = await client.auth.getSession();
  const session = sessionResult.data.session;
  if (sessionResult.error || !session?.access_token || session.user.id !== expectedUserId) {
    throw new CoachUserProfileActivationError("forbidden");
  }

  const accessToken = session.access_token;
  const verify = async () => {
    const userResult = await client.auth.getUser(accessToken);
    if (userResult.error || userResult.data.user?.id !== expectedUserId) {
      throw new CoachUserProfileActivationError("forbidden");
    }
  };

  await verify();
  return { accessToken, verify };
}

function requireOwnRow(row: UserRegistrationRow | null, expectedUserId: string) {
  if (!row || row.user_id !== expectedUserId) {
    throw new CoachUserProfileActivationError("unavailable");
  }
}

export function createCoachUserProfileActivationRepository(
  principal: CoachUserProfileActivationPrincipalClient,
  scopedClient: (accessToken: string) => CoachUserProfileActivationDataClient,
) {
  return {
    async hasOwnUserProfile(expectedUserId: string) {
      const operation = await capture(principal, expectedUserId);
      const result = await scopedClient(operation.accessToken).from("user_registrations")
        .select("user_id")
        .eq("user_id", expectedUserId)
        .maybeSingle();
      if (result.error) throw new CoachUserProfileActivationError("unavailable");
      if (result.data) requireOwnRow(result.data, expectedUserId);
      await operation.verify();
      return result.data !== null;
    },

    async activateOwnUserProfile(expectedUserId: string) {
      const operation = await capture(principal, expectedUserId);
      const result = await scopedClient(operation.accessToken).rpc("register_own_user");
      if (result.error) throw new CoachUserProfileActivationError("unavailable");
      requireOwnRow(result.data, expectedUserId);
      await operation.verify();
    },
  };
}

function pinnedClient(accessToken: string): CoachUserProfileActivationDataClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publicKey) throw new CoachUserProfileActivationError("unavailable");
  return createClient(url, publicKey, {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as CoachUserProfileActivationDataClient;
}

function browserRepository() {
  const principal = getSupabaseBrowserClient() as unknown as CoachUserProfileActivationPrincipalClient | null;
  if (!principal) throw new CoachUserProfileActivationError("unavailable");
  return createCoachUserProfileActivationRepository(principal, pinnedClient);
}

export async function hasOwnCoachUserProfile(expectedUserId: string) {
  return browserRepository().hasOwnUserProfile(expectedUserId);
}

export async function activateOwnCoachUserProfile(expectedUserId: string) {
  return browserRepository().activateOwnUserProfile(expectedUserId);
}
