import assert from "node:assert/strict";

import {
  buildCycleHistoryMetricsSummary,
  calculateCycleHistoryTotalVolume,
  calculateCycleHistoryVolumeProgress,
  calculateCycleHistoryWeeklyVolume,
  countCycleHistoryRegisteredExercises,
  describeCycleHistoryVolumeProgress,
} from "@/lib/training/cycle-history/cycle-history-metrics";
import type {
  CycleHistoryBreakdown,
  CycleHistoryExerciseBreakdown,
  CycleHistoryWeekRegistration,
} from "@/lib/training/cycle-history/cycle-history-types";

function weekRegistration(week: number, volume: number): CycleHistoryWeekRegistration {
  return { week, series: [{ entryId: `entry-w${week}`, weight: 100, reps: [10], volume }], totalReps: 10, volume };
}

function exercise(
  identityKey: string,
  weeks: CycleHistoryWeekRegistration[],
  plan: CycleHistoryExerciseBreakdown["plan"] = { targetSets: 4, targetReps: 10, baseWeight: 100 },
): CycleHistoryExerciseBreakdown {
  return {
    identity: { kind: "lineage", key: identityKey },
    name: "Press militar",
    plan,
    weeks: Object.fromEntries(weeks.map((week) => [week.week, week])),
  };
}

function breakdown(exercises: CycleHistoryExerciseBreakdown[], weeksWithData: number[]): CycleHistoryBreakdown {
  return {
    cycleId: "cycle-3",
    routines: [{ routineId: "routine-1", routineName: "Torso Fuerza", sortOrder: 0, exercises }],
    weeksWithData,
  };
}

// Volumen semanal y total suman correctamente entre ejercicios.
function testWeeklyAndTotalVolumeSumAcrossExercises() {
  const model = breakdown(
    [
      exercise("lineage-a", [weekRegistration(1, 1000), weekRegistration(2, 1200)]),
      exercise("lineage-b", [weekRegistration(1, 500)]),
    ],
    [1, 2],
  );

  const weekly = calculateCycleHistoryWeeklyVolume(model);
  assert.deepEqual(weekly, { 1: 1500, 2: 1200 });
  assert.equal(calculateCycleHistoryTotalVolume(model), 2700);
}

// Progreso positivo.
function testProgressIncrease() {
  const model = breakdown([exercise("lineage-a", [weekRegistration(1, 1000), weekRegistration(4, 1500)])], [1, 4]);
  const progress = calculateCycleHistoryVolumeProgress(model);

  assert.equal(progress.state, "increase");
  assert.equal(progress.firstWeek, 1);
  assert.equal(progress.lastWeek, 4);
  assert.equal(progress.differenceKg, 500);
  assert.equal(
    describeCycleHistoryVolumeProgress(progress),
    "Aumentaste 500 kg de volumen entre tu primera y última semana registrada.",
  );
}

// Progreso negativo.
function testProgressDecrease() {
  const model = breakdown([exercise("lineage-a", [weekRegistration(1, 1500), weekRegistration(2, 900)])], [1, 2]);
  const progress = calculateCycleHistoryVolumeProgress(model);

  assert.equal(progress.state, "decrease");
  assert.equal(progress.differenceKg, -600);
  assert.equal(
    describeCycleHistoryVolumeProgress(progress),
    "Disminuiste 600 kg de volumen entre tu primera y última semana registrada.",
  );
}

// Progreso sin cambio (cero).
function testProgressUnchanged() {
  const model = breakdown([exercise("lineage-a", [weekRegistration(1, 1000), weekRegistration(3, 1000)])], [1, 3]);
  const progress = calculateCycleHistoryVolumeProgress(model);

  assert.equal(progress.state, "unchanged");
  assert.equal(progress.differenceKg, 0);
  assert.equal(
    describeCycleHistoryVolumeProgress(progress),
    "Mantuviste el mismo volumen entre tu primera y última semana registrada.",
  );
}

// Progreso con una sola semana valida -> insufficient_data.
function testProgressInsufficientDataWithOneWeek() {
  const model = breakdown([exercise("lineage-a", [weekRegistration(1, 1000)])], [1]);
  const progress = calculateCycleHistoryVolumeProgress(model);

  assert.equal(progress.state, "insufficient_data");
  assert.equal(progress.differenceKg, null);
  assert.equal(
    describeCycleHistoryVolumeProgress(progress),
    "Necesitas al menos dos semanas registradas para calcular tu progreso.",
  );
}

// Progreso sin ninguna semana con datos -> insufficient_data.
function testProgressInsufficientDataWithNoWeeks() {
  const model = breakdown([exercise("lineage-a", [])], []);
  const progress = calculateCycleHistoryVolumeProgress(model);

  assert.equal(progress.state, "insufficient_data");
  assert.equal(progress.firstWeek, null);
  assert.equal(progress.lastWeek, null);
}

// El progreso usa la primera y ultima semana CON DATOS, no semana 1 y semana N del ciclo.
function testProgressUsesFirstAndLastWeekWithData() {
  const model = breakdown([exercise("lineage-a", [weekRegistration(3, 1000), weekRegistration(7, 1300)])], [3, 7]);
  const progress = calculateCycleHistoryVolumeProgress(model);

  assert.equal(progress.firstWeek, 3);
  assert.equal(progress.lastWeek, 7);
  assert.equal(progress.differenceKg, 300);
}

// Ejercicios registrados: cuenta unicos con al menos un registro, ignora planificados sin registro.
function testCountsOnlyExercisesWithRegistrations() {
  const model = breakdown(
    [
      exercise("lineage-a", [weekRegistration(1, 1000)]),
      exercise("lineage-b", []), // planificado, sin registros
    ],
    [1],
  );

  assert.equal(countCycleHistoryRegisteredExercises(model), 1);
}

// Ejercicios registrados: el mismo lineage repetido en dos rutinas cuenta una sola vez.
function testCountsUniqueAcrossRoutines() {
  const model: CycleHistoryBreakdown = {
    cycleId: "cycle-3",
    routines: [
      { routineId: "routine-1", routineName: "Torso", sortOrder: 0, exercises: [exercise("lineage-shared", [weekRegistration(1, 1000)])] },
      { routineId: "routine-2", routineName: "Full body", sortOrder: 1, exercises: [exercise("lineage-shared", [weekRegistration(2, 1100)])] },
    ],
    weeksWithData: [1, 2],
  };

  assert.equal(countCycleHistoryRegisteredExercises(model), 1);
}

// buildCycleHistoryMetricsSummary agrega todo de forma consistente.
function testMetricsSummaryAggregatesEverything() {
  const model = breakdown([exercise("lineage-a", [weekRegistration(1, 1000), weekRegistration(2, 1200)])], [1, 2]);
  const summary = buildCycleHistoryMetricsSummary(model);

  assert.equal(summary.totalVolumeKg, 2200);
  assert.equal(summary.registeredExerciseCount, 1);
  assert.deepEqual(summary.weeklyVolumeKg, { 1: 1000, 2: 1200 });
  assert.equal(summary.volumeProgress.state, "increase");
}

testWeeklyAndTotalVolumeSumAcrossExercises();
testProgressIncrease();
testProgressDecrease();
testProgressUnchanged();
testProgressInsufficientDataWithOneWeek();
testProgressInsufficientDataWithNoWeeks();
testProgressUsesFirstAndLastWeekWithData();
testCountsOnlyExercisesWithRegistrations();
testCountsUniqueAcrossRoutines();
testMetricsSummaryAggregatesEverything();

console.log("cycle-history-metrics tests passed");
