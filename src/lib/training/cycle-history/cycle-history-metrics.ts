import type {
  CycleHistoryBreakdown,
  CycleHistoryMetricsSummary,
  CycleHistoryVolumeProgress,
} from "@/lib/training/cycle-history/cycle-history-types";

export function calculateCycleHistoryWeeklyVolume(breakdown: CycleHistoryBreakdown): Record<number, number> {
  const weeklyVolume: Record<number, number> = {};

  for (const routine of breakdown.routines) {
    for (const exercise of routine.exercises) {
      for (const registration of Object.values(exercise.weeks)) {
        weeklyVolume[registration.week] = (weeklyVolume[registration.week] ?? 0) + registration.volume;
      }
    }
  }

  return weeklyVolume;
}

export function calculateCycleHistoryTotalVolume(breakdown: CycleHistoryBreakdown): number {
  const weeklyVolume = calculateCycleHistoryWeeklyVolume(breakdown);
  return Object.values(weeklyVolume).reduce((total, volume) => total + volume, 0);
}

export function calculateCycleHistoryVolumeProgress(breakdown: CycleHistoryBreakdown): CycleHistoryVolumeProgress {
  const weeklyVolume = calculateCycleHistoryWeeklyVolume(breakdown);
  const weeksWithData = Object.keys(weeklyVolume)
    .map(Number)
    .sort((a, b) => a - b);

  if (weeksWithData.length < 2) {
    return {
      state: "insufficient_data",
      firstWeek: weeksWithData[0] ?? null,
      lastWeek: weeksWithData[0] ?? null,
      firstWeekVolume: weeksWithData[0] !== undefined ? weeklyVolume[weeksWithData[0]] : null,
      lastWeekVolume: weeksWithData[0] !== undefined ? weeklyVolume[weeksWithData[0]] : null,
      differenceKg: null,
    };
  }

  const firstWeek = weeksWithData[0];
  const lastWeek = weeksWithData[weeksWithData.length - 1];
  const firstWeekVolume = weeklyVolume[firstWeek];
  const lastWeekVolume = weeklyVolume[lastWeek];
  const differenceKg = lastWeekVolume - firstWeekVolume;

  return {
    state: differenceKg > 0 ? "increase" : differenceKg < 0 ? "decrease" : "unchanged",
    firstWeek,
    lastWeek,
    firstWeekVolume,
    lastWeekVolume,
    differenceKg,
  };
}

export function describeCycleHistoryVolumeProgress(progress: CycleHistoryVolumeProgress): string {
  switch (progress.state) {
    case "increase":
      return `Aumentaste ${formatKgAmount(progress.differenceKg ?? 0)} kg de volumen entre tu primera y última semana registrada.`;
    case "decrease":
      return `Disminuiste ${formatKgAmount(Math.abs(progress.differenceKg ?? 0))} kg de volumen entre tu primera y última semana registrada.`;
    case "unchanged":
      return "Mantuviste el mismo volumen entre tu primera y última semana registrada.";
    case "insufficient_data":
      return "Necesitas al menos dos semanas registradas para calcular tu progreso.";
    default:
      return "Necesitas al menos dos semanas registradas para calcular tu progreso.";
  }
}

export function countCycleHistoryRegisteredExercises(breakdown: CycleHistoryBreakdown): number {
  const identityKeys = new Set<string>();

  for (const routine of breakdown.routines) {
    for (const exercise of routine.exercises) {
      if (Object.keys(exercise.weeks).length === 0) continue;
      identityKeys.add(`${exercise.identity.kind}:${exercise.identity.key}`);
    }
  }

  return identityKeys.size;
}

export function buildCycleHistoryMetricsSummary(breakdown: CycleHistoryBreakdown): CycleHistoryMetricsSummary {
  const weeklyVolumeKg = calculateCycleHistoryWeeklyVolume(breakdown);

  return {
    totalVolumeKg: Object.values(weeklyVolumeKg).reduce((total, volume) => total + volume, 0),
    registeredExerciseCount: countCycleHistoryRegisteredExercises(breakdown),
    weeklyVolumeKg,
    volumeProgress: calculateCycleHistoryVolumeProgress(breakdown),
  };
}

function formatKgAmount(value: number): string {
  return Math.round(value).toLocaleString("es-CL");
}
