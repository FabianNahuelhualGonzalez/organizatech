import assert from "node:assert/strict";
import { calculateNextTrainingCycleNumber } from "./training-cycle-number";

assert.equal(
  calculateNextTrainingCycleNumber([{ cycleNumber: 1 }]),
  2,
  "un Ciclo 1 completed debe ser seguido por Ciclo 2",
);

assert.equal(
  calculateNextTrainingCycleNumber([
    { cycleNumber: 1 },
    { cycleNumber: 2 },
  ]),
  3,
  "los Ciclos 1 y 2 deben ser seguidos por Ciclo 3",
);

assert.equal(
  calculateNextTrainingCycleNumber([]),
  1,
  "el primer ciclo debe comenzar en 1",
);

console.log("Pruebas de numeracion de ciclos OK");
