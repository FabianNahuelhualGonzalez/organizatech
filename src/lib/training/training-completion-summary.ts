import { formatDecimalEs, formatKg, roundDecimal } from "@/lib/progress/weight-format";
import type { ExerciseTemplate, TrainingSession } from "@/lib/progress/types";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";
import {
  normalizeExerciseDraft,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";

export type TrainingCompletionComparisonStatus = "ready" | "first_reference" | "unavailable" | "pending";
export type TrainingCompletionTone = "positive" | "danger" | "neutral";
export type TrainingCompletionExerciseState = "up" | "down" | "eq" | "new" | "pending";

export interface TrainingCompletionExerciseDraftInput {
  weight?: string | number | null;
  reps?: Array<number | "" | null | undefined>;
  registered?: boolean;
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

export interface TrainingCompletionComparedExercise extends TrainingCompletionExerciseSummary {
  state: TrainingCompletionExerciseState;
}

export interface TrainingCompletionComparison {
  exercises: TrainingCompletionComparedExercise[];
  registered: number;
  total: number;
  increased: number;
  decreased: number;
  equal: number;
  hasComparison: boolean;
  previousDateLabel: string;
  previousTotalReps: number;
  currentTotalReps: number;
  totalRepsDifference: number;
}

export interface TrainingCompletionResultLine {
  label: string;
  tone: TrainingCompletionTone;
}

export function buildTrainingCompletionHistoricalInputsFromSessions(input: {
  currentSessionId: string;
  currentDate: string;
  cycleId?: string | null;
  cycleDayId?: string | null;
  plannedDay?: TrainingSession["plannedDay"];
  routine: string;
  exercises: readonly Pick<ExerciseTemplate, "id" | "trainingCycleExerciseId" | "exerciseLineageId">[];
  sessions: readonly TrainingSession[];
}): Record<string, TrainingCompletionHistoricalInput> {
  const previousSession = selectPreviousTrainingCompletionSession(input);

  return Object.fromEntries(input.exercises.map((exercise) => {
    if (!previousSession) {
      return [exercise.id, { status: "first_reference", latest: null } satisfies TrainingCompletionHistoricalInput];
    }

    const exerciseIds = new Set([exercise.id, exercise.trainingCycleExerciseId].filter(isNonEmptyString));
    const entries = previousSession.entries.filter((entry) =>
      exerciseIds.has(entry.exerciseId) ||
      (entry.trainingCycleExerciseId ? exerciseIds.has(entry.trainingCycleExerciseId) : false)
    );
    if (entries.length === 0) {
      return [exercise.id, { status: "first_reference", latest: null } satisfies TrainingCompletionHistoricalInput];
    }

    const historicalTimestamp = previousSession.completedAt ?? previousSession.trainedAt ?? previousSession.trainedDate;
    const latest: LatestExercisePerformance = {
      sessionId: previousSession.id,
      exerciseLineageId: exercise.exerciseLineageId ?? entries[0]?.exerciseLineageId ?? exercise.id,
      trainedDate: previousSession.trainedDate,
      trainedAt: previousSession.trainedAt,
      completedAt: previousSession.completedAt ?? null,
      createdAt: historicalTimestamp,
      series: entries.flatMap((entry) => entry.reps.map((reps, index) => ({
        entryId: `${entry.id}:${index}`,
        order: index + 1,
        weight: readNonNegativeNumber(entry.weight),
        previousWeight: readNonNegativeNumber(entry.previousWeight),
        reps: readNonNegativeNumber(reps),
        rir: entry.rir ?? null,
        notes: entry.notes ?? null,
        createdAt: historicalTimestamp,
      }))),
    };
    return [exercise.id, { status: "ready", latest } satisfies TrainingCompletionHistoricalInput];
  }));
}

export function buildTrainingCompletionExerciseInputs(input: {
  exercises: readonly ExerciseTemplate[];
  drafts: Readonly<Record<string, ExerciseDraft | undefined>>;
}): TrainingCompletionExerciseInput[] {
  return input.exercises.map((exercise) => {
    const draft = normalizeExerciseDraft(exercise, input.drafts[exercise.id]);
    return {
      exerciseId: exercise.id,
      exerciseLineageId: exercise.exerciseLineageId ?? null,
      exerciseName: exercise.name,
      targetSets: exercise.targetSets,
      draft: {
        weight: draft.weight,
        reps: [...draft.reps],
        registered: draft.registered,
      },
    };
  });
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

export function compareTrainingCompletionSummary(
  summary: Pick<TrainingCompletionSummary, "exercises">,
): TrainingCompletionComparison {
  const exercises = summary.exercises.map((exercise): TrainingCompletionComparedExercise => {
    if (exercise.comparisonStatus === "pending") return { ...exercise, state: "pending" };
    if (exercise.comparisonStatus !== "ready") return { ...exercise, state: "new" };
    if (exercise.repsTone === "positive") return { ...exercise, state: "up" };
    if (exercise.repsTone === "danger") return { ...exercise, state: "down" };
    if (exercise.weightTone === "positive") return { ...exercise, state: "up" };
    if (exercise.weightTone === "danger") return { ...exercise, state: "down" };
    return { ...exercise, state: "eq" };
  });
  const comparables = exercises.filter((exercise) =>
    exercise.state === "up" || exercise.state === "down" || exercise.state === "eq"
  );
  const previousTotalReps = comparables.reduce(
    (total, exercise) => total + (exercise.previousTotalReps ?? 0),
    0,
  );
  const currentTotalReps = comparables.reduce(
    (total, exercise) => total + exercise.currentTotalReps,
    0,
  );

  return {
    exercises,
    registered: exercises.filter((exercise) => exercise.state !== "pending").length,
    total: exercises.length,
    increased: exercises.filter((exercise) => exercise.state === "up").length,
    decreased: exercises.filter((exercise) => exercise.state === "down").length,
    equal: exercises.filter((exercise) => exercise.state === "eq").length,
    hasComparison: comparables.length > 0,
    previousDateLabel: comparables.find((exercise) => exercise.previousDateLabel)?.previousDateLabel ?? "",
    previousTotalReps,
    currentTotalReps,
    totalRepsDifference: currentTotalReps - previousTotalReps,
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
  const currentSeriesCount = draft.registered === false
    ? Math.max(0, Math.trunc(input.exercise.targetSets ?? 0))
    : currentReps.length;
  const currentTotalReps = currentReps.reduce((total, item) => total + item, 0);
  const currentWeight = readNonNegativeNumber(draft.weight);
  const historical = input.historical ?? { status: "first_reference" as const, latest: null };
  const comparisonStatus = draft.registered === false ? "pending" : historical.status;
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

function selectPreviousTrainingCompletionSession(input: {
  currentSessionId: string;
  currentDate: string;
  cycleId?: string | null;
  cycleDayId?: string | null;
  plannedDay?: TrainingSession["plannedDay"];
  routine: string;
  sessions: readonly TrainingSession[];
}) {
  return input.sessions
    .filter((session) => {
      if (session.id === input.currentSessionId || session.status !== "completed" || session.deletedAt) return false;
      if (toDateKey(session.trainedDate) > toDateKey(input.currentDate)) return false;
      if (input.cycleDayId) {
        return session.cycleDayId === input.cycleDayId && (!input.cycleId || session.cycleId === input.cycleId);
      }
      return session.plannedDay === input.plannedDay && session.routine === input.routine;
    })
    .sort((left, right) => getTrainingSessionTime(right) - getTrainingSessionTime(left) || right.id.localeCompare(left.id))[0] ?? null;
}

function getTrainingSessionTime(session: TrainingSession) {
  const value = Date.parse(session.completedAt ?? session.trainedAt ?? session.trainedDate);
  return Number.isFinite(value) ? value : 0;
}

function toDateKey(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? value;
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
  if (input.comparisonStatus === "pending") {
    return [{ label: "Sin registro", tone: "neutral" }];
  }
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

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}
