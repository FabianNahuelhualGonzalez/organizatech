import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "./client";
import { SupabasePrincipalIdentityCoordinationUnavailableError } from "./auth-identity-operation";
import {
  runIdempotentAuthReadWithSingleRetry,
  type IdempotentAuthReadOptions,
} from "./auth-resilience";

export type DataMode = "demo" | "supabase";

export interface SupabaseSessionState {
  isConfigured: boolean;
  dataMode: DataMode;
  session: Session | null;
  user: User | null;
}

interface InitialSupabaseSessionDependencies {
  getBrowserClient?: () => SupabaseClient | null;
  configured?: () => boolean;
}

export async function getInitialSupabaseSession(
  dependencies: InitialSupabaseSessionDependencies = {},
): Promise<SupabaseSessionState> {
  const configured = dependencies.configured ?? isSupabaseConfigured;
  const supabase = (dependencies.getBrowserClient ?? getSupabaseBrowserClient)();

  if (!supabase) {
    // Un proyecto configurado sin coordinación cross-tab no es modo demo: se bloquea el acceso
    // antes de que Auth lea/refresque storage y antes de conceder cualquier sesión local.
    if (configured()) {
      throw new SupabasePrincipalIdentityCoordinationUnavailableError();
    }
    return {
      isConfigured: false,
      dataMode: "demo",
      session: null,
      user: null,
    };
  }

  const session = await readInitialSupabaseSession(
    () => supabase.auth.getSession(),
  );

  return {
    isConfigured: true,
    dataMode: session ? "supabase" : "demo",
    session,
    user: session?.user ?? null,
  };
}

type SessionLookupResult = Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>;

export async function readInitialSupabaseSession(
  getSession: () => Promise<SessionLookupResult>,
  options: IdempotentAuthReadOptions = {},
): Promise<Session | null> {
  return runIdempotentAuthReadWithSingleRetry(
    async () => {
      const { data, error } = await getSession();
      if (error) throw error;
      return data.session;
    },
    options,
  );
}

export function getMissingSupabaseMessage() {
  if (isSupabaseConfigured()) return "";

  if (process.env.NODE_ENV === "production") {
    return "No pudimos iniciar la app correctamente. Intenta nuevamente más tarde.";
  }

  return "Modo de prueba activo.";
}

export function getSessionDisplayName(user: User | null, fallback = "Usuario") {
  if (!user) return fallback;
  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  return user.email?.split("@")[0] || fallback;
}
