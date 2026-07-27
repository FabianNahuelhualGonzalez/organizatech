import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de preparación visual. No renderiza React, no simula
 * interacciones y no valida persistencia ni comportamiento runtime.
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const componentSource = readSource(
  "src/features/training-plan/components/TrainingPlanSetupCard.tsx",
);
const packageSource = readSource("package.json");

assert.match(componentSource, /export interface TrainingPlanSetupCardProps/);
assert.match(componentSource, /export function TrainingPlanSetupCard\(/);
assert.match(componentSource, /import type \{ TrainingCycleId \}/);
assert.match(componentSource, /TRAINING_CYCLE_PRESENTATIONS/);
assert.match(componentSource, /TRAINING_DAY_LABELS/);

for (const [callback, parameter] of [
  ["onCycleTypeChange", "value"],
  ["onObjectiveChange", "value"],
  ["onDurationChange", "value"],
  ["onToggleTrainingDay", "day"],
] as const) {
  assert.match(componentSource, new RegExp(`${callback}: \\(${parameter}: string\\) => void`));
}

assert.match(componentSource, /onCycleTypeChange\(event\.target\.value\)/);
assert.doesNotMatch(componentSource, /event\.target\.value\s+as\s+TrainingCycleId/);

const orderedCopy = [
  "Planificación deportiva",
  "Selecciona tu ciclo de entrenamiento",
  "Ciclo de entrenamiento",
  "¿Cuál es el objetivo principal?",
  "Duración",
  "Selecciona días de entrenamiento",
];
let previousCopyIndex = -1;
for (const copy of orderedCopy) {
  const copyIndex = componentSource.indexOf(copy);
  assert.ok(copyIndex > previousCopyIndex, `copy ausente o fuera de orden: ${copy}`);
  previousCopyIndex = copyIndex;
}

for (const className of [
  "setup-card training-cycles-card",
  "setup-section-heading",
  "cycle-flow-card",
  "cycle-select-field",
  "cycle-select",
  "cycle-description",
  "cycle-description objective-description",
  "cycle-chip-grid days",
]) {
  assert.ok(componentSource.includes(className), `clase visual ausente: ${className}`);
}
assert.match(componentSource, /type="button"/);
assert.match(componentSource, /plannedDays\.includes\(item\)/);
assert.match(componentSource, /activeDay === item/);
assert.match(componentSource, /configuredDays\.includes\(item\)/);

for (const forbidden of [
  /from ["']@\/components\/organizatech-app["']/,
  /from ["']@\/lib\/(?:data|storage|supabase)\//,
  /from ["']@\/lib\/navigation\//,
  /\b(?:window|document|localStorage|sessionStorage)\b/,
  /\b(?:setScreen|saveTrainingPlan|loadTrainingPlan)\b/,
  /\b(?:CycleManagementScreen|CycleScopedPlanBlocker|ConfirmDeleteCycleModal|ConfirmNewCycleModal)\b/,
]) {
  assert.doesNotMatch(componentSource, forbidden);
}

// La preparación conserva temporalmente el bloque productivo en el root.
assert.doesNotMatch(appSource, /from ["']@\/features\/training-plan\/components\/TrainingPlanSetupCard["']/);
assert.match(appSource, /function InitialTrainingScreen\(/);
assert.match(appSource, /className="setup-card training-cycles-card"/);
assert.match(appSource, /event\.target\.value as TrainingCycleId/);

const directRegistration = "tsx src/features/training-plan/training-plan-visual-gap-preparation-contract.test.ts";
assert.equal(packageSource.split(directRegistration).length - 1, 0);

console.log("training-plan visual gap static preparation contract tests passed");
