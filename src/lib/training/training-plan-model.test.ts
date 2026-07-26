import assert from "node:assert/strict";

import { TRAINING_CYCLE_IDS } from "@/lib/training/training-cycle-id";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

function acceptTrainingPlan(plan: TrainingPlan): TrainingPlan {
  return plan;
}

const fixture = acceptTrainingPlan({
  cycleType: "meso",
  macroObjective: "Fuerza",
  macroDurationMonths: 8,
  mesoObjective: "Hipertrofia",
  mesoDurationWeeks: 4,
  microDurationWeeks: 1,
  sessionDurationDays: 1,
  trainingDays: ["Lunes", "Miercoles"],
  microFocus: "Progresion",
  sessionFocus: "Tecnica",
});

assert.deepEqual(fixture, {
  cycleType: "meso",
  macroObjective: "Fuerza",
  macroDurationMonths: 8,
  mesoObjective: "Hipertrofia",
  mesoDurationWeeks: 4,
  microDurationWeeks: 1,
  sessionDurationDays: 1,
  trainingDays: ["Lunes", "Miercoles"],
  microFocus: "Progresion",
  sessionFocus: "Tecnica",
});
assert.ok(Array.isArray(fixture.trainingDays));

const plansForEveryCycleId = TRAINING_CYCLE_IDS.map((cycleType) =>
  acceptTrainingPlan({
    ...fixture,
    cycleType,
    trainingDays: [...fixture.trainingDays],
  }));
assert.deepEqual(
  plansForEveryCycleId.map((plan) => plan.cycleType),
  ["macro", "meso", "micro", "session"],
);

const invalidCycleTypeFixture: TrainingPlan = {
  ...fixture,
  // @ts-expect-error TrainingPlan solo admite los cuatro ids canonicos.
  cycleType: "annual",
};

// @ts-expect-error Todos los campos de TrainingPlan son obligatorios.
const missingRequiredFieldsFixture: TrainingPlan = {
  cycleType: "macro",
};

void invalidCycleTypeFixture;
void missingRequiredFieldsFixture;

console.log("training-plan-model type fixture tests passed");
