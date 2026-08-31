import { DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS } from "./types";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export type CycleDurationResult =
  | {
    readonly valid: true;
    /** Diferencia entre término e inicio; coincide con la duración mostrada por el prototipo. */
    readonly elapsedDays: number;
    /** Cantidad de fechas utilizables, porque el día de término sigue siendo válido. */
    readonly inclusiveDayCount: number;
    readonly approximateWeeks: number;
  }
  | {
    readonly valid: false;
    readonly reason: "invalid_start_date" | "invalid_end_date" | "end_not_after_start" | "span_exceeds_limit";
  };

export function parseISOCalendarDate(value: string): CalendarDateParts | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12) return null;
  const daysInMonth = getDaysInMonth(year, month);
  return day >= 1 && day <= daysInMonth ? { year, month, day } : null;
}

export function isISOCalendarDate(value: unknown): value is string {
  return typeof value === "string" && parseISOCalendarDate(value) !== null;
}

/** Timestamp ISO civil estricto: calendario real, hora válida y zona explícita hasta ±14:00. */
export function isISOInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match || !isISOCalendarDate(match[1])) return false;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (match[6] !== "Z") {
    const offsetHour = Number(match[7]);
    const offsetMinute = Number(match[8]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return false;
    }
  }
  return Number.isFinite(Date.parse(value));
}

export function compareISOCalendarDates(left: string, right: string): -1 | 0 | 1 {
  const leftDay = toEpochDayOrThrow(left);
  const rightDay = toEpochDayOrThrow(right);
  return leftDay === rightDay ? 0 : leftDay < rightDay ? -1 : 1;
}

export function differenceInCalendarDays(startDate: string, endDate: string): number {
  return toEpochDayOrThrow(endDate) - toEpochDayOrThrow(startDate);
}

export function addCalendarDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new Error("days debe ser un entero seguro");
  const epochDay = toEpochDayOrThrow(date);
  return formatUTCDate((epochDay + days) * MILLISECONDS_PER_DAY);
}

export function calculateCycleDuration(
  startDate: string,
  endDate: string,
  maxSpanDays = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxCycleSpanDays,
): CycleDurationResult {
  if (!parseISOCalendarDate(startDate)) return { valid: false, reason: "invalid_start_date" };
  if (!parseISOCalendarDate(endDate)) return { valid: false, reason: "invalid_end_date" };
  const elapsedDays = differenceInCalendarDays(startDate, endDate);
  if (elapsedDays <= 0) return { valid: false, reason: "end_not_after_start" };
  if (!Number.isSafeInteger(maxSpanDays) || maxSpanDays < 1 || elapsedDays > maxSpanDays) {
    return { valid: false, reason: "span_exceeds_limit" };
  }
  return {
    valid: true,
    elapsedDays,
    inclusiveDayCount: elapsedDays + 1,
    approximateWeeks: Math.round((elapsedDays / 7) * 10) / 10,
  };
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function toEpochDayOrThrow(value: string): number {
  const parts = parseISOCalendarDate(value);
  if (!parts) throw new Error(`Fecha ISO invalida: ${value}`);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return Math.floor(date.getTime() / MILLISECONDS_PER_DAY);
}

function formatUTCDate(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new Error("Fecha fuera de rango");
  const date = new Date(milliseconds);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const result = `${year}-${month}-${day}`;
  if (!parseISOCalendarDate(result)) throw new Error("Fecha fuera de rango");
  return result;
}
