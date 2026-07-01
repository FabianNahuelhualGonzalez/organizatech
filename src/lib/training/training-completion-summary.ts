import { formatDecimalEs, formatKg, roundDecimal } from "@/lib/progress/weight-format";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";

export type TrainingCompletionComparisonStatus = "ready" | "first_reference" | "unavailable";
export type TrainingCompletionTone = "positive" | "danger" | "neutral";

export interface TrainingCompletionExerciseDraftInput {
  weight?: string | number | null;
  reps?: Array<number | "" | null | undefined>;
}

export interface TrainingCompletionExerciseInput {
  exerciseId: string;
  exerciseLineageId?: string | null;
  exerciseName: string;
  targetSets?: number | null;
  draft?: TrainingCompletionExerciseDraftInput;
}

export interface TrainingCompletionHistoricalInput {
  status: TrainingCompletionComparisonStatus;
  latest?: LatestExercisePerformance | null;
}

export interface BuildTrainingCompletionSummaryInput {
  sessionId: string;
  dayLabel: string;
  statusLabel?: string;
  workoutName: string;
  cycleLabel: string;
  weekLabel: string;
  progressLabel: string;
  workoutStartedAt?: string | null;
  savedAt?: string | null;
  currentDate: string;
  exercises: TrainingCompletionExerciseInput[];
  historicalByExerciseId?: Record<string, TrainingCompletionHistoricalInput | undefined>;
}

export interface TrainingCompletionSummary {
  sessionId: string;
  dayLabel: string;
  statusLabel: string;
  workoutName: string;
  cycleLabel: string;
  weekLabel: string;
  progressLabel: string;
  durationMinutes: number | null;
  durationLabel: string;
  exercises: TrainingCompletionExerciseSummary[];
}

export interface TrainingCompletionExerciseSummary {
  exerciseId: string;
  exerciseLineageId: string | null;
  exerciseName: string;
  currentDate: string;
  currentDateLabel: string;
  currentSeriesCount: number;
  currentTotalReps: number;
  currentWeight: number | null;
  currentWeightLabel: string;
  previousDate: string | null;
  previousDateLabel: string;
  previousSeriesCount: number | null;
  previousTotalReps: number | null;
  previousWeightLabel: string;
  repsDifference: number | null;
  weightDifference: number | null;
  comparisonStatus: TrainingCompletionComparisonStatus;
  repsTone: TrainingCompletionTone;
  weightTone: TrainingCompletionTone;
  resultLines: TrainingCompletionResultLine[];
}

export interface TrainingCompletionResultLine {
  label: string;
  tone: TrainingCompletionTone;
}

export function buildTrainingCompletionSummary(
  input: BuildTrainingCompletionSummaryInput,
): TrainingCompletionSummary {
  const savedAt = normalizeDate(input.savedAt);
  const startedAt = normalizeDate(input.workoutStartedAt);
  const durationMinutes = calculateWorkoutDurationMinutes(startedAt, savedAt);

  return {
    sessionId: input.sessionId,
    dayLabel: input.dayLabel,
    statusLabel: input.statusLabel ?? "Completado",
    workoutName: input.workoutName,
    cycleLabel: input.cycleLabel,
    weekLabel: input.weekLabel,
    progressLabel: input.progressLabel,
    durationMinutes,
    durationLabel: formatDurationLabel(durationMinutes),
    exercises: input.exercises.map((exercise) => buildExerciseSummary({
      exercise,
      currentDate: input.currentDate,
      historical: input.historicalByExerciseId?.[exercise.exerciseId],
    })),
  };
}

export function calculateWorkoutDurationMinutes(startedAt: Date | null, savedAt: Date | null) {
  if (!startedAt || !savedAt) return null;
  const diffMs = savedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const minutes = Math.round(diffMs / 60000);
  if (!Number.isFinite(minutes)) return null;
  return minutes;
}

export function formatDurationLabel(minutes: number | null) {
  if (minutes === null) return "Duración no disponible";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

function buildExerciseSummary(input: {
  exercise: TrainingCompletionExerciseInput;
  currentDate: string;
  historical?: TrainingCompletionHistoricalInput;
}): TrainingCompletionExerciseSummary {
  const draft = input.exercise.draft ?? {};
  const currentReps = normalizeReps(draft.reps ?? []);
  const currentSeriesCount = currentReps.length;
  const currentTotalReps = currentReps.reduce((total, item) => total + item, 0);
  const currentWeight = readNonNegativeNumber(draft.weight);
  const historical = input.historical ?? { status: "first_reference" as const, latest: null };
  const previous = historical.status === "ready" && historical.latest
    ? summarizeHistoricalPerformance(historical.latest)
    : null;
  const previousWeight = previous?.weight.value ?? null;
  const repsDifference = previous?.totalReps !== null && previous?.totalReps !== undefined
    ? sanitizeDifference(currentTotalReps - previous.totalReps)
    : null;
  const weightDifference = previousWeight !== null && currentWeight !== null
    ? sanitizeDifference(currentWeight - previousWeight)
    : null;
  const comparisonStatus = historical.status;
  const repsTone = getDifferenceTone(repsDifference);
  const weightTone = getDifferenceTone(weightDifference);

  return {
    exerciseId: input.exercise.exerciseId,
    exerciseLineageId: input.exercise.exerciseLineageId ?? null,
    exerciseName: input.exercise.exerciseName,
    currentDate: input.currentDate,
    currentDateLabel: formatShortDate(input.currentDate),
    currentSeriesCount,
    currentTotalReps,
    currentWeight,
    currentWeightLabel: currentWeight !== null ? formatKg(currentWeight) : "—",
    previousDate: historical.latest?.trainedDate ?? null,
    previousDateLabel: historical.latest?.trainedDate ? formatShortDate(historical.latest.trainedDate) : "",
    previousSeriesCount: previous?.seriesCount ?? null,
    previousTotalReps: previous?.totalReps ?? null,
    previousWeightLabel: previous?.weight.label ?? "—",
    repsDifference,
    weightDifference,
    comparisonStatus,
    repsTone,
    weightTone,
    resultLines: buildResultLines({
      comparisonStatus,
      repsDifference,
      weightDifference,
    }),
  };
}

function summarizeHistoricalPerformance(performance: LatestExercisePerformance) {
  const reps = normalizeReps(performance.series.map((series) => series.reps));
  const weights = performance.series.map((series) => readNonNegativeNumber(series.weight)).filter(isNumber);
  const weight = summarizeHistoricalWeight(weights);
  return {
    seriesCount: reps.length,
    totalReps: reps.length > 0 ? reps.reduce((total, item) => total + item, 0) : null,
    weight,
  };
}

function summarizeHistoricalWeight(weights: number[]) {
  if (weights.length === 0) return { value: null, label: "—" };
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  if (min === max) return { value: min, label: formatKg(min) };
  return { value: null, label: `${formatDecimalEs(min)}-${formatDecimalEs(max)} kg` };
}

function buildResultLines(input: {
  comparisonStatus: TrainingCompletionComparisonStatus;
  repsDifference: number | null;
  weightDifference: number | null;
}): TrainingCompletionResultLine[] {
  if (input.comparisonStatus === "first_reference") {
    return [
      { label: "Este será tu punto de partida.", tone: "neutral" },
      { label: "Cuando completes la próxima semana, podrás comparar tu progreso.", tone: "neutral" },
    ];
  }
  if (input.comparisonStatus === "unavailable") {
    return [{ label: "Comparación no disponible", tone: "neutral" }];
  }

  if (input.repsDifference === 0 && input.weightDifference === 0) {
    return [{ label: "Sin diferencias", tone: "neutral" }];
  }

  const lines: TrainingCompletionResultLine[] = [];
  if (input.repsDifference !== null) lines.push(formatRepsDifference(input.repsDifference));
  if (input.weightDifference !== null) lines.push(formatWeightDifference(input.weightDifference));
  return lines.length > 0 ? lines : [{ label: "Sin diferencias", tone: "neutral" }];
}

function formatRepsDifference(value: number): TrainingCompletionResultLine {
  if (value === 0) return { label: "Sin diferencias", tone: "neutral" };
  const amount = Math.abs(value);
  return {
    label: `${value > 0 ? "+" : "-"}${formatDecimalEs(amount)} ${amount === 1 ? "rep" : "reps"}`,
    tone: getDifferenceTone(value),
  };
}

function formatWeightDifference(value: number): TrainingCompletionResultLine {
  if (value === 0) return { label: "Sin diferencias", tone: "neutral" };
  const amount = Math.abs(value);
  return {
    label: `${value > 0 ? "+" : "-"}${formatDecimalEs(amount)} kg`,
    tone: getDifferenceTone(value),
  };
}

function getDifferenceTone(value: number | null): TrainingCompletionTone {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "danger";
}

function sanitizeDifference(value: number) {
  if (!Number.isFinite(value)) return null;
  const rounded = roundDecimal(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeReps(values: Array<number | "" | null | undefined>) {
  return values.flatMap((value) => {
    const parsed = readNonNegativeNumber(value);
    return parsed === null ? [] : [parsed];
  });
}

function readNonNegativeNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return roundDecimal(parsed);
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(value: string) {
  const dateKeyMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (dateKeyMatch) return `${dateKeyMatch[3]}/${dateKeyMatch[2]}`;
  const date = normalizeDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit" }).format(date).replace("-", "/");
}

function isNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}
