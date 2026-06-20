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

export interface WorkoutSaveLock {
  current: boolean;
}

export const noCurrentWorkoutExercisesMessage = "No hay ejercicios actuales para guardar.";
export const incompleteCurrentWorkoutMessage = "Registra todos los ejercicios antes de guardar el entrenamiento.";

export function acquireWorkoutSaveLock(lock: WorkoutSaveLock) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseWorkoutSaveLock(lock: WorkoutSaveLock) {
  lock.current = false;
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
