import type {
  ExerciseEntry,
  ExerciseMetrics,
  KgStatus,
  ObjectiveStatus,
  SmartInsight,
  WeeklySummary,
} from "./types";

export function calculateKgStatus(kgDifference: number): KgStatus {
  if (kgDifference > 0) return "Kg aumentado";
  if (kgDifference < 0) return "Kg disminuido";
  return "Mismo kg";
}

export function calculateObjectiveStatus(repsDifference: number, kgDifference: number): ObjectiveStatus {
  if (repsDifference > 0) return "Cumplimos";
  if (kgDifference > 0) return "Cumplimos";
  if (repsDifference === 0 && kgDifference === 0) return "Mantenemos esfuerzo";
  if (repsDifference < 0 && kgDifference === 0) return "No cumplimos";
  if (kgDifference < 0) return "No cumplimos";
  return "Mantenemos esfuerzo";
}

export function calculateExerciseMetrics(entry: ExerciseEntry, previous?: ExerciseMetrics): ExerciseMetrics {
  const totalReps = entry.reps.reduce((total, reps) => total + reps, 0);
  const targetTotalReps = entry.targetSets * entry.targetReps;
  const repsDifference = totalReps === 0 ? 0 : totalReps - targetTotalReps;
  const kgDifference = entry.weight - entry.previousWeight;
  const volumeTotal = totalReps * entry.weight;
  const previousVolume = previous?.volumeTotal ?? targetTotalReps * entry.previousWeight;
  const volumeDifference = volumeTotal - previousVolume;
  const volumePercentage = previousVolume > 0 ? (volumeDifference / previousVolume) * 100 : 0;

  return {
    ...entry,
    targetTotalReps,
    totalReps,
    repsDifference,
    kgDifference,
    kgStatus: calculateKgStatus(kgDifference),
    objectiveStatus: calculateObjectiveStatus(repsDifference, kgDifference),
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
  const objectivesOk = current.filter((entry) => entry.objectiveStatus === "Cumplimos").length;
  const objectivesFailed = current.filter((entry) => entry.objectiveStatus === "No cumplimos").length;
  const objectivesMaintained = current.filter((entry) => entry.objectiveStatus === "Mantenemos esfuerzo").length;
  const volumeDifference = volumeTotal - previousVolume;

  return {
    week,
    volumeTotal,
    totalReps,
    exerciseCount: current.length,
    objectivesOk,
    objectivesFailed,
    objectivesMaintained,
    volumeDifference,
    volumePercentage: previousVolume > 0 ? (volumeDifference / previousVolume) * 100 : 0,
    repsDifference: totalReps - previousReps,
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
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}
