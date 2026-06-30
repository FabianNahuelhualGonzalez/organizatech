import type { ExerciseEntry, TrainingSession } from "@/lib/progress/types";
import { roundDecimal } from "@/lib/progress/weight-format";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const santiagoTimeZone = "America/Santiago";
const weekDayLabels = ["L", "M", "X", "J", "V", "S", "D"] as const;

export type WeeklyEquivalentProgressTone = "positive" | "danger" | "neutral";
export type WeeklyEquivalentProgressStatus = "ready" | "no_previous" | "neutral";

export interface EquivalentWeeklyDateRanges {
  currentWeekStart: string;
  currentComparisonEnd: string;
  previousWeekStart: string;
  previousComparisonEnd: string;
  elapsedDayCount: number;
  todayLabel: string;
}

export interface WeeklyEquivalentProgressPoint {
  label: string;
  value: number;
  comparable: boolean;
}

export interface WeeklyEquivalentProgressResult {
  ranges: EquivalentWeeklyDateRanges;
  currentEquivalentValue: number;
  previousEquivalentValue: number;
  percentage: number | null;
  primaryLabel: string;
  comparisonLabel: "vs mismo punto de la semana anterior";
  detailLabel: string;
  tone: WeeklyEquivalentProgressTone;
  status: WeeklyEquivalentProgressStatus;
  points: WeeklyEquivalentProgressPoint[];
}

export function getEquivalentWeeklyDateRanges(referenceDate: Date | string = new Date()): EquivalentWeeklyDateRanges {
  const todayKey = typeof referenceDate === "string" ? referenceDate : getSantiagoDateKey(referenceDate);
  const todayEpoch = parseDateKeyToEpochDay(todayKey);
  const elapsedDayCount = getMondayBasedWeekdayOffset(todayEpoch) + 1;
  const currentWeekStartEpoch = todayEpoch - (elapsedDayCount - 1);
  const previousWeekStartEpoch = currentWeekStartEpoch - 7;
  const previousComparisonEndEpoch = previousWeekStartEpoch + elapsedDayCount - 1;

  return {
    currentWeekStart: formatEpochDayAsDateKey(currentWeekStartEpoch),
    currentComparisonEnd: todayKey,
    previousWeekStart: formatEpochDayAsDateKey(previousWeekStartEpoch),
    previousComparisonEnd: formatEpochDayAsDateKey(previousComparisonEndEpoch),
    elapsedDayCount,
    todayLabel: weekDayLabels[elapsedDayCount - 1] ?? "D",
  };
}

export function calculateEquivalentWeeklyProgress(input: {
  entries: ExerciseEntry[];
  sessions?: TrainingSession[];
  referenceDate?: Date | string;
  activeCycleId?: string | null;
}): WeeklyEquivalentProgressResult {
  const ranges = getEquivalentWeeklyDateRanges(input.referenceDate);
  const entries = filterComparableEntries({
    entries: input.entries,
    sessions: input.sessions ?? [],
    activeCycleId: input.activeCycleId,
  });
  const currentEntries = entries.filter((entry) => isDateInRange(normalizeEntryDateKey(entry.date), ranges.currentWeekStart, ranges.currentComparisonEnd));
  const previousEntries = entries.filter((entry) => isDateInRange(normalizeEntryDateKey(entry.date), ranges.previousWeekStart, ranges.previousComparisonEnd));
  const currentEquivalentValue = calculateEntriesVolume(currentEntries);
  const previousEquivalentValue = calculateEntriesVolume(previousEntries);
  const percentage = calculateEquivalentPercentage(currentEquivalentValue, previousEquivalentValue);
  const status = resolveProgressStatus(currentEquivalentValue, previousEquivalentValue, percentage);

  return {
    ranges,
    currentEquivalentValue,
    previousEquivalentValue,
    percentage,
    primaryLabel: percentage === null ? "—" : `${formatSignedNumber(Math.round(percentage))}%`,
    comparisonLabel: "vs mismo punto de la semana anterior",
    detailLabel: buildDetailLabel(status),
    tone: resolveProgressTone(percentage, status),
    status,
    points: buildEquivalentProgressPoints(entries, ranges),
  };
}

function filterComparableEntries(input: {
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  activeCycleId?: string | null;
}) {
  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const uniqueEntries = new Map<string, ExerciseEntry>();

  input.entries.forEach((entry) => {
    if (input.activeCycleId && entry.cycleId !== input.activeCycleId) return;

    const session = entry.sessionId ? sessionsById.get(entry.sessionId) : null;
    if (session && (session.deletedAt || session.status !== "completed")) return;

    uniqueEntries.set(entry.id, entry);
  });

  return [...uniqueEntries.values()];
}

function buildEquivalentProgressPoints(entries: ExerciseEntry[], ranges: EquivalentWeeklyDateRanges) {
  return Array.from({ length: ranges.elapsedDayCount }, (_, index) => {
    const currentEnd = addDays(ranges.currentWeekStart, index);
    const previousEnd = addDays(ranges.previousWeekStart, index);
    const currentValue = calculateEntriesVolume(entries.filter((entry) =>
      isDateInRange(normalizeEntryDateKey(entry.date), ranges.currentWeekStart, currentEnd)));
    const previousValue = calculateEntriesVolume(entries.filter((entry) =>
      isDateInRange(normalizeEntryDateKey(entry.date), ranges.previousWeekStart, previousEnd)));
    const value = calculateEquivalentPercentage(currentValue, previousValue);

    return {
      label: weekDayLabels[index] ?? "",
      value: value ?? 0,
      comparable: value !== null,
    };
  });
}

function calculateEntriesVolume(entries: ExerciseEntry[]) {
  return roundDecimal(entries.reduce((total, entry) => {
    const reps = entry.reps.reduce((sum, value) => sum + value, 0);
    return total + reps * entry.weight;
  }, 0));
}

function calculateEquivalentPercentage(currentValue: number, previousValue: number) {
  if (previousValue <= 0) return null;
  return roundDecimal(((currentValue - previousValue) / previousValue) * 100);
}

function resolveProgressStatus(currentValue: number, previousValue: number, percentage: number | null): WeeklyEquivalentProgressStatus {
  if (previousValue <= 0 && currentValue <= 0) return "neutral";
  if (percentage === null) return "no_previous";
  return "ready";
}

function resolveProgressTone(percentage: number | null, status: WeeklyEquivalentProgressStatus): WeeklyEquivalentProgressTone {
  if (status !== "ready" || percentage === null || percentage === 0) return "neutral";
  return percentage > 0 ? "positive" : "danger";
}

function buildDetailLabel(status: WeeklyEquivalentProgressStatus) {
  if (status === "ready") return "Semana en curso";
  if (status === "neutral") return "Sin registros equivalentes";
  return "Sin comparación anterior";
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function isDateInRange(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function addDays(dateKey: string, days: number) {
  return formatEpochDayAsDateKey(parseDateKeyToEpochDay(dateKey) + days);
}

function normalizeEntryDateKey(value: string) {
  return value.slice(0, 10);
}

function getSantiagoDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: santiagoTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function parseDateKeyToEpochDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Fecha invalida: ${value}`);
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MILLISECONDS_PER_DAY);
}

function getMondayBasedWeekdayOffset(epochDay: number) {
  const utcWeekday = new Date(epochDay * MILLISECONDS_PER_DAY).getUTCDay();
  return (utcWeekday + 6) % 7;
}

function formatEpochDayAsDateKey(epochDay: number) {
  return new Date(epochDay * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}
