import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getCalendarWeekStartDateKey,
  getCycleCalendarPlannedDate,
  getCycleCalendarWeekNumber,
  getSessionEffectiveCalendarWeekStart,
  getSessionEffectiveCycleWeekNumber,
} from "@/lib/training/cycle-calendar-week";
import type { TrainingDayCode } from "@/lib/progress/types";

const plannedStartDate = "2026-06-08";

async function run() {
  assert.equal(getCalendarWeekStartDateKey("2026-06-22"), "2026-06-22");
  assert.equal(getCalendarWeekStartDateKey("2026-06-28"), "2026-06-22");
  assert.equal(getCalendarWeekStartDateKey("2026-06-29"), "2026-06-29");

  assert.equal(getCycleCalendarWeekNumber(plannedStartDate, "2026-06-08"), 1);
  assert.equal(getCycleCalendarWeekNumber(plannedStartDate, "2026-06-14"), 1);
  assert.equal(getCycleCalendarWeekNumber(plannedStartDate, "2026-06-15"), 2);
  assert.equal(getCycleCalendarWeekNumber(plannedStartDate, "2026-06-22"), 3);
  assert.equal(getCycleCalendarWeekNumber(plannedStartDate, "2026-06-28"), 3);
  assert.equal(getCycleCalendarWeekNumber(plannedStartDate, "2026-06-29"), 4);

  const weekThreeDates: Array<[TrainingDayCode, string]> = [
    ["monday", "2026-06-22"],
    ["tuesday", "2026-06-23"],
    ["wednesday", "2026-06-24"],
    ["thursday", "2026-06-25"],
    ["friday", "2026-06-26"],
    ["saturday", "2026-06-27"],
    ["sunday", "2026-06-28"],
  ];
  for (const [plannedDay, expectedDate] of weekThreeDates) {
    assert.equal(getCycleCalendarPlannedDate({ plannedStartDate, weekNumber: 3, plannedDay }), expectedDate);
  }

  assert.throws(
    () => getCycleCalendarPlannedDate({ plannedStartDate, weekNumber: 0, plannedDay: "monday" }),
    /entero mayor o igual a 1/,
  );

  assert.equal(
    getSessionEffectiveCycleWeekNumber(plannedStartDate, {
      trainedDate: "2026-06-24",
      plannedDate: "2026-06-10",
      trainedAt: "2026-06-10T12:00:00.000Z",
    }),
    3,
    "trainedDate corrige historicos con week_number persistido incorrecto",
  );
  assert.equal(
    getSessionEffectiveCycleWeekNumber(plannedStartDate, {
      trainedDate: null,
      plannedDate: "2026-06-17",
      trainedAt: "2026-06-10T12:00:00.000Z",
    }),
    2,
    "plannedDate es fallback seguro",
  );
  assert.equal(
    getSessionEffectiveCycleWeekNumber(plannedStartDate, {
      trainedDate: null,
      plannedDate: null,
      trainedAt: "2026-06-29T03:00:00.000Z",
    }),
    4,
    "trainedAt normalizado es ultimo fallback",
  );
  assert.equal(
    getSessionEffectiveCalendarWeekStart({
      calendarWeekStart: "2026-06-22",
      trainedDate: "2026-06-24",
    }),
    "2026-06-22",
    "calendarWeekStart valido se respeta para filtrar dashboard",
  );
  assert.equal(
    getSessionEffectiveCalendarWeekStart({
      calendarWeekStart: null,
      trainedDate: "2026-06-24",
    }),
    "2026-06-22",
  );

  const previousWeekSession = {
    calendarWeekStart: "2026-06-22",
    trainedDate: "2026-06-22",
  };
  const currentWeekSession = {
    calendarWeekStart: "2026-06-29",
    trainedDate: "2026-06-29",
  };
  assert.notEqual(
    getSessionEffectiveCalendarWeekStart(previousWeekSession),
    getCalendarWeekStartDateKey("2026-06-29"),
    "una sesion del lunes anterior no completa el lunes actual",
  );
  assert.equal(
    getSessionEffectiveCalendarWeekStart(currentWeekSession),
    getCalendarWeekStartDateKey("2026-06-29"),
    "una sesion de la semana activa si puede completar el dia",
  );

  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  assert.match(appSource, /getCycleCalendarWeekNumber\(persistedActiveCycle\.plannedStartDate, todayKey\)/, "currentWeek scoped usa calendario del ciclo");
  assert.match(appSource, /weekNumber: effectiveWeekNumber/, "guardado scoped usa effectiveWeekNumber");
  assert.doesNotMatch(appSource, /weekNumber: cycleDay\.weekIndex/, "guardado scoped no usa weekIndex de plantilla");
  assert.doesNotMatch(appSource, /usesCycleScopedSessions \|\| session\.calendarWeekStart === currentWeekStart/, "dashboard scoped no permite todas las sesiones historicas");
  assert.doesNotMatch(appSource, /usesCycleScopedSessions \|\| normalizeEntryDateKey\(entry\.date\) === expectedDate/, "dashboard scoped no mezcla entries historicas globales");
  assert.match(appSource, /usesCycleScopedSessions\s*\?\s*sessionEntries/, "dashboard scoped usa entries de la sesion semanal seleccionada");
  assert.match(appSource, /const dashboardCarouselDays = hasRoutinePlan \? routineDays : setupDays;/, "carrusel usa dias configurados por el usuario cuando hay plan");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
