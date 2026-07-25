import assert from "node:assert/strict";

import {
  DASHBOARD_DOTS_ARIA_LABEL,
  buildDashboardCarouselTableAriaLabel,
  buildDashboardOverflowLabel,
  buildEmptyCurrentWeekCoachFeedback,
  buildWeeklyProgressAriaLabel,
  buildWeeklyProgressTrendLabel,
  feedbackHeadlineForStatus,
  resolveDashboardCoachVisualStatus,
  resolveIsCurrentWeekEmptyCoach,
} from "@/lib/dashboard/dashboard-presentation";
import type { ExerciseEntry, ExerciseMetrics, TrainingCoachFeedback, WeeklyEquivalentProgressResult } from "@/lib/dashboard/dashboard-types";

function buildProgress(overrides: Partial<WeeklyEquivalentProgressResult> = {}): WeeklyEquivalentProgressResult {
  return {
    ranges: {
      currentWeekStart: "2026-07-20",
      currentComparisonEnd: "2026-07-23",
      previousWeekStart: "2026-07-13",
      previousComparisonEnd: "2026-07-16",
      elapsedDayCount: 4,
      todayLabel: "J",
    },
    plannedDays: ["Lunes", "Martes"],
    previousFinalVolume: 1000,
    currentEquivalentValue: 1100,
    previousEquivalentValue: 1000,
    differenceValue: 100,
    percentage: 10,
    previousComparablePercentage: 0,
    primaryLabel: "+100 kg",
    previousLabel: "1000 kg",
    currentVolumeLabel: "1100 kg",
    previousVolumeLabel: "1000 kg",
    comparisonLabel: "Vs semana anterior",
    detailLabel: "Detalle",
    tone: "positive",
    status: "ready",
    points: [],
    ...overrides,
  };
}

function buildFeedback(overrides: Partial<TrainingCoachFeedback> = {}): TrainingCoachFeedback {
  return {
    headline: "Encabezado neutral",
    summary: "Resumen",
    strengths: [],
    attentions: [],
    nextAdvice: "Consejo",
    tone: "neutral",
    confidence: "medium",
    contradictionsResolved: [],
    sourceSignals: [],
    ...overrides,
  };
}

function buildEntry(overrides: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    id: "entry-1",
    exerciseId: "ex-1",
    exerciseName: "Sentadilla",
    routine: "Rutina A",
    week: 3,
    date: "2026-07-20",
    targetSets: 4,
    targetReps: 10,
    weight: 80,
    previousWeight: 75,
    reps: [10, 10, 10, 10],
    ...overrides,
  };
}

function buildMetric(overrides: Partial<ExerciseMetrics> = {}): ExerciseMetrics {
  return {
    ...buildEntry(),
    targetTotalReps: 40,
    totalReps: 40,
    completedSets: 4,
    setsDifference: 0,
    repsDifference: 0,
    kgDifference: 5,
    kgStatus: "Kg aumentado",
    objectiveStatus: "Cumplimos",
    volumeTotal: 3200,
    volumeDifference: 200,
    volumePercentage: 6.67,
    ...overrides,
  };
}

// CASO 1 — Dashboard sin datos: sin overflow, sin notificaciones fantasma en el texto derivado.
function testEmptyDashboardTextsProduceNoPhantomOutput() {
  assert.equal(buildDashboardOverflowLabel(0), null);
  assert.equal(buildDashboardOverflowLabel(-1), null);
}

function testOverflowLabelIsAlwaysPluralMatchingProduction() {
  assert.equal(buildDashboardOverflowLabel(1), "+ 1 ejercicios más", "producción no tiene variante singular, se preserva tal cual");
  assert.equal(buildDashboardOverflowLabel(3), "+ 3 ejercicios más");
}

// CASO 16 — Paridad de labels/textos ARIA.
function testAriaLabelsMatchProductionLiterals() {
  assert.equal(buildDashboardCarouselTableAriaLabel("Lunes"), "Resumen de entrenamiento Lunes");
  assert.equal(DASHBOARD_DOTS_ARIA_LABEL, "Posición del carrusel");
}

// CASO 4 — Progreso/comparación con datos ("ready"): usa las etiquetas de comparación.
function testWeeklyProgressAriaAndTrendWithData() {
  const progress = buildProgress({ status: "ready", currentEquivalentValue: 1100, differenceValue: 100 });
  assert.equal(
    buildWeeklyProgressAriaLabel(progress),
    "Progreso semanal: diferencia +100 kg; semana actual 1100 kg; semana anterior 1000 kg",
  );
  assert.equal(buildWeeklyProgressTrendLabel(progress), "Vas por encima del ritmo de la semana anterior");

  const negative = buildProgress({ status: "ready", differenceValue: -50 });
  assert.equal(buildWeeklyProgressTrendLabel(negative), "Vas por debajo del ritmo de la semana anterior");

  const flat = buildProgress({ status: "ready", differenceValue: 0 });
  assert.equal(buildWeeklyProgressTrendLabel(flat), "Mantienes un ritmo similar a la semana anterior");
}

// CASO 4 — Progreso/comparación sin datos suficientes: primero se evalúa currentEquivalentValue <= 0,
// luego "no_previous", y por defecto el mensaje de "sin datos suficientes".
function testWeeklyProgressAriaWithoutData() {
  assert.equal(
    buildWeeklyProgressAriaLabel(buildProgress({ currentEquivalentValue: 0 })),
    "Progreso semanal: sin datos suficientes para comparar",
  );
  assert.equal(
    buildWeeklyProgressAriaLabel(buildProgress({ currentEquivalentValue: 500, status: "no_previous", primaryLabel: "500 kg" })),
    "Progreso semanal: volumen acumulado actual 500 kg; sin comparación anterior",
  );
  assert.equal(
    buildWeeklyProgressAriaLabel(buildProgress({ currentEquivalentValue: 500, status: "neutral" })),
    "Progreso semanal: sin datos suficientes para comparar",
  );
}

// CASO 16 — Encabezado de feedback según tono (feedbackHeadlineForStatus).
function testFeedbackHeadlineForStatusMapsToneToLiteral() {
  assert.equal(feedbackHeadlineForStatus(buildFeedback({ tone: "warning", headline: "x" })), "Revisar progreso");
  assert.equal(feedbackHeadlineForStatus(buildFeedback({ tone: "positive", headline: "x" })), "Buen avance");
  assert.equal(feedbackHeadlineForStatus(buildFeedback({ tone: "neutral", headline: "Encabezado propio" })), "Encabezado propio");
}

// CASO 5 — Coach no disponible: semana actual sin entrenamientos ni métricas.
function testResolveIsCurrentWeekEmptyCoachDetectsNoData() {
  assert.equal(resolveIsCurrentWeekEmptyCoach([], [], 3), true);
  assert.equal(
    resolveIsCurrentWeekEmptyCoach([buildEntry({ week: 3, reps: [0, 0] })], [], 3),
    true,
    "reps en 0 no cuentan como registro de la semana actual",
  );
  assert.equal(
    resolveIsCurrentWeekEmptyCoach([buildEntry({ week: 2, reps: [10] })], [], 3),
    true,
    "un registro de otra semana no cuenta",
  );
}

// CASO 5 — Coach disponible: hay entrenamientos o métricas de la semana actual.
function testResolveIsCurrentWeekEmptyCoachDetectsData() {
  assert.equal(resolveIsCurrentWeekEmptyCoach([buildEntry({ week: 3, reps: [10] })], [], 3), false);
  assert.equal(resolveIsCurrentWeekEmptyCoach([], [buildMetric({ totalReps: 5 })], 3), false);
  assert.equal(resolveIsCurrentWeekEmptyCoach([], [buildMetric({ totalReps: 0, volumeTotal: 100 })], 3), false);
}

// CASO 5 — Coach: los cuatro estados visuales exactos (semana vacía / ready / first_reference / none).
function testResolveDashboardCoachVisualStatusFourBranches() {
  const emptyWeek = resolveDashboardCoachVisualStatus({
    isCurrentWeekEmptyCoach: true,
    comparisonStatus: "ready",
    displayedCoachFeedback: buildEmptyCurrentWeekCoachFeedback(),
  });
  assert.deepEqual(emptyWeek, {
    showScore: false,
    showFactors: false,
    badgeLabel: "Semana nueva",
    label: "Sin registros esta semana",
    detail: "Completa tu primera sesión para generar una lectura de rendimiento.",
    factorLabel: "Datos disponibles",
  });

  const ready = resolveDashboardCoachVisualStatus({
    isCurrentWeekEmptyCoach: false,
    comparisonStatus: "ready",
    displayedCoachFeedback: buildFeedback({ tone: "positive" }),
  });
  assert.deepEqual(ready, {
    showScore: true,
    showFactors: true,
    label: "Buen avance",
    detail: "Factores de rendimiento",
    factorLabel: "Factores de rendimiento",
  });

  const firstReference = resolveDashboardCoachVisualStatus({
    isCurrentWeekEmptyCoach: false,
    comparisonStatus: "first_reference",
    displayedCoachFeedback: buildFeedback(),
  });
  assert.deepEqual(firstReference, {
    showScore: false,
    showFactors: true,
    badgeLabel: "Base creada",
    label: "Punto de partida",
    detail: "Tu primera referencia de progreso",
    factorLabel: "Factores del registro actual",
  });

  const none = resolveDashboardCoachVisualStatus({
    isCurrentWeekEmptyCoach: false,
    comparisonStatus: "none",
    displayedCoachFeedback: buildFeedback(),
  });
  assert.deepEqual(none, {
    showScore: false,
    showFactors: true,
    badgeLabel: "Datos disponibles",
    label: "Sin historial suficiente",
    detail: "Registro actual",
    factorLabel: "Datos disponibles",
  });
}

// CASO 16 — El feedback de semana vacía coincide literalmente con producción.
function testBuildEmptyCurrentWeekCoachFeedbackMatchesProductionLiterals() {
  assert.deepEqual(buildEmptyCurrentWeekCoachFeedback(), {
    headline: "Nueva semana iniciada",
    summary: "Aún no hay entrenamientos registrados esta semana. Cuando completes tu primera sesión, Organizatech podrá analizar tu progreso.",
    strengths: [],
    attentions: [],
    nextAdvice: "Registra tu próximo entrenamiento para crear la base de esta semana.",
    tone: "neutral",
    confidence: "low",
    contradictionsResolved: [],
    sourceSignals: ["current_week_empty"],
  });
}

// CASO 14 — Inmutabilidad.
function testDoesNotMutateInputs() {
  const progress = buildProgress();
  const progressSnapshot = JSON.parse(JSON.stringify(progress));
  buildWeeklyProgressAriaLabel(progress);
  buildWeeklyProgressTrendLabel(progress);
  assert.deepEqual(progress, progressSnapshot);

  const entries = [buildEntry({ week: 3, reps: [10] })];
  const entriesSnapshot = JSON.parse(JSON.stringify(entries));
  const metrics = [buildMetric()];
  const metricsSnapshot = JSON.parse(JSON.stringify(metrics));
  resolveIsCurrentWeekEmptyCoach(entries, metrics, 3);
  assert.deepEqual(entries, entriesSnapshot);
  assert.deepEqual(metrics, metricsSnapshot);
}

// CASO 15 — Misma entrada produce misma salida.
function testSameInputProducesSameOutput() {
  const progress = buildProgress();
  assert.equal(buildWeeklyProgressAriaLabel(progress), buildWeeklyProgressAriaLabel({ ...progress }));
  assert.equal(resolveIsCurrentWeekEmptyCoach([], [], 3), resolveIsCurrentWeekEmptyCoach([], [], 3));
}

testEmptyDashboardTextsProduceNoPhantomOutput();
testOverflowLabelIsAlwaysPluralMatchingProduction();
testAriaLabelsMatchProductionLiterals();
testWeeklyProgressAriaAndTrendWithData();
testWeeklyProgressAriaWithoutData();
testFeedbackHeadlineForStatusMapsToneToLiteral();
testResolveIsCurrentWeekEmptyCoachDetectsNoData();
testResolveIsCurrentWeekEmptyCoachDetectsData();
testResolveDashboardCoachVisualStatusFourBranches();
testBuildEmptyCurrentWeekCoachFeedbackMatchesProductionLiterals();
testDoesNotMutateInputs();
testSameInputProducesSameOutput();

console.log("dashboard-presentation tests passed");
