import type {
  ExerciseComparisonSummary,
  ExerciseHistoryPoint,
  ExerciseMetrics,
  ExerciseTrend,
} from "./types";
import { formatSignedKg, roundDecimal } from "./weight-format";

export function getExerciseHistory(records: ExerciseMetrics[], exerciseIdOrName: string): ExerciseMetrics[] {
  const key = normalizeExerciseKey(exerciseIdOrName);

  return records
    .filter((record) => record.exerciseId === exerciseIdOrName || normalizeExerciseKey(record.exerciseName) === key)
    .sort((a, b) => compareExerciseHistoryRecords(a, b));
}

export function getFirstExerciseRecord(history: ExerciseMetrics[]) {
  return history[0];
}

export function getLatestExerciseRecord(history: ExerciseMetrics[]) {
  return history.at(-1);
}

export function calculateExerciseWeightGain(firstRecord?: ExerciseMetrics, latestRecord?: ExerciseMetrics) {
  if (!firstRecord || !latestRecord) return 0;
  return roundDecimal(latestRecord.weight - firstRecord.weight);
}

export function calculateBestExerciseWeight(history: ExerciseMetrics[]) {
  return [...history].sort((a, b) => b.weight - a.weight || compareExerciseHistoryRecords(b, a))[0];
}

export function calculateExerciseVolumeTrend(history: ExerciseMetrics[]) {
  const first = getFirstExerciseRecord(history);
  const latest = getLatestExerciseRecord(history);
  if (!first || !latest) return 0;
  return latest.volumeTotal - first.volumeTotal;
}

export function calculateExerciseTrend(firstRecord?: ExerciseMetrics, latestRecord?: ExerciseMetrics, totalRecords = 0): ExerciseTrend {
  if (!firstRecord || !latestRecord || totalRecords <= 1) return "Información insuficiente";
  if (latestRecord.weight > firstRecord.weight) return "Mejora";
  if (latestRecord.weight < firstRecord.weight) return "Retroceso";
  return "Mantenimiento";
}

export function buildExerciseComparisonSummary(history: ExerciseMetrics[], fallbackName = "Ejercicio"): ExerciseComparisonSummary | null {
  if (history.length === 0) return null;

  const sorted = [...history].sort((a, b) => compareExerciseHistoryRecords(a, b));
  const first = getFirstExerciseRecord(sorted);
  const latest = getLatestExerciseRecord(sorted);

  if (!first || !latest) return null;

  const best = calculateBestExerciseWeight(sorted) ?? latest;
  const weightGain = calculateExerciseWeightGain(first, latest);
  const trend = calculateExerciseTrend(first, latest, sorted.length);
  const historyPoints = sorted.map(toExerciseHistoryPoint);
  const summary: ExerciseComparisonSummary = {
    exerciseName: latest.exerciseName || first.exerciseName || fallbackName,
    firstWeight: first.weight,
    firstDate: first.date,
    firstTotalReps: first.totalReps,
    firstVolumeTotal: first.volumeTotal,
    latestWeight: latest.weight,
    latestDate: latest.date,
    latestTotalReps: latest.totalReps,
    latestVolumeTotal: latest.volumeTotal,
    weightGain,
    bestWeight: best.weight,
    bestWeightDate: best.date,
    totalRecords: sorted.length,
    trend,
    insight: "",
    history: historyPoints,
  };

  return {
    ...summary,
    insight: generateExerciseHistoryInsight(summary),
  };
}

export function generateExerciseHistoryInsight(summary: ExerciseComparisonSummary) {
  const exerciseName = summary.exerciseName.toLowerCase();
  const repsDifference = summary.latestTotalReps - summary.firstTotalReps;
  const volumeDifference = summary.latestVolumeTotal - summary.firstVolumeTotal;

  if (summary.totalRecords <= 1) {
    return `Este es tu primer registro de ${exerciseName}. A medida que registres más entrenamientos, podremos mostrar una evolución más completa.`;
  }

  if (summary.weightGain > 0 && repsDifference < 0) {
    return `Aumentaste ${formatSignedKg(summary.weightGain)} desde tu primer registro de ${exerciseName}. Aunque las repeticiones variaron, tu carga actual muestra una mejora clara respecto al inicio.`;
  }

  if (summary.weightGain > 0) {
    return `Aumentaste ${formatSignedKg(summary.weightGain)} desde tu primer registro de ${exerciseName}. Tu evolución muestra una mejora sostenida en carga.`;
  }

  if (summary.weightGain === 0 && volumeDifference > 0) {
    return `Mantienes el mismo peso en ${exerciseName}, pero el volumen subió. Es una señal positiva si la técnica se mantiene firme.`;
  }

  if (summary.weightGain === 0) {
    return `Mantienes el mismo peso desde el primer registro de ${exerciseName}. Puedes intentar una progresión controlada si la técnica se siente firme.`;
  }

  return `El peso actual está por debajo del registro inicial de ${exerciseName}. Revisa si hubo pausa, fatiga o cambio de objetivo antes de interpretar el resultado como retroceso.`;
}

function toExerciseHistoryPoint(record: ExerciseMetrics): ExerciseHistoryPoint {
  return {
    date: record.date,
    weekLabel: `Semana ${record.week}`,
    weight: record.weight,
    totalReps: record.totalReps,
    volumeTotal: record.volumeTotal,
  };
}

function compareExerciseHistoryRecords(a: ExerciseMetrics, b: ExerciseMetrics) {
  const dateCompare = new Date(a.date).getTime() - new Date(b.date).getTime();
  return dateCompare || a.week - b.week || a.id.localeCompare(b.id);
}

function normalizeExerciseKey(value: string) {
  return value.trim().toLowerCase();
}
