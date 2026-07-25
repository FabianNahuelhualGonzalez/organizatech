import type {
  CoachComparisonStatus,
  DashboardCoachVisualStatus,
  ExerciseEntry,
  ExerciseMetrics,
  TrainingCoachFeedback,
  WeeklyEquivalentProgressResult,
} from "@/lib/dashboard/dashboard-types";

/**
 * Textos y estado visual derivados, portados verbatim desde
 * `organizatech-app.tsx`: `buildWeeklyProgressAriaLabel`,
 * `buildWeeklyProgressTrendLabel`, `feedbackHeadlineForStatus`,
 * `buildEmptyCurrentWeekCoachFeedback` y el ternario de `coachVisualStatus`.
 * Ningún texto ni condición fue reinterpretado.
 */

/** Igual al texto de overflow del carrusel: `"+ {n} ejercicios más"` (siempre plural, sin variante singular). */
export function buildDashboardOverflowLabel(additionalExerciseCount: number): string | null {
  return additionalExerciseCount > 0 ? `+ ${additionalExerciseCount} ejercicios más` : null;
}

/** Igual a `aria-label={`Resumen de entrenamiento ${model.day}`}` en la tabla de la tarjeta. */
export function buildDashboardCarouselTableAriaLabel(day: string): string {
  return `Resumen de entrenamiento ${day}`;
}

/** Igual a `aria-label="Posición del carrusel"` en `IndexDots`. */
export const DASHBOARD_DOTS_ARIA_LABEL = "Posición del carrusel";

/** Igual a `buildWeeklyProgressAriaLabel`. */
export function buildWeeklyProgressAriaLabel(progress: WeeklyEquivalentProgressResult): string {
  if (progress.currentEquivalentValue <= 0) return "Progreso semanal: sin datos suficientes para comparar";
  if (progress.status === "ready") {
    return `Progreso semanal: diferencia ${progress.primaryLabel}; semana actual ${progress.currentVolumeLabel}; semana anterior ${progress.previousVolumeLabel}`;
  }
  if (progress.status === "no_previous") {
    return `Progreso semanal: volumen acumulado actual ${progress.primaryLabel}; sin comparación anterior`;
  }
  return "Progreso semanal: sin datos suficientes para comparar";
}

/** Igual a `buildWeeklyProgressTrendLabel`. */
export function buildWeeklyProgressTrendLabel(progress: WeeklyEquivalentProgressResult): string {
  if (progress.differenceValue > 0) return "Vas por encima del ritmo de la semana anterior";
  if (progress.differenceValue < 0) return "Vas por debajo del ritmo de la semana anterior";
  return "Mantienes un ritmo similar a la semana anterior";
}

/** Igual a `feedbackHeadlineForStatus`. */
export function feedbackHeadlineForStatus(feedback: TrainingCoachFeedback): string {
  if (feedback.tone === "warning") return "Revisar progreso";
  if (feedback.tone === "positive") return "Buen avance";
  return feedback.headline;
}

/** Igual a `buildEmptyCurrentWeekCoachFeedback`. */
export function buildEmptyCurrentWeekCoachFeedback(): TrainingCoachFeedback {
  return {
    headline: "Nueva semana iniciada",
    summary: "Aún no hay entrenamientos registrados esta semana. Cuando completes tu primera sesión, Organizatech podrá analizar tu progreso.",
    strengths: [],
    attentions: [],
    nextAdvice: "Registra tu próximo entrenamiento para crear la base de esta semana.",
    tone: "neutral",
    confidence: "low",
    contradictionsResolved: [],
    sourceSignals: ["current_week_empty"],
  };
}

/** Igual a `hasCurrentWeekTrainingRecords`/`hasCurrentWeekMetricRecords`/`isCurrentWeekEmptyCoach`. */
export function resolveIsCurrentWeekEmptyCoach(
  entries: readonly ExerciseEntry[],
  metrics: readonly ExerciseMetrics[],
  currentWeek: number,
): boolean {
  const hasCurrentWeekTrainingRecords = entries.some(
    (entry) => entry.week === currentWeek && entry.reps.some((rep) => rep > 0),
  );
  const hasCurrentWeekMetricRecords = metrics.some((metric) => metric.totalReps > 0 || metric.volumeTotal > 0);
  return !hasCurrentWeekTrainingRecords && !hasCurrentWeekMetricRecords;
}

export interface ResolveDashboardCoachVisualStatusInput {
  isCurrentWeekEmptyCoach: boolean;
  comparisonStatus: CoachComparisonStatus;
  displayedCoachFeedback: TrainingCoachFeedback;
}

/** Igual al ternario que produce `coachVisualStatus`. */
export function resolveDashboardCoachVisualStatus(
  input: ResolveDashboardCoachVisualStatusInput,
): DashboardCoachVisualStatus {
  if (input.isCurrentWeekEmptyCoach) {
    return {
      showScore: false,
      showFactors: false,
      badgeLabel: "Semana nueva",
      label: "Sin registros esta semana",
      detail: "Completa tu primera sesión para generar una lectura de rendimiento.",
      factorLabel: "Datos disponibles",
    };
  }

  if (input.comparisonStatus === "ready") {
    return {
      showScore: true,
      showFactors: true,
      label: feedbackHeadlineForStatus(input.displayedCoachFeedback),
      detail: "Factores de rendimiento",
      factorLabel: "Factores de rendimiento",
    };
  }

  if (input.comparisonStatus === "first_reference") {
    return {
      showScore: false,
      showFactors: true,
      badgeLabel: "Base creada",
      label: "Punto de partida",
      detail: "Tu primera referencia de progreso",
      factorLabel: "Factores del registro actual",
    };
  }

  return {
    showScore: false,
    showFactors: true,
    badgeLabel: "Datos disponibles",
    label: "Sin historial suficiente",
    detail: "Registro actual",
    factorLabel: "Datos disponibles",
  };
}
