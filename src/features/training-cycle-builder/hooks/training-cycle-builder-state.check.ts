import assert from "node:assert/strict";
import test from "node:test";

import {
  createTrainingCycleBuilderTestViewModel,
  generateTrainingCycleSuggestionForTest,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-fixtures.check";
import {
  buildTrainingCycleActivateInput,
  buildTrainingCycleSaveActiveInput,
  buildTrainingCycleSaveDraftInput,
  buildTrainingCycleSuggestedDraftInput,
  createTrainingCycleDraftAfterDiscard,
  createTrainingCycleBuilderState,
  getExtensionValidation,
  getTrainingCycleDraftValidation,
  getTrainingCycleMetrics,
  trainingCycleBuilderReducer,
  type TrainingCycleBuilderAction,
  type TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import { applyTechniqueToExercise } from "@/features/training-cycle-builder/model/techniques";
import { createFixtureExercise, createFixtureSet } from "@/features/training-cycle-builder/model/test-fixtures";
import { DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS } from "@/features/training-cycle-builder/model/types";
import type { TrainingCycleExerciseDraft, TrainingCycleSaveDraftInput, TrainingCycleSaveDraftResult } from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import { TrainingCycleDraftAutosaveOwner } from "./training-cycle-draft-autosave";
import { prepareTrainingCycleDraftSave, requestTrainingCycleDraftSave } from "./training-cycle-draft-persistence";
import { suggestTrainingCycleDropKg } from "./training-cycle-drop-editing";
import {
  CYCLE_CATALOG_TABS,
  filterCycleCatalog,
  getCycleCatalogEmptyState,
  resolveCycleCustomExerciseName,
} from "@/features/training-cycle-builder/model/catalog-presentation";

function createState() {
  return createTrainingCycleBuilderState(createTrainingCycleBuilderTestViewModel());
}

function reduce(
  state: TrainingCycleBuilderState,
  ...actions: readonly TrainingCycleBuilderAction[]
) {
  return actions.reduce(trainingCycleBuilderReducer, state);
}

function catalogAddAction(): Extract<TrainingCycleBuilderAction, { type: "add_catalog_exercise" }> {
  return {
    type: "add_catalog_exercise",
    source: { kind: "catalog", id: "military-press" },
    name: "Press militar",
    muscleGroup: "Hombros",
    recommendation: { hasHistory: false, title: "Referencia inicial", body: "Editable", source: "Inicial" },
  };
}

function withFirstExercise(
  state: TrainingCycleBuilderState,
  update: (exercise: TrainingCycleExerciseDraft) => TrainingCycleExerciseDraft,
): TrainingCycleBuilderState {
  const monday = state.draft.routines.monday;
  return {
    ...state,
    draft: {
      ...state.draft,
      routines: {
        ...state.draft.routines,
        monday: { ...monday, exercises: monday.exercises.map((exercise, index) => index === 0 ? update(exercise) : exercise) },
      },
    },
  };
}

function createDropEditingState() {
  let state = reduce(createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_quick_reps", value: "20" },
    { type: "set_quick_kg", value: "70" },
    { type: "apply_quick_values" },
    { type: "set_exercise_mode", mode: "per_set" },
    { type: "set_technique", technique: "drop_set" },
    { type: "add_drop", setId: "press-flat-set-4" },
    { type: "add_drop", setId: "press-flat-set-4" },
  );
  for (const drop of state.draft.routines.monday.exercises[0].sets[3].drops) {
    state = reduce(state, { type: "edit_drop", setId: "press-flat-set-4", dropId: drop.id, field: "targetReps", value: "10" });
  }
  return state;
}

test("drop set mantiene cuatro principales20×70 y encadena descensos sólo en la serie elegida", () => {
  const state = createDropEditingState();
  const exercise = state.draft.routines.monday.exercises[0];
  assert.equal(exercise.technique, "drop_set");
  assert.deepEqual(exercise.sets.map((set) => [set.targetReps, set.targetKg]), Array.from({ length: 4 }, () => ["20", "70"]));
  assert.deepEqual(exercise.sets.map((set) => set.drops.length), [0, 0, 0, 3]);
  assert.deepEqual(exercise.sets.map((set) => set.toFailure), [false, false, false, true]);
  assert.deepEqual(exercise.sets[3].drops.map((drop) => [drop.targetReps, drop.targetKg]), [["10", "56"], ["10", "44.5"], ["10", "35.5"]]);
  const withSecondSeries = reduce(state, { type: "add_drop", setId: "press-flat-set-2" });
  assert.deepEqual(withSecondSeries.draft.routines.monday.exercises[0].sets.map((set) => set.drops.length), [0, 1, 0, 3]);
  assert.equal(withSecondSeries.draft.routines.monday.exercises[0].sets[1].drops[0].targetReps, "8", "el ejemplo de10reps no cambia el default existente");
  assert.equal(withSecondSeries.draft.routines.monday.exercises[0].sets[3], exercise.sets[3]);
});

test("carga y reps de cada tramo recalculan sugerencias sin alternar técnica ni acumular porcentajes", () => {
  const initial = createDropEditingState();
  let state = reduce(initial, { type: "edit_set", setId: "press-flat-set-4", field: "targetKg", value: "100" });
  const drops = () => state.draft.routines.monday.exercises[0].sets[3].drops;
  assert.equal(state.revision, initial.revision + 1);
  assert.deepEqual(drops().map((drop) => drop.targetKg), ["80", "64", "51"]);
  assert.equal(state.draft.routines.monday.exercises[0].sets[0], initial.draft.routines.monday.exercises[0].sets[0]);
  assert.equal(state.draft.routines.monday.exercises[1], initial.draft.routines.monday.exercises[1]);
  assert.equal(state.draft.routines.tuesday, initial.draft.routines.tuesday);
  state = reduce(state, { type: "edit_drop", setId: "press-flat-set-4", dropId: drops()[1].id, field: "targetReps", value: "20" });
  assert.deepEqual(drops().map((drop) => drop.targetKg), ["80", "32", "25.5"]);
  state = reduce(state, { type: "edit_drop", setId: "press-flat-set-4", dropId: drops()[0].id, field: "targetReps", value: "5" });
  assert.deepEqual(drops().map((drop) => drop.targetKg), ["80", "16", "12.5"]);
  state = reduce(state, { type: "edit_set", setId: "press-flat-set-4", field: "targetReps", value: "2" });
  assert.deepEqual(drops().map((drop) => drop.targetKg), ["32", "6", "4.5"]);
  state = reduce(state, { type: "edit_set", setId: "press-flat-set-4", field: "targetReps", value: "20" });
  assert.deepEqual(drops().map((drop) => drop.targetKg), ["80", "16", "12.5"]);
  assert.equal(state.draft.routines.monday.exercises[0].technique, "drop_set");
  assert.deepEqual(drops().map((drop) => drop.id), initial.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.id));
  assert.equal(reduce(state, { type: "edit_set", setId: "press-flat-set-4", field: "targetReps", value: "20" }), state);
});

test("la heurística acota carga y volumen al subir reps y no convierte menos reps en más peso", () => {
  for (const kg of ["0,5", "70", "70,5", "99999.99"]) {
    for (const previousReps of [1, 10, 20, 1000]) {
      for (const targetReps of [1, 10, 20, 1000]) {
        const suggested = suggestTrainingCycleDropKg({ targetKg: kg, targetReps: String(previousReps) }, String(targetReps));
        assert.notEqual(suggested, null);
        const referenceKg = Number(kg.replace(",", "."));
        assert.ok(suggested! <= referenceKg * 0.8);
        assert.ok(suggested! * targetReps <= referenceKg * previousReps * 0.8);
        assert.equal(suggested! * 2, Math.floor(suggested! * 2));
      }
    }
  }
  assert.equal(suggestTrainingCycleDropKg({ targetKg: "70", targetReps: "20" }, "10"), 56);
  assert.equal(suggestTrainingCycleDropKg({ targetKg: "70", targetReps: "10" }, "20"), 28);
  for (const value of ["", " ", "0", "-1", "1.5", "1,5", "Infinity", "NaN", "1001"]) {
    assert.equal(suggestTrainingCycleDropKg({ targetKg: "70", targetReps: value }, "10"), null);
    assert.equal(suggestTrainingCycleDropKg({ targetKg: "70", targetReps: "20" }, value), null);
  }
  for (const value of ["", " ", "0", "-1", ",", ".", "Infinity", "NaN", "1e2", "100000"]) {
    assert.equal(suggestTrainingCycleDropKg({ targetKg: value, targetReps: "20" }, "10"), null);
  }
});

test("las cargas manuales son anclas incluso si coincidían con la sugerencia inicial", () => {
  let state = createDropEditingState();
  const setId = "press-flat-set-4";
  const initialDrops = state.draft.routines.monday.exercises[0].sets[3].drops;
  state = reduce(state,
    { type: "edit_drop", setId, dropId: initialDrops[0].id, field: "targetKg", value: "56" },
    { type: "edit_drop", setId, dropId: initialDrops[1].id, field: "targetKg", value: "40,5" },
    { type: "ignore_recommendation" },
    { type: "edit_set", setId, field: "targetKg", value: "100" },
  );
  let exercise = state.draft.routines.monday.exercises[0];
  assert.deepEqual(exercise.sets[3].drops.map((drop) => drop.targetKg), ["56", "40,5", "32"]);
  assert.equal(exercise.recommendationDecision, "ignored");
  state = reduce(state, { type: "edit_drop", setId, dropId: initialDrops[1].id, field: "targetReps", value: "5" });
  exercise = state.draft.routines.monday.exercises[0];
  assert.deepEqual(exercise.sets[3].drops.map((drop) => drop.targetKg), ["56", "40,5", "16"]);
  const invalidReference = reduce(state, { type: "edit_set", setId, field: "targetKg", value: "30" });
  assert.deepEqual(invalidReference.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.targetKg), ["56", "40,5", "16"]);
  assert.equal(getTrainingCycleDraftValidation(invalidReference.draft).canSave, false, "no corregir una carga manual que ya no es descendente");
});

test("un borrador recuperado no infiere procedencia automática por sus números", () => {
  const saved = withFirstExercise(createDropEditingState(), (exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => ({ ...set, drops: set.drops.map(({ id, targetKg, targetReps }) => ({ id, targetKg, targetReps })) })),
  }));
  const hydrated = createTrainingCycleBuilderState({ ...createTrainingCycleBuilderTestViewModel(), draft: saved.draft });
  const opened = reduce(hydrated, { type: "open_exercise", exerciseId: "press-flat" });
  assert.equal(opened.draft, hydrated.draft);
  const changed = reduce(opened,
    { type: "edit_set", setId: "press-flat-set-4", field: "targetKg", value: "100" },
    { type: "edit_set", setId: "press-flat-set-4", field: "targetReps", value: "5" },
  );
  assert.equal(changed.draft.routines.monday.exercises[0].sets[3].drops, saved.draft.routines.monday.exercises[0].sets[3].drops);
  assert.deepEqual(changed.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.targetKg), ["56", "44.5", "35.5"]);
});

test("buffers inválidos vacían sólo sugerencias y el guardado espera datos completos", () => {
  const original = createDropEditingState();
  const setId = "press-flat-set-4";
  for (const field of ["targetKg", "targetReps"] as const) {
    for (const value of ["", " ", "-1", "x", "Infinity", "999999"]) {
      const invalid = reduce(original, { type: "edit_set", setId, field, value });
      const set = invalid.draft.routines.monday.exercises[0].sets[3];
      assert.equal(set[field], value);
      assert.deepEqual(set.drops.map((drop) => drop.targetKg), ["", "", ""]);
      assert.equal(getTrainingCycleDraftValidation(invalid.draft).canSave, false);
      assert.equal(prepareTrainingCycleDraftSave(invalid.draft, invalid.origin), null);
      const restored = reduce(invalid, { type: "edit_set", setId, field, value: field === "targetKg" ? "70" : "20" });
      assert.deepEqual(restored.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.targetKg), ["56", "44.5", "35.5"]);
    }
  }
  const firstDropId = original.draft.routines.monday.exercises[0].sets[3].drops[0].id;
  for (const value of ["", ",", ".", "-1", "x", "999999"]) {
    const invalid = reduce(original, { type: "edit_drop", setId, dropId: firstDropId, field: "targetKg", value });
    const drops = invalid.draft.routines.monday.exercises[0].sets[3].drops;
    assert.deepEqual(drops.map((drop) => drop.targetKg), [value, "", ""]);
    assert.equal(drops[0].followsPreviousLoad, false);
    assert.equal(getTrainingCycleDraftValidation(invalid.draft).canSave, false);
    assert.equal(reduce(invalid, { type: "add_drop", setId }), invalid);
  }
  const decimal = reduce(original, { type: "edit_drop", setId, dropId: firstDropId, field: "targetKg", value: "50,5" });
  assert.deepEqual(decimal.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.targetKg), ["50,5", "40", "32"]);
});

test("kg iguales, ascendentes o que cruzan una carga manual conservan el texto y bloquean autosave", async () => {
  let baseline = reduce(createState(),
    { type: "choose_origin", origin: "manual", screen: "routine" },
    { ...catalogAddAction(), source: { kind: "catalog", id: "10000000-0000-4000-8000-000000000001" } },
  );
  const exerciseId = baseline.draft.routines.monday.exercises[0].id;
  baseline = reduce(baseline,
    { type: "open_exercise", exerciseId },
    { type: "set_quick_reps", value: "20" },
    { type: "set_quick_kg", value: "70" },
    { type: "apply_quick_values" },
    { type: "set_exercise_mode", mode: "per_set" },
    { type: "set_technique", technique: "drop_set" },
  );
  const setId = baseline.draft.routines.monday.exercises[0].sets[3].id;
  baseline = reduce(baseline, { type: "add_drop", setId }, { type: "add_drop", setId });
  const firstDropId = baseline.draft.routines.monday.exercises[0].sets[3].drops[0].id;
  const manualDropId = baseline.draft.routines.monday.exercises[0].sets[3].drops[1].id;
  baseline = reduce(baseline, { type: "edit_drop", setId, dropId: manualDropId, field: "targetKg", value: "40" });
  const originalSet = baseline.draft.routines.monday.exercises[0].sets[3];
  assert.deepEqual(originalSet.drops.map((drop) => drop.targetKg), ["56", "40", "32"]);
  assert.ok(prepareTrainingCycleDraftSave(baseline.draft, baseline.origin), "la referencia inicial sí puede persistirse");
  for (const value of ["70", "80", "35", "40", " 80 ", "70,0", "35.0"]) {
    let state = baseline;
    const writes: TrainingCycleSaveDraftInput[] = [];
    const owner = new TrainingCycleDraftAutosaveOwner({
      write: async (payload) => { writes.push(payload); return { status: "saved", savedAtLabel: "Inicial" }; },
      onEvent: () => {},
    });
    owner.resume(state.draft.draftId);
    const dispatch = (action: TrainingCycleBuilderAction) => { state = trainingCycleBuilderReducer(state, action); };
    const request = () => requestTrainingCycleDraftSave({ owner, draft: state.draft, origin: state.origin, dispatch });
    await request();
    assert.equal(writes.length, 1, "el writer está activo para el snapshot válido");
    const beforeEditRevision = state.revision;
    dispatch({ type: "edit_drop", setId, dropId: firstDropId, field: "targetKg", value });
    const editedSet = state.draft.routines.monday.exercises[0].sets[3];
    assert.equal(editedSet.drops[0].targetKg, value, "no restaurar56ni normalizar el string tecleado");
    assert.equal(editedSet.drops[0].followsPreviousLoad, false);
    assert.equal(editedSet.drops[1], originalSet.drops[1], "no sobrescribir la siguiente carga manual40");
    assert.equal(editedSet.drops[2].targetKg, "32", "la sugerencia posterior sigue su ancla manual");
    assert.equal(state.revision, beforeEditRevision + 1);
    assert.equal(getTrainingCycleDraftValidation(state.draft).seriesValid, false);
    assert.equal(getTrainingCycleDraftValidation(state.draft).canSave, false);
    assert.equal(prepareTrainingCycleDraftSave(state.draft, state.origin), null);
    await request();
    assert.equal(writes.length, 1, "ninguna entrada no descendente dispara un nuevo write");
    assert.equal(state.saveState, "pending");
    assert.equal(state.draft.routines.monday.exercises[0].sets[3].drops[0].targetKg, value);
  }
});

test("quitar un descenso y aceptar sugerencias actualiza sólo pendientes automáticos", () => {
  const original = createDropEditingState();
  const setId = "press-flat-set-4";
  const firstId = original.draft.routines.monday.exercises[0].sets[3].drops[0].id;
  const removed = reduce(original, { type: "remove_drop", setId, dropId: firstId });
  assert.deepEqual(removed.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.targetKg), ["56", "44.5"]);
  const accepted = reduce(original, { type: "accept_recommendation" });
  assert.deepEqual(accepted.draft.routines.monday.exercises[0].sets[3].drops.map((drop) => drop.targetKg), ["67", "53.5", "42.5"]);
  assert.equal(accepted.draft.routines.monday.exercises[0].recommendationDecision, "accepted");
  for (const blocked of [{ ...original, workflow: "active" as const }, { ...original, committedSyncPending: true }]) {
    assert.equal(reduce(blocked,
      { type: "edit_set", setId, field: "targetKg", value: "100" },
      { type: "edit_drop", setId, dropId: firstId, field: "targetReps", value: "20" },
    ), blocked);
  }
});

test("el snapshot de persistencia incluye el recálculo pero nunca procedencia de sugerencias", async () => {
  let state = reduce(createState(),
    { type: "choose_origin", origin: "manual", screen: "routine" },
    { ...catalogAddAction(), source: { kind: "catalog", id: "10000000-0000-4000-8000-000000000001" } },
  );
  const exerciseId = state.draft.routines.monday.exercises[0].id;
  state = reduce(state,
    { type: "open_exercise", exerciseId },
    { type: "set_quick_reps", value: "20" },
    { type: "set_quick_kg", value: "70" },
    { type: "apply_quick_values" },
    { type: "set_exercise_mode", mode: "per_set" },
    { type: "set_technique", technique: "drop_set" },
  );
  const set = state.draft.routines.monday.exercises[0].sets[3];
  state = reduce(state, { type: "edit_drop", setId: set.id, dropId: set.drops[0].id, field: "targetReps", value: "40" });
  const writes: TrainingCycleSaveDraftInput[] = [];
  const owner = new TrainingCycleDraftAutosaveOwner({
    write: async (payload) => { writes.push(payload); return { status: "saved", savedAtLabel: "Descensos" }; },
    onEvent: () => {},
  });
  owner.resume(state.draft.draftId);
  const dispatch = (action: TrainingCycleBuilderAction) => { state = trainingCycleBuilderReducer(state, action); };
  await requestTrainingCycleDraftSave({ owner, draft: state.draft, origin: state.origin, dispatch });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].days[0].exercises[0].sets[3].drops, [{ targetKg: 28, targetReps: 40 }]);
  assert.doesNotMatch(JSON.stringify(writes), /followsPreviousLoad/);
  const activePayload = buildTrainingCycleSaveActiveInput(state.draft, "cycle-test", "revision-test");
  assert.doesNotMatch(JSON.stringify(activePayload), /followsPreviousLoad/);
  state = reduce(state, { type: "edit_drop", setId: set.id, dropId: set.drops[0].id, field: "targetReps", value: "" });
  await requestTrainingCycleDraftSave({ owner, draft: state.draft, origin: state.origin, dispatch });
  assert.equal(writes.length, 1);
  assert.equal(state.saveState, "pending");
});

test("abrir y rehidratar técnicas avanzadas o series heterogéneas elige por-series sin mutación", () => {
  const advanced: readonly ((exercise: TrainingCycleExerciseDraft) => TrainingCycleExerciseDraft)[] = [
    ...(["ascending", "descending", "drop_set", "failure"] as const).map((technique) =>
      (exercise: TrainingCycleExerciseDraft) => ({ ...exercise, technique })),
    (exercise) => ({ ...exercise, sets: exercise.sets.map((set, index) => index === 1 ? { ...set, targetReps: "7" } : set) }),
    (exercise) => ({ ...exercise, sets: exercise.sets.map((set, index) => index === 1 ? { ...set, targetKg: "72" } : set) }),
    (exercise) => ({ ...exercise, sets: exercise.sets.map((set, index) => index === 1 ? { ...set, toFailure: true } : set) }),
    (exercise) => ({ ...exercise, sets: exercise.sets.map((set, index) => index === 1 ? { ...set, drops: [{ id: "preserved-drop", targetKg: "60", targetReps: "6" }] } : set) }),
  ];
  for (const update of advanced) {
    const configured = withFirstExercise(createState(), update);
    const hydrated = createTrainingCycleBuilderState({ ...createTrainingCycleBuilderTestViewModel(), draft: configured.draft });
    const opened = reduce(hydrated, { type: "open_exercise", exerciseId: "press-flat" });
    const reopened = reduce(opened, { type: "return_to", screen: "routine" }, { type: "open_exercise", exerciseId: "press-flat" });
    for (const state of [opened, reopened]) {
      assert.equal(state.exerciseMode, "per_set");
      assert.equal(state.draft, hydrated.draft);
      assert.equal(state.revision, hydrated.revision);
      assert.equal(state.quickKg, "80");
      assert.equal(state.quickReps, "10");
      assert.deepEqual(buildTrainingCycleSaveDraftInput(state.draft, state.origin), buildTrainingCycleSaveDraftInput(hydrated.draft, hydrated.origin));
    }
  }
  const initial = createState();
  const linear = reduce(initial, { type: "open_exercise", exerciseId: "press-flat" });
  assert.equal(linear.exerciseMode, "quick");
  assert.equal(linear.draft, initial.draft);
  assert.equal(linear.revision, initial.revision);
});

test("elegir Series lineales convierte desde la primera serie actual en una sola revisión", () => {
  for (const technique of ["ascending", "descending", "drop_set", "failure", "linear"] as const) {
    const before = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_exercise_mode", mode: "per_set" },
      { type: "set_technique", technique },
      { type: "edit_set", setId: "press-flat-set-2", field: "targetReps", value: "7" },
      { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "100,5" },
      { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value: "13" },
      { type: "toggle_set_open", setId: "press-flat-set-2" },
    );
    assert.equal(before.quickKg, "80", "el buffer anterior no es fuente para convertir");
    const converted = reduce(before, { type: "set_exercise_mode", mode: "quick" });
    const exercise = converted.draft.routines.monday.exercises[0];
    assert.equal(converted.exerciseMode, "quick");
    assert.equal(converted.quickKg, "100,5");
    assert.equal(converted.quickReps, "13");
    assert.equal(converted.openSetId, null);
    assert.equal(converted.revision, before.revision + 1);
    assert.equal(exercise.technique, "linear");
    assert.equal(exercise.recommendationDecision, "modified");
    assert.equal(exercise.videoUrl, before.draft.routines.monday.exercises[0].videoUrl);
    assert.deepEqual(exercise.sets.map((set) => set.id), before.draft.routines.monday.exercises[0].sets.map((set) => set.id));
    assert.ok(exercise.sets.every((set) => set.targetKg === "100,5" && set.targetReps === "13" && !set.toFailure && !set.drops.length));
    assert.equal(converted.draft.routines.monday.exercises[1], before.draft.routines.monday.exercises[1]);
    assert.equal(converted.draft.routines.wednesday, before.draft.routines.wednesday);
    const payload = buildTrainingCycleSaveDraftInput(converted.draft, converted.origin).days[0].exercises[0];
    assert.equal(payload.technique, "linear");
    assert.ok(payload.sets.every((set) => set.targetKg === 100.5 && set.targetReps === 13 && !set.toFailure && !set.drops.length));
    const reopened = reduce(converted, { type: "return_to", screen: "routine" }, { type: "open_exercise", exerciseId: "press-flat" });
    assert.equal(reopened.exerciseMode, "quick");
    assert.equal(reopened.draft, converted.draft);
    assert.equal(reopened.revision, converted.revision);
  }
});

test("el modo ya activo es no-op y entrar por-series no aplica buffers pendientes", () => {
  const pending = reduce(createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_quick_reps", value: "17" },
    { type: "set_quick_kg", value: "999" },
  );
  assert.equal(reduce(pending, { type: "set_exercise_mode", mode: "quick" }), pending);
  const perSet = reduce(pending, { type: "set_exercise_mode", mode: "per_set" });
  assert.equal(perSet.draft, pending.draft);
  assert.equal(perSet.revision, pending.revision);
  assert.equal(reduce(perSet, { type: "set_exercise_mode", mode: "per_set" }), perSet);
  const returned = reduce(perSet, { type: "set_exercise_mode", mode: "quick" });
  assert.equal(returned.quickKg, "80");
  assert.equal(returned.quickReps, "10");
  assert.equal(returned.draft, pending.draft, "series ya uniformes no requieren convertir ni autoguardar");
  assert.equal(returned.revision, pending.revision);
});

test("Aplicar valores rápidos persiste linear real sin metadata avanzada oculta", () => {
  for (const technique of ["ascending", "descending", "drop_set", "failure"] as const) {
    // Simula un estado antiguo cuyo modo compacto no correspondía a su técnica.
    const legacy = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_technique", technique },
      { type: "ignore_recommendation" },
      { type: "set_quick_reps", value: "12" },
      { type: "set_quick_kg", value: "92,5" },
    );
    const applied = reduce(legacy, { type: "apply_quick_values" });
    assert.equal(applied.revision, legacy.revision + 1);
    const exercise = applied.draft.routines.monday.exercises[0];
    assert.equal(exercise.technique, "linear");
    assert.equal(exercise.recommendationDecision, "ignored");
    const payload = buildTrainingCycleSaveDraftInput(applied.draft, applied.origin).days[0].exercises[0];
    assert.equal(payload.technique, "linear");
    assert.ok(payload.sets.every((set) => set.targetKg === 92.5 && set.targetReps === 12 && !set.toFailure && !set.drops.length));
    assert.equal(reduce(applied, { type: "apply_quick_values" }), applied);
    const increased = reduce(applied, { type: "change_set_count", delta: 1 });
    assert.equal(increased.draft.routines.monday.exercises[0].sets.length, exercise.sets.length + 1);
    assert.ok(increased.draft.routines.monday.exercises[0].sets.every((set) => set.targetKg === "92,5" && set.targetReps === "12" && !set.toFailure && !set.drops.length));
  }
});

test("convertir y aplicar preserva entradas vacías o inválidas sin inventar cargas o reps", () => {
  for (const value of ["", " ", "inválido", "-1", "999999"]) {
    const before = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_exercise_mode", mode: "per_set" },
      { type: "set_technique", technique: "failure" },
      { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value },
      { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value },
    );
    const converted = reduce(before, { type: "set_exercise_mode", mode: "quick" });
    assert.equal(converted.quickKg, value);
    assert.equal(converted.quickReps, value);
    assert.ok(converted.draft.routines.monday.exercises[0].sets.every((set) => set.targetKg === value && set.targetReps === value));
    assert.equal(getTrainingCycleDraftValidation(converted.draft).canSave, false);
    const quick = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_quick_kg", value },
      { type: "set_quick_reps", value },
      { type: "apply_quick_values" },
    );
    assert.ok(quick.draft.routines.monday.exercises[0].sets.every((set) => set.targetKg === value && set.targetReps === value));
    assert.equal(getTrainingCycleDraftValidation(quick.draft).canSave, false);
  }
});

test("quitar la primera serie usa la nueva referencia al volver a lineales", () => {
  const before = reduce(createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_exercise_mode", mode: "per_set" },
    { type: "edit_set", setId: "press-flat-set-2", field: "targetKg", value: "72" },
    { type: "edit_set", setId: "press-flat-set-2", field: "targetReps", value: "8" },
    { type: "remove_set", setId: "press-flat-set-1" },
  );
  const returned = reduce(before, { type: "set_exercise_mode", mode: "quick" });
  assert.equal(returned.quickKg, "72");
  assert.equal(returned.quickReps, "8");
  assert.ok(returned.draft.routines.monday.exercises[0].sets.every((set) => set.targetKg === "72" && set.targetReps === "8"));
});

test("aceptar recomendación sincroniza el bloque lineal sin sobrescribir sugerencias heterogéneas", () => {
  const before = reduce(createState(), { type: "open_exercise", exerciseId: "press-flat" });
  const uniform = reduce(before, { type: "accept_recommendation" });
  assert.equal(uniform.exerciseMode, "quick");
  assert.equal(uniform.quickKg, "84");
  assert.equal(uniform.quickReps, "10");
  assert.equal(uniform.revision, before.revision + 1);
  const applied = reduce(uniform, { type: "apply_quick_values" });
  assert.equal(applied, uniform, "Aplicar no restaura la carga anterior a la sugerencia ni modifica su decisión");
  const heterogeneous = withFirstExercise(before, (exercise) => ({
    ...exercise,
    recommendation: { ...exercise.recommendation, suggestedSets: [{ order: 1, targetReps: 10, suggestedKg: "82" }, { order: 2, targetReps: 10, suggestedKg: "86" }] },
  }));
  const accepted = reduce(heterogeneous, { type: "accept_recommendation" });
  assert.equal(accepted.exerciseMode, "per_set");
  assert.equal(accepted.quickKg, "82");
  assert.equal(accepted.revision, heterogeneous.revision + 1);
  assert.equal(accepted.draft.routines.monday.exercises[0].recommendationDecision, "accepted");
  assert.deepEqual(accepted.draft.routines.monday.exercises[0].sets.map((set) => set.targetKg), ["82", "86", "84", "84"]);
  const explicitPerSet = reduce(before, { type: "set_exercise_mode", mode: "per_set" }, { type: "accept_recommendation" });
  assert.equal(explicitPerSet.exerciseMode, "per_set", "aceptar no revoca una elección explícita del editor por-series");
});

test("la conversión respeta bloqueos active/sync y persiste dentro de active_edit", () => {
  const advanced = reduce(createState(), { type: "open_exercise", exerciseId: "press-military" });
  for (const blocked of [{ ...advanced, workflow: "active" as const }, { ...advanced, committedSyncPending: true }]) {
    assert.equal(reduce(blocked, { type: "set_exercise_mode", mode: "quick" }, { type: "apply_quick_values" }), blocked);
  }
  const activeLinear = { ...reduce(createState(), { type: "open_exercise", exerciseId: "press-flat" }), workflow: "active" as const };
  const inspect = reduce(activeLinear, { type: "set_exercise_mode", mode: "per_set" });
  assert.equal(inspect.exerciseMode, "per_set", "el guard de escritura no bloquea la inspección visual que ya estaba permitida");
  assert.equal(inspect.draft, activeLinear.draft);
  assert.equal(inspect.revision, activeLinear.revision);
  assert.equal(reduce(inspect, { type: "set_exercise_mode", mode: "per_set" }), inspect);
  const compact = reduce(inspect, { type: "set_exercise_mode", mode: "quick" });
  assert.equal(compact.exerciseMode, "quick", "volver a un bloque ya uniforme también es navegación sin write");
  assert.equal(compact.draft, activeLinear.draft);
  assert.equal(compact.revision, activeLinear.revision);
  const editing = { ...advanced, workflow: "active_edit" as const };
  const converted = reduce(editing, { type: "set_exercise_mode", mode: "quick" });
  assert.equal(converted.workflow, "active_edit");
  assert.equal(converted.revision, editing.revision + 1);
  const payload = buildTrainingCycleSaveActiveInput(converted.draft, "cycle-test", "revision-test").days[0].exercises[2];
  assert.equal(payload.technique, "linear");
  assert.ok(payload.sets.every((set) => set.targetKg === 45 && set.targetReps === 10 && !set.toFailure && !set.drops.length));
});

test("autosave serializa el cambio a lineales y sólo confirma el último snapshot aplicado", async () => {
  let state = reduce(createState(),
    { type: "choose_origin", origin: "manual", screen: "routine" },
    { ...catalogAddAction(), source: { kind: "catalog", id: "10000000-0000-4000-8000-000000000001" } },
  );
  state = reduce(state,
    { type: "open_exercise", exerciseId: state.draft.routines.monday.exercises[0].id },
    { type: "set_exercise_mode", mode: "per_set" },
    { type: "set_technique", technique: "drop_set" },
  );
  let release!: (result: TrainingCycleSaveDraftResult) => void;
  const pendingWrite = new Promise<TrainingCycleSaveDraftResult>((resolve) => { release = resolve; });
  const writes: TrainingCycleSaveDraftInput[] = [];
  const events: string[] = [];
  const owner = new TrainingCycleDraftAutosaveOwner({
    write: async (payload) => {
      writes.push(payload);
      return writes.length === 1 ? pendingWrite : { status: "saved", savedAtLabel: "Lineales" };
    },
    onEvent: (event) => { events.push(event.status); },
  });
  owner.resume(state.draft.draftId);
  const dispatch = (action: TrainingCycleBuilderAction) => { state = trainingCycleBuilderReducer(state, action); };
  const request = () => requestTrainingCycleDraftSave({ owner, draft: state.draft, origin: state.origin, dispatch });
  const advancedRequest = request();
  state = reduce(state, { type: "set_exercise_mode", mode: "quick" });
  const convertedRequest = request();
  state = reduce(state,
    { type: "set_quick_kg", value: "97,5" },
    { type: "set_quick_reps", value: "11" },
    { type: "apply_quick_values" },
  );
  const latestRequest = request();
  assert.equal(writes.length, 1, "la conversión no solapa el write avanzado en vuelo");
  release({ status: "saved", savedAtLabel: "Avanzado obsoleto" });
  await Promise.all([advancedRequest, convertedRequest, latestRequest]);
  await owner.whenIdle();
  assert.equal(writes.length, 2, "el snapshot intermedio se sustituye por el último aplicado");
  assert.equal(writes[0].days[0].exercises[0].technique, "drop_set");
  const persisted = writes[1].days[0].exercises[0];
  assert.equal(persisted.technique, "linear");
  assert.ok(persisted.sets.every((set) => set.targetKg === 97.5 && set.targetReps === 11 && !set.toFailure && !set.drops.length));
  assert.deepEqual(events, ["saved"], "el write avanzado obsoleto nunca publica un guardado actual");
});

test("Todos es la primera pestaña y cada apertura desde rutina muestra el catálogo completo", () => {
  const initial = createState();
  assert.deepEqual(CYCLE_CATALOG_TABS.map(({ scope }) => scope), ["all", "previous", "recent"]);
  assert.equal(initial.catalogScope, "all");
  const reopened = reduce(initial,
    { type: "navigate", screen: "catalog" },
    { type: "set_catalog_scope", scope: "previous" },
    { type: "set_catalog_query", value: "Press" },
    { type: "return_to", screen: "routine" },
    { type: "navigate", screen: "catalog" },
  );
  assert.equal(reopened.catalogScope, "all");
  assert.equal(reopened.catalogQuery, "");
  const catalog = createTrainingCycleBuilderTestViewModel().catalog;
  assert.deepEqual(filterCycleCatalog(catalog, reopened.catalogQuery, reopened.catalogScope), catalog);
  for (const scope of ["previous", "recent"] as const) {
    assert.deepEqual(filterCycleCatalog(catalog, "", scope), catalog.filter((entry) => entry.sources.includes(scope)));
  }
  // Preserve accent-insensitive global search even when a history tab was selected.
  const triceps = filterCycleCatalog(catalog, "  TRICEPS  ", "previous");
  assert.ok(triceps.length > 0);
  assert.ok(triceps.every((entry) => entry.muscleGroup === "Tríceps"));
});

test("historial vacío, recientes y búsqueda sin resultados tienen mensajes distintos sin comillas vacías", () => {
  const previous = getCycleCatalogEmptyState("  ", "previous");
  assert.equal(`${previous.title} ${previous.body}`, "Aún no tienes ejercicios de un ciclo anterior. Explora el catálogo o crea el que no encuentres: quedará guardado en tu cuenta para futuras rutinas.");
  assert.equal(previous.showBrowse, true);
  assert.equal(previous.createLabel, "Crear ejercicio");
  assert.equal(getCycleCatalogEmptyState("", "recent").title, "Aún no tienes ejercicios recientes.");
  assert.equal(getCycleCatalogEmptyState("", "all").showBrowse, false);
  for (const scope of ["previous", "recent", "all"] as const) {
    const empty = getCycleCatalogEmptyState("\t ", scope);
    assert.doesNotMatch(JSON.stringify(empty), /“”|No encontramos/);
    const searched = getCycleCatalogEmptyState("  Ejercicio inexistente  ", scope);
    assert.equal(searched.title, "No encontramos “Ejercicio inexistente”");
    assert.equal(searched.createLabel, "Crear “Ejercicio inexistente”");
    assert.match(searched.body, /guardado en tu cuenta/);
  }
});

test("reabrir un personalizado conserva nombre, grupo y video salvo precarga de una búsqueda explícita", () => {
  const filled = reduce(createState(),
    { type: "navigate", screen: "catalog" },
    { type: "navigate", screen: "custom" },
    { type: "set_custom_name", value: "Mi press en máquina" },
    { type: "set_custom_muscle", value: "Pectoral" },
    { type: "set_custom_video", value: "https://youtu.be/abcdefghijk" },
    { type: "custom_exercise_failed", message: "No se pudo guardar el ejercicio" },
    { type: "back" },
  );
  for (const query of ["", "   ", "\t", "  Sentadilla libre  "]) {
    const searching = reduce(filled, { type: "set_catalog_query", value: query });
    const name = resolveCycleCustomExerciseName(searching.catalogQuery, searching.customName);
    const prepared = name !== searching.customName
      ? reduce(searching, { type: "set_custom_name", value: name })
      : searching;
    const reopened = reduce(prepared, { type: "navigate", screen: "custom" });
    assert.equal(reopened.customName, query.trim() ? "Sentadilla libre" : "Mi press en máquina");
    assert.equal(reopened.customMuscleGroup, "Pectoral");
    assert.equal(reopened.customVideoUrl, "https://youtu.be/abcdefghijk");
    assert.equal(reopened.screen, "custom");
    assert.equal(reopened.revision, filled.revision);
    assert.equal(reopened.draft, filled.draft);
    if (!query.trim()) assert.equal(reopened.customErrorMessage, filled.customErrorMessage);
  }
  assert.equal(resolveCycleCustomExerciseName("", ""), "");
});

test("el aviso acredita la adición real al día correcto pero nunca el guardado remoto", () => {
  const initial = reduce(createState(),
    { type: "select_day", day: "tuesday" },
    { type: "navigate", screen: "catalog" },
    { type: "set_save_state", state: "saving" },
  );
  const added = reduce(initial, catalogAddAction());
  const exercise = added.draft.routines.tuesday.exercises.at(-1)!;
  assert.deepEqual(added.catalogAddition, { exerciseId: exercise.id, name: exercise.name, day: "tuesday" });
  assert.equal(added.draft.routines.tuesday.exercises.length, initial.draft.routines.tuesday.exercises.length + 1);
  assert.equal(added.revision, initial.revision + 1);
  assert.notEqual(added.saveState, "saved");
  const dismissed = reduce(added, { type: "dismiss_catalog_addition", exerciseId: exercise.id });
  assert.equal(dismissed.catalogAddition, null);
  assert.equal(dismissed.draft, added.draft);
  assert.equal(dismissed.revision, added.revision);
  assert.equal(dismissed.saveState, added.saveState);
  assert.deepEqual(buildTrainingCycleSaveDraftInput(dismissed.draft, dismissed.origin), buildTrainingCycleSaveDraftInput(added.draft, added.origin));
  assert.doesNotMatch(JSON.stringify(buildTrainingCycleSaveDraftInput(added.draft, added.origin)), /catalogAddition/);
});

test("pulsaciones repetidas renuevan el aviso y un temporizador viejo no borra el nuevo", () => {
  const first = reduce(createState(), { type: "navigate", screen: "catalog" }, catalogAddAction());
  const second = reduce(first, catalogAddAction());
  assert.notEqual(first.catalogAddition!.exerciseId, second.catalogAddition!.exerciseId);
  assert.equal(second.draft.routines.monday.exercises.length, first.draft.routines.monday.exercises.length + 1);
  assert.equal(reduce(second, {
    type: "dismiss_catalog_addition", exerciseId: first.catalogAddition!.exerciseId,
  }), second);
  assert.equal(reduce(second, {
    type: "dismiss_catalog_addition", exerciseId: second.catalogAddition!.exerciseId,
  }).catalogAddition, null);
});

test("salir del catálogo o cambiar de día no conserva avisos obsoletos", () => {
  const added = reduce(createState(), { type: "navigate", screen: "routine" },
    { type: "navigate", screen: "catalog" }, catalogAddAction());
  for (const action of [
    { type: "navigate", screen: "custom" },
    { type: "return_to", screen: "routine" },
    { type: "back" },
    { type: "select_day", day: "friday" },
  ] satisfies TrainingCycleBuilderAction[]) {
    const next = reduce(added, action);
    assert.equal(next.catalogAddition, null);
    assert.equal(next.revision, added.revision);
  }
});

test("un add bloqueado no confirma nada y la limpieza visual no desbloquea escrituras", () => {
  for (const locked of [
    { ...createState(), committedSyncPending: true },
    { ...createState(), workflow: "active" as const },
  ]) {
    assert.equal(reduce(locked, catalogAddAction()), locked);
    assert.equal(locked.catalogAddition, null);
  }
  const added = reduce(createState(), catalogAddAction());
  const pending = { ...added, committedSyncPending: true };
  const expired = reduce(pending, { type: "dismiss_catalog_addition", exerciseId: added.catalogAddition!.exerciseId });
  assert.equal(expired.catalogAddition, null);
  assert.equal(expired.committedSyncPending, true);
  assert.equal(expired.draft, pending.draft);
  assert.equal(expired.revision, pending.revision);
  assert.equal(reduce(expired, catalogAddAction()), expired);
});

test("un cambio confirmado con sync pendiente bloquea nuevos gestos hasta recargar", () => {
  const failures: TrainingCycleBuilderAction[] = [
    { type: "activation_failed", message: "Cambio guardado", committed: true },
    { type: "extension_failed", message: "Cambio guardado", committed: true },
    { type: "active_edit_failed", message: "Cambio guardado", committed: true, conflict: true },
  ];
  for (const failure of failures) {
    const pending = reduce(createState(), failure);
    assert.equal(pending.committedSyncPending, true);
    for (const gesture of [
      { type: "activation_started" }, { type: "extension_started" }, { type: "active_edit_started" },
      { type: "open_extend" }, { type: "open_discard" }, { type: "navigate", screen: "setup" },
    ] as TrainingCycleBuilderAction[]) {
      assert.equal(reduce(pending, gesture), pending);
    }
  }
});

test("el payload de guardado usa una allowlist explícita y no expone ownership", () => {
  const input = buildTrainingCycleSaveDraftInput(createState().draft, "duplicate");
  assert.deepEqual(Object.keys(input).sort(), ["days", "draftId", "endDate", "goal", "origin", "startDate"]);
  assert.deepEqual(Object.keys(input.days[0]).sort(), ["day", "exercises", "name"]);
  assert.deepEqual(Object.keys(input.days[0].exercises[0]).sort(), [
    "muscleGroup",
    "name",
    "order",
    "sets",
    "source",
    "technique",
    "videoUrl",
  ]);
  assert.doesNotMatch(JSON.stringify(input), /user_id|owner_id|profile_id|service_role/i);
  const activation = buildTrainingCycleActivateInput(createState().draft);
  assert.deepEqual(activation, { draftId: createState().draft.draftId });

  const active = buildTrainingCycleSaveActiveInput(createState().draft, "cycle-1", "revision-7");
  assert.deepEqual(Object.keys(active).sort(), ["cycleId", "days", "expectedRevision", "goal"]);
  assert.equal(active.expectedRevision, "revision-7");
  assert.doesNotMatch(JSON.stringify(active), /startDate|endDate|user_id|owner_id|profile_id/i);
});

test("la configuración bloquea fechas inválidas y ausencia de días con razones distintas", () => {
  let state = createState();
  state = reduce(state, { type: "set_end_date", value: state.draft.startDate });
  assert.equal(getTrainingCycleDraftValidation(state.draft).datesValid, false);
  for (const day of [...state.draft.selectedDays]) {
    state = reduce(state, { type: "toggle_day", day });
  }
  const validation = getTrainingCycleDraftValidation(state.draft);
  assert.equal(validation.hasDays, false);
  assert.equal(validation.canActivate, false);
});

test("crear rutina propia parte vacío mientras duplicar conserva la fuente", () => {
  const initial = createState();
  const manual = reduce(initial, { type: "choose_origin", origin: "manual", screen: "setup" });
  assert.equal(manual.draft.routines.monday.exercises.length, 0);
  assert.equal(manual.draft.routines.monday.name, "");
  assert.equal(getTrainingCycleDraftValidation(manual.draft).canSave, true);
  assert.equal(getTrainingCycleDraftValidation(manual.draft).hasExercises, false);
  assert.equal(getTrainingCycleDraftValidation(manual.draft).canActivate, false);
  const duplicate = reduce(manual, { type: "choose_origin", origin: "duplicate", screen: "duplicate" });
  assert.ok(duplicate.draft.routines.monday.exercises.length > 0);
  assert.equal(duplicate.draft.routines.monday.name, "Empuje");
});

test("un ejercicio nunca baja de una serie y las cinco técnicas permanecen editables", () => {
  let state = reduce(createState(), { type: "open_exercise", exerciseId: "press-flat" });
  for (let index = 0; index < 8; index += 1) {
    state = reduce(state, { type: "change_set_count", delta: -1 });
  }
  assert.equal(state.draft.routines.monday.exercises[0].sets.length, 1);

  for (const technique of [
    "linear",
    "ascending",
    "descending",
    "drop_set",
    "failure",
  ] as const) {
    state = reduce(state, { type: "set_technique", technique });
    assert.equal(state.draft.routines.monday.exercises[0].technique, technique);
  }
  const configured = state.draft.routines.monday.exercises[0];
  assert.equal(configured.sets.at(-1)?.toFailure, true);

  state = reduce(state, { type: "set_technique", technique: "drop_set" });
  assert.equal(state.draft.routines.monday.exercises[0].sets.at(-1)?.drops.length, 1);
  assert.equal(state.draft.routines.monday.exercises[0].sets.at(-1)?.toFailure, true);
});

test("editar el primer kg recalcula ambas pirámides de inmediato y guarda el snapshot actualizado", () => {
  for (const technique of ["ascending", "descending"] as const) {
    let state = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_exercise_mode", mode: "per_set" },
      { type: "set_technique", technique },
    );
    const before = state;
    const otherExercise = before.draft.routines.monday.exercises[1];
    const otherDay = before.draft.routines.wednesday;
    state = reduce(state,
      { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "200" },
    );
    const exercise = state.draft.routines.monday.exercises[0];
    const expected = technique === "ascending" ? [200, 220, 240, 260] : [200, 180, 160, 140];
    assert.deepEqual(exercise.sets.map((set) => Number(set.targetKg)), expected);
    assert.equal(state.revision, before.revision + 1, "un gesto genera una sola revisión de autoguardado");
    assert.equal(exercise.technique, technique);
    assert.equal(exercise.recommendationDecision, "modified");
    assert.equal(state.draft.routines.monday.exercises[1], otherExercise);
    assert.equal(state.draft.routines.wednesday, otherDay);
    assert.deepEqual(buildTrainingCycleSaveDraftInput(state.draft, state.origin)
      .days[0].exercises[0].sets.map((set) => set.targetKg), expected);
    assert.notDeepEqual(before.draft.routines.monday.exercises[0].sets.map((set) => Number(set.targetKg)), expected);
  }
});

test("teclear y volver a cambiar la referencia no acumula porcentajes", () => {
  let state = reduce(createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "ascending" },
  );
  for (const value of ["2", "20", "200", "100,5", "200", "200", "0"]) {
    state = reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value });
    const kg = state.draft.routines.monday.exercises[0].sets.map((set) => set.targetKg);
    if (value === "100,5") assert.deepEqual(kg, ["100,5", "110.5", "120.5", "130.5"]);
    if (value === "200") assert.deepEqual(kg, ["200", "220", "240", "260"]);
    if (value === "0") assert.deepEqual(kg, ["0", "0", "0", "0"]);
  }
});

test("la carga lineal y al fallo sigue la primera serie sin alterar reps ni marcas", () => {
  for (const technique of ["linear", "failure"] as const) {
    let state = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_technique", technique },
      { type: "edit_set", setId: "press-flat-set-2", field: "targetReps", value: "17" },
      { type: "toggle_set_failure", setId: "press-flat-set-3" },
    );
    const previous = state.draft.routines.monday.exercises[0];
    state = reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "44,5" });
    const exercise = state.draft.routines.monday.exercises[0];
    assert.deepEqual(exercise.sets.map((set) => set.targetKg), ["44,5", "44.5", "44.5", "44.5"]);
    assert.deepEqual(exercise.sets.map((set) => set.targetReps), previous.sets.map((set) => set.targetReps));
    assert.deepEqual(exercise.sets.map((set) => set.toFailure), previous.sets.map((set) => set.toFailure));
  }
});

test("entradas incompletas o fuera de límites no propagan cargas inventadas", () => {
  for (const value of ["", " ", ",", "-2", "NaN", "Infinity", "0x20", "1e2", "100000", "2,3,4"]) {
    const before = reduce(createState(),
      { type: "open_exercise", exerciseId: "press-flat" },
      { type: "set_technique", technique: "ascending" },
    );
    let state = reduce(before, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value });
    const sets = state.draft.routines.monday.exercises[0].sets;
    assert.equal(sets[0].targetKg, value, "no secuestrar la edición de la casilla");
    assert.deepEqual(sets.slice(1), before.draft.routines.monday.exercises[0].sets.slice(1));
    state = reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "200" });
    assert.deepEqual(state.draft.routines.monday.exercises[0].sets.map((set) => set.targetKg), ["200", "220", "240", "260"]);
  }
});

test("editar una serie posterior sigue siendo individual; reps y descensos no se reescriben", () => {
  let state = reduce(createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "ascending" },
  );
  const original = state.draft.routines.monday.exercises[0];
  state = reduce(state, { type: "edit_set", setId: "press-flat-set-2", field: "targetKg", value: "108.5" });
  const individuallyEdited = state.draft.routines.monday.exercises[0];
  assert.equal(individuallyEdited.sets[1].targetKg, "108.5");
  for (const index of [0, 2, 3]) assert.equal(individuallyEdited.sets[index], original.sets[index]);
  state = reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value: "13" });
  assert.deepEqual(state.draft.routines.monday.exercises[0].sets.slice(1), individuallyEdited.sets.slice(1));
  state = reduce(state, { type: "set_technique", technique: "drop_set" });
  const dropExercise = state.draft.routines.monday.exercises[0];
  state = reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "200" });
  const after = state.draft.routines.monday.exercises[0];
  assert.deepEqual(after.sets.slice(1), dropExercise.sets.slice(1));
  assert.deepEqual(after.sets.map((set) => set.drops), dropExercise.sets.map((set) => set.drops));
});

test("recálculo conserva ignorar sugerencia y respeta el límite al generar pesos", () => {
  let state = reduce(createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "ascending" },
    { type: "ignore_recommendation" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "99999.99" },
  );
  const exercise = state.draft.routines.monday.exercises[0];
  assert.equal(exercise.recommendationDecision, "ignored");
  assert.ok(exercise.sets.every((set) => Number(set.targetKg) <= DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxTargetKg));
  assert.equal(reduce(state, { type: "edit_set", setId: "missing", field: "targetKg", value: "200" }), state);
  state = reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "200" });
  assert.equal(reduce(state, { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "200" }), state);
});

test("alternar pirámides conserva la primera serie y nunca multiplica los valores", () => {
  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_exercise_mode", mode: "per_set" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "100" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value: "12" },
  );

  for (let attempt = 0; attempt < 8; attempt += 1) {
    state = reduce(state, { type: "set_technique", technique: "ascending" });
    let sets = state.draft.routines.monday.exercises[0].sets;
    assert.deepEqual(sets.map((set) => set.targetKg), ["100", "110", "120", "130"]);
    assert.deepEqual(sets.map((set) => set.targetReps), ["12", "10", "8", "6"]);

    state = reduce(state, { type: "set_technique", technique: "descending" });
    sets = state.draft.routines.monday.exercises[0].sets;
    assert.deepEqual(sets.map((set) => set.targetKg), ["100", "90", "80", "70"]);
    assert.deepEqual(sets.map((set) => set.targetReps), ["12", "14", "16", "18"]);
  }
});

test("reducer y dominio comparten incrementos de 0,5 kg para ambas pirámides", () => {
  const domainSource = createFixtureExercise({
    sets: Array.from({ length: 4 }, (_, index) => createFixtureSet({
      id: `parity-${index + 1}`,
      order: index + 1,
      targetKg: index === 0 ? 44 : 999,
      targetReps: index === 0 ? 10 : 99,
    })),
  });
  const domainAscending = applyTechniqueToExercise(domainSource, "ascending");
  assert.equal(domainAscending.ok, true);
  if (!domainAscending.ok) return;

  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "44" },
    { type: "set_technique", technique: "ascending" },
  );
  let visibleSets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(visibleSets.map((set) => Number(set.targetKg)),
    domainAscending.exercise.sets.map((set) => set.targetKg));
  assert.deepEqual(visibleSets.map((set) => set.targetKg), ["44", "48.5", "53", "57"]);

  const domainDescending = applyTechniqueToExercise(domainAscending.exercise, "descending");
  assert.equal(domainDescending.ok, true);
  if (!domainDescending.ok) return;
  state = reduce(state, { type: "set_technique", technique: "descending" });
  visibleSets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(visibleSets.map((set) => Number(set.targetKg)),
    domainDescending.exercise.sets.map((set) => set.targetKg));
  assert.deepEqual(visibleSets.map((set) => set.targetKg), ["44", "39.5", "35", "31"]);
});

test("la coma decimal es referencia piramidal estable y llega normalizada al payload", () => {
  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "100,5" },
    { type: "set_technique", technique: "ascending" },
  );
  let sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.targetKg), ["100,5", "110.5", "120.5", "130.5"]);
  assert.equal(getTrainingCycleDraftValidation(state.draft).canActivate, true);
  assert.equal(
    buildTrainingCycleSaveDraftInput(state.draft, "duplicate").days[0].exercises[0].sets[0].targetKg,
    100.5,
  );

  state = reduce(state, { type: "set_technique", technique: "descending" });
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.targetKg), ["100,5", "90.5", "80.5", "70.5"]);
  state = reduce(state, { type: "set_technique", technique: "ascending" });
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.targetKg), ["100,5", "110.5", "120.5", "130.5"]);
});

test("las series nuevas reciben referencia piramidal sin pisar ediciones existentes", () => {
  const ascendingState = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "100" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value: "12" },
    { type: "set_technique", technique: "ascending" },
    { type: "edit_set", setId: "press-flat-set-2", field: "targetKg", value: "108.5" },
    { type: "add_set" },
  );
  let sets = ascendingState.draft.routines.monday.exercises[0].sets;
  assert.equal(sets[1]?.targetKg, "108.5");
  assert.equal(sets.at(-1)?.targetKg, "140");
  assert.equal(sets.at(-1)?.targetReps, "4");

  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "100" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value: "12" },
    { type: "set_technique", technique: "descending" },
    { type: "edit_set", setId: "press-flat-set-2", field: "targetKg", value: "88.5" },
    { type: "add_set" },
  );
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.equal(sets[1]?.targetKg, "88.5");
  assert.deepEqual(sets.at(-1), {
    id: "set-1",
    targetKg: "60",
    targetReps: "20",
    toFailure: false,
    drops: [],
  });

  state = reduce(state, { type: "change_set_count", delta: 1 });
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.equal(sets[1]?.targetKg, "88.5");
  assert.deepEqual(sets.at(-1), {
    id: "set-2",
    targetKg: "50",
    targetReps: "22",
    toFailure: false,
    drops: [],
  });
});

test("fallo mantiene el peso de referencia y drop set baja dentro de la misma serie", () => {
  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "100" },
    { type: "set_technique", technique: "failure" },
  );
  let sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.targetKg), ["100", "100", "100", "100"]);
  assert.deepEqual(sets.map((set) => set.toFailure), [true, true, true, true]);

  state = reduce(
    state,
    { type: "edit_set", setId: "press-flat-set-4", field: "targetKg", value: "70" },
    { type: "set_technique", technique: "drop_set" },
  );
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.equal(sets.length, 4, "el descenso no se convierte en una serie independiente");
  assert.deepEqual(sets[3]?.drops, [{
    id: "press-flat-set-4-drop-1",
    targetKg: "56",
    targetReps: "8",
    followsPreviousLoad: true,
  }]);
  assert.equal(sets[3]?.toFailure, true);

  state = reduce(state, { type: "add_drop", setId: "press-flat-set-4" });
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.equal(sets.length, 4);
  assert.deepEqual(sets[3]?.drops.map((drop) => drop.targetKg), ["56", "44.5"]);

  state = reduce(
    state,
    { type: "add_drop", setId: "press-flat-set-1" },
    { type: "toggle_set_failure", setId: "press-flat-set-1" },
    { type: "toggle_set_failure", setId: "press-flat-set-4" },
    { type: "set_technique", technique: "drop_set" },
  );
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.toFailure), [true, false, false, true]);
});

test("las sugerencias visibles respetan los máximos del payload", () => {
  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "99999.99" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetReps", value: "999" },
    { type: "set_technique", technique: "ascending" },
  );
  let sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.targetKg), ["99999.99", "99999.99", "99999.99", "99999.99"]);

  state = reduce(state, { type: "set_technique", technique: "descending" });
  sets = state.draft.routines.monday.exercises[0].sets;
  assert.deepEqual(sets.map((set) => set.targetReps), ["999", "1000", "1000", "1000"]);
});

test("el reducer aplica los mismos máximos de series y descensos del dominio", () => {
  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "drop_set" },
  );
  while (state.draft.routines.monday.exercises[0].sets.length
    < DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxSetsPerExercise) {
    state = reduce(state, { type: "add_set" });
  }
  state = reduce(state, { type: "add_set" });
  assert.equal(
    state.draft.routines.monday.exercises[0].sets.length,
    DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxSetsPerExercise,
  );

  const targetSetId = state.draft.routines.monday.exercises[0].sets[3]?.id ?? "";
  while ((state.draft.routines.monday.exercises[0].sets[3]?.drops.length ?? 0)
    < DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxDropsPerSet) {
    state = reduce(state, { type: "add_drop", setId: targetSetId });
  }
  state = reduce(state, { type: "add_drop", setId: targetSetId });
  assert.equal(
    state.draft.routines.monday.exercises[0].sets[3]?.drops.length,
    DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxDropsPerSet,
  );
  assert.equal(state.draft.routines.monday.exercises[0].sets[3]?.toFailure, true);

  const nextEntityNumber = state.nextEntityNumber;
  state = reduce(state, {
    type: "duplicate_set",
    setId: state.draft.routines.monday.exercises[0].sets[0]?.id ?? "",
  });
  assert.equal(state.draft.routines.monday.exercises[0].sets.length, 20);
  assert.equal(state.nextEntityNumber, nextEntityNumber, "un duplicado rechazado no consume IDs");
});

test("duplicar una serie conserva la técnica bajo el tope", () => {
  const state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "ascending" },
    { type: "duplicate_set", setId: "press-flat-set-2" },
  );
  const exercise = state.draft.routines.monday.exercises[0];
  assert.equal(exercise.technique, "ascending");
  assert.equal(exercise.sets.length, 5);
  assert.equal(exercise.sets[2]?.targetKg, exercise.sets[1]?.targetKg);
  assert.equal(state.nextEntityNumber, 2);
});

test("editar drops no descendentes conserva el buffer, bloquea guardado y eliminar el último limpia fallo", () => {
  let state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "drop_set" },
  );
  const setId = "press-flat-set-4";
  const firstDropId = state.draft.routines.monday.exercises[0].sets[3]?.drops[0]?.id ?? "";
  const beforeInvalidEdit = state;
  state = reduce(state, {
    type: "edit_drop",
    setId,
    dropId: firstDropId,
    field: "targetKg",
    value: "80",
  });
  assert.equal(state.draft.routines.monday.exercises[0].sets[3].drops[0].targetKg, "80");
  assert.equal(state.revision, beforeInvalidEdit.revision + 1);
  assert.equal(getTrainingCycleDraftValidation(state.draft).canSave, false);

  state = reduce(beforeInvalidEdit, { type: "add_drop", setId });
  const secondDropId = state.draft.routines.monday.exercises[0].sets[3]?.drops[1]?.id ?? "";
  const beforeAscendingEdit = state;
  state = reduce(state, {
    type: "edit_drop",
    setId,
    dropId: secondDropId,
    field: "targetKg",
    value: "70",
  });
  assert.equal(state.draft.routines.monday.exercises[0].sets[3].drops[1].targetKg, "70");
  assert.equal(state.revision, beforeAscendingEdit.revision + 1);
  assert.equal(getTrainingCycleDraftValidation(state.draft).canSave, false);

  state = reduce(
    state,
    { type: "remove_drop", setId, dropId: secondDropId },
    { type: "remove_drop", setId, dropId: firstDropId },
  );
  assert.equal(state.draft.routines.monday.exercises[0].sets[3]?.drops.length, 0);
  assert.equal(state.draft.routines.monday.exercises[0].sets[3]?.toFailure, false);
});

test("drop set con carga cero falla cerrado sin introducir 0→0", () => {
  const state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-4", field: "targetKg", value: "0" },
  );
  const rejected = reduce(state, { type: "set_technique", technique: "drop_set" });
  assert.equal(rejected, state);
  assert.equal(rejected.draft.routines.monday.exercises[0].technique, "linear");
  assert.equal(rejected.draft.routines.monday.exercises[0].sets[3]?.drops.length, 0);
});

test("validación visible rechaza drops iguales o ascendentes", () => {
  const state = reduce(
    createState(),
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "set_technique", technique: "drop_set" },
  );
  const set = state.draft.routines.monday.exercises[0].sets[3];
  const invalidDraft = {
    ...state.draft,
    routines: {
      ...state.draft.routines,
      monday: {
        ...state.draft.routines.monday,
        exercises: state.draft.routines.monday.exercises.map((exercise) => exercise.id === "press-flat"
          ? {
              ...exercise,
              sets: exercise.sets.map((candidate) => candidate.id === set?.id
                ? {
                    ...candidate,
                    drops: [
                      { id: "invalid-1", targetKg: candidate.targetKg, targetReps: "8" },
                      { id: "invalid-2", targetKg: "999", targetReps: "8" },
                    ],
                  }
                : candidate),
            }
          : exercise),
      },
    },
  };
  assert.equal(getTrainingCycleDraftValidation(invalidDraft).seriesValid, false);
});

test("las recomendaciones se pueden aceptar, modificar e ignorar sin aplicar solas", () => {
  let state = reduce(createState(), { type: "open_exercise", exerciseId: "press-flat" });
  assert.equal(state.draft.routines.monday.exercises[0].recommendationDecision, "idle");
  assert.equal(state.draft.routines.monday.exercises[0].sets[0].targetKg, "80");

  state = reduce(state, { type: "accept_recommendation" });
  assert.equal(state.draft.routines.monday.exercises[0].recommendationDecision, "accepted");
  assert.equal(state.draft.routines.monday.exercises[0].sets[0].targetKg, "84");

  state = reduce(state, { type: "modify_recommendation" });
  assert.equal(state.draft.routines.monday.exercises[0].recommendationDecision, "modified");
  assert.equal(state.exerciseMode, "per_set");

  state = reduce(state, { type: "ignore_recommendation" });
  assert.equal(state.draft.routines.monday.exercises[0].recommendationDecision, "ignored");
});

test("el video del catálogo llega al payload y borrarlo no lo restaura", () => {
  const recommendation = createState().draft.routines.monday.exercises[0].recommendation;
  let state = reduce(createState(), {
    type: "add_catalog_exercise",
    source: { kind: "catalog", id: "video-catalog" },
    name: "Remo con video",
    muscleGroup: "Dorsal",
    videoUrl: "https://youtu.be/AbCdEfGhI_1?si=tracking",
    recommendation,
  });
  const added = state.draft.routines.monday.exercises.find((exercise) => exercise.source.id === "video-catalog");
  assert.ok(added);
  const canonical = "https://www.youtube.com/watch?v=AbCdEfGhI_1";
  assert.equal(added.videoUrl, canonical);
  assert.equal(buildTrainingCycleSaveDraftInput(state.draft, "manual").days[0].exercises
    .find((exercise) => exercise.source.id === "video-catalog")?.videoUrl, canonical);
  state = reduce(state, { type: "open_exercise", exerciseId: added.id }, { type: "set_video_url", value: "" });
  assert.equal(buildTrainingCycleSaveDraftInput(state.draft, "manual").days[0].exercises
    .find((exercise) => exercise.source.id === "video-catalog")?.videoUrl, null);
});

test("catálogo, personalizado y copia de día mantienen el estado dentro de la feature", () => {
  const recommendation = createTrainingCycleBuilderTestViewModel().catalog[0].recommendation;
  assert.ok(recommendation);
  let state = reduce(
    createState(),
    {
      type: "add_catalog_exercise",
      source: { kind: "catalog", id: "new-catalog" },
      name: "Remo de prueba",
      muscleGroup: "Dorsal",
      recommendation,
    },
    { type: "set_custom_name", value: "Ejercicio propio" },
    { type: "set_custom_muscle", value: "Abdomen" },
    { type: "custom_exercise_started" },
    {
      type: "custom_exercise_succeeded",
      source: { kind: "custom", id: "custom-id" },
      name: "Ejercicio propio",
      muscleGroup: "Abdomen",
      videoUrl: "",
      recommendation: {
        hasHistory: false,
        title: "Sin historial",
        body: "Carga editable",
        source: "Inicio conservador",
      },
    },
  );
  assert.equal(state.draft.routines.monday.exercises.at(-2)?.name, "Remo de prueba");
  assert.deepEqual(state.draft.routines.monday.exercises.at(-1)?.source, { kind: "custom", id: "custom-id" });

  state = reduce(
    state,
    { type: "select_day", day: "thursday" },
    { type: "open_copy", mode: "day" },
    { type: "copy_from_day", sourceDay: "tuesday" },
  );
  assert.equal(state.draft.routines.thursday.name, state.draft.routines.tuesday.name);
  assert.equal(state.draft.routines.thursday.exercises.length, state.draft.routines.tuesday.exercises.length);
});

test("las métricas distinguen series, repeticiones y volumen e incluyen drops", () => {
  let state = reduce(createState(), { type: "open_exercise", exerciseId: "press-flat" });
  const before = getTrainingCycleMetrics(state.draft);
  state = reduce(
    state,
    { type: "set_technique", technique: "drop_set" },
  );
  const after = getTrainingCycleMetrics(state.draft);
  assert.equal(after.sets, before.sets);
  assert.ok(after.repetitions > before.repetitions);
  assert.ok(after.volumeKg > before.volumeKg);
});

test("la extensión sólo acepta fechas posteriores a hoy y al término actual", () => {
  assert.equal(getExtensionValidation("2026-10-13", "2026-10-11", "2026-10-11").valid, false);
  assert.equal(getExtensionValidation("2026-10-13", "2026-10-13", "2026-10-11").valid, false);
  const valid = getExtensionValidation("2026-10-13", "2026-10-27", "2026-10-11");
  assert.equal(valid.valid, true);
  if (valid.valid) assert.equal(valid.addedDays, 14);

  const active = reduce(createState(), { type: "show_active" });
  const rejected = reduce(active, {
    type: "extension_succeeded",
    endDate: active.draft.endDate,
    revision: "revision-local-2",
  });
  assert.equal(rejected.draft.endDate, active.draft.endDate);
  assert.equal(rejected.extensionState, "error");
});

test("el ciclo activo permite editar plan con fechas inmutables y allowlist optimista", () => {
  let state = reduce(
    createState(),
    { type: "navigate", screen: "review" },
    { type: "activation_succeeded", cycleId: "cycle-1", revision: "revision-1" },
    { type: "show_active" },
    { type: "begin_active_edit" },
  );
  assert.equal(state.screen, "setup");
  assert.equal(state.workflow, "active_edit");
  assert.equal(state.activeCycleId, "cycle-1");
  const originalStart = state.draft.startDate;
  const originalEnd = state.draft.endDate;
  state = reduce(
    state,
    { type: "set_start_date", value: "2026-01-01" },
    { type: "set_end_date", value: "2026-01-02" },
    { type: "set_goal", goal: "strength" },
    { type: "toggle_day", day: "sunday" },
    { type: "select_day", day: "monday" },
    { type: "set_routine_name", value: "Empuje activo" },
    { type: "open_exercise", exerciseId: "press-flat" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "82.5" },
  );
  assert.equal(state.draft.startDate, originalStart);
  assert.equal(state.draft.endDate, originalEnd);
  assert.equal(state.draft.goal, "strength");
  assert.equal(state.draft.selectedDays.includes("sunday"), true);
  assert.equal(state.draft.routines.monday.name, "Empuje activo");
  assert.equal(state.draft.routines.monday.exercises[0].sets[0].targetKg, "82.5");

  const payload = buildTrainingCycleSaveActiveInput(
    state.draft,
    state.activeCycleId ?? "",
    state.activeCycleRevision ?? "",
  );
  assert.equal(payload.goal, "strength");
  assert.equal(payload.days[0].name, "Empuje activo");
  assert.equal(payload.days[0].exercises[0].sets[0].targetKg, 82.5);
  assert.deepEqual(Object.keys(payload).sort(), ["cycleId", "days", "expectedRevision", "goal"]);
});

test("el plan activo no muta fuera del flujo explícito de edición", () => {
  const active = reduce(createState(), { type: "show_active" });
  const unchanged = reduce(
    active,
    { type: "set_goal", goal: "strength" },
    { type: "set_routine_name", value: "Mutación fuera del editor" },
    { type: "edit_set", setId: "press-flat-set-1", field: "targetKg", value: "999" },
  );
  assert.equal(unchanged, active);
});

test("editar el ciclo activo nunca abre ni ejecuta el reemplazo", () => {
  const active = reduce(createState(), { type: "show_active" });
  const editing = reduce(active, { type: "begin_active_edit" });

  assert.equal(editing.workflow, "active_edit");
  assert.equal(editing.screen, "setup");
  assert.equal(editing.activeCycleId, active.activeCycleId);
  assert.equal(editing.pendingNewCycleIntent, null);
  assert.equal(editing.activeCycleCloseId, null);
  assert.equal(editing.activeCycleCloseState, "idle");
});

test("rechazar el reemplazo conserva el ciclo activo sin entrar al constructor", () => {
  const active = reduce(createState(), { type: "show_active" });
  const confirmation = reduce(active, {
    type: "active_cycle_close_confirmation_required",
    cycleId: "40000000-0000-4000-8000-000000000002",
    origin: "duplicate",
    screen: "duplicate",
  });
  const cancelled = reduce(confirmation, { type: "cancel_active_cycle_close" });

  assert.equal(cancelled.workflow, "active");
  assert.equal(cancelled.screen, "active");
  assert.equal(cancelled.activeCycleId, active.activeCycleId);
  assert.equal(cancelled.activeCycleRevision, active.activeCycleRevision);
  assert.equal(cancelled.pendingNewCycleIntent, null);
  assert.equal(cancelled.activeCycleCloseId, null);
  assert.equal(cancelled.revision, active.revision);
});

test("confirmar el cierre entra al duplicado editable sólo después del éxito", () => {
  const active = reduce(createState(), { type: "show_active" });
  const confirmation = reduce(active, {
    type: "active_cycle_close_confirmation_required",
    cycleId: "40000000-0000-4000-8000-000000000002",
    origin: "duplicate",
    screen: "duplicate",
  });
  const closing = reduce(confirmation, { type: "active_cycle_close_started" });
  assert.equal(closing.screen, "active");
  assert.equal(closing.workflow, "active");
  assert.equal(closing.activeCycleCloseState, "closing");
  assert.equal(reduce(closing, { type: "active_cycle_close_started" }), closing);

  const committedDraft = { ...closing.draft, draftId: "30000000-0000-4000-8000-000000000099" };
  const duplicate = reduce(closing, { type: "active_cycle_close_succeeded", draft: committedDraft });
  assert.equal(duplicate.workflow, "draft");
  assert.equal(duplicate.origin, "duplicate");
  assert.equal(duplicate.screen, "duplicate");
  assert.equal(duplicate.activeCycleId, null);
  assert.equal(duplicate.activeCycleRevision, null);
  assert.equal(duplicate.pendingNewCycleIntent, null);
  assert.equal(duplicate.activeCycleCloseId, null);
  assert.equal(duplicate.draft, committedDraft);
  assert.equal(duplicate.sourceDraft, committedDraft);
});

test("un error de cierre mantiene el activo y permite reintentar la misma confirmación", () => {
  const active = reduce(createState(), { type: "show_active" });
  const failed = reduce(
    active,
    {
      type: "active_cycle_close_confirmation_required",
      cycleId: "40000000-0000-4000-8000-000000000002",
      origin: "duplicate",
      screen: "duplicate",
    },
    { type: "active_cycle_close_started" },
    { type: "active_cycle_close_failed", message: "El ciclo sigue activo" },
  );

  assert.equal(failed.workflow, "active");
  assert.equal(failed.screen, "active");
  assert.equal(failed.activeCycleId, active.activeCycleId);
  assert.equal(failed.activeCycleCloseState, "error");
  assert.deepEqual(failed.pendingNewCycleIntent, {
    origin: "duplicate",
    screen: "duplicate",
  });
});

test("la edición activa no sobrescribe conflictos y sólo cierra con una nueva revisión", () => {
  let state = reduce(
    createState(),
    { type: "show_active" },
    { type: "begin_active_edit" },
    { type: "navigate", screen: "review" },
    { type: "active_edit_started" },
    { type: "active_edit_failed", conflict: true, message: "Revisión desactualizada" },
  );
  assert.equal(state.screen, "review");
  assert.equal(state.workflow, "active_edit");
  assert.equal(state.activeEditState, "conflict");
  assert.equal(state.activeCycleRevision, "revision-local-1");

  state = reduce(state, {
    type: "active_edit_succeeded",
    revision: "revision-local-2",
    savedAtLabel: "Cambios guardados",
  });
  assert.equal(state.screen, "active");
  assert.equal(state.workflow, "active");
  assert.equal(state.activeCycleRevision, "revision-local-2");
});

test("la sugerencia usa sólo objetivo, días y fechas y entrega un draft editable", () => {
  let state = reduce(
    createState(),
    { type: "choose_origin", origin: "suggested", screen: "setup" },
    { type: "set_goal", goal: "definition" },
    { type: "toggle_day", day: "tuesday" },
  );
  assert.equal(state.draft.routines.monday.exercises.length, 0);
  const input = buildTrainingCycleSuggestedDraftInput(state.draft);
  assert.deepEqual(Object.keys(input).sort(), ["durationDays", "endDate", "goal", "selectedDays", "startDate"]);
  assert.equal(input.durationDays, 42);
  const generated = generateTrainingCycleSuggestionForTest(input);
  const untrustedResult = {
    ...generated,
    draftId: "gateway-must-not-replace-draft-id",
    goal: "strength" as const,
    startDate: "2030-01-01",
    endDate: "2030-01-02",
    selectedDays: ["sunday" as const],
  };
  state = reduce(
    state,
    { type: "suggestion_started" },
    { type: "suggestion_succeeded", draft: untrustedResult },
  );
  assert.equal(state.suggestionState, "idle");
  assert.equal(state.screen, "routine");
  assert.equal(state.draft.draftId, "cycle-draft-local");
  assert.equal(state.draft.goal, input.goal);
  assert.equal(state.draft.startDate, input.startDate);
  assert.equal(state.draft.endDate, input.endDate);
  assert.deepEqual(state.draft.selectedDays, input.selectedDays);
  assert.ok(state.draft.routines[state.currentDay].exercises.length > 0);

  state = reduce(state, { type: "set_routine_name", value: "Propuesta modificada" });
  assert.equal(state.draft.routines[state.currentDay].name, "Propuesta modificada");
});

test("la sugerencia expone estados loading y error sin reutilizar la rutina fuente", () => {
  let state = reduce(createState(), { type: "choose_origin", origin: "suggested", screen: "setup" });
  assert.equal(state.draft.routines.monday.exercises.length, 0);
  state = reduce(state, { type: "suggestion_started" });
  assert.equal(state.suggestionState, "loading");
  state = reduce(state, { type: "suggestion_failed", message: "Sin conexión" });
  assert.equal(state.suggestionState, "error");
  assert.equal(state.suggestionErrorMessage, "Sin conexión");
  assert.equal(state.screen, "setup");
});

test("la activación resuelve a éxito y conserva un identificador idempotente externo", () => {
  const state = reduce(
    createState(),
    { type: "activation_started" },
    { type: "activation_started" },
    { type: "activation_succeeded", cycleId: "cycle-1", revision: "revision-1" },
  );
  assert.equal(state.screen, "success");
  assert.equal(state.activeCycleId, "cycle-1");
  assert.equal(state.activationState, "idle");
  assert.equal(state.activeCycleRevision, "revision-1");
});

test("descartar limpia el sourceDraft y el flujo manual parte con un ID local nuevo", () => {
  const initial = createState();
  const discardedDraft = createTrainingCycleDraftAfterDiscard(
    initial.draft,
    "local:fresh-after-discard",
  );
  const discarded = reduce(
    initial,
    { type: "discard_started" },
    { type: "discard_complete", draft: discardedDraft },
  );
  assert.equal(discarded.sourceDraft.draftId, "local:fresh-after-discard");
  assert.equal(discarded.draft.draftId, "local:fresh-after-discard");
  assert.deepEqual(discarded.sourceDraft.selectedDays, []);
  assert.equal(discarded.sourceDraft.routines.monday.exercises.length, 0);

  const manual = reduce(discarded, {
    type: "choose_origin",
    origin: "manual",
    screen: "setup",
  });
  assert.equal(manual.draft.draftId, "local:fresh-after-discard");
  assert.notEqual(manual.draft.draftId, initial.draft.draftId);
});
