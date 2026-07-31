import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Training workout type integration source contract only.
 *
 * This test does not render React, simulate interactions or execute hooks.
 * Type behavior is checked by TypeScript and the typed fixture tests; these
 * assertions only guard exports, imports, call-sites and source boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const activeDraftStaticSource = readFileSync("src/lib/training/active-workout-draft.ts", "utf8");
const workoutStorageStaticSource = readFileSync("src/lib/training/workout-draft-storage.ts", "utf8");
const exerciseDraftStaticSource = readFileSync("src/lib/training/training-exercise-draft.ts", "utf8");
const controllerStateStaticSource = readFileSync(
  "src/features/active-workout/model/active-workout-controller-state.ts",
  "utf8",
);
const completionStaticSource = readFileSync("src/lib/training/active-workout-completion.ts", "utf8");
const completionSummaryStaticSource = readFileSync("src/lib/training/training-completion-summary.ts", "utf8");
// P3-30: la declaracion `drafts: Record<string, ExerciseDraft>` dejo de estar inline en el root al
// extraerse GuidedTrainingScreen; ahora vive en GuidedTrainingScreenProps, su ubicacion real.
const guidedScreenStaticSource = readFileSync(
  "src/features/active-workout/components/GuidedTrainingScreen.tsx",
  "utf8",
);
const packageStaticSource = readFileSync("package.json", "utf8");

assert.match(
  workoutStorageStaticSource,
  /export type ActiveWorkoutReadinessContext = \{/,
  "workout-draft-storage debe exportar ActiveWorkoutReadinessContext",
);
assert.match(
  exerciseDraftStaticSource,
  /export interface ExerciseDraft \{/,
  "training-exercise-draft debe exportar ExerciseDraft",
);
for (const helper of ["createExerciseDraft", "normalizeExerciseDraft", "normalizeExerciseDrafts"]) {
  assert.match(
    exerciseDraftStaticSource,
    new RegExp(`export function ${helper}\\(`),
    `training-exercise-draft debe exportar ${helper}`,
  );
}
assert.match(
  activeDraftStaticSource,
  /export type ActiveWorkoutDraft = Omit</,
  "active-workout-draft debe ser la fuente del tipo concreto",
);

// Contrato ESTATICO/source-based del wiring P3-35. Estas aserciones no ejecutan el reducer,
// no renderizan React y no simulan interacciones del hook.
assert.match(
  controllerStateStaticSource,
  /import type \{ ExerciseDraft \} from "@\/lib\/training\/training-exercise-draft";/,
  "el controller debe importar ExerciseDraft desde su modulo canonico",
);
assert.match(
  controllerStateStaticSource,
  /export interface ActiveWorkoutControllerState \{[\s\S]*exerciseDrafts: Record<string, ExerciseDraft>;/,
  "ActiveWorkoutControllerState debe ser el owner canonico de exerciseDrafts",
);
assert.match(
  appStaticSource,
  /import \{ useActiveWorkoutController \} from "@\/features\/active-workout\/hooks\/useActiveWorkoutController";/,
  "el root debe importar el controller productivo",
);
assert.match(
  appStaticSource,
  /const \{ state: activeWorkoutState, actions: activeWorkoutActions \} = useActiveWorkoutController\(\);/,
  "el root debe usar una unica instancia del controller",
);
assert.match(
  appStaticSource,
  /const \{[\s\S]*exerciseDrafts,[\s\S]*\} = activeWorkoutState;/,
  "el root debe obtener exerciseDrafts desde activeWorkoutState",
);

assert.match(
  appStaticSource,
  /import \{[^}]*type ActiveWorkoutReadinessContext,[^}]*\} from "@\/lib\/training\/workout-draft-storage";/,
  "React debe importar ActiveWorkoutReadinessContext como tipo",
);
assert.match(
  appStaticSource,
  /import \{[^}]*createExerciseDraft,[^}]*type ExerciseDraft,[^}]*\} from "@\/lib\/training\/training-exercise-draft";/,
  "React debe importar createExerciseDraft y ExerciseDraft desde su modulo canonico",
);
assert.doesNotMatch(
  appStaticSource,
  /import \{[^}]*normalizeExerciseDraft[^}]*\} from "@\/lib\/training\/training-exercise-draft";/,
  "React no debe retener normalizacion duplicada despues de extraer completion",
);
assert.match(completionStaticSource, /import \{[^}]*normalizeExerciseDraft[^}]*\} from "@\/lib\/training\/training-exercise-draft";/);
assert.match(completionSummaryStaticSource, /import \{[^}]*normalizeExerciseDraft[^}]*\} from "@\/lib\/training\/training-exercise-draft";/);

assert.doesNotMatch(appStaticSource, /^\s*type ActiveWorkoutReadinessContext\s*=/m);
assert.doesNotMatch(appStaticSource, /^\s*interface ExerciseDraft\s*\{/m);

assert.match(
  appStaticSource,
  /activeWorkoutReadinessContextRef = useRef<ActiveWorkoutReadinessContext \| null>\(null\)/,
  "el useRef preexistente debe conservarse literalmente",
);
assert.match(activeDraftStaticSource, /WorkoutDraftStorageRecord<TrainingReadiness \| null, Record<string, ExerciseDraft>>/);
assert.doesNotMatch(
  appStaticSource,
  /useState<Record<string, ExerciseDraft>>\(\{\}\)/,
  "el root no debe conservar un estado espejo de exerciseDrafts",
);
assert.match(appStaticSource, /patch: Partial<ExerciseDraft>/);
assert.match(guidedScreenStaticSource, /drafts: Record<string, ExerciseDraft>/);
assert.doesNotMatch(appStaticSource, /function createExerciseDraft\(/);
assert.doesNotMatch(appStaticSource, /function normalizeExerciseDraft\(/);
assert.doesNotMatch(appStaticSource, /function normalizeExerciseDrafts\(/);

for (const testRegistration of [
  "tsx src/lib/training/training-exercise-draft.test.ts",
  "tsx src/lib/training/training-workout-type-integration-contract.test.ts",
]) {
  assert.equal(
    packageStaticSource.split(testRegistration).length - 1,
    1,
    `${testRegistration} debe registrarse exactamente una vez`,
  );
}

console.log("training workout type static integration source contract tests passed");
