import assert from "node:assert/strict";
import test from "node:test";

import {
  addCalendarDays,
  calculateCycleDuration,
  compareISOCalendarDates,
  differenceInCalendarDays,
  isISOCalendarDate,
  isISOInstant,
  parseISOCalendarDate,
} from "./dates";
import {
  createTrainingCycleDraft,
  projectDraftToPersistedPlan,
  sortWeekdays,
} from "./draft";
import { createFixtureDay, createFixtureDraft, createFixtureExercise, createFixtureSet } from "./test-fixtures";
import { validateTrainingCycleDraft } from "./validation";

test("fechas: valida calendario gregoriano sin depender de zona horaria", () => {
  assert.deepEqual(parseISOCalendarDate("2028-02-29"), { year: 2028, month: 2, day: 29 });
  assert.equal(parseISOCalendarDate("2027-02-29"), null);
  assert.equal(parseISOCalendarDate("2026-13-01"), null);
  assert.equal(parseISOCalendarDate("01-02-03"), null);
  assert.equal(isISOCalendarDate("2026-09-01"), true);
  assert.equal(isISOCalendarDate("2026-9-1"), false);
  assert.equal(compareISOCalendarDates("2026-09-01", "2026-09-01"), 0);
  assert.equal(compareISOCalendarDates("2026-08-31", "2026-09-01"), -1);
});

test("timestamps civiles exigen fecha posible, hora real y zona acotada", () => {
  assert.equal(isISOInstant("2028-02-29T23:59:59.123Z"), true);
  assert.equal(isISOInstant("2026-03-01T00:00:00-03:00"), true);
  assert.equal(isISOInstant("2026-01-01T12:00:00+14:00"), true);
  for (const invalid of [
    "2026-02-30T12:00:00Z",
    "2027-02-29T12:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z",
    "2026-01-01T12:00:00+14:01",
    "2026-01-01T12:00:00+15:00",
    "2026-01-01T12:00:00",
  ]) assert.equal(isISOInstant(invalid), false, `debe rechazar ${invalid}`);
});

test("duración distingue diferencia transcurrida y días inclusivos", () => {
  const duration = calculateCycleDuration("2026-09-01", "2026-10-13");
  assert.deepEqual(duration, {
    valid: true,
    elapsedDays: 42,
    inclusiveDayCount: 43,
    approximateWeeks: 6,
  });
  assert.equal(differenceInCalendarDays("2028-02-28", "2028-03-01"), 2);
  assert.equal(addCalendarDays("2028-02-28", 2), "2028-03-01");
  assert.equal(addCalendarDays("2026-01-01", -1), "2025-12-31");
});

test("duración rechaza fechas inválidas, término no posterior y límite de seguridad", () => {
  assert.deepEqual(calculateCycleDuration("x", "2026-02-01"), { valid: false, reason: "invalid_start_date" });
  assert.deepEqual(calculateCycleDuration("2026-02-01", "x"), { valid: false, reason: "invalid_end_date" });
  assert.deepEqual(calculateCycleDuration("2026-02-01", "2026-02-01"), { valid: false, reason: "end_not_after_start" });
  assert.deepEqual(calculateCycleDuration("2026-02-02", "2026-02-01"), { valid: false, reason: "end_not_after_start" });
  assert.deepEqual(calculateCycleDuration("2026-01-01", "2026-02-01", 30), { valid: false, reason: "span_exceeds_limit" });
});

test("borrador normaliza días en orden semanal, crea días vacíos y conserva retenidos", () => {
  const saturday = createFixtureDay({ day: "saturday", name: "Retenido", exercises: [] });
  const draft = createTrainingCycleDraft({
    draftId: " draft-1 ",
    origin: "manual",
    goal: "strength",
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    selectedDays: ["friday", "monday", "friday"],
    routines: { saturday },
  });
  assert.equal(draft.draftId, "draft-1");
  assert.deepEqual(draft.selectedDays, ["monday", "friday"]);
  assert.deepEqual(draft.routines.monday, { day: "monday", name: "", exercises: [] });
  assert.deepEqual(draft.routines.friday, { day: "friday", name: "", exercises: [] });
  assert.notEqual(draft.routines.saturday, saturday, "el día retenido se clona defensivamente");
  assert.deepEqual(sortWeekdays(["sunday", "tuesday", "monday"]), ["monday", "tuesday", "sunday"]);
});

test("validación separa bloqueos de avisos informativos", () => {
  const valid = validateTrainingCycleDraft(createFixtureDraft());
  assert.equal(valid.valid, true);
  assert.equal(valid.canActivate, true);
  assert.ok(valid.warnings.some((issue) => issue.code === "muscle_group_single_exercise"));

  const emptyDay = createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [] }) },
  });
  const emptyValidation = validateTrainingCycleDraft(emptyDay);
  assert.equal(emptyValidation.valid, true, "un día vacío avisa pero no bloquea");
  assert.ok(emptyValidation.warnings.some((issue) => issue.code === "empty_day"));

  const withoutDays = createFixtureDraft({ selectedDays: [] });
  const withoutDaysValidation = validateTrainingCycleDraft(withoutDays);
  assert.equal(withoutDaysValidation.canActivate, false);
  assert.ok(withoutDaysValidation.blockingIssues.some((issue) => issue.code === "training_days_empty"));
});

test("validación cubre fechas, órdenes, fuentes, series, drops, URL y duplicados", () => {
  const duplicateSetId = createFixtureSet({ id: "set-1", order: 3, targetReps: 0, targetKg: -1 });
  const exercise = createFixtureExercise({
    name: "Press plano con barra",
    technique: "linear",
    videoUrl: "http://example.com/video",
    sets: [
      createFixtureSet({ drops: [{ id: "drop-1", sourceDropId: null, order: 2, kg: -2, reps: 0 }] }),
      duplicateSetId,
    ],
  });
  const duplicateExercise = createFixtureExercise({
    id: "exercise-2",
    order: 3,
    sets: [createFixtureSet({ id: "set-2" })],
  });
  const invalidLoadBasis = { ...exercise, loadBasis: "unknown" as "external" };
  const draft = createFixtureDraft({
    endDate: "2026-09-01",
    routines: { monday: createFixtureDay({ exercises: [invalidLoadBasis, duplicateExercise] }) },
  });
  const validation = validateTrainingCycleDraft(draft);
  const codes = new Set(validation.issues.map((issue) => issue.code));
  for (const code of [
    "end_not_after_start",
    "invalid_video_url",
    "invalid_load_basis",
    "drops_require_drop_set",
    "invalid_drop_order",
    "invalid_drop_kg",
    "invalid_drop_reps",
    "duplicate_entity_id",
    "invalid_set_order",
    "invalid_target_reps",
    "invalid_target_kg",
    "invalid_exercise_order",
    "duplicate_exercise_in_day",
  ] as const) assert.ok(codes.has(code), `falta cubrir ${code}`);
  assert.equal(validation.valid, false);
});

test("proyección backend usa allowlist, orden derivado y una sola fuente por ejercicio", () => {
  const customExercise = createFixtureExercise({
    id: "custom-row",
    source: { kind: "custom", customExerciseId: "custom-uuid" },
    order: 99,
    sets: [createFixtureSet({ order: 50, drops: [{ id: "d", sourceDropId: null, order: 44, kg: 30.1254, reps: 8 }] })],
    technique: "drop_set",
  });
  const draft = createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [customExercise] }) },
  });
  const projected = projectDraftToPersistedPlan(draft);
  assert.deepEqual(projected, {
    days: [{
      day: "monday",
      name: "Empuje",
      order: 1,
      exercises: [{
        customExerciseId: "custom-uuid",
        order: 1,
        technique: "drop_set",
        videoUrl: null,
        sets: [{
          order: 1,
          targetReps: 10,
          targetKg: 80,
          toFailure: false,
          drops: [{ order: 1, kg: 30.125, reps: 8 }],
        }],
      }],
    }],
  });
  const serialized = JSON.stringify(projected);
  assert.equal(serialized.includes("user_id"), false);
  assert.equal(serialized.includes("owner_id"), false);
  assert.equal(serialized.includes("profile_id"), false);
  assert.equal(serialized.includes("catalogExerciseId"), false);
});
