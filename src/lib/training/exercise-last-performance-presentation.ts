import type {
  LatestExercisePerformance,
  LatestExercisePerformanceSeries,
} from "@/lib/training/exercise-last-performance-repository";

export interface ExerciseLastPerformancePlannedInput {
  targetSets?: number | null;
  targetReps?: number | string | null;
  baseWeight?: number | null;
}

export interface ExerciseLastPerformancePresentationInput {
  planned: ExerciseLastPerformancePlannedInput;
  latest: LatestExercisePerformance | null;
  loading?: boolean;
  error?: string | null;
}

export interface ExerciseLastPerformanceSeriesRow {
  label: string;
  value: string;
}

export type ExerciseLastPerformancePresentationStatus =
  | "loading"
  | "found"
  | "empty"
  | "error";

export interface ExerciseLastPerformancePresentation {
  status: ExerciseLastPerformancePresentationStatus;
  objectiveText: string;
  todayGoalText: string;
  lastHeaderText: string;
  lastSummaryText: string;
  seriesDetailTitle: string;
  comparisonText: string;
  comparisonTone: "positive" | "negative" | "neutral";
  seriesRows: ExerciseLastPerformanceSeriesRow[];
}

export function buildExerciseLastPerformancePresentation(
  input: ExerciseLastPerformancePresentationInput,
): ExerciseLastPerformancePresentation {
  const planned = normalizePlannedExercise(input.planned);
  const objectiveText = formatPlannedObjective(planned);
  const plannedGoalText = formatTodayGoal(planned);

  if (input.loading) {
    return {
      status: "loading",
      objectiveText,
      todayGoalText: "Preparando tu referencia anterior",
      lastHeaderText: "DETALLE DE SERIES",
      lastSummaryText: "Cargando referencia",
      seriesDetailTitle: "Ver detalle de series",
      comparisonText: "Cargando referencia anterior",
      comparisonTone: "neutral",
      seriesRows: [],
    };
  }

  if (input.error) {
    return {
      status: "error",
      objectiveText,
      todayGoalText: "Completa tu objetivo de hoy; revisaremos la referencia luego",
      lastHeaderText: "DETALLE DE SERIES",
      lastSummaryText: "Historial no disponible",
      seriesDetailTitle: "Detalle de series no disponible",
      comparisonText: "Comparación no disponible",
      comparisonTone: "neutral",
      seriesRows: [],
    };
  }

  if (!input.latest) {
    return {
      status: "empty",
      objectiveText,
      todayGoalText: "Tu primera referencia se guardará al finalizar",
      lastHeaderText: "DETALLE DE SERIES",
      lastSummaryText: "Sin registros anteriores",
      seriesDetailTitle: "Sin registros anteriores",
      comparisonText: "Tu primera referencia se guardará al finalizar",
      comparisonTone: "neutral",
      seriesRows: [],
    };
  }

  const historical = summarizeHistoricalPerformance(input.latest.series);
  const comparison = formatTodayVsLast(planned, historical);
  const dateLabel = formatLocalTrainingDate(input.latest.trainedDate);

  return {
    status: "found",
    objectiveText,
    todayGoalText: formatProgressGoal(planned, historical, plannedGoalText),
    lastHeaderText: dateLabel ? `DETALLE DE SERIES · ${dateLabel}` : "DETALLE DE SERIES",
    lastSummaryText: formatHistoricalSummary(historical),
    seriesDetailTitle: dateLabel ? `Ver detalle de series · ${dateLabel}` : "Ver detalle de series",
    comparisonText: comparison.text,
    comparisonTone: comparison.tone,
    seriesRows: formatSeriesRows(input.latest.series),
  };
}

export function formatLocalTrainingDate(value: string | null | undefined): string {
  const date = parseLocalDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" })
    .format(date)
    .replace(/\./g, "")
    .toUpperCase();
}

interface NormalizedPlannedExercise {
  targetSets: number | null;
  targetReps: PlannedReps;
  baseWeight: number | null;
}

interface PlannedReps {
  label: string;
  min: number | null;
  max: number | null;
  isRange: boolean;
}

interface HistoricalSummary {
  weights: number[];
  reps: number[];
  totalReps: number | null;
  representativeWeight: number | null;
}

function normalizePlannedExercise(input: ExerciseLastPerformancePlannedInput): NormalizedPlannedExercise {
  return {
    targetSets: readPositiveNumber(input.targetSets),
    targetReps: readPlannedReps(input.targetReps),
    baseWeight: readNumber(input.baseWeight),
  };
}

function formatPlannedObjective(planned: NormalizedPlannedExercise) {
  const parts: string[] = [];

  if (planned.targetSets !== null && planned.targetReps.label) {
    parts.push(`${planned.targetSets} × ${planned.targetReps.label}`);
  } else if (planned.targetSets !== null) {
    parts.push(`${planned.targetSets} series`);
  } else if (planned.targetReps.label) {
    parts.push(`${planned.targetReps.label} reps`);
  }

  if (planned.baseWeight !== null) {
    parts.push(formatWeight(planned.baseWeight));
  }

  return parts.length > 0 ? parts.join(" · ") : "Objetivo definido para este ejercicio";
}

function formatTodayGoal(planned: NormalizedPlannedExercise) {
  if (planned.targetSets === null || planned.targetReps.min === null || planned.targetReps.max === null) {
    return "Completa el objetivo definido para este ejercicio";
  }

  const minTotal = planned.targetSets * planned.targetReps.min;
  const maxTotal = planned.targetSets * planned.targetReps.max;
  const weightSuffix = planned.baseWeight !== null ? ` con ${formatWeight(planned.baseWeight)}` : "";

  if (planned.targetReps.isRange || minTotal !== maxTotal) {
    return `Completar entre ${minTotal} y ${maxTotal} reps${weightSuffix}`;
  }

  return `Completar ${minTotal} reps${weightSuffix}`;
}

function summarizeHistoricalPerformance(series: LatestExercisePerformanceSeries[]): HistoricalSummary {
  const weights = series.map((item) => readNumber(item.weight)).filter(isNumber);
  const reps = series.map((item) => readNumber(item.reps)).filter(isNumber);

  return {
    weights,
    reps,
    totalReps: reps.length > 0 ? reps.reduce((total, item) => total + item, 0) : null,
    representativeWeight: weights.length > 0 ? Math.max(...weights) : null,
  };
}

function formatHistoricalSummary(summary: HistoricalSummary) {
  const parts: string[] = [];
  const weightSummary = formatHistoricalWeightSummary(summary.weights);
  if (weightSummary) parts.push(weightSummary);
  if (summary.reps.length > 0) parts.push(`${summary.reps.map(formatNumber).join(" / ")} reps`);
  return parts.length > 0 ? parts.join(" · ") : "Sin datos comparables";
}

function formatHistoricalWeightSummary(weights: number[]) {
  if (weights.length === 0) return "";
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  if (min === max) return formatWeight(max);
  return `${formatNumber(min)}-${formatNumber(max)} kg`;
}

function formatSeriesRows(series: LatestExercisePerformanceSeries[]): ExerciseLastPerformanceSeriesRow[] {
  return series.map((item, index) => {
    const parts: string[] = [];
    const reps = readNumber(item.reps);
    const rir = item.rir?.trim();

    if (reps !== null) parts.push(`${formatNumber(reps)} ${reps === 1 ? "repetición" : "repeticiones"}`);
    if (rir) parts.push(`RIR ${rir}`);

    return {
      label: `Serie ${index + 1}`,
      value: parts.length > 0 ? parts.join(" · ") : "Sin datos registrados",
    };
  });
}

function formatProgressGoal(
  planned: NormalizedPlannedExercise,
  historical: HistoricalSummary,
  fallbackGoal: string,
) {
  const plannedTotalReps = planned.targetSets !== null && planned.targetReps.min !== null && planned.targetReps.max !== null
    ? planned.targetSets * planned.targetReps.max
    : null;

  if (historical.totalReps === null) {
    return "Tu primera referencia se guardará al finalizar";
  }

  if (plannedTotalReps === null) {
    return fallbackGoal === "Completa el objetivo definido para este ejercicio"
      ? "Intenta superar tu última referencia con buena técnica"
      : fallbackGoal;
  }

  const repsDiff = plannedTotalReps - historical.totalReps;
  if (repsDiff > 0) {
    return `Sacar las mismas repeticiones o ${formatNumber(repsDiff)} más vs la semana pasada`;
  }

  return "Igualar o superar tu última referencia";
}

function formatTodayVsLast(planned: NormalizedPlannedExercise, historical: HistoricalSummary) {
  const parts: string[] = [];
  const tones: Array<"positive" | "negative" | "neutral"> = [];

  if (planned.baseWeight !== null && historical.representativeWeight !== null) {
    const diff = planned.baseWeight - historical.representativeWeight;
    parts.push(diff === 0 ? "Mismo peso" : `${formatSignedNumber(diff)} kg`);
    tones.push(readTone(diff));
  }

  const plannedTotalReps = planned.targetSets !== null && planned.targetReps.min !== null && planned.targetReps.max !== null
    ? planned.targetSets * planned.targetReps.max
    : null;

  if (plannedTotalReps !== null && historical.totalReps !== null) {
    const diff = plannedTotalReps - historical.totalReps;
    parts.push(diff === 0 ? "Mismas reps" : `${formatSignedNumber(diff)} ${Math.abs(diff) === 1 ? "rep" : "reps"}`);
    tones.push(readTone(diff));
  }

  if (parts.length === 0) {
    return { text: "Aún no hay datos comparables", tone: "neutral" as const };
  }

  return {
    text: parts.join(" · "),
    tone: tones.includes("negative") ? "negative" as const : tones.includes("positive") ? "positive" as const : "neutral" as const,
  };
}

function readPlannedReps(value: number | string | null | undefined): PlannedReps {
  if (typeof value === "number") {
    const parsed = readPositiveNumber(value);
    return parsed === null
      ? { label: "", min: null, max: null, isRange: false }
      : { label: formatNumber(parsed), min: parsed, max: parsed, isRange: false };
  }

  const trimmed = value?.trim();
  if (!trimmed) return { label: "", min: null, max: null, isRange: false };

  const range = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/);
  if (range) {
    const first = readPositiveNumber(range[1]);
    const second = readPositiveNumber(range[2]);
    if (first !== null && second !== null) {
      const min = Math.min(first, second);
      const max = Math.max(first, second);
      return { label: `${formatNumber(min)}-${formatNumber(max)}`, min, max, isRange: true };
    }
  }

  const single = readPositiveNumber(trimmed);
  return single === null
    ? { label: trimmed, min: null, max: null, isRange: false }
    : { label: formatNumber(single), min: single, max: single, isRange: false };
}

function parseLocalDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readPositiveNumber(value: unknown) {
  const parsed = readNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

function formatWeight(value: number) {
  return `${formatNumber(value)} kg`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value);
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function readTone(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}
