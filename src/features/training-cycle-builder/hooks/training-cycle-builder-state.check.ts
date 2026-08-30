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
