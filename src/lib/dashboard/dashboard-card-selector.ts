import type { DashboardCardId, DashboardCardVisibility } from "@/lib/dashboard/dashboard-types";

/**
 * Reproduce exactamente las tres ramas de visibilidad de `DashboardScreen`
 * (organizatech-app.tsx): sin plan de rutina, con plan pero sin progreso
 * registrado, y la vista completa — y la derivación de `carouselDays` /
 * `dashboardDay` (selección de día). No se invierte ninguna condición ni se
 * agrega un cuarto estado.
 */

export const DASHBOARD_CARD_ORDER: readonly DashboardCardId[] = [
  "metrics",
  "weekly-progress",
  "training-carousel",
  "coach",
];

export interface ResolveDashboardCardVisibilityInput {
  hasRoutinePlan: boolean;
  hasTrainingEntries: boolean;
  /** Gatilla `showEmptyRoutineAction` en la rama "sin progreso" (igual a `hasTodayRoutine`). */
  hasTodayRoutine: boolean;
  /** Gatilla `showTrainingCardAction` en la vista completa (igual a `activeDayData.hasRoutine`). */
  activeDayHasRoutine: boolean;
}

/**
 * Igual a los tres `return`/gates de `DashboardScreen`:
 * - `!hasRoutinePlan` → solo `EmptyDashboard` (ningún card).
 * - `!hasTrainingEntries` → carrusel + `showEmptyRoutineAction` (botón "Ir a rutina de
 *   entrenamiento" dentro de `.dashboard-empty-progress`, condicionado por `hasTodayRoutine`);
 *   sin grilla de métricas, sin card de progreso semanal, sin card de Coach, y SIN
 *   `showTrainingCardAction` (ese botón no existe en esta rama).
 * - de lo contrario → vista completa; `showTrainingCardAction` (botón dinámico dentro de
 *   `.dashboard-training-card`) se condiciona por `activeDayHasRoutine`, y `showEmptyRoutineAction`
 *   es siempre `false` (ese card no existe en esta rama).
 */
export function resolveDashboardCardVisibility(
  input: ResolveDashboardCardVisibilityInput,
): DashboardCardVisibility {
  if (!input.hasRoutinePlan) {
    return {
      emptyState: "no-plan",
      showMetricGrid: false,
      showWeeklyProgressCard: false,
      showTrainingCarousel: false,
      showEmptyRoutineAction: false,
      showTrainingCardAction: false,
      showCoachCard: false,
    };
  }

  if (!input.hasTrainingEntries) {
    return {
      emptyState: "no-entries",
      showMetricGrid: false,
      showWeeklyProgressCard: false,
      showTrainingCarousel: true,
      showEmptyRoutineAction: input.hasTodayRoutine,
      showTrainingCardAction: false,
      showCoachCard: false,
    };
  }

  return {
    emptyState: null,
    showMetricGrid: true,
    showWeeklyProgressCard: true,
    showTrainingCarousel: true,
    showEmptyRoutineAction: false,
    showTrainingCardAction: input.activeDayHasRoutine,
    showCoachCard: true,
  };
}

/** Lista ordenada de los cards de nivel superior que corresponde mostrar, según `visibility`. */
export function resolveVisibleDashboardCards(visibility: DashboardCardVisibility): DashboardCardId[] {
  return DASHBOARD_CARD_ORDER.filter((id) => {
    if (id === "metrics") return visibility.showMetricGrid;
    if (id === "weekly-progress") return visibility.showWeeklyProgressCard;
    if (id === "training-carousel") return visibility.showTrainingCarousel;
    if (id === "coach") return visibility.showCoachCard;
    return false;
  });
}

/** Igual a `carouselDays = hasRoutinePlan ? weekDays : [day]`. */
export function resolveDashboardCarouselDays(
  hasRoutinePlan: boolean,
  planDays: readonly string[],
  singleDay: string,
): string[] {
  return hasRoutinePlan ? [...planDays] : [singleDay];
}

export interface ResolveDashboardActiveDayInput {
  dashboardDayOverride: string;
  calendarDashboardDay: string;
  carouselDays: readonly string[];
}

/**
 * Igual a la cadena de prioridad de `dashboardDay` (organizatech-app.tsx):
 * override explícito → día calendario (si está en el carrusel) → primer día
 * del carrusel → fallback al día calendario.
 */
export function resolveDashboardActiveDay(input: ResolveDashboardActiveDayInput): string {
  if (input.carouselDays.includes(input.dashboardDayOverride)) {
    return input.dashboardDayOverride;
  }
  if (input.carouselDays.includes(input.calendarDashboardDay)) {
    return input.calendarDashboardDay;
  }
  return input.carouselDays[0] ?? input.calendarDashboardDay;
}
