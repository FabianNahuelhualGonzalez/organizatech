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

function createState() {
  return createTrainingCycleBuilderState(createTrainingCycleBuilderTestViewModel());
}

function reduce(
  state: TrainingCycleBuilderState,
  ...actions: readonly TrainingCycleBuilderAction[]
) {
  return actions.reduce(trainingCycleBuilderReducer, state);
}

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

test("editar o agregar drops fail-closed y eliminar el último limpia fallo", () => {
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
  assert.equal(state, beforeInvalidEdit);

  state = reduce(state, { type: "add_drop", setId });
  const secondDropId = state.draft.routines.monday.exercises[0].sets[3]?.drops[1]?.id ?? "";
  const beforeAscendingEdit = state;
  state = reduce(state, {
    type: "edit_drop",
    setId,
    dropId: secondDropId,
    field: "targetKg",
    value: "70",
  });
  assert.equal(state, beforeAscendingEdit);

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
