import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula
 * interacción y no prueba persistencia.
 */
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const successSource = readFileSync("src/features/routine-builder/components/RoutineSuccessModal.tsx", "utf8");
const updateSource = readFileSync("src/features/routine-builder/components/ConfirmRoutineUpdateModal.tsx", "utf8");

for (const [componentName, modulePath] of [
  ["RoutineSuccessModal", "@/features/routine-builder/components/RoutineSuccessModal"],
  ["ConfirmRoutineUpdateModal", "@/features/routine-builder/components/ConfirmRoutineUpdateModal"],
] as const) {
  assert.match(appSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.match(appSource, new RegExp(`<${componentName}\\b`));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

for (const source of [successSource, updateSource]) {
  assert.doesNotMatch(source, /from ["']@\/components\/organizatech-app["']/);
  assert.doesNotMatch(source, /from ["']@\/lib\/(?:storage|supabase)\//);
}
assert.match(successSource, /className="card confirm-modal success-modal"/);
assert.match(successSource, /role="dialog" aria-modal="true" aria-label="Registro exitoso"/);
assert.match(successSource, /Tu rutina quedó guardada correctamente\./);
assert.match(updateSource, /role="dialog" aria-modal="true" aria-label="Confirmar modificacion de rutina"/);
assert.match(updateSource, /Sí, actualizar rutina/);
assert.doesNotMatch(`${successSource}\n${updateSource}`, /ConfirmDialog/);

const registration = "tsx src/features/routine-builder/routine-builder-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("routine-builder visual static integration contract tests passed");
