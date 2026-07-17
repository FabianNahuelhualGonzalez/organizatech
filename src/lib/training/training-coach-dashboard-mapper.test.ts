import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import type { ExerciseEntry, ExerciseMetrics, WeeklySummary } from "@/lib/progress/types";
import { buildTrainingCoachFeedback } from "@/lib/training/training-coach-feedback";
import {
  buildDashboardWeeklyTrend,
  buildTrainingCoachDashboardInput,
  parseReadinessFromNotes,
  resolveDashboardReadiness,
  type TrainingCoachDashboardInput,
} from "@/lib/training/training-coach-dashboard-mapper";

{
  const input = mapDashboardInput({
    summary: summary({ week: 5 }),
    currentMetrics: [metric({ exerciseId: "press-plano", exerciseName: "Press plano", kgDifference: 5, repsDifference: 3 })],
    entries: [
      entry({ id: "press-w4", exerciseId: "press-plano", week: 4 }),
      entry({ id: "press-w5", exerciseId: "press-plano", week: 5 }),
    ],
    currentWeek: 5,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(input.comparisonStatus, "ready");
  assert.equal(input.referenceWeek, 4);
  assert.equal(input.workout?.kgIncreasedExercises, 1);
  assert.equal(input.exercises?.[0]?.name, "Press plano");
  assert.equal(input.weeklyTrend?.phase, "initial_comparison");
}

{
  const input = mapDashboardInput({
    summary: summary({ week: 3 }),
    currentMetrics: [metric({ exerciseName: "Sentadilla" })],
    entries: [entry({ week: 3 })],
    currentWeek: 3,
    weeklyEquivalentProgress: progress("no_previous"),
  });

  assert.equal(input.comparisonStatus, "first_reference");
  assert.equal(input.referenceWeek, null);
}

{
  const input = mapDashboardInput({
    summary: summary({ week: 1, exerciseCount: 0 }),
    currentMetrics: [],
    entries: [],
    currentWeek: 1,
    weeklyEquivalentProgress: progress("neutral"),
  });

  assert.equal(input.comparisonStatus, "none");
  assert.equal(input.readiness, null);
  assert.deepEqual(input.exercises, []);
  assert.equal(input.weeklyTrend?.phase, "no_history");
}

// Escenario 1: el estado semanal global no convierte en ready un día sin referencia.
{
  const input = mapDashboardInput({
    activeDay: "Miércoles",
    summary: summary({ week: 6 }),
    currentMetrics: [metric({ exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    entries: [entry({ id: "sentadilla-w6", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(input.comparisonStatus, "first_reference");
  assert.equal(input.referenceWeek, null);
}

// Escenario 2: la referencia de otro día queda fuera del input del día activo.
{
  const monday = mapDashboardInput({
    activeDay: "Lunes",
    summary: summary({ week: 6 }),
    currentMetrics: [metric({ exerciseId: "press", exerciseName: "Press plano", week: 6 })],
    entries: [
      entry({ id: "press-w5", exerciseId: "press", exerciseName: "Press plano", week: 5 }),
      entry({ id: "press-w6", exerciseId: "press", exerciseName: "Press plano", week: 6 }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });
  const activeWednesdayEntries = [
    entry({ id: "curl-w6", exerciseId: "curl", exerciseName: "Curl femoral", week: 6 }),
  ];

  const wednesday = mapDashboardInput({
    activeDay: "Miércoles",
    summary: summary({ week: 6 }),
    currentMetrics: [metric({ exerciseId: "curl", exerciseName: "Curl femoral", week: 6 })],
    entries: activeWednesdayEntries,
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(monday.comparisonStatus, "ready", "el otro día sí tiene referencia");
  assert.equal(wednesday.comparisonStatus, "first_reference");
}

// Escenario 3: una referencia histórica del mismo día habilita la comparación.
{
  const input = mapDashboardInput({
    activeDay: "Miércoles",
    summary: summary({ week: 6 }),
    currentMetrics: [metric({ exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    entries: [
      entry({ id: "sentadilla-w5", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 5 }),
      entry({ id: "sentadilla-w6", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("neutral"),
  });

  assert.equal(input.comparisonStatus, "ready");
  assert.equal(input.referenceWeek, 5);
}

// Escenario 4: cambiar de un día con referencia a otro sin ella recalcula el estado.
{
  const dayA = mapDashboardInput({
    activeDay: "Lunes",
    summary: summary({ week: 6 }),
    currentMetrics: [metric({ exerciseId: "press", exerciseName: "Press plano", week: 6 })],
    entries: [
      entry({ id: "press-w5", exerciseId: "press", exerciseName: "Press plano", week: 5 }),
      entry({ id: "press-w6", exerciseId: "press", exerciseName: "Press plano", week: 6 }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });
  const dayB = mapDashboardInput({
    activeDay: "Miércoles",
    summary: summary({ week: 6 }),
    currentMetrics: [metric({ exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    entries: [entry({ id: "sentadilla-w6", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(dayA.comparisonStatus, "ready");
  assert.equal(dayB.comparisonStatus, "first_reference");
  assert.notEqual(dayA.seed, dayB.seed, "el día activo participa del seed estable");
}

// Escenario 5: un día parcialmente registrado no se presenta como comparación completa.
{
  const input = mapDashboardInput({
    activeDay: "Miércoles",
    activeDayCoverage: { registeredExercises: 1, plannedExercises: 2 },
    summary: summary({ week: 6, exerciseCount: 1 }),
    currentMetrics: [metric({ exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    entries: [
      entry({ id: "sentadilla-w5", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 5 }),
      entry({ id: "sentadilla-w6", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(input.comparisonStatus, "first_reference");
  assert.equal(input.referenceWeek, null);
}

// Escenario 6: todos los ejercicios registrados deben compartir una referencia válida.
{
  const input = mapDashboardInput({
    activeDay: "Miércoles",
    activeDayCoverage: { registeredExercises: 2, plannedExercises: 2 },
    summary: summary({ week: 6, exerciseCount: 2 }),
    currentMetrics: [
      metric({ exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 }),
      metric({ exerciseId: "curl", exerciseName: "Curl femoral", week: 6 }),
    ],
    entries: [
      entry({ id: "sentadilla-w5", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 5 }),
      entry({ id: "sentadilla-w6", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 }),
      entry({ id: "curl-w6", exerciseId: "curl", exerciseName: "Curl femoral", week: 6 }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(input.comparisonStatus, "first_reference");
  assert.equal(input.referenceWeek, null);
}

// Escenario 8: el contexto semanal permanece disponible, pero no decide el estado del día.
{
  const base = {
    activeDay: "Miércoles",
    summary: summary({ week: 6, volumeDifference: 777, repsDifference: 9 }),
    currentMetrics: [metric({ exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    entries: [entry({ id: "sentadilla-w6", exerciseId: "sentadilla", exerciseName: "Sentadilla", week: 6 })],
    currentWeek: 6,
  };
  const globalReady = mapDashboardInput({ ...base, weeklyEquivalentProgress: progress("ready") });
  const globalNeutral = mapDashboardInput({ ...base, weeklyEquivalentProgress: progress("neutral") });

  assert.equal(globalReady.comparisonStatus, "first_reference");
  assert.equal(globalNeutral.comparisonStatus, "first_reference");
  assert.equal(globalReady.workout?.volumeDifference, 777, "las métricas agregadas siguen disponibles");
  assert.equal(globalReady.workout?.repsDifference, 9);
}

{
  const readiness = resolveDashboardReadiness([
    entry({ week: 5, date: "2026-07-01", notes: "Entrenamiento Lunes: Pecho. motivación 7/7, hidratación 5/7, sueño 6/7, energía 6/7" }),
    entry({ week: 5, date: "2026-07-02", notes: "Entrenamiento Martes: Piernas. motivación 5/7, hidratación 3/7, sueño 4/7, energía 4/7" }),
    entry({ week: 4, date: "2026-06-24", notes: "Entrenamiento Lunes: Pecho. motivación 1/7, hidratación 1/7, sueño 1/7, energía 1/7" }),
  ], 5);

  assert.deepEqual(readiness, { motivation: 6, hydration: 4, sleep: 5, energy: 5 });
}

{
  assert.equal(resolveDashboardReadiness([entry({ week: 5, notes: "readiness omitido" })], 5), null);
  assert.equal(parseReadinessFromNotes("sin datos"), null);
}

{
  const first = mapDashboardInput({
    summary: summary({ week: 5, volumeDifference: -1200, repsDifference: -4 }),
    currentMetrics: [metric({ exerciseName: "Hack", repsDifference: -4 })],
    entries: [entry({ week: 5 })],
    currentWeek: 5,
    weeklyEquivalentProgress: progress("ready"),
  });
  const second = mapDashboardInput({
    summary: summary({ week: 5, volumeDifference: -1200, repsDifference: -4 }),
    currentMetrics: [metric({ exerciseName: "Hack", repsDifference: -4 })],
    entries: [entry({ week: 5 })],
    currentWeek: 5,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(first.seed, second.seed, "seed estable para la misma entrada");
}

// Escenario 7: los valores no finitos continúan normalizados.
{
  const input = mapDashboardInput({
    summary: summary({
      week: 5,
      exerciseCount: Number.NaN,
      objectivesOk: Number.POSITIVE_INFINITY,
      volumeDifference: Number.NaN,
      volumePercentage: Number.NEGATIVE_INFINITY,
      repsDifference: Number.NaN,
    }),
    currentMetrics: [
      metric({ exerciseName: "", kgDifference: 10, repsDifference: 10 }),
      metric({ exerciseName: "Valor inválido", kgDifference: Number.NaN, repsDifference: Number.POSITIVE_INFINITY, volumePercentage: Number.NEGATIVE_INFINITY }),
    ],
    entries: [entry({ week: 5 })],
    currentWeek: 5,
    weeklyEquivalentProgress: progress("ready"),
  });

  const text = JSON.stringify(input);
  assert.equal(input.exercises?.length, 1, "filtra ejercicios sin nombre");
  assert.doesNotMatch(text, /NaN|Infinity|-Infinity/);
}

{
  const mapped = mapDashboardInput({
    summary: summary({ week: 5, volumeDifference: -3000, volumePercentage: -30, repsDifference: -8, objectivesOk: 3, exerciseCount: 3 }),
    currentMetrics: [metric({ exerciseId: "press-plano", exerciseName: "Press plano", repsDifference: -8, volumePercentage: -30 })],
    entries: [
      entry({ id: "press-w4", exerciseId: "press-plano", week: 4, reps: [13, 13, 12] }),
      entry({ id: "press-w5", exerciseId: "press-plano", week: 5, reps: [10, 10, 10] }),
    ],
    currentWeek: 5,
    weeklyEquivalentProgress: progress("ready"),
  });
  const feedback = buildTrainingCoachFeedback(mapped);

  assert.ok(feedback.summary.length > 0);
  assert.ok(feedback.nextAdvice.length > 0);
  assert.ok(feedback.sourceSignals.includes("strong_exercise_drop"));
}

{
  const mapped = mapDashboardInput({
    summary: summary({ week: 6, volumeDifference: -2000, volumePercentage: -12, repsDifference: -9, objectivesOk: 1, exerciseCount: 2 }),
    currentMetrics: [
      metric({
        exerciseId: "cycle-exercise-current",
        exerciseLineageId: "lineage-prueba",
        exerciseName: "prueba 24 06",
        week: 6,
        reps: [17, 17, 17],
        targetReps: 20,
        targetSets: 3,
        targetTotalReps: 60,
        totalReps: 51,
        repsDifference: -9,
      }),
    ],
    entries: [
      entry({
        id: "previous",
        exerciseId: "cycle-exercise-previous",
        exerciseLineageId: "lineage-prueba",
        exerciseName: "prueba 24 06",
        week: 5,
        reps: [21, 20, 20],
      }),
      entry({
        id: "current",
        exerciseId: "cycle-exercise-current",
        exerciseLineageId: "lineage-prueba",
        exerciseName: "prueba 24 06",
        week: 6,
        reps: [17, 17, 17],
      }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });

  assert.equal(mapped.exercises?.[0]?.repsDifference, -10);
  const feedback = buildTrainingCoachFeedback(mapped);
  assert.match(feedback.attentions[0]?.body ?? "", /bajó 10 reps/);
  assert.match(feedback.nextTarget ?? "", /10 reps perdidas/);
}

{
  const mapped = mapDashboardInput({
    summary: summary({ week: 6, volumeDifference: 500, volumePercentage: 8, repsDifference: -4, objectivesOk: 1, exerciseCount: 1 }),
    currentMetrics: [
      metric({
        exerciseId: "hack",
        exerciseName: "Hack",
        week: 6,
        kgDifference: 10,
        repsDifference: -4,
        weight: 110,
        previousWeight: 100,
        reps: [9, 9, 8],
        totalReps: 26,
      }),
    ],
    entries: [
      entry({ id: "hack-w5", exerciseId: "hack", week: 5, exerciseName: "Hack", reps: [10, 10, 10], weight: 100 }),
      entry({ id: "hack-w6", exerciseId: "hack", week: 6, exerciseName: "Hack", reps: [9, 9, 8], weight: 110, previousWeight: 100 }),
    ],
    currentWeek: 6,
    weeklyEquivalentProgress: progress("ready"),
  });
  const feedback = buildTrainingCoachFeedback(mapped);
  const text = JSON.stringify(feedback);

  assert.ok(feedback.sourceSignals.includes("kg_up_reps_down"));
  assert.match(text, /subiste el peso/);
  assert.match(text, /progresión normal/);
  assert.doesNotMatch(text, /reps perdidas/);
}

{
  const trend = buildDashboardWeeklyTrend([
    entry({ week: 3, id: "w3-a", exerciseName: "Press plano", reps: [10, 10, 10], weight: 100 }),
    entry({ week: 4, id: "w4-a", exerciseName: "Press plano", reps: [11, 10, 10], weight: 100 }),
    entry({ week: 5, id: "w5-a", exerciseName: "Press plano", reps: [12, 10, 10], weight: 101, previousWeight: 100 }),
  ], 5);

  assert.deepEqual(trend.availableWeeks, [3, 4, 5]);
  assert.deepEqual(trend.missingWeeks, []);
  assert.equal(trend.weekCount, 3);
  assert.equal(trend.phase, "early_trend");
  assert.equal(trend.trendWindow?.firstWeek, 3);
  assert.equal(trend.trendWindow?.lastWeek, 5);
}

{
  const trend = buildDashboardWeeklyTrend([
    entry({ week: 3, id: "w3-a" }),
    entry({ week: 5, id: "w5-a" }),
  ], 5);

  assert.deepEqual(trend.availableWeeks, [3, 5]);
  assert.deepEqual(trend.missingWeeks, [4]);
  assert.equal(trend.weekCount, 2);
  assert.equal(trend.phase, "initial_comparison");
}

{
  const trend = buildDashboardWeeklyTrend([
    entry({ week: 4, id: "w4-a", exerciseName: "Press plano", reps: [10, 10, 10], targetSets: 3, targetReps: 10 }),
    entry({ week: 4, id: "w4-b", exerciseName: "Sentadilla", reps: [10, 10, 10], targetSets: 3, targetReps: 10 }),
    entry({ week: 5, id: "w5-a", exerciseName: "Press plano", reps: [10, 8, 0], targetSets: 3, targetReps: 10 }),
  ], 5);

  assert.equal(trend.currentWeekComplete, false);
  assert.equal(trend.isCurrentWeekInProgress, true);
}

{
  const trend = buildDashboardWeeklyTrend([
    entry({ week: 3, id: "w3-a" }),
    entry({ week: 4, id: "w4-a" }),
  ], 5);

  assert.equal(trend.currentWeekComplete, false);
  assert.equal(trend.isCurrentWeekInProgress, false);
  assert.deepEqual(trend.availableWeeks, [3, 4]);
}

{
  const trend = buildDashboardWeeklyTrend([
    entry({ week: 3, id: "valid", exerciseName: "Press plano" }),
    entry({ week: 4, id: "empty-name", exerciseName: "" }),
    entry({ week: 5, id: "zero-reps", exerciseName: "Sentadilla", reps: [0, 0, 0] }),
  ], 5);

  assert.deepEqual(trend.availableWeeks, [3]);
  assert.equal(trend.weekCount, 1);
}

{
  const mapped = mapDashboardInput({
    summary: summary({ week: 5 }),
    currentMetrics: [metric({ exerciseName: "Press plano", week: 5 })],
    entries: [
      entry({ week: 3, id: "w3-a", exerciseName: "Press plano", reps: [10, 10, 10], weight: 100 }),
      entry({ week: 4, id: "w4-a", exerciseName: "Press plano", reps: [11, 10, 10], weight: 100 }),
      entry({ week: 5, id: "w5-a", exerciseName: "Press plano", reps: [12, 10, 10], weight: 101, previousWeight: 100 }),
    ],
    currentWeek: 5,
    weeklyEquivalentProgress: progress("ready"),
  });

  const feedback = buildTrainingCoachFeedback(mapped);
  assert.equal(mapped.weeklyTrend?.phase, "early_trend");
  assert.ok(feedback.trendSignals?.includes("historical_early_trend"));
}

{
  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const scopedEntriesDeclaration = appSource.indexOf(
    "const activeCoachEntries = getDashboardCoachEntries(entries, activeDayData.exercises, usesCycleScopedSessions);",
  );
  const coachInputStart = appSource.indexOf("const coachInput = useMemo(() => buildTrainingCoachDashboardInput({");
  const coachFeedbackStart = appSource.indexOf("const coachFeedback = useMemo", coachInputStart);

  assert.ok(scopedEntriesDeclaration >= 0, "el historial del Coach se filtra con los ejercicios del día activo");
  assert.ok(coachInputStart > scopedEntriesDeclaration, "el día activo se resuelve antes de construir el input");
  assert.ok(coachFeedbackStart > coachInputStart, "el input puro se construye antes del feedback");

  const coachInputSource = appSource.slice(coachInputStart, coachFeedbackStart);
  assert.match(coachInputSource, /activeDay: activeCarouselDay/);
  assert.match(coachInputSource, /registeredExercises: activeDayData\.registeredCount/);
  assert.match(coachInputSource, /plannedExercises: activeDayData\.plannedCount/);
  assert.match(coachInputSource, /entries: activeCoachEntries/);
  assert.match(coachInputSource, /summary: activeCoachSummary/);
  assert.match(coachInputSource, /weeklyEquivalentProgress/);
  assert.match(coachInputSource, /\[\s*activeCarouselDay,[\s\S]*activeCoachEntries,[\s\S]*weeklyEquivalentProgress,/);
}

console.log("training-coach-dashboard-mapper tests passed");

type DashboardInputOverrides = Omit<TrainingCoachDashboardInput, "activeDay" | "activeDayCoverage"> &
  Partial<Pick<TrainingCoachDashboardInput, "activeDay" | "activeDayCoverage">>;

function mapDashboardInput(input: DashboardInputOverrides) {
  const {
    activeDay = "Lunes",
    activeDayCoverage = {
      registeredExercises: input.currentMetrics.length,
      plannedExercises: input.currentMetrics.length,
    },
    ...rest
  } = input;

  return buildTrainingCoachDashboardInput({
    activeDay,
    activeDayCoverage,
    ...rest,
  });
}

function progress(status: WeeklyEquivalentProgressResult["status"]): Pick<WeeklyEquivalentProgressResult, "status"> {
  return { status };
}

function summary(input: Partial<WeeklySummary>): WeeklySummary {
  return {
    week: input.week ?? 5,
    volumeTotal: input.volumeTotal ?? 1000,
    totalReps: input.totalReps ?? 100,
    exerciseCount: input.exerciseCount ?? 2,
    objectivesOk: input.objectivesOk ?? 2,
    objectivesFailed: input.objectivesFailed ?? 0,
    objectivesMaintained: input.objectivesMaintained ?? 0,
    volumeDifference: input.volumeDifference ?? 0,
    volumePercentage: input.volumePercentage ?? 0,
    repsDifference: input.repsDifference ?? 0,
    exerciseDifference: input.exerciseDifference ?? 0,
    complianceRate: input.complianceRate ?? 100,
  };
}

function metric(input: Partial<ExerciseMetrics>): ExerciseMetrics {
  return {
    id: input.id ?? `entry-${input.exerciseName ?? "exercise"}`,
    sessionId: input.sessionId,
    cycleId: input.cycleId,
    cycleDayId: input.cycleDayId,
    trainingCycleExerciseId: input.trainingCycleExerciseId,
    exerciseLineageId: input.exerciseLineageId,
    exerciseId: input.exerciseId ?? `exercise-${input.exerciseName ?? "exercise"}`,
    exerciseName: input.exerciseName ?? "Press plano",
    routine: input.routine ?? "Pecho",
    week: input.week ?? 5,
    date: input.date ?? "2026-07-05",
    targetSets: input.targetSets ?? 3,
    targetReps: input.targetReps ?? 10,
    weight: input.weight ?? 100,
    previousWeight: input.previousWeight ?? 100,
    reps: input.reps ?? [10, 10, 10],
    targetTotalReps: input.targetTotalReps ?? 30,
    totalReps: input.totalReps ?? 30,
    completedSets: input.completedSets ?? 3,
    setsDifference: input.setsDifference ?? 0,
    repsDifference: input.repsDifference ?? 0,
    kgDifference: input.kgDifference ?? 0,
    kgStatus: input.kgStatus ?? "Mismo kg",
    objectiveStatus: input.objectiveStatus ?? "Cumplimos",
    volumeTotal: input.volumeTotal ?? 3000,
    volumeDifference: input.volumeDifference ?? 0,
    volumePercentage: input.volumePercentage ?? 0,
  };
}

function entry(input: Partial<ExerciseEntry>): ExerciseEntry {
  return {
    id: input.id ?? "entry",
    sessionId: input.sessionId ?? "session",
    cycleId: input.cycleId,
    cycleDayId: input.cycleDayId,
    trainingCycleExerciseId: input.trainingCycleExerciseId,
    exerciseLineageId: input.exerciseLineageId,
    exerciseId: input.exerciseId ?? "exercise",
    exerciseName: input.exerciseName ?? "Press plano",
    routine: input.routine ?? "Pecho",
    week: input.week ?? 5,
    date: input.date ?? "2026-07-05",
    targetSets: input.targetSets ?? 3,
    targetReps: input.targetReps ?? 10,
    weight: input.weight ?? 100,
    previousWeight: input.previousWeight ?? 100,
    reps: input.reps ?? [10, 10, 10],
    notes: input.notes,
  };
}
