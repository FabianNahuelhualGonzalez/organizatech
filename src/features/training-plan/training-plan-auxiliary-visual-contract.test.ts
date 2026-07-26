import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de preparación visual (P3-06). No renderiza React, no simula clicks, no
 * prueba el DOM real, no prueba persistencia. Solo inspecciona texto fuente.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");

const files = {
  cycleManagement: readSource("src/features/training-plan/components/CycleManagementScreen.tsx"),
  planBlocker: readSource("src/features/training-plan/components/CycleScopedPlanBlocker.tsx"),
  deleteModal: readSource("src/features/training-plan/components/ConfirmDeleteCycleModal.tsx"),
  newModal: readSource("src/features/training-plan/components/ConfirmNewCycleModal.tsx"),
};

// Solo inspecciona las rutas literales de los import (no la prosa de los comentarios, que
// legítimamente puede citar "organizatech-app.tsx:NNNN" como referencia de procedencia).
function assertNoForbiddenImports(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: import prohibido de organizatech-app.tsx (${path})`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: import prohibido de storage (${path})`);
    assert.doesNotMatch(path, /supabase/i, `${label}: import prohibido de Supabase (${path})`);
    assert.doesNotMatch(path, /-repository$/, `${label}: import prohibido de repositories (${path})`);
  });
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/, `${label} no debe acceder a window ni document`);
}

// 1-2. Componentes exportados y props principales.
assert.match(files.cycleManagement, /export interface CycleManagementScreenProps/);
assert.match(files.cycleManagement, /export function CycleManagementScreen\(/);
assert.match(files.cycleManagement, /trainingPlan: TrainingPlan;/);
assert.match(files.cycleManagement, /activeCycleName\?: string;/);
assert.match(files.cycleManagement, /editCurrentCycle: \(\) => void;/);
assert.match(files.cycleManagement, /requestNewCycle: \(\) => void;/);
assert.match(files.cycleManagement, /requestDeleteCycle: \(\) => void;/);

assert.match(files.planBlocker, /export interface CycleScopedPlanBlockerProps/);
assert.match(files.planBlocker, /export function CycleScopedPlanBlocker\(/);
assert.match(files.planBlocker, /message: string;/);

assert.match(files.deleteModal, /export interface ConfirmDeleteCycleModalProps/);
assert.match(files.deleteModal, /export function ConfirmDeleteCycleModal\(/);
assert.match(files.deleteModal, /isBusy: boolean;/);

assert.match(files.newModal, /export interface ConfirmNewCycleModalProps/);
assert.match(files.newModal, /export function ConfirmNewCycleModal\(/);
assert.match(files.newModal, /isBusy: boolean;/);

// 3-4. Ausencia de imports prohibidos.
Object.entries(files).forEach(([label, source]) => assertNoForbiddenImports(source, label));

// 5. Clases relevantes preservadas.
assert.match(files.cycleManagement, /className="card wide cycle-management-card"/);
assert.match(files.cycleManagement, /className="cycle-summary-line"/);
assert.match(files.cycleManagement, /className="card wide new-cycle-card"/);
assert.match(files.planBlocker, /className="card wide cycle-management-card"/);
assert.match(files.deleteModal, /className="modal-backdrop"/);
assert.match(files.newModal, /className="modal-backdrop"/);

// 6. ARIA y roles de los modales.
assert.match(files.deleteModal, /role="dialog"/);
assert.match(files.deleteModal, /aria-modal="true"/);
assert.match(files.deleteModal, /aria-label="Eliminar ciclo actual"/);
assert.match(files.newModal, /role="dialog"/);
assert.match(files.newModal, /aria-modal="true"/);
assert.match(files.newModal, /aria-label="Confirmar nuevo ciclo"/);

// Copy/textos preservados literalmente.
assert.match(files.cycleManagement, /Modificar ciclo actual/);
assert.match(files.cycleManagement, /Eliminar ciclo/);
assert.match(files.planBlocker, /Plan operativo no disponible/);
assert.match(files.deleteModal, /¿Eliminar ciclo actual\?/);
assert.match(files.deleteModal, /Esta acción no se puede deshacer desde la aplicación\./);
assert.match(files.newModal, /¿Estas seguro\?/);

// 8. Definiciones originales todavía presentes en el root.
assert.match(appSource, /function CycleManagementScreen\(/, "el original debe seguir en el root");
assert.match(appSource, /function CycleScopedPlanBlocker\(/, "el original debe seguir en el root");
assert.match(appSource, /function ConfirmDeleteCycleModal\(/, "el original debe seguir en el root");
assert.match(appSource, /function ConfirmNewCycleModal\(/, "el original debe seguir en el root");

// 9-10. package.json y globals.css sin cambios.
const packageJson = readSource("package.json");
assert.doesNotMatch(
  packageJson,
  /training-plan-auxiliary-visual-contract\.test\.ts/,
  "este test no debe estar registrado en package.json todavia (se registra en P3-07)",
);
const globalsCss = readSource("src/app/globals.css");
assert.match(globalsCss, /\.cycle-management-card\b/, "la clase de la que depende CycleManagementScreen debe seguir en globals.css");
assert.match(globalsCss, /\.modal-backdrop\b/, "la clase de la que dependen los modales debe seguir en globals.css");
assert.match(globalsCss, /\.confirm-modal\b/, "la clase de la que dependen los modales debe seguir en globals.css");

console.log("training-plan auxiliary visual contract tests passed");
