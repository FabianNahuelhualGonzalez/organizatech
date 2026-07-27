import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula clicks
 * ni prueba persistencia o repositories.
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const packageSource = readSource("package.json");
const catalogSource = readSource("src/features/training-plan/model/training-cycle-presentation.ts");
const files = {
  cycleManagement: readSource("src/features/training-plan/components/CycleManagementScreen.tsx"),
  planBlocker: readSource("src/features/training-plan/components/CycleScopedPlanBlocker.tsx"),
  deleteModal: readSource("src/features/training-plan/components/ConfirmDeleteCycleModal.tsx"),
  newModal: readSource("src/features/training-plan/components/ConfirmNewCycleModal.tsx"),
  setupCard: readSource("src/features/training-plan/components/TrainingPlanSetupCard.tsx"),
};

const components = [
  ["CycleManagementScreen", "@/features/training-plan/components/CycleManagementScreen"],
  ["CycleScopedPlanBlocker", "@/features/training-plan/components/CycleScopedPlanBlocker"],
  ["ConfirmDeleteCycleModal", "@/features/training-plan/components/ConfirmDeleteCycleModal"],
  ["ConfirmNewCycleModal", "@/features/training-plan/components/ConfirmNewCycleModal"],
  ["TrainingPlanSetupCard", "@/features/training-plan/components/TrainingPlanSetupCard"],
] as const;
for (const [componentName, modulePath] of components) {
  assert.match(appSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.match(appSource, new RegExp(`<${componentName}\\b`));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

for (const source of Object.values(files)) {
  assert.doesNotMatch(source, /from ["']@\/components\/organizatech-app["']/);
  assert.doesNotMatch(source, /from ["']@\/lib\/(?:storage|supabase)\//);
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/);
}

assert.match(files.cycleManagement, /from "@\/lib\/training\/training-plan-calculations"/);
assert.match(files.cycleManagement, /TRAINING_CYCLE_PRESENTATIONS/);
for (const duplicateName of [
  "getCycleObjectiveValue",
  "getCycleDurationValue",
  "getRoutineDays",
  "getActiveRoutineDays",
  "calculateTargetSummary",
]) {
  assert.doesNotMatch(files.cycleManagement, new RegExp(`^\\s*function ${duplicateName}\\b`, "m"));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${duplicateName}\\b`, "m"));
}
assert.doesNotMatch(files.cycleManagement, /^\s*const (?:setupDays|trainingCycles)\b/m);
assert.match(catalogSource, /export const TRAINING_CYCLE_PRESENTATIONS = \[/);
assert.deepEqual(
  [...catalogSource.matchAll(/\bid: "(macro|meso|micro|session)"/g)].map((match) => match[1]),
  ["macro", "meso", "micro", "session"],
);
assert.match(files.cycleManagement, /className="card wide cycle-management-card"/);
assert.match(files.deleteModal, /role="dialog" aria-modal="true" aria-label="Eliminar ciclo actual"/);
assert.match(files.newModal, /role="dialog" aria-modal="true" aria-label="Confirmar nuevo ciclo"/);

// TrainingPlanSetupCard (P3-07C): la card de configuración de ciclo vive en el componente y el
// bloque inline fue eliminado del root. Absorbe la cobertura del contrato de preparación de gap.
assert.doesNotMatch(appSource, /className="setup-card training-cycles-card"/, "el bloque inline debe haberse eliminado del root");
assert.match(files.setupCard, /className="setup-card training-cycles-card"/);
assert.match(files.setupCard, /export interface TrainingPlanSetupCardProps/);
for (const [callback, parameter] of [
  ["onCycleTypeChange", "value"],
  ["onObjectiveChange", "value"],
  ["onDurationChange", "value"],
  ["onToggleTrainingDay", "day"],
] as const) {
  assert.match(files.setupCard, new RegExp(`${callback}: \\(${parameter}: string\\) => void`));
}
assert.match(files.setupCard, /onCycleTypeChange\(event\.target\.value\)/, "el selector emite el string crudo, sin cast");
assert.doesNotMatch(files.setupCard, /as\s+TrainingCycleId/, "el componente no debe castear al tipo de dominio");
// Guard canónico en el root: string → isTrainingCycleId → actualizar plan solo si es válido.
assert.match(appSource, /function updateCycleType\(value: string\) \{\s*\n\s*if \(!isTrainingCycleId\(value\)\) return;\s*\n\s*updateTrainingPlan\(\{ cycleType: value \}\);/);
assert.match(appSource, /onCycleTypeChange=\{updateCycleType\}/);
assert.doesNotMatch(appSource, /event\.target\.value as TrainingCycleId/, "el cast inseguro quedo eliminado del flujo integrado");
// Catálogos canónicos compartidos, sin copias locales en el componente.
assert.match(files.setupCard, /import \{ TRAINING_CYCLE_PRESENTATIONS \} from "@\/features\/training-plan\/model\/training-cycle-presentation";/);
assert.match(files.setupCard, /import \{ TRAINING_DAY_LABELS \} from "@\/lib\/training\/training-day-order";/);
assert.doesNotMatch(files.setupCard, /^\s*const (?:TRAINING_CYCLE_PRESENTATIONS|TRAINING_DAY_LABELS)\b.*=\s*\[/m, "sin arrays equivalentes locales");
// Copy y estructura visual, en el orden original.
[
  "Planificación deportiva",
  "Selecciona tu ciclo de entrenamiento",
  "Ciclo de entrenamiento",
  "¿Cuál es el objetivo principal?",
  "Duración",
  "Selecciona días de entrenamiento",
].reduce((previous, copy) => {
  const copyIndex = files.setupCard.indexOf(copy);
  assert.ok(copyIndex > previous, `copy ausente o fuera de orden: ${copy}`);
  return copyIndex;
}, -1);
for (const className of ["cycle-flow-card", "cycle-select-field", "cycle-select", "cycle-description objective-description", "cycle-chip-grid days"]) {
  assert.ok(files.setupCard.includes(className), `clase visual ausente: ${className}`);
}
assert.match(files.setupCard, /plannedDays\.includes\(item\) \? "active" : ""/);
assert.match(files.setupCard, /activeDay === item \? "current" : ""/);
assert.match(files.setupCard, /configuredDays\.includes\(item\) \? "configured" : ""/);
// Pureza adicional del componente (la genérica ya corre en el loop de files).
assert.doesNotMatch(files.setupCard, /\b(?:useState|useEffect|setScreen|setScreenHistory)\b|from ["']@\/lib\/(?:data|navigation)\//, "TrainingPlanSetupCard es presentacional puro");

const registration = "tsx src/features/training-plan/training-plan-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("training-plan visual static integration contract tests passed");
