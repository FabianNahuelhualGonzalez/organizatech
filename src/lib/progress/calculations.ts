import type {
  ExerciseEntry,
  ExerciseMetrics,
  KgStatus,
  ObjectiveStatus,
  SmartInsight,
  WeeklySummary,
} from "./types";
import { formatSignedDecimal, roundDecimal } from "./weight-format";

export function calculateKgStatus(kgDifference: number): KgStatus {
  const rounded = roundDecimal(kgDifference);
  if (rounded > 0) return "Kg aumentado";
  if (rounded < 0) return "Kg disminuido";
  return "Mismo kg";
}

export interface ObjectiveEvaluationInput {
  targetSets: number;
  targetReps: number;
  targetWeight: number;
  actualReps: number[];
  actualWeight: number;
}

export function calculateObjectiveStatus(repsDifference: number, kgDifference: number): ObjectiveStatus {
  const roundedKgDifference = roundDecimal(kgDifference);
  if (repsDifference < 0 || roundedKgDifference < 0) return "No cumplimos";
  if (repsDifference > 0 || roundedKgDifference > 0) return "Mejoramos";
  return "Cumplimos";
}

export function evaluateExerciseObjective(input: ObjectiveEvaluationInput): ObjectiveStatus {
  const targetSets = Math.max(0, input.targetSets);
  const targetReps = Math.max(0, input.targetReps);
  const plannedReps = input.actualReps.slice(0, targetSets);
  const completedSets = plannedReps.filter((reps) => reps > 0).length;
  const setsDifference = completedSets - targetSets;
  const repsShortfall = plannedReps.some((reps) => reps < targetReps);
  const kgDifference = roundDecimal(input.actualWeight - input.targetWeight);

  if (setsDifference < 0 || repsShortfall || kgDifference < 0) return "No cumplimos";

  const repsImproved = plannedReps.some((reps) => reps > targetReps);
  const setsImproved = input.actualReps.length > targetSets;
  if (kgDifference > 0 || repsImproved || setsImproved) return "Mejoramos";

  return "Cumplimos";
}

export function getObjectiveStatusLabel(status: ObjectiveStatus) {
  if (status === "Mejoramos") return "Cumplimos · Mejoramos";
  return status;
}

export function isObjectiveMet(status: ObjectiveStatus) {
  return status === "Cumplimos" || status === "Mejoramos";
}

export function isObjectiveImproved(status: ObjectiveStatus) {
  return status === "Mejoramos";
}

export function calculateSetDifference(actualReps: number[], targetSets: number) {
  return actualReps.filter((reps) => reps > 0).length - targetSets;
}

export function calculateRepDifference(actualReps: number[], targetReps: number, targetSets: number) {
  return actualReps.slice(0, targetSets).reduce((total, reps) => total + (reps - targetReps), 0);
}

export function calculateKgDifference(actualWeight: number, targetWeight: number) {
  return roundDecimal(actualWeight - targetWeight);
}

export function calculateVolume(totalReps: number, weight: number) {
  return roundDecimal(totalReps * weight);
}

export function calculateVolumePercentage(volumeDifference: number, previousVolume: number) {
  return previousVolume > 0 ? roundDecimal((volumeDifference / previousVolume) * 100) : 0;
}

export function calculateLegacyObjectiveStatus(repsDifference: number, kgDifference: number): ObjectiveStatus {
  const roundedKgDifference = roundDecimal(kgDifference);
  if (repsDifference < 0 || roundedKgDifference < 0) return "No cumplimos";
  if (repsDifference > 0 || roundedKgDifference > 0) return "Mejoramos";
  return "Cumplimos";
}

export function calculateExerciseMetrics(entry: ExerciseEntry, previous?: ExerciseMetrics): ExerciseMetrics {
  const totalReps = entry.reps.reduce((total, reps) => total + reps, 0);
  const targetTotalReps = entry.targetSets * entry.targetReps;
  const completedSets = entry.reps.filter((reps) => reps > 0).length;
  const setsDifference = calculateSetDifference(entry.reps, entry.targetSets);
  const repsDifference = calculateRepDifference(entry.reps, entry.targetReps, entry.targetSets);
  const kgDifference = calculateKgDifference(entry.weight, entry.previousWeight);
  const volumeTotal = calculateVolume(totalReps, entry.weight);
  const previousVolume = previous?.volumeTotal ?? calculateVolume(targetTotalReps, entry.previousWeight);
  const volumeDifference = roundDecimal(volumeTotal - previousVolume);
  const volumePercentage = calculateVolumePercentage(volumeDifference, previousVolume);
  const objectiveStatus = evaluateExerciseObjective({
    targetSets: entry.targetSets,
    targetReps: entry.targetReps,
    targetWeight: entry.previousWeight,
    actualReps: entry.reps,
    actualWeight: entry.weight,
  });

  return {
    ...entry,
    targetTotalReps,
    totalReps,
    completedSets,
    setsDifference,
    repsDifference,
    kgDifference,
    kgStatus: calculateKgStatus(kgDifference),
    objectiveStatus,
    volumeTotal,
    volumeDifference,
    volumePercentage,
  };
}

export function calculateWeeklyComparison(entries: ExerciseEntry[]): ExerciseMetrics[] {
  const sorted = [...entries].sort((a, b) => a.week - b.week || a.exerciseName.localeCompare(b.exerciseName));
  const lastByExercise = new Map<string, ExerciseMetrics>();

  return sorted.map((entry) => {
    const previous = lastByExercise.get(entry.exerciseId);
    const metrics = calculateExerciseMetrics(entry, previous);
    lastByExercise.set(entry.exerciseId, metrics);
    return metrics;
  });
}

export function calculateWeeklySummary(metrics: ExerciseMetrics[], week: number): WeeklySummary {
  const current = metrics.filter((entry) => entry.week === week);
  const previous = metrics.filter((entry) => entry.week === week - 1);
  const previousVolume = previous.reduce((total, entry) => total + entry.volumeTotal, 0);
  const previousReps = previous.reduce((total, entry) => total + entry.totalReps, 0);
  const volumeTotal = current.reduce((total, entry) => total + entry.volumeTotal, 0);
  const totalReps = current.reduce((total, entry) => total + entry.totalReps, 0);
  const fallbackVolumeDifference = current.reduce((total, entry) => total + entry.volumeDifference, 0);
  const fallbackPreviousVolume = volumeTotal - fallbackVolumeDifference;
  const fallbackRepsDifference = current.reduce((total, entry) => total + entry.repsDifference, 0);
  const hasPreviousWeek = previous.length > 0;
  const objectivesOk = current.filter((entry) => isObjectiveMet(entry.objectiveStatus)).length;
  const objectivesFailed = current.filter((entry) => entry.objectiveStatus === "No cumplimos").length;
  const objectivesMaintained = current.filter((entry) => entry.objectiveStatus === "Cumplimos").length;
  const volumeDifference = roundDecimal(hasPreviousWeek ? volumeTotal - previousVolume : fallbackVolumeDifference);
  const comparisonVolume = hasPreviousWeek ? previousVolume : fallbackPreviousVolume;

  return {
    week,
    volumeTotal,
    totalReps,
    exerciseCount: current.length,
    objectivesOk,
    objectivesFailed,
    objectivesMaintained,
    volumeDifference,
    volumePercentage: calculateVolumePercentage(volumeDifference, comparisonVolume),
    repsDifference: hasPreviousWeek ? totalReps - previousReps : fallbackRepsDifference,
    exerciseDifference: hasPreviousWeek ? current.length - previous.length : 0,
    complianceRate: current.length > 0 ? Math.round((objectivesOk / current.length) * 100) : 0,
  };
}

export function generateSmartInsights(summary: WeeklySummary, current: ExerciseMetrics[]): SmartInsight[] {
  const bestVolume = [...current].sort((a, b) => b.volumePercentage - a.volumePercentage)[0];
  const risk = current.find((entry) => entry.objectiveStatus === "No cumplimos" && entry.repsDifference <= -4);
  const loadIncreases = current.filter((entry) => entry.kgDifference > 0).length;

  return [
    loadIncreases > 0
      ? {
          id: "load",
          tone: "positivo",
          title: `Aumentaste carga en ${loadIncreases} ejercicio${loadIncreases === 1 ? "" : "s"}`,
          detail: "Buen progreso. El sistema prioriza el aumento de peso aunque bajen algunas repeticiones.",
        }
      : {
          id: "load",
          tone: "info",
          title: "Carga estable esta semana",
          detail: "Mantener peso puede ser correcto si estás consolidando técnica y repeticiones.",
        },
    {
      id: "volume",
      tone: summary.volumeDifference >= 0 ? "positivo" : "alerta",
      title: summary.volumeDifference >= 0 ? "Tu volumen semanal mejoró" : "Tu volumen semanal bajó",
      detail: `${formatSigned(summary.volumePercentage)}% respecto de la semana anterior.`,
    },
    {
      id: "consistency",
      tone: summary.complianceRate >= 60 ? "positivo" : "alerta",
      title: summary.complianceRate >= 60 ? "Consistencia sólida" : "Cumplimiento por mejorar",
      detail: `${summary.objectivesOk} de ${summary.exerciseCount} ejercicios quedaron en Cumplimos.`,
    },
    risk
      ? {
          id: "risk",
          tone: "riesgo",
          title: "Posible fatiga detectada",
          detail: `${risk.exerciseName}: ${risk.repsDifference} repeticiones contra el objetivo base.`,
        }
      : {
          id: "risk",
          tone: "positivo",
          title: "Sin caídas críticas",
          detail: "No aparecen pérdidas fuertes de repeticiones en los ejercicios principales.",
        },
    bestVolume
      ? {
          id: "best",
          tone: "info",
          title: "Ejercicio con mayor progreso",
          detail: `${bestVolume.exerciseName}: ${formatSigned(bestVolume.volumePercentage)}% de mejora en volumen.`,
        }
      : {
          id: "best",
          tone: "info",
          title: "Aún no hay historial suficiente",
          detail: "Registra más entrenamientos para detectar tendencias claras.",
        },
  ];
}

export function formatSigned(value: number, digits = 0) {
  const rounded = roundDecimal(Number(value.toFixed(digits)));
  return formatSignedDecimal(rounded);
}
