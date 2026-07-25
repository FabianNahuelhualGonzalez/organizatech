import assert from "node:assert/strict";

import {
  buildDashboardCoachAnalytics,
  buildDashboardTrainingCardModel,
  clampDashboardCoachFactorValue,
  clampDashboardScore,
  resolveDashboardCoachFactorLabel,
} from "@/lib/dashboard/dashboard-card-model";
import type { DashboardTrainingCardData, ExerciseMetrics, WeeklySummary } from "@/lib/dashboard/dashboard-types";

function buildExerciseTemplate(overrides: Partial<{ id: string; name: string; routine: string }> = {}) {
  return {
    id: overrides.id ?? "planned-1",
    routine: overrides.routine ?? "Rutina A",
    name: overrides.name ?? "Sentadilla",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 80,
  };
}

function buildExerciseMetrics(overrides: Partial<ExerciseMetrics> = {}): ExerciseMetrics {
  return {
    id: "metric-1",
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

function buildCardData(overrides: Partial<DashboardTrainingCardData> = {}): DashboardTrainingCardData {
  return {
    day: "Lunes",
    status: "pending",
    registeredCount: 0,
    plannedCount: 1,
    isToday: false,
    exercises: [buildExerciseTemplate()],
    metrics: [],
    pendingExercises: [buildExerciseTemplate()],
    hasRoutine: true,
    isCompleted: false,
    ...overrides,
  };
}

function buildWeeklySummary(overrides: Partial<WeeklySummary> = {}): WeeklySummary {
  return {
    week: 3,
    volumeTotal: 3200,
    totalReps: 40,
    exerciseCount: 1,
    objectivesOk: 1,
    objectivesFailed: 0,
    objectivesMaintained: 0,
    volumeDifference: 200,
    volumePercentage: 6.67,
    repsDifference: 0,
    exerciseDifference: 0,
    complianceRate: 100,
    ...overrides,
  };
}

// CASO 3 — Entrenamiento "activo o pausado": producción no tiene esos dos estados para el
// dashboard (confirmado por investigación: solo completed/partial/pending). El equivalente real
// más cercano a "pausado" es `status: "partial"` (hay registro parcial) y a "sin iniciar" es
// `status: "pending"`. Se valida que el modelo distinga ambos correctamente sin inventar un
// tercer estado.
function testPendingVsPartialStatusProducesDifferentModel() {
  const pendingModel = buildDashboardTrainingCardModel(buildCardData({ status: "pending", registeredCount: 0, plannedCount: 1 }));
  assert.equal(pendingModel.status, "pending");
  assert.equal(pendingModel.actionLabel, "Ir a rutina");
  assert.match(pendingModel.statusLabel, /^Pendiente/);

  const partialModel = buildDashboardTrainingCardModel(
    buildCardData({ status: "partial", registeredCount: 1, plannedCount: 2, metrics: [buildExerciseMetrics()], pendingExercises: [] }),
  );
  assert.equal(partialModel.status, "partial");
  assert.equal(partialModel.actionLabel, "Continuar rutina");
  assert.match(partialModel.statusLabel, /^Parcial/);

  const completedModel = buildDashboardTrainingCardModel(
    buildCardData({ status: "completed", registeredCount: 1, plannedCount: 1, metrics: [buildExerciseMetrics()], pendingExercises: [] }),
  );
  assert.equal(completedModel.actionLabel, "Ver resumen");
  assert.match(completedModel.statusLabel, /^Completado/);
}

// Igual a `plannedRows = itemData.metrics.length > 0 ? itemData.pendingExercises : itemData.exercises`:
// sin métricas aún, se muestran todos los ejercicios planificados; con al menos una métrica,
// solo los pendientes (no registrados).
function testPlannedRowsSwitchBetweenAllExercisesAndPendingOnly() {
  const withoutMetrics = buildDashboardTrainingCardModel(
    buildCardData({ metrics: [], exercises: [buildExerciseTemplate({ id: "a", name: "Sentadilla" })], pendingExercises: [] }),
  );
  assert.deepEqual(withoutMetrics.rows.map((row) => row.name), ["Sentadilla"]);

  const withMetrics = buildDashboardTrainingCardModel(
    buildCardData({
      metrics: [buildExerciseMetrics()],
      exercises: [buildExerciseTemplate({ id: "a", name: "Sentadilla" })],
      pendingExercises: [buildExerciseTemplate({ id: "b", name: "Peso muerto" })],
    }),
  );
  assert.ok(withMetrics.rows.some((row) => row.name === "Peso muerto"));
  assert.ok(!withMetrics.rows.some((row) => row.name === "Sentadilla" && row.source === "planned"));
}

// Igual a `routineName: itemData.exercises[0]?.routine ?? null` → "Entrenamiento" cuando no hay ejercicios.
function testRoutineNameFallsBackWhenNoExercises() {
  const model = buildDashboardTrainingCardModel(buildCardData({ exercises: [], pendingExercises: [] }));
  assert.equal(model.routineName, "Entrenamiento");
}

// CASO 5 (parcial) — Coach disponible: analytics con datos produce un score en [0, 100] y 4 factores.
function testBuildDashboardCoachAnalyticsWithData() {
  const summary = buildWeeklySummary();
  const metrics = [buildExerciseMetrics()];
  const analytics = buildDashboardCoachAnalytics(summary, metrics);

  assert.ok(analytics.score >= 0 && analytics.score <= 100);
  assert.equal(analytics.factors.length, 4);
  assert.deepEqual(
    analytics.factors.map(([label]) => label),
    ["Cumplimiento ejercicios", "Repeticiones logradas", "Carga mantenida/subida", "Volumen vs objetivo/semana anterior"],
  );
}

// CASO 5 (parcial) — Coach no disponible / sin datos: métricas vacías no deben producir NaN ni
// dividir por cero (repsScore/loadScore caen a 0 igual que en producción).
function testBuildDashboardCoachAnalyticsWithoutData() {
  const summary = buildWeeklySummary({ totalReps: 0, complianceRate: 0, volumePercentage: -100 });
  const analytics = buildDashboardCoachAnalytics(summary, []);

  assert.equal(analytics.factors[1][1], 0, "sin targetReps, repsScore debe ser 0 (no NaN)");
  assert.equal(analytics.factors[2][1], 0, "sin métricas, loadScore debe ser 0 (no NaN)");
  assert.ok(Number.isFinite(analytics.score));
}

function testClampDashboardScoreAndFactorValue() {
  assert.equal(clampDashboardScore(150), 100);
  assert.equal(clampDashboardScore(-20), 0);
  assert.equal(clampDashboardScore(42), 42);
  assert.equal(clampDashboardCoachFactorValue(Number.NaN), 0, "igual a `Number(value) || 0` antes del clamp");
  assert.equal(clampDashboardCoachFactorValue(120), 100);
}

// CASO 16 — Paridad de labels: getCoachFactorLabel exacto.
function testResolveDashboardCoachFactorLabelMatchesProductionMapping() {
  assert.equal(resolveDashboardCoachFactorLabel("Cumplimiento ejercicios"), "Cumplimiento");
  assert.equal(resolveDashboardCoachFactorLabel("Repeticiones logradas"), "Reps");
  assert.equal(resolveDashboardCoachFactorLabel("Carga mantenida/subida"), "Carga");
  assert.equal(resolveDashboardCoachFactorLabel("Volumen vs objetivo/semana anterior"), "Volumen");
  assert.equal(resolveDashboardCoachFactorLabel("Etiqueta desconocida"), "Etiqueta desconocida");
}

// Igual a la salida real de `getDashboardDayData`: `hasRoutine` e `isCompleted` son campos
// independientes, NO derivados de `exercises.length` dentro de este dominio — el módulo los
// recibe tal cual y los deja pasar sin recalcularlos. Se demuestra con combinaciones que
// `exercises.length` por sí solo NO predice ninguno de los dos valores.
function testHasRoutineAndIsCompletedAreIndependentFromExercisesLength() {
  const emptyExercisesButHasRoutine = buildCardData({
    exercises: [],
    pendingExercises: [],
    metrics: [buildExerciseMetrics()],
    hasRoutine: true,
    isCompleted: true,
  });
  assert.equal(emptyExercisesButHasRoutine.exercises.length, 0);
  assert.equal(emptyExercisesButHasRoutine.hasRoutine, true, "hasRoutine puede ser true con exercises vacío");
  assert.equal(emptyExercisesButHasRoutine.isCompleted, true, "isCompleted puede ser true independientemente de exercises");

  const nonEmptyExercisesButNotCompleted = buildCardData({
    exercises: [buildExerciseTemplate()],
    hasRoutine: true,
    isCompleted: false,
  });
  assert.equal(nonEmptyExercisesButNotCompleted.exercises.length, 1);
  assert.equal(nonEmptyExercisesButNotCompleted.isCompleted, false, "exercises no vacío no implica isCompleted true");

  const emptyExercisesAndNoRoutine = buildCardData({
    exercises: [],
    pendingExercises: [],
    hasRoutine: false,
    isCompleted: false,
  });
  assert.equal(emptyExercisesAndNoRoutine.hasRoutine, false);

  // El dominio no recalcula estos campos: los valores pasados se conservan exactamente,
  // sin ninguna inferencia a partir de `exercises`/`pendingExercises`.
  assert.equal(emptyExercisesButHasRoutine.hasRoutine, true);
  assert.equal(nonEmptyExercisesButNotCompleted.hasRoutine, true);
  assert.equal(emptyExercisesAndNoRoutine.isCompleted, false);
}

// CASO 14 — Inmutabilidad: no debe mutarse ningún arreglo/objeto de entrada.
function testDoesNotMutateInputs() {
  const cardData = buildCardData({ metrics: [buildExerciseMetrics()], pendingExercises: [buildExerciseTemplate({ id: "b" })] });
  const snapshot = JSON.parse(JSON.stringify(cardData));
  buildDashboardTrainingCardModel(cardData);
  assert.deepEqual(cardData, snapshot);

  const summary = buildWeeklySummary();
  const summarySnapshot = { ...summary };
  const metrics = [buildExerciseMetrics()];
  const metricsSnapshot = JSON.parse(JSON.stringify(metrics));
  buildDashboardCoachAnalytics(summary, metrics);
  assert.deepEqual(summary, summarySnapshot);
  assert.deepEqual(metrics, metricsSnapshot);
}

// CASO 15 — Misma entrada produce misma salida.
function testSameInputProducesSameOutput() {
  const cardData = buildCardData({ metrics: [buildExerciseMetrics()], pendingExercises: [] });
  assert.deepEqual(buildDashboardTrainingCardModel(cardData), buildDashboardTrainingCardModel({ ...cardData }));

  const summary = buildWeeklySummary();
  const metrics = [buildExerciseMetrics()];
  assert.deepEqual(buildDashboardCoachAnalytics(summary, metrics), buildDashboardCoachAnalytics({ ...summary }, [...metrics]));
}

testPendingVsPartialStatusProducesDifferentModel();
testPlannedRowsSwitchBetweenAllExercisesAndPendingOnly();
testRoutineNameFallsBackWhenNoExercises();
testHasRoutineAndIsCompletedAreIndependentFromExercisesLength();
testBuildDashboardCoachAnalyticsWithData();
testBuildDashboardCoachAnalyticsWithoutData();
testClampDashboardScoreAndFactorValue();
testResolveDashboardCoachFactorLabelMatchesProductionMapping();
testDoesNotMutateInputs();
testSameInputProducesSameOutput();

console.log("dashboard-card-model tests passed");
