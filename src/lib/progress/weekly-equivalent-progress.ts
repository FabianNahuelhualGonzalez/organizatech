import type { ExerciseEntry, TrainingSession } from "@/lib/progress/types";
import { formatKg, roundDecimal } from "@/lib/progress/weight-format";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const santiagoTimeZone = "America/Santiago";
const weekDayLabels = ["L", "M", "X", "J", "V", "S", "D"] as const;
const plannedDayOrder = ["Lunes", "Martes", "Miercoles", "Miércoles", "Jueves", "Viernes", "Sabado", "Sábado", "Domingo"];

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

export interface WeeklyDualProgressPoint {
  day: string;
  label: string;
  currentDate: string;
  previousDate: string;
  currentVolume: number | null;
  previousVolume: number | null;
  currentPercentage: number | null;
  previousPercentage: number | null;
  isFuture: boolean;
}

export interface WeeklyEquivalentProgressResult {
  ranges: EquivalentWeeklyDateRanges;
  plannedDays: string[];
  previousFinalVolume: number;
  currentEquivalentValue: number;
  previousEquivalentValue: number;
  differenceValue: number;
  percentage: number | null;
  previousComparablePercentage: number | null;
  primaryLabel: string;
  previousLabel: string;
  currentVolumeLabel: string;
  previousVolumeLabel: string;
  comparisonLabel: "Vs semana anterior";
  detailLabel: string;
  tone: WeeklyEquivalentProgressTone;
  status: WeeklyEquivalentProgressStatus;
  points: WeeklyDualProgressPoint[];
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
  plannedDays?: string[];
}): WeeklyEquivalentProgressResult {
  const ranges = getEquivalentWeeklyDateRanges(input.referenceDate);
  const plannedDays = resolvePlannedWeekDays(input.plannedDays ?? []);
  const entries = filterComparableEntries({
    entries: input.entries,
    sessions: input.sessions ?? [],
    activeCycleId: input.activeCycleId,
  });
  const points = buildDualWeeklyProgressSeries({ entries, ranges, plannedDays });
  const previousFinalVolume = points.at(-1)?.previousVolume ?? 0;
  const normalizedPoints = normalizeWeeklySeriesAgainstPreviousFinal(points, previousFinalVolume);
  const comparableIndex = getComparablePlannedDayIndex(normalizedPoints);
  const comparablePoint = comparableIndex >= 0 ? normalizedPoints[comparableIndex] : null;
  const currentEquivalentValue = comparablePoint?.currentVolume ?? 0;
  const previousEquivalentValue = comparablePoint?.previousVolume ?? 0;
  const differenceValue = roundDecimal(currentEquivalentValue - previousEquivalentValue);
  const percentage = comparablePoint?.currentPercentage ?? null;
  const previousComparablePercentage = comparablePoint?.previousPercentage ?? null;
  const status = resolveProgressStatus(currentEquivalentValue, previousFinalVolume, percentage);

  return {
    ranges,
    plannedDays,
    previousFinalVolume,
    currentEquivalentValue,
    previousEquivalentValue,
    differenceValue,
    percentage,
    previousComparablePercentage,
    primaryLabel: status === "ready" ? formatKg(Math.abs(differenceValue)) : currentEquivalentValue > 0 ? formatKg(currentEquivalentValue) : "—",
    previousLabel: status === "ready" ? formatKg(previousEquivalentValue) : "—",
    currentVolumeLabel: formatKg(currentEquivalentValue),
    previousVolumeLabel: status === "ready" ? formatKg(previousEquivalentValue) : "—",
    comparisonLabel: "Vs semana anterior",
    detailLabel: buildDetailLabel(status),
    tone: resolveProgressTone(differenceValue, status),
    status,
    points: normalizedPoints,
  };
}

export function resolvePlannedWeekDays(days: string[]) {
  const normalized = new Map<string, string>();
  days.forEach((day) => {
    const canonical = canonicalizePlannedDay(day);
    if (canonical) normalized.set(removeAccents(canonical).toLowerCase(), canonical);
  });

  const ordered = [...normalized.values()].sort((a, b) => getDayOffset(a) - getDayOffset(b));
  return ordered.length > 0 ? ordered : ["Lunes"];
}

export function formatProgressPercentage(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = roundDecimal(value);
  if (Object.is(rounded, -0) || rounded === 0) return "0%";
  const fixed = rounded.toFixed(2).replace(/\.?0+$/, "");
  return `${rounded > 0 ? "+" : ""}${fixed.replace(".", ",")}%`;
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

function buildDualWeeklyProgressSeries(input: {
  entries: ExerciseEntry[];
  ranges: EquivalentWeeklyDateRanges;
  plannedDays: string[];
}) {
  let currentCumulative = 0;
  let previousCumulative = 0;

  return input.plannedDays.map((day) => {
    const offset = getDayOffset(day);
    const currentDate = addDays(input.ranges.currentWeekStart, offset);
    const previousDate = addDays(input.ranges.previousWeekStart, offset);
    const isFuture = currentDate > input.ranges.currentComparisonEnd;

    previousCumulative += calculateEntriesVolume(input.entries.filter((entry) => normalizeEntryDateKey(entry.date) === previousDate));
    if (!isFuture) {
      currentCumulative += calculateEntriesVolume(input.entries.filter((entry) => normalizeEntryDateKey(entry.date) === currentDate));
    }

    return {
      day,
      label: getShortDayLabel(day),
      currentDate,
      previousDate,
      currentVolume: isFuture ? null : roundDecimal(currentCumulative),
      previousVolume: roundDecimal(previousCumulative),
      currentPercentage: null,
      previousPercentage: null,
      isFuture,
    } satisfies WeeklyDualProgressPoint;
  });
}

function normalizeWeeklySeriesAgainstPreviousFinal(points: WeeklyDualProgressPoint[], previousFinalVolume: number) {
  return points.map((point) => ({
    ...point,
    currentPercentage: point.currentVolume === null ? null : calculateAgainstPreviousFinal(point.currentVolume, previousFinalVolume),
    previousVolume: previousFinalVolume <= 0 ? null : point.previousVolume,
    previousPercentage: point.previousVolume === null ? null : calculateAgainstPreviousFinal(point.previousVolume, previousFinalVolume),
  }));
}

function calculateAgainstPreviousFinal(cumulativeVolume: number, previousFinalVolume: number) {
  if (previousFinalVolume <= 0) return null;
  return roundDecimal(((cumulativeVolume / previousFinalVolume) - 1) * 100);
}

function getComparablePlannedDayIndex(points: WeeklyDualProgressPoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (!points[index].isFuture) return index;
  }
  return -1;
}

function calculateEntriesVolume(entries: ExerciseEntry[]) {
  return roundDecimal(entries.reduce((total, entry) => {
    const reps = entry.reps.reduce((sum, value) => sum + value, 0);
    return total + reps * entry.weight;
  }, 0));
}

function resolveProgressStatus(currentValue: number, previousFinalVolume: number, percentage: number | null): WeeklyEquivalentProgressStatus {
  if (previousFinalVolume <= 0 && currentValue <= 0) return "neutral";
  if (percentage === null) return "no_previous";
  return "ready";
}

function resolveProgressTone(differenceValue: number, status: WeeklyEquivalentProgressStatus): WeeklyEquivalentProgressTone {
  if (status !== "ready" || differenceValue === 0) return "neutral";
  return differenceValue > 0 ? "positive" : "danger";
}

function buildDetailLabel(status: WeeklyEquivalentProgressStatus) {
  if (status === "ready") return "Semana actual";
  if (status === "neutral") return "Sin registros equivalentes";
  return "Sin comparación anterior";
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function canonicalizePlannedDay(day: string) {
  const trimmed = day.trim();
  if (isDateKey(trimmed)) return getDayNameFromOffset(getMondayBasedWeekdayOffset(parseDateKeyToEpochDay(trimmed)));
  const normalized = removeAccents(trimmed).toLowerCase();
  const found = plannedDayOrder.find((item) => removeAccents(item).toLowerCase() === normalized);
  return found ? getDayNameFromOffset(getDayOffset(found)) : null;
}

function getDayOffset(day: string) {
  const normalized = removeAccents(day).toLowerCase();
  if (normalized === "lunes") return 0;
  if (normalized === "martes") return 1;
  if (normalized === "miercoles") return 2;
  if (normalized === "jueves") return 3;
  if (normalized === "viernes") return 4;
  if (normalized === "sabado") return 5;
  if (normalized === "domingo") return 6;
  return 0;
}

function getDayNameFromOffset(offset: number) {
  return ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][offset] ?? "Lunes";
}

function getShortDayLabel(day: string) {
  return weekDayLabels[getDayOffset(day)] ?? day.slice(0, 1).toUpperCase();
}

function removeAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
