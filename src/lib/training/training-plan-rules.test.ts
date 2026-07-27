import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TRAINING_CYCLE_PRESENTATIONS } from "@/features/training-plan/model/training-cycle-presentation";
import { TRAINING_CYCLE_IDS } from "@/lib/training/training-cycle-id";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import {
  TRAINING_PLAN_DURATIONS_BY_CYCLE,
  TRAINING_PLAN_OBJECTIVES_BY_CYCLE,
  createDefaultTrainingPlan,
  getTrainingPlanDurationOptions,
  getTrainingPlanObjectiveOptions,
  validateTrainingPlan,
  validateTrainingPlanSetup,
} from "@/lib/training/training-plan-rules";

function issueCodes(result: { issues: ReadonlyArray<{ code: string }> }) {
  return result.issues.map((issue) => issue.code);
}

function createValidPlan(patch: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    ...createDefaultTrainingPlan(),
    ...patch,
    trainingDays: patch.trainingDays ? [...patch.trainingDays] : ["Lunes"],
  };
}

const defaultPlan = createDefaultTrainingPlan();
assert.deepEqual(defaultPlan, {
  cycleType: "meso",
  macroObjective: "Hipertrofia",
  macroDurationMonths: 6,
  mesoObjective: "Hipertrofia",
  mesoDurationWeeks: 4,
  microDurationWeeks: 1,
  sessionDurationDays: 1,
  trainingDays: ["Lunes"],
  microFocus: "Progresión",
  sessionFocus: "Técnica",
});

const secondDefaultPlan = createDefaultTrainingPlan();
defaultPlan.trainingDays.push("Martes");
assert.deepEqual(secondDefaultPlan.trainingDays, ["Lunes"], "cada default recibe su propio array de días");

assert.deepEqual(TRAINING_PLAN_OBJECTIVES_BY_CYCLE, {
  macro: ["Fuerza", "Hipertrofia", "Recomposición", "Definición", "Rendimiento", "Salud"],
  meso: ["Fuerza", "Hipertrofia", "Potencia", "Resistencia", "Descarga", "Definición"],
  micro: ["Progresión", "Mantenimiento", "Descarga", "Técnica"],
  session: ["Técnica", "Volumen", "Intensidad", "Control/RIR"],
});
assert.deepEqual(TRAINING_PLAN_DURATIONS_BY_CYCLE, {
  macro: [6, 7, 8, 9, 10, 11],
  meso: [3, 4, 5, 6],
  micro: [1],
  session: [1],
});
assert.deepEqual(
  TRAINING_CYCLE_PRESENTATIONS.map(({ id }) => id),
  TRAINING_CYCLE_IDS,
  "las reglas cubren exactamente los ciclos del catálogo visual canónico",
);

for (const cycleType of TRAINING_CYCLE_IDS) {
  const plan = createValidPlan({ cycleType });
  assert.equal(validateTrainingPlan(plan).valid, true, `${cycleType} acepta sus defaults productivos actuales`);
  assert.deepEqual(getTrainingPlanObjectiveOptions(cycleType), TRAINING_PLAN_OBJECTIVES_BY_CYCLE[cycleType]);
  assert.deepEqual(getTrainingPlanDurationOptions(cycleType), TRAINING_PLAN_DURATIONS_BY_CYCLE[cycleType]);
}

assert.deepEqual(validateTrainingPlan(null), {
  valid: false,
  issues: [{ code: "invalid_plan", field: "plan" }],
});
assert.deepEqual(issueCodes(validateTrainingPlan({
  ...createValidPlan(),
  cycleType: "annual",
})), ["invalid_cycle_type"]);
assert.deepEqual(issueCodes(validateTrainingPlan(createValidPlan({
  mesoObjective: "Objetivo libre",
}))), ["invalid_objective"]);
assert.equal(
  validateTrainingPlan(createValidPlan({ macroObjective: "Objetivo legacy inactivo" })).valid,
  true,
  "solo el objetivo del cycleType activo participa en la validez estructural",
);
assert.deepEqual(issueCodes(validateTrainingPlan(createValidPlan({
  mesoDurationWeeks: 2,
}))), ["invalid_duration"]);
assert.deepEqual(issueCodes(validateTrainingPlan({
  ...createValidPlan(),
  mesoDurationWeeks: "4",
})), ["invalid_duration"], "los strings numéricos quedan para P3-16");

assert.deepEqual(issueCodes(validateTrainingPlan(createValidPlan({ trainingDays: [] }))), [
  "training_days_empty",
]);
assert.deepEqual(issueCodes(validateTrainingPlan({
  ...createValidPlan(),
  trainingDays: null,
})), ["training_days_not_array"]);
assert.deepEqual(issueCodes(validateTrainingPlan(createValidPlan({
  trainingDays: ["Lunes", "Funday"],
}))), ["invalid_training_day"]);
assert.deepEqual(validateTrainingPlan(createValidPlan({
  trainingDays: ["Lunes", "Lunes"],
})).issues, [{
  code: "duplicate_training_day",
  field: "trainingDays",
  day: "Lunes",
  index: 1,
}]);
assert.deepEqual(issueCodes(validateTrainingPlan(createValidPlan({
  trainingDays: ["Miércoles", "Lunes"],
}))), ["training_days_out_of_order"]);
assert.equal(validateTrainingPlan(createValidPlan({ trainingDays: ["Viernes"] })).valid, true);
assert.equal(
  validateTrainingPlan(createValidPlan({ trainingDays: ["Lunes", "Miércoles", "Domingo"] })).valid,
  true,
);

const completeSetup = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes", "Miércoles"] }),
  activeDay: "Miércoles",
  configuredDays: ["Lunes", "Miércoles"],
});
assert.deepEqual(completeSetup, {
  valid: true,
  complete: true,
  canContinue: false,
  canSave: true,
  issues: [],
  incompleteDays: [],
  nextIncompleteDay: null,
});

const completeSetupWithInvalidActiveDay = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes", "Miércoles"] }),
  activeDay: "monday",
  configuredDays: ["Lunes", "Miércoles"],
});
assert.deepEqual(completeSetupWithInvalidActiveDay, {
  valid: true,
  complete: true,
  canContinue: false,
  canSave: true,
  issues: [],
  incompleteDays: [],
  nextIncompleteDay: null,
});

const completeSetupWithUnplannedActiveDay = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes"] }),
  activeDay: "Martes",
  configuredDays: ["Lunes"],
});
assert.deepEqual(completeSetupWithUnplannedActiveDay, {
  valid: true,
  complete: true,
  canContinue: false,
  canSave: true,
  issues: [],
  incompleteDays: [],
  nextIncompleteDay: null,
});

const incompleteSetup = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes", "Miércoles", "Viernes"] }),
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
});
assert.equal(incompleteSetup.valid, true);
assert.equal(incompleteSetup.complete, false);
assert.equal(incompleteSetup.canContinue, true);
assert.equal(incompleteSetup.canSave, false);
assert.deepEqual(incompleteSetup.incompleteDays, ["Miércoles", "Viernes"]);
assert.equal(incompleteSetup.nextIncompleteDay, "Miércoles");
assert.deepEqual(issueCodes(incompleteSetup), [
  "planned_day_not_configured",
  "planned_day_not_configured",
]);

const activeDayIncomplete = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes", "Miércoles"] }),
  activeDay: "Lunes",
  configuredDays: ["Miércoles"],
});
assert.equal(activeDayIncomplete.valid, false);
assert.equal(activeDayIncomplete.complete, false);
assert.equal(activeDayIncomplete.canContinue, false);
assert.equal(activeDayIncomplete.canSave, false);
assert.deepEqual(activeDayIncomplete.incompleteDays, ["Lunes"]);
assert.deepEqual(issueCodes(activeDayIncomplete), ["planned_day_not_configured"]);

const unplannedActiveDay = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes", "Miércoles"] }),
  activeDay: "Viernes",
  configuredDays: ["Lunes"],
});
assert.deepEqual(issueCodes(unplannedActiveDay), [
  "active_day_not_planned",
  "planned_day_not_configured",
]);
assert.equal(unplannedActiveDay.valid, false);
assert.equal(unplannedActiveDay.complete, false);
assert.equal(unplannedActiveDay.canContinue, false);
assert.equal(unplannedActiveDay.canSave, false);

const invalidActiveDay = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes", "Miércoles"] }),
  activeDay: "monday",
  configuredDays: ["Lunes"],
});
assert.deepEqual(issueCodes(invalidActiveDay), [
  "invalid_active_day",
  "planned_day_not_configured",
]);
assert.equal(invalidActiveDay.valid, false);
assert.equal(invalidActiveDay.complete, false);
assert.equal(invalidActiveDay.canContinue, false);
assert.equal(invalidActiveDay.canSave, false);

const ignoredConfiguredDays = validateTrainingPlanSetup({
  plan: createValidPlan({ trainingDays: ["Lunes"] }),
  activeDay: "Lunes",
  configuredDays: ["Lunes", "Lunes", "Viernes", "invalid"],
});
assert.equal(ignoredConfiguredDays.valid, true, "solo los días planificados determinan completitud");
assert.equal(ignoredConfiguredDays.canSave, true);

const deterministicInput = createValidPlan({ trainingDays: ["Lunes", "Jueves"] });
const deterministicInputBefore = structuredClone(deterministicInput);
const firstResult = validateTrainingPlanSetup({
  plan: deterministicInput,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
});
const secondResult = validateTrainingPlanSetup({
  plan: deterministicInput,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
});
assert.deepEqual(firstResult, secondResult, "la validación es determinista");
assert.deepEqual(deterministicInput, deterministicInputBefore, "la validación no muta el input");

const rulesSource = readFileSync("src/lib/training/training-plan-rules.ts", "utf8");
for (const forbidden of [
  /from ["']react["']/,
  /from ["']@\/features\//,
  /from ["']@\/components\//,
  /from ["']@\/lib\/(?:storage|navigation|supabase|data)\//,
  /\b(?:window|document|localStorage|sessionStorage)\b/,
  /\b(?:Date\.now|Math\.random)\s*\(/,
]) {
  assert.doesNotMatch(rulesSource, forbidden);
}

console.log("training plan rules tests passed");
