import assert from "node:assert/strict";

import type { ExerciseMetrics } from "@/lib/progress/types";
import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import type { ProfilePersonalData } from "@/lib/profile/profile-repository";

import {
  type BuildAppNotificationsInput,
  buildAppNotifications,
  compareNotifications,
  dedupeNotifications,
  getNotificationPriorityRank,
  isProfilePersonalDataIncomplete,
  resolveNotificationIconKey,
  sortNotificationsByPriority,
} from "@/lib/notifications/notification-model";
import type { AppNotification } from "@/lib/notifications/notification-types";

const BASE_NOW = new Date(2026, 6, 23, 10, 0, 0);

function buildWeeklyEquivalentProgressFixture(overrides: Partial<WeeklyEquivalentProgressResult> = {}): WeeklyEquivalentProgressResult {
  return {
    ranges: {
      currentWeekStart: "2026-07-20",
      currentComparisonEnd: "2026-07-23",
      previousWeekStart: "2026-07-13",
      previousComparisonEnd: "2026-07-16",
      elapsedDayCount: 3,
      todayLabel: "Jue",
    },
    plannedDays: ["Lunes", "Miércoles", "Viernes"],
    previousFinalVolume: 1000,
    currentEquivalentValue: 0,
    previousEquivalentValue: 1000,
    differenceValue: 0,
    percentage: null,
    previousComparablePercentage: null,
    primaryLabel: "0 kg",
    previousLabel: "0 kg",
    currentVolumeLabel: "0 kg",
    previousVolumeLabel: "0 kg",
    comparisonLabel: "Vs semana anterior",
    detailLabel: "",
    tone: "neutral",
    status: "neutral",
    points: [],
    ...overrides,
  };
}

function buildExerciseMetricsFixture(overrides: Partial<ExerciseMetrics> = {}): ExerciseMetrics {
  return {
    id: "entry-1",
    exerciseId: "exercise-1",
    exerciseName: "Sentadilla",
    routine: "Piernas",
    week: 1,
    date: "2026-07-20",
    targetSets: 4,
    targetReps: 10,
    weight: 50,
    previousWeight: 50,
    reps: [10, 10, 10, 10],
    targetTotalReps: 40,
    totalReps: 40,
    completedSets: 4,
    setsDifference: 0,
    repsDifference: 0,
    kgDifference: 0,
    kgStatus: "Mismo kg",
    objectiveStatus: "Cumplimos",
    volumeTotal: 2000,
    volumeDifference: 0,
    volumePercentage: 0,
    ...overrides,
  };
}

function buildPersonalDataFixture(overrides: Partial<ProfilePersonalData> = {}): ProfilePersonalData {
  return {
    id: "profile-1",
    displayName: "Persona QA",
    email: "qa@example.test",
    firstName: "Persona",
    lastName: "QA",
    birthDate: "1995-05-05",
    gender: "female",
    phoneNumber: "+56900000000",
    avatarPath: null,
    avatarUpdatedAt: null,
    ...overrides,
  };
}

function buildBaseInput(overrides: Partial<BuildAppNotificationsInput> = {}): BuildAppNotificationsInput {
  return {
    profile: { avatarUrl: null },
    personalData: null,
    currentWeek: 1,
    completedDays: 0,
    plannedDays: 0,
    hasTrainingEntries: false,
    hasRoutinePlan: false,
    weeklyEquivalentProgress: buildWeeklyEquivalentProgressFixture(),
    summary: { volumeDifference: 0 },
    currentMetrics: [],
    todayTraining: null,
    ...overrides,
  };
}

function ids(notifications: AppNotification[]): string[] {
  return notifications.map((notification) => notification.id);
}

// CASO 1 — Sin datos: no debe generarse ninguna notificación fantasma que dependa de datos ausentes.
function testNoDataDoesNotGeneratePhantomNotifications() {
  const result = buildAppNotifications(buildBaseInput(), BASE_NOW);

  assert.deepEqual(
    ids(result).sort(),
    ["complete-profile-v1", "feature-notification-center-v1", "feature-profile-phone-v1", "feature-weekly-comparison-v1", "training-return-v1-w1"].sort(),
    "sin datos de entrenamiento/perfil/progreso, solo deben aparecer las notificaciones que no dependen de esos datos",
  );
  assert.ok(!ids(result).includes("weekly-comparison-v1-w1"), "no debe inventarse una comparación semanal sin datos reales");
  assert.ok(!ids(result).some((id) => id.startsWith("weekly-progress-v1")), "no debe inventarse progreso semanal sin datos reales");
  assert.ok(!ids(result).some((id) => id.startsWith("smart-analysis-v1")), "no debe inventarse análisis del coach sin métricas reales");
}

// CASO 2 — Fecha actual: un entrenamiento correspondiente a hoy usa la regla vigente ("Hoy te toca entrenar").
function testTodayTrainingUsesCurrentRule() {
  const result = buildAppNotifications(
    buildBaseInput({
      hasRoutinePlan: true,
      plannedDays: 3,
      todayTraining: { day: "Jueves", routine: "Piernas", status: "pending" },
    }),
    BASE_NOW,
  );

  const todayNotification = result.find((notification) => notification.id === "training-status-v2-w1-Jueves-pending");
  assert.ok(todayNotification, "debe existir la notificación del entrenamiento de hoy");
  assert.equal(todayNotification?.title, "Hoy te toca entrenar");
  assert.equal(todayNotification?.summary, "Hoy Jueves te toca entrenar Piernas.");
  assert.equal(todayNotification?.priority, "high");
  assert.equal(todayNotification?.target, "dashboard");
  assert.equal(todayNotification?.section, "training-carousel");
  assert.equal(todayNotification?.day, "Jueves");
}

// CASO 3 — "Vencida" (equivalente real más cercano en este dominio: alerta del coach por caída de
// repeticiones): mantiene prioridad alta, categoría y aparece antes que notificaciones de menor
// prioridad. No existe en producción un concepto literal de "tarea vencida"; se documenta esta
// equivalencia en vez de inventar una regla de vencimiento que no existe.
function testCoachAttentionAlertKeepsHighPriorityLabelAndOrder() {
  const result = buildAppNotifications(
    buildBaseInput({
      hasTrainingEntries: true,
      currentMetrics: [buildExerciseMetricsFixture({ exerciseName: "Press banca", repsDifference: -5, kgDifference: 0 })],
    }),
    BASE_NOW,
  );

  const alert = result.find((notification) => notification.id === "smart-analysis-v1-w1-attention");
  assert.ok(alert, "debe existir la alerta de recuperación");
  assert.equal(alert?.title, "Revisa tu recuperación");
  assert.equal(alert?.summary, "Press banca bajó repeticiones. Revisa descanso, técnica o fatiga acumulada.");
  assert.equal(alert?.category, "Coach");
  assert.equal(alert?.priority, "high");

  const lowPriorityIndex = result.findIndex((notification) => notification.priority === "low");
  const alertIndex = result.findIndex((notification) => notification.id === "smart-analysis-v1-w1-attention");
  assert.ok(alertIndex < lowPriorityIndex, "la alerta de alta prioridad debe aparecer antes que las de baja prioridad");
}

// CASO 4 — Futura: un contexto de entrenamiento que aún no corresponde (todayTraining ausente) no debe
// generar una notificación de "hoy" antes de tiempo, ni caer por error en el aviso de retomar el ritmo
// si ya existen datos de entrenamiento.
function testFutureTrainingContextDoesNotAppearBeforeItsTime() {
  const result = buildAppNotifications(
    buildBaseInput({
      hasTrainingEntries: true,
      hasRoutinePlan: true,
      plannedDays: 3,
      todayTraining: null,
    }),
    BASE_NOW,
  );

  assert.ok(!ids(result).some((id) => id.startsWith("training-status-v2")), "sin contexto de hoy no debe inventarse una notificación de entrenamiento de hoy");
  assert.ok(!ids(result).some((id) => id.startsWith("training-return-v1")), "con entradas de entrenamiento reales no debe mostrarse el aviso de retomar el ritmo");
}

// CASO 6 — Orden: con varias notificaciones, se mantiene el orden real (prioridad, luego más reciente primero).
function testMultipleNotificationsKeepPriorityAndDateOrder() {
  const high: AppNotification = {
    id: "n-high", title: "H", summary: "h", category: "Coach", tone: "warning", priority: "high",
    dedupeKey: "k-high", target: "dashboard", kind: "coach", createdAt: "2026-07-20T00:00:00.000Z",
  };
  const mediumOlder: AppNotification = {
    id: "n-medium-older", title: "M1", summary: "m1", category: "Perfil", tone: "info", priority: "medium",
    dedupeKey: "k-medium-older", target: "perfil", kind: "profile", createdAt: "2026-07-19T00:00:00.000Z",
  };
  const mediumNewer: AppNotification = {
    id: "n-medium-newer", title: "M2", summary: "m2", category: "Perfil", tone: "info", priority: "medium",
    dedupeKey: "k-medium-newer", target: "perfil", kind: "profile", createdAt: "2026-07-21T00:00:00.000Z",
  };
  const low: AppNotification = {
    id: "n-low", title: "L", summary: "l", category: "Novedades", tone: "info", priority: "low",
    dedupeKey: "k-low", target: "dashboard", kind: "feature", createdAt: "2026-07-22T00:00:00.000Z",
  };

  const sorted = sortNotificationsByPriority([low, mediumOlder, high, mediumNewer]);
  assert.deepEqual(
    ids(sorted),
    ["n-high", "n-medium-newer", "n-medium-older", "n-low"],
    "orden: prioridad (alta > media > baja); en empate, la más reciente primero",
  );
  assert.equal(getNotificationPriorityRank("high"), 0);
  assert.equal(getNotificationPriorityRank("medium"), 1);
  assert.equal(getNotificationPriorityRank("low"), 2);
  assert.ok(compareNotifications(high, low) < 0);
  assert.ok(compareNotifications(mediumNewer, mediumOlder) < 0);
}

// CASO 7 — Identidad: cada notificación tiene un id estable derivado de datos semánticos (semana, día,
// estado), no del texto visible — dos notificaciones con títulos idénticos en semanas distintas deben
// tener ids distintos, y el mismo id se mantiene ante la misma entrada.
function testNotificationIdentityIsStableAndNotBasedOnVisibleText() {
  const week1 = buildAppNotifications(buildBaseInput({ currentWeek: 1 }), BASE_NOW);
  const week2 = buildAppNotifications(buildBaseInput({ currentWeek: 2 }), BASE_NOW);

  const idWeek1 = week1.find((notification) => notification.title === "Retoma tu ritmo")?.id;
  const idWeek2 = week2.find((notification) => notification.title === "Retoma tu ritmo")?.id;
  assert.ok(idWeek1 && idWeek2, "ambas semanas deben generar el aviso de retomar el ritmo");
  assert.notEqual(idWeek1, idWeek2, "el mismo título en semanas distintas debe producir ids distintos");

  const again = buildAppNotifications(buildBaseInput({ currentWeek: 1 }), BASE_NOW);
  assert.equal(
    again.find((notification) => notification.title === "Retoma tu ritmo")?.id,
    idWeek1,
    "la misma entrada debe producir siempre el mismo id",
  );
}

// CASO 8 — Duplicados: la misma fuente (dedupeKey) no debe producir dos notificaciones en la misma evaluación.
function testDuplicateDedupeKeyKeepsOnlyTheHigherPriorityNotification() {
  const older: AppNotification = {
    id: "dup-a", title: "A", summary: "a", category: "Perfil", tone: "info", priority: "low",
    dedupeKey: "shared-key", target: "perfil", kind: "profile", createdAt: "2026-07-01T00:00:00.000Z",
  };
  const newerHighPriority: AppNotification = {
    id: "dup-b", title: "B", summary: "b", category: "Perfil", tone: "info", priority: "high",
    dedupeKey: "shared-key", target: "perfil", kind: "profile", createdAt: "2026-07-02T00:00:00.000Z",
  };

  const deduped = dedupeNotifications([older, newerHighPriority]);
  assert.equal(deduped.length, 1, "solo debe sobrevivir una notificación por dedupeKey");
  assert.equal(deduped[0]?.id, "dup-b", "debe sobrevivir la de mayor prioridad, no la insertada primero");

  const dedupedReverseOrder = dedupeNotifications([newerHighPriority, older]);
  assert.equal(dedupedReverseOrder[0]?.id, "dup-b", "el resultado no debe depender del orden de inserción");
}

// CASO 11 — Reevaluación: evaluar dos veces con la misma entrada produce exactamente el mismo resultado.
function testSameInputProducesIdenticalResultOnReevaluation() {
  const input = buildBaseInput({
    hasTrainingEntries: true,
    hasRoutinePlan: true,
    plannedDays: 3,
    completedDays: 2,
    todayTraining: { day: "Jueves", routine: "Piernas", status: "completed" },
    personalData: buildPersonalDataFixture(),
    currentMetrics: [buildExerciseMetricsFixture({ kgDifference: 5, repsDifference: 0 })],
    weeklyEquivalentProgress: buildWeeklyEquivalentProgressFixture({ currentEquivalentValue: 500, status: "ready", differenceValue: 20, tone: "positive" }),
  });

  const first = buildAppNotifications(input, BASE_NOW);
  const second = buildAppNotifications(input, BASE_NOW);
  assert.deepEqual(first, second, "la misma entrada y la misma fecha deben producir exactamente el mismo resultado");
}

// CASO 12 — Cambio de fecha: cambiar la fecha explícita recalcula únicamente lo que corresponde
// (createdAt), sin alterar títulos, prioridades ni condiciones.
function testChangingExplicitDateOnlyRecalculatesWhatCorresponds() {
  const input = buildBaseInput({ hasTrainingEntries: true, currentMetrics: [buildExerciseMetricsFixture({ repsDifference: -5, kgDifference: 0 })] });
  const laterNow = new Date(2026, 6, 24, 8, 0, 0);

  const first = buildAppNotifications(input, BASE_NOW);
  const second = buildAppNotifications(input, laterNow);

  assert.deepEqual(ids(first), ids(second), "los ids no deben cambiar solo porque cambió la fecha explícita");
  first.forEach((notification, index) => {
    const other = second[index]!;
    assert.equal(notification.title, other.title);
    assert.equal(notification.summary, other.summary);
    assert.equal(notification.priority, other.priority);
    assert.equal(notification.createdAt, BASE_NOW.toISOString());
    assert.equal(other.createdAt, laterNow.toISOString());
  });
}

// CASO 14 — Inmutabilidad: no debe mutarse ningún dato recibido (métricas, progreso semanal, datos
// personales, perfil).
function testBuildAppNotificationsDoesNotMutateInputs() {
  const input = buildBaseInput({
    hasTrainingEntries: true,
    personalData: buildPersonalDataFixture(),
    currentMetrics: [buildExerciseMetricsFixture({ repsDifference: -5, kgDifference: 0 })],
    weeklyEquivalentProgress: buildWeeklyEquivalentProgressFixture({ currentEquivalentValue: 300 }),
  });
  const snapshot = JSON.parse(JSON.stringify(input));

  buildAppNotifications(input, BASE_NOW);

  assert.deepEqual(input, snapshot, "buildAppNotifications no debe mutar ningún campo de su entrada");
}

function testIsProfilePersonalDataIncompleteMatchesProductionRule() {
  assert.equal(isProfilePersonalDataIncomplete(null), false, "sin datos personales, la producción no los marca como incompletos");
  assert.equal(isProfilePersonalDataIncomplete(buildPersonalDataFixture()), false);
  assert.equal(isProfilePersonalDataIncomplete(buildPersonalDataFixture({ firstName: null })), true);
  assert.equal(isProfilePersonalDataIncomplete(buildPersonalDataFixture({ birthDate: null })), true);
  assert.equal(isProfilePersonalDataIncomplete(buildPersonalDataFixture({ gender: "not_specified" })), true);
  assert.equal(isProfilePersonalDataIncomplete(buildPersonalDataFixture({ phoneNumber: null })), true);
}

function testResolveNotificationIconKeyMatchesProductionMapping() {
  assert.equal(resolveNotificationIconKey("Novedades"), "backhoe");
  assert.equal(resolveNotificationIconKey("Progreso"), "heart-share");
  assert.equal(resolveNotificationIconKey("Coach"), "coach");
  assert.equal(resolveNotificationIconKey("Comparación"), "trending");
  assert.equal(resolveNotificationIconKey("Perfil"), "user-plus");
  assert.equal(resolveNotificationIconKey("Entrenamiento"), "calendar-days");
  assert.equal(resolveNotificationIconKey("Sistema"), "calendar-days");
}

testNoDataDoesNotGeneratePhantomNotifications();
testTodayTrainingUsesCurrentRule();
testCoachAttentionAlertKeepsHighPriorityLabelAndOrder();
testFutureTrainingContextDoesNotAppearBeforeItsTime();
testMultipleNotificationsKeepPriorityAndDateOrder();
testNotificationIdentityIsStableAndNotBasedOnVisibleText();
testDuplicateDedupeKeyKeepsOnlyTheHigherPriorityNotification();
testSameInputProducesIdenticalResultOnReevaluation();
testChangingExplicitDateOnlyRecalculatesWhatCorresponds();
testBuildAppNotificationsDoesNotMutateInputs();
testIsProfilePersonalDataIncompleteMatchesProductionRule();
testResolveNotificationIconKeyMatchesProductionMapping();

console.log("notification-model tests passed");
