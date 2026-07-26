import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  sortTrainingDaysByWeekOrder,
  TRAINING_DAY_LABELS,
} from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

export interface TrainingTargetSummary {
  totalWeight: number;
  volume: number;
  reps: number;
  exerciseCount: number;
}

export function getCycleObjectiveValue(plan: TrainingPlan) {
  if (plan.cycleType === "macro") return plan.macroObjective;
  if (plan.cycleType === "meso") return plan.mesoObjective;
  if (plan.cycleType === "micro") return plan.microFocus;
  return plan.sessionFocus;
}

export function getCycleDurationValue(plan: TrainingPlan) {
  if (plan.cycleType === "macro") return plan.macroDurationMonths;
  if (plan.cycleType === "meso") return plan.mesoDurationWeeks;
  if (plan.cycleType === "micro") return plan.microDurationWeeks;
  return plan.sessionDurationDays;
}

export function getRoutineDays(exercises: ExerciseTemplate[]) {
  const days = TRAINING_DAY_LABELS.filter((day) =>
    exercises.some((exercise) => (exercise.day ?? "Lunes") === day));
  return days.length > 0 ? days : ["Lunes"];
}

export function getActiveRoutineDays(exercises: ExerciseTemplate[], plan: TrainingPlan) {
  const routineDays = getRoutineDays(exercises);
  const plannedDays = sortTrainingDaysByWeekOrder(
    plan.trainingDays.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
  );
  if (plannedDays.length === 0) return routineDays;

  const activeDays = plannedDays.filter((day) =>
    exercises.some((exercise) => (exercise.day ?? "Lunes") === day));
  const persistedRoutineDays = routineDays.filter((day) => !activeDays.includes(day));
  return sortTrainingDaysByWeekOrder(
    activeDays.length > 0 ? [...activeDays, ...persistedRoutineDays] : routineDays,
  );
}

export function calculateTargetSummary(exercises: ExerciseTemplate[]): TrainingTargetSummary {
  return exercises.reduce(
    (summary, exercise) => {
      const reps = exercise.targetSets * exercise.targetReps;
      return {
        totalWeight: summary.totalWeight + exercise.baseWeight,
        volume: summary.volume + reps * exercise.baseWeight,
        reps: summary.reps + reps,
        exerciseCount: summary.exerciseCount + 1,
      };
    },
    { totalWeight: 0, volume: 0, reps: 0, exerciseCount: 0 },
  );
}
