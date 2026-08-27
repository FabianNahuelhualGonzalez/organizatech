import assert from "node:assert/strict";
import test from "node:test";

import { createCalendarRemindersAriaIds } from "./calendar-reminders-aria";

test("dos instancias producen IDs ARIA disjuntos para todas sus relaciones", () => {
  const first = createCalendarRemindersAriaIds(":r1:");
  const second = createCalendarRemindersAriaIds(":r2:");
  const firstIds = Object.values(first);
  const secondIds = Object.values(second);

  assert.equal(new Set(firstIds).size, firstIds.length);
  assert.equal(new Set(secondIds).size, secondIds.length);
  assert.deepEqual(firstIds.filter((id) => secondIds.includes(id)), []);
  assert.equal(first.featureTitle, "calendar-reminders-r1-title");
  assert.equal(second.agendaTitle, "calendar-reminders-r2-agenda-title");
});
