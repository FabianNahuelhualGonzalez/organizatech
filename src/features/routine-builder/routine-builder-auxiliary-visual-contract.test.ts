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
  successModal: readSource("src/features/routine-builder/components/RoutineSuccessModal.tsx"),
  updateModal: readSource("src/features/routine-builder/components/ConfirmRoutineUpdateModal.tsx"),
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
assert.match(files.successModal, /export interface RoutineSuccessModalProps/);
assert.match(files.successModal, /export function RoutineSuccessModal\(/);
assert.match(files.successModal, /onConfirm: \(\) => void;/);

assert.match(files.updateModal, /export interface ConfirmRoutineUpdateModalProps/);
assert.match(files.updateModal, /export function ConfirmRoutineUpdateModal\(/);
assert.match(files.updateModal, /onCancel: \(\) => void;/);
assert.match(files.updateModal, /onConfirm: \(\) => void;/);

// 3-4. Ausencia de imports prohibidos.
Object.entries(files).forEach(([label, source]) => assertNoForbiddenImports(source, label));

// 5. Clases relevantes preservadas.
assert.match(files.successModal, /className="modal-backdrop"/);
assert.match(files.successModal, /className="card confirm-modal success-modal"/);
assert.match(files.successModal, /className="success-icon"/);
assert.match(files.updateModal, /className="modal-backdrop"/);
assert.match(files.updateModal, /className="card confirm-modal"/);

// 6. ARIA y roles de los modales.
assert.match(files.successModal, /role="dialog"/);
assert.match(files.successModal, /aria-modal="true"/);
assert.match(files.successModal, /aria-label="Registro exitoso"/);
assert.match(files.updateModal, /role="dialog"/);
assert.match(files.updateModal, /aria-modal="true"/);
assert.match(files.updateModal, /aria-label="Confirmar modificacion de rutina"/);

// Copy/textos preservados literalmente, incluyendo variantes de botones (no unificados en
// ConfirmDialog en esta fase, por instrucción explícita del ticket).
assert.match(files.successModal, /Tu rutina quedó guardada correctamente\./);
assert.match(files.successModal, />\s*OK\s*<\/button>/);
assert.match(files.updateModal, /Sí, actualizar rutina/);
assert.doesNotMatch(files.successModal, /ConfirmDialog/, "no debe unificarse en ConfirmDialog en esta fase");
assert.doesNotMatch(files.updateModal, /ConfirmDialog/, "no debe unificarse en ConfirmDialog en esta fase");

// 8. Definiciones originales todavía presentes en el root.
assert.match(appSource, /function RoutineSuccessModal\(/, "el original debe seguir en el root");
assert.match(appSource, /function ConfirmRoutineUpdateModal\(/, "el original debe seguir en el root");

// 9-10. package.json y globals.css sin cambios.
const packageJson = readSource("package.json");
assert.doesNotMatch(
  packageJson,
  /routine-builder-auxiliary-visual-contract\.test\.ts/,
  "este test no debe estar registrado en package.json todavia (se registra en P3-07)",
);
const globalsCss = readSource("src/app/globals.css");
assert.match(globalsCss, /\.success-modal\b/, "la clase de la que depende RoutineSuccessModal debe seguir en globals.css");
assert.match(globalsCss, /\.success-icon\b/, "la clase de la que depende RoutineSuccessModal debe seguir en globals.css");

console.log("routine-builder auxiliary visual contract tests passed");
