import assert from "node:assert/strict";

import {
  createAuthNavigationReset,
  createFlowScreenTransition,
  resolvePasswordRecoveryRouteTransition,
  resolveWorkoutCompletionTransition,
  type AuthResetReason,
  type FlowTransitionReason,
} from "@/lib/navigation/app-navigation-transition";

/**
 * Pruebas de caracterización del modelo canónico de transición (P3-07B). Cubren la política
 * de historial por familia de transición y, en particular, los TRES escenarios reales de
 * finalización de entrenamiento que el resolver debe modelar.
 */

// CASO — transiciones autoritativas de auth: siempre política "reset".
const authReasons: AuthResetReason[] = [
  "password-recovery-active",
  "password-recovery-expired",
  "session-established",
  "signup-confirmation-pending",
  "password-updated",
  "auth-screen-switch",
];
for (const reason of authReasons) {
  const transition = createAuthNavigationReset("dashboard", reason);
  assert.equal(transition.historyPolicy, "reset", `${reason} debe limpiar el historial`);
  assert.equal(transition.screen, "dashboard");
  assert.equal(transition.reason, reason);
}

// CASO — transiciones de flujo: siempre política "preserve" (paridad con los setters directos previos).
const flowReasons: FlowTransitionReason[] = [
  "summary-state-sanitized",
  "summary-dismissed",
  "routine-editor-opened",
  "routine-setup-continued",
  "routine-plan-saved",
  "routine-day-opened",
  "routine-success-dismissed",
  "cycle-lifecycle-reset",
  "workout-completed",
];
for (const reason of flowReasons) {
  const transition = createFlowScreenTransition("registro-entrenamiento", reason);
  assert.equal(transition.historyPolicy, "preserve", `${reason} debe conservar el historial`);
  assert.equal(transition.screen, "registro-entrenamiento");
  assert.equal(transition.reason, reason);
}

// CASO — ruta de recuperación de contraseña: espejo de resolveInitialAuthScreen para los dos
// estados que fuerzan pantalla, ambos con reset de historial.
assert.deepEqual(resolvePasswordRecoveryRouteTransition("expired"), {
  screen: "recovery-expired",
  historyPolicy: "reset",
  reason: "password-recovery-expired",
});
assert.deepEqual(resolvePasswordRecoveryRouteTransition("active"), {
  screen: "nueva-password",
  historyPolicy: "reset",
  reason: "password-recovery-active",
});

// CASO — finalización de entrenamiento, escenario 1: guardado cycle-scoped con summary fijado
// (organizatech-app.tsx, rama cycle-scoped de saveCompletedTraining) → training-summary.
assert.deepEqual(resolveWorkoutCompletionTransition({ hasCompletionSummary: true }), {
  screen: "training-summary",
  historyPolicy: "preserve",
  reason: "workout-completed",
});

// CASO — finalización, escenario 2: guardado legacy con summary fijado (rama legacy de
// saveCompletedTraining) → training-summary. Misma entrada que el escenario 1 por diseño:
// ambos flujos fijan el snapshot antes de finalizar, y el resolver decide solo por su presencia.
assert.equal(resolveWorkoutCompletionTransition({ hasCompletionSummary: true }).screen, "training-summary");

// CASO — finalización, escenario 3: reintento de link de readiness pendiente, la sesión ya fue
// persistida en un intento anterior y NO hay summary → dashboard (nunca training-summary, que
// sería rebotado por el efecto de saneamiento del root al no existir snapshot).
assert.deepEqual(resolveWorkoutCompletionTransition({ hasCompletionSummary: false }), {
  screen: "dashboard",
  historyPolicy: "preserve",
  reason: "workout-completed",
});

// CASO — determinismo: misma entrada produce siempre el mismo resultado.
assert.deepEqual(
  resolveWorkoutCompletionTransition({ hasCompletionSummary: true }),
  resolveWorkoutCompletionTransition({ hasCompletionSummary: true }),
);
assert.deepEqual(resolvePasswordRecoveryRouteTransition("active"), resolvePasswordRecoveryRouteTransition("active"));

console.log("app-navigation-transition tests passed");
