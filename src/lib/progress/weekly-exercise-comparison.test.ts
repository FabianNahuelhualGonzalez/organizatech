import assert from "node:assert/strict";

import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";
import { buildWeeklyExerciseComparisonModel } from "@/lib/progress/weekly-exercise-comparison";

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [
      exercise({ id: "press-plan", lineage: "lineage-press", name: "Press plano", day: "Lunes", routine: "Pecho" }),
      exercise({ id: "hack-plan", lineage: "lineage-hack", name: "Hack", day: "Miercoles", routine: "Piernas" }),
    ],
    entries: [
      entry({ id: "press-w1", exerciseId: "legacy-other", lineage: "lineage-press", name: "Otro nombre", routine: "Pecho", week: 1, date: "2026-06-24", weight: 100, reps: [6, 6, 6, 6] }),
      entry({ id: "press-w2", exerciseId: "legacy-other", lineage: "lineage-press", name: "Otro nombre", routine: "Pecho", week: 2, date: "2026-07-03", weight: 105, reps: [8, 8, 8, 8] }),
      entry({ id: "name-collision", exerciseId: "other", lineage: "lineage-other", name: "Press plano", routine: "Pecho", week: 2, date: "2026-07-03", weight: 999, reps: [99] }),
      entry({ id: "hack-w1", exerciseId: "hack-plan", lineage: "lineage-hack", name: "Hack", routine: "Piernas", week: 1, date: "2026-06-25", weight: 80, reps: [5, 5] }),
    ],
    selectedDay: "Lunes",
    selectedExerciseId: "lineage-press",
    currentWeek: 2,
  });

  assert.equal(model.selectedExercise?.exerciseLineageId, "lineage-press", "usa exerciseLineageId como identidad principal");
  assert.deepEqual(model.availableDays, ["Lunes", "Miercoles"]);
  assert.equal(model.plannedRoutine, "Pecho", "el dia seleccionado filtra rutina planificada");
  assert.deepEqual(model.availableWeeks, [1, 2], "no mezcla registros de otros dias ni colisiones por nombre");
  assert.equal(model.kgChartSeries[1].value, 105, "no compara por nombre cuando existe lineage");
  assert.equal(model.resultComparison.baseline?.date, "2026-06-24");
  assert.equal(model.resultComparison.effective?.date, "2026-07-03", "conserva fechas reales");
  assert.equal(model.repsChartSeries[0].value, 24, "grafico de reps usa total por semana");
  assert.equal(model.repsChartSeries[1].value, 32);
  assert.equal(model.resultComparison.baseline?.repsLabel, "6/6/6/6", "detalle por serie respeta cantidad real");
  assert.equal(model.repsSummary.difference, 8, "diferencia reps = total actual - total Semana 1");
  assert.equal(model.repsSummary.tone, "positive");
  assert.equal(model.kgSummary.difference, 5);
  assert.equal(model.kgSummary.tone, "positive");
  assert.equal(model.hasBaseline, true);
  assert.equal(model.hasCurrent, true);
  assert.equal(model.baselineWeek, 1);
  assert.equal(model.targetWeek, 2);
  assert.equal(model.effectiveWeek, 2, "semana derecha usa currentWeek si tiene datos");
  assert.equal(model.emptyState, "none");
  assert.deepEqual(model.kgChartSeries.map((point) => point.label), ["S1", "S2"], "solo grafica semanas reales");
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [
      exercise({ id: "sentadilla", lineage: "lineage-sentadilla", name: "Sentadilla", day: "Miercoles", routine: "Piernas" }),
      exercise({ id: "curl", lineage: "lineage-curl", name: "Curl", day: "Miercoles", routine: "Piernas" }),
    ],
    entries: [
      entry({ id: "curl-w1", exerciseId: "curl", lineage: "lineage-curl", name: "Curl", routine: "Piernas", week: 1, date: "2026-06-24", weight: 20, reps: [10] }),
    ],
    selectedDay: "Miercoles",
    selectedExerciseId: "no-existe",
    currentWeek: 1,
  });

  assert.equal(model.selectedExerciseId, "sentadilla", "ejercicio invalido selecciona el primero disponible del dia");
  assert.equal(model.plannedExercises[0].isSelected, true);
  assert.equal(model.emptyState, "no_real_records");
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "press", lineage: "lineage-press", name: "Press", day: "Lunes", routine: "Pecho" })],
    entries: [
      entry({ id: "press-w2", exerciseId: "press", lineage: "lineage-press", name: "Press", routine: "Pecho", week: 2, date: "2026-07-01", weight: 100, reps: [10, 10] }),
    ],
    selectedDay: "Lunes",
    selectedExerciseId: "press",
    currentWeek: 2,
  });

  assert.equal(model.hasBaseline, false, "Semana 1 solo es baseline si existe registro real");
  assert.equal(model.baselineWeek, null);
  assert.equal(model.emptyState, "no_baseline_week", "sin Semana 1 devuelve estado claro sin ceros");
  assert.deepEqual(model.kgChartSeries.map((point) => point.value), [100]);
  assert.equal(model.kgSummary.startValue, null);
  assert.equal(model.repsSummary.difference, null);
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "press", lineage: "lineage-press", name: "Press", day: "Lunes", routine: "Pecho" })],
    entries: [
      entry({ id: "press-w1", exerciseId: "press", lineage: "lineage-press", name: "Press", routine: "Pecho", week: 1, date: "2026-06-24", weight: 100, reps: [6, 6, 6, 6] }),
    ],
    selectedDay: "Lunes",
    selectedExerciseId: "press",
    currentWeek: 2,
  });

  assert.equal(model.hasBaseline, true);
  assert.equal(model.baselineWeek, 1);
  assert.equal(model.effectiveWeek, 1);
  assert.equal(model.emptyState, "insufficient_chart_data");
  assert.deepEqual(model.availableWeeks, [1], "no inventa semana actual si no existe registro");
  assert.deepEqual(model.kgChartSeries, [{ week: 1, label: "S1", value: 100, date: "2026-06-24" }]);
  assert.deepEqual(model.repsChartSeries, [{ week: 1, label: "S1", value: 24, date: "2026-06-24" }]);
  assert.equal(model.kgSummary.difference, 0, "no genera diferencias falsas con una sola semana");
  assert.equal(model.kgSummary.tone, "neutral");
  assert.equal(model.repsSummary.difference, 0);
  assert.equal(model.repsSummary.tone, "neutral");
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "remo", lineage: "lineage-remo", name: "Remo", day: "Jueves", routine: "Espalda" })],
    entries: [
      entry({ id: "remo-w1", exerciseId: "remo", lineage: "lineage-remo", name: "Remo", routine: "Espalda", week: 1, date: "2026-06-15", weight: 50, reps: [6, 6, 6] }),
      entry({ id: "remo-w2", exerciseId: "remo", lineage: "lineage-remo", name: "Remo", routine: "Espalda", week: 2, date: "2026-06-22", weight: 50, reps: [6, 6, 6] }),
      entry({ id: "remo-w5", exerciseId: "remo", lineage: "lineage-remo", name: "Remo", routine: "Espalda", week: 5, date: "2026-07-13", weight: 55, reps: [8, 8, 8] }),
    ],
    selectedDay: "Jueves",
    selectedExerciseId: "remo",
    currentWeek: 6,
  });

  assert.equal(model.targetWeek, 6);
  assert.equal(model.effectiveWeek, 5, "currentWeek 6 sin datos usa semana 5 si es ultimo registro");
  assert.equal(model.hasCurrent, false);
  assert.deepEqual(model.availableWeeks, [1, 2, 5]);
  assert.deepEqual(model.repsChartSeries.map((point) => point.label), ["S1", "S2", "S5"], "no grafica semanas vacias como cero");
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "remo", lineage: "lineage-remo", name: "Remo", day: "Jueves", routine: "Espalda" })],
    entries: [
      entry({ id: "remo-w1", exerciseId: "remo", lineage: "lineage-remo", name: "Remo", routine: "Espalda", week: 1, date: "2026-06-15", weight: 50, reps: [6, 6, 6] }),
      entry({ id: "remo-w5", exerciseId: "remo", lineage: "lineage-remo", name: "Remo", routine: "Espalda", week: 5, date: "2026-07-13", weight: 55, reps: [8, 8, 8] }),
      entry({ id: "remo-w6", exerciseId: "remo", lineage: "lineage-remo", name: "Remo", routine: "Espalda", week: 6, date: "2026-07-20", weight: 60, reps: [9, 9, 9] }),
    ],
    selectedDay: "Jueves",
    selectedExerciseId: "remo",
    currentWeek: 6,
  });

  assert.equal(model.effectiveWeek, 6, "currentWeek 6 con datos usa semana 6");
  assert.equal(model.hasCurrent, true);
  assert.equal(model.resultComparison.effective?.date, "2026-07-20");
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "hack", lineage: "lineage-hack", name: "Hack", day: "Miercoles", routine: "Piernas", targetSets: 5, targetReps: 5, baseWeight: 100 })],
    entries: [
      entry({ id: "hack-w1", exerciseId: "hack", lineage: "lineage-hack", name: "Hack", routine: "Piernas", week: 1, date: "2026-06-15", weight: 100, reps: [5, 5, 5, 5, 5] }),
      entry({ id: "hack-w2", exerciseId: "hack", lineage: "lineage-hack", name: "Hack", routine: "Piernas", week: 2, date: "2026-06-22", weight: 100, reps: [6, 6, 6] }),
      entry({ id: "hack-w3", exerciseId: "hack", lineage: "lineage-hack", name: "Hack", routine: "Piernas", week: 3, date: "2026-06-29", weight: 100, reps: [4, 4, 4, 4, 4, 4] }),
    ],
    selectedDay: "Miercoles",
    selectedExerciseId: "hack",
    currentWeek: 2,
  });

  assert.equal(model.plannedExercises[0].targetSets, 5, "rutina planificada no se confunde con registros reales");
  assert.equal(model.plannedExercises[0].targetReps, 5);
  assert.equal(model.plannedExercises[0].baseWeight, 100);
  assert.equal(model.resultComparison.effective?.repsLabel, "6/6/6", "semana con menos series no rompe");
  assert.equal(model.kgSummary.status, "neutral", "KG sin variacion genera estado neutral");
  assert.equal(model.kgSummary.tone, "neutral");
  assert.equal(model.kgSummary.difference, 0);
  assert.equal(model.repsSummary.difference, -7, "reps negativas se calculan contra Semana 1");
  assert.equal(model.repsSummary.tone, "negative");
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "fondos", lineage: "lineage-fondos", name: "Fondos", day: "Viernes", routine: "Push" })],
    entries: [
      entry({ id: "fondos-w1", exerciseId: "fondos", lineage: "lineage-fondos", name: "Fondos", routine: "Push", week: 1, date: "2026-06-15", weight: 0, reps: [10, 10] }),
      entry({ id: "fondos-w2", exerciseId: "fondos", lineage: "lineage-fondos", name: "Fondos", routine: "Push", week: 2, date: "2026-06-22", weight: 0, reps: [10, 10] }),
    ],
    selectedDay: "Viernes",
    selectedExerciseId: "fondos",
    currentWeek: 2,
  });

  assert.equal(Object.is(model.repsSummary.difference, -0), false, "no genera -0");
  assert.equal(model.repsSummary.difference, 0, "reps neutrales");
  assert.equal(model.repsSummary.tone, "neutral");
  assert.equal(model.kgSummary.difference, 0);
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "bad", lineage: "lineage-bad", name: "Bad", day: "Lunes", routine: "Test" })],
    entries: [
      entry({ id: "bad-w1", exerciseId: "bad", lineage: "lineage-bad", name: "Bad", routine: "Test", week: 1, date: "2026-06-15", weight: Number.POSITIVE_INFINITY, reps: [10] }),
      entry({ id: "bad-w2", exerciseId: "bad", lineage: "lineage-bad", name: "Bad", routine: "Test", week: 2, date: "2026-06-22", weight: Number.NaN, reps: [Number.POSITIVE_INFINITY, Number.NaN] }),
    ],
    selectedDay: "Lunes",
    selectedExerciseId: "bad",
    currentWeek: 2,
  });

  assert.equal(model.emptyState, "no_real_records", "no NaN ni Infinity entran como datos reales");
  assert.deepEqual(model.kgChartSeries, []);
  assert.deepEqual(model.repsChartSeries, []);
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "", lineage: null, name: "Sin identidad", day: "Lunes", routine: "Test" })],
    entries: [entry({ id: "e1", exerciseId: "", lineage: null, name: "Sin identidad", routine: "Test", week: 1, date: "2026-06-15", weight: 10, reps: [10] })],
    selectedDay: "Lunes",
    selectedExerciseId: null,
    currentWeek: 1,
  });

  assert.equal(model.emptyState, "no_reliable_identity", "sin identidad confiable devuelve estado vacio");
  assert.deepEqual(model.kgChartSeries, []);
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [exercise({ id: "press", lineage: "lineage-press", name: "Press", day: "Lunes", routine: "Pecho" })],
    entries: [],
    selectedDay: "Domingo",
    selectedExerciseId: null,
    currentWeek: 1,
  });

  assert.equal(model.emptyState, "no_routine_for_day");
  assert.deepEqual(model.plannedExercises, []);
}

{
  const model = buildWeeklyExerciseComparisonModel({
    plannedExercises: [
      exercise({ id: "fallback", lineage: null, name: "Fallback", day: "Lunes", routine: "Legacy" }),
    ],
    entries: [
      entry({ id: "fallback-w1", exerciseId: "fallback", lineage: null, name: "Fallback", routine: "Legacy", week: 1, date: "2026-06-15", weight: 10, reps: [5] }),
      entry({ id: "same-name", exerciseId: "other-id", lineage: null, name: "Fallback", routine: "Legacy", week: 2, date: "2026-06-22", weight: 99, reps: [99] }),
    ],
    selectedDay: "Lunes",
    selectedExerciseId: "fallback",
    currentWeek: 2,
  });

  assert.deepEqual(model.availableWeeks, [1], "fallback seguro por id no mezcla por nombre");
  assert.equal(model.kgChartSeries[0].value, 10);
}

console.log("weekly-exercise-comparison tests passed");

function exercise(input: {
  id: string;
  lineage: string | null;
  name: string;
  day: string;
  routine: string;
  targetSets?: number;
  targetReps?: number;
  baseWeight?: number;
}): ExerciseTemplate {
  return {
    id: input.id,
    exerciseLineageId: input.lineage,
    routine: input.routine,
    day: input.day,
    name: input.name,
    targetSets: input.targetSets ?? 4,
    targetReps: input.targetReps ?? 10,
    baseWeight: input.baseWeight ?? 50,
  };
}

function entry(input: {
  id: string;
  exerciseId: string;
  lineage: string | null;
  name: string;
  routine: string;
  week: number;
  date: string;
  weight: number;
  reps: number[];
}): ExerciseEntry {
  return {
    id: input.id,
    sessionId: `session-${input.id}`,
    exerciseId: input.exerciseId,
    exerciseLineageId: input.lineage,
    exerciseName: input.name,
    routine: input.routine,
    week: input.week,
    date: input.date,
    targetSets: input.reps.length,
    targetReps: input.reps[0] ?? 0,
    weight: input.weight,
    previousWeight: input.weight,
    reps: input.reps,
  };
}
