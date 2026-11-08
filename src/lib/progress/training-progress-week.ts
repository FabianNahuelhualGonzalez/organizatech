import type { ExerciseEntry, TrainingSession } from "@/lib/progress/types";
import { getCalendarWeekStartDateKey } from "@/lib/training/cycle-calendar-week";

const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface TrainingProgressTimeline {
  anchorDate: string | null;
  currentWeek: number;
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
}

/**
 * Progress weeks start with the first real completed workout. Calendar weeks
 * remain untouched in persistence and scheduling; this projection is only for
 * user-facing progress and comparisons.
 */
export function buildTrainingProgressTimeline(input: {
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  referenceDate: string;
  activeCycleId?: string | null;
}): TrainingProgressTimeline {
  const entries = input.entries.filter((entry) => belongsToCycle(entry.cycleId, input.activeCycleId));
  const sessions = input.sessions.filter((session) => belongsToCycle(session.cycleId, input.activeCycleId));
  const completedSessionIds = new Set(
    sessions
      .filter(isRealCompletedSession)
      .map((session) => session.id),
  );
  const realEntryDates = entries
    .filter((entry) => hasRealRepetitions(entry))
    .filter((entry) => !entry.sessionId || completedSessionIds.has(entry.sessionId))
    .map((entry) => entry.date)
    .filter(isDateKey);
  const completedSessionDates = sessions
    .filter(isRealCompletedSession)
    .map((session) => session.trainedDate)
    .filter(isDateKey);
  const anchorDate = [...realEntryDates, ...completedSessionDates].sort()[0] ?? null;

  if (!anchorDate) {
    return { anchorDate: null, currentWeek: 1, entries, sessions };
  }

  const weekForDate = (date: string) => getRelativeProgressWeek(anchorDate, date);
  return {
    anchorDate,
    currentWeek: weekForDate(input.referenceDate),
    entries: entries.map((entry) => ({
      ...entry,
      week: isDateKey(entry.date) ? weekForDate(entry.date) : entry.week,
    })),
    sessions: sessions.map((session) => ({
      ...session,
      weekNumber: isDateKey(session.trainedDate) ? weekForDate(session.trainedDate) : session.weekNumber,
      entries: session.entries.map((entry) => ({
        ...entry,
        week: isDateKey(entry.date) ? weekForDate(entry.date) : entry.week,
      })),
    })),
  };
}

export function getRelativeProgressWeek(anchorDate: string, referenceDate: string) {
  const anchorWeek = Date.parse(`${getCalendarWeekStartDateKey(anchorDate)}T00:00:00.000Z`);
  const referenceWeek = Date.parse(`${getCalendarWeekStartDateKey(referenceDate)}T00:00:00.000Z`);
  return Math.max(1, Math.floor((referenceWeek - anchorWeek) / MILLISECONDS_PER_WEEK) + 1);
}

function belongsToCycle(recordCycleId: string | undefined, activeCycleId: string | null | undefined) {
  return !activeCycleId || recordCycleId === activeCycleId;
}

function isRealCompletedSession(session: TrainingSession) {
  return session.status === "completed" && !session.deletedAt &&
    session.entries.some((entry) => hasRealRepetitions(entry));
}

function hasRealRepetitions(entry: ExerciseEntry) {
  return entry.reps.some((reps) => Number.isFinite(reps) && reps > 0);
}

function isDateKey(value: string): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
