import type { TrainingDayCode } from "@/lib/progress/types";

export interface CoachCycleMetricPlan {
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  /** Canonical day codes, at most seven distinct days; null means unknown. */
  readonly selectedDays: readonly TrainingDayCode[] | null;
}

export interface CoachCycleProgress {
  readonly completedSessions: number | null;
  readonly plannedSessions: number | null;
  /** Mathematical progress, possibly >1 with extra sessions; never a probability. */
  readonly progressRatio: number | null;
}

export type CoachTenureEpisode =
  | { readonly state: "active"; readonly startedOn: string | null; readonly endedOn: null }
  | { readonly state: "ended"; readonly startedOn: string | null; readonly endedOn: string | null };

// Same Monday-first TrainingDayCode convention as lib/training/cycle-calendar-week.
const WEEKDAYS: readonly TrainingDayCode[] = Object.freeze([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/**
 * Strict Gregorian ordinal (0001-01-01 = 1), without a clock or timezone conversion.
 * The lib training helpers keep their date parser private and do not support years
 * 0001–0099; importing another feature's parser would cross the feature boundary.
 * See coach-cycle-metrics.md for the inspected conventions and bounded arithmetic.
 */
function civilOrdinal(value: string | null): number | null {
  if (typeof value !== "string" || value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leap ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (day < 1 || day > daysInMonth) return null;
  const yearBefore = year - 1;
  const beforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][month - 1];
  return 365 * yearBefore + Math.floor(yearBefore / 4) - Math.floor(yearBefore / 100)
    + Math.floor(yearBefore / 400) + beforeMonth + (leap && month > 2 ? 1 : 0) + day;
}

function plannedSessionCount(plan: CoachCycleMetricPlan | null): number | null {
  if (!plan || typeof plan !== "object") return null;
  const start = civilOrdinal(plan.startsOn);
  const end = civilOrdinal(plan.endsOn);
  const days = plan.selectedDays;
  if (start === null || end === null || end < start || !Array.isArray(days)
    || days.length > 7 || new Set(days).size !== days.length) return null;
  for (const day of days) if (!WEEKDAYS.includes(day)) return null;
  const duration = end - start + 1;
  const completeWeeks = Math.floor(duration / 7);
  const remainingDays = duration % 7;
  const startWeekday = (start - 1) % 7;
  // No date-by-date allocation/loop: work is bounded by seven selected weekdays.
  return days.reduce((total, day) => {
    const offset = (WEEKDAYS.indexOf(day) - startWeekday + 7) % 7;
    return total + completeWeeks + (offset < remainingDays ? 1 : 0);
  }, 0);
}

/**
 * Source for CoachClientRowView.progressRatio and the renewal detail's cycle facts.
 * completedSessions is the complete, deduplicated count for the authorized cycle,
 * supplied by its data source. This function does not match actual workout dates to
 * planned weekdays, so moving an execution day never subtracts a completed session.
 * The denominator includes the entire plan, not only days elapsed. No current date,
 * missed-session percentage, predicted finish, ownership or payment is inferred.
 */
export function calculateCoachCycleProgress(input: {
  readonly plan: CoachCycleMetricPlan | null;
  readonly completedSessions: number | null;
}): CoachCycleProgress {
  const completedSessions = Number.isSafeInteger(input.completedSessions)
    && input.completedSessions !== null && input.completedSessions >= 0
    ? (input.completedSessions === 0 ? 0 : input.completedSessions) : null;
  const plannedSessions = plannedSessionCount(input.plan);
  return Object.freeze({
    completedSessions,
    plannedSessions,
    progressRatio: completedSessions !== null && plannedSessions !== null && plannedSessions > 0
      ? completedSessions / plannedSessions : null,
  });
}

/**
 * Source for CoachRenewalsView.retentionLabel. Units are elapsed civil days: end-start,
 * not inclusive attendance days, fixed 24-hour periods or approximate months.
 * The caller supplies complete, authorized, deduplicated episodes. Active episodes
 * contribute neither elapsed time nor denominator. An invalid/incomplete finalized
 * episode makes the average unknown instead of silently biasing the sample.
 * State ended is an explicit source fact; no clock invents closure or elapsed tenure.
 */
export function calculateCoachAverageTenureDays(episodes: readonly CoachTenureEpisode[] | null): number | null {
  if (!Array.isArray(episodes)) return null;
  let count = 0;
  let totalDays = 0;
  for (const episode of episodes) {
    if (episode?.state === "active") continue;
    if (!episode || episode.state !== "ended") return null;
    const start = civilOrdinal(episode.startedOn);
    const end = civilOrdinal(episode.endedOn);
    if (start === null || end === null || end < start) return null;
    const duration = end - start;
    if (totalDays > Number.MAX_SAFE_INTEGER - duration) return null;
    totalDays += duration;
    count += 1;
  }
  return count === 0 ? null : totalDays / count;
}
