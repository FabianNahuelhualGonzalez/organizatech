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
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: { test: string };
};

for (const canonicalImport of [
  "applyTrainingPlanEdit",
  "createNextTrainingPlan",
  "resolveTrainingPlanSetupTransition",
  "normalizeTrainingPlanInput",
  "createDefaultTrainingPlan",
  "getTrainingPlanDurationOptions",
  "getTrainingPlanObjectiveOptions as getCycleObjectiveOptions",
]) {
  assert.ok(appSource.includes(canonicalImport), `falta el import canónico ${canonicalImport}`);
}

for (const controllerCall of [
  /applyTrainingPlanEdit\(\{ plan: current, activeDay: setupDay \}, edit\)/,
  /resolveTrainingPlanSetupTransition\(\{/,
  /createNextTrainingPlan\("controlled_cycle_scoped"\)/,
  /createNextTrainingPlan\("default"\)/,
]) {
  assert.match(appSource, controllerCall);
}

for (const editHandler of [
  /updateTrainingPlan\(\{ type: "toggle_training_day", value: item \}\)/,
  /updateTrainingPlan\(\{ type: "cycle_type", value \}\)/,
  /updateTrainingPlan\(\{ type: "objective", value \}\)/,
  /updateTrainingPlan\(\{ type: "duration", value \}\)/,
]) {
  assert.match(appSource, editHandler);
}
assert.match(appSource, /updateTrainingPlan: \(edit: TrainingPlanEdit\) => void;/);
assert.match(appSource, /if \(result\.kind !== "updated"\) return current;/);
assert.match(
  appSource,
  /dispatchRoutineBuilder\(\{ type: "select_day", day: result\.state\.activeDay \}\)/,
  "el controller de Training Plan debe delegar el activeDay al reducer de Routine Builder",
);
assert.doesNotMatch(appSource, /\bsetSetupDay\b|\bsetSetupByDay\b/);

assert.match(appSource, /normalize: normalizePersistedTrainingPlan/);
assert.match(appSource, /normalizeTrainingPlan: normalizePersistedTrainingPlan/);
assert.match(appSource, /function normalizePersistedTrainingPlan\(value: unknown\): TrainingPlan \{/);
assert.match(appSource, /return normalizeTrainingPlanInput\(value\)\.plan;/);
assert.match(appSource, /function createTrainingPlanFromPersistedCycle\(/);
assert.match(appSource, /const normalized = normalizeTrainingPlanInput\(next\);/);
assert.match(appSource, /\[isTrainingCyclesRepositoryActive, persistedActiveCycle, trainingPlan\]/);

for (const removedDuplicate of [
  /^\s*function createDefaultTrainingPlan\s*\(/m,
  /^\s*function normalizeTrainingPlan\s*\(/m,
  /^\s*function createControlledNextTrainingPlan\s*\(/m,
  /^\s*function getCycleObjectiveOptions\s*\(/m,
  /^\s*const (?:macroObjectives|mesoObjectives|microFocusOptions|sessionFocusOptions|macroDurations|mesoDurations)\b/m,
]) {
  assert.doesNotMatch(appSource, removedDuplicate);
}

assert.match(appSource, /async function saveInitialRoutine\(confirmation: RoutineBuilderSaveConfirmation\)/);
assert.match(appSource, /saveRoutine=\{\(\) => void saveInitialRoutine\("unconfirmed"\)\}/);
assert.match(appSource, /onConfirm=\{\(\) => void saveInitialRoutine\("confirmed_routine_update"\)\}/);
assert.match(appSource, /routineUpdateConfirmed: confirmation === "confirmed_routine_update"/);
assert.match(appSource, /const activeDayAccepted = validRows\.length > 0 \|\| isCycleScopedRoutineEdit;/);
assert.match(appSource, /requiresRoutineUpdateConfirmation: isChangingRoutineDays && !isTrainingCyclesRepositoryActive/);
assert.match(appSource, /setupTransition\.kind === "blocked"/);
assert.match(appSource, /setupTransition\.kind === "confirm_update"/);
assert.match(appSource, /setIsRoutineUpdateConfirmOpen\(true\)/);
assert.ok(
  (appSource.match(/setupTransition\.kind === "continue_setup"/g) ?? []).length >= 2,
  "las ramas repository y legacy deben consumir continue_setup",
);
assert.match(
  appSource,
  /dispatchRoutineBuilder\(\{ type: "select_day", day: setupTransition\.nextDay \}\)/,
);
assert.doesNotMatch(appSource, /setupTransition\.validation/);
assert.doesNotMatch(appSource, /const allPlannedDaysComplete\b/);

assert.equal((appSource.match(/\bsetScreen\(/g) ?? []).length, 2);
assert.equal((appSource.match(/\bsetScreenHistory\(/g) ?? []).length, 1);

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
assert.equal(testCommands.length, 122);

console.log("training plan controller static integration contract tests passed");
