import type {
  ExerciseEntry,
  ExerciseTemplate,
  TrainingDayCode,
  TrainingSession,
} from "@/lib/progress/types";
import { normalizeEntryDateKey } from "@/lib/training/santiago-training-date";

export function findDashboardSessionForDay(
  sessions: TrainingSession[],
  dayExercises: ExerciseTemplate[],
  expectedDate: string,
  plannedDay: TrainingDayCode,
  usesCycleScopedSessions: boolean,
) {
  return sessions.find((candidate) => {
    if (!usesCycleScopedSessions) {
      return candidate.plannedDate === expectedDate || candidate.plannedDay === plannedDay;
    }

    const candidateEntries = findDashboardEntries(candidate.entries, dayExercises, expectedDate, true);
    if (candidateEntries.length > 0) return true;

    const cycleDayIds = new Set(dayExercises.map((exercise) => exercise.cycleDayId).filter(Boolean));
    return Boolean(candidate.cycleDayId && cycleDayIds.has(candidate.cycleDayId)) || candidate.plannedDay === plannedDay;
  });
}

export function findDashboardEntries(
  entries: ExerciseEntry[],
  dayExercises: ExerciseTemplate[],
  expectedDate: string,
  usesCycleScopedSessions: boolean,
) {
  if (!expectedDate || dayExercises.length === 0) return [];
  const dayExerciseIds = new Set(dayExercises.map((exercise) => getDashboardExerciseIdentity(exercise, usesCycleScopedSessions)));
  const shouldMatchEntryDate = !usesCycleScopedSessions;
  return entries.filter((entry) => (
    (!shouldMatchEntryDate || normalizeEntryDateKey(entry.date) === expectedDate) &&
    dayExerciseIds.has(getDashboardEntryExerciseIdentity(entry, usesCycleScopedSessions))
  ));
}

export function getDashboardExerciseIdentity(exercise: ExerciseTemplate, usesCycleScopedSessions: boolean) {
  return usesCycleScopedSessions ? exercise.trainingCycleExerciseId ?? exercise.id : exercise.id;
}

export function getDashboardEntryExerciseIdentity(entry: ExerciseEntry, usesCycleScopedSessions: boolean) {
  return usesCycleScopedSessions ? entry.trainingCycleExerciseId ?? entry.exerciseId : entry.exerciseId;
}
