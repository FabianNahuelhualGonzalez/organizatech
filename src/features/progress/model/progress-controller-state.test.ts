import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildProgressControllerView,
  createInitialProgressControllerState,
  progressControllerReducer,
  type ProgressControllerSource,
} from "@/features/progress/model/progress-controller-state";
import type {
  ExerciseEntry,
  ExerciseTemplate,
} from "@/lib/progress/types";

const mondayExercise = createExercise({
  id: "exercise-monday",
  trainingCycleExerciseId: "cycle-exercise-monday",
  exerciseLineageId: "lineage-press",
  day: "Lunes",
  name: "Press banca",
});
const fridayExercise = createExercise({
  id: "exercise-friday",
  trainingCycleExerciseId: "cycle-exercise-friday",
  exerciseLineageId: "lineage-row",
  day: "Viernes",
  name: "Remo",
});

function testInitialStateIsFresh() {
  const first = createInitialProgressControllerState();
  const second = createInitialProgressControllerState();

  assert.deepEqual(first, {
    selectedDay: "Lunes",
    selectedExerciseId: null,
    selectedWeek: null,
  });
  assert.notStrictEqual(first, second);
}

function testSemanticTransitionsAreAtomic() {
  const initial = createInitialProgressControllerState();
  const withExercise = progressControllerReducer(initial, {
    type: "exercise_selected",
    exerciseId: " exercise-monday ",
  });
  const withWeek = progressControllerReducer(withExercise, {
    type: "week_selected",
    week: 3,
  });
  const nextDay = progressControllerReducer(withWeek, {
    type: "day_selected",
    day: " Viernes ",
  });

  assert.deepEqual(nextDay, {
    selectedDay: "Viernes",
    selectedExerciseId: null,
    selectedWeek: null,
  });
  assert.deepEqual(withWeek, {
    selectedDay: "Lunes",
    selectedExerciseId: "exercise-monday",
    selectedWeek: 3,
  }, "la transición posterior no muta el estado previo");

  const nextExercise = progressControllerReducer(withWeek, {
    type: "exercise_selected",
    exerciseId: "exercise-friday",
  });
  assert.deepEqual(nextExercise, {
    selectedDay: "Lunes",
    selectedExerciseId: "exercise-friday",
    selectedWeek: null,
  });

  assert.deepEqual(
    progressControllerReducer(nextExercise, { type: "selection_reset" }),
    createInitialProgressControllerState(),
  );
}

function testInvalidInputsAndNoOpsPreserveState() {
  const initial = createInitialProgressControllerState();
  const selected = progressControllerReducer(initial, {
    type: "exercise_selected",
    exerciseId: "exercise-monday",
  });
  const withWeek = progressControllerReducer(selected, { type: "week_selected", week: 2 });

  assert.strictEqual(progressControllerReducer(initial, { type: "day_selected", day: "  " }), initial);
  assert.strictEqual(progressControllerReducer(initial, { type: "day_selected", day: "Lunes" }), initial);
  assert.strictEqual(progressControllerReducer(selected, { type: "exercise_selected", exerciseId: "" }), selected);
  assert.strictEqual(progressControllerReducer(selected, { type: "exercise_selected", exerciseId: " exercise-monday " }), selected);
  assert.strictEqual(
    progressControllerReducer(withWeek, { type: "exercise_selected", exerciseId: "exercise-monday" }),
    withWeek,
    "reseleccionar el mismo ejercicio conserva la semana vigente mediante no-op",
  );

  for (const week of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.strictEqual(progressControllerReducer(withWeek, { type: "week_selected", week }), withWeek);
  }
  assert.strictEqual(progressControllerReducer(withWeek, { type: "week_selected", week: 2 }), withWeek);
  assert.strictEqual(progressControllerReducer(initial, { type: "selection_reset" }), initial);
}

function testRemovedDayUsesCanonicalFallbackWithoutMutatingIntent() {
  const fridayState = progressControllerReducer(createInitialProgressControllerState(), {
    type: "day_selected",
    day: "Viernes",
  });
  const source = createSource({
    plannedExercises: [mondayExercise],
    routineDays: ["Lunes"],
  });
  const stateSnapshot = structuredClone(fridayState);
  const sourceSnapshot = structuredClone(source);

  const view = buildProgressControllerView(fridayState, source);

  assert.equal(view.selectedDay, "Lunes");
  assert.equal(view.selectedExerciseId, mondayExercise.id);
  assert.deepEqual(fridayState, stateSnapshot);
  assert.deepEqual(source, sourceSnapshot);
}

function testRetiredExerciseAndMissingWeekUseCanonicalFallbacks() {
  const selectedRetiredExercise = progressControllerReducer(
    createInitialProgressControllerState(),
    { type: "exercise_selected", exerciseId: "retired-cycle-exercise" },
  );
  const selectedMissingWeek = progressControllerReducer(
    selectedRetiredExercise,
    { type: "week_selected", week: 99 },
  );
  const source = createSource({
    plannedExercises: [mondayExercise],
    entries: [
      createEntry({
        id: "entry-week-1",
        trainingCycleExerciseId: "retired-cycle-exercise",
        exerciseId: "retired-cycle-exercise",
        exerciseLineageId: "lineage-press",
        week: 1,
        date: "2026-07-06",
        weight: 80,
      }),
      createEntry({
        id: "entry-week-3",
        trainingCycleExerciseId: "cycle-exercise-monday",
        exerciseId: "cycle-exercise-monday",
        exerciseLineageId: "lineage-press",
        week: 3,
        date: "2026-07-20",
        weight: 85,
      }),
    ],
    currentWeek: 3,
  });

  const view = buildProgressControllerView(selectedMissingWeek, source);

  assert.equal(view.selectedExerciseId, mondayExercise.id, "un ejercicio retirado cae al plan vigente");
  assert.equal(view.selectedWeek, 3, "una semana inexistente cae a currentWeek disponible");
  assert.deepEqual(view.comparisonModel.availableWeeks, [1, 3]);
  assert.equal(view.comparisonModel.resultComparison.baseline?.entryId, "entry-week-1");
  assert.equal(view.comparisonModel.resultComparison.effective?.entryId, "entry-week-3");
  assert.equal(view.comparisonModel.kgSummary.difference, 5, "el lineage enlaza la versión retirada y la vigente");
}

function testEmptySourceIsSafe() {
  const state = progressControllerReducer(createInitialProgressControllerState(), {
    type: "week_selected",
    week: 4,
  });
  const view = buildProgressControllerView(state, createSource({
    plannedExercises: [],
    entries: [],
    routineDays: [],
  }));

  assert.equal(view.selectedDay, "Lunes");
  assert.equal(view.selectedExerciseId, null);
  assert.equal(view.selectedWeek, null);
  assert.equal(view.comparisonModel.emptyState, "no_routine_for_day");
}

function testSelectorIsDeterministicAndDoesNotMutateInputs() {
  const state = createInitialProgressControllerState();
  const source = createSource({
    plannedExercises: [mondayExercise, fridayExercise],
    entries: [createEntry({
      id: "entry-week-1",
      trainingCycleExerciseId: "cycle-exercise-monday",
      exerciseId: "cycle-exercise-monday",
      exerciseLineageId: "lineage-press",
      week: 1,
      date: "2026-07-06",
    })],
  });
  const stateSnapshot = structuredClone(state);
  const sourceSnapshot = structuredClone(source);

  const first = buildProgressControllerView(state, source);
  const second = buildProgressControllerView(state, source);

  assert.deepEqual(first, second);
  assert.deepEqual(state, stateSnapshot);
  assert.deepEqual(source, sourceSnapshot);
}

function testStaticInfrastructureBoundary() {
  const source = readFileSync("src/features/progress/model/progress-controller-state.ts", "utf8");
  const packageSource = readFileSync("package.json", "utf8");
  const stateDeclaration = source.match(
    /export interface ProgressControllerState \{[\s\S]*?\n\}/,
  )?.[0] ?? "";

  for (const forbidden of [
    "react",
    "@/lib/data/repository",
    "@/lib/storage/",
    "@/lib/supabase/",
    "@/lib/auth/",
    "@/lib/navigation/",
    "window",
    "document",
    "setTimeout",
    "Date.now",
  ]) {
    assert.doesNotMatch(source, new RegExp(escapeRegExp(forbidden)));
  }
  assert.match(source, /buildWeeklyExerciseComparisonModel\(/);
  assert.match(stateDeclaration, /selectedDay: string;/);
  assert.match(stateDeclaration, /selectedExerciseId: string \| null;/);
  assert.match(stateDeclaration, /selectedWeek: number \| null;/);
  assert.doesNotMatch(
    stateDeclaration,
    /\b(?:exercises|entries|sessions|metrics|loading|error):\s*(?:readonly\s+)?[^;]+;/,
  );
  assert.doesNotMatch(source, /Partial<|\bpatch\b|\bmerge\b/);
  assert.equal(
    packageSource.split("src/features/progress/model/progress-controller-state.test.ts").length - 1,
    1,
    "npm test registra el test runtime exactamente una vez",
  );
}

function testStaticProductiveIntegrationContract() {
  // Contrato source-based: valida ownership y wiring; no renderiza React ni simula DOM/eventos.
  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const comparisonSource = readFileSync(
    "src/features/progress/components/comparison-screen-v2.tsx",
    "utf8",
  );
  const controllerImport = appSource.match(
    /import \{[^}]+\} from "@\/features\/progress\/model\/progress-controller-state";/,
  )?.[0] ?? "";
  const viewStart = appSource.indexOf("  const progressControllerView = buildProgressControllerView(");
  const viewEnd = appSource.indexOf("  const dashboardCarouselDays", viewStart);
  const viewSource = viewStart >= 0 && viewEnd > viewStart
    ? appSource.slice(viewStart, viewEnd)
    : "";

  for (const importedName of [
    "buildProgressControllerView",
    "createInitialProgressControllerState",
    "progressControllerReducer",
  ]) {
    assert.match(controllerImport, new RegExp(`\\b${importedName}\\b`));
  }
  assert.equal(
    (appSource.match(
      /const \[progressControllerState, dispatchProgressController\] = useReducer\(\s*progressControllerReducer,\s*undefined,\s*createInitialProgressControllerState,\s*\);/g,
    ) ?? []).length,
    1,
    "el root debe crear exactamente un reducer productivo de Progress",
  );
  assert.equal(
    (appSource.match(/\bbuildProgressControllerView\(/g) ?? []).length,
    1,
    "la vista canonica se construye exactamente una vez",
  );
  assert.match(viewSource, /progressControllerState,/);
  assert.match(viewSource, /plannedExercises: displayExercises,/);
  assert.match(viewSource, /entries: metrics,/);
  assert.match(viewSource, /routineDays,/);
  assert.match(viewSource, /currentWeek,/);
  assert.doesNotMatch(viewSource, /entries: (?:entries|displayEntries|calendarNormalizedEntries),/);

  assert.doesNotMatch(appSource, /\bcomparisonDay\b/);
  assert.doesNotMatch(appSource, /\bsetComparisonDay\b/);
  assert.doesNotMatch(comparisonSource, /\bcomparisonDay\b|\bsetComparisonDay\b/);

  assert.equal((appSource.match(/dispatchProgressController\(/g) ?? []).length, 10);
  assert.equal((appSource.match(/type: "selection_reset"/g) ?? []).length, 5);
  assert.match(
    appSource,
    /function resetUserScopedTransientState\([\s\S]*dispatchProgressController\(\{ type: "selection_reset" \}\)/,
    "SIGNED_OUT/cambio de identidad resetea la seleccion de Progress",
  );
  assert.equal((appSource.match(/type: "day_selected"/g) ?? []).length, 3);
  assert.equal((appSource.match(/type: "exercise_selected"/g) ?? []).length, 1);
  assert.equal((appSource.match(/type: "week_selected"/g) ?? []).length, 1);
  assert.match(
    appSource,
    /dispatchProgressController\(\{ type: "day_selected", day: intent\.comparisonDayOverride \}\)/,
  );
  assert.match(appSource, /model=\{progressControllerView\.comparisonModel\}/);
  assert.match(
    appSource,
    /onDaySelect=\{\(day\) => dispatchProgressController\(\{ type: "day_selected", day \}\)\}/,
  );
  assert.match(
    appSource,
    /onExerciseSelect=\{\(exerciseId\) => dispatchProgressController\(\{ type: "exercise_selected", exerciseId \}\)\}/,
  );
  assert.match(
    appSource,
    /onWeekSelect=\{\(week\) => dispatchProgressController\(\{ type: "week_selected", week \}\)\}/,
  );

  assert.match(comparisonSource, /model: WeeklyExerciseComparisonModel;/);
  assert.match(comparisonSource, /routineDays: readonly string\[\];/);
  assert.match(comparisonSource, /onDaySelect: \(day: string\) => void;/);
  assert.match(comparisonSource, /onExerciseSelect: \(exerciseId: string\) => void;/);
  assert.match(comparisonSource, /onWeekSelect: \(week: number\) => void;/);
  assert.doesNotMatch(comparisonSource, /\buseState\b|\buseEffect\b|\buseMemo\b/);
  assert.doesNotMatch(comparisonSource, /\bbuildWeeklyExerciseComparisonModel\b/);
  assert.match(comparisonSource, /value=\{model\.selectedDay\}/);
  assert.match(comparisonSource, /exercise\.isSelected/);
  assert.match(comparisonSource, /value=\{model\.selectedWeek \?\? ""\}/);
  assert.match(
    comparisonSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);\s*onExerciseSelect\(exercise\.exerciseId\);\s*\}\}/,
  );
  assert.doesNotMatch(
    appSource,
    /dispatchProgressController\(\{ type: "(?:day_selected|exercise_selected|week_selected)", [^}]*progressControllerView/,
    "la vista derivada no debe sincronizarse de vuelta al reducer",
  );
}

function createSource(overrides: Partial<ProgressControllerSource> = {}): ProgressControllerSource {
  return {
    plannedExercises: [mondayExercise, fridayExercise],
    entries: [],
    routineDays: ["Lunes", "Viernes"],
    currentWeek: 1,
    ...overrides,
  };
}

function createExercise(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    id: "exercise",
    cycleId: "cycle-1",
    cycleDayId: "day-1",
    trainingCycleExerciseId: "cycle-exercise",
    exerciseLineageId: "lineage",
    routine: "Rutina A",
    day: "Lunes",
    name: "Ejercicio",
    targetSets: 3,
    targetReps: 10,
    baseWeight: 80,
    ...overrides,
  };
}

function createEntry(overrides: Partial<ExerciseEntry> = {}): ExerciseEntry {
  return {
    id: "entry",
    sessionId: "session-1",
    cycleId: "cycle-1",
    cycleDayId: "day-1",
    trainingCycleExerciseId: "cycle-exercise",
    exerciseLineageId: "lineage",
    exerciseId: "cycle-exercise",
    exerciseName: "Ejercicio",
    routine: "Rutina A",
    week: 1,
    date: "2026-07-06",
    targetSets: 3,
    targetReps: 10,
    weight: 80,
    previousWeight: 75,
    reps: [10, 10, 10],
    ...overrides,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

testInitialStateIsFresh();
testSemanticTransitionsAreAtomic();
testInvalidInputsAndNoOpsPreserveState();
testRemovedDayUsesCanonicalFallbackWithoutMutatingIntent();
testRetiredExerciseAndMissingWeekUseCanonicalFallbacks();
testEmptySourceIsSafe();
testSelectorIsDeterministicAndDoesNotMutateInputs();
testStaticInfrastructureBoundary();
testStaticProductiveIntegrationContract();

console.log("progress controller state tests passed");
