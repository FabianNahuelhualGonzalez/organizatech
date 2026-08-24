import type { Screen } from "@/lib/navigation/app-navigation";
import type { PasswordRecoveryRouteState } from "@/lib/navigation/app-auth-screen-resolver";

/**
 * Modelo canónico de transición de pantalla (P3-07B). Describe QUÉ transición ocurre —
 * destino, política de historial e intención — sin ejecutar nada: la aplicación efectiva
 * (setters de React) vive exclusivamente en el adaptador del root (`applyScreenTransition`
 * en organizatech-app.tsx), y la navegación contextual del usuario (push/pop de historial)
 * sigue siendo dominio exclusivo de `resolveContextualNavigation`/
 * `resolveContextualBackNavigation` en app-navigation.ts — este módulo NO la duplica.
 *
 * Política de historial:
 * - `"reset"`: transiciones autoritativas de autenticación/recuperación. El historial se
 *   vacía para que ninguna pantalla de una identidad o contexto anterior sobreviva a un
 *   cambio de sesión (caracterizado: antes de P3-07B, la navegación en modo demo podía
 *   filtrarse al historial de la sesión autenticada vía el listener de auth).
 * - `"preserve"`: transiciones de flujo dentro de la sesión (rutina, ciclos, finalización,
 *   saneamiento). El historial queda intacto, exactamente como el comportamiento previo de
 *   los `setScreen` directos que este modelo reemplaza.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase.
 */

export type ScreenTransitionHistoryPolicy = "preserve" | "reset";

/** Intenciones de transición autoritativa de auth/recuperación (política "reset"). */
export type AuthResetReason =
  | "password-recovery-active"
  | "password-recovery-expired"
  | "session-established"
  | "signup-confirmation-pending"
  | "signup-confirmation-completed"
  | "password-updated"
  | "auth-screen-switch";

/** Intenciones de transición de flujo dentro de la sesión (política "preserve"). */
export type FlowTransitionReason =
  | "summary-state-sanitized"
  | "summary-dismissed"
  | "routine-editor-opened"
  | "routine-setup-continued"
  | "routine-plan-saved"
  | "routine-day-opened"
  | "routine-success-dismissed"
  | "cycle-lifecycle-reset"
  | "workout-completed";

export type ScreenTransitionReason = AuthResetReason | FlowTransitionReason;

export interface ScreenTransition {
  readonly screen: Screen;
  readonly historyPolicy: ScreenTransitionHistoryPolicy;
  readonly reason: ScreenTransitionReason;
}

/** Transición autoritativa de auth: siempre limpia el historial de navegación. */
export function createAuthNavigationReset(screen: Screen, reason: AuthResetReason): ScreenTransition {
  return { screen, historyPolicy: "reset", reason };
}

/** Transición de flujo: el historial se conserva tal cual (paridad con los setters directos previos). */
export function createFlowScreenTransition(screen: Screen, reason: FlowTransitionReason): ScreenTransition {
  return { screen, historyPolicy: "preserve", reason };
}

/**
 * Destino según el estado de ruta de recuperación de contraseña, espejo de
 * `resolveInitialAuthScreen` (app-auth-screen-resolver.ts) para los dos estados que fuerzan
 * pantalla: `"expired"` → `recovery-expired`, `"active"` → `nueva-password`. El estado
 * `"none"` no produce transición y queda excluido por tipo.
 */
export function resolvePasswordRecoveryRouteTransition(
  routeState: Exclude<PasswordRecoveryRouteState, "none">,
): ScreenTransition {
  if (routeState === "expired") {
    return createAuthNavigationReset("recovery-expired", "password-recovery-expired");
  }
  return createAuthNavigationReset("nueva-password", "password-recovery-active");
}

export interface WorkoutCompletionTransitionInput {
  /**
   * `true` cuando el guardado construyó y fijó un `trainingCompletionSummary` (los dos
   * flujos de guardado: cycle-scoped y legacy). `false` en el reintento de un link de
   * readiness pendiente, donde la sesión ya fue persistida en un intento anterior y no
   * existe snapshot que mostrar — ese flujo termina en el dashboard.
   */
  readonly hasCompletionSummary: boolean;
}

/**
 * Destino real tras completar un entrenamiento, modelando los TRES flujos de producción
 * (reemplaza al extinto `resolveWorkoutCompletionScreen`, que devolvía "training-summary"
 * incondicionalmente y no podía representar el reintento de link pendiente):
 * 1. Guardado cycle-scoped con summary → `training-summary`.
 * 2. Guardado legacy con summary → `training-summary`.
 * 3. Reintento de link de readiness pendiente, sin summary → `dashboard`.
 * Ir a `training-summary` sin summary sería rebotado por el efecto de saneamiento del root,
 * por eso el destino se decide aquí, antes de aplicar la transición.
 */
export function resolveWorkoutCompletionTransition(input: WorkoutCompletionTransitionInput): ScreenTransition {
  return createFlowScreenTransition(
    input.hasCompletionSummary ? "training-summary" : "dashboard",
    "workout-completed",
  );
}
