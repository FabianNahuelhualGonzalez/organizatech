import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyTrainingPlanEdit,
  createNextTrainingPlan,
  resolveTrainingPlanSetupTransition,
  type TrainingPlanControllerState,
} from "@/lib/training/training-plan-controller";
import type { TrainingCycleId } from "@/lib/training/training-cycle-id";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import {
  createDefaultTrainingPlan,
  validateTrainingPlan,
  validateTrainingPlanSetup,
} from "@/lib/training/training-plan-rules";

function createPlan(patch: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    ...createDefaultTrainingPlan(),
    ...patch,
    trainingDays: patch.trainingDays ? [...patch.trainingDays] : ["Lunes"],
  };
}

function createState(
  planPatch: Partial<TrainingPlan> = {},
  activeDay = "Lunes",
): TrainingPlanControllerState {
  return { plan: createPlan(planPatch), activeDay };
}

function issueCodes(result: { issues: ReadonlyArray<{ code: string }> }) {
  return result.issues.map((issue) => issue.code);
}

const unchangedInput = createState();
const unchangedInputBefore = structuredClone(unchangedInput);
const unchanged = applyTrainingPlanEdit(unchangedInput, {
  type: "objective",
  value: "Hipertrofia",
});
assert.equal(unchanged.kind, "no_change");
assert.deepEqual(unchanged.state, unchangedInput);
assert.notStrictEqual(unchanged.state, unchangedInput);
assert.notStrictEqual(unchanged.state.plan, unchangedInput.plan);
assert.notStrictEqual(unchanged.state.plan.trainingDays, unchangedInput.plan.trainingDays);
assert.deepEqual(unchangedInput, unchangedInputBefore, "una edición no muta su estado de entrada");

const cycleTransitions: ReadonlyArray<[TrainingCycleId, TrainingCycleId]> = [
  ["macro", "meso"],
  ["meso", "micro"],
  ["micro", "session"],
  ["session", "macro"],
  ["macro", "session"],
];
for (const [from, to] of cycleTransitions) {
  const result = applyTrainingPlanEdit(createState({ cycleType: from }), {
    type: "cycle_type",
    value: to,
  });
  assert.notEqual(result.kind, "blocked");
  assert.equal(result.state.plan.cycleType, to);
  assert.equal(result.validation.valid, true);
  assert.deepEqual(result.state.plan.trainingDays, ["Lunes"]);
  assert.equal(result.state.activeDay, "Lunes");
}

const preservedTargetSelections = applyTrainingPlanEdit(createState({
  cycleType: "macro",
  mesoObjective: "Potencia",
  mesoDurationWeeks: 5,
}), { type: "cycle_type", value: "meso" });
assert.equal(preservedTargetSelections.kind, "updated");
assert.equal(preservedTargetSelections.state.plan.mesoObjective, "Potencia");
assert.equal(preservedTargetSelections.state.plan.mesoDurationWeeks, 5);
assert.deepEqual(preservedTargetSelections.adjustments, []);

const defaultedTargetSelections = applyTrainingPlanEdit(createState({
  cycleType: "macro",
  microFocus: "Objetivo legacy",
  microDurationWeeks: 99,
  macroObjective: "Fuerza",
  macroDurationMonths: 9,
}), { type: "cycle_type", value: "micro" });
assert.equal(defaultedTargetSelections.kind, "updated");
assert.equal(defaultedTargetSelections.state.plan.cycleType, "micro");
assert.equal(defaultedTargetSelections.state.plan.microFocus, "Progresión");
assert.equal(defaultedTargetSelections.state.plan.microDurationWeeks, 1);
assert.equal(defaultedTargetSelections.state.plan.macroObjective, "Fuerza");
assert.equal(defaultedTargetSelections.state.plan.macroDurationMonths, 9);
assert.deepEqual(defaultedTargetSelections.adjustments, [
  { code: "active_objective_defaulted", field: "microFocus" },
  { code: "active_duration_defaulted", field: "microDurationWeeks" },
]);

const invalidCycle = applyTrainingPlanEdit(createState(), {
  type: "cycle_type",
  value: "annual",
});
assert.equal(invalidCycle.kind, "blocked");
assert.deepEqual(issueCodes(invalidCycle.validation), ["invalid_cycle_type"]);
assert.equal(invalidCycle.state.plan.cycleType, "meso");

const objectiveUpdated = applyTrainingPlanEdit(createState({
  macroObjective: "Salud",
}), { type: "objective", value: "Potencia" });
assert.equal(objectiveUpdated.kind, "updated");
assert.equal(objectiveUpdated.state.plan.mesoObjective, "Potencia");
assert.equal(objectiveUpdated.state.plan.macroObjective, "Salud");

const invalidObjective = applyTrainingPlanEdit(createState(), {
  type: "objective",
  value: "Objetivo libre",
});
assert.equal(invalidObjective.kind, "blocked");
assert.deepEqual(issueCodes(invalidObjective.validation), ["invalid_objective"]);
assert.equal(invalidObjective.state.plan.mesoObjective, "Hipertrofia");

const durationUpdated = applyTrainingPlanEdit(createState(), {
  type: "duration",
  value: "5",
});
assert.equal(durationUpdated.kind, "updated");
assert.equal(durationUpdated.state.plan.mesoDurationWeeks, 5);

const invalidDuration = applyTrainingPlanEdit(createState(), {
  type: "duration",
  value: "2",
});
assert.equal(invalidDuration.kind, "blocked");
assert.deepEqual(issueCodes(invalidDuration.validation), ["invalid_duration"]);
assert.equal(invalidDuration.state.plan.mesoDurationWeeks, 4);

const canonicalDays = applyTrainingPlanEdit(
  createState({ trainingDays: ["Lunes", "Miércoles"] }),
  { type: "training_days", value: ["Viernes", "Lunes", "Viernes"] },
);
assert.equal(canonicalDays.kind, "updated");
assert.deepEqual(canonicalDays.state.plan.trainingDays, ["Lunes", "Viernes"]);
assert.equal(canonicalDays.state.activeDay, "Lunes");

const unchangedDays = applyTrainingPlanEdit(
  createState({ trainingDays: ["Lunes", "Miércoles"] }),
  { type: "training_days", value: ["Lunes", "Miércoles"] },
);
assert.equal(unchangedDays.kind, "no_change");

const retainedActiveDay = applyTrainingPlanEdit(
  createState({ trainingDays: ["Lunes", "Miércoles", "Viernes"] }, "Miércoles"),
  { type: "training_days", value: ["Viernes", "Miércoles"] },
);
assert.equal(retainedActiveDay.kind, "updated");
assert.deepEqual(retainedActiveDay.state.plan.trainingDays, ["Miércoles", "Viernes"]);
assert.equal(retainedActiveDay.state.activeDay, "Miércoles");

const replacedActiveDay = applyTrainingPlanEdit(
  createState({ trainingDays: ["Lunes", "Miércoles", "Viernes"] }, "Miércoles"),
  { type: "training_days", value: ["Viernes", "Lunes"] },
);
assert.equal(replacedActiveDay.kind, "updated");
assert.deepEqual(replacedActiveDay.state.plan.trainingDays, ["Lunes", "Viernes"]);
assert.equal(replacedActiveDay.state.activeDay, "Lunes");

const emptyDaysFallback = applyTrainingPlanEdit(
  createState({ trainingDays: ["Lunes", "Jueves"] }, "Jueves"),
  { type: "training_days", value: [] },
);
assert.equal(emptyDaysFallback.kind, "updated");
assert.deepEqual(emptyDaysFallback.state.plan.trainingDays, ["Jueves"]);
assert.equal(emptyDaysFallback.state.activeDay, "Jueves");

const invalidDays = applyTrainingPlanEdit(createState(), {
  type: "training_days",
  value: ["Lunes", "Funday"],
});
assert.equal(invalidDays.kind, "blocked");
assert.deepEqual(issueCodes(invalidDays.validation), ["invalid_training_day"]);

const addedDay = applyTrainingPlanEdit(createState(), {
  type: "toggle_training_day",
  value: "Miércoles",
});
assert.equal(addedDay.kind, "updated");
assert.deepEqual(addedDay.state.plan.trainingDays, ["Lunes", "Miércoles"]);
assert.equal(addedDay.state.activeDay, "Miércoles");

const removedDay = applyTrainingPlanEdit(
  createState({ trainingDays: ["Lunes", "Miércoles", "Viernes"] }, "Viernes"),
  { type: "toggle_training_day", value: "Miércoles" },
);
assert.equal(removedDay.kind, "updated");
assert.deepEqual(removedDay.state.plan.trainingDays, ["Lunes", "Viernes"]);
assert.equal(removedDay.state.activeDay, "Lunes", "el toggle conserva el fallback productivo al primer día");

const lastDayCannotBeRemoved = applyTrainingPlanEdit(createState(), {
  type: "toggle_training_day",
  value: "Lunes",
});
assert.equal(lastDayCannotBeRemoved.kind, "no_change");
assert.deepEqual(lastDayCannotBeRemoved.state.plan.trainingDays, ["Lunes"]);

const setupPlan = createPlan({ trainingDays: ["Lunes", "Miércoles", "Viernes"] });
const directSetupValidation = validateTrainingPlanSetup({
  plan: setupPlan,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
});
const continueSetupInput = {
  plan: setupPlan,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
  activeDayAccepted: true,
  requiresRoutineUpdateConfirmation: false,
  routineUpdateConfirmed: false,
} as const;
const continueSetupInputBefore = structuredClone(continueSetupInput);
const continueSetup = resolveTrainingPlanSetupTransition(continueSetupInput);
assert.equal(continueSetup.kind, "continue_setup");
assert.equal(continueSetup.kind === "continue_setup" ? continueSetup.nextDay : null, "Miércoles");
assert.deepEqual(continueSetup.validation, directSetupValidation);
assert.deepEqual(continueSetupInput, continueSetupInputBefore, "la resolución de setup no muta el input");
assert.deepEqual(
  resolveTrainingPlanSetupTransition(continueSetupInput),
  continueSetup,
  "la resolución de setup es determinista",
);

const confirmedContinue = resolveTrainingPlanSetupTransition({
  plan: setupPlan,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
  activeDayAccepted: true,
  requiresRoutineUpdateConfirmation: true,
  routineUpdateConfirmed: true,
});
assert.equal(confirmedContinue.kind, "continue_setup");

const confirmationRequired = resolveTrainingPlanSetupTransition({
  plan: setupPlan,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
  activeDayAccepted: true,
  requiresRoutineUpdateConfirmation: true,
  routineUpdateConfirmed: false,
});
assert.equal(confirmationRequired.kind, "confirm_update");

const finishSetup = resolveTrainingPlanSetupTransition({
  plan: setupPlan,
  activeDay: "Viernes",
  configuredDays: ["Lunes", "Miércoles", "Viernes"],
  activeDayAccepted: true,
  requiresRoutineUpdateConfirmation: false,
  routineUpdateConfirmed: false,
});
assert.equal(finishSetup.kind, "finish_setup");
assert.equal(finishSetup.validation.canSave, true);

const activeDayRejected = resolveTrainingPlanSetupTransition({
  plan: setupPlan,
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
  activeDayAccepted: false,
  requiresRoutineUpdateConfirmation: false,
  routineUpdateConfirmed: false,
});
assert.equal(activeDayRejected.kind, "blocked");
assert.equal(activeDayRejected.kind === "blocked" ? activeDayRejected.reason : null, "active_day_not_ready");

const invalidSetup = resolveTrainingPlanSetupTransition({
  plan: createPlan({ trainingDays: ["Lunes", "Funday"] }),
  activeDay: "Lunes",
  configuredDays: ["Lunes"],
  activeDayAccepted: true,
  requiresRoutineUpdateConfirmation: false,
  routineUpdateConfirmed: false,
});
assert.equal(invalidSetup.kind, "blocked");
assert.equal(invalidSetup.kind === "blocked" ? invalidSetup.reason : null, "invalid_setup");
assert.deepEqual(issueCodes(invalidSetup.validation), ["invalid_training_day"]);

const defaultNextPlan = createNextTrainingPlan("default");
assert.deepEqual(defaultNextPlan, createDefaultTrainingPlan());
const controlledNextPlan = createNextTrainingPlan("controlled_cycle_scoped");
assert.deepEqual(controlledNextPlan, {
  ...createDefaultTrainingPlan(),
  cycleType: "micro",
  microFocus: "Descarga",
  microDurationWeeks: 1,
});
assert.equal(validateTrainingPlan(defaultNextPlan).valid, true);
assert.equal(validateTrainingPlan(controlledNextPlan).valid, true);

const independentNextPlan = createNextTrainingPlan("controlled_cycle_scoped");
controlledNextPlan.trainingDays.push("Martes");
assert.deepEqual(independentNextPlan.trainingDays, ["Lunes"]);

const deterministicState = createState({ trainingDays: ["Lunes", "Viernes"] });
const deterministicEdit = { type: "toggle_training_day", value: "Miércoles" } as const;
assert.deepEqual(
  applyTrainingPlanEdit(deterministicState, deterministicEdit),
  applyTrainingPlanEdit(deterministicState, deterministicEdit),
  "las transiciones son deterministas",
);

const controllerSource = readFileSync("src/lib/training/training-plan-controller.ts", "utf8");
for (const forbidden of [
  /from ["']react["']/,
  /from ["']@\/features\//,
  /from ["']@\/components\//,
  /from ["']@\/lib\/(?:storage|navigation|supabase|data)\//,
  /from ["'][^"']*repository[^"']*["']/,
  /\b(?:window|document|localStorage|sessionStorage)\b/,
  /\b(?:setScreen|setScreenHistory|setState)\b/,
  /\b(?:Date\.now|Math\.random)\s*\(/,
]) {
  assert.doesNotMatch(controllerSource, forbidden);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: { test: string };
};
const controllerTestCommand = "tsx src/lib/training/training-plan-controller.test.ts";
assert.equal(
  packageJson.scripts.test.split(" && ").filter((command) => command === controllerTestCommand).length,
  1,
  "npm test registra el controller exactamente una vez",
);
assert.equal(packageJson.scripts.test.split(" && ").length, 117);

console.log("training plan controller tests passed");
