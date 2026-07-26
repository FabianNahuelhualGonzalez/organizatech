import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Training readiness type integration source contract only.
 *
 * This test does not render React or simulate interactions. It also does not
 * demonstrate runtime equivalence between TrainingReadiness and
 * TrainingDailyReadinessPayload, nor require those independent contracts to
 * evolve together. Type behavior remains covered by TypeScript and the typed
 * fixtures in training-readiness-draft.test.ts; these assertions only guard
 * exports, imports, existing call-sites and source boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const readinessDraftStaticSource = readFileSync(
  "src/lib/training/training-readiness-draft.ts",
  "utf8",
);
const readinessScreenStaticSource = readFileSync(
  "src/features/active-workout/components/TrainingReadinessScreen.tsx",
  "utf8",
);
const packageStaticSource = readFileSync("package.json", "utf8");

assert.match(
  readinessDraftStaticSource,
  /export interface TrainingReadiness \{\s*motivation\?: number;\s*hydration\?: number;\s*sleep\?: number;\s*energy\?: number;\s*skipped: boolean;\s*\}/,
  "training-readiness-draft debe exportar el shape exacto de TrainingReadiness",
);

assert.match(
  appStaticSource,
  /import type \{ TrainingReadiness \} from "@\/lib\/training\/training-readiness-draft";/,
  "React debe importar TrainingReadiness mediante import type",
);
assert.doesNotMatch(
  appStaticSource,
  /^\s*interface TrainingReadiness\s*\{/m,
  "organizatech-app no debe conservar una definicion local de TrainingReadiness",
);

assert.match(
  appStaticSource,
  /type WorkoutDraft = WorkoutDraftStorageRecord<TrainingReadiness \| null, Record<string, ExerciseDraft>>;/,
  "WorkoutDraft debe conservar el generico de readiness",
);
assert.match(
  appStaticSource,
  /const \[readiness, setReadiness\] = useState<TrainingReadiness \| null>\(null\);/,
  "el estado React debe conservar TrainingReadiness",
);
assert.match(
  readinessScreenStaticSource,
  /onSubmit: \(value: Omit<TrainingReadiness, "skipped">\) => void \| Promise<void>;/,
  "las props del formulario deben conservar TrainingReadiness",
);

for (const functionContract of [
  /function persistCurrentWorkoutDraftSnapshot\(nextReadiness: TrainingReadiness \| null\)/,
  /async function submitDailyReadiness\(value: Omit<TrainingReadiness, "skipped">\)/,
  /async function persistDailyReadiness\(value: TrainingReadiness\)/,
  /function normalizeTrainingReadiness\(value: unknown\): TrainingReadiness \| null/,
  /function formatReadinessNote\(value: TrainingReadiness \| null\)/,
]) {
  assert.match(
    appStaticSource,
    functionContract,
    "las funciones preexistentes deben conservar sus contratos con TrainingReadiness",
  );
}

assert.doesNotMatch(
  readinessDraftStaticSource,
  /import[^;]*TrainingDailyReadinessPayload[^;]*;/,
  "training-readiness-draft no debe importar TrainingDailyReadinessPayload",
);
assert.doesNotMatch(
  readinessDraftStaticSource,
  /interface\s+TrainingReadiness\s+extends\s+TrainingDailyReadinessPayload/,
  "TrainingReadiness no debe extender TrainingDailyReadinessPayload",
);
assert.doesNotMatch(
  readinessDraftStaticSource,
  /type\s+TrainingReadiness\s*=\s*TrainingDailyReadinessPayload\b/,
  "TrainingReadiness no debe ser alias de TrainingDailyReadinessPayload",
);

for (const testRegistration of [
  "tsx src/lib/training/training-readiness-draft.test.ts",
  "tsx src/lib/training/training-readiness-type-integration-contract.test.ts",
]) {
  assert.equal(
    packageStaticSource.split(testRegistration).length - 1,
    1,
    `${testRegistration} debe registrarse exactamente una vez`,
  );
}

console.log("training readiness type static integration source contract tests passed");
