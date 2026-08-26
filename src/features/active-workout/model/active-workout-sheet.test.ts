import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveWorkoutGoalsPresentation,
  buildActiveWorkoutSheetGoals,
  canSaveActiveWorkoutDrafts,
  closeActiveWorkoutSheet,
  createActiveWorkoutRegistrationCommit,
  createActiveWorkoutSheetScopeKey,
  createActiveWorkoutSheetState,
  getActiveWorkoutSeriesColumns,
  getActiveWorkoutSeriesLayout,
  getActiveWorkoutSeriesRows,
  invokeActiveWorkoutHistoryRetry,
  isActiveWorkoutDraftReadyToRegister,
  isActiveWorkoutRegistrationComplete,
  openActiveWorkoutSheet,
  reconcileActiveWorkoutSheet,
  resolveActiveWorkoutRovingExerciseId,
  toggleActiveWorkoutSheetPanel,
  validateActiveWorkoutExerciseDraft,
} from "@/features/active-workout/model/active-workout-sheet";
import type { ExerciseTemplate } from "@/lib/progress/types";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";
import { resolveCurrentExerciseRegistration } from "@/lib/training/workout-registration";

const sheetExercise: ExerciseTemplate = {
  id: "exercise-a",
  routine: "Piernas",
  name: "Sentadilla libre",
  targetSets: 3,
  targetReps: 10,
  baseWeight: 100,
};

const secondExercise: ExerciseTemplate = {
  ...sheetExercise,
  id: "exercise-b",
  name: "Peso muerto rumano",
};

function sheetDraft(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    weight: "",
    rir: "",
    reps: ["", "", ""],
    registered: false,
    observation: "",
    ...overrides,
  };
}

function scopeKey(overrides: {
  day?: string;
  routine?: string;
  exercises?: readonly ExerciseTemplate[];
} = {}) {
  return createActiveWorkoutSheetScopeKey({
    day: overrides.day ?? "Lunes",
    routine: overrides.routine ?? "Piernas",
    exercises: overrides.exercises ?? [sheetExercise, secondExercise],
  });
}

test("distribuye exactamente las series 1..10 sin superar cinco columnas", () => {
  const expected = [
    { columns: 1, rows: 1, distribution: [1] },
    { columns: 2, rows: 1, distribution: [2] },
    { columns: 3, rows: 1, distribution: [3] },
    { columns: 4, rows: 1, distribution: [4] },
    { columns: 5, rows: 1, distribution: [5] },
    { columns: 3, rows: 2, distribution: [3, 3] },
    { columns: 4, rows: 2, distribution: [4, 3] },
    { columns: 4, rows: 2, distribution: [4, 4] },
    { columns: 5, rows: 2, distribution: [5, 4] },
    { columns: 5, rows: 2, distribution: [5, 5] },
  ];

  expected.forEach((layout, index) => {
    const targetSets = index + 1;
    const result = getActiveWorkoutSeriesLayout(targetSets);
    assert.deepEqual(result, { targetSets, ...layout });
    assert.ok(result.columns <= 5);
    assert.equal(getActiveWorkoutSeriesColumns(targetSets), layout.columns);
    assert.equal(getActiveWorkoutSeriesRows(targetSets), layout.rows);
    assert.equal(result.distribution.reduce((total, value) => total + value, 0), targetSets);
  });
});

test("mantiene máximo cinco columnas fuera del rango visual y rechaza cantidades inválidas", () => {
  assert.deepEqual(getActiveWorkoutSeriesLayout(11), {
    targetSets: 11,
    columns: 5,
    rows: 3,
    distribution: [5, 5, 1],
  });

  for (const targetSets of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => getActiveWorkoutSeriesLayout(targetSets), RangeError);
  }
});

test("open/close conserva opener y scope por identidad, y reinicia paneles", () => {
  const currentScope = scopeKey();
  const initial = createActiveWorkoutSheetState();
  const opened = openActiveWorkoutSheet(initial, sheetExercise.id, currentScope);
  const withHistory = toggleActiveWorkoutSheetPanel(opened, "history");
  const closed = closeActiveWorkoutSheet(withHistory);

  assert.deepEqual(initial, {
    openExerciseId: null,
    openerExerciseId: null,
    openScopeKey: null,
    expandedPanel: null,
  });
  assert.deepEqual(closed, {
    openExerciseId: null,
    openerExerciseId: sheetExercise.id,
    openScopeKey: null,
    expandedPanel: null,
  });

  const reopened = openActiveWorkoutSheet(closed, secondExercise.id, currentScope);
  assert.deepEqual(reopened, {
    openExerciseId: secondExercise.id,
    openerExerciseId: secondExercise.id,
    openScopeKey: currentScope,
    expandedPanel: null,
  });
  assert.throws(() => openActiveWorkoutSheet(reopened, "", currentScope), TypeError);
  assert.throws(() => openActiveWorkoutSheet(reopened, sheetExercise.id, ""), TypeError);
});

test("cambiar de día produce otro scope y reconcilia la hoja sin dejar inert huérfano", () => {
  const mondayScope = scopeKey({ day: "Lunes" });
  const tuesdayScope = scopeKey({ day: "Martes" });
  assert.notEqual(mondayScope, tuesdayScope);

  const opened = openActiveWorkoutSheet(
    createActiveWorkoutSheetState(),
    sheetExercise.id,
    mondayScope,
  );
  const reconciliation = reconcileActiveWorkoutSheet(opened, {
    scopeKey: tuesdayScope,
    exerciseIds: [sheetExercise.id, secondExercise.id],
    selectedExerciseId: sheetExercise.id,
  });

  assert.equal(reconciliation.didClose, true);
  assert.equal(reconciliation.state.openExerciseId, null);
  assert.equal(reconciliation.state.openScopeKey, null);
  assert.equal(reconciliation.focusExerciseId, sheetExercise.id);
});

test("un cambio explícito de scope cierra aunque el ejercicio siga seleccionado", () => {
  const opened = openActiveWorkoutSheet(
    createActiveWorkoutSheetState(),
    sheetExercise.id,
    "authenticated:user-a:epoch-7",
  );
  const reconciliation = reconcileActiveWorkoutSheet(opened, {
    scopeKey: "authenticated:user-b:epoch-8",
    exerciseIds: [sheetExercise.id],
    selectedExerciseId: sheetExercise.id,
  });

  assert.deepEqual(reconciliation, {
    state: {
      openExerciseId: null,
      openerExerciseId: sheetExercise.id,
      openScopeKey: null,
      expandedPanel: null,
    },
    focusExerciseId: sheetExercise.id,
    didClose: true,
  });
});

test("un lifecycle de identidad/sesión nuevo no reutiliza una hoja abierta del lifecycle anterior", () => {
  const previousLifecycle = openActiveWorkoutSheet(
    createActiveWorkoutSheetState(),
    sheetExercise.id,
    scopeKey(),
  );
  const nextLifecycle = createActiveWorkoutSheetState();

  assert.equal(previousLifecycle.openExerciseId, sheetExercise.id);
  assert.deepEqual(nextLifecycle, {
    openExerciseId: null,
    openerExerciseId: null,
    openScopeKey: null,
    expandedPanel: null,
  });
});

test("desaparición o cambio de selección reconcilian y sólo restauran foco si el opener existe", () => {
  const currentScope = scopeKey();
  const opened = openActiveWorkoutSheet(
    createActiveWorkoutSheetState(),
    sheetExercise.id,
    currentScope,
  );

  const changedSelection = reconcileActiveWorkoutSheet(opened, {
    scopeKey: currentScope,
    exerciseIds: [sheetExercise.id, secondExercise.id],
    selectedExerciseId: secondExercise.id,
  });
  assert.equal(changedSelection.didClose, true);
  assert.equal(changedSelection.focusExerciseId, sheetExercise.id);

  const disappeared = reconcileActiveWorkoutSheet(opened, {
    scopeKey: currentScope,
    exerciseIds: [secondExercise.id],
    selectedExerciseId: secondExercise.id,
  });
  assert.equal(disappeared.didClose, true);
  assert.equal(disappeared.state.openExerciseId, null);
  assert.equal(disappeared.focusExerciseId, null);
});

test("reconcile conserva una hoja que aún pertenece al mismo scope y selección", () => {
  const currentScope = scopeKey();
  const opened = openActiveWorkoutSheet(
    toggleActiveWorkoutSheetPanel(
      openActiveWorkoutSheet(createActiveWorkoutSheetState(), sheetExercise.id, currentScope),
      "history",
    ),
    sheetExercise.id,
    currentScope,
  );
  const reconciliation = reconcileActiveWorkoutSheet(opened, {
    scopeKey: currentScope,
    exerciseIds: [sheetExercise.id, secondExercise.id],
    selectedExerciseId: sheetExercise.id,
  });

  assert.equal(reconciliation.didClose, false);
  assert.equal(reconciliation.focusExerciseId, null);
  assert.deepEqual(reconciliation.state, opened);
  assert.notEqual(reconciliation.state, opened, "la transición devuelve una copia sin mutar el estado");
});

test("roving resuelve flechas, Home y End sin seleccionar ni abrir ejercicios", () => {
  const exerciseIds = ["a", "b", "c"];
  assert.equal(resolveActiveWorkoutRovingExerciseId({
    key: "ArrowDown",
    currentExerciseId: "a",
    exerciseIds,
  }), "b");
  assert.equal(resolveActiveWorkoutRovingExerciseId({
    key: "ArrowUp",
    currentExerciseId: "c",
    exerciseIds,
  }), "b");
  assert.equal(resolveActiveWorkoutRovingExerciseId({
    key: "Home",
    currentExerciseId: "c",
    exerciseIds,
  }), "a");
  assert.equal(resolveActiveWorkoutRovingExerciseId({
    key: "End",
    currentExerciseId: "a",
    exerciseIds,
  }), "c");
  assert.equal(resolveActiveWorkoutRovingExerciseId({
    key: "Enter",
    currentExerciseId: "a",
    exerciseIds,
  }), null);
  assert.equal(resolveActiveWorkoutRovingExerciseId({
    key: "ArrowDown",
    currentExerciseId: null,
    exerciseIds: [],
  }), null);
});

test("history/comment son mutuamente excluyentes y toggle colapsa el activo", () => {
  const opened = openActiveWorkoutSheet(
    createActiveWorkoutSheetState(),
    sheetExercise.id,
    scopeKey(),
  );
  const history = toggleActiveWorkoutSheetPanel(opened, "history");
  const comment = toggleActiveWorkoutSheetPanel(history, "comment");
  const collapsed = toggleActiveWorkoutSheetPanel(comment, "comment");

  assert.equal(history.expandedPanel, "history");
  assert.equal(comment.expandedPanel, "comment");
  assert.equal(collapsed.expandedPanel, null);
  assert.equal(
    toggleActiveWorkoutSheetPanel(createActiveWorkoutSheetState(), "history").expandedPanel,
    null,
  );
  assert.equal(opened.expandedPanel, null, "las transiciones no mutan el estado de entrada");
});

test("presenta objetivos pendientes con peso string y singular de serie/repetición", () => {
  const result = buildActiveWorkoutGoalsPresentation(
    { ...sheetExercise, targetSets: 1, targetReps: 1 },
    sheetDraft({ reps: [""], weight: "" }),
  );

  assert.deepEqual(result.repetitions, {
    completed: 0,
    target: 1,
    percentage: 0,
    complete: false,
    tone: "pending",
    message: "Te falta 1 repetición para completar el objetivo de hoy.",
  });
  assert.deepEqual(result.weight, {
    complete: false,
    tone: "pending",
    valueText: "0 de 100 kg",
    statusText: "Sin registrar",
  });
  assert.deepEqual(result.sets, {
    complete: false,
    tone: "pending",
    valueText: "0 de 1 serie",
    statusText: "Falta 1 serie",
  });
  assert.equal(result.registration.canRegister, false);
});

test("0 kg se presenta Sin registrar y nunca como peso faltante contra el objetivo", () => {
  const result = buildActiveWorkoutGoalsPresentation(
    sheetExercise,
    sheetDraft({ weight: "0", reps: [10, 10, 10] }),
  );

  assert.equal(result.weight.valueText, "0 de 100 kg");
  assert.equal(result.weight.statusText, "Sin registrar");
  assert.doesNotMatch(result.weight.statusText, /Faltan 100 kg/);
  assert.equal(result.weight.complete, false);
});

test("presenta objetivos cumplidos, decimal canónico con coma y porcentaje saturado en 100", () => {
  const draft = sheetDraft({ weight: "102,5", reps: [11, 10, 10] });
  const result = buildActiveWorkoutGoalsPresentation(sheetExercise, draft);

  assert.deepEqual(result.repetitions, {
    completed: 31,
    target: 30,
    percentage: 100,
    complete: true,
    tone: "fulfilled",
    message: "Superaste el objetivo por 1 repetición.",
  });
  assert.deepEqual(result.weight, {
    complete: true,
    tone: "fulfilled",
    valueText: "102,5 de 100 kg",
    statusText: "+2,5 kg sobre el objetivo",
  });
  assert.deepEqual(result.sets, {
    complete: true,
    tone: "fulfilled",
    valueText: "3 de 3 series",
    statusText: "Todas completadas",
  });
  assert.deepEqual(result.registration, {
    canRegister: true,
    weightError: null,
    missingRequiredSetIndexes: [],
  });
  assert.deepEqual(buildActiveWorkoutSheetGoals(sheetExercise, draft), {
    filledSets: 3,
    totalReps: 31,
    targetTotalReps: 30,
    progressPercent: 100,
    repsComplete: true,
    repsMessage: "Superaste el objetivo por 1 repetición.",
    weightError: null,
    weight: { value: "102,5 de 100 kg", status: "+2,5 kg sobre el objetivo", complete: true },
    sets: { value: "3 de 3 series", status: "Todas completadas", complete: true },
    canRegister: true,
  });
  assert.equal(isActiveWorkoutDraftReadyToRegister(sheetExercise, draft), true);
});

test("un peso intermedio o ilegal sigue pendiente y no habilita registro", () => {
  for (const weight of ["100,", "100kg", "-1", "1.2.3"]) {
    const result = buildActiveWorkoutGoalsPresentation(
      sheetExercise,
      sheetDraft({ weight, reps: [10, 10, 10] }),
    );

    assert.equal(result.weight.complete, false, weight);
    assert.equal(result.weight.statusText, "Sin registrar", weight);
    assert.equal(result.registration.canRegister, false, weight);
    assert.equal(result.registration.weightError, "invalid", weight);
  }
});

test("la validación coincide con el controller productivo en casos adversariales", () => {
  const cases: Array<{ name: string; value: ExerciseDraft; valid: boolean }> = [
    { name: "cero kg y cero reps", value: sheetDraft({ weight: "0", reps: [0, 0, 0] }), valid: true },
    { name: "decimal con coma", value: sheetDraft({ weight: "100,25", reps: [10, 10, 10] }), valid: true },
    { name: "peso vacío", value: sheetDraft({ weight: "", reps: [10, 10, 10] }), valid: false },
    { name: "peso inválido", value: sheetDraft({ weight: "100,", reps: [10, 10, 10] }), valid: false },
    { name: "primera serie vacía", value: sheetDraft({ weight: "100", reps: ["", 10, 10] }), valid: false },
    { name: "última serie vacía", value: sheetDraft({ weight: "100", reps: [10, 10, ""] }), valid: false },
    { name: "series extra se ignoran", value: sheetDraft({ weight: "100", reps: [10, 10, 10, ""] }), valid: true },
  ];

  for (const item of cases) {
    const validation = validateActiveWorkoutExerciseDraft(sheetExercise, item.value);
    const productionDecision = resolveCurrentExerciseRegistration({
      isBusy: false,
      exercises: [sheetExercise],
      activeExerciseIndex: 0,
      drafts: { [sheetExercise.id]: item.value },
    });
    assert.equal(validation.canRegister, productionDecision.kind === "register", item.name);
    assert.equal(validation.canRegister, item.valid, item.name);
  }
});

test("normaliza las series requeridas sin mutar borrador ni ejercicio", () => {
  const sourceExercise = Object.freeze({ ...sheetExercise, targetSets: 2 });
  const sourceReps: Array<number | ""> = [8];
  Object.freeze(sourceReps);
  const sourceDraft: ExerciseDraft = Object.freeze({
    ...sheetDraft(),
    weight: "90",
    reps: sourceReps,
  });

  const result = buildActiveWorkoutGoalsPresentation(sourceExercise, sourceDraft);
  assert.equal(result.sets.valueText, "1 de 2 series");
  assert.deepEqual(result.registration.missingRequiredSetIndexes, [1]);
  assert.deepEqual(sourceReps, [8]);
  assert.equal(sourceExercise.targetSets, 2);
});

test("commit tipado distingue registro y update; update no contiene instrucción de avance", () => {
  const validDraft = sheetDraft({ weight: "100", reps: [10, 10, 10] });
  assert.deepEqual(createActiveWorkoutRegistrationCommit(sheetExercise, validDraft), {
    type: "commit_registration",
    exerciseId: sheetExercise.id,
    mode: "register",
  });

  const update = createActiveWorkoutRegistrationCommit(sheetExercise, {
    ...validDraft,
    registered: true,
  });
  assert.deepEqual(update, {
    type: "commit_registration",
    exerciseId: sheetExercise.id,
    mode: "update",
  });
  assert.ok(update);
  assert.equal("nextExerciseId" in update, false);
  assert.equal("advance" in update, false);
  assert.equal(createActiveWorkoutRegistrationCommit(
    sheetExercise,
    { ...validDraft, weight: "" },
  ), null);
});

test("un registrado editado e inválido deja de estar completo y bloquea el guardado final", () => {
  const validRegisteredDraft = sheetDraft({
    weight: "100",
    reps: [10, 10, 10],
    registered: true,
  });
  assert.equal(isActiveWorkoutRegistrationComplete(sheetExercise, validRegisteredDraft), true);
  assert.equal(
    canSaveActiveWorkoutDrafts([sheetExercise], { [sheetExercise.id]: validRegisteredDraft }),
    true,
  );

  for (const invalidDraft of [
    { ...validRegisteredDraft, weight: "" },
    { ...validRegisteredDraft, weight: "100," },
    { ...validRegisteredDraft, reps: [10, "", 10] },
  ] satisfies ExerciseDraft[]) {
    assert.equal(isActiveWorkoutRegistrationComplete(sheetExercise, invalidDraft), false);
    assert.equal(
      canSaveActiveWorkoutDrafts([sheetExercise], { [sheetExercise.id]: invalidDraft }),
      false,
    );
    assert.equal(invalidDraft.registered, true, "el modelo deriva completion sin mutar persistencia");
  }

  assert.equal(
    canSaveActiveWorkoutDrafts([sheetExercise], {
      [sheetExercise.id]: { ...validRegisteredDraft, registered: false },
    }),
    false,
  );
  assert.equal(canSaveActiveWorkoutDrafts([], {}), false);
});

test("el retry sólo invoca un callback productivo disponible", () => {
  let calls = 0;
  assert.equal(invokeActiveWorkoutHistoryRetry(), false);
  assert.equal(invokeActiveWorkoutHistoryRetry(() => { calls += 1; }), true);
  assert.equal(calls, 1);
});
