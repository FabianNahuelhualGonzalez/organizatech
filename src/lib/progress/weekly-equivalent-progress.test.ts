import assert from "node:assert/strict";

import type { ExerciseEntry, TrainingSession } from "@/lib/progress/types";
import {
  calculateEquivalentWeeklyProgress,
  getEquivalentWeeklyDateRanges,
} from "@/lib/progress/weekly-equivalent-progress";

assert.deepEqual(getEquivalentWeeklyDateRanges("2026-06-29"), {
  currentWeekStart: "2026-06-29",
  currentComparisonEnd: "2026-06-29",
  previousWeekStart: "2026-06-22",
  previousComparisonEnd: "2026-06-22",
  elapsedDayCount: 1,
  todayLabel: "L",
});

assert.deepEqual(getEquivalentWeeklyDateRanges("2026-06-30"), {
  currentWeekStart: "2026-06-29",
  currentComparisonEnd: "2026-06-30",
  previousWeekStart: "2026-06-22",
  previousComparisonEnd: "2026-06-23",
  elapsedDayCount: 2,
  todayLabel: "M",
});

assert.deepEqual(getEquivalentWeeklyDateRanges("2026-07-03"), {
  currentWeekStart: "2026-06-29",
  currentComparisonEnd: "2026-07-03",
  previousWeekStart: "2026-06-22",
  previousComparisonEnd: "2026-06-26",
  elapsedDayCount: 5,
  todayLabel: "V",
});

assert.deepEqual(getEquivalentWeeklyDateRanges("2026-07-05"), {
  currentWeekStart: "2026-06-29",
  currentComparisonEnd: "2026-07-05",
  previousWeekStart: "2026-06-22",
  previousComparisonEnd: "2026-06-28",
  elapsedDayCount: 7,
  todayLabel: "D",
});

assert.equal(
  getEquivalentWeeklyDateRanges(new Date("2026-06-17T02:30:00.000Z")).currentComparisonEnd,
  "2026-06-16",
  "America/Santiago define el dia local aunque UTC ya este en miercoles",
);

assert.deepEqual(getEquivalentWeeklyDateRanges("2026-07-01"), {
  currentWeekStart: "2026-06-29",
  currentComparisonEnd: "2026-07-01",
  previousWeekStart: "2026-06-22",
  previousComparisonEnd: "2026-06-24",
  elapsedDayCount: 3,
  todayLabel: "X",
});

assert.deepEqual(getEquivalentWeeklyDateRanges("2027-01-01"), {
  currentWeekStart: "2026-12-28",
  currentComparisonEnd: "2027-01-01",
  previousWeekStart: "2026-12-21",
  previousComparisonEnd: "2026-12-25",
  elapsedDayCount: 5,
  todayLabel: "V",
});

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    entries: [
      entry("current-lunes", "2026-06-29", 10),
      entry("current-martes", "2026-06-30", 10),
      entry("previous-lunes", "2026-06-22", 10),
      entry("previous-martes", "2026-06-23", 30),
      entry("previous-future", "2026-06-24", 999),
    ],
  });

  assert.equal(result.currentEquivalentValue, 200);
  assert.equal(result.previousEquivalentValue, 400);
  assert.equal(result.percentage, -50, "porcentaje negativo usa periodos equivalentes lunes-martes");
  assert.equal(result.primaryLabel, "-50%");
  assert.equal(result.tone, "danger");
  assert.equal(result.comparisonLabel, "vs mismo punto de la semana anterior");
  assert.equal(result.points.length, 2, "no incluye dias futuros");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    entries: [
      entry("current", "2026-06-29", 15),
      entry("previous", "2026-06-22", 10),
    ],
  });

  assert.equal(result.percentage, 50, "porcentaje positivo correcto");
  assert.equal(result.primaryLabel, "+50%");
  assert.equal(result.tone, "positive");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    entries: [
      entry("current", "2026-06-29", 10),
      entry("previous", "2026-06-22", 10),
    ],
  });

  assert.equal(result.percentage, 0, "porcentaje cero correcto");
  assert.equal(result.primaryLabel, "0%");
  assert.equal(result.tone, "neutral");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    entries: [entry("current", "2026-06-29", 10)],
  });

  assert.equal(result.previousEquivalentValue, 0);
  assert.equal(result.percentage, null, "semana anterior en 0 no produce infinito");
  assert.equal(result.primaryLabel, "—");
  assert.equal(result.detailLabel, "Sin comparación anterior");
  assert.equal(Number.isFinite(result.percentage ?? 0), true);
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    entries: [],
  });

  assert.equal(result.currentEquivalentValue, 0);
  assert.equal(result.previousEquivalentValue, 0);
  assert.equal(result.percentage, null, "ambos periodos en 0 no produce NaN");
  assert.equal(result.detailLabel, "Sin registros equivalentes");
  assert.equal(result.tone, "neutral");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    sessions: [
      session("deleted", "completed", "2026-06-22", "2026-06-22", "2026-06-22T10:00:00Z"),
      session("skipped", "skipped", "2026-06-22", "2026-06-22", "2026-06-22T10:00:00Z"),
      session("valid", "completed", "2026-06-22", "2026-06-22", "2026-06-22T10:00:00Z"),
    ],
    entries: [
      entry("current", "2026-06-29", 20),
      entry("deleted-entry", "2026-06-22", 999, { sessionId: "deleted" }),
      entry("skipped-entry", "2026-06-22", 999, { sessionId: "skipped" }),
      entry("valid-entry", "2026-06-22", 10, { sessionId: "valid" }),
    ],
  });

  assert.equal(result.previousEquivalentValue, 100, "sesiones eliminadas y skipped se excluyen");
  assert.equal(result.percentage, 100);
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    activeCycleId: "cycle-a",
    entries: [
      entry("current-a", "2026-06-29", 20, { cycleId: "cycle-a" }),
      entry("previous-a", "2026-06-22", 10, { cycleId: "cycle-a" }),
      entry("current-b", "2026-06-29", 999, { cycleId: "cycle-b" }),
      entry("previous-b", "2026-06-22", 999, { cycleId: "cycle-b" }),
    ],
  });

  assert.equal(result.currentEquivalentValue, 200, "no mezcla otro ciclo");
  assert.equal(result.previousEquivalentValue, 100);
  assert.equal(result.percentage, 100);
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    entries: [
      entry("current", "2026-06-29", 10),
      entry("outside-current", "2026-07-01", 999),
      entry("previous", "2026-06-22", 10),
      entry("outside-previous", "2026-06-24", 999),
      entry("duplicate", "2026-06-29", 10),
      entry("duplicate", "2026-06-29", 10),
    ],
  });

  assert.equal(result.currentEquivalentValue, 200, "no mezcla otra semana ni duplica mismo id");
  assert.equal(result.previousEquivalentValue, 100);
  assert.equal(result.percentage, 100);
}

console.log("weekly-equivalent-progress tests passed");

function entry(
  id: string,
  date: string,
  weight: number,
  overrides: Partial<ExerciseEntry> = {},
): ExerciseEntry {
  return {
    id,
    exerciseId: `exercise-${id}`,
    exerciseName: `Exercise ${id}`,
    routine: "Rutina",
    week: 1,
    date,
    targetSets: 1,
    targetReps: 10,
    weight,
    previousWeight: weight,
    reps: [10],
    ...overrides,
  };
}

function session(
  id: string,
  status: TrainingSession["status"],
  calendarWeekStart: string,
  trainedDate: string,
  trainedAt: string,
): TrainingSession {
  return {
    id,
    routineId: null,
    routine: "Rutina",
    weekNumber: 1,
    calendarWeekStart,
    plannedDay: "monday",
    plannedDate: trainedDate,
    trainedDate,
    trainedAt,
    status,
    deletedAt: id === "deleted" ? "2026-06-23T10:00:00Z" : undefined,
    entries: [],
  };
}
