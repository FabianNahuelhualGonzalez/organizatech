import assert from "node:assert/strict";

import { removeAccents } from "@/lib/training/exercise-name-normalization";

assert.equal(removeAccents("Press banca"), "Press banca");
assert.equal(removeAccents("Miércoles"), "Miercoles");
assert.equal(removeAccents("pingüino"), "pinguino");
assert.equal(removeAccents("jalapeño"), "jalapeno");
assert.equal(removeAccents("ÁRBOL"), "ARBOL");
assert.equal(removeAccents("miercoles"), "miercoles");
assert.equal(removeAccents(""), "");
assert.equal(removeAccents("  Miércoles  "), "  Miercoles  ", "no agrega trim");
assert.equal(
  removeAccents("Extensión de tríceps").toLowerCase(),
  removeAccents("extension de triceps").toLowerCase(),
  "conserva la equivalencia usada para matching",
);

console.log("exercise name normalization tests passed");
