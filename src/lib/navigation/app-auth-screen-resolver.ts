import type { Screen } from "@/lib/navigation/app-navigation";

/**
 * Resolución pura del estado inicial de autenticación a partir del estado de recuperación de
 * contraseña YA CALCULADO. Reproduce exactamente las tres derivaciones hoy independientes en
 * `organizatech-app.tsx` — `getInitialAuthScreen()` (líneas 5380-5385), el inicializador lazy de
 * `statusMessage` (líneas 371-376) y el de `isAuthLoading` (línea 389) — que hoy llaman
 * `getPasswordRecoveryRouteState()` tres veces por separado para derivar tres valores
 * relacionados del mismo estado.
 *
 * Deliberadamente NO incluye `getPasswordRecoveryRouteState()` en sí: esa función lee
 * `window.location.search`/`window.location.hash`, `localStorage` (vía
 * `hasStoredPasswordRecoveryFlow`/`loadPasswordRecoveryFlow`) y tiene un efecto de escritura
 * (`startPasswordRecoveryFlow()`) — es impura por diseño y permanece en
 * `organizatech-app.tsx`. Este módulo solo modela la parte pura: estado de ruta → estado inicial
 * de la app.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase. No integrado todavía (P3-06 preparación).
 */

export type PasswordRecoveryRouteState = "none" | "active" | "expired";

export interface InitialAuthState {
  screen: Screen;
  statusMessage: string;
  isAuthLoading: boolean;
}

/** Igual a `getInitialAuthScreen()` (organizatech-app.tsx:5380-5385). */
export function resolveInitialAuthScreen(routeState: PasswordRecoveryRouteState): Screen {
  if (routeState === "expired") return "recovery-expired";
  if (routeState === "active") return "nueva-password";
  return "login";
}

/** Igual al inicializador lazy de `statusMessage` (organizatech-app.tsx:371-376). */
export function resolveInitialAuthStatusMessage(routeState: PasswordRecoveryRouteState): string {
  if (routeState === "expired") return "El enlace de recuperación expiró o ya fue utilizado.";
  if (routeState === "active") return "Crea una nueva contraseña para continuar.";
  return "Validando sesión...";
}

/** Igual al inicializador lazy de `isAuthLoading` (organizatech-app.tsx:389): `=== "none"`. */
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
