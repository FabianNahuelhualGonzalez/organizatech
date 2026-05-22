import type { Session, User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "./client";

export type DataMode = "demo" | "supabase";

export interface SupabaseSessionState {
  isConfigured: boolean;
  dataMode: DataMode;
  session: Session | null;
  user: User | null;
}

export async function getInitialSupabaseSession(): Promise<SupabaseSessionState> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      isConfigured: false,
      dataMode: "demo",
      session: null,
      user: null,
    };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;

  return {
    isConfigured: true,
    dataMode: session ? "supabase" : "demo",
    session,
    user: session?.user ?? null,
  };
}

export function getMissingSupabaseMessage() {
  if (isSupabaseConfigured()) return "";

  if (process.env.NODE_ENV === "production") {
    return "Supabase no está configurado. La app no puede guardar datos reales en producción.";
  }

  return "Modo demo/local activo. Configura Supabase para usar autenticación y persistencia real.";
}

export function getSessionDisplayName(user: User | null, fallback = "Usuario") {
  if (!user) return fallback;
  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  return user.email?.split("@")[0] || fallback;
}
