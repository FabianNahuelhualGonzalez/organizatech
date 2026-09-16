import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Test adapter only. Production must receive a strict shared civil-date parser,
// not import another feature or copy its implementation into the renewal model.
import { parseCalendarDateKey } from "@/features/calendar-reminders/model/calendar-date";
import {
  acceptCoachRenewalDraftDates,
  cancelCoachRenewalDraft,
  cancelCoachRenewalDraftDates,
  editCoachRenewalDraftDates,
  openCoachRenewalDraft,
  openCoachRenewalDraftDates,
  openCoachRenewalPeriodDraft,
  prepareCoachRenewalDraftSave,
  prepareCoachRenewalPeriodCommand,
  resolveCoachRenewalDraft,
  selectCoachRenewalDraftState,
  validateCoachRenewalDates,
  type CoachRenewalBaseline,
  type CoachRenewalCivilDateValidation,
  type CoachRenewalDates,
  type CoachRenewalDraft,
  type CoachRenewalPeriodTarget,
} from "./coach-renewal-draft";

const validation: CoachRenewalCivilDateValidation = {
  isValidDateKey: (value) => parseCalendarDateKey(value) !== null,
};
const dates: CoachRenewalDates = Object.freeze({ start: "2026-09-09", end: "2026-10-20" });

function baseline(overrides: Partial<CoachRenewalBaseline> = {}): CoachRenewalBaseline {
  return Object.freeze({
    id: "synthetic-renewal", version: "0042:opaque", state: "pending", source: "opaque-unrecorded",
    currentPaidPeriodEndsOn: "2026-09-08", dates: null, ...overrides,
  });
}

function accept(draft: CoachRenewalDraft): CoachRenewalDraft {
  const result = acceptCoachRenewalDraftDates(draft, validation);
  assert.equal(result.kind, "accepted");
  return result.draft;
}

test("abrir crea baseline independiente y ninguna marca, escritura o fecha propuesta automática", () => {
  const original = baseline();
  const draft = openCoachRenewalDraft(original);
  assert.notEqual(draft.baseline, original);
  assert.deepEqual(draft.baseline, original);
  assert.equal(draft.detailOpen, true);
  assert.equal(draft.override, null);
  assert.equal(draft.datesUndo, null);
  assert.deepEqual(prepareCoachRenewalDraftSave(draft, validation), { kind: "unchanged" });
});

test("baseline alumno renovado sin override conserva su procedencia, no la atribuye al coach", () => {
  const draft = openCoachRenewalDraft(baseline({ state: "renewed", source: "opaque-student-record", dates }));
  assert.deepEqual(resolveCoachRenewalDraft(draft), {
    state: "renewed", dates, source: { kind: "baseline", value: "opaque-student-record" },
  });
  assert.deepEqual(prepareCoachRenewalDraftSave(draft, validation), { kind: "unchanged" });
});

test("marcar Renovado abre fechas y usa sólo propuestas recibidas cuando faltan fechas", () => {
  const initial = openCoachRenewalDraft(baseline());
  const editing = openCoachRenewalDraftDates(initial, dates);
  assert.deepEqual(editing.override, { state: "renewed", dates });
  assert.deepEqual(editing.datesUndo, { override: null });
  assert.deepEqual(prepareCoachRenewalDraftSave(editing, validation), { kind: "blocked", reason: "dates-modal-open" });
  assert.equal(initial.override, null);
});

test("modal usa fechas existentes del alumno en vez de reemplazarlas con propuestas nuevas", () => {
  const draft = openCoachRenewalDraft(baseline({ state: "renewed", source: "student", dates }));
  const editing = openCoachRenewalDraftDates(draft, { start: "2027-01-01", end: "2027-01-20" });
  assert.deepEqual(editing.override?.dates, dates);
  const cancelled = cancelCoachRenewalDraftDates(editing);
  assert.equal(cancelled.override, null);
  assert.deepEqual(resolveCoachRenewalDraft(cancelled), resolveCoachRenewalDraft(draft));
  assert.deepEqual(prepareCoachRenewalDraftSave(cancelled, validation), { kind: "unchanged" });
});

test("cancelar modal restaura null crudo y elimina propuestas, no crea manual pending", () => {
  const initial = openCoachRenewalDraft(baseline());
  const edited = editCoachRenewalDraftDates(openCoachRenewalDraftDates(initial, dates), {
    start: "2026-09-15", end: "2026-11-15",
  });
  const cancelled = cancelCoachRenewalDraftDates(edited);
  assert.equal(cancelled.override, null);
  assert.equal(cancelled.datesUndo, null);
  assert.deepEqual(resolveCoachRenewalDraft(cancelled), {
    state: "pending", dates: null, source: { kind: "baseline", value: "opaque-unrecorded" },
  });
  assert.deepEqual(prepareCoachRenewalDraftSave(cancelled, validation), { kind: "unchanged" });
});

test("pending manual y null son distintos, y cancelar modal conserva esa marca manual previa", () => {
  const manual = selectCoachRenewalDraftState(openCoachRenewalDraft(baseline()), "pending");
  assert.deepEqual(resolveCoachRenewalDraft(manual), {
    state: "pending", dates: null, source: { kind: "coachDraft", state: "pending", dates: null },
  });
  const cancelled = cancelCoachRenewalDraftDates(openCoachRenewalDraftDates(manual, dates));
  assert.equal(cancelled.override, manual.override);
  assert.deepEqual(prepareCoachRenewalDraftSave(cancelled, validation), {
    kind: "ready", intent: { renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", state: "pending", dates: null },
  });
});

test("cancelación anidada restaura estado y fechas previas sin borrar edición aceptada del detalle", () => {
  const first = accept(openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), dates));
  const editedAgain = editCoachRenewalDraftDates(openCoachRenewalDraftDates(first, dates), {
    start: "2026-09-10", end: "2026-12-25",
  });
  const cancelled = cancelCoachRenewalDraftDates(editedAgain);
  assert.equal(cancelled.override, first.override);
  assert.deepEqual(resolveCoachRenewalDraft(cancelled), resolveCoachRenewalDraft(first));
  assert.equal(cancelled.detailOpen, true);
  const closed = cancelCoachRenewalDraft(cancelled);
  assert.equal(closed.override, null);
  assert.equal(closed.detailOpen, false);
  assert.deepEqual(resolveCoachRenewalDraft(closed), resolveCoachRenewalDraft(openCoachRenewalDraft(baseline())));
});

test("elegir pending/declined conserva buffer de fechas pero no lo presenta ni envía como nuevo ciclo", () => {
  const renewed = accept(openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), dates));
  const declined = selectCoachRenewalDraftState(renewed, "declined");
  assert.deepEqual(declined.override?.dates, dates);
  assert.deepEqual(resolveCoachRenewalDraft(declined), {
    state: "declined", dates: null, source: { kind: "coachDraft", state: "declined", dates: null },
  });
  const save = prepareCoachRenewalDraftSave(declined, validation);
  assert.deepEqual(save, {
    kind: "ready", intent: { renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", state: "declined", dates: null },
  });
  const reopened = openCoachRenewalDraftDates(declined, { start: "2028-01-01", end: "2028-02-01" });
  assert.deepEqual(reopened.override?.dates, dates);
  assert.equal(cancelCoachRenewalDraftDates(reopened).override, declined.override);
});

test("abrir dos veces el mismo modal no pisa su snapshot de cancelación", () => {
  const editing = openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), dates);
  const repeated = openCoachRenewalDraftDates(editing, { start: "2027-01-01", end: "2027-02-01" });
  assert.equal(repeated, editing);
  assert.equal(selectCoachRenewalDraftState(editing, "declined"), editing);
  assert.equal(cancelCoachRenewalDraftDates(repeated).override, null);
});

test("aceptar fechas cierra sólo el modal: Listo es el único que prepara una intención", () => {
  const editing = openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), dates);
  const confirmation = acceptCoachRenewalDraftDates(editing, validation);
  assert.equal(confirmation.kind, "accepted");
  assert.deepEqual(Object.keys(confirmation).sort(), ["draft", "kind"]);
  const draft = confirmation.draft;
  assert.equal(draft.detailOpen, true);
  assert.equal(draft.datesUndo, null);
  const save = prepareCoachRenewalDraftSave(draft, validation);
  assert.deepEqual(save, {
    kind: "ready", intent: { renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", state: "renewed", dates },
  });
  assert.equal(draft.detailOpen, true);
});

test("cancelar detalle desde X/scrim/Escape descarta todo sin preparar guardado", () => {
  for (const draft of [
    selectCoachRenewalDraftState(openCoachRenewalDraft(baseline()), "declined"),
    openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), dates),
    accept(openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), dates)),
  ]) {
    const closed = cancelCoachRenewalDraft(draft);
    assert.equal(closed.detailOpen, false);
    assert.equal(closed.override, null);
    assert.equal(closed.datesUndo, null);
    assert.deepEqual(prepareCoachRenewalDraftSave(closed, validation), { kind: "blocked", reason: "detail-closed" });
    const reopened = openCoachRenewalDraft(closed.baseline);
    assert.deepEqual(prepareCoachRenewalDraftSave(reopened, validation), { kind: "unchanged" });
  }
});

test("detalle cerrado y modal cerrado no admiten ediciones tardías", () => {
  const initial = openCoachRenewalDraft(baseline());
  assert.equal(editCoachRenewalDraftDates(initial, dates), initial);
  assert.equal(cancelCoachRenewalDraftDates(initial), initial);
  assert.equal(acceptCoachRenewalDraftDates(initial, validation).kind, "blocked");
  const closed = cancelCoachRenewalDraft(initial);
  assert.equal(openCoachRenewalDraftDates(closed, dates), closed);
  assert.equal(selectCoachRenewalDraftState(closed, "pending"), closed);
  assert.equal(editCoachRenewalDraftDates(closed, dates), closed);
});

test("fechas inválidas bloquean aceptar y Listo; nunca se autocompletan", () => {
  for (const invalidDates of [
    { start: "", end: "2026-10-20" },
    { start: "2026-09-09", end: "" },
    { start: "2026-09-09", end: "2026-09-09" },
    { start: "2026-09-09", end: "2026-09-08" },
    { start: "2026-09-08", end: "2026-10-20" },
    { start: "2026-09-07", end: "2026-10-20" },
    { start: "2026-09-31", end: "2026-10-20" },
  ]) {
    const editing = openCoachRenewalDraftDates(openCoachRenewalDraft(baseline()), invalidDates);
    const accepted = acceptCoachRenewalDraftDates(editing, validation);
    assert.equal(accepted.kind, "blocked");
    assert.equal(accepted.draft, editing);
    const existing = openCoachRenewalDraft(baseline({ state: "renewed", dates: invalidDates }));
    assert.equal(prepareCoachRenewalDraftSave(existing, validation).kind, "blocked");
  }
  assert.deepEqual(prepareCoachRenewalDraftSave(openCoachRenewalDraft(baseline({ state: "renewed" })), validation), {
    kind: "blocked", reason: "missing-dates",
  });
});

test("existencia civil usa parser estricto: Feb30, años y bisiestos no se normalizan", () => {
  assert.deepEqual(validateCoachRenewalDates("2024-02-28", { start: "2024-02-29", end: "2024-03-01" }, validation), { valid: true });
  assert.deepEqual(validateCoachRenewalDates("2025-02-28", { start: "2025-02-29", end: "2025-03-01" }, validation), { valid: false, reason: "invalid-start" });
  assert.deepEqual(validateCoachRenewalDates("2024-02-28", { start: "2024-02-29", end: "2024-02-30" }, validation), { valid: false, reason: "invalid-end" });
  assert.deepEqual(validateCoachRenewalDates("0000-01-01", dates, validation), { valid: false, reason: "invalid-current-end" });
  assert.deepEqual(validateCoachRenewalDates("2026-13-01", dates, validation), { valid: false, reason: "invalid-current-end" });
});

test("rechaza formato no canónico antes de pedir al puerto existencia civil", () => {
  const checked: string[] = [];
  const port: CoachRenewalCivilDateValidation = { isValidDateKey: (value) => { checked.push(value); return true; } };
  for (const start of ["2026-9-9", "09/09/2026", " 2026-09-09", "2026-09-09T00:00:00Z"]) {
    assert.deepEqual(validateCoachRenewalDates("2026-09-08", { start, end: "2026-10-20" }, port), { valid: false, reason: "invalid-start" });
    assert.equal(checked.includes(start), false);
  }
});

test("comparación civil cruza correctamente DST, cambio de mes y año sin reloj ni UTC parsing", () => {
  for (const [currentEnd, start, end] of [
    ["2026-09-05", "2026-09-06", "2026-09-07"],
    ["2026-09-30", "2026-10-01", "2026-10-02"],
    ["2026-12-31", "2027-01-01", "2027-01-02"],
    ["0001-01-01", "0001-01-02", "0001-01-03"],
  ]) assert.deepEqual(validateCoachRenewalDates(currentEnd, { start, end }, validation), { valid: true });
});

test("fallo del puerto requerido bloquea fechas, no activa fallback permisivo", () => {
  const failing = { isValidDateKey: () => { throw new Error("synthetic parser error"); } };
  assert.deepEqual(validateCoachRenewalDates("2026-09-08", dates, failing), { valid: false, reason: "invalid-current-end" });
  assert.deepEqual(validateCoachRenewalDates("2026-09-08", dates, { isValidDateKey: () => false }), { valid: false, reason: "invalid-current-end" });
});

test("baseline, buffers, undo e intención permanecen inmutables e independientes", () => {
  const mutableDates = { start: "2026-09-09", end: "2026-10-20" };
  const mutableBaseline = { ...baseline({ state: "renewed", dates: mutableDates }) };
  const original = openCoachRenewalDraft(mutableBaseline);
  mutableDates.start = "2028-01-01";
  mutableBaseline.version = "replaced";
  assert.equal(original.baseline.version, "0042:opaque");
  assert.equal(original.baseline.dates?.start, "2026-09-09");
  const snapshot = JSON.stringify(original);
  const editing = openCoachRenewalDraftDates(original, dates);
  const confirmed = accept(editing);
  const prepared = prepareCoachRenewalDraftSave(confirmed, validation);
  assert.equal(prepared.kind, "ready");
  assert.equal(JSON.stringify(original), snapshot);
  for (const value of [original, original.baseline, original.baseline.dates, editing.override, editing.override?.dates, editing.datesUndo]) {
    assert.equal(Object.isFrozen(value), true);
  }
  if (prepared.kind === "ready") {
    assert.equal(Object.isFrozen(prepared.intent), true);
    assert.equal(Object.isFrozen(prepared.intent.dates), true);
    assert.deepEqual(Object.keys(prepared.intent).sort(), ["dates", "expectedVersion", "renewalId", "state"]);
    assert.equal(prepared.intent.expectedVersion, "0042:opaque");
    assert.notEqual(prepared.intent.dates, confirmed.override?.dates);
  }
});

test("modelo no crea operaciones de entrenamiento, persistencia ni importaciones runtime cross-feature", () => {
  const source = readFileSync(new URL("./coach-renewal-draft.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s/m);
  assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage)\b|Date\.UTC|Date\.parse|new Date\(|\.rpc\(|Math\.random|training_sessions|exercise_entries|setTimeout|setInterval/);
});

test("primer período pagado acepta sólo fechas manuales sin necesitar un ciclo ni un pago anterior", () => {
  const initial = openCoachRenewalDraft(baseline({ currentPaidPeriodEndsOn: null }));
  assert.deepEqual(prepareCoachRenewalDraftSave(initial, validation), { kind: "unchanged" });
  const manual = { start: "2026-09-01", end: "2026-09-30" };
  const confirmed = accept(openCoachRenewalDraftDates(initial, manual));
  assert.deepEqual(prepareCoachRenewalDraftSave(confirmed, validation), {
    kind: "ready",
    intent: { renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", state: "renewed", dates: manual },
  });
});

test("renovar pago ignora cualquier dato de entrenamiento y conserva el límite pagado explícito", () => {
  const commercial = baseline({ currentPaidPeriodEndsOn: "2026-09-08" });
  for (const currentCycleEndsOn of [null, "2026-08-01", "2026-12-31"]) {
    // Extra upstream fields are not copied into the commercial draft or its save intent.
    const draft = openCoachRenewalDraft({ ...commercial, currentCycleEndsOn } as CoachRenewalBaseline);
    assert.equal(Object.hasOwn(draft.baseline, "currentCycleEndsOn"), false);
    assert.deepEqual(prepareCoachRenewalDraftSave(draft, validation), { kind: "unchanged" });
    const confirmed = accept(openCoachRenewalDraftDates(draft, dates));
    assert.equal(prepareCoachRenewalDraftSave(confirmed, validation).kind, "ready");
  }
  assert.deepEqual(validateCoachRenewalDates("2026-09-08", { start: "2026-09-08", end: "2026-09-30" }, validation), {
    valid: false, reason: "start-not-after-current-end",
  });
});

const recordedDates = Object.freeze({ start: "2026-08-09", end: "2026-09-08" });

function correctionDraft(): CoachRenewalDraft {
  const draft = openCoachRenewalPeriodDraft(
    baseline({ state: "renewed", dates: recordedDates }),
    { action: "correct", periodId: "opaque-existing-period" },
  );
  assert.notEqual(draft, null);
  return draft!;
}

test("el caller nuevo prepara confirm inequívoco desde el draft legacy sin cambiar su resultado anterior", () => {
  const initial = openCoachRenewalDraft(baseline());
  assert.equal(Object.hasOwn(initial, "periodContext"), false);
  assert.deepEqual(prepareCoachRenewalPeriodCommand(initial, validation), { kind: "unchanged" });
  const confirmed = accept(openCoachRenewalDraftDates(initial, dates));
  assert.deepEqual(prepareCoachRenewalDraftSave(confirmed, validation), {
    kind: "ready", intent: { renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", state: "renewed", dates },
  });
  assert.deepEqual(prepareCoachRenewalPeriodCommand(confirmed, validation), {
    kind: "ready", command: { renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", action: "confirm", dates },
  });
});

test("confirm explícito conserva start posterior al último término y no incluye periodId", () => {
  const explicit = openCoachRenewalPeriodDraft(baseline(), { action: "confirm" });
  assert.ok(explicit);
  assert.deepEqual(explicit.periodContext, { action: "confirm", renewalId: "synthetic-renewal", expectedVersion: "0042:opaque" });
  for (const start of ["2026-09-07", "2026-09-08"]) {
    const editing = openCoachRenewalDraftDates(explicit, { start, end: "2026-10-20" });
    assert.deepEqual(acceptCoachRenewalDraftDates(editing, validation), {
      kind: "blocked", reason: "start-not-after-current-end", draft: editing,
    });
  }
  const confirmed = accept(openCoachRenewalDraftDates(explicit, dates));
  const preparation = prepareCoachRenewalPeriodCommand(confirmed, validation);
  assert.equal(preparation.kind, "ready");
  if (preparation.kind === "ready") assert.deepEqual(Object.keys(preparation.command).sort(), ["action", "dates", "expectedVersion", "renewalId"]);
  assert.equal(prepareCoachRenewalDraftSave(confirmed, validation).kind, "ready");
  const first = openCoachRenewalPeriodDraft(baseline({ currentPaidPeriodEndsOn: null }), { action: "confirm" });
  assert.ok(first);
  assert.equal(prepareCoachRenewalPeriodCommand(accept(openCoachRenewalDraftDates(first, recordedDates)), validation).kind, "ready");
});

test("corregir mantiene el mismo periodId explícito sin inferirlo del renewalId ni borrar el fin registrado", () => {
  const original = correctionDraft();
  const changedDates = { start: "2026-08-08", end: "2026-09-10" };
  const accepted = accept(editCoachRenewalDraftDates(openCoachRenewalDraftDates(original, dates), changedDates));
  assert.equal(accepted.baseline, original.baseline);
  assert.equal(accepted.baseline.currentPaidPeriodEndsOn, "2026-09-08");
  assert.deepEqual(accepted.baseline.dates, recordedDates);
  assert.deepEqual(prepareCoachRenewalPeriodCommand(accepted, validation), {
    kind: "ready",
    command: { action: "correct", periodId: "opaque-existing-period", renewalId: "synthetic-renewal", expectedVersion: "0042:opaque", dates: changedDates },
  });
  const secondDates = { start: "2026-08-10", end: "2026-09-07" };
  const second = accept(editCoachRenewalDraftDates(openCoachRenewalDraftDates(accepted, dates), secondDates));
  const preparation = prepareCoachRenewalPeriodCommand(second, validation);
  assert.equal(preparation.kind, "ready");
  if (preparation.kind === "ready") {
    assert.equal(preparation.command.action, "correct");
    assert.equal(preparation.command.periodId, "opaque-existing-period");
    assert.deepEqual(preparation.command.dates, secondDates);
  }
});

test("corrección untouched no genera comando; el preparador legacy no puede perder la acción correct", () => {
  const original = correctionDraft();
  assert.deepEqual(prepareCoachRenewalPeriodCommand(original, validation), { kind: "unchanged" });
  assert.deepEqual(prepareCoachRenewalDraftSave(original, validation), { kind: "blocked", reason: "period-command-required" });
  const accepted = accept(openCoachRenewalDraftDates(original, dates));
  assert.deepEqual(prepareCoachRenewalDraftSave(accepted, validation), { kind: "blocked", reason: "period-command-required" });
  assert.equal(prepareCoachRenewalPeriodCommand(accepted, validation).kind, "ready");
  assert.equal(accepted.detailOpen, true);
});

test("corrección valida fechas civiles y orden sin inventar vecinos ni sustituir currentPaidPeriodEndsOn", () => {
  for (const invalidDates of [
    { start: "", end: "2026-09-08" },
    { start: "2026-08-09", end: "" },
    { start: "2026-08-09", end: "2026-08-09" },
    { start: "2026-08-09", end: "2026-08-08" },
    { start: "2025-02-29", end: "2025-03-01" },
    { start: "2024-02-29", end: "2024-02-30" },
    { start: "0000-01-01", end: "0001-01-01" },
    { start: "2026-8-9", end: "2026-09-08" },
    { start: "2026-08-09\n", end: "2026-09-08" },
    { start: "2026-08-09\r\n", end: "2026-09-08" },
    { start: "2026-08-09\u2028", end: "2026-09-08" },
    { start: "2026-08-09T00:00:00Z", end: "2026-09-08" },
  ]) {
    const editing = editCoachRenewalDraftDates(openCoachRenewalDraftDates(correctionDraft(), dates), invalidDates);
    const result = acceptCoachRenewalDraftDates(editing, validation);
    assert.equal(result.kind, "blocked");
    assert.equal(result.draft, editing);
    assert.equal(prepareCoachRenewalPeriodCommand({ ...editing, datesUndo: null }, validation).kind, "blocked");
  }
  for (const validDates of [
    { start: "2024-02-29", end: "2024-03-01" },
    { start: "0001-01-01", end: "0001-01-02" },
    { start: "2026-09-05", end: "2026-09-06" },
    { start: "2026-12-31", end: "2027-01-01" },
  ]) {
    const editing = editCoachRenewalDraftDates(openCoachRenewalDraftDates(correctionDraft(), dates), validDates);
    assert.equal(prepareCoachRenewalPeriodCommand(accept(editing), validation).kind, "ready");
  }
  const explicit = openCoachRenewalPeriodDraft(baseline({ currentPaidPeriodEndsOn: "malformed" }), { action: "confirm" });
  assert.ok(explicit);
  assert.deepEqual(acceptCoachRenewalDraftDates(openCoachRenewalDraftDates(explicit, dates), validation), {
    kind: "blocked", reason: "invalid-current-end", draft: openCoachRenewalDraftDates(explicit, dates),
  });
  const correction = openCoachRenewalPeriodDraft(baseline({ currentPaidPeriodEndsOn: "malformed" }), { action: "correct", periodId: "known-period" });
  assert.ok(correction);
  assert.equal(accept(openCoachRenewalDraftDates(correction, recordedDates)).baseline.currentPaidPeriodEndsOn, "malformed");
});

test("parser civil que falla también bloquea correct y conserva la edición", () => {
  const editing = openCoachRenewalDraftDates(correctionDraft(), dates);
  for (const port of [{ isValidDateKey: () => false }, { isValidDateKey: () => { throw new Error("synthetic"); } }]) {
    assert.deepEqual(acceptCoachRenewalDraftDates(editing, port), { kind: "blocked", reason: "invalid-start", draft: editing });
    assert.deepEqual(prepareCoachRenewalPeriodCommand({ ...editing, datesUndo: null }, port), { kind: "blocked", reason: "invalid-start" });
  }
});

test("apertura explícita rechaza modo o periodId malformados sin degradarlos a confirm", () => {
  for (const target of [
    undefined, null, [], "correct", {}, { action: "renewed" }, { action: "CORRECT", periodId: "period" },
    { action: "correct" }, { action: "correct", periodId: null }, { action: "correct", periodId: 4 },
    { action: "correct", periodId: "" }, { action: "correct", periodId: " \n" },
    { action: "confirm", periodId: "unexpected" }, { action: "confirm", periodId: undefined },
  ]) assert.equal(openCoachRenewalPeriodDraft(baseline(), target as CoachRenewalPeriodTarget), null);
});

test("binding opaco inválido se rechaza sin inventar identidad o versión", () => {
  for (const invalid of [undefined, null, 0, "", " \n"]) {
    for (const field of ["id", "version"] as const) {
      const invalidBaseline = { ...baseline(), [field]: invalid } as CoachRenewalBaseline;
      assert.equal(openCoachRenewalPeriodDraft(invalidBaseline, { action: "confirm" }), null);
      assert.equal(openCoachRenewalPeriodDraft(invalidBaseline, { action: "correct", periodId: "period" }), null);
      const legacy = accept(openCoachRenewalDraftDates(openCoachRenewalDraft(invalidBaseline), dates));
      assert.deepEqual(prepareCoachRenewalPeriodCommand(legacy, validation), { kind: "blocked", reason: "invalid-period-binding" });
    }
  }
});

test("contexto explícito malformado en runtime bloquea aceptar y preparar sin reemplazar draft", () => {
  const editing = openCoachRenewalDraftDates(correctionDraft(), dates);
  for (const context of [undefined, null, {}, [], { action: "other" }, { action: "correct", periodId: "" }, { action: "confirm", periodId: "period" }]) {
    const malformed = { ...editing, periodContext: context } as CoachRenewalDraft;
    assert.deepEqual(acceptCoachRenewalDraftDates(malformed, validation), { kind: "blocked", reason: "invalid-period-context", draft: malformed });
    const readyLayer = { ...malformed, datesUndo: null };
    assert.deepEqual(prepareCoachRenewalPeriodCommand(readyLayer, validation), { kind: "blocked", reason: "invalid-period-context" });
    assert.deepEqual(prepareCoachRenewalDraftSave(readyLayer, validation), { kind: "blocked", reason: "invalid-period-context" });
  }
});

test("contexto se fija a renewalId y versión del snapshot; no puede rebasarse silenciosamente", () => {
  const editing = openCoachRenewalDraftDates(correctionDraft(), dates);
  for (const malformed of [
    { ...editing, baseline: { ...editing.baseline, id: "another-renewal" } },
    { ...editing, baseline: { ...editing.baseline, version: "another-version" } },
    { ...editing, periodContext: { ...editing.periodContext!, renewalId: "another-renewal" } },
    { ...editing, periodContext: { ...editing.periodContext!, expectedVersion: "another-version" } },
    { ...editing, periodContext: { action: "correct", periodId: "period" } },
  ]) {
    const draft = malformed as CoachRenewalDraft;
    assert.deepEqual(acceptCoachRenewalDraftDates(draft, validation), { kind: "blocked", reason: "invalid-period-binding", draft });
    assert.deepEqual(prepareCoachRenewalPeriodCommand({ ...draft, datesUndo: null }, validation), { kind: "blocked", reason: "invalid-period-binding" });
  }
});

test("pending y declined no son comandos de pago o revocación; volver a renewed conserva el target", () => {
  for (const original of [openCoachRenewalDraft(baseline()), correctionDraft()]) {
    const accepted = accept(openCoachRenewalDraftDates(original, dates));
    for (const state of ["pending", "declined"] as const) {
      const selected = selectCoachRenewalDraftState(accepted, state);
      assert.equal(selected.periodContext, original.periodContext);
      assert.equal(resolveCoachRenewalDraft(selected).dates, null);
      assert.deepEqual(prepareCoachRenewalPeriodCommand(selected, validation), { kind: "blocked", reason: "unsupported-commercial-state" });
      const editing = openCoachRenewalDraftDates(selected, dates);
      const cancelled = cancelCoachRenewalDraftDates(editing);
      assert.equal(cancelled.override, selected.override);
      assert.equal(cancelled.periodContext, selected.periodContext);
      assert.deepEqual(prepareCoachRenewalPeriodCommand(cancelled, validation), { kind: "blocked", reason: "unsupported-commercial-state" });
      const preparation = prepareCoachRenewalPeriodCommand(accept(openCoachRenewalDraftDates(cancelled, dates)), validation);
      assert.equal(preparation.kind, "ready");
      if (preparation.kind === "ready") assert.equal(preparation.command.action, original.periodContext?.action ?? "confirm");
    }
  }
});

test("undo de corrección restaura exactamente el buffer anterior y nunca cambia de período", () => {
  const initial = correctionDraft();
  const editing = openCoachRenewalDraftDates(initial, dates);
  assert.deepEqual(prepareCoachRenewalPeriodCommand(editing, validation), { kind: "blocked", reason: "dates-modal-open" });
  assert.equal(openCoachRenewalDraftDates(editing, dates), editing);
  const changed = editCoachRenewalDraftDates(editing, { start: "2026-08-05", end: "2026-09-12" });
  const cancelled = cancelCoachRenewalDraftDates(changed);
  assert.equal(cancelled.override, null);
  assert.equal(cancelled.periodContext, initial.periodContext);
  assert.deepEqual(prepareCoachRenewalPeriodCommand(cancelled, validation), { kind: "unchanged" });
  const firstAccepted = accept(changed);
  const next = editCoachRenewalDraftDates(openCoachRenewalDraftDates(firstAccepted, dates), { start: "2026-07-01", end: "2026-07-31" });
  const undo = cancelCoachRenewalDraftDates(next);
  assert.equal(undo.override, firstAccepted.override);
  assert.equal(undo.periodContext, firstAccepted.periodContext);
  assert.deepEqual(prepareCoachRenewalPeriodCommand(undo, validation), prepareCoachRenewalPeriodCommand(firstAccepted, validation));
});

test("cancelar detalle conserva binding técnico pero descarta edición; ningún callback tardío lo reabre", () => {
  const original = correctionDraft();
  for (const draft of [original, openCoachRenewalDraftDates(original, dates), accept(openCoachRenewalDraftDates(original, dates))]) {
    const closed = cancelCoachRenewalDraft(draft);
    assert.equal(closed.periodContext, original.periodContext);
    assert.equal(closed.baseline, original.baseline);
    assert.equal(closed.override, null);
    assert.equal(closed.datesUndo, null);
    assert.deepEqual(prepareCoachRenewalPeriodCommand(closed, validation), { kind: "blocked", reason: "detail-closed" });
    assert.deepEqual(prepareCoachRenewalDraftSave(closed, validation), { kind: "blocked", reason: "detail-closed" });
    assert.equal(openCoachRenewalDraftDates(closed, dates), closed);
    assert.equal(editCoachRenewalDraftDates(closed, dates), closed);
    assert.equal(selectCoachRenewalDraftState(closed, "pending"), closed);
    assert.equal(acceptCoachRenewalDraftDates(closed, validation).kind, "blocked");
  }
});

test("contexto, snapshot, undo y comando son copias allowlisted inmutables; no salen campos de ownership", () => {
  const target = { action: "correct" as const, periodId: "period-explicit", user_id: "not-allowed" };
  const mutableRecordedDates: { start: string; end: string } = { ...recordedDates };
  const input = { ...baseline({ state: "renewed" }), dates: mutableRecordedDates, owner_id: "not-allowed" };
  const original = openCoachRenewalPeriodDraft(input, target);
  assert.ok(original);
  const snapshot = JSON.stringify(original);
  target.periodId = "replacement";
  input.id = "replacement";
  input.version = "replacement";
  input.dates!.start = "2030-01-01";
  const editing = openCoachRenewalDraftDates(original, dates);
  const prepared = prepareCoachRenewalPeriodCommand(accept(editing), validation);
  assert.equal(prepared.kind, "ready");
  assert.equal(JSON.stringify(original), snapshot);
  for (const value of [original, original.baseline, original.baseline.dates, original.periodContext, editing.datesUndo, editing.override, editing.override?.dates]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.hasOwn(original.baseline, "owner_id"), false);
  assert.equal(Object.hasOwn(original.periodContext!, "user_id"), false);
  if (prepared.kind === "ready") {
    assert.equal(Object.isFrozen(prepared), true);
    assert.equal(Object.isFrozen(prepared.command), true);
    assert.equal(Object.isFrozen(prepared.command.dates), true);
    assert.notEqual(prepared.command.dates, editing.override?.dates);
    assert.deepEqual(Object.keys(prepared.command).sort(), ["action", "dates", "expectedVersion", "periodId", "renewalId"]);
    assert.equal(prepared.command.periodId, "period-explicit");
    assert.equal(prepared.command.renewalId, "synthetic-renewal");
    assert.equal(prepared.command.expectedVersion, "0042:opaque");
  }
});
