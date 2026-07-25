import type { ExerciseEntry, ExerciseMetrics, ExerciseTemplate, WeeklySummary } from "@/lib/progress/types";
import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import type {
  TrainingCarouselCardModel,
  TrainingCarouselStatus,
} from "@/lib/training/training-carousel-card-presentation";
import type { CoachComparisonStatus, TrainingCoachFeedback } from "@/lib/training/training-coach-feedback";

/**
 * Tipos puros para el dominio Dashboard/Carrusel — espejo exacto de las formas
 * usadas hoy en `organizatech-app.tsx` (DashboardTrainingCardData, AnalyticsSnapshot,
 * el ternario de `coachVisualStatus`). No se importa nada de `organizatech-app.tsx`;
 * los tipos productivos ausentes de una lib (p.ej. `TrainingPlan`, `AnalyticsSnapshot`)
 * se representan aquí con formas mínimas/equivalentes.
 */

export type { ExerciseEntry, ExerciseMetrics, ExerciseTemplate, WeeklySummary };
export type { WeeklyEquivalentProgressResult };
export type { TrainingCarouselCardModel, TrainingCarouselStatus };
export type { CoachComparisonStatus, TrainingCoachFeedback };

/**
 * Igual a la forma real retornada por `getDashboardDayData` (organizatech-app.tsx:4348-4361),
 * consumida estructuralmente por `buildDashboardTrainingCardModel`. Incluye `hasRoutine` e
 * `isCompleted` porque ambos son parte de esa salida productiva real y no son derivables de
 * `exercises.length` (p.ej. `hasRoutine = itemExercises.length > 0 || isCompleted`: puede ser
 * `true` con `exercises` vacío cuando el día ya está completado).
 */
export interface DashboardTrainingCardData {
  day: string;
  status: TrainingCarouselStatus;
  registeredCount: number;
  plannedCount: number;
  isToday: boolean;
  exercises: ExerciseTemplate[];
  metrics: ExerciseMetrics[];
  pendingExercises: ExerciseTemplate[];
  hasRoutine: boolean;
  isCompleted: boolean;
}

/** Igual a `AnalyticsSnapshot` (organizatech-app.tsx). */
export interface DashboardAnalyticsSnapshot {
  score: number;
  factors: Array<[string, number]>;
}

export type DashboardCardId = "metrics" | "weekly-progress" | "training-carousel" | "coach";

export type DashboardEmptyState = "no-plan" | "no-entries" | null;

/**
 * `showEmptyRoutineAction` = botón "Ir a rutina de entrenamiento" dentro de `.dashboard-empty-progress`
 * (gatillado por `hasTodayRoutine`, solo existe en la rama "sin progreso").
 * `showTrainingCardAction` = botón dinámico (Ver resumen/Ir a rutina/Continuar rutina) dentro de
 * `.dashboard-training-card` (gatillado por `activeDayData.hasRoutine`, solo existe en la vista completa).
 * Son dos botones distintos, en cards distintos, activos en ramas mutuamente excluyentes.
 */
export interface DashboardCardVisibility {
  emptyState: DashboardEmptyState;
  showMetricGrid: boolean;
  showWeeklyProgressCard: boolean;
  showTrainingCarousel: boolean;
  showEmptyRoutineAction: boolean;
  showTrainingCardAction: boolean;
  showCoachCard: boolean;
}

/** Igual a la forma de `coachVisualStatus` (organizatech-app.tsx). */
export interface DashboardCoachVisualStatus {
  showScore: boolean;
  showFactors: boolean;
  label: string;
  detail: string;
  factorLabel: string;
  badgeLabel?: string;
}
