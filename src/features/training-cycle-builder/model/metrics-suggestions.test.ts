import assert from "node:assert/strict";
import test from "node:test";

import { createTrainingCycleDraft } from "./draft";
import { calculateProgrammedCycleMetrics } from "./metrics";
import { generateSuggestedRoutines } from "./suggestions";
import { createFixtureDay, createFixtureDraft, createFixtureExercise, createFixtureSet } from "./test-fixtures";
import { validateTrainingCycleDraft } from "./validation";

function metricsDraft() {
  const press = createFixtureExercise({
    technique: "drop_set",
    sets: [createFixtureSet({
      id: "press-set",
      targetKg: 80,
      targetReps: 10,
      drops: [{ id: "press-drop", sourceDropId: null, order: 1, kg: 60, reps: 8 }],
    })],
  });
  const dips = createFixtureExercise({
    id: "dips",
    name: "Fondos en paralelas",
    source: { kind: "catalog", catalogExerciseId: "parallel-dips" },
    primaryMuscleGroup: "triceps",
    loadBasis: "bodyweight",
    order: 2,
    sets: [createFixtureSet({ id: "dips-set", targetKg: 0, targetReps: 12 })],
  });
  return createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [press, dips] }) },
  });
}

test("métricas cuentan ejercicios, series principales, reps y drops sin sumar drops como series", () => {
  const metrics = calculateProgrammedCycleMetrics(metricsDraft());
  assert.equal(metrics.exerciseCount, 2);
  assert.equal(metrics.setCount, 2);
  assert.equal(metrics.repCount, 30);
  assert.equal(metrics.dropCount, 1);
  assert.deepEqual(metrics.volume, {
    knownKg: 1_280,
    mainSetsKg: 800,
    dropsKg: 480,
    externalLoadKg: 1_280,
    bodyweightKg: 0,
    status: "partial",
    unquantifiedBodyweightReps: 12,
    invalidValueCount: 0,
  });
});

test("peso corporal completa el volumen sólo cuando se entrega explícitamente", () => {
  const metrics = calculateProgrammedCycleMetrics(metricsDraft(), { bodyWeightKg: 70 });
  assert.deepEqual(metrics.volume, {
    knownKg: 2_120,
    mainSetsKg: 1_640,
    dropsKg: 480,
    externalLoadKg: 1_280,
    bodyweightKg: 840,
    status: "complete",
    unquantifiedBodyweightReps: 0,
    invalidValueCount: 0,
  });
});

test("carga adicional en peso corporal se conserva aun si el total sigue siendo parcial", () => {
  const weightedDips = createFixtureExercise({
    loadBasis: "bodyweight",
    source: { kind: "catalog", catalogExerciseId: "parallel-dips" },
    sets: [createFixtureSet({ targetKg: 10, targetReps: 5 })],
  });
  const draft = createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [weightedDips] }) },
  });
  const metrics = calculateProgrammedCycleMetrics(draft);
  assert.equal(metrics.volume.knownKg, 50);
  assert.equal(metrics.volume.status, "partial");
  assert.equal(metrics.volume.unquantifiedBodyweightReps, 5);
});

test("métricas nunca producen NaN y señalan borradores numéricamente inválidos", () => {
  const invalid = createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [createFixtureExercise({
      sets: [createFixtureSet({ targetKg: Number.NaN, targetReps: -1 })],
    })] }) },
  });
  const metrics = calculateProgrammedCycleMetrics(invalid);
  assert.equal(metrics.volume.status, "invalid");
  assert.equal(metrics.volume.invalidValueCount, 1);
  assert.equal(Number.isNaN(metrics.volume.knownKg), false);
  assert.equal(metrics.repCount, 0);
});

test("sugerencia es determinista y declara exactamente los tres inputs usados", () => {
  const input = {
    goal: "volume" as const,
    selectedDays: ["friday", "monday", "wednesday"] as const,
    durationDays: 42,
  };
  const first = generateSuggestedRoutines(input);
  const second = generateSuggestedRoutines(input);
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.rationale.inputsUsed, ["goal", "selectedDays", "durationDays"]);
  assert.deepEqual(Object.keys(first.routines), ["monday", "wednesday", "friday"]);
  assert.deepEqual(
    [first.routines.monday?.name, first.routines.wednesday?.name, first.routines.friday?.name],
    ["Empuje", "Jalón", "Piernas"],
  );
  assert.equal(first.rationale.editable, true);
  assert.match(first.rationale.disclaimer, /no una promesa/i);
});

test("objetivo y duración cambian presets, pero las cargas nunca se inventan", () => {
  const shortVolume = generateSuggestedRoutines({
    goal: "volume",
    selectedDays: ["monday"],
    durationDays: 14,
  });
  const standardStrength = generateSuggestedRoutines({
    goal: "strength",
    selectedDays: ["monday"],
    durationDays: 42,
  });
  assert.equal(shortVolume.ok, true);
  assert.equal(standardStrength.ok, true);
  if (!shortVolume.ok || !standardStrength.ok) return;
  const shortExercise = shortVolume.routines.monday?.exercises[0];
  const strengthExercise = standardStrength.routines.monday?.exercises[0];
  assert.equal(shortExercise?.sets.length, 3);
  assert.equal(shortExercise?.sets[0]?.targetReps, 10);
  assert.equal(strengthExercise?.sets.length, 4);
  assert.equal(strengthExercise?.sets[0]?.targetReps, 5);
  assert.ok(shortVolume.routines.monday?.exercises.every((exercise) => (
    exercise.sets.every((set) => set.targetKg === 0)
  )));
  assert.equal(shortVolume.rationale.loadPolicy, "unset_requires_user_input");
});

test("rutina sugerida genera un borrador estructuralmente válido y completamente editable", () => {
  const suggestion = generateSuggestedRoutines({
    goal: "deload",
    selectedDays: ["tuesday", "thursday"],
    durationDays: 21,
  });
  assert.equal(suggestion.ok, true);
  if (!suggestion.ok) return;
  const draft = createTrainingCycleDraft({
    draftId: "suggested-draft",
    origin: "suggested",
    goal: "deload",
    startDate: "2026-09-01",
    endDate: "2026-09-22",
    selectedDays: ["tuesday", "thursday"],
    routines: suggestion.routines,
  });
  const validation = validateTrainingCycleDraft(draft);
  assert.equal(validation.valid, true);
  assert.equal(draft.status, "draft");
  assert.ok(draft.routines.tuesday?.exercises.length);
});

test("sugerencia cubre de uno a siete días concretos sin agregar ni omitir días", () => {
  const allDays = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ] as const;
  for (let count = 1; count <= allDays.length; count += 1) {
    const days = allDays.slice(0, count);
    const result = generateSuggestedRoutines({ goal: "definition", selectedDays: days, durationDays: 35 });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(Object.keys(result.routines), days);
  }
});

test("sugerencia rechaza días vacíos, repetidos y duración fuera de límites", () => {
  assert.deepEqual(generateSuggestedRoutines({ goal: "unknown" as "volume", selectedDays: ["monday"], durationDays: 42 }), {
    ok: false,
    reason: "invalid_goal",
  });
  assert.deepEqual(generateSuggestedRoutines({ goal: "volume", selectedDays: [], durationDays: 42 }), {
    ok: false,
    reason: "days_empty",
  });
  assert.deepEqual(generateSuggestedRoutines({ goal: "volume", selectedDays: ["monday", "monday"], durationDays: 42 }), {
    ok: false,
    reason: "duplicate_day",
  });
  assert.deepEqual(generateSuggestedRoutines({ goal: "volume", selectedDays: ["monday"], durationDays: 0 }), {
    ok: false,
    reason: "invalid_duration",
  });
});
