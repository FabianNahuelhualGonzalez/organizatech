import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";
import { roundDecimal } from "@/lib/progress/weight-format";

export type WeeklyExerciseComparisonTone = "positive" | "negative" | "neutral" | "unavailable";

export type WeeklyExerciseComparisonEmptyState =
  | "none"
  | "no_routine_for_day"
  | "no_exercises_for_day"
  | "no_reliable_identity"
  | "no_real_records"
  | "no_baseline_week"
  | "insufficient_chart_data";

export interface WeeklyExerciseComparisonPlannedExercise {
  exerciseId: string;
  exerciseLineageId: string | null;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  isSelected: boolean;
}

export interface WeeklyExerciseComparisonRecord {
  week: number;
  date: string;
  entryId: string;
  weight: number;
  reps: number[];
  repsLabel: string;
  totalReps: number;
  seriesCount: number;
}

export interface WeeklyExerciseComparisonSeriesPoint {
  week: number;
  label: string;
  value: number;
  date: string;
}

export interface WeeklyExerciseMetricSummary {
  status: "ready" | "neutral" | "unavailable";
  startValue: number | null;
  currentValue: number | null;
  difference: number | null;
  tone: WeeklyExerciseComparisonTone;
  startDate: string | null;
  currentDate: string | null;
}

export interface WeeklyExerciseResultComparison {
  baseline: WeeklyExerciseComparisonRecord | null;
  effective: WeeklyExerciseComparisonRecord | null;
}

export interface WeeklyExerciseComparisonModel {
  availableDays: string[];
  selectedDay: string;
  plannedRoutine: string | null;
  selectedExerciseId: string | null;
  selectedExercise: WeeklyExerciseComparisonPlannedExercise | null;
  availableWeeks: number[];
  baselineWeek: number | null;
  targetWeek: number;
  effectiveWeek: number | null;
  hasBaseline: boolean;
  hasCurrent: boolean;
  plannedExercises: WeeklyExerciseComparisonPlannedExercise[];
  resultComparison: WeeklyExerciseResultComparison;
  kgChartSeries: WeeklyExerciseComparisonSeriesPoint[];
  repsChartSeries: WeeklyExerciseComparisonSeriesPoint[];
  kgSummary: WeeklyExerciseMetricSummary;
  repsSummary: WeeklyExerciseMetricSummary;
  emptyState: WeeklyExerciseComparisonEmptyState;
}

export function buildWeeklyExerciseComparisonModel(input: {
  plannedExercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  selectedDay: string;
  selectedExerciseId?: string | null;
  currentWeek: number;
}): WeeklyExerciseComparisonModel {
  const availableDays = getAvailableDays(input.plannedExercises);
  const selectedDay = input.selectedDay;
  const dayExercises = input.plannedExercises.filter((exercise) => sameDay(exercise.day, selectedDay));
  const plannedRoutine = dayExercises[0]?.routine ?? null;
  const targetWeek = sanitizeWeek(input.currentWeek) ?? 1;

  if (!availableDays.includes(selectedDay)) {
    return createEmptyModel({
      availableDays,
      selectedDay,
      plannedRoutine: null,
      targetWeek,
      emptyState: "no_routine_for_day",
    });
  }

  // Defensa para futuras fuentes que puedan publicar un dia disponible sin ejercicios renderizables.
  if (dayExercises.length === 0) {
    return createEmptyModel({
      availableDays,
      selectedDay,
      plannedRoutine,
      targetWeek,
      emptyState: "no_exercises_for_day",
    });
  }

  const selectedExercise = resolveSelectedExercise(dayExercises, input.selectedExerciseId);
  const plannedExercises = dayExercises.map((exercise) => toPlannedExercise(exercise, exercise.id === selectedExercise.id));
  const selectedPlannedExercise = plannedExercises.find((exercise) => exercise.exerciseId === selectedExercise.id) ?? null;
  const identity = resolveExerciseIdentity(selectedExercise);

  if (!identity) {
    return createEmptyModel({
      availableDays,
      selectedDay,
      plannedRoutine,
      targetWeek,
      selectedExerciseId: selectedExercise.id,
      selectedExercise: selectedPlannedExercise,
      plannedExercises,
      emptyState: "no_reliable_identity",
    });
  }

  const records = getExerciseRecords({
    exercise: selectedExercise,
    identity,
    entries: input.entries,
  });
  const availableWeeks = records.map((record) => record.week);
  const baseline = records.find((record) => record.week === 1) ?? null;
  const current = records.find((record) => record.week === targetWeek) ?? null;
  const effective = current ?? records.at(-1) ?? null;
  const emptyState = getEmptyState({ records, baseline, hasReliableIdentity: Boolean(identity) });
  const kgChartSeries = records.map((record) => ({
    week: record.week,
    label: `S${record.week}`,
    value: record.weight,
    date: record.date,
  }));
  const repsChartSeries = records.map((record) => ({
    week: record.week,
    label: `S${record.week}`,
    value: record.totalReps,
    date: record.date,
  }));

  return {
    availableDays,
    selectedDay,
    plannedRoutine,
    selectedExerciseId: selectedExercise.id,
    selectedExercise: selectedPlannedExercise,
    availableWeeks,
    baselineWeek: baseline ? 1 : null,
    targetWeek,
    effectiveWeek: effective?.week ?? null,
    hasBaseline: Boolean(baseline),
    hasCurrent: Boolean(current),
    plannedExercises,
    resultComparison: {
      baseline,
      effective,
    },
    kgChartSeries,
    repsChartSeries,
    kgSummary: buildMetricSummary({
      baselineValue: baseline?.weight ?? null,
      effectiveValue: effective?.weight ?? null,
      baselineDate: baseline?.date ?? null,
      effectiveDate: effective?.date ?? null,
    }),
    repsSummary: buildMetricSummary({
      baselineValue: baseline?.totalReps ?? null,
      effectiveValue: effective?.totalReps ?? null,
      baselineDate: baseline?.date ?? null,
      effectiveDate: effective?.date ?? null,
    }),
    emptyState,
  };
}

function createEmptyModel(input: {
  availableDays: string[];
  selectedDay: string;
  plannedRoutine: string | null;
  targetWeek: number;
  selectedExerciseId?: string | null;
  selectedExercise?: WeeklyExerciseComparisonPlannedExercise | null;
  plannedExercises?: WeeklyExerciseComparisonPlannedExercise[];
  emptyState: WeeklyExerciseComparisonEmptyState;
}): WeeklyExerciseComparisonModel {
  return {
    availableDays: input.availableDays,
    selectedDay: input.selectedDay,
    plannedRoutine: input.plannedRoutine,
    selectedExerciseId: input.selectedExerciseId ?? null,
    selectedExercise: input.selectedExercise ?? null,
    availableWeeks: [],
    baselineWeek: null,
    targetWeek: input.targetWeek,
    effectiveWeek: null,
    hasBaseline: false,
    hasCurrent: false,
    plannedExercises: input.plannedExercises ?? [],
    resultComparison: {
      baseline: null,
      effective: null,
    },
    kgChartSeries: [],
    repsChartSeries: [],
    kgSummary: createUnavailableSummary(),
    repsSummary: createUnavailableSummary(),
    emptyState: input.emptyState,
  };
}

function getAvailableDays(exercises: ExerciseTemplate[]) {
  const days: string[] = [];
  for (const exercise of exercises) {
    const day = exercise.day?.trim();
    if (day && !days.includes(day)) days.push(day);
  }
  return days;
}

function sameDay(left: string | undefined, right: string) {
  return normalizeKey(left ?? "") === normalizeKey(right);
}

function resolveSelectedExercise(exercises: ExerciseTemplate[], selectedExerciseId?: string | null) {
  if (selectedExerciseId) {
    const selected = exercises.find((exercise) =>
      exercise.id === selectedExerciseId ||
      exercise.trainingCycleExerciseId === selectedExerciseId ||
      exercise.exerciseLineageId === selectedExerciseId
    );
    if (selected) return selected;
  }
  return exercises[0];
}

function toPlannedExercise(exercise: ExerciseTemplate, isSelected: boolean): WeeklyExerciseComparisonPlannedExercise {
  return {
    exerciseId: exercise.id,
    exerciseLineageId: exercise.exerciseLineageId ?? null,
    name: exercise.name,
    targetSets: sanitizeNonNegativeInteger(exercise.targetSets),
    targetReps: sanitizeNonNegativeInteger(exercise.targetReps),
    baseWeight: sanitizeNumber(exercise.baseWeight) ?? 0,
    isSelected,
  };
}

type ExerciseIdentity =
  | { type: "lineage"; value: string }
  | { type: "training-cycle-exercise"; value: string }
  | { type: "exercise-id"; value: string };

function resolveExerciseIdentity(exercise: ExerciseTemplate): ExerciseIdentity | null {
  const lineage = normalizeOptionalId(exercise.exerciseLineageId);
  if (lineage) return { type: "lineage", value: lineage };

  const trainingCycleExerciseId = normalizeOptionalId(exercise.trainingCycleExerciseId);
  if (trainingCycleExerciseId) return { type: "training-cycle-exercise", value: trainingCycleExerciseId };

  const exerciseId = normalizeOptionalId(exercise.id);
  if (exerciseId) return { type: "exercise-id", value: exerciseId };

  return null;
}

function getExerciseRecords(input: {
  exercise: ExerciseTemplate;
  identity: ExerciseIdentity;
  entries: ExerciseEntry[];
}) {
  const matchingEntries = input.entries.filter((entry) =>
    matchesExerciseIdentity(input.identity, entry) &&
    matchesExerciseScope(input.exercise, entry)
  );
  const byWeek = new Map<number, WeeklyExerciseComparisonRecord>();

  for (const entry of matchingEntries) {
    const week = sanitizeWeek(entry.week);
    if (week === null) continue;
    const record = toRecord(entry, week);
    if (!record) continue;

    const current = byWeek.get(week);
    if (!current || compareRecords(record, current) > 0) {
      byWeek.set(week, record);
    }
  }

  return [...byWeek.values()].sort((a, b) => a.week - b.week || compareRecords(a, b));
}

function matchesExerciseIdentity(identity: ExerciseIdentity, entry: ExerciseEntry) {
  if (identity.type === "lineage") return entry.exerciseLineageId === identity.value;
  if (identity.type === "training-cycle-exercise") return entry.trainingCycleExerciseId === identity.value;
  return entry.exerciseId === identity.value || entry.trainingCycleExerciseId === identity.value;
}

function matchesExerciseScope(exercise: ExerciseTemplate, entry: ExerciseEntry) {
  if (exercise.cycleId && entry.cycleId && exercise.cycleId !== entry.cycleId) return false;
  if (exercise.cycleDayId && entry.cycleDayId && exercise.cycleDayId !== entry.cycleDayId) return false;
  if (!exercise.cycleDayId && exercise.routine && entry.routine && normalizeKey(exercise.routine) !== normalizeKey(entry.routine)) return false;
  return true;
}

function toRecord(entry: ExerciseEntry, week: number): WeeklyExerciseComparisonRecord | null {
  const weight = sanitizeNumber(entry.weight);
  if (weight === null) return null;

  const reps = entry.reps.map(sanitizeRep).filter((rep): rep is number => rep !== null);
  const totalReps = sanitizeDifference(reps.reduce((total, rep) => total + rep, 0));

  return {
    week,
    date: entry.date,
    entryId: entry.id,
    weight,
    reps,
    repsLabel: formatRepsSeries(reps),
    totalReps,
    seriesCount: reps.length,
  };
}

function buildMetricSummary(input: {
  baselineValue: number | null;
  effectiveValue: number | null;
  baselineDate: string | null;
  effectiveDate: string | null;
}): WeeklyExerciseMetricSummary {
  if (input.baselineValue === null || input.effectiveValue === null) return createUnavailableSummary();
  const difference = sanitizeDifference(input.effectiveValue - input.baselineValue);
  const tone = getTone(difference);
  return {
    status: difference === 0 ? "neutral" : "ready",
    startValue: input.baselineValue,
    currentValue: input.effectiveValue,
    difference,
    tone,
    startDate: input.baselineDate,
    currentDate: input.effectiveDate,
  };
}

function createUnavailableSummary(): WeeklyExerciseMetricSummary {
  return {
    status: "unavailable",
    startValue: null,
    currentValue: null,
    difference: null,
    tone: "unavailable",
    startDate: null,
    currentDate: null,
  };
}

function getEmptyState(input: {
  records: WeeklyExerciseComparisonRecord[];
  baseline: WeeklyExerciseComparisonRecord | null;
  hasReliableIdentity: boolean;
}): WeeklyExerciseComparisonEmptyState {
  if (!input.hasReliableIdentity) return "no_reliable_identity";
  if (input.records.length === 0) return "no_real_records";
  if (!input.baseline) return "no_baseline_week";
  if (input.records.length < 2) return "insufficient_chart_data";
  return "none";
}

function compareRecords(a: WeeklyExerciseComparisonRecord, b: WeeklyExerciseComparisonRecord) {
  const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
  return dateCompare || a.entryId.localeCompare(b.entryId);
}

function formatRepsSeries(reps: number[]) {
  return reps.join("/");
}

function getTone(value: number): WeeklyExerciseComparisonTone {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function sanitizeWeek(value: number) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function sanitizeRep(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function sanitizeNumber(value: number) {
  return Number.isFinite(value) && value >= 0 ? roundDecimal(value) : null;
}

function sanitizeNonNegativeInteger(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function sanitizeDifference(value: number) {
  const rounded = roundDecimal(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeOptionalId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
