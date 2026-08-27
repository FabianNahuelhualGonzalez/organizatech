import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreateCalendarReminderDto,
  buildReminderSummary,
  createInitialReminderFormState,
  deriveReminderFormView,
  reminderFormReducer,
  validateReminderForm,
} from "./reminder-form";

test("el estado inicial premarca el weekday correcto y refleja el resumen único", () => {
  const state = createInitialReminderFormState("2026-07-29");
  assert.deepEqual(state.values.weekdays, ["wed"]);
  assert.equal(state.values.occurrences, 4);
  assert.equal(
    buildReminderSummary(state),
    "Una sola vez, el 29 de julio a las 09:00 hrs",
  );
  assert.equal(deriveReminderFormView(state).showEndSection, false);
  assert.equal(deriveReminderFormView(state).canSubmit, false);
});

test("semanal exige al menos un día y ordena los días en lenguaje natural", () => {
  let state = createInitialReminderFormState("2026-07-29");
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "title",
    value: "Seguimiento",
  });
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "repeat",
    value: "weekly",
  });
  state = reminderFormReducer(state, { type: "weekday_toggled", weekday: "wed" });
  assert.equal(deriveReminderFormView(state).canSubmit, false);
  assert.equal(buildReminderSummary(state), "Elige al menos un día");
  assert.equal(validateReminderForm(state).weekdays, "Elige al menos un día");

  state = reminderFormReducer(state, { type: "weekday_toggled", weekday: "thu" });
  state = reminderFormReducer(state, { type: "weekday_toggled", weekday: "tue" });
  assert.deepEqual(state.values.weekdays, ["tue", "thu"]);
  assert.equal(buildReminderSummary(state), "Cada Mar, Jue a las 09:00 hrs");
  assert.equal(deriveReminderFormView(state).canSubmit, true);
});

test("el reducer limita ocurrencias entre 2 y 52 sin mutar el estado previo", () => {
  const initial = createInitialReminderFormState("2026-07-29");
  const minimum = reminderFormReducer(initial, { type: "occurrences_changed", value: -20 });
  const maximum = reminderFormReducer(minimum, { type: "occurrences_changed", value: 80 });
  assert.equal(initial.values.occurrences, 4);
  assert.equal(minimum.values.occurrences, 2);
  assert.equal(maximum.values.occurrences, 52);
});

test("el error de título aparece al enviar y se limpia con el primer contenido", () => {
  const initial = createInitialReminderFormState("2026-07-29");
  const submitted = reminderFormReducer(initial, { type: "submit_attempted" });
  assert.equal(submitted.errors.title, "Escribe un título para el recordatorio");
  const edited = reminderFormReducer(submitted, {
    type: "field_changed",
    field: "title",
    value: "R",
  });
  assert.equal(edited.errors.title, undefined);
  assert.equal(initial.errors.title, undefined);
});

test("el submit runtime rechaza una hora eliminada y no construye DTO", () => {
  let state = createInitialReminderFormState("2026-07-29");
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "title",
    value: "Control",
  });
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "time",
    value: "",
  });

  assert.equal(validateReminderForm(state).time, "Elige una hora válida");
  const result = buildCreateCalendarReminderDto(state);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errors.time, "Elige una hora válida");
});

test("fecha de término vacía o anterior se rechaza y una fecha válida se resume", () => {
  let state = createInitialReminderFormState("2026-07-29");
  state = reminderFormReducer(state, { type: "field_changed", field: "title", value: "Cierre" });
  state = reminderFormReducer(state, { type: "field_changed", field: "repeat", value: "daily" });
  state = reminderFormReducer(state, { type: "field_changed", field: "endMode", value: "on_date" });
  assert.equal(validateReminderForm(state).endDate, "Elige una fecha de término");
  state = reminderFormReducer(state, { type: "field_changed", field: "endDate", value: "2026-07-28" });
  assert.equal(
    validateReminderForm(state).endDate,
    "La fecha de término no puede ser anterior al recordatorio",
  );
  state = reminderFormReducer(state, { type: "field_changed", field: "endDate", value: "2026-08-30" });
  assert.equal(validateReminderForm(state).endDate, undefined);
  assert.equal(
    buildReminderSummary(state),
    "Todos los días a las 09:00 hrs, hasta el 30 de agosto de 2026",
  );
});

test("el DTO mensual por posición usa allowlist explícita y nunca incluye ownership", () => {
  let state = createInitialReminderFormState("2026-07-29");
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "title",
    value: "  Revisión mensual  ",
  });
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "description",
    value: "  Revisar avances  ",
  });
  state = reminderFormReducer(state, { type: "field_changed", field: "repeat", value: "monthly" });
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "monthlyMode",
    value: "weekday_position",
  });
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "emailNotification",
    value: true,
  });
  state = reminderFormReducer(state, {
    type: "field_changed",
    field: "leadTime",
    value: "1_day",
  });

  const result = buildCreateCalendarReminderDto(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(Object.keys(result.dto).sort(), [
    "description",
    "emailNotification",
    "kind",
    "leadTime",
    "recurrence",
    "startsOn",
    "time",
    "title",
  ]);
  assert.equal(result.dto.title, "Revisión mensual");
  assert.equal(result.dto.description, "Revisar avances");
  assert.deepEqual(result.dto.recurrence, {
    frequency: "monthly",
    mode: { type: "weekday_position", weekday: "wed", position: "last" },
    end: { mode: "never" },
  });
  assert.doesNotMatch(
    JSON.stringify(result.dto),
    /user_id|owner_id|profile_id|userid|ownerid|profileid/i,
  );
  assert.match(buildReminderSummary(state), /Aviso 1 día antes · Preferencia de correo pendiente$/);
});

test("el DTO semanal preserva sólo weekdays ordenados y finalización por ocurrencias", () => {
  let state = createInitialReminderFormState("2026-07-29");
  state = reminderFormReducer(state, { type: "field_changed", field: "title", value: "Control" });
  state = reminderFormReducer(state, { type: "field_changed", field: "repeat", value: "weekly" });
  state = reminderFormReducer(state, { type: "weekday_toggled", weekday: "mon" });
  state = reminderFormReducer(state, { type: "field_changed", field: "endMode", value: "after_occurrences" });
  state = reminderFormReducer(state, { type: "occurrences_changed", value: 6 });
  const result = buildCreateCalendarReminderDto(state);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.dto.recurrence, {
    frequency: "weekly",
    weekdays: ["mon", "wed"],
    end: { mode: "after_occurrences", occurrences: 6 },
  });
  assert.equal(buildReminderSummary(state), "Cada Lun, Mié a las 09:00 hrs, 6 veces");
});
