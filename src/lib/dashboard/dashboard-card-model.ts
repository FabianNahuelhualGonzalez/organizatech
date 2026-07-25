import { formatKg } from "@/lib/progress/weight-format";
import {
  buildTrainingCarouselCardModel,
  resolveTrainingCarouselAction,
  type TrainingCarouselCardModel,
} from "@/lib/training/training-carousel-card-presentation";
import type {
  DashboardAnalyticsSnapshot,
  DashboardTrainingCardData,
  ExerciseMetrics,
  WeeklySummary,
} from "@/lib/dashboard/dashboard-types";

/**
 * Reproduce exactamente `buildDashboardTrainingCardModel` y `buildAnalytics`/
 * `clampScore` (organizatech-app.tsx), delegando en los módulos ya existentes
 * (`buildTrainingCarouselCardModel`, `resolveTrainingCarouselAction`,
 * `formatKg`) sin duplicar su lógica.
 */

/** Igual a `buildDashboardTrainingCardModel`. */
export function buildDashboardTrainingCardModel(itemData: DashboardTrainingCardData): TrainingCarouselCardModel {
  const action = resolveTrainingCarouselAction(itemData.status);
  const plannedRows = itemData.metrics.length > 0 ? itemData.pendingExercises : itemData.exercises;

  return buildTrainingCarouselCardModel({
    day: itemData.day,
    routineName: itemData.exercises[0]?.routine ?? null,
    status: itemData.status,
    isToday: itemData.isToday,
    registeredCount: itemData.registeredCount,
    plannedCount: itemData.plannedCount,
    registeredExercises: itemData.metrics,
    plannedExercises: plannedRows,
    actionLabel: action.label,
    maxVisibleExercises: 4,
    formatWeight: formatKg,
  });
}

/** Igual a `clampScore`. */
export function clampDashboardScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Igual a `buildAnalytics`. */
export function buildDashboardCoachAnalytics(
  summary: WeeklySummary,
  currentMetrics: ExerciseMetrics[],
): DashboardAnalyticsSnapshot {
  const targetReps = currentMetrics.reduce((total, entry) => total + entry.targetTotalReps, 0);
  const completedWithLoad = currentMetrics.filter((entry) => entry.totalReps > 0 && entry.kgDifference >= 0).length;
  const repsScore = targetReps > 0 ? clampDashboardScore((summary.totalReps / targetReps) * 100) : 0;
  const loadScore = currentMetrics.length > 0 ? clampDashboardScore((completedWithLoad / currentMetrics.length) * 100) : 0;
  const volumeScore = clampDashboardScore(100 + summary.volumePercentage);
  const score = Math.round(
    summary.complianceRate * 0.4 +
      repsScore * 0.25 +
      loadScore * 0.2 +
      volumeScore * 0.15,
  );
  const factors: Array<[string, number]> = [
    ["Cumplimiento ejercicios", summary.complianceRate],
    ["Repeticiones logradas", repsScore],
    ["Carga mantenida/subida", loadScore],
    ["Volumen vs objetivo/semana anterior", volumeScore],
  ];
  return { score, factors };
}

/** Igual al clamp de factores en `DashboardCoachCard`: `Math.min(100, Math.max(0, Number(value) || 0))`. */
export function clampDashboardCoachFactorValue(value: number): number {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

/** Igual a `getCoachFactorLabel`. */
export function resolveDashboardCoachFactorLabel(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("cumplimiento")) return "Cumplimiento";
  if (normalized.includes("repeticiones")) return "Reps";
  if (normalized.includes("carga")) return "Carga";
  if (normalized.includes("volumen")) return "Volumen";
  return label;
}
