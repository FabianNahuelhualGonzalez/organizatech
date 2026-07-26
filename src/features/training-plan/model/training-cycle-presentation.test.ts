import assert from "node:assert/strict";

import { TRAINING_CYCLE_PRESENTATIONS } from "@/features/training-plan/model/training-cycle-presentation";

assert.deepEqual(
  TRAINING_CYCLE_PRESENTATIONS.map(({ id }) => id),
  ["macro", "meso", "micro", "session"],
  "el catálogo visual conserva ids y orden persistidos",
);
assert.deepEqual(
  TRAINING_CYCLE_PRESENTATIONS.map(({ title }) => title),
  ["Macrociclo", "Mesociclo", "Microciclo", "Sesión de entrenamiento"],
);
assert.equal(TRAINING_CYCLE_PRESENTATIONS[0].summary, "Plan grande del objetivo principal.");
assert.match(TRAINING_CYCLE_PRESENTATIONS[3].detail, /Contiene ejercicios, series, repeticiones, pesos/);

console.log("training cycle presentation tests passed");
