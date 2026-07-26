import assert from "node:assert/strict";

import {
  TRAINING_CYCLE_IDS,
  isTrainingCycleId,
} from "@/lib/training/training-cycle-id";

const expectedIds = ["macro", "meso", "micro", "session"] as const;

assert.deepEqual(
  TRAINING_CYCLE_IDS,
  expectedIds,
  "los ids y su orden persistido deben permanecer exactos",
);

for (const cycleId of expectedIds) {
  assert.equal(isTrainingCycleId(cycleId), true, `${cycleId} debe ser valido`);
}

for (const invalidValue of [
  "annual",
  "",
  null,
  undefined,
  0,
  1,
  {},
  { id: "macro" },
  [],
  ["macro"],
]) {
  assert.equal(
    isTrainingCycleId(invalidValue),
    false,
    `${JSON.stringify(invalidValue)} no debe ser un TrainingCycleId`,
  );
}

console.log("training-cycle-id tests passed");
