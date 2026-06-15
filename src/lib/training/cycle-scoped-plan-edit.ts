import type { ExerciseEntry, TrainingDayCode } from "@/lib/progress/types";

export interface ExistingCycleScopedExercise {
  id: string;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  sortOrder: number;
  notes?: string | null;
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

export interface CycleScopedExercisePlanPayload extends CycleScopedExerciseAddition {
  sortOrder: number;
  notes?: string | null;
}

export interface CycleScopedExerciseUpdate extends CycleScopedExercisePlanPayload {
  exerciseId: string;
}

export interface CycleScopedExerciseReplacement extends CycleScopedExercisePlanPayload {
  previousExerciseId: string;
}

export type CycleScopedDayStatus = "pending" | "partial" | "completed";

const trainingDayCodeOrder: TrainingDayCode[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const cycleScopedRoutineNameNoteKey = "cycleScopedRoutineName";
export const futurePlanRetiredMarker = "[organizatech:future-plan-retired]";

export function analyzeCycleScopedDayEdit(
  existingExercises: ExistingCycleScopedExercise[],
  draftRows: CycleScopedExerciseDraft[],
  registeredExerciseIds: ReadonlySet<string>,
) {
  const existingById = new Map(existingExercises.map((exercise) => [exercise.id, exercise]));
  const retainedIds = new Set(
    draftRows
      .map((row) => row.sourceExerciseId)
      .filter((id): id is string => Boolean(id)),
  );
  const additions: CycleScopedExerciseAddition[] = [];
  const updates: CycleScopedExerciseUpdate[] = [];
  const replacements: CycleScopedExerciseReplacement[] = [];
  const pendingDeletes: string[] = [];
  const registeredRetirements: string[] = [];
  const duplicateNames: string[] = [];
  const unknownExerciseIds: string[] = [];
  const candidateNames = new Set<string>();

  for (const row of draftRows) {
    const normalizedName = normalizeCycleScopedExerciseName(row.name);
    if (!normalizedName) continue;

    if (candidateNames.has(normalizedName)) {
      duplicateNames.push(row.name.trim());
      continue;
    }
    candidateNames.add(normalizedName);

    if (row.sourceExerciseId) {
      const existing = existingById.get(row.sourceExerciseId);
      if (!existing) {
        unknownExerciseIds.push(row.sourceExerciseId);
        continue;
      }

      const payload = toCycleScopedExercisePlanPayload(row, existing.sortOrder, existing.notes);
      if (
        normalizeCycleScopedExerciseName(existing.name) !== normalizedName ||
        existing.targetSets !== row.sets ||
        existing.targetReps !== row.reps ||
        existing.baseWeight !== row.weight
      ) {
        if (registeredExerciseIds.has(row.sourceExerciseId)) {
          replacements.push({
            previousExerciseId: row.sourceExerciseId,
            ...payload,
          });
        } else {
          updates.push({
            exerciseId: row.sourceExerciseId,
            ...payload,
          });
        }
      }
      continue;
    }

    additions.push(toCycleScopedExercisePlanPayload(row, -1));
  }

  const removedExerciseIds = existingExercises
    .filter((exercise) => !retainedIds.has(exercise.id))
    .map((exercise) => exercise.id);
  for (const exerciseId of removedExerciseIds) {
    if (registeredExerciseIds.has(exerciseId)) registeredRetirements.push(exerciseId);
    else pendingDeletes.push(exerciseId);
  }

  return {
    additions,
    updates,
    replacements,
    pendingDeletes,
    registeredRetirements,
    duplicateNames,
    unknownExerciseIds,
    removedExerciseIds,
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

export function getCycleScopedDayCodesToAdd(
  existingDayCodes: readonly TrainingDayCode[],
  requestedDayCodes: readonly TrainingDayCode[],
) {
  const existing = new Set(existingDayCodes);
  const requested = new Set(requestedDayCodes);
  return trainingDayCodeOrder.filter((dayCode) => requested.has(dayCode) && !existing.has(dayCode));
}

export function createCycleScopedDayNotes(routineName: string) {
  return JSON.stringify({
    [cycleScopedRoutineNameNoteKey]: routineName.trim(),
  });
}

export function getCycleScopedDayRoutineName(notes: string | null, fallback: string) {
  if (!notes) return fallback;

  try {
    const parsed = JSON.parse(notes) as Record<string, unknown>;
    const routineName = parsed[cycleScopedRoutineNameNoteKey];
    return typeof routineName === "string" && routineName.trim() ? routineName.trim() : fallback;
  } catch {
    return fallback;
  }
}

export function addFuturePlanRetiredMarker(notes: string | null) {
  const visibleNotes = removeTechnicalMarkersForDisplay(notes);
  return visibleNotes ? `${visibleNotes}\n${futurePlanRetiredMarker}` : futurePlanRetiredMarker;
}

export function hasFuturePlanRetiredMarker(notes: string | null) {
  if (!notes) return false;
  return notes.split(/\r?\n/).some((line) => line.trim() === futurePlanRetiredMarker);
}

export function createCycleScopedRetiredExerciseNotes(notes: string | null, _retiredAt: string) {
  return addFuturePlanRetiredMarker(notes);
}

export function isCycleScopedExerciseRetired(notes: string | null) {
  return hasFuturePlanRetiredMarker(notes);
}

export function removeTechnicalMarkersForDisplay(notes: string | null) {
  if (!notes) return null;
  const visibleNotes = notes
    .split(/\r?\n/)
    .filter((line) => line.trim() !== futurePlanRetiredMarker)
    .join("\n")
    .trimEnd();

  return visibleNotes || null;
}

export function getCycleScopedExerciseDisplayNotes(notes: string | null) {
  return removeTechnicalMarkersForDisplay(notes);
}

export function normalizeCycleScopedExerciseName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function toCycleScopedExercisePlanPayload(
  row: CycleScopedExerciseDraft,
  sortOrder: number,
  notes?: string | null,
): CycleScopedExercisePlanPayload {
  return {
    name: row.name.trim(),
    targetSets: Math.max(1, row.sets || 1),
    targetReps: Math.max(1, row.reps || 1),
    baseWeight: Math.max(0, row.weight || 0),
    sortOrder,
    notes,
  };
}
