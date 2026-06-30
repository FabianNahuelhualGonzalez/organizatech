import assert from "node:assert/strict";

import type { ExerciseEntry, TrainingSession } from "@/lib/progress/types";
import {
  calculateEquivalentWeeklyProgress,
  formatProgressPercentage,
  getEquivalentWeeklyDateRanges,
  resolvePlannedWeekDays,
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

assert.deepEqual(
  resolvePlannedWeekDays(["Viernes", "Lunes", "Miercoles", "Lunes"]),
  ["Lunes", "Miércoles", "Viernes"],
  "deduplica y ordena los dias planificados",
);

assert.deepEqual(
  resolvePlannedWeekDays(["2026-07-04", "Martes", "Jueves"]),
  ["Martes", "Jueves", "Sábado"],
  "acepta fechas y rutinas no consecutivas",
);

assert.deepEqual(resolvePlannedWeekDays([]), ["Lunes"], "mantiene fallback seguro para planes vacios");

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-07-01",
    plannedDays: ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"],
    entries: [
      volumeEntry("previous-l", "2026-06-22", 150),
      volumeEntry("previous-m", "2026-06-23", 140),
      volumeEntry("previous-x", "2026-06-24", 125),
      volumeEntry("previous-j", "2026-06-25", 75),
      volumeEntry("previous-v", "2026-06-26", 10),
      volumeEntry("current-l", "2026-06-29", 175),
      volumeEntry("current-m", "2026-06-30", 123.75),
    ],
  });

  assert.deepEqual(result.plannedDays, ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]);
  assert.equal(result.previousFinalVolume, 500, "la semana anterior completa fija el baseline");
  assert.equal(result.points.length, 5, "el eje muestra todos los dias planificados");
  assert.deepEqual(result.points.map((point) => point.label), ["L", "M", "X", "J", "V"]);
  assert.deepEqual(result.points.map((point) => point.previousPercentage), [-70, -42, -17, -2, 0]);
  assert.deepEqual(result.points.map((point) => point.currentPercentage), [-65, -40.25, -40.25, null, null]);
  assert.equal(result.points[2].currentVolume, 298.75, "dia transcurrido sin sesion conserva acumulado plano");
  assert.equal(result.points[3].currentVolume, null, "dia futuro queda sin dato inventado");
  assert.equal(result.points[4].currentPercentage, null, "la serie actual no se extiende al futuro");
  assert.equal(result.currentEquivalentValue, 298.75);
  assert.equal(result.previousEquivalentValue, 415);
  assert.equal(result.percentage, -40.25);
  assert.equal(result.previousComparablePercentage, -17);
  assert.equal(result.differenceValue, -116.25);
  assert.equal(result.primaryLabel, "-116,25 kg");
  assert.equal(result.previousLabel, "415 kg");
  assert.equal(result.currentVolumeLabel, "298,75 kg");
  assert.equal(result.previousVolumeLabel, "415 kg");
  assert.equal(result.comparisonLabel, "Vs semana anterior");
  assert.equal(result.detailLabel, "Semana actual");
  assert.equal(result.tone, "danger");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-07-03",
    plannedDays: ["Lunes", "Miercoles", "Viernes"],
    entries: [
      volumeEntry("previous-l", "2026-06-22", 100),
      volumeEntry("previous-x", "2026-06-24", 200),
      volumeEntry("previous-v", "2026-06-26", 200),
      volumeEntry("current-l", "2026-06-29", 250),
      volumeEntry("current-x", "2026-07-01", 250),
      volumeEntry("current-v", "2026-07-03", 200),
    ],
  });

  assert.deepEqual(result.plannedDays, ["Lunes", "Miércoles", "Viernes"]);
  assert.equal(result.points.at(-1)?.previousPercentage, 0, "la semana anterior termina en 0%");
  assert.equal(result.percentage, 40, "la semana actual puede superar el baseline final");
  assert.equal(result.differenceValue, 200);
  assert.equal(result.primaryLabel, "+200 kg");
  assert.equal(result.tone, "positive");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-07-01",
    plannedDays: ["Martes", "Jueves", "Sabado"],
    entries: [
      volumeEntry("previous-m", "2026-06-23", 100),
      volumeEntry("previous-j", "2026-06-25", 200),
      volumeEntry("previous-s", "2026-06-27", 200),
      volumeEntry("current-m", "2026-06-30", 50),
    ],
  });

  assert.deepEqual(result.points.map((point) => point.label), ["M", "J", "S"]);
  assert.deepEqual(result.points.map((point) => point.currentPercentage), [-90, null, null]);
  assert.equal(result.percentage, -90, "usa el ultimo dia planificado transcurrido, aunque haya gaps");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    plannedDays: ["Lunes"],
    entries: [
      volumeEntry("current", "2026-06-29", 10),
      volumeEntry("previous", "2026-06-22", 10),
    ],
  });

  assert.equal(result.points.length, 1);
  assert.equal(result.percentage, 0);
  assert.equal(result.differenceValue, 0);
  assert.equal(result.primaryLabel, "0 kg");
  assert.equal(result.tone, "neutral");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    plannedDays: ["Lunes"],
    entries: [volumeEntry("current", "2026-06-29", 10)],
  });

  assert.equal(result.previousFinalVolume, 0);
  assert.equal(result.percentage, null, "semana anterior en 0 no produce infinito");
  assert.equal(result.primaryLabel, "—");
  assert.equal(result.detailLabel, "Sin comparación anterior");
  assert.equal(result.status, "no_previous");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    plannedDays: ["Lunes"],
    entries: [],
  });

  assert.equal(result.currentEquivalentValue, 0);
  assert.equal(result.previousEquivalentValue, 0);
  assert.equal(result.percentage, null, "ambos periodos en 0 no produce NaN");
  assert.equal(result.detailLabel, "Sin registros equivalentes");
  assert.equal(result.status, "neutral");
  assert.equal(result.tone, "neutral");
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    plannedDays: ["Lunes"],
    sessions: [
      session("deleted", "completed", "2026-06-22", "2026-06-22", "2026-06-22T10:00:00Z"),
      session("skipped", "skipped", "2026-06-22", "2026-06-22", "2026-06-22T10:00:00Z"),
      session("valid", "completed", "2026-06-22", "2026-06-22", "2026-06-22T10:00:00Z"),
    ],
    entries: [
      volumeEntry("current", "2026-06-29", 200),
      volumeEntry("deleted-entry", "2026-06-22", 999, { sessionId: "deleted" }),
      volumeEntry("skipped-entry", "2026-06-22", 999, { sessionId: "skipped" }),
      volumeEntry("valid-entry", "2026-06-22", 100, { sessionId: "valid" }),
    ],
  });

  assert.equal(result.previousEquivalentValue, 100, "sesiones eliminadas y skipped se excluyen");
  assert.equal(result.percentage, 100);
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    activeCycleId: "cycle-a",
    plannedDays: ["Lunes"],
    entries: [
      volumeEntry("current-a", "2026-06-29", 200, { cycleId: "cycle-a" }),
      volumeEntry("previous-a", "2026-06-22", 100, { cycleId: "cycle-a" }),
      volumeEntry("current-b", "2026-06-29", 999, { cycleId: "cycle-b" }),
      volumeEntry("previous-b", "2026-06-22", 999, { cycleId: "cycle-b" }),
    ],
  });

  assert.equal(result.currentEquivalentValue, 200, "no mezcla otro ciclo");
  assert.equal(result.previousEquivalentValue, 100);
  assert.equal(result.percentage, 100);
}

{
  const result = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-06-30",
    plannedDays: ["Lunes"],
    entries: [
      volumeEntry("current", "2026-06-29", 100),
      volumeEntry("outside-current", "2026-07-01", 999),
      volumeEntry("previous", "2026-06-22", 100),
      volumeEntry("outside-previous", "2026-06-24", 999),
      volumeEntry("duplicate", "2026-06-29", 100),
      volumeEntry("duplicate", "2026-06-29", 100),
    ],
  });

  assert.equal(result.currentEquivalentValue, 200, "no mezcla otra semana ni duplica mismo id");
  assert.equal(result.previousEquivalentValue, 100);
  assert.equal(result.percentage, 100);
}

{
  const firstWeek = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-07-03",
    plannedDays: ["Lunes", "Viernes"],
    entries: [
      volumeEntry("previous-l", "2026-06-22", 100),
      volumeEntry("previous-v", "2026-06-26", 100),
      volumeEntry("current-l", "2026-06-29", 200),
      volumeEntry("current-v", "2026-07-03", 300),
    ],
  });
  const nextWeek = calculateEquivalentWeeklyProgress({
    referenceDate: "2026-07-06",
    plannedDays: ["Lunes", "Viernes"],
    entries: [
      volumeEntry("previous-l", "2026-06-22", 100),
      volumeEntry("previous-v", "2026-06-26", 100),
      volumeEntry("current-l", "2026-06-29", 200),
      volumeEntry("current-v", "2026-07-03", 300),
      volumeEntry("next-l", "2026-07-06", 250),
    ],
  });

  assert.equal(firstWeek.previousFinalVolume, 200);
  assert.equal(nextWeek.previousFinalVolume, 500, "al cambiar de semana la semana cerrada pasa a referencia");
  assert.equal(nextWeek.points[0].previousVolume, 200);
}

assert.equal(formatProgressPercentage(-40.25), "-40,25%");
assert.equal(formatProgressPercentage(125.5), "+125,5%");
assert.equal(formatProgressPercentage(-0), "0%");
assert.equal(formatProgressPercentage(Number.NaN), "—");
assert.equal(formatProgressPercentage(Number.POSITIVE_INFINITY), "—");

console.log("weekly-equivalent-progress tests passed");

function volumeEntry(
  id: string,
  date: string,
  volume: number,
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
    weight: volume / 10,
    previousWeight: volume / 10,
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
