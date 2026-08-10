import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static P3-18 Training Plan integration source contract only.
 *
 * This test does not render React, simulate browser interactions or execute
 * persistence. Runtime behavior remains covered by the P3-15/16/17 unit tests.
 */
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const controllerSource = readFileSync("src/lib/training/training-plan-controller.ts", "utf8");
const normalizationSource = readFileSync("src/lib/training/training-plan-normalization.ts", "utf8");
const routineControllerSource = readFileSync(
  "src/features/routine-builder/hooks/useRoutineBuilderController.ts",
  "utf8",
);
const trainingDataSelectorsSource = readFileSync(
  "src/features/training-data/model/training-data-selectors.ts",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: { test: string };
};

for (const canonicalImport of [
  "createNextTrainingPlan",
  "resolveTrainingPlanSetupTransition",
  "getTrainingPlanDurationOptions",
  "getTrainingPlanObjectiveOptions as getCycleObjectiveOptions",
]) {
  assert.ok(appSource.includes(canonicalImport), `falta el import canónico ${canonicalImport}`);
}
assert.match(
  routineControllerSource,
  /import \{ createDefaultTrainingPlan \} from "@\/lib\/training\/training-plan-rules";/,
  "Routine Builder importa la factory canónica que ahora posee su estado",
);
assert.match(routineControllerSource, /import \{[\s\S]*applyTrainingPlanEdit[\s\S]*\} from "@\/lib\/training\/training-plan-controller"/);
assert.match(routineControllerSource, /import \{ normalizeTrainingPlanInput \}/);

for (const controllerCall of [
  /resolveTrainingPlanSetupTransition\(\{/,
  /createNextTrainingPlan\("controlled_cycle_scoped"\)/,
  /createNextTrainingPlan\("default"\)/,
]) {
  assert.match(appSource, controllerCall);
}
assert.match(routineControllerSource, /applyTrainingPlanEdit\([\s\S]*plan: currentPlan[\s\S]*activeDay: currentBuilderState\.activeDay/);

for (const editHandler of [
  /updateTrainingPlan\(\{ type: "toggle_training_day", value: item \}\)/,
  /updateTrainingPlan\(\{ type: "cycle_type", value \}\)/,
  /updateTrainingPlan\(\{ type: "objective", value \}\)/,
  /updateTrainingPlan\(\{ type: "duration", value \}\)/,
]) {
  assert.match(appSource, editHandler);
}
assert.match(appSource, /updateTrainingPlan: \(edit: TrainingPlanEdit\) => void;/);
assert.match(
  routineControllerSource,
  /dispatchBuilder\(\{ type: "select_day", day: result\.state\.activeDay \}\)/,
  "el controller de Training Plan debe delegar el activeDay al reducer de Routine Builder",
);
assert.doesNotMatch(appSource, /\bsetSetupDay\b|\bsetSetupByDay\b/);

assert.match(appSource, /routineBuilder\.restoreDraft\(mode, userId\)/);
assert.match(routineControllerSource, /loadTrainingPlan\(scope, \{[\s\S]*normalize: normalizePersistedTrainingPlan/);
assert.match(routineControllerSource, /normalizeTrainingPlan: normalizePersistedTrainingPlan/);
assert.match(routineControllerSource, /function normalizePersistedTrainingPlan\(value: unknown\): TrainingPlan \{/);
assert.match(routineControllerSource, /return normalizeTrainingPlanInput\(value\)\.plan;/);
assert.doesNotMatch(appSource, /function normalizePersistedTrainingPlan/);
assert.doesNotMatch(appSource, /function createTrainingPlanFromPersistedCycle\(/);
assert.match(trainingDataSelectorsSource, /export function createTrainingPlanFromPersistedCycle\(/);
assert.match(trainingDataSelectorsSource, /const normalized = normalizeTrainingPlanInput\(next\);/);
assert.match(appSource, /selectTrainingDataView\(trainingDataState, trainingPlan\)/);
assert.match(appSource, /\[trainingDataState, trainingPlan\]/);

for (const removedDuplicate of [
  /^\s*function createDefaultTrainingPlan\s*\(/m,
  /^\s*function normalizeTrainingPlan\s*\(/m,
  /^\s*function createControlledNextTrainingPlan\s*\(/m,
  /^\s*function getCycleObjectiveOptions\s*\(/m,
  /^\s*const (?:macroObjectives|mesoObjectives|microFocusOptions|sessionFocusOptions|macroDurations|mesoDurations)\b/m,
]) {
  assert.doesNotMatch(appSource, removedDuplicate);
}

assert.match(appSource, /async function executeRoutineSaveAdapter\([\s\S]*confirmation: RoutineBuilderSaveConfirmation/);
assert.match(routineControllerSource, /export function useRoutineBuilderWorkflows/);
assert.match(appSource, /saveRoutine=\{\(\) => void saveInitialRoutine\("unconfirmed"\)\}/);
assert.match(appSource, /onConfirm=\{\(\) => void saveInitialRoutine\("confirmed_routine_update"\)\}/);
assert.match(appSource, /routineUpdateConfirmed: confirmation === "confirmed_routine_update"/);
assert.match(appSource, /const activeDayAccepted = validRows\.length > 0 \|\| isCycleScopedRoutineEdit;/);
assert.match(appSource, /requiresRoutineUpdateConfirmation: isChangingRoutineDays && !isTrainingCyclesRepositoryActive/);
assert.match(appSource, /setupTransition\.kind === "blocked"/);
assert.match(appSource, /setupTransition\.kind === "confirm_update"/);
assert.match(appSource, /routineBuilder\.openModal\("routine-update-confirm"\)/);
assert.ok(
  (appSource.match(/setupTransition\.kind === "continue_setup"/g) ?? []).length >= 2,
  "las ramas repository y legacy deben consumir continue_setup",
);
assert.match(
  appSource,
  /routineBuilder\.selectRoutineDay\(setupTransition\.nextDay\)/,
);
assert.doesNotMatch(appSource, /setupTransition\.validation/);
assert.doesNotMatch(appSource, /const allPlannedDaysComplete\b/);

assert.equal((appSource.match(/\bsetScreen\(/g) ?? []).length, 0);
assert.equal((appSource.match(/\bsetScreenHistory\(/g) ?? []).length, 0);
assert.match(appSource, /useAppNavigationController/);

for (const visualContract of [
  /import \{ TrainingPlanSetupCard \}/,
  /<TrainingPlanSetupCard\b/,
  /import \{ ConfirmRoutineUpdateModal \}/,
  /<ConfirmRoutineUpdateModal\b/,
  /import \{ ConfirmNewCycleModal \}/,
  /<ConfirmNewCycleModal\b/,
  /import \{ ConfirmDeleteCycleModal \}/,
  /<ConfirmDeleteCycleModal\b/,
]) {
  assert.match(appSource, visualContract);
}

assert.match(controllerSource, /export function applyTrainingPlanEdit\(/);
assert.match(controllerSource, /export function resolveTrainingPlanSetupTransition\(/);
assert.match(controllerSource, /export function createNextTrainingPlan\(/);
assert.match(normalizationSource, /export function normalizeTrainingPlanInput\(/);

const integrationTestCommand = "tsx src/lib/training/training-plan-controller-integration-contract.test.ts";
const testCommands = packageJson.scripts.test.split(" && ");
assert.equal(testCommands.filter((command) => command === integrationTestCommand).length, 1);
assert.equal(testCommands.length, 126);

console.log("training plan controller static integration contract tests passed");
