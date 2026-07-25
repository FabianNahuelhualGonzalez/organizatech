import assert from "node:assert/strict";

import {
  getWeeklyProgressDayIndex,
  getWeeklyProgressDayLabel,
  parseDateKeyAsLocalNoon,
} from "@/lib/progress/week-day";

{
  const date = parseDateKeyAsLocalNoon("2026-06-17");

  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 5);
  assert.equal(date.getDate(), 17);
  assert.equal(date.getHours(), 12);
  assert.equal(date.getMinutes(), 0);
  assert.equal(date.getSeconds(), 0);
  assert.equal(date.getMilliseconds(), 0);
}

{
  const isoTimestamp = parseDateKeyAsLocalNoon("2026-06-17T14:30:00.000Z");
  const partialDate = parseDateKeyAsLocalNoon("2026-06");
  const invalidDate = parseDateKeyAsLocalNoon("fecha-invalida");

  assert.equal(Number.isNaN(isoTimestamp.getTime()), true, "un timestamp ISO no se transforma silenciosamente en el dia 1");
  assert.equal(Number.isNaN(partialDate.getTime()), true, "una fecha parcial conserva la semantica estricta de React");
  assert.equal(Number.isNaN(invalidDate.getTime()), true);
}

assert.equal(getWeeklyProgressDayLabel("2026-06-17"), "X");
assert.equal(getWeeklyProgressDayIndex("2026-07"), 2, "el consumidor historico conserva el fallback al dia 1");
assert.equal(getWeeklyProgressDayLabel("2026-07"), "X");
assert.equal(getWeeklyProgressDayIndex("fecha-invalida"), 0, "un valor no numerico conserva el fallback seguro a lunes");
assert.equal(
  parseDateKeyAsLocalNoon("2026-06-17").getTime(),
  parseDateKeyAsLocalNoon("2026-06-17").getTime(),
  "el parseo es determinista",
);

console.log("week-day tests passed");
