import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static routine setup type integration source contract only.
 *
 * This test does not render React, simulate interactions or test localStorage
 * or persistence at runtime. Typed fixtures and TypeScript cover the model;
 * these assertions only guard type integration and structural conservation.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const routineControllerStaticSource = readFileSync(
  "src/features/routine-builder/hooks/useRoutineBuilderController.ts",
  "utf8",
);
const routineDraftStaticSource = readFileSync(
  "src/lib/training/training-routine-draft.ts",
  "utf8",
);
const appFlowStorageStaticSource = readFileSync(
  "src/lib/storage/app-flow-storage.ts",
  "utf8",
);
const packageStaticSource = readFileSync("package.json", "utf8");

function readFunctionSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} debe conservar una seccion delimitable`);
  return source.slice(start, end);
}

const restoreRoutineDraftStaticSource = readFunctionSection(
  appStaticSource,
  "  function restoreRoutineDraftForSession(",
  "  function restoreWorkoutDraftForSession(",
);

assert.match(
  routineDraftStaticSource,
  /export interface SetupExerciseRow \{\s*id: string;\s*sourceExerciseId\?: string;\s*exerciseLineageId\?: string \| null;\s*name: string;\s*sets: number;\s*reps: number;\s*weight: string;\s*\}/,
  "training-routine-draft debe exportar el shape exacto de SetupExerciseRow",
);
assert.match(
  routineDraftStaticSource,
  /export interface SetupDayState \{\s*routineName: string;\s*rows: SetupExerciseRow\[\];\s*\}/,
  "training-routine-draft debe exportar el shape exacto de SetupDayState",
);

assert.match(
  appStaticSource,
  /import type \{\s*SetupDayState,\s*SetupExerciseRow,\s*\} from "@\/lib\/training\/training-routine-draft";/,
  "React debe importar ambos modelos mediante import type",
);
assert.doesNotMatch(appStaticSource, /^\s*interface SetupExerciseRow\s*\{/m);
assert.doesNotMatch(appStaticSource, /^\s*interface SetupDayState\s*\{/m);

assert.doesNotMatch(appStaticSource, /\buseReducer\b/);
assert.match(
  routineControllerStaticSource,
  /createRoutineBuilderRow/,
  "la factory de filas pertenece al controller feature-local",
);
assert.doesNotMatch(appStaticSource, /createRoutineBuilderRow/);
assert.match(
  routineControllerStaticSource,
  /const\s+\[\s*builderState\s*,\s*dispatchBuilder\s*\]\s*=\s*useReducer\(\s*routineBuilderReducer,/,
  "Routine Builder debe inicializarse realmente con useReducer dentro de su controller",
);
assert.match(routineControllerStaticSource, /createRoutineBuilderState\(\{[\s\S]*?setupByDay:\s*createSetupByDay\(\)/);
assert.match(appStaticSource, /const\s+\{[\s\S]*?activeDay:\s*setupDay,[\s\S]*?setupByDay,[\s\S]*?\}\s*=\s*routineBuilder;/);
assert.match(appStaticSource, /function dispatchRoutineBuilder\(action: \{ type: "select_day"; day: string \}\)/);
assert.match(appStaticSource, /routineBuilder\.selectRoutineDay\(action\.day\)/);
assert.doesNotMatch(routineControllerStaticSource, /\bdispatch\(action:/);
assert.doesNotMatch(appStaticSource, /const\s+\[\s*setupDay\s*,/);
assert.doesNotMatch(appStaticSource, /const\s+\[\s*setupByDay\s*,/);
assert.doesNotMatch(appStaticSource, /\bsetSetupDay\b/);
assert.doesNotMatch(appStaticSource, /\bsetSetupByDay\b/);

assert.match(
  appStaticSource,
  /import \{ createSetupByDayFromExercises \} from "@\/features\/routine-builder\/model\/routine-builder-exercise-mapping";/,
);
assert.match(appStaticSource, /visualRowId:\s*exercise\.id/);
assert.match(appStaticSource, /unknownDayPolicy:\s*"fallback_to_monday"/);
assert.match(appStaticSource, /existingRowsPolicy:\s*"append"/);
assert.doesNotMatch(appStaticSource, /^\s*function createSetupByDayFromExercises\s*\(/m);

assert.match(
  routineControllerStaticSource,
  /import \{ resolveRoutineBuilderDraftRecovery \} from "@\/features\/routine-builder\/model\/routine-builder-draft-recovery";/,
);
assert.match(restoreRoutineDraftStaticSource, /routineBuilder\.restoreDraft\(mode, userId\)/);
assert.match(routineControllerStaticSource, /loadRoutineDraft\(input\.mode, input\.userId, \{/);
assert.match(routineControllerStaticSource, /resolveSetupRecovery\(value\)\s*\{/);
assert.match(routineControllerStaticSource, /resolveRoutineBuilderDraftRecovery\(value\)/);
assert.match(
  routineControllerStaticSource,
  /normalizeTrainingPlan: normalizePersistedTrainingPlan/,
  "recovery debe usar la normalizacion canonica de Training Plan",
);
assert.doesNotMatch(routineControllerStaticSource, /normalizeSetupByDay/);
assert.doesNotMatch(routineControllerStaticSource, /hasSetupDraftContent/);

assert.match(appStaticSource, /rows: SetupExerciseRow\[\];/);
assert.match(appStaticSource, /setupState: Record<string, SetupDayState>/);

assert.match(
  routineControllerStaticSource,
  /write\(\{[\s\S]*?setupByDay: input\.snapshot\.setupByDay,[\s\S]*?trainingPlan: input\.snapshot\.draftPlan,[\s\S]*?activeRoutineDay: input\.snapshot\.activeRoutineDay,[\s\S]*?\}\);/,
  "el guardado debe conservar setupByDay, trainingPlan y activeRoutineDay en el mismo draft",
);
assert.match(
  appFlowStorageStaticSource,
  /export function saveRoutineDraft<TSetupByDay, TTrainingPlan>\(/,
  "saveRoutineDraft debe conservar sus dos genericos independientes",
);
assert.match(
  appFlowStorageStaticSource,
  /export function loadRoutineDraft<TSetupByDay, TTrainingPlan, TRecovery>\([\s\S]*?options: LoadRoutineDraftRecoveryOptions<TSetupByDay, TTrainingPlan, TRecovery>[\s\S]*?RecoveredRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan, TRecovery> \| null/,
  "loadRoutineDraft debe exponer una sola API recovery con tres genericos independientes",
);
assert.equal((appFlowStorageStaticSource.match(/^export function loadRoutineDraft</gm) ?? []).length, 1);
assert.doesNotMatch(appFlowStorageStaticSource, /\bLoadRoutineDraftOptions\b|\bisLegacyLoadRoutineDraftOptions\b/);
assert.doesNotMatch(appFlowStorageStaticSource, /\bnormalizeSetupByDay\b|\bhasSetupDraftContent\b/);
assert.doesNotMatch(appFlowStorageStaticSource, /from ["']@\/features\//);

for (const functionName of [
  "getConfiguredSetupDays",
  "updateSetupRow",
  "updateSetupRoutineName",
  "addSetupRow",
  "removeSetupRow",
  "readSetupNumber",
  "createId",
  "readRequiredWeight",
  "readWeightInput",
]) {
  assert.match(
    appStaticSource,
    new RegExp(`(?:async\\s+)?function\\s+${functionName}\\(`),
    `${functionName} debe permanecer en React`,
  );
}

assert.match(appStaticSource, /async function executeRoutineSaveAdapter\(/);
for (const featureFunctionName of ["createSetupRows", "createSetupDayState", "createSetupByDay"]) {
  assert.match(
    routineControllerStaticSource,
    new RegExp(`export function ${featureFunctionName}\\(`),
    `${featureFunctionName} debe pertenecer a Routine Builder`,
  );
  assert.doesNotMatch(appStaticSource, new RegExp(`^\\s*function ${featureFunctionName}\\(`, "m"));
}
assert.match(routineControllerStaticSource, /export function useRoutineBuilderWorkflows/);
assert.doesNotMatch(appStaticSource, /async function saveInitialRoutine\(/);

for (const removedFunctionName of [
  "normalizeSetupByDay",
  "hasSetupDraftContent",
  "createSetupByDayFromExercises",
  "updateSetupDay",
]) {
  assert.doesNotMatch(
    appStaticSource,
    new RegExp(`^\\s*function\\s+${removedFunctionName}\\s*\\(`, "m"),
    `${removedFunctionName} no debe volver a declararse localmente en React`,
  );
}

assert.doesNotMatch(routineDraftStaticSource, /^import\s/m, "el modelo no debe importar otros dominios");
for (const forbiddenDependency of ["TrainingPlan", "React", "storage", "Supabase"]) {
  assert.doesNotMatch(
    routineDraftStaticSource,
    new RegExp(`from ["'][^"']*${forbiddenDependency}`, "i"),
    `training-routine-draft no debe importar ${forbiddenDependency}`,
  );
}

for (const testRegistration of [
  "tsx src/lib/training/training-routine-draft.test.ts",
  "tsx src/lib/training/training-routine-type-integration-contract.test.ts",
]) {
  assert.equal(
    packageStaticSource.split(testRegistration).length - 1,
    1,
    `${testRegistration} debe registrarse exactamente una vez`,
  );
}

console.log("training routine type static integration source contract tests passed");
