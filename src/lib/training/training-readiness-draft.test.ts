import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeTrainingReadiness,
  type TrainingReadiness,
} from "@/lib/training/training-readiness-draft";

/**
 * Paridad estructural de `TrainingReadiness` (estado/borrador de interfaz) contra la definición
 * original hoy local a `organizatech-app.tsx`. No agrega campos, no quita campos, no cambia
 * opcionalidad ni tipos primitivos, no toca `skipped`.
 */

// CASO 1 — Fixture completo válido: los cuatro puntajes presentes, skipped false.
const fullFixture: TrainingReadiness = {
  motivation: 6,
  hydration: 5,
  sleep: 4,
  energy: 7,
  skipped: false,
};

// CASO 2 — Fixture skipped: ningún puntaje, solo skipped true.
const skippedFixture: TrainingReadiness = {
  skipped: true,
};

// CASO 3 — Fixture parcial válido: algunos puntajes presentes, otros ausentes, skipped false.
// Todos los campos de puntaje son opcionales de forma independiente entre sí.
const partialFixture: TrainingReadiness = {
  motivation: 3,
  skipped: false,
};

// CASO 4 — Aserciones runtime sobre los valores (los fixtures preservan exactamente lo asignado).
// Nota: las verificaciones por campo van antes de deepEqual porque node:assert/strict tipa
// equal/deepEqual como funciones de aserción (`asserts actual is T`), que de lo contrario
// angostarian el tipo estatico del fixture para el resto del alcance.
assert.equal(fullFixture.motivation, 6);
assert.equal(fullFixture.hydration, 5);
assert.equal(fullFixture.sleep, 4);
assert.equal(fullFixture.energy, 7);
assert.equal(fullFixture.skipped, false);
assert.deepEqual(fullFixture, { motivation: 6, hydration: 5, sleep: 4, energy: 7, skipped: false });

assert.equal(skippedFixture.motivation, undefined, "skipped no trae puntajes");
assert.equal(skippedFixture.hydration, undefined);
assert.equal(skippedFixture.sleep, undefined);
assert.equal(skippedFixture.energy, undefined);
assert.equal(skippedFixture.skipped, true);
assert.deepEqual(skippedFixture, { skipped: true });

assert.equal(partialFixture.motivation, 3);
assert.equal(partialFixture.hydration, undefined, "un campo de puntaje puede estar ausente sin afectar a los demas");
assert.equal(partialFixture.sleep, undefined);
assert.equal(partialFixture.energy, undefined);
assert.deepEqual(partialFixture, { motivation: 3, skipped: false });

// CASO 5 — Aserciones de TypeScript: deben fallar en typecheck si el shape cambia.
// @ts-expect-error skipped es obligatorio; no puede omitirse.
const missingSkipped: TrainingReadiness = { motivation: 5 };
// @ts-expect-error skipped debe ser boolean, no string.
const wrongSkippedType: TrainingReadiness = { skipped: "true" };
// @ts-expect-error motivation debe ser number | undefined, no string.
const wrongMotivationType: TrainingReadiness = { skipped: false, motivation: "5" };
// @ts-expect-error hydration debe ser number | undefined, no boolean.
const wrongHydrationType: TrainingReadiness = { skipped: false, hydration: true };
// @ts-expect-error un campo ajeno al shape actual no debe aceptarse (excess property check).
const unexpectedExtraField: TrainingReadiness = { skipped: false, mood: "great" };
void [missingSkipped, wrongSkippedType, wrongMotivationType, wrongHydrationType, unexpectedExtraField];

// CASO 6 — Normalizacion runtime pura con el mismo rango productivo 1..7.
{
  const input = {
    motivation: "7",
    hydration: 0,
    sleep: 4.5,
    energy: 3,
    skipped: "yes",
  };
  const original = structuredClone(input);
  const normalized = normalizeTrainingReadiness(input);

  assert.deepEqual(normalized, {
    motivation: 7,
    hydration: undefined,
    sleep: undefined,
    energy: 3,
    skipped: true,
  });
  assert.deepEqual(input, original, "normalizeTrainingReadiness no muta su entrada");
  assert.notEqual(normalized, normalizeTrainingReadiness(input), "cada llamada entrega un objeto independiente");
  assert.deepEqual(normalizeTrainingReadiness(input), normalized, "la normalizacion es determinista");
  assert.equal(normalizeTrainingReadiness(null), null);
  assert.equal(normalizeTrainingReadiness(undefined), null);
  assert.equal(normalizeTrainingReadiness("invalid"), null);
}

// CASO 7 — Separacion respecto de TrainingDailyReadinessPayload: comprobacion estructural
// estatica y honesta, sin ejercer asignabilidad de TypeScript entre ambos tipos (eso creaba un
// contrato de compilacion indebido entre dos modulos que deben poder evolucionar por separado).
// Esta seccion NO demuestra equivalencia en tiempo de ejecucion entre ambos contratos, NO exige
// que evolucionen juntos, y UNICAMENTE verifica que `TrainingReadiness` sigue declarado de forma
// independiente (sin import, sin `extends`, sin alias hacia `TrainingDailyReadinessPayload`). El
// comentario documental del modulo puede mencionar ese nombre en prosa; por eso esta comprobacion
// inspecciona imports/extends/alias reales via regex, no la ausencia total de la cadena en el
// archivo.
{
  const moduleSource = readFileSync("src/lib/training/training-readiness-draft.ts", "utf8");

  assert.doesNotMatch(
    moduleSource,
    /import[^;]*TrainingDailyReadinessPayload[^;]*;/,
    "training-readiness-draft.ts no debe importar TrainingDailyReadinessPayload",
  );
  assert.doesNotMatch(
    moduleSource,
    /interface\s+TrainingReadiness\s+extends\s+TrainingDailyReadinessPayload/,
    "TrainingReadiness no debe extender TrainingDailyReadinessPayload",
  );
  assert.doesNotMatch(
    moduleSource,
    /type\s+TrainingReadiness\s*=\s*TrainingDailyReadinessPayload\b/,
    "TrainingReadiness no debe declararse como alias de TrainingDailyReadinessPayload",
  );
  assert.match(
    moduleSource,
    /export\s+interface\s+TrainingReadiness\s*\{/,
    "TrainingReadiness debe seguir siendo una interfaz propia, declarada de forma independiente",
  );
}

console.log("training-readiness-draft tests passed");
