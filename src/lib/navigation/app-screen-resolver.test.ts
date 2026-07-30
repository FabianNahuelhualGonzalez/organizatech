import assert from "node:assert/strict";

import {
  isTrainingSummaryScreenValid,
  resolveActiveWorkoutVariant,
  resolveComparisonScreenVariant,
  resolveDashboardScreenVariant,
  resolveRoutineBuilderVariant,
} from "@/lib/navigation/app-screen-resolver";

/**
 * Pruebas de caracterización: demuestran paridad con las condiciones JSX del root, sin renderizar
 * React. Cubren cada variante válida,
 * los huecos ("none") donde producción hoy no renderiza nada, y los fallbacks.
 */

// Dashboard / Comparación: solo dos variantes cada una, siempre cubiertas.
assert.equal(resolveDashboardScreenVariant(true), "blocked");
assert.equal(resolveDashboardScreenVariant(false), "content");
assert.equal(resolveComparisonScreenVariant(true), "blocked");
assert.equal(resolveComparisonScreenVariant(false), "content");

// CASO — Routine Builder: cada pantalla válida.
assert.equal(
  resolveRoutineBuilderVariant({ isCycleScopedPlanBlocked: true, hasRoutinePlan: true, isEditingRoutinePlan: false }),
  "blocked",
);
assert.equal(
  resolveRoutineBuilderVariant({ isCycleScopedPlanBlocked: false, hasRoutinePlan: false, isEditingRoutinePlan: false }),
  "editor",
  "sin plan, muestra el editor aunque isEditingRoutinePlan sea false",
);
assert.equal(
  resolveRoutineBuilderVariant({ isCycleScopedPlanBlocked: false, hasRoutinePlan: true, isEditingRoutinePlan: true }),
  "editor",
  "con plan pero editando, tambien muestra el editor",
);
assert.equal(
  resolveRoutineBuilderVariant({ isCycleScopedPlanBlocked: false, hasRoutinePlan: true, isEditingRoutinePlan: false }),
  "management",
);

// CASO — estado inválido/hueco: bloqueado Y editando no coincide con ninguna condición real.
assert.equal(
  resolveRoutineBuilderVariant({ isCycleScopedPlanBlocked: true, hasRoutinePlan: true, isEditingRoutinePlan: true }),
  "none",
  "hueco real de produccion: ninguna de las tres condiciones JSX cubre este caso",
);
assert.equal(
  resolveRoutineBuilderVariant({ isCycleScopedPlanBlocked: true, hasRoutinePlan: false, isEditingRoutinePlan: true }),
  "none",
);

// CASO — Active Workout: cada pantalla válida (ciclo activo / rutina / readiness / guiado).
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: true,
    hasRoutinePlan: true,
    isEditingRoutinePlan: false,
    hasStartedTraining: false,
    hasReadiness: false,
  }),
  "blocked",
);
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: false,
    hasRoutinePlan: false,
    isEditingRoutinePlan: false,
    hasStartedTraining: false,
    hasReadiness: false,
  }),
  "empty",
);
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: false,
    hasRoutinePlan: false,
    isEditingRoutinePlan: true,
    hasStartedTraining: false,
    hasReadiness: false,
  }),
  "empty",
  "empty no depende de isEditingRoutinePlan, igual que el JSX original",
);
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: false,
    hasRoutinePlan: true,
    isEditingRoutinePlan: false,
    hasStartedTraining: false,
    hasReadiness: false,
  }),
  "start",
);
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: false,
    hasRoutinePlan: true,
    isEditingRoutinePlan: false,
    hasStartedTraining: true,
    hasReadiness: false,
  }),
  "readiness",
);
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: false,
    hasRoutinePlan: true,
    isEditingRoutinePlan: false,
    hasStartedTraining: true,
    hasReadiness: true,
  }),
  "guided",
);

// CASO — estado inválido/hueco: con plan y editando, ninguna de las 5 condiciones coincide.
assert.equal(
  resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked: false,
    hasRoutinePlan: true,
    isEditingRoutinePlan: true,
    hasStartedTraining: false,
    hasReadiness: false,
  }),
  "none",
  "hueco real de produccion (en la practica screen pasaria a registro-entrenamiento antes)",
);

// CASO — validez de training-summary (pantalla inválida / fallback de saneamiento).
assert.equal(isTrainingSummaryScreenValid(true), true);
assert.equal(isTrainingSummaryScreenValid(false), false);

console.log("app-screen-resolver tests passed");
