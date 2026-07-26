import assert from "node:assert/strict";

import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  calculateTargetSummary,
  getActiveRoutineDays,
  getCycleDurationValue,
  getCycleObjectiveValue,
  getRoutineDays,
} from "@/lib/training/training-plan-calculations";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

const plan: TrainingPlan = {
  cycleType: "meso",
  macroObjective: "Fuerza",
  macroDurationMonths: 8,
  mesoObjective: "Hipertrofia",
  mesoDurationWeeks: 4,
  microDurationWeeks: 1,
  sessionDurationDays: 1,
  trainingDays: ["Viernes", "Lunes", "Miércoles"],
  microFocus: "Progresión",
  sessionFocus: "Técnica",
};

const exercises: ExerciseTemplate[] = [
  {
    id: "exercise-1",
    name: "Press",
    routine: "Torso",
    day: "Lunes",
    targetSets: 3,
    targetReps: 10,
    baseWeight: 20,
  },
  {
    id: "exercise-2",
    name: "Sentadilla",
    routine: "Piernas",
    day: "Miércoles",
    targetSets: 4,
    targetReps: 8,
    baseWeight: 40,
  },
];

assert.equal(getCycleObjectiveValue(plan), "Hipertrofia");
assert.equal(getCycleDurationValue(plan), 4);
assert.deepEqual(getRoutineDays(exercises), ["Lunes", "Miércoles"]);
assert.deepEqual(getRoutineDays([]), ["Lunes"]);
assert.deepEqual(
  getActiveRoutineDays(exercises, plan),
  ["Lunes", "Miércoles"],
  "los días activos conservan el orden semanal y los días persistidos con ejercicios",
);
assert.deepEqual(calculateTargetSummary(exercises), {
  totalWeight: 60,
  volume: 1880,
  reps: 62,
  exerciseCount: 2,
});

const unchangedPlan = structuredClone(plan);
const unchangedExercises = structuredClone(exercises);
getActiveRoutineDays(exercises, plan);
calculateTargetSummary(exercises);
assert.deepEqual(plan, unchangedPlan, "los cálculos no mutan el plan");
assert.deepEqual(exercises, unchangedExercises, "los cálculos no mutan ejercicios");

console.log("training plan calculations tests passed");
