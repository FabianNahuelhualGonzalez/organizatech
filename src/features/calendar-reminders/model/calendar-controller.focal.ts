import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarRemindersReducer,
  createCalendarRemindersState,
  createOptimisticCalendarReminder,
  selectVisibleCalendarReminders,
} from "./calendar-controller";
import type { CalendarReminder, CreateCalendarReminderDto } from "./types";

const existing: CalendarReminder = {
  id: "existing",
  startsOn: "2026-07-06",
  title: "Revisión",
  kind: "revision",
  time: "09:00",
  repeat: "once",
};

const dto: CreateCalendarReminderDto = {
  title: "Control",
  description: "",
  kind: "personal",
  startsOn: "2026-07-09",
  time: "10:30",
  leadTime: "10_minutes",
  emailNotification: false,
  recurrence: { frequency: "once" },
};

test("seleccionar día abre el sheet y cerrar conserva la selección", () => {
  const initial = createCalendarRemindersState([existing]);
  const opened = calendarRemindersReducer(initial, {
    type: "day_selected",
    date: "2026-07-09",
  });
  assert.equal(opened.sheetOpen, true);
  assert.equal(opened.selectedDate, "2026-07-09");
  const closed = calendarRemindersReducer(opened, { type: "sheet_closed" });
  assert.equal(closed.sheetOpen, false);
  assert.equal(closed.selectedDate, "2026-07-09");
  assert.equal(initial.sheetOpen, false);
});

test("guardado optimista agrega, confirma id y presenta éxito", () => {
  const opened = calendarRemindersReducer(createCalendarRemindersState([existing]), {
    type: "day_selected",
    date: dto.startsOn,
  });
  const token = "pending-1";
  const saving = calendarRemindersReducer(opened, {
    type: "save_started",
    token,
    optimisticReminder: createOptimisticCalendarReminder(token, dto),
  });
  assert.equal(saving.saving, true);
  assert.deepEqual(selectVisibleCalendarReminders(saving).map((item) => item.id), [
    "existing",
    token,
  ]);
  assert.equal(calendarRemindersReducer(saving, { type: "sheet_closed" }), saving);

  const saved = calendarRemindersReducer(saving, {
    type: "save_succeeded",
    token,
    result: { id: "persisted-1" },
  });
  assert.equal(saved.saving, false);
  assert.equal(saved.sheetOpen, false);
  assert.equal(saved.toast?.tone, "success");
  assert.deepEqual(selectVisibleCalendarReminders(saved).map((item) => item.id), [
    "existing",
    "persisted-1",
  ]);
});

test("fallo revierte únicamente el optimista y mantiene formulario abierto", () => {
  const opened = calendarRemindersReducer(createCalendarRemindersState([existing]), {
    type: "day_selected",
    date: dto.startsOn,
  });
  const saving = calendarRemindersReducer(opened, {
    type: "save_started",
    token: "pending-2",
    optimisticReminder: createOptimisticCalendarReminder("pending-2", dto),
  });
  const failed = calendarRemindersReducer(saving, {
    type: "save_failed",
    token: "pending-2",
    message: "No se pudo guardar. Intenta de nuevo",
  });
  assert.equal(failed.sheetOpen, true);
  assert.equal(failed.saving, false);
  assert.equal(failed.saveError, "No se pudo guardar. Intenta de nuevo");
  assert.equal(failed.toast, null);
  assert.deepEqual(selectVisibleCalendarReminders(failed), [existing]);
});

test("respuestas stale no pueden confirmar ni revertir otro guardado", () => {
  const saving = calendarRemindersReducer(createCalendarRemindersState([]), {
    type: "save_started",
    token: "active",
    optimisticReminder: createOptimisticCalendarReminder("active", dto),
  });
  assert.equal(
    calendarRemindersReducer(saving, {
      type: "save_succeeded",
      token: "stale",
      result: { id: "wrong" },
    }),
    saving,
  );
  assert.equal(
    calendarRemindersReducer(saving, {
      type: "save_failed",
      token: "stale",
      message: "wrong",
    }),
    saving,
  );
});

test("la llegada del registro externo reconcilia la copia local por id", () => {
  const saving = calendarRemindersReducer(createCalendarRemindersState([]), {
    type: "save_started",
    token: "pending",
    optimisticReminder: createOptimisticCalendarReminder("pending", dto),
  });
  const saved = calendarRemindersReducer(saving, {
    type: "save_succeeded",
    token: "pending",
    result: { id: "persisted" },
  });
  const external = { ...createOptimisticCalendarReminder("persisted", dto), id: "persisted" };
  const reconciled = calendarRemindersReducer(saved, {
    type: "external_reminders_received",
    reminders: [external],
  });
  assert.equal(reconciled.localReminders.length, 0);
  assert.deepEqual(selectVisibleCalendarReminders(reconciled), [external]);
});

test("los recordatorios entrantes se clonan para aislar mutaciones externas", () => {
  const mutable = { ...existing };
  const state = createCalendarRemindersState([mutable]);
  mutable.title = "Mutado afuera";
  assert.equal(state.externalReminders[0]?.title, "Revisión");
});
