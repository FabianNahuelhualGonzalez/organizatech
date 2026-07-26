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

assert.match(appStaticSource, /useState<Record<string, SetupDayState>>\(\(\) => createSetupByDay\(\)\)/);
assert.match(appStaticSource, /rows: SetupExerciseRow\[\];/);
assert.match(appStaticSource, /setupState: Record<string, SetupDayState>/);
assert.match(appStaticSource, /const parsed = value as Record<string, Partial<SetupDayState> \| undefined>/);
assert.match(appStaticSource, /as Record<string, SetupDayState>;/);

assert.match(
  appStaticSource,
  /saveRoutineDraft\(\{[\s\S]*?setupByDay,[\s\S]*?trainingPlan,[\s\S]*?activeRoutineDay,[\s\S]*?\}\);/,
  "el guardado debe conservar setupByDay y trainingPlan en el mismo draft",
);
assert.match(
  appStaticSource,
  /const draft = loadRoutineDraft\(mode, userId, \{[\s\S]*?normalizeSetupByDay,[\s\S]*?normalizeTrainingPlan,[\s\S]*?hasSetupDraftContent,[\s\S]*?\}\);/,
  "la carga debe conservar ambos normalizadores tipados",
);
assert.match(
  appFlowStorageStaticSource,
  /export function saveRoutineDraft<TSetupByDay, TTrainingPlan>\(/,
  "saveRoutineDraft debe conservar sus dos genericos independientes",
);
assert.match(
  appFlowStorageStaticSource,
  /export function loadRoutineDraft<TSetupByDay, TTrainingPlan>\(/,
  "loadRoutineDraft debe conservar sus dos genericos independientes",
);

for (const functionName of [
  "createSetupRow",
  "createSetupRows",
  "createSetupDayState",
  "createSetupByDay",
  "getConfiguredSetupDays",
  "hasSetupDraftContent",
  "normalizeSetupByDay",
  "createSetupByDayFromExercises",
  "updateSetupDay",
  "updateSetupRow",
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
