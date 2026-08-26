import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guidedSource = readFileSync(
  new URL("./components/GuidedTrainingScreen.tsx", import.meta.url),
  "utf8",
);
const boundarySource = readFileSync(
  new URL("./components/ActiveWorkoutSheetBoundary.tsx", import.meta.url),
  "utf8",
);
const sheetSource = readFileSync(
  new URL("./components/ExerciseRegistrationSheet.tsx", import.meta.url),
  "utf8",
);
const historyPanelSource = readFileSync(
  new URL("./components/ExerciseLastPerformancePanel.tsx", import.meta.url),
  "utf8",
);
const goalsSource = readFileSync(
  new URL("./components/ExerciseGoalsCard.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("./active-workout.module.css", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../../components/organizatech-app.tsx", import.meta.url),
  "utf8",
);
const activeWorkoutBoundaryHookSource = readFileSync(
  new URL("./hooks/useActiveWorkoutBoundary.ts", import.meta.url),
  "utf8",
);
const activeWorkoutControllerSource = readFileSync(
  new URL("./model/active-workout-controller-state.ts", import.meta.url),
  "utf8",
);
const appScreenResolverSource = readFileSync(
  new URL("../../lib/navigation/app-screen-resolver.ts", import.meta.url),
  "utf8",
);

interface TrainUi02Sources {
  guided: string;
  boundary: string;
  sheet: string;
  historyPanel: string;
  goals: string;
  styles: string;
}

const trainUi02Sources: TrainUi02Sources = {
  guided: guidedSource,
  boundary: boundarySource,
  sheet: sheetSource,
  historyPanel: historyPanelSource,
  goals: goalsSource,
  styles: stylesSource,
};

function sourceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `falta ${startMarker}`);
  assert.ok(end > start, `falta ${endMarker} después de ${startMarker}`);
  return source.slice(start, end);
}

function readStyleRule(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  assert.ok(start >= 0, `falta ${selector}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`regla sin cierre: ${selector}`);
}

function getTrainUi02Violations(value: TrainUi02Sources) {
  const violations: string[] = [];
  const moveFocusBlock = sourceBetween(
    value.boundary,
    "function moveExerciseFocus",
    "function closeExerciseSheet",
  );
  const openSheetBlock = sourceBetween(
    value.boundary,
    "function openExerciseSheet",
    "function moveExerciseFocus",
  );
  const commitBlock = sourceBetween(
    value.boundary,
    "function commitExerciseRegistration",
    "function updateSelectedExerciseDraft",
  );
  const guidedRule = readStyleRule(value.styles, ".guidedScreen");
  const backgroundRule = readStyleRule(value.styles, ".guidedBackground");
  const sheetRule = readStyleRule(value.styles, ".workoutSheet");
  const historyValueRule = readStyleRule(value.styles, ".sheetHistoryRows .sheetHistoryRow strong");

  if (
    /\buse(?:State|Effect|LayoutEffect|Memo|Ref)\b/.test(value.guided) ||
    !/ActiveWorkoutSheetBoundary/.test(value.guided) ||
    !/<ActiveWorkoutSheetBoundary \{\.\.\.props\} \/>/.test(value.guided)
  ) {
    violations.push("guided_presentation_boundary_broken");
  }
  if (
    /RoutineMetricGrid/.test(value.boundary) ||
    /aria-hidden="true"[\s\S]{0,160}(?:RoutineMetricGrid|targetSummary)/.test(value.boundary)
  ) {
    violations.push("hidden_legacy_marker_present");
  }
  if (
    !/useState\(createActiveWorkoutSheetState\)/.test(value.boundary) ||
    !/reconcileActiveWorkoutSheet\(sheetState, \{/.test(value.boundary) ||
    !/createActiveWorkoutSheetScopeKey\(\{ day, routine, exercises \}\)/.test(value.boundary)
  ) {
    violations.push("sheet_owner_or_reconciliation_missing");
  }
  if (
    !/role="listbox"/.test(value.boundary) ||
    !/role="option"/.test(value.boundary) ||
    !/aria-selected=\{isSelected\}/.test(value.boundary) ||
    !/tabIndex=\{currentRovingExerciseId === exercise\.id \? 0 : -1\}/.test(value.boundary)
  ) {
    violations.push("listbox_contract_missing");
  }
  if (
    !/resolveActiveWorkoutRovingExerciseId\(\{/.test(moveFocusBlock) ||
    !/rowRefs\.current\.get\(nextExerciseId\)\?\.focus/.test(moveFocusBlock) ||
    /setActiveIndex\s*\(/.test(moveFocusBlock) ||
    !/setActiveIndex\(index\)/.test(openSheetBlock)
  ) {
    violations.push("roving_triggers_selection_or_query");
  }
  if (
    !/inert=\{canMountSheet \? true : undefined\}/.test(value.boundary) ||
    !/\{canMountSheet \? \(/.test(value.boundary)
  ) {
    violations.push("inert_not_coupled_to_mounted_sheet");
  }
  if (
    !/pendingFocusExerciseIdRef\.current = reconciliation\.focusExerciseId/.test(value.boundary) ||
    !/rowRefs\.current\.get\(exerciseId\)\?\.focus/.test(value.boundary) ||
    !/setRovingExerciseId\(reconciliation\.focusExerciseId\)/.test(value.boundary)
  ) {
    violations.push("identity_focus_restore_missing");
  }
  if (
    !/createActiveWorkoutRegistrationCommit\(activeExercise, draft\)/.test(value.boundary) ||
    !/onCommitRegistration=\{commitExerciseRegistration\}/.test(value.boundary) ||
    !/if \(action\.mode === "register"\) registerExercise\(\);/.test(commitBlock) ||
    (commitBlock.match(/registerExercise\(\);/g) ?? []).length !== 1 ||
    !/closeExerciseSheet\(\);/.test(commitBlock) ||
    /setActiveIndex\s*\(/.test(commitBlock) ||
    !/onCommitRegistration\(registrationCommit\)/.test(value.sheet)
  ) {
    violations.push("typed_single_commit_missing");
  }
  if (
    !/const isDuplicateConflict = notice\.includes\("Ya existe un entrenamiento"\)/.test(value.boundary) ||
    !/data-kind=\{isDuplicateConflict \? "conflict" : "neutral"\}/.test(value.boundary) ||
    !/role="status"/.test(value.boundary)
  ) {
    violations.push("notice_not_neutral");
  }
  if (
    !/saveCompletedTrainingStatus: ActiveWorkoutCompletionStatus/.test(value.boundary) ||
    !/retrySaveCompletedTraining: \(\) => void/.test(value.boundary) ||
    !/saveCompletedTrainingStatus === "error"/.test(value.boundary) ||
    !/className=\{styles\.guidedSaveError\} role="alert"/.test(value.boundary) ||
    !/No se pudo guardar el entrenamiento/.test(value.boundary) ||
    !/Tus registros siguen aquí\. Vuelve a intentarlo\./.test(value.boundary) ||
    !/retrySaveCompletedTraining\s*:\s*saveCompletedTraining/.test(value.boundary) ||
    !/saveCompletedTrainingStatus=\{activeWorkoutBoundary\.completionStatus\}/.test(appSource) ||
    !/retrySaveCompletedTraining=\{activeWorkoutBoundary\.retryCompletion\}/.test(appSource) ||
    !/const retryCompletion = useCallback/.test(activeWorkoutBoundaryHookSource) ||
    /saveCompletedTrainingStatus\s*=\s*notice/.test(value.boundary)
  ) {
    violations.push("typed_completion_retry_missing");
  }
  if (
    !/historyStatus === "idle"/.test(value.historyPanel) ||
    !/historyStatus === "loading"/.test(value.historyPanel) ||
    !/historyStatus === "ready"/.test(value.historyPanel) ||
    !/historyStatus === "empty"/.test(value.historyPanel) ||
    !/historyStatus === "idle"[\s\S]*?Registro anterior/.test(value.historyPanel) ||
    !/Sin registro anterior de este ejercicio\./.test(value.historyPanel) ||
    !/No se pudo cargar el registro anterior\./.test(value.historyPanel) ||
    /Es la primera vez|errorMessage/.test(value.historyPanel)
  ) {
    violations.push("history_states_or_neutral_copy_missing");
  }
  if (
    !/>\s*Reintentar\s*<\/button>/.test(value.historyPanel) ||
    !/onClick=\{retryHistory\}/.test(value.historyPanel) ||
    !/invokeActiveWorkoutHistoryRetry\(retryExerciseHistory\)/.test(value.historyPanel) ||
    !/window\.requestAnimationFrame/.test(value.historyPanel)
  ) {
    violations.push("conditional_retry_missing");
  }
  if (
    !/className=\{styles\.workoutSheetScrim\}[\s\S]*?tabIndex=\{-1\}/.test(value.sheet) ||
    !/onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/.test(value.sheet)
  ) {
    violations.push("scrim_focus_escape_present");
  }
  if (
    !/role="dialog"/.test(value.sheet) ||
    !/aria-modal="true"/.test(value.sheet) ||
    !/event\.key === "Escape"/.test(value.sheet) ||
    !/event\.key !== "Tab"/.test(value.sheet) ||
    !/weightInputRef\.current\?\.focus\(\{ preventScroll: true \}\)/.test(value.sheet)
  ) {
    violations.push("dialog_keyboard_boundary_missing");
  }
  if (
    /container-(?:name|type)\s*:/.test(guidedRule) ||
    /overflow\s*:\s*hidden/.test(guidedRule) ||
    !/container-name\s*:\s*active-workout-routine/.test(backgroundRule) ||
    !/container-type\s*:\s*inline-size/.test(backgroundRule) ||
    !/@container active-workout-routine \(max-width: 359px\)/.test(value.styles) ||
    !/position\s*:\s*fixed/.test(sheetRule) ||
    !/bottom\s*:\s*0/.test(sheetRule) ||
    !/max-height\s*:\s*(?:min\([^;]*100dvh|calc\(100dvh[^;]*\)|[1-9]\d?dvh)/.test(sheetRule) ||
    !/container-name\s*:\s*active-workout-sheet/.test(sheetRule) ||
    !/container-type\s*:\s*inline-size/.test(sheetRule) ||
    !/@container active-workout-sheet \(max-width: 359px\)/.test(value.styles)
  ) {
    violations.push("responsive_containment_or_clipping_present");
  }
  if (
    !/width: min\(100%, 430px\)/.test(value.styles) ||
    /overflow-x:\s*(?:auto|scroll)/.test(value.styles)
  ) {
    violations.push("mobile_width_or_horizontal_scroll_broken");
  }
  if (
    !/min-width\s*:\s*0/.test(historyValueRule) ||
    !/overflow-wrap\s*:\s*anywhere/.test(historyValueRule) ||
    /white-space\s*:\s*nowrap/.test(historyValueRule)
  ) {
    violations.push("history_horizontal_clipping_present");
  }
  if (
    !/\.workoutSheetBody \{[\s\S]*?overflow-y: auto;/.test(value.styles) ||
    !/\.guidedRoutinePanel \{[\s\S]*?overflow-y: auto;/.test(value.styles) ||
    !/@media \(prefers-reduced-motion: reduce\)/.test(value.styles)
  ) {
    violations.push("scroll_or_reduced_motion_missing");
  }
  if (
    /\bfetch\s*\(|-repository"|@\/lib\/(?:supabase|storage|data)\//.test(
      `${value.guided}\n${value.boundary}\n${value.sheet}\n${value.historyPanel}\n${value.goals}`,
    )
  ) {
    violations.push("visual_boundary_imports_data_source");
  }

  return violations;
}

test("Guided es presentacional y el owner hijo reconcilia modal, inert y foco por identidad", () => {
  assert.deepEqual(getTrainUi02Violations(trainUi02Sources), []);
  assert.doesNotMatch(guidedSource, /\buse(?:State|Effect|LayoutEffect|Memo|Ref)\b/);
  assert.match(boundarySource, /scopeKey,/);
  assert.match(boundarySource, /exerciseIds,/);
  assert.match(boundarySource, /selectedExerciseId: selectedExercise\?\.id \?\? null/);
  assert.match(boundarySource, /if \(!exerciseIds\.includes\(exerciseId\)\)/);
  const identityResetBlock = sourceBetween(
    appSource,
    "const resetActiveWorkoutSessionState = useCallback",
    "function resetUserScopedTransientState",
  );
  assert.match(identityResetBlock, /activeWorkoutBoundary\.resetForIdentity\(\{/);
  assert.match(
    activeWorkoutBoundaryHookSource,
    /const resetForIdentity[\s\S]*?controller\.actions\.resetActiveWorkout\(\);/,
  );
  assert.match(
    activeWorkoutControllerSource,
    /case "active_workout_reset":\s*return createInitialActiveWorkoutControllerState\(\);/,
  );
  assert.match(
    activeWorkoutControllerSource,
    /createInitialActiveWorkoutControllerState[\s\S]*?hasStartedTraining: false,/,
  );
  assert.match(appScreenResolverSource, /if \(!input\.hasStartedTraining\) return "start";/);
  assert.match(
    appSource,
    /activeWorkoutVariant === "guided"[\s\S]*?<GuidedTrainingScreen/,
  );
});

test("roving no selecciona ni consulta; click, commit y retry final son acciones tipadas", () => {
  const moveFocusBlock = sourceBetween(
    boundarySource,
    "function moveExerciseFocus",
    "function closeExerciseSheet",
  );
  const commitBlock = sourceBetween(
    boundarySource,
    "function commitExerciseRegistration",
    "function updateSelectedExerciseDraft",
  );

  assert.doesNotMatch(moveFocusBlock, /setActiveIndex\s*\(/);
  assert.doesNotMatch(moveFocusBlock, /openActiveWorkoutSheet|fetch|revalidate|synchronize/);
  assert.match(boundarySource, /onClick=\{\(\) => openExerciseSheet\(exercise, index\)\}/);
  assert.match(commitBlock, /if \(action\.mode === "register"\) registerExercise\(\);/);
  assert.doesNotMatch(commitBlock, /setActiveIndex|nextExercise|advance/);
  assert.equal((commitBlock.match(/registerExercise\(\);/g) ?? []).length, 1);
  assert.match(boundarySource, /className=\{styles\.guidedSaveError\} role="alert"/);
  assert.match(boundarySource, /saveCompletedTrainingStatus === "error"/);
  assert.match(boundarySource, /retrySaveCompletedTraining/);
});

test("historial distingue idle, loading, ready, empty y error con copy neutral y retry real", () => {
  for (const status of ["idle", "loading", "ready", "empty"]) {
    assert.match(historyPanelSource, new RegExp(`historyStatus === "${status}"`));
  }
  const idleBlock = sourceBetween(
    historyPanelSource,
    'historyStatus === "idle"',
    'historyStatus === "loading"',
  );
  assert.match(idleBlock, /Registro anterior/);
  assert.doesNotMatch(idleBlock, /primera vez|Sin registro anterior|No se pudo cargar/i);
  assert.match(historyPanelSource, /Sin registro anterior de este ejercicio\./);
  assert.doesNotMatch(historyPanelSource, /Es la primera vez/);
  assert.match(historyPanelSource, /<p>No se pudo cargar el registro anterior\.<\/p>/);
  assert.doesNotMatch(historyPanelSource, /errorMessage/);
  assert.match(historyPanelSource, />\s*Reintentar\s*<\/button>/);
  assert.doesNotMatch(historyPanelSource, /retryExerciseHistory \? \(/);
});

test("diálogo, scrim, scroll y responsive no permiten salida de foco ni recorte superior", () => {
  assert.match(sheetSource, /tabIndex=\{-1\}/);
  assert.match(sheetSource, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(sheetSource, /role="dialog"/);
  assert.match(sheetSource, /aria-modal="true"/);
  assert.match(stylesSource, /\.workoutSheetBody \{[\s\S]*?overflow-y: auto;/);
  const guidedRule = readStyleRule(stylesSource, ".guidedScreen");
  assert.doesNotMatch(guidedRule, /container-(?:name|type)\s*:|overflow\s*:\s*hidden/);
  assert.match(stylesSource, /@container active-workout-routine \(max-width: 359px\)/);
  assert.match(stylesSource, /@container active-workout-sheet \(max-width: 359px\)/);
});

test("anchos deterministas: rutina 320/393 compacta; hoja 320 compacta; 430/768 normales", () => {
  const cases = [
    { viewport: 320, routineCompact: true, sheetCompact: true, routineWidth: 288, sheetWidth: 320 },
    { viewport: 393, routineCompact: true, sheetCompact: false, routineWidth: 353.7, sheetWidth: 393 },
    { viewport: 430, routineCompact: false, sheetCompact: false, routineWidth: 387, sheetWidth: 430 },
    { viewport: 768, routineCompact: false, sheetCompact: false, routineWidth: 430, sheetWidth: 430 },
  ];

  for (const item of cases) {
    const shellWidth = Math.min(item.viewport, 560);
    const contentInlinePadding = Math.min(24, Math.max(16, item.viewport * 0.05));
    const availableWidth = shellWidth - contentInlinePadding * 2;
    const routineWidth = Math.min(availableWidth, 430);
    const sheetWidth = Math.min(item.viewport, 430);
    assert.equal(routineWidth <= 359, item.routineCompact);
    assert.equal(sheetWidth <= 359, item.sheetCompact);
    assert.ok(Math.abs(routineWidth - item.routineWidth) < 0.001);
    assert.equal(sheetWidth, item.sheetWidth);
  }
  assert.match(stylesSource, /--active-workout-plan-grid: minmax\(0, 1fr\) 46px 46px 48px/);
  assert.match(stylesSource, /--active-workout-table-heading: 12px/);
  assert.match(stylesSource, /width: min\(100%, 430px\)/);
  assert.doesNotMatch(stylesSource, /overflow-x:\s*(?:auto|scroll)/);
});

test("mutation probes detectan pérdida de ownership, reconciliación, navegación, commit y accesibilidad", () => {
  const mutations: Array<{ expected: string; value: TrainUi02Sources }> = [
    {
      expected: "guided_presentation_boundary_broken",
      value: {
        ...trainUi02Sources,
        guided: guidedSource.replace(
          "export function GuidedTrainingScreen",
          "const useState = true;\nexport function GuidedTrainingScreen",
        ),
      },
    },
    {
      expected: "sheet_owner_or_reconciliation_missing",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          "reconcileActiveWorkoutSheet(sheetState, {",
          "skipActiveWorkoutSheetReconciliation(sheetState, {",
        ),
      },
    },
    {
      expected: "hidden_legacy_marker_present",
      value: {
        ...trainUi02Sources,
        boundary: `${boundarySource}\nconst RoutineMetricGrid = () => <div aria-hidden="true">targetSummary</div>;`,
      },
    },
    {
      expected: "listbox_contract_missing",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace('role="listbox"', 'role="group"'),
      },
    },
    {
      expected: "roving_triggers_selection_or_query",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          "setRovingExerciseId(nextExerciseId);",
          "setActiveIndex(0);\n    setRovingExerciseId(nextExerciseId);",
        ),
      },
    },
    {
      expected: "inert_not_coupled_to_mounted_sheet",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          "inert={canMountSheet ? true : undefined}",
          "inert={sheetState.openExerciseId ? true : undefined}",
        ),
      },
    },
    {
      expected: "identity_focus_restore_missing",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          "setRovingExerciseId(reconciliation.focusExerciseId);",
          "/* roving no reconciliado */",
        ),
      },
    },
    {
      expected: "typed_single_commit_missing",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          'if (action.mode === "register") registerExercise();',
          "registerExercise();",
        ),
      },
    },
    {
      expected: "notice_not_neutral",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          'const isDuplicateConflict = notice.includes("Ya existe un entrenamiento");',
          "const isDuplicateConflict = false;",
        ),
      },
    },
    {
      expected: "typed_completion_retry_missing",
      value: {
        ...trainUi02Sources,
        boundary: boundarySource.replace(
          "? retrySaveCompletedTraining",
          "? saveCompletedTraining",
        ),
      },
    },
    {
      expected: "history_states_or_neutral_copy_missing",
      value: {
        ...trainUi02Sources,
        historyPanel: historyPanelSource.replace(
          'historyStatus === "idle"',
          'historyStatus === "empty"',
        ),
      },
    },
    {
      expected: "conditional_retry_missing",
      value: {
        ...trainUi02Sources,
        historyPanel: historyPanelSource.replace(
          "onClick={retryHistory}",
          "onClick={() => undefined}",
        ),
      },
    },
    {
      expected: "scrim_focus_escape_present",
      value: {
        ...trainUi02Sources,
        sheet: sheetSource.replace("tabIndex={-1}", ""),
      },
    },
    {
      expected: "dialog_keyboard_boundary_missing",
      value: {
        ...trainUi02Sources,
        sheet: sheetSource.replace('role="dialog"', 'role="region"'),
      },
    },
    {
      expected: "responsive_containment_or_clipping_present",
      value: {
        ...trainUi02Sources,
        styles: stylesSource.replace(
          ".guidedScreen {",
          ".guidedScreen {\n  container-type: inline-size;",
        ),
      },
    },
    {
      expected: "mobile_width_or_horizontal_scroll_broken",
      value: {
        ...trainUi02Sources,
        styles: stylesSource.replaceAll("width: min(100%, 430px)", "width: 100%"),
      },
    },
    {
      expected: "history_horizontal_clipping_present",
      value: {
        ...trainUi02Sources,
        styles: stylesSource.replace(
          ".sheetHistoryRows .sheetHistoryRow strong {\n  min-width: 0;",
          ".sheetHistoryRows .sheetHistoryRow strong {\n  white-space: nowrap;",
        ),
      },
    },
    {
      expected: "visual_boundary_imports_data_source",
      value: {
        ...trainUi02Sources,
        boundary: `${boundarySource}\nfetch("/history");`,
      },
    },
  ];

  for (const mutation of mutations) {
    assert.ok(
      getTrainUi02Violations(mutation.value).includes(mutation.expected),
      `debe morir la mutación ${mutation.expected}`,
    );
  }
  assert.deepEqual(getTrainUi02Violations(trainUi02Sources), []);
});
