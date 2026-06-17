export interface ExerciseLineageCarrier {
  id?: string | null;
  exerciseLineageId?: string | null;
  sourceLegacyExerciseId?: string | null;
}

export interface ExerciseLineageInsertInput {
  userId: string;
  sourceLegacyExerciseId?: string | null;
}

export function normalizeExerciseLineageId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveExerciseLineageId(
  exercise: ExerciseLineageCarrier | null | undefined,
) {
  return normalizeExerciseLineageId(exercise?.exerciseLineageId);
}

export function resolveExerciseLineageIdForReplacement(
  previousExercise: ExerciseLineageCarrier | null | undefined,
) {
  return resolveExerciseLineageId(previousExercise);
}

export function resolveExerciseLineageIdForSessionEntry(
  exercise: ExerciseLineageCarrier | null | undefined,
) {
  return resolveExerciseLineageId(exercise);
}

export function createExerciseLineageInsertPayload(input: ExerciseLineageInsertInput) {
  return {
    user_id: input.userId,
    source_legacy_exercise_id: input.sourceLegacyExerciseId ?? null,
    origin_kind: input.sourceLegacyExerciseId ? "legacy" : "scoped",
  };
}

export function shouldCreateExerciseLineage(exercise: ExerciseLineageCarrier | null | undefined) {
  return !resolveExerciseLineageId(exercise);
}
