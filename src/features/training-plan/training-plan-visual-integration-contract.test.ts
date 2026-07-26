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
};

const components = [
  ["CycleManagementScreen", "@/features/training-plan/components/CycleManagementScreen"],
  ["CycleScopedPlanBlocker", "@/features/training-plan/components/CycleScopedPlanBlocker"],
  ["ConfirmDeleteCycleModal", "@/features/training-plan/components/ConfirmDeleteCycleModal"],
  ["ConfirmNewCycleModal", "@/features/training-plan/components/ConfirmNewCycleModal"],
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

const registration = "tsx src/features/training-plan/training-plan-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("training-plan visual static integration contract tests passed");
