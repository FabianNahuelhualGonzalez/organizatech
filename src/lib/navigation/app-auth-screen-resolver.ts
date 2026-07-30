import type { Screen } from "@/lib/navigation/app-navigation";

/**
 * Resolución pura del estado inicial de autenticación a partir del estado de recuperación de
 * contraseña YA CALCULADO. Reproducía exactamente las tres derivaciones que antes eran
 * independientes en `organizatech-app.tsx` — la extinta `getInitialAuthScreen()`, el
 * inicializador lazy de `statusMessage` y el de `isAuthLoading` —, que llamaban a
 * `getPasswordRecoveryRouteState()` por separado para derivar tres valores relacionados del mismo
 * estado.
 *
 * Deliberadamente NO incluye `getPasswordRecoveryRouteState()` en sí: esa función lee
 * `window.location.search`/`window.location.hash`, `localStorage` (vía
 * `hasStoredPasswordRecoveryFlow`/`loadPasswordRecoveryFlow`) y tiene un efecto de escritura
 * (`startPasswordRecoveryFlow()`) — es impura por diseño y permanece en
 * `organizatech-app.tsx`. Este módulo solo modela la parte pura: estado de ruta → estado inicial
 * de la app.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase. Integrado en organizatech-app.tsx a través
 * de `resolveInitialAuthState`: los tres `useState` iniciales de
 * screen/statusMessage/isAuthLoading llaman `resolveInitialAuthState(getPasswordRecoveryRouteState())`
 * cada uno por separado (se preserva el conteo de llamadas de hoy a la función impura;
 * `getInitialAuthScreen()` quedó redundante y fue eliminada del root).
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

/** Mantiene auth loading únicamente cuando no hay un flujo de recuperación activo o expirado. */
export function resolveInitialAuthLoading(routeState: PasswordRecoveryRouteState): boolean {
  return routeState === "none";
}

/** Combina las tres derivaciones anteriores en un único resultado, para una única lectura del estado de ruta. */
export function resolveInitialAuthState(routeState: PasswordRecoveryRouteState): InitialAuthState {
  return {
    screen: resolveInitialAuthScreen(routeState),
    statusMessage: resolveInitialAuthStatusMessage(routeState),
    isAuthLoading: resolveInitialAuthLoading(routeState),
  };
}
