import {
  getBrowserStorageScope,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";

export interface SignedOutSessionPolicyInput {
  readonly isExplicitLogoutInFlight: boolean;
  readonly hasAuthoritativeRefreshRejection: boolean;
}

export interface SignedOutSessionPolicy {
  readonly purgeDurableStorage: boolean;
  readonly message: string;
  readonly statusTone: "success" | "error";
}

/**
 * Un SIGNED_OUT sin intención local ni rechazo autoritativo bloquea el acceso en memoria, pero no
 * destruye borradores de usuario. Supabase sigue siendo dueño de su storage Auth: este helper no
 * restaura ni conserva tokens que la librería haya eliminado.
 */
export function resolveSignedOutSessionPolicy(
  input: SignedOutSessionPolicyInput,
): SignedOutSessionPolicy {
  if (input.isExplicitLogoutInFlight) {
    return {
      purgeDurableStorage: true,
      message: "Sesión cerrada correctamente.",
      statusTone: "success",
    };
  }
  if (input.hasAuthoritativeRefreshRejection) {
    return {
      purgeDurableStorage: true,
      message: "Tu sesión expiró. Inicia sesión nuevamente.",
      statusTone: "error",
    };
  }
  return {
    purgeDurableStorage: false,
    message: "La sesión dejó de estar disponible. Tus datos locales se conservaron.",
    statusTone: "error",
  };
}

export function resolveSignedOutStorageScope(input: {
  readonly previousStorageScope: BrowserStorageScope | null;
  readonly hasAuthoritativeRefreshRejection: boolean;
  readonly signedOutUserId: string | null;
}): BrowserStorageScope | null {
  if (input.previousStorageScope) return input.previousStorageScope;
  if (!input.hasAuthoritativeRefreshRejection) return null;
  return getBrowserStorageScope("supabase", input.signedOutUserId);
}
