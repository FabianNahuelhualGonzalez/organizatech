import type { TrainingDayCode } from "@/lib/progress/types";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const trainingDayOffsets: Record<TrainingDayCode, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

export interface CycleCalendarPlannedDateInput {
  plannedStartDate: string;
  weekNumber: number;
  plannedDay: TrainingDayCode;
}

export interface EffectiveSessionDateInput {
  calendarWeekStart?: string | null;
  trainedDate?: string | null;
  plannedDate?: string | null;
  trainedAt?: string | null;
}

export function getCalendarWeekStartDateKey(dateKey: string) {
  const epochDay = parseDateKeyToEpochDay(dateKey);
  return formatEpochDayAsDateKey(epochDay - getMondayBasedWeekdayOffset(epochDay));
}

export function getCycleCalendarWeekNumber(plannedStartDate: string, referenceDate: string) {
  const plannedStartWeek = parseDateKeyToEpochDay(getCalendarWeekStartDateKey(plannedStartDate));
  const referenceWeek = parseDateKeyToEpochDay(getCalendarWeekStartDateKey(referenceDate));
  const weekDifference = Math.floor((referenceWeek - plannedStartWeek) / 7);
  return Math.max(1, weekDifference + 1);
}

export function getCycleCalendarPlannedDate(input: CycleCalendarPlannedDateInput) {
  if (!Number.isInteger(input.weekNumber) || input.weekNumber < 1) {
    throw new Error("La semana del ciclo debe ser un entero mayor o igual a 1.");
  }

  const plannedStartWeek = parseDateKeyToEpochDay(getCalendarWeekStartDateKey(input.plannedStartDate));
  const plannedDay = plannedStartWeek + ((input.weekNumber - 1) * 7) + trainingDayOffsets[input.plannedDay];
  return formatEpochDayAsDateKey(plannedDay);
}

export function getSessionEffectiveCalendarWeekStart(input: EffectiveSessionDateInput) {
  if (isDateKey(input.calendarWeekStart)) return input.calendarWeekStart;
  const effectiveDate = getSessionEffectiveDateKey(input);
  return effectiveDate ? getCalendarWeekStartDateKey(effectiveDate) : null;
}

export function getSessionEffectiveCycleWeekNumber(plannedStartDate: string, input: EffectiveSessionDateInput) {
  const effectiveDate = getSessionEffectiveDateKey(input);
  return effectiveDate ? getCycleCalendarWeekNumber(plannedStartDate, effectiveDate) : null;
}

export function getSessionEffectiveDateKey(input: EffectiveSessionDateInput) {
  if (isDateKey(input.trainedDate)) return input.trainedDate;
  if (isDateKey(input.plannedDate)) return input.plannedDate;
  return normalizeDateTimeToDateKey(input.trainedAt);
}

function normalizeDateTimeToDateKey(value: string | null | undefined) {
  if (!value) return null;
  const datePart = value.slice(0, 10);
  return isDateKey(datePart) ? datePart : null;
}

function isDateKey(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    parseDateKeyToEpochDay(value);
    return true;
  } catch {
    return false;
  }
}

function parseDateKeyToEpochDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Fecha invalida: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Fecha invalida: ${value}`);
  }

  return Math.floor(timestamp / MILLISECONDS_PER_DAY);
}

function getMondayBasedWeekdayOffset(epochDay: number) {
  const utcWeekday = new Date(epochDay * MILLISECONDS_PER_DAY).getUTCDay();
  return (utcWeekday + 6) % 7;
}

function formatEpochDayAsDateKey(epochDay: number) {
  return new Date(epochDay * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}
