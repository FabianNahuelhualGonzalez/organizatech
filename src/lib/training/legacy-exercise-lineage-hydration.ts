import type { ExerciseTemplate } from "@/lib/progress/types";

export interface LegacyExerciseLineageRow {
  id: string;
  source_legacy_exercise_id: string | null;
}

export function hydrateLegacyExerciseTemplatesWithLineage(
  exercises: ExerciseTemplate[],
  lineages: LegacyExerciseLineageRow[],
): ExerciseTemplate[] {
  const lineageIdBySourceLegacyExerciseId = new Map<string, string>();
  for (const lineage of lineages) {
    if (!lineage.source_legacy_exercise_id) continue;
    lineageIdBySourceLegacyExerciseId.set(lineage.source_legacy_exercise_id, lineage.id);
  }

  return exercises.map((exercise) => ({
    ...exercise,
    sourceLegacyExerciseId: exercise.id,
    exerciseLineageId: lineageIdBySourceLegacyExerciseId.get(exercise.id) ?? null,
  }));
}
