import assert from "node:assert/strict";
import test from "node:test";

import { expandCalendarReminder, getSantiagoCalendarDate, type StoredCalendarReminder } from "./reminder-recurrence";

const base: StoredCalendarReminder = {
  id: "reminder-a",
  startsOn: "2026-01-31",
  title: "Cierre",
  description: "",
  kind: "revision",
  time: "09:00",
  leadTime: "at_time",
  emailNotification: false,
  recurrence: {
    frequency: "monthly",
    mode: { type: "day_of_month", day: 31 },
    end: { mode: "never" },
  },
};

test("mensual omite fechas civiles inexistentes", () => {
  const occurrences = expandCalendarReminder(base, { from: "2026-02-01", to: "2026-04-30" });
  assert.deepEqual(occurrences.map(({ startsOn }) => startsOn), ["2026-03-31"]);
});

test("fin por fecha es inclusivo y fin por cantidad cuenta desde el inicio", () => {
  const daily = { ...base, startsOn: "2026-08-01", recurrence: {
    frequency: "daily" as const,
    end: { mode: "on_date" as const, date: "2026-08-03" },
  } };
  assert.deepEqual(
    expandCalendarReminder(daily, { from: "2026-08-01", to: "2026-08-10" }).map(({ startsOn }) => startsOn),
    ["2026-08-01", "2026-08-02", "2026-08-03"],
  );

  const weekly = { ...base, startsOn: "2026-08-03", recurrence: {
    frequency: "weekly" as const,
    weekdays: ["mon" as const, "wed" as const],
    end: { mode: "after_occurrences" as const, occurrences: 3 },
  } };
  assert.deepEqual(
    expandCalendarReminder(weekly, { from: "2026-08-01", to: "2026-08-31" }).map(({ startsOn }) => startsOn),
    ["2026-08-03", "2026-08-05", "2026-08-10"],
  );
});

test("la fecha actual usa explícitamente America/Santiago", () => {
  assert.equal(getSantiagoCalendarDate(new Date("2026-08-27T02:30:00.000Z")), "2026-08-26");
  assert.equal(getSantiagoCalendarDate(new Date("2026-08-27T04:30:00.000Z")), "2026-08-27");
});
