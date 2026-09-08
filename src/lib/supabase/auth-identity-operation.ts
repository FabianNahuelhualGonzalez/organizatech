const SUPABASE_PRINCIPAL_IDENTITY_LOCK = "organizatech:supabase-principal-identity";

let localIdentityOperationTail: Promise<void> = Promise.resolve();

export class SupabasePrincipalIdentityCoordinationUnavailableError extends Error {
  constructor() {
    super("No hay coordinación segura disponible para modificar la sesión.");
    this.name = "SupabasePrincipalIdentityCoordinationUnavailableError";
  }
}

/**
 * El cliente Auth persistente sólo puede inicializarse en browser cuando Web Locks coordina todas
 * las pestañas del origen. Sin esa garantía, incluso el auto-refresh de Supabase podría sustituir
 * una identidad fuera de nuestros wrappers. Node no comparte storage entre realms y conserva la
 * cola local para tests deterministas.
 */
export function hasSafeSupabasePrincipalIdentityCoordination(): boolean {
  if (typeof window === "undefined") return true;
  return Boolean(readBrowserLockManager()?.request);
}

/**
 * Serializa cualquier operación que pueda sustituir o eliminar la identidad del cliente
 * Supabase principal. Web Locks cubre pestañas del mismo origen; la cola local mantiene la misma
 * garantía en runtimes sin esa API. Una operación debe volver a validar su identidad esperada
 * dentro de este lock antes de mutarla.
 */
export async function runSupabasePrincipalIdentityOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const lockManager = readBrowserLockManager();
  if (lockManager?.request) {
    const result = await lockManager.request(
      SUPABASE_PRINCIPAL_IDENTITY_LOCK,
      { mode: "exclusive" },
      () => operation(),
    );
    return result;
  }

  // Una cola Promise sólo coordina este realm. En un browser sin Web Locks, otra pestaña podría
  // iniciar B mientras esta pestaña intenta cerrar A. Se bloquea toda mutación de la identidad
  // principal antes de ejecutar efectos; Node conserva la cola local para tests deterministas.
  if (!hasSafeSupabasePrincipalIdentityCoordination()) {
    throw new SupabasePrincipalIdentityCoordinationUnavailableError();
  }

  const previous = localIdentityOperationTail;
  let release!: () => void;
  localIdentityOperationTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  return (async () => {
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  })();
}

function readBrowserLockManager(): LockManager | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  try {
    return navigator.locks ?? null;
  } catch {
    return null;
  }
}
