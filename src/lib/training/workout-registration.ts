import { parseDecimalWeightInput } from "@/lib/progress/weight-format";
import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  normalizeExerciseDraft,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";

export interface WorkoutRegistrationExercise {
  id: string;
  trainingCycleExerciseId?: string | null;
}

export interface WorkoutRegistrationDraft {
  registered?: boolean;
}

export interface WorkoutSavePlan<TExercise extends WorkoutRegistrationExercise> {
  exercisesToRegister: TExercise[];
  validExercises: TExercise[];
  canSave: boolean;
  message: string | null;
}

export type CurrentExerciseRegistrationDecision =
  | { kind: "busy" }
  | { kind: "missing_exercise" }
  | { kind: "already_registered_advance"; nextExerciseIndex: number }
  | { kind: "already_registered_complete" }
  | { kind: "invalid_draft"; message: string }
  | {
    kind: "register";
    exercise: ExerciseTemplate;
    draft: ExerciseDraft;
    nextExerciseIndex: number;
  };

export const noCurrentWorkoutExercisesMessage = "No hay ejercicios actuales para guardar.";
export const incompleteCurrentWorkoutMessage = "Registra todos los ejercicios antes de guardar el entrenamiento.";
export const incompleteCurrentExerciseMessage = "Completa peso y series antes de registrar el ejercicio.";

export function resolveCurrentExerciseRegistration(input: {
  isBusy: boolean;
  exercises: readonly ExerciseTemplate[];
  activeExerciseIndex: number;
  drafts: Record<string, ExerciseDraft | undefined>;
}): CurrentExerciseRegistrationDecision {
  if (input.isBusy) return { kind: "busy" };

  const exercise = input.exercises[input.activeExerciseIndex];
  if (!exercise) return { kind: "missing_exercise" };

  if (isExerciseRegisteredInCurrentWorkout(exercise, input.drafts)) {
    const nextExerciseIndex = input.exercises.findIndex((item, index) =>
      index > input.activeExerciseIndex &&
      !isExerciseRegisteredInCurrentWorkout(item, input.drafts));
    return nextExerciseIndex >= 0
      ? { kind: "already_registered_advance", nextExerciseIndex }
      : { kind: "already_registered_complete" };
  }

  const draft = normalizeExerciseDraft(exercise, input.drafts[exercise.id]);
  const requiredReps = draft.reps.slice(0, exercise.targetSets);
  const invalidDraft = draft.weight.trim() === "" ||
    parseDecimalWeightInput(draft.weight) === null ||
    requiredReps.some((value) => value === "");
  if (invalidDraft) {
    return { kind: "invalid_draft", message: incompleteCurrentExerciseMessage };
  }

  return {
    kind: "register",
    exercise,
    draft: { ...draft, registered: true },
    nextExerciseIndex: Math.min(
      input.activeExerciseIndex + 1,
      Math.max(0, input.exercises.length - 1),
    ),
  };
}

export function isExerciseRegisteredInCurrentWorkout<TExercise extends WorkoutRegistrationExercise>(
  exercise: TExercise,
  drafts: Record<string, WorkoutRegistrationDraft | undefined>,
) {
  return Boolean(drafts[exercise.id]?.registered);
}

export function getCurrentWorkoutRegisteredExerciseIds<TExercise extends WorkoutRegistrationExercise>(
  exercises: readonly TExercise[],
  drafts: Record<string, WorkoutRegistrationDraft | undefined>,
) {
  return new Set(
    exercises
      .filter((exercise) => isExerciseRegisteredInCurrentWorkout(exercise, drafts))
      .map((exercise) => exercise.id),
  );
}

export function buildCurrentWorkoutSavePlan<TExercise extends WorkoutRegistrationExercise>(
  exercises: readonly TExercise[],
  drafts: Record<string, WorkoutRegistrationDraft | undefined>,
): WorkoutSavePlan<TExercise> {
  const exercisesToRegister = [...exercises];
  const validExercises = exercisesToRegister.filter((exercise) =>
    isExerciseRegisteredInCurrentWorkout(exercise, drafts));

  if (exercisesToRegister.length === 0) {
    return {
      exercisesToRegister,
      validExercises,
      canSave: false,
      message: noCurrentWorkoutExercisesMessage,
    };
  }

  if (validExercises.length !== exercisesToRegister.length) {
    return {
      exercisesToRegister,
      validExercises,
      canSave: false,
      message: incompleteCurrentWorkoutMessage,
    };
  }

  return {
    exercisesToRegister,
    validExercises,
    canSave: true,
    message: null,
  };
}
