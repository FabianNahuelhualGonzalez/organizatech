import type { ExerciseEntry } from "@/lib/progress/types";

export interface ExistingCycleScopedExercise {
  id: string;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
}

export interface CycleScopedExerciseDraft {
  sourceExerciseId?: string;
  name: string;
  sets: number;
  reps: number;
  weight: number;
}

export interface CycleScopedExerciseAddition {
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
}

export type CycleScopedDayStatus = "pending" | "partial" | "completed";

export function analyzeCycleScopedDayEdit(
  existingExercises: ExistingCycleScopedExercise[],
  draftRows: CycleScopedExerciseDraft[],
  registeredExerciseIds: ReadonlySet<string>,
) {
  const existingById = new Map(existingExercises.map((exercise) => [exercise.id, exercise]));
  const existingNames = new Set(existingExercises.map((exercise) => normalizeCycleScopedExerciseName(exercise.name)));
  const retainedIds = new Set(
    draftRows
      .map((row) => row.sourceExerciseId)
      .filter((id): id is string => Boolean(id)),
  );
  const additions: CycleScopedExerciseAddition[] = [];
  const duplicateNames: string[] = [];
  const modifiedExerciseIds: string[] = [];
  const candidateNames = new Set<string>();

  for (const row of draftRows) {
    const normalizedName = normalizeCycleScopedExerciseName(row.name);
    if (!normalizedName) continue;

    if (row.sourceExerciseId) {
      const existing = existingById.get(row.sourceExerciseId);
      if (
        !existing ||
        normalizeCycleScopedExerciseName(existing.name) !== normalizedName ||
        existing.targetSets !== row.sets ||
        existing.targetReps !== row.reps ||
        existing.baseWeight !== row.weight
      ) {
        modifiedExerciseIds.push(row.sourceExerciseId);
      }
      continue;
    }

    if (existingNames.has(normalizedName) || candidateNames.has(normalizedName)) {
      duplicateNames.push(row.name.trim());
      continue;
    }

    candidateNames.add(normalizedName);
    additions.push({
      name: row.name.trim(),
      targetSets: Math.max(1, row.sets || 1),
      targetReps: Math.max(1, row.reps || 1),
      baseWeight: Math.max(0, row.weight || 0),
    });
  }

  const removedExerciseIds = existingExercises
    .filter((exercise) => !retainedIds.has(exercise.id))
    .map((exercise) => exercise.id);
  const removedRegisteredExerciseIds = removedExerciseIds.filter((id) => registeredExerciseIds.has(id));

  return {
    additions,
    duplicateNames,
    modifiedExerciseIds,
    removedExerciseIds,
    removedRegisteredExerciseIds,
  };
}

export function getCycleScopedDayCoverage(
  plannedExercises: Array<{ id: string }>,
  entries: Array<Pick<ExerciseEntry, "trainingCycleExerciseId" | "exerciseId">>,
) {
  const plannedIds = new Set(plannedExercises.map((exercise) => exercise.id));
  const registeredIds = new Set(
    entries
      .map((entry) => entry.trainingCycleExerciseId ?? entry.exerciseId)
      .filter((id) => plannedIds.has(id)),
  );
  const plannedCount = plannedIds.size;
  const registeredCount = registeredIds.size;
  const status: CycleScopedDayStatus = registeredCount === 0
    ? "pending"
    : registeredCount === plannedCount
      ? "completed"
      : "partial";

  return {
    plannedCount,
    registeredCount,
    registeredIds,
    status,
  };
}

export function normalizeCycleScopedExerciseName(value: string) {
  return value.trim().toLocaleLowerCase("es");
}
