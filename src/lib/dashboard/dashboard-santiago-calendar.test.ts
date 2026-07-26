import assert from "node:assert/strict";

import {
  getCurrentSantiagoWeekDates,
  getLocalDateKey,
  getTrainingDayCode,
  getTrainingDayFromDate,
} from "@/lib/dashboard/dashboard-santiago-calendar";

function testCurrentSantiagoWeekUsesAControlledReferenceDate() {
  assert.deepEqual(
    getCurrentSantiagoWeekDates(new Date("2026-07-08T16:00:00.000Z")),
    {
      Lunes: "2026-07-06",
      Martes: "2026-07-07",
      Miércoles: "2026-07-08",
      Jueves: "2026-07-09",
      Viernes: "2026-07-10",
      Sábado: "2026-07-11",
      Domingo: "2026-07-12",
    },
  );
}

function testTrainingDayConversionAndFallbacks() {
  assert.equal(getTrainingDayFromDate("2026-07-08"), "Miércoles");
  assert.equal(getTrainingDayFromDate("2026-07-11"), "Sábado");
  assert.equal(getTrainingDayFromDate(""), "");

  assert.equal(getTrainingDayCode("Lunes"), "monday");
  assert.equal(getTrainingDayCode("Martes"), "tuesday");
  assert.equal(getTrainingDayCode("Miércoles"), "wednesday");
  assert.equal(getTrainingDayCode("Jueves"), "thursday");
  assert.equal(getTrainingDayCode("Viernes"), "friday");
  assert.equal(getTrainingDayCode("Sábado"), "saturday");
  assert.equal(getTrainingDayCode("Domingo"), "sunday");
  assert.equal(getTrainingDayCode(""), "monday");
  assert.equal(getTrainingDayCode("Desconocido"), "monday");
}

function testLocalDateFormatting() {
  assert.equal(getLocalDateKey(new Date(2026, 6, 8, 12)), "2026-07-08");
}

testCurrentSantiagoWeekUsesAControlledReferenceDate();
testTrainingDayConversionAndFallbacks();
testLocalDateFormatting();

console.log("dashboard Santiago calendar tests passed");
