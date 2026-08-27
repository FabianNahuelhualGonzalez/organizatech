import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthGrid,
  createCalendarDateKey,
  formatCalendarDateLong,
  getCalendarGridTabIndex,
  getCalendarKeyboardTarget,
  getDaysInMonth,
  getMonthlyWeekPosition,
  getWeekdayForDate,
  parseCalendarDateKey,
} from "./calendar-date";

test("julio de 2026 empieza en miércoles y produce cinco semanas lunes-domingo", () => {
  const grid = buildMonthGrid(2026, 7);
  assert.equal(grid.monthName, "julio");
  assert.equal(grid.firstColumn, 2);
  assert.equal(grid.daysInMonth, 31);
  assert.equal(grid.weeks.length, 5);
  assert.ok(grid.weeks.every((week) => week.cells.length === 7));
  assert.deepEqual(grid.weeks[0]?.cells.slice(0, 4), [
    { day: null, date: null },
    { day: null, date: null },
    { day: 1, date: "2026-07-01" },
    { day: 2, date: "2026-07-02" },
  ]);
  assert.deepEqual(grid.weeks.at(-1)?.cells.at(-1), { day: null, date: null });
});

test("un mes que desborda cinco filas conserva seis semanas completas", () => {
  const grid = buildMonthGrid(2026, 8);
  assert.equal(grid.firstColumn, 5);
  assert.equal(grid.weeks.length, 6);
  assert.equal(grid.weeks.at(-1)?.cells[0]?.day, 31);
});

test("días del mes y claves civiles validan años bisiestos sin zona horaria", () => {
  assert.equal(getDaysInMonth(2024, 2), 29);
  assert.equal(getDaysInMonth(2100, 2), 28);
  assert.equal(getDaysInMonth(2000, 2), 29);
  assert.equal(createCalendarDateKey(2026, 7, 9), "2026-07-09");
  assert.deepEqual(parseCalendarDateKey("2026-07-09"), { year: 2026, month: 7, day: 9 });
  assert.equal(parseCalendarDateKey("2026-02-29"), null);
  assert.equal(parseCalendarDateKey("2026-7-09"), null);
  assert.throws(() => createCalendarDateKey(2026, 13, 1), RangeError);
});

test("la semana usa lunes como primera columna y domingo como última", () => {
  assert.equal(getWeekdayForDate("2026-07-27"), "mon");
  assert.equal(getWeekdayForDate("2026-08-02"), "sun");
  assert.equal(formatCalendarDateLong("2026-07-29"), "Miércoles 29 de julio");
});

test("la repetición mensual por posición distingue ordinal y último día equivalente", () => {
  assert.equal(getMonthlyWeekPosition("2026-07-08"), 2);
  assert.equal(getMonthlyWeekPosition("2026-07-22"), 4);
  assert.equal(getMonthlyWeekPosition("2026-07-24"), 4);
  assert.equal(getMonthlyWeekPosition("2026-07-29"), "last");
});

test("la navegación de teclado queda acotada al mes", () => {
  assert.equal(getCalendarKeyboardTarget(15, "ArrowLeft", 31), 14);
  assert.equal(getCalendarKeyboardTarget(15, "ArrowRight", 31), 16);
  assert.equal(getCalendarKeyboardTarget(15, "ArrowUp", 31), 8);
  assert.equal(getCalendarKeyboardTarget(29, "ArrowDown", 31), 31);
  assert.equal(getCalendarKeyboardTarget(1, "ArrowLeft", 31), 1);
  assert.equal(getCalendarKeyboardTarget(16, "Home", 31, 2), 13);
  assert.equal(getCalendarKeyboardTarget(16, "End", 31, 2), 19);
  assert.equal(getCalendarKeyboardTarget(1, "Home", 31, 2), 1);
  assert.equal(getCalendarKeyboardTarget(31, "End", 31, 2), 31);
});

test("roving tabIndex deja exactamente un día en la secuencia de tabulación", () => {
  const tabIndexes = Array.from({ length: 31 }, (_, index) =>
    getCalendarGridTabIndex(index + 1, 16));
  assert.equal(tabIndexes.filter((tabIndex) => tabIndex === 0).length, 1);
  assert.equal(tabIndexes[15], 0);
  assert.ok(tabIndexes.every((tabIndex, index) => index === 15 || tabIndex === -1));
});
