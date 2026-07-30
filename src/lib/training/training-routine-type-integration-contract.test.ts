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

assert.match(appStaticSource, /\buseReducer\b/);
assert.match(
  appStaticSource,
  /import \{[\s\S]*?createRoutineBuilderRow,[\s\S]*?createRoutineBuilderState,[\s\S]*?routineBuilderReducer,[\s\S]*?\} from "@\/features\/routine-builder\/model\/routine-builder-state";/,
  "React debe importar el reducer, initializer y factory de filas canónicos",
);
assert.match(
  appStaticSource,
  /const\s+\[\s*routineBuilderState\s*,\s*dispatchRoutineBuilder\s*\]\s*=\s*useReducer\(\s*routineBuilderReducer,/,
  "Routine Builder debe inicializarse realmente con useReducer y routineBuilderReducer",
);
assert.match(appStaticSource, /createRoutineBuilderState\(\{[\s\S]*?setupByDay:\s*createSetupByDay\(\)/);
assert.match(appStaticSource, /const\s+setupDay\s*=\s*routineBuilderState\.activeDay;/);
assert.match(appStaticSource, /const\s+setupByDay\s*=\s*routineBuilderState\.setupByDay;/);
assert.match(appStaticSource, /dispatchRoutineBuilder\(\{[\s\S]*?type:\s*"(?:select_day|replace_state|reset_state|update_row_field)"/);
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
  appStaticSource,
  /import \{ resolveRoutineBuilderDraftRecovery \} from "@\/features\/routine-builder\/model\/routine-builder-draft-recovery";/,
);
assert.match(restoreRoutineDraftStaticSource, /loadRoutineDraft\(mode, userId, \{/);
assert.match(restoreRoutineDraftStaticSource, /resolveSetupRecovery\(input\)\s*\{/);
assert.match(restoreRoutineDraftStaticSource, /resolveRoutineBuilderDraftRecovery\(input\)/);
assert.match(
  restoreRoutineDraftStaticSource,
  /normalizeTrainingPlan: normalizePersistedTrainingPlan/,
  "recovery debe usar la normalizacion canonica de Training Plan",
);
assert.doesNotMatch(restoreRoutineDraftStaticSource, /normalizeSetupByDay/);
assert.doesNotMatch(restoreRoutineDraftStaticSource, /hasSetupDraftContent/);

assert.match(appStaticSource, /rows: SetupExerciseRow\[\];/);
assert.match(appStaticSource, /setupState: Record<string, SetupDayState>/);

assert.match(
  appStaticSource,
  /saveRoutineDraft\(\{[\s\S]*?setupByDay,[\s\S]*?trainingPlan,[\s\S]*?activeRoutineDay,[\s\S]*?\}\);/,
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
  "createSetupRow",
  "createSetupRows",
  "createSetupDayState",
  "createSetupByDay",
  "getConfiguredSetupDays",
  "updateSetupRow",
  "updateSetupRoutineName",
  "addSetupRow",
  "removeSetupRow",
  "saveInitialRoutine",
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
