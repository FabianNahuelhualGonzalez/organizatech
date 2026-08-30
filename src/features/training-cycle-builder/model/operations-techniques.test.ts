import assert from "node:assert/strict";
import test from "node:test";

import {
  addDropToSet,
  addExerciseToDay,
  addSetToExercise,
  configureExerciseSetsQuickly,
  copyTrainingDay,
  duplicateExercise,
  duplicateSet,
  moveExercise,
  moveSet,
  removeDropFromSet,
  removeExerciseFromDay,
  removeSetFromExercise,
  renameTrainingDay,
  setSelectedTrainingDays,
  toggleSelectedTrainingDay,
  toggleSetFailure,
  updateSetTargets,
} from "./operations";
import { applyTechniqueToDraft, applyTechniqueToExercise } from "./techniques";
import { createFixtureDay, createFixtureDraft, createFixtureExercise, createFixtureSet } from "./test-fixtures";

function draftWithTwoDays() {
  const row = createFixtureExercise({
    id: "row",
    name: "Remo con barra",
    primaryMuscleGroup: "back",
    source: { kind: "catalog", catalogExerciseId: "barbell-row" },
    sets: [createFixtureSet({ id: "row-set" })],
  });
  return createFixtureDraft({
    selectedDays: ["monday", "tuesday"],
    routines: {
      monday: createFixtureDay(),
      tuesday: createFixtureDay({ day: "tuesday", name: "Jalón", exercises: [row] }),
    },
  });
}

test("selección de días ordena, crea nuevos y conserva rutinas al deseleccionar", () => {
  const initial = draftWithTwoDays();
  const removed = toggleSelectedTrainingDay(initial, "monday");
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.draft.selectedDays, ["tuesday"]);
  assert.equal(removed.draft.routines.monday?.name, "Empuje", "la rutina se retiene por si el día vuelve");
  assert.equal(initial.selectedDays.length, 2, "el estado anterior permanece intacto");

  const added = setSelectedTrainingDays(removed.draft, ["sunday", "wednesday", "tuesday"]);
  assert.deepEqual(added.draft.selectedDays, ["tuesday", "wednesday", "sunday"]);
  assert.deepEqual(added.draft.routines.wednesday, { day: "wednesday", name: "", exercises: [] });
  assert.equal(added.draft.revision, initial.revision + 2);
});

test("borrador activado rechaza cualquier operación de edición", () => {
  const activeDraft = createFixtureDraft({ status: "activated" });
  const result = renameTrainingDay(activeDraft, "monday", "Otro");
  assert.equal(result.changed, false);
  assert.equal(result.reason, "draft_not_editable");
  assert.equal(result.draft, activeDraft);
});

test("copiar día completo clona IDs y linaje sin compartir referencias", () => {
  const initial = draftWithTwoDays();
  const result = copyTrainingDay(initial, "monday", "tuesday", "replace_day", "copy-1");
  assert.equal(result.changed, true);
  const copied = result.draft.routines.tuesday;
  assert.equal(copied?.name, "Empuje");
  assert.equal(copied?.exercises[0]?.id, "copy-1:exercise:1");
  assert.equal(copied?.exercises[0]?.sourceExerciseId, "exercise-1");
  assert.equal(copied?.exercises[0]?.sets[0]?.sourceSetId, "set-1");
  assert.notEqual(copied?.exercises, initial.routines.monday?.exercises);
  assert.equal(initial.routines.tuesday?.name, "Jalón");

  const collision = copyTrainingDay(result.draft, "monday", "tuesday", "replace_day", "copy-1");
  assert.equal(collision.changed, false);
  assert.equal(collision.reason, "id_collision");
});

test("operaciones de ejercicio mantienen orden contiguo y rechazan IDs repetidos", () => {
  const initial = createFixtureDraft();
  const addedExercise = createFixtureExercise({
    id: "exercise-2",
    name: "Press inclinado",
    sets: [createFixtureSet({ id: "set-2" })],
  });
  const added = addExerciseToDay(initial, "monday", addedExercise);
  assert.equal(added.changed, true);
  assert.deepEqual(added.draft.routines.monday?.exercises.map((exercise) => exercise.order), [1, 2]);

  const moved = moveExercise(added.draft, "monday", "exercise-2", "up");
  assert.deepEqual(moved.draft.routines.monday?.exercises.map((exercise) => exercise.id), ["exercise-2", "exercise-1"]);
  assert.deepEqual(moved.draft.routines.monday?.exercises.map((exercise) => exercise.order), [1, 2]);

  const duplicated = duplicateExercise(moved.draft, "monday", "exercise-2", "dup-1");
  assert.equal(duplicated.draft.routines.monday?.exercises[1]?.id, "dup-1:exercise");
  assert.equal(duplicated.draft.routines.monday?.exercises[1]?.sourceExerciseId, "exercise-2");

  const removed = removeExerciseFromDay(duplicated.draft, "monday", "exercise-2");
  assert.deepEqual(removed.draft.routines.monday?.exercises.map((exercise) => exercise.order), [1, 2]);

  const collision = addExerciseToDay(removed.draft, "monday", createFixtureExercise({
    id: "another",
    sets: [createFixtureSet({ id: "set-1" })],
  }));
  assert.equal(collision.changed, false);
  assert.equal(collision.reason, "id_collision");
});

test("configuración rápida redimensiona y aplica valores con IDs externos explícitos", () => {
  const initial = createFixtureDraft();
  const configured = configureExerciseSetsQuickly(initial, "monday", "exercise-1", {
    setCount: 3,
    targetReps: 12,
    targetKg: 82.5555,
    newSetIdNamespace: "quick",
  });
  assert.equal(configured.changed, true);
  assert.deepEqual(configured.draft.routines.monday?.exercises[0]?.sets.map((set) => ({
    id: set.id,
    order: set.order,
    reps: set.targetReps,
    kg: set.targetKg,
  })), [
    { id: "set-1", order: 1, reps: 12, kg: 82.556 },
    { id: "quick:set:2", order: 2, reps: 12, kg: 82.556 },
    { id: "quick:set:3", order: 3, reps: 12, kg: 82.556 },
  ]);
  assert.equal(initial.routines.monday?.exercises[0]?.sets.length, 1);

  const invalid = configureExerciseSetsQuickly(configured.draft, "monday", "exercise-1", {
    setCount: 0,
    targetReps: 10,
    targetKg: 10,
  });
  assert.equal(invalid.reason, "invalid_value");
  assert.equal(invalid.draft, configured.draft);
});

test("operaciones de serie respetan mínimo uno, orden, duplicación y edición", () => {
  let draft = createFixtureDraft();
  const minimum = removeSetFromExercise(draft, "monday", "exercise-1", "set-1");
  assert.equal(minimum.changed, false);
  assert.equal(minimum.reason, "minimum_one_set");

  const added = addSetToExercise(draft, "monday", "exercise-1", "set-2");
  assert.equal(added.changed, true);
  draft = added.draft;
  const duplicated = duplicateSet(draft, "monday", "exercise-1", "set-1", "dup-set");
  assert.equal(duplicated.changed, true);
  draft = duplicated.draft;
  assert.deepEqual(draft.routines.monday?.exercises[0]?.sets.map((set) => set.order), [1, 2, 3]);

  const moved = moveSet(draft, "monday", "exercise-1", "set-2", "up");
  assert.equal(moved.changed, true);
  draft = moved.draft;
  assert.deepEqual(draft.routines.monday?.exercises[0]?.sets.map((set) => set.id), ["set-1", "set-2", "dup-set:set"]);

  const edited = updateSetTargets(draft, "monday", "exercise-1", "set-2", { targetReps: 8, targetKg: 90.25 });
  assert.equal(edited.draft.routines.monday?.exercises[0]?.sets[1]?.targetKg, 90.25);
  const failed = toggleSetFailure(edited.draft, "monday", "exercise-1", "set-2");
  assert.equal(failed.draft.routines.monday?.exercises[0]?.sets[1]?.toFailure, true);

  const removed = removeSetFromExercise(failed.draft, "monday", "exercise-1", "dup-set:set");
  assert.deepEqual(removed.draft.routines.monday?.exercises[0]?.sets.map((set) => set.order), [1, 2]);
});

test("drops sólo operan en drop set, tienen límite e IDs únicos", () => {
  const initial = createFixtureDraft();
  const rejected = addDropToSet(initial, "monday", "exercise-1", "set-1", { id: "drop-a", kg: 60, reps: 8 });
  assert.equal(rejected.reason, "invalid_value");

  const dropTechnique = applyTechniqueToDraft(initial, "monday", "exercise-1", "drop_set", {
    dropIdNamespace: "preset",
  });
  assert.equal(dropTechnique.changed, true);
  const setId = dropTechnique.draft.routines.monday?.exercises[0]?.sets[0]?.id ?? "";
  const added = addDropToSet(dropTechnique.draft, "monday", "exercise-1", setId, {
    id: "drop-b",
    kg: 50,
    reps: 10,
  });
  assert.equal(added.changed, true);
  assert.equal(added.draft.routines.monday?.exercises[0]?.sets[0]?.drops.length, 2);
  const removed = removeDropFromSet(added.draft, "monday", "exercise-1", setId, "preset:drop:1");
  assert.deepEqual(removed.draft.routines.monday?.exercises[0]?.sets[0]?.drops, [{
    id: "drop-b",
    sourceDropId: null,
    order: 1,
    kg: 50,
    reps: 10,
  }]);
});

test("cinco técnicas precargan de forma editable, limitada y sin mutar el ejercicio fuente", () => {
  const source = createFixtureExercise({
    sets: [
      createFixtureSet({ id: "s1", order: 1, targetKg: 80, targetReps: 10, toFailure: true }),
      createFixtureSet({ id: "s2", order: 2, targetKg: 70, targetReps: 12 }),
      createFixtureSet({ id: "s3", order: 3, targetKg: 60, targetReps: 14 }),
    ],
  });
  const sourceCopy = structuredClone(source);

  const linear = applyTechniqueToExercise(source, "linear");
  assert.equal(linear.ok, true);
  if (linear.ok) {
    assert.deepEqual(linear.exercise.sets.map((set) => [set.targetKg, set.targetReps, set.toFailure]), [
      [80, 10, false], [80, 10, false], [80, 10, false],
    ]);
  }

  const ascending = applyTechniqueToExercise(source, "ascending");
  assert.equal(ascending.ok, true);
  if (ascending.ok) {
    assert.deepEqual(ascending.exercise.sets.map((set) => [set.targetKg, set.targetReps]), [
      [80, 10], [88, 8], [96, 6],
    ]);
  }

  const descending = applyTechniqueToExercise(source, "descending");
  assert.equal(descending.ok, true);
  if (descending.ok) {
    assert.deepEqual(descending.exercise.sets.map((set) => [set.targetKg, set.targetReps]), [
      [96, 10], [88, 12], [80, 14],
    ]);
  }

  const drop = applyTechniqueToExercise(source, "drop_set", { dropIdNamespace: "tech" });
  assert.equal(drop.ok, true);
  if (drop.ok) {
    assert.deepEqual(drop.exercise.sets[2]?.drops, [{
      id: "tech:drop:1",
      sourceDropId: null,
      order: 1,
      kg: 48,
      reps: 8,
    }]);
  }

  const failure = applyTechniqueToExercise(source, "failure");
  assert.equal(failure.ok, true);
  if (failure.ok) assert.deepEqual(failure.exercise.sets.map((set) => set.toFailure), [false, false, true]);
  assert.deepEqual(source, sourceCopy, "los presets no mutan el ejercicio original");
});

test("drop set exige namespace sólo al crear el primer descenso", () => {
  const source = createFixtureExercise();
  assert.deepEqual(applyTechniqueToExercise(source, "drop_set"), {
    ok: false,
    reason: "missing_drop_id_namespace",
  });
  const first = applyTechniqueToExercise(source, "drop_set", { dropIdNamespace: "x" });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const reapplied = applyTechniqueToExercise(first.exercise, "drop_set");
  assert.equal(reapplied.ok, true);
  if (reapplied.ok) assert.deepEqual(reapplied.exercise.sets[0]?.drops, first.exercise.sets[0]?.drops);
});
