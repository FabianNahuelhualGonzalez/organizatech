import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static Training plan type integration source contract only.
 *
 * This test does not render React, simulate interactions or test persistence
 * at runtime. Type behavior is covered by TypeScript and the typed fixtures;
 * these assertions only guard exports, imports, call-sites and boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const cycleIdStaticSource = readFileSync("src/lib/training/training-cycle-id.ts", "utf8");
const planModelStaticSource = readFileSync("src/lib/training/training-plan-model.ts", "utf8");
const presentationStaticSource = readFileSync("src/features/training-plan/model/training-cycle-presentation.ts", "utf8");
const packageStaticSource = readFileSync("package.json", "utf8");

assert.match(cycleIdStaticSource, /export const TRAINING_CYCLE_IDS = \[/);
assert.match(cycleIdStaticSource, /export type TrainingCycleId\s*=/);
assert.match(cycleIdStaticSource, /export function isTrainingCycleId\(/);
assert.match(planModelStaticSource, /export interface TrainingPlan \{/);

assert.match(
  appStaticSource,
  /import \{ isTrainingCycleId \} from "@\/lib\/training\/training-cycle-id";/,
  "React debe importar el guard como valor runtime",
);
assert.match(
  appStaticSource,
  /import type \{ TrainingCycleId \} from "@\/lib\/training\/training-cycle-id";/,
  "React debe importar TrainingCycleId como tipo",
);
assert.match(
  appStaticSource,
  /import type \{ TrainingPlan \} from "@\/lib\/training\/training-plan-model";/,
  "React debe importar TrainingPlan como tipo",
);

assert.doesNotMatch(appStaticSource, /^\s*type TrainingCycleId\s*=/m);
assert.doesNotMatch(appStaticSource, /^\s*interface TrainingPlan\s*\{/m);
assert.doesNotMatch(appStaticSource, /^\s*function isTrainingCycleId\s*\(/m);

assert.match(
  appStaticSource,
  /import \{ TRAINING_CYCLE_PRESENTATIONS as trainingCycles \} from "@\/features\/training-plan\/model\/training-cycle-presentation";/,
  "React consume la fuente única de presentación de ciclos",
);
assert.doesNotMatch(appStaticSource, /^\s*const trainingCycles\s*=\s*\[/m);
const catalogSource = presentationStaticSource;

const catalogIds = [...catalogSource.matchAll(/\bid: "(macro|meso|micro|session)"/g)]
  .map((match) => match[1]);
assert.deepEqual(catalogIds, ["macro", "meso", "micro", "session"]);
assert.match(catalogSource, /as const satisfies ReadonlyArray<\{/);

for (const preservedCopy of [
  "Macrociclo",
  "Plan grande del objetivo principal.",
  "Es la estructura más grande de planificación. Generalmente abarca entre 6 y 11 meses y se enfoca en el objetivo deportivo principal o la forma física deseada.",
  "Mesociclo",
  "Bloques de 3 a 6 semanas.",
  "Son bloques intermedios de entrenamiento. Cada mesociclo trabaja un objetivo específico como fuerza, hipertrofia, potencia, resistencia, descarga o definición.",
  "Microciclo",
  "Organización semanal del entrenamiento.",
  "Representa la planificación semanal. Ordena la distribución de cargas, descansos y tipos de entrenamiento durante la semana.",
  "Sesión de entrenamiento",
  "El entrenamiento de un día específico.",
  "Es la unidad más pequeña del sistema. Contiene ejercicios, series, repeticiones, pesos, intensidad y métricas asociadas a ese día.",
]) {
  assert.ok(catalogSource.includes(preservedCopy), `debe preservarse el copy: ${preservedCopy}`);
}

for (const callSite of [
  /useState<TrainingPlan>\(\(\) => createDefaultTrainingPlan\(\)\)/,
  /function createTrainingPlanFromPersistedCycle\([^)]*fallback: TrainingPlan\): TrainingPlan/,
  /function normalizePersistedTrainingPlan\(value: unknown\): TrainingPlan/,
  /return normalizeTrainingPlanInput\(value\)\.plan;/,
  /isTrainingCycleId\(snapshotCycleType\)/,
  /applyTrainingPlanEdit\(\{ plan: current, activeDay: setupDay \}, edit\)/,
]) {
  assert.match(appStaticSource, callSite, "los call-sites principales deben conservar sus tipos y boundaries");
}
assert.doesNotMatch(appStaticSource, /^\s*function createDefaultTrainingPlan\s*\(/m);
assert.doesNotMatch(appStaticSource, /^\s*function normalizeTrainingPlan\s*\(/m);
assert.doesNotMatch(
  appStaticSource,
  /event\.target\.value as TrainingCycleId/,
  "el flujo integrado no debe castear input del DOM directamente al tipo de dominio",
);

assert.match(appStaticSource, /interface TrainingCycleSnapshot \{/);
assert.match(appStaticSource, /plan: TrainingPlan;/);
assert.match(
  appStaticSource,
  /type TrainingCycleSnapshot as PersistedTrainingCycleSnapshot/,
  "el snapshot local y el snapshot del repository deben seguir separados",
);

for (const testRegistration of [
  "tsx src/lib/training/training-cycle-id.test.ts",
  "tsx src/lib/training/training-plan-model.test.ts",
  "tsx src/lib/training/training-plan-type-integration-contract.test.ts",
]) {
  assert.equal(
    packageStaticSource.split(testRegistration).length - 1,
    1,
    `${testRegistration} debe registrarse exactamente una vez`,
  );
}

console.log("training plan type static integration source contract tests passed");
