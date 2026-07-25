import assert from "node:assert/strict";

import {
  DASHBOARD_CARD_ORDER,
  resolveDashboardActiveDay,
  resolveDashboardCardVisibility,
  resolveDashboardCarouselDays,
  resolveVisibleDashboardCards,
} from "@/lib/dashboard/dashboard-card-selector";

// CASO 1 — Dashboard sin datos: sin plan de rutina, ningún card se muestra y ningún botón aparece.
function testNoRoutinePlanShowsNoCards() {
  const visibility = resolveDashboardCardVisibility({
    hasRoutinePlan: false,
    hasTrainingEntries: false,
    hasTodayRoutine: false,
    activeDayHasRoutine: false,
  });

  assert.deepEqual(visibility, {
    emptyState: "no-plan",
    showMetricGrid: false,
    showWeeklyProgressCard: false,
    showTrainingCarousel: false,
    showEmptyRoutineAction: false,
    showTrainingCardAction: false,
    showCoachCard: false,
  });
  assert.deepEqual(resolveVisibleDashboardCards(visibility), []);
}

// CASO 2 — Dashboard con rutina pero sin entrenamiento activo (aún no hay progreso registrado):
// carrusel visible, sin grilla de métricas, sin card de progreso semanal, sin Coach. Solo el
// botón del card vacío ("Ir a rutina de entrenamiento") puede aparecer en esta rama; el botón
// del card de entrenamiento (dinámico) NUNCA aparece aquí.
function testRoutinePlanWithoutTrainingEntriesShowsOnlyCarouselAndEmptyRoutineAction() {
  const visibilityWithTodayRoutine = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: false,
    hasTodayRoutine: true,
    activeDayHasRoutine: true,
  });
  assert.deepEqual(visibilityWithTodayRoutine, {
    emptyState: "no-entries",
    showMetricGrid: false,
    showWeeklyProgressCard: false,
    showTrainingCarousel: true,
    showEmptyRoutineAction: true,
    showTrainingCardAction: false,
    showCoachCard: false,
  });
  assert.deepEqual(resolveVisibleDashboardCards(visibilityWithTodayRoutine), ["training-carousel"]);

  const visibilityWithoutTodayRoutine = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: false,
    hasTodayRoutine: false,
    activeDayHasRoutine: true,
  });
  assert.equal(
    visibilityWithoutTodayRoutine.showEmptyRoutineAction,
    false,
    "en la rama sin progreso, el botón vacío se rige por hasTodayRoutine",
  );
  assert.equal(
    visibilityWithoutTodayRoutine.showTrainingCardAction,
    false,
    "el botón del card de entrenamiento nunca aparece en la rama sin progreso, aunque activeDayHasRoutine sea true",
  );
}

// Vista completa: rutina con entrenamiento activo — todos los cards habilitados; el botón del
// card de entrenamiento se rige por activeDayHasRoutine; el botón vacío nunca aparece aquí.
function testFullDashboardShowsAllCardsInFixedOrder() {
  const visibility = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: true,
    hasTodayRoutine: true,
    activeDayHasRoutine: true,
  });

  assert.deepEqual(visibility, {
    emptyState: null,
    showMetricGrid: true,
    showWeeklyProgressCard: true,
    showTrainingCarousel: true,
    showEmptyRoutineAction: false,
    showTrainingCardAction: true,
    showCoachCard: true,
  });
  // CASO 6 — Orden estable de tarjetas.
  assert.deepEqual(resolveVisibleDashboardCards(visibility), [...DASHBOARD_CARD_ORDER]);
}

// Vista completa sin rutina para el día activo: el botón del card de entrenamiento se oculta,
// y el botón vacío sigue sin aparecer (ese card no existe en esta rama).
function testFullDashboardHidesTrainingCardActionWhenActiveDayHasNoRoutine() {
  const visibility = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: true,
    hasTodayRoutine: true,
    activeDayHasRoutine: false,
  });
  assert.equal(visibility.showTrainingCardAction, false);
  assert.equal(visibility.showEmptyRoutineAction, false, "el botón vacío no existe en la vista completa");
  assert.equal(visibility.showCoachCard, true, "el card de Coach no depende de la rutina del día activo");
}

// Los dos botones son independientes: cada uno solo existe en su propia rama, nunca ambos a la vez.
function testTheTwoActionButtonsAreMutuallyExclusiveByBranch() {
  const noEntriesBranch = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: false,
    hasTodayRoutine: true,
    activeDayHasRoutine: true,
  });
  const fullBranch = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: true,
    hasTodayRoutine: true,
    activeDayHasRoutine: true,
  });

  assert.equal(noEntriesBranch.showEmptyRoutineAction && noEntriesBranch.showTrainingCardAction, false);
  assert.equal(fullBranch.showEmptyRoutineAction && fullBranch.showTrainingCardAction, false);
  assert.ok(!(noEntriesBranch.showTrainingCardAction), "en la rama sin progreso jamás se activa el botón del card de entrenamiento");
  assert.ok(!(fullBranch.showEmptyRoutineAction), "en la vista completa jamás se activa el botón vacío");
}

// CASO 6 (paridad) — el orden de resolveVisibleDashboardCards es siempre el mismo
// subconjunto de DASHBOARD_CARD_ORDER, sin reordenar según los flags de entrada.
function testCardOrderIsStableRegardlessOfInputOrder() {
  const visibilityA = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: true,
    hasTodayRoutine: true,
    activeDayHasRoutine: true,
  });
  const visibilityB = resolveDashboardCardVisibility({
    hasRoutinePlan: true,
    hasTrainingEntries: true,
    hasTodayRoutine: false,
    activeDayHasRoutine: false,
  });
  assert.deepEqual(resolveVisibleDashboardCards(visibilityA), ["metrics", "weekly-progress", "training-carousel", "coach"]);
  assert.deepEqual(resolveVisibleDashboardCards(visibilityB), ["metrics", "weekly-progress", "training-carousel", "coach"]);
}

// carouselDays = hasRoutinePlan ? weekDays : [day]
function testResolveDashboardCarouselDaysMirrorsProduction() {
  assert.deepEqual(
    resolveDashboardCarouselDays(true, ["Lunes", "Martes", "Miércoles"], "Lunes"),
    ["Lunes", "Martes", "Miércoles"],
  );
  assert.deepEqual(resolveDashboardCarouselDays(false, ["Lunes", "Martes"], "Jueves"), ["Jueves"]);
}

// CASO 13 — Selección de día: prioridad override → día calendario → primer día del carrusel → fallback.
function testResolveDashboardActiveDayPriorityChain() {
  assert.equal(
    resolveDashboardActiveDay({
      dashboardDayOverride: "Miércoles",
      calendarDashboardDay: "Lunes",
      carouselDays: ["Lunes", "Martes", "Miércoles"],
    }),
    "Miércoles",
    "el override explícito gana si está en el carrusel",
  );

  assert.equal(
    resolveDashboardActiveDay({
      dashboardDayOverride: "Sábado",
      calendarDashboardDay: "Martes",
      carouselDays: ["Lunes", "Martes", "Miércoles"],
    }),
    "Martes",
    "si el override no está en el carrusel, usa el día calendario cuando está presente",
  );

  assert.equal(
    resolveDashboardActiveDay({
      dashboardDayOverride: "Sábado",
      calendarDashboardDay: "Domingo",
      carouselDays: ["Lunes", "Martes", "Miércoles"],
    }),
    "Lunes",
    "si ni el override ni el día calendario están en el carrusel, usa el primer día del carrusel",
  );

  assert.equal(
    resolveDashboardActiveDay({
      dashboardDayOverride: "Sábado",
      calendarDashboardDay: "Domingo",
      carouselDays: [],
    }),
    "Domingo",
    "si el carrusel está vacío, cae de vuelta al día calendario",
  );
}

// CASO 14 — Inmutabilidad: no debe mutarse ningún arreglo/objeto de entrada.
function testDoesNotMutateInputs() {
  const planDays = ["Lunes", "Martes"];
  const planDaysSnapshot = [...planDays];
  resolveDashboardCarouselDays(true, planDays, "Lunes");
  assert.deepEqual(planDays, planDaysSnapshot);

  const carouselDays = ["Lunes", "Martes"];
  const carouselDaysSnapshot = [...carouselDays];
  resolveDashboardActiveDay({ dashboardDayOverride: "Martes", calendarDashboardDay: "Lunes", carouselDays });
  assert.deepEqual(carouselDays, carouselDaysSnapshot);

  const visibilityInput = { hasRoutinePlan: true, hasTrainingEntries: true, hasTodayRoutine: true, activeDayHasRoutine: true };
  const visibilityInputSnapshot = { ...visibilityInput };
  resolveDashboardCardVisibility(visibilityInput);
  assert.deepEqual(visibilityInput, visibilityInputSnapshot);
}

// CASO 15 — Misma entrada produce misma salida (determinismo).
function testSameInputProducesSameOutput() {
  const input = { hasRoutinePlan: true, hasTrainingEntries: false, hasTodayRoutine: true, activeDayHasRoutine: false };
  assert.deepEqual(resolveDashboardCardVisibility(input), resolveDashboardCardVisibility({ ...input }));
  assert.deepEqual(
    resolveDashboardActiveDay({ dashboardDayOverride: "Lunes", calendarDashboardDay: "Martes", carouselDays: ["Lunes", "Martes"] }),
    resolveDashboardActiveDay({ dashboardDayOverride: "Lunes", calendarDashboardDay: "Martes", carouselDays: ["Lunes", "Martes"] }),
  );
}

testNoRoutinePlanShowsNoCards();
testRoutinePlanWithoutTrainingEntriesShowsOnlyCarouselAndEmptyRoutineAction();
testFullDashboardShowsAllCardsInFixedOrder();
testFullDashboardHidesTrainingCardActionWhenActiveDayHasNoRoutine();
testTheTwoActionButtonsAreMutuallyExclusiveByBranch();
testCardOrderIsStableRegardlessOfInputOrder();
testResolveDashboardCarouselDaysMirrorsProduction();
testResolveDashboardActiveDayPriorityChain();
testDoesNotMutateInputs();
testSameInputProducesSameOutput();

console.log("dashboard-card-selector tests passed");
