import type { ExerciseEntry, ExerciseTemplate, TrainingSession } from "@/lib/progress/types";
import { getCalendarWeekStartDateKey, getSessionEffectiveCalendarWeekStart } from "@/lib/training/cycle-calendar-week";

function sessionOrder(session: TrainingSession): string {
  return `${session.trainedDate}|${session.completedAt ?? session.trainedAt}|${session.id}`;
}

/** The latest complete session represents a routine in each calendar cycle week. */
export function selectFlexibleWeekRepresentatives(
  sessions: readonly TrainingSession[],
  cycleId: string,
): TrainingSession[] {
  const bySlotAndWeek = new Map<string, TrainingSession>();
  for (const session of sessions) {
    if (session.cycleId !== cycleId || !session.cycleDayId || session.status !== "completed" || session.deletedAt) continue;
    const key = `${session.cycleDayId}:${session.weekNumber}`;
    const previous = bySlotAndWeek.get(key);
    if (!previous || sessionOrder(session) > sessionOrder(previous)) bySlotAndWeek.set(key, session);
  }
  return [...bySlotAndWeek.values()];
}

export function selectFlexibleComparisonEntries(input: {
  sessions: readonly TrainingSession[];
  entries: readonly ExerciseEntry[];
  exercises: readonly ExerciseTemplate[];
  routineDays: readonly string[];
  cycleId: string;
}): { entries: ExerciseEntry[]; routineDays: string[] } {
  const representatives = selectFlexibleWeekRepresentatives(input.sessions, input.cycleId);
  const sessionIds = new Set(representatives.map((session) => session.id));
  const completedSlotIds = new Set(representatives.map((session) => session.cycleDayId));
  return {
    entries: input.entries.filter((entry) => Boolean(entry.sessionId && sessionIds.has(entry.sessionId))),
    routineDays: input.routineDays.filter((day) => input.exercises.some((exercise) =>
      exercise.day === day && exercise.cycleDayId && completedSlotIds.has(exercise.cycleDayId))),
  };
}

export function latestFlexibleRoutineSession(
  sessions: readonly TrainingSession[],
  slotId: string | null | undefined,
): TrainingSession | undefined {
  if (!slotId) return undefined;
  return sessions
    .filter((session) => session.cycleDayId === slotId && session.status === "completed" && !session.deletedAt)
    .sort((left, right) => sessionOrder(right).localeCompare(sessionOrder(left)))[0];
}

export function countFlexibleCompletedRoutines(input: {
  sessions: readonly TrainingSession[];
  exercises: readonly ExerciseTemplate[];
  cycleId: string;
  trainedDate: string;
  justCompletedSlotId?: string | null;
}): number {
  const plannedSlotIds = new Set(input.exercises.map((exercise) => exercise.cycleDayId).filter((id): id is string => Boolean(id)));
  const weekStart = getCalendarWeekStartDateKey(input.trainedDate);
  const completedSlotIds = new Set(input.sessions
    .filter((session) => session.cycleId === input.cycleId && session.status === "completed" && !session.deletedAt &&
      getSessionEffectiveCalendarWeekStart(session) === weekStart && session.cycleDayId && plannedSlotIds.has(session.cycleDayId))
    .map((session) => session.cycleDayId));
  if (input.justCompletedSlotId && plannedSlotIds.has(input.justCompletedSlotId)) completedSlotIds.add(input.justCompletedSlotId);
  return completedSlotIds.size;
}
