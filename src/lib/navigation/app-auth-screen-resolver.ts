import type { Screen } from "@/lib/navigation/app-navigation";

/**
 * Resolución pura del estado inicial de autenticación a partir del estado de recuperación de
 * contraseña YA CALCULADO. Reúne pantalla, mensaje y loading para que compartan un único snapshot
 * de `getPasswordRecoveryRouteState()`. Esto es obligatorio porque esa lectura puede purgar
 * storage inválido y por lo tanto no es repetible.
 *
 * Deliberadamente NO incluye `getPasswordRecoveryRouteState()` en sí: esa función lee
 * `window.location.search`/`window.location.hash`, `localStorage` (vía
 * `hasStoredPasswordRecoveryFlow`/`loadPasswordRecoveryFlow`) y tiene un efecto de escritura
 * (`startPasswordRecoveryFlow()`) — es impura por diseño y permanece en
 * `organizatech-app.tsx`. Este módulo solo modela la parte pura: estado de ruta → estado inicial
 * de la app.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase. Integrado en organizatech-app.tsx a través
 * de `resolveInitialAuthState`: el root captura una sola vez el estado impuro y reutiliza el
 * resultado puro en los tres `useState` iniciales. `getInitialAuthScreen()` quedó redundante y
 * fue eliminada del root.
 */

export type PasswordRecoveryRouteState = "none" | "active" | "expired";

export interface InitialAuthState {
  screen: Screen;
  statusMessage: string;
  isAuthLoading: boolean;
}

/** Igual a la extinta `getInitialAuthScreen()`, eliminada del root al integrar este resolver. */
export function resolveInitialAuthScreen(routeState: PasswordRecoveryRouteState): Screen {
  if (routeState === "expired") return "recovery-expired";
  if (routeState === "active") return "nueva-password";
  return "login";
}

/** Deriva el mensaje inicial desde el estado ya calculado de recuperación de contraseña. */
export function resolveInitialAuthStatusMessage(routeState: PasswordRecoveryRouteState): string {
  if (routeState === "expired") return "El enlace de recuperación expiró o ya fue utilizado.";
  if (routeState === "active") return "Crea una nueva contraseña para continuar.";
  return "Validando sesión...";
}

/** Mantiene el gate de carga hasta que Supabase confirme una recuperación activa. */
export function resolveInitialAuthLoading(routeState: PasswordRecoveryRouteState): boolean {
  return routeState !== "expired";
}

/** Combina las tres derivaciones anteriores en un único resultado, para una única lectura del estado de ruta. */
export function resolveInitialAuthState(routeState: PasswordRecoveryRouteState): InitialAuthState {
  return {
    screen: resolveInitialAuthScreen(routeState),
    statusMessage: resolveInitialAuthStatusMessage(routeState),
    isAuthLoading: resolveInitialAuthLoading(routeState),
  };
}
