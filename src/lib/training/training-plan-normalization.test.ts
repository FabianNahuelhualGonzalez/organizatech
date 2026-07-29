import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { TrainingPlan } from "@/lib/training/training-plan-model";
import {
  normalizeTrainingPlanInput,
  type TrainingPlanNormalizationRepair,
  type TrainingPlanNormalizationResult,
} from "@/lib/training/training-plan-normalization";
import {
  TRAINING_PLAN_DURATIONS_BY_CYCLE,
  TRAINING_PLAN_OBJECTIVES_BY_CYCLE,
  createDefaultTrainingPlan,
  validateTrainingPlan,
} from "@/lib/training/training-plan-rules";

function createPersistedPlan(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...createDefaultTrainingPlan(),
    ...patch,
  };
}

function repairCodes(result: TrainingPlanNormalizationResult) {
  return result.repairs.map((repair) => repair.code);
}

function hasRepair(
  result: TrainingPlanNormalizationResult,
  code: TrainingPlanNormalizationRepair["code"],
  field?: string,
) {
  return result.repairs.some((repair) => (
    repair.code === code && (field === undefined || repair.field === field)
  ));
}

function assertValidNormalizedPlan(result: TrainingPlanNormalizationResult) {
  assert.deepEqual(validateTrainingPlan(result.plan), { valid: true, issues: [] });
}

const canonicalDefault = createDefaultTrainingPlan();
const normalizedDefault = normalizeTrainingPlanInput(canonicalDefault);
assert.deepEqual(normalizedDefault, {
  plan: canonicalDefault,
  repaired: false,
  fallbackApplied: false,
  repairs: [],
});
assertValidNormalizedPlan(normalizedDefault);

// Fixture equivalente al shape completo que el root persiste actualmente.
const persistedRoutinePlan: TrainingPlan = {
  cycleType: "meso",
  macroObjective: "Fuerza",
  macroDurationMonths: 8,
  mesoObjective: "Potencia",
  mesoDurationWeeks: 5,
  microDurationWeeks: 1,
  sessionDurationDays: 1,
  trainingDays: ["Lunes", "Miércoles", "Viernes"],
  microFocus: "Técnica",
  sessionFocus: "Control/RIR",
};
const normalizedPersistedRoutinePlan = normalizeTrainingPlanInput(persistedRoutinePlan);
assert.deepEqual(normalizedPersistedRoutinePlan.plan, persistedRoutinePlan);
assert.equal(normalizedPersistedRoutinePlan.repaired, false);
assert.equal(normalizedPersistedRoutinePlan.fallbackApplied, false);
assertValidNormalizedPlan(normalizedPersistedRoutinePlan);

for (const invalidInput of [null, undefined, "legacy", 42, true, [], ["meso"]]) {
  const result = normalizeTrainingPlanInput(invalidInput);
  assert.deepEqual(result.plan, createDefaultTrainingPlan());
  assert.equal(result.repaired, true);
  assert.equal(result.fallbackApplied, true);
  assert.deepEqual(result.repairs, [{ code: "default_plan_applied", field: "plan" }]);
  assertValidNormalizedPlan(result);
}

const emptyObjectResult = normalizeTrainingPlanInput({});
assert.deepEqual(emptyObjectResult.plan, createDefaultTrainingPlan());
assert.equal(emptyObjectResult.repaired, true);
assert.equal(emptyObjectResult.fallbackApplied, false, "un objeto parcial se repara campo a campo");
assert.equal(hasRepair(emptyObjectResult, "invalid_cycle_type_replaced", "cycleType"), true);
assert.equal(hasRepair(emptyObjectResult, "training_days_replaced", "trainingDays"), true);
assertValidNormalizedPlan(emptyObjectResult);

const invalidCycleResult = normalizeTrainingPlanInput(createPersistedPlan({ cycleType: "annual" }));
assert.equal(invalidCycleResult.plan.cycleType, "meso");
assert.deepEqual(invalidCycleResult.repairs, [{
  code: "invalid_cycle_type_replaced",
  field: "cycleType",
}]);
assertValidNormalizedPlan(invalidCycleResult);

const objectiveCases = [
  { cycleType: "macro", field: "macroObjective", valid: "Fuerza", fallback: "Hipertrofia" },
  { cycleType: "meso", field: "mesoObjective", valid: "Potencia", fallback: "Hipertrofia" },
  { cycleType: "micro", field: "microFocus", valid: "Descarga", fallback: "Progresión" },
  { cycleType: "session", field: "sessionFocus", valid: "Intensidad", fallback: "Técnica" },
] as const;

for (const { cycleType, field, valid, fallback } of objectiveCases) {
  const validResult = normalizeTrainingPlanInput(createPersistedPlan({
    cycleType,
    [field]: valid,
  }));
  assert.equal(validResult.plan[field], valid);
  assert.equal(hasRepair(validResult, "invalid_objective_replaced", field), false);
  assertValidNormalizedPlan(validResult);

  const invalidResult = normalizeTrainingPlanInput(createPersistedPlan({
    cycleType,
    [field]: "Objetivo desconocido",
  }));
  assert.equal(invalidResult.plan[field], fallback);
  assert.equal(hasRepair(invalidResult, "invalid_objective_replaced", field), true);
  assertValidNormalizedPlan(invalidResult);
}

const invalidActiveObjectiveType = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "meso",
  mesoObjective: 123,
}));
assert.equal(invalidActiveObjectiveType.plan.mesoObjective, "Hipertrofia");
assert.equal(hasRepair(invalidActiveObjectiveType, "invalid_objective_replaced", "mesoObjective"), true);

const inactiveLegacyObjective = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "meso",
  macroObjective: "Objetivo legacy personalizado",
}));
assert.equal(
  inactiveLegacyObjective.plan.macroObjective,
  "Objetivo legacy personalizado",
  "un objetivo histórico inactivo conserva la semántica productiva previa",
);
assert.equal(hasRepair(inactiveLegacyObjective, "invalid_objective_replaced", "macroObjective"), false);
assertValidNormalizedPlan(inactiveLegacyObjective);

const invalidInactiveObjectiveInput = createPersistedPlan({
  cycleType: "meso",
  macroObjective: 123,
  mesoObjective: "Potencia",
});
const invalidInactiveObjectiveInputBefore = structuredClone(invalidInactiveObjectiveInput);
const invalidInactiveObjective = normalizeTrainingPlanInput(invalidInactiveObjectiveInput);
assert.equal(invalidInactiveObjective.plan.macroObjective, "Hipertrofia");
assert.equal(invalidInactiveObjective.plan.mesoObjective, "Potencia");
assert.deepEqual(
  invalidInactiveObjective.repairs.filter((repair) => (
    repair.code === "invalid_objective_replaced" && repair.field === "macroObjective"
  )),
  [{ code: "invalid_objective_replaced", field: "macroObjective" }],
);
assert.equal(invalidInactiveObjective.repaired, true);
assert.equal(invalidInactiveObjective.fallbackApplied, false);
assertValidNormalizedPlan(invalidInactiveObjective);
assert.deepEqual(
  invalidInactiveObjectiveInput,
  invalidInactiveObjectiveInputBefore,
  "reparar un objetivo inactivo no-string no muta el input",
);

const numericDuration = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "macro",
  macroDurationMonths: 8,
}));
assert.equal(numericDuration.plan.macroDurationMonths, 8);
assert.equal(hasRepair(numericDuration, "numeric_duration_coerced", "macroDurationMonths"), false);

const historicalStringDurations = normalizeTrainingPlanInput(createPersistedPlan({
  macroDurationMonths: "8",
  mesoDurationWeeks: " 5.0 ",
  microDurationWeeks: "1",
  sessionDurationDays: "1e0",
}));
assert.deepEqual({
  macroDurationMonths: historicalStringDurations.plan.macroDurationMonths,
  mesoDurationWeeks: historicalStringDurations.plan.mesoDurationWeeks,
  microDurationWeeks: historicalStringDurations.plan.microDurationWeeks,
  sessionDurationDays: historicalStringDurations.plan.sessionDurationDays,
}, {
  macroDurationMonths: 8,
  mesoDurationWeeks: 5,
  microDurationWeeks: 1,
  sessionDurationDays: 1,
});
assert.equal(
  historicalStringDurations.repairs.filter((repair) => repair.code === "numeric_duration_coerced").length,
  4,
);
assertValidNormalizedPlan(historicalStringDurations);

const zeroPaddedDuration = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "meso",
  mesoDurationWeeks: "04",
}));
assert.equal(zeroPaddedDuration.plan.mesoDurationWeeks, 4);
assert.equal(hasRepair(zeroPaddedDuration, "numeric_duration_coerced", "mesoDurationWeeks"), true);
assert.equal(hasRepair(zeroPaddedDuration, "invalid_duration_replaced", "mesoDurationWeeks"), false);

const explicitlyPositiveDuration = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "meso",
  mesoDurationWeeks: "+6",
}));
assert.equal(explicitlyPositiveDuration.plan.mesoDurationWeeks, 6);
assert.equal(hasRepair(explicitlyPositiveDuration, "numeric_duration_coerced", "mesoDurationWeeks"), true);
assert.equal(hasRepair(explicitlyPositiveDuration, "invalid_duration_replaced", "mesoDurationWeeks"), false);

const negativeDuration = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "meso",
  mesoDurationWeeks: "-6",
}));
assert.equal(negativeDuration.plan.mesoDurationWeeks, 4);
assert.equal(hasRepair(negativeDuration, "invalid_duration_replaced", "mesoDurationWeeks"), true);
assert.equal(hasRepair(negativeDuration, "numeric_duration_coerced", "mesoDurationWeeks"), false);

for (const [value, field] of [
  ["8 meses", "macroDurationMonths"],
  ["0x8", "macroDurationMonths"],
  [12, "macroDurationMonths"],
  ["2", "microDurationWeeks"],
  [Number.POSITIVE_INFINITY, "mesoDurationWeeks"],
  [null, "sessionDurationDays"],
] as const) {
  const result = normalizeTrainingPlanInput(createPersistedPlan({ [field]: value }));
  assert.equal(result.plan[field], createDefaultTrainingPlan()[field]);
  assert.equal(hasRepair(result, "invalid_duration_replaced", field), true);
  assertValidNormalizedPlan(result);
}

const missingTrainingDaysInput = createPersistedPlan();
delete missingTrainingDaysInput.trainingDays;
for (const trainingDays of [undefined, null, "Lunes", []]) {
  const input = trainingDays === undefined
    ? missingTrainingDaysInput
    : createPersistedPlan({ trainingDays });
  const result = normalizeTrainingPlanInput(input);
  assert.deepEqual(result.plan.trainingDays, ["Lunes"]);
  assert.equal(hasRepair(result, "training_days_replaced", "trainingDays"), true);
  assertValidNormalizedPlan(result);
}

const duplicateDays = normalizeTrainingPlanInput(createPersistedPlan({
  trainingDays: ["Lunes", "Miércoles", "Lunes"],
}));
assert.deepEqual(duplicateDays.plan.trainingDays, ["Lunes", "Miércoles"]);
assert.deepEqual(
  duplicateDays.repairs.filter((repair) => repair.code === "training_days_deduplicated"),
  [{ code: "training_days_deduplicated", field: "trainingDays", day: "Lunes", index: 2 }],
);
assertValidNormalizedPlan(duplicateDays);

const unorderedDays = normalizeTrainingPlanInput(createPersistedPlan({
  trainingDays: ["Viernes", "Lunes", "Miércoles"],
}));
assert.deepEqual(unorderedDays.plan.trainingDays, ["Lunes", "Miércoles", "Viernes"]);
assert.equal(hasRepair(unorderedDays, "training_days_reordered", "trainingDays"), true);
assertValidNormalizedPlan(unorderedDays);

const mixedDays = normalizeTrainingPlanInput(createPersistedPlan({
  trainingDays: ["Miércoles", "Funday", "Lunes", "Miércoles", 7, "Viernes"],
}));
assert.deepEqual(mixedDays.plan.trainingDays, ["Lunes", "Miércoles", "Viernes"]);
assert.deepEqual(repairCodes(mixedDays), [
  "invalid_training_day_removed",
  "training_days_deduplicated",
  "invalid_training_day_removed",
  "training_days_reordered",
]);
assertValidNormalizedPlan(mixedDays);

const onlyInvalidDays = normalizeTrainingPlanInput(createPersistedPlan({
  trainingDays: ["lunes", "Miercoles", "monday", 1],
}));
assert.deepEqual(onlyInvalidDays.plan.trainingDays, ["Lunes"]);
assert.equal(
  onlyInvalidDays.repairs.filter((repair) => repair.code === "invalid_training_day_removed").length,
  4,
  "no se inventan aliases históricos de mayúsculas, acentos o idioma",
);
assert.equal(hasRepair(onlyInvalidDays, "training_days_replaced", "trainingDays"), true);
assertValidNormalizedPlan(onlyInvalidDays);

const partialLegacyPlan = normalizeTrainingPlanInput({
  cycleType: "macro",
  macroObjective: "Rendimiento",
  macroDurationMonths: "10",
  trainingDays: ["Sábado", "Martes"],
});
assert.deepEqual(partialLegacyPlan.plan, {
  ...createDefaultTrainingPlan(),
  cycleType: "macro",
  macroObjective: "Rendimiento",
  macroDurationMonths: 10,
  trainingDays: ["Martes", "Sábado"],
});
assert.equal(partialLegacyPlan.fallbackApplied, false);
assertValidNormalizedPlan(partialLegacyPlan);

const inactiveFields = normalizeTrainingPlanInput(createPersistedPlan({
  cycleType: "meso",
  macroObjective: "Objetivo histórico",
  macroDurationMonths: "9",
  microFocus: "Foco histórico",
}));
assert.equal(inactiveFields.plan.macroObjective, "Objetivo histórico");
assert.equal(inactiveFields.plan.macroDurationMonths, 9);
assert.equal(inactiveFields.plan.microFocus, "Foco histórico");
assertValidNormalizedPlan(inactiveFields);

const mutableInput = createPersistedPlan({
  trainingDays: ["Viernes", "Lunes", "Lunes", "invalid"],
  macroDurationMonths: "7",
});
const mutableInputBefore = structuredClone(mutableInput);
const firstDeterministicResult = normalizeTrainingPlanInput(mutableInput);
const secondDeterministicResult = normalizeTrainingPlanInput(mutableInput);
assert.deepEqual(mutableInput, mutableInputBefore, "la normalización no muta el input");
assert.deepEqual(firstDeterministicResult, secondDeterministicResult, "la salida es determinista");

firstDeterministicResult.plan.trainingDays.push("Domingo");
assert.deepEqual(
  secondDeterministicResult.plan.trainingDays,
  ["Lunes", "Viernes"],
  "cada llamada devuelve un output independiente",
);
const firstFallback = normalizeTrainingPlanInput(null);
const secondFallback = normalizeTrainingPlanInput(null);
firstFallback.plan.trainingDays.push("Domingo");
assert.deepEqual(secondFallback.plan.trainingDays, ["Lunes"], "los fallbacks no comparten arrays");

const objectivesBefore = structuredClone(TRAINING_PLAN_OBJECTIVES_BY_CYCLE);
const durationsBefore = structuredClone(TRAINING_PLAN_DURATIONS_BY_CYCLE);
normalizeTrainingPlanInput(createPersistedPlan({
  macroObjective: "Fuerza",
  macroDurationMonths: "11",
}));
assert.deepEqual(TRAINING_PLAN_OBJECTIVES_BY_CYCLE, objectivesBefore, "el catálogo de objetivos no se muta");
assert.deepEqual(TRAINING_PLAN_DURATIONS_BY_CYCLE, durationsBefore, "el catálogo de duraciones no se muta");

const normalizationSource = readFileSync(
  "src/lib/training/training-plan-normalization.ts",
  "utf8",
);
for (const forbidden of [
  /from ["']react["']/,
  /from ["']@\/features\//,
  /from ["']@\/components\//,
  /from ["']@\/lib\/(?:storage|navigation|supabase|data)\//,
  /\b(?:window|document|localStorage|sessionStorage)\b/,
  /\b(?:Date\.now|Math\.random)\s*\(/,
  /\bnew Date\s*\(/,
  /\b(?:setTimeout|setInterval)\s*\(/,
]) {
  assert.doesNotMatch(normalizationSource, forbidden);
}

const packageSource = readFileSync("package.json", "utf8");
assert.equal(
  packageSource.match(/src\/lib\/training\/training-plan-normalization\.test\.ts/g)?.length,
  1,
  "el test de dominio se registra exactamente una vez en npm test",
);

console.log("training plan normalization tests passed");
