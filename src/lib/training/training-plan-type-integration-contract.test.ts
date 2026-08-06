import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Static Training plan type integration source contract only.
 *
 * This test does not render React, simulate interactions or test persistence
 * at runtime. Type behavior is covered by TypeScript and the typed fixtures;
 * these assertions only guard exports, imports, call-sites and boundaries.
 */
const appStaticSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const routineControllerStaticSource = readFileSync(
  "src/features/routine-builder/hooks/useRoutineBuilderController.ts",
  "utf8",
);
const cycleIdStaticSource = readFileSync("src/lib/training/training-cycle-id.ts", "utf8");
const planModelStaticSource = readFileSync("src/lib/training/training-plan-model.ts", "utf8");
const presentationStaticSource = readFileSync("src/features/training-plan/model/training-cycle-presentation.ts", "utf8");
const trainingDataSelectorsStaticSource = readFileSync(
  "src/features/training-data/model/training-data-selectors.ts",
  "utf8",
);
const legacySnapshotStaticSource = readFileSync(
  "src/lib/training/cycle-history/cycle-history-legacy-adapter.ts",
  "utf8",
);
const legacyControllerStaticSource = readFileSync(
  "src/features/cycle-history/model/legacy-cycle-history-controller.ts",
  "utf8",
);
const legacyHookStaticSource = readFileSync(
  "src/features/cycle-history/hooks/useLegacyCycleHistoryController.ts",
  "utf8",
);
const packageStaticSource = readFileSync("package.json", "utf8");

function collectProductionTypeScriptSources(directory: string): Array<{ path: string; source: string }> {
  const sources: Array<{ path: string; source: string }> = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectProductionTypeScriptSources(path).forEach((source) => sources.push(source));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    sources.push({ path, source: readFileSync(path, "utf8") });
  }
  return sources;
}

assert.match(cycleIdStaticSource, /export const TRAINING_CYCLE_IDS = \[/);
assert.match(cycleIdStaticSource, /export type TrainingCycleId\s*=/);
assert.match(cycleIdStaticSource, /export function isTrainingCycleId\(/);
assert.match(planModelStaticSource, /export interface TrainingPlan \{/);

assert.match(
  trainingDataSelectorsStaticSource,
  /import \{ isTrainingCycleId \} from "@\/lib\/training\/training-cycle-id";/,
  "el selector TrainingData debe importar el guard como valor runtime",
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

assert.match(
  routineControllerStaticSource,
  /useState<RoutineBuilderTrainingDataState>\(\(\) => \(\{[\s\S]*draftPlan: createDefaultTrainingPlan\(\),[\s\S]*activeRoutineDay: "Lunes"/,
  "el snapshot tipado y atómico de TrainingData pertenece al controller feature-local",
);
for (const callSite of [
  /function normalizePersistedTrainingPlan\(value: unknown\): TrainingPlan/,
  /return normalizeTrainingPlanInput\(value\)\.plan;/,
  /applyTrainingPlanEdit\([\s\S]*plan: currentPlan[\s\S]*activeDay: currentBuilderState\.activeDay/,
]) {
  assert.match(routineControllerStaticSource, callSite, "los call-sites principales deben conservar sus tipos y boundaries");
}
assert.doesNotMatch(appStaticSource, /function normalizePersistedTrainingPlan/);
assert.match(
  trainingDataSelectorsStaticSource,
  /function createTrainingPlanFromPersistedCycle\([^)]*fallback: TrainingPlan[^)]*\): TrainingPlan/,
);
assert.match(trainingDataSelectorsStaticSource, /isTrainingCycleId\(snapshotCycleType\)/);
assert.doesNotMatch(appStaticSource, /^\s*function createDefaultTrainingPlan\s*\(/m);
assert.doesNotMatch(appStaticSource, /^\s*function normalizeTrainingPlan\s*\(/m);
assert.doesNotMatch(
  appStaticSource,
  /event\.target\.value as TrainingCycleId/,
  "el flujo integrado no debe castear input del DOM directamente al tipo de dominio",
);

assert.match(
  legacySnapshotStaticSource,
  /export interface LegacyCycleHistorySnapshot \{/,
  "el snapshot legacy pertenece al adapter canónico de Cycle History",
);
assert.match(legacySnapshotStaticSource, /plan: TrainingPlan;/);
assert.match(
  appStaticSource,
  /type TrainingCycleSnapshot as PersistedTrainingCycleSnapshot/,
  "el snapshot local y el snapshot del repository deben seguir separados",
);
assert.doesNotMatch(appStaticSource, /interface (?:TrainingCycleSnapshot|LegacyCycleHistorySnapshot) \{/);
assert.match(
  legacyControllerStaticSource,
  /import type \{ LegacyCycleHistorySnapshot \} from "@\/lib\/training\/cycle-history\/cycle-history-legacy-adapter";/,
);
assert.match(
  legacyControllerStaticSource,
  /readonly cycleHistory: readonly LegacyCycleHistorySnapshot\[\];/,
);
assert.match(
  legacyHookStaticSource,
  /createLegacyCycleHistoryController\(\{/,
  "el hook instancia el único owner feature-local",
);
assert.match(
  appStaticSource,
  /import \{ useLegacyCycleHistoryController \} from "@\/features\/cycle-history\/hooks\/useLegacyCycleHistoryController";/,
);
assert.match(appStaticSource, /const legacyCycleHistoryBoundary = useLegacyCycleHistoryController\(\{/);
assert.match(appStaticSource, /legacySnapshots=\{cycleHistory\}/);

const productionSources = collectProductionTypeScriptSources("src");
const legacySnapshotOwners = productionSources.filter(({ source }) => (
  /(?:export\s+)?interface LegacyCycleHistorySnapshot \{/.test(source)
));
assert.deepEqual(
  legacySnapshotOwners.map(({ path }) => path),
  ["src/lib/training/cycle-history/cycle-history-legacy-adapter.ts"],
  "LegacyCycleHistorySnapshot debe tener un único owner productivo",
);
assert.equal(
  productionSources.filter(({ source }) => /interface TrainingCycleSnapshot \{/.test(source)).length,
  0,
  "el contrato legacy TrainingCycleSnapshot no debe reaparecer",
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
