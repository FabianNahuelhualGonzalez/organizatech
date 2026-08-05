import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const BASE_SHA = "d5ed28ffa452ca59eac93c4cc868279171e143a4";
const files = {
  root: "src/components/organizatech-app.tsx",
  routineHook: "src/features/routine-builder/hooks/useRoutineBuilderController.ts",
  owner: "src/features/routine-builder/model/routine-builder-operation-owner.ts",
  progressHook: "src/features/progress/hooks/useProgressController.ts",
  progressModel: "src/features/progress/model/progress-controller-state.ts",
  selector: "src/features/training-data/model/training-data-selectors.ts",
  completion: "src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx",
  planSources: "src/features/training-plan/model/training-plan-sources.ts",
} as const;

type Sources = Record<keyof typeof files, string>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readSources(base = "."): Sources {
  return Object.fromEntries(
    Object.entries(files).map(([key, path]) => [key, readFileSync(join(base, path), "utf8")]),
  ) as Sources;
}

function productiveJsx(source: string) {
  const start = source.indexOf("  return (\n    <AppShellLayout");
  const end = source.indexOf("\n  );\n}", start);
  assert.ok(start >= 0 && end > start, "se encontró el JSX productivo del root");
  return source.slice(start, end + 5);
}

function productiveJsxAst(source: string): string {
  const sourceFile = ts.createSourceFile(
    files.root,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      let candidate = node.expression;
      while (ts.isParenthesizedExpression(candidate)) candidate = candidate.expression;
      if (
        ts.isJsxElement(candidate) &&
        candidate.openingElement.tagName.getText(sourceFile) === "AppShellLayout"
      ) {
        expression = candidate;
        return;
      }
    }
    if (!expression) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(expression, "se encontró el AST del JSX productivo del root");

  const serialize = (node: ts.Node): unknown => {
    const children = node.getChildren(sourceFile);
    return children.length === 0
      ? [node.kind, node.getText(sourceFile)]
      : [node.kind, children.map(serialize)];
  };
  return JSON.stringify(serialize(expression));
}

function validate(sources: Sources) {
  assert.match(sources.root, /useRoutineBuilderController\(\{/);
  assert.match(sources.root, /useRoutineBuilderDraftLifecycle\(\{/);
  assert.match(sources.root, /useRoutineBuilderWorkflows\(routineBuilder, \{/);
  assert.match(sources.root, /useProgressController\(\{/);
  assert.doesNotMatch(sources.root, /routineBuilderReducer|progressControllerReducer/);
  assert.doesNotMatch(sources.root, /saveRoutineDraft|loadRoutineDraft|saveTrainingPlan/);
  assert.doesNotMatch(sources.root, /routineSaveInFlightRef|trainingCycleCreateInFlightRef|trainingCycleDeleteInFlightRef/);
  assert.doesNotMatch(sources.root, /const \[displayTrainingPlan(?:,|\])/);
  assert.match(sources.root, /\{\s*displayTrainingPlan,\s*\} = selectTrainingPlanSources\(draftPlan, trainingDataView\)/);
  assert.doesNotMatch(
    sources.root,
    /async function (?:saveInitialRoutine|startNewTrainingCycle|deleteCurrentTrainingCycle)\b/,
  );
  assert.doesNotMatch(
    sources.root,
    /routineBuilder\.(?:acquire|settle|finalize|runLegacyBatch|runRepositoryWrite|completeSetupContinuation)\b/,
  );
  assert.doesNotMatch(sources.root, /ShareWorkoutCard|workout-share/);
  const refreshReconciliation = sources.root.slice(
    sources.root.indexOf("function applyTrainingDataRefreshResult"),
    sources.root.indexOf("async function refreshTrainingDataForSession"),
  );
  assert.match(refreshReconciliation, /routineBuilder\.reconcileTrainingDataRefresh\(\(currentDraftPlan\) => \{/);
  assert.match(refreshReconciliation, /selectTrainingDataView\(result\.state, currentDraftPlan\)/);
  assert.doesNotMatch(refreshReconciliation, /selectTrainingDataView\(result\.state, trainingPlan\)/);
  assert.doesNotMatch(refreshReconciliation, /getVisibleTrainingDay\([^)]*activeRoutineDay/);

  assert.equal((sources.routineHook.match(/routineBuilderReducer/g) ?? []).length, 2);
  for (const modal of [
    "isNewCycleConfirmOpen",
    "isDeleteCycleConfirmOpen",
    "isRoutineSuccessOpen",
    "isRoutineUpdateConfirmOpen",
  ]) assert.match(sources.routineHook, new RegExp(`\\b${modal}\\b`));
  assert.match(sources.routineHook, /ROUTINE_DRAFT_VERSION/);
  assert.match(sources.routineHook, /activeStorageScope !== userKey/);
  assert.match(sources.routineHook, /export function useRoutineBuilderWorkflows\(/);
  assert.match(sources.routineHook, /export function reconcileRoutineBuilderTrainingDataState\(/);
  assert.match(
    sources.routineHook,
    /setTrainingDataState\(\s*createRoutineBuilderTrainingDataRefreshUpdater\(resolveView\),\s*\)/,
  );
  assert.match(
    sources.routineHook,
    /return \{ saveInitialRoutine, startNewTrainingCycle, deleteCurrentTrainingCycle \};/,
  );
  assert.doesNotMatch(sources.routineHook, /navigation\.(?:reset|transition|navigate)|setScreen|setHistory/);
  assert.doesNotMatch(sources.routineHook, /from "@\/features\/training-plan\//);
  const controllerApi = sources.routineHook.slice(
    sources.routineHook.indexOf("export interface RoutineBuilderController {"),
    sources.routineHook.indexOf("export function invalidateRoutineBuilderIdentity"),
  );
  assert.doesNotMatch(
    controllerApi,
    /\bdispatch\b|setDraftPlan|setActiveRoutineDay|setEditing|setReturnScreen|setNotice|setRoutineSuccessOpen|setRoutineUpdateConfirmOpen|setNewCycleConfirmOpen|setDeleteCycleConfirmOpen|prepareSave|clearDraft/,
  );

  assert.match(sources.owner, /tryAcquireSessionOperationOwner/);
  assert.match(sources.owner, /isSessionOperationOwnerCurrent/);
  assert.equal(
    (sources.owner.match(/isRequestCurrent: identity\.isRequestTokenCurrent/g) ?? []).length,
    3,
  );
  assert.match(sources.owner, /finalizeSessionOperationOwner/);
  assert.match(sources.owner, /lock\.current = result\.nextOwner/);
  assert.doesNotMatch(sources.owner, /owner\?: SessionOperationOwner/);

  assert.match(sources.progressHook, /snapshot\.key === key/);
  assert.match(sources.progressHook, /identity\.cycleId \?\? "legacy"/);
  assert.doesNotMatch(sources.progressHook, /\bmetrics\s*:|storedMetric|TOKEN_REFRESHED/);
  assert.doesNotMatch(sources.progressModel, /\bmetrics\s*:/);
  assert.doesNotMatch(sources.progressHook, /readonly selection:|dispatch\(action:/);
  assert.doesNotMatch(sources.planSources, /from "@\/features\/training-data\//);
  assert.equal((sources.planSources.match(/displayTrainingPlan:/g) ?? []).length, 2);

  assert.match(sources.selector, /function createBlockedView[\s\S]*?exercises: \[\],[\s\S]*?entries: \[\],[\s\S]*?sessions: \[\],/);
  assert.doesNotMatch(sources.completion, /ShareWorkoutCard|workout-share|navigator/);

  const baseRoot = execFileSync("git", ["show", `${BASE_SHA}:${files.root}`], { encoding: "utf8" });
  const baseCompletion = execFileSync("git", ["show", `${BASE_SHA}:${files.completion}`], { encoding: "utf8" });
  assert.equal(productiveJsxAst(sources.root), productiveJsxAst(baseRoot));
  assert.equal(productiveJsx(sources.root), productiveJsx(baseRoot));
  assert.equal(sources.completion, baseCompletion);
}

validate(readSources());

const probes: Array<{
  name: string;
  file: "routineHook" | "owner" | "progressHook";
  test: "routine" | "progress";
  find: string;
  replacement: string;
}> = [
  {
    name: "M2",
    file: "routineHook",
    test: "routine",
    find: "openModals: createClosedRoutineBuilderModals(),\n      };",
    replacement: "openModals: state.openModals,\n      };",
  },
  {
    name: "M3",
    file: "routineHook",
    test: "routine",
    find: "isEditingRoutinePlan: false,\n        routineEditorReturnScreen: null,\n        notice: \"\",",
    replacement: "isEditingRoutinePlan: state.isEditingRoutinePlan,\n        routineEditorReturnScreen: state.routineEditorReturnScreen,\n        notice: state.notice,",
  },
  {
    name: "M4",
    file: "routineHook",
    test: "routine",
    find: "if (!scope || input.activeStorageScope !== scope) return false;",
    replacement: "if (!scope) return false;",
  },
  {
    name: "M5",
    file: "routineHook",
    test: "routine",
    find: "export function invalidateRoutineBuilderIdentity(registry: RoutineBuilderOperationRegistry) {\n  registry.invalidateAll();\n}",
    replacement: "export function invalidateRoutineBuilderIdentity(_registry: RoutineBuilderOperationRegistry) {\n}",
  },
  {
    name: "M6",
    file: "routineHook",
    test: "routine",
    find: "export function disposeRoutineBuilderController(registry: RoutineBuilderOperationRegistry) {\n  registry.invalidateAll();\n}",
    replacement: "export function disposeRoutineBuilderController(_registry: RoutineBuilderOperationRegistry) {\n}",
  },
  {
    name: "M7",
    file: "progressHook",
    test: "progress",
    find: "state: progressControllerReducer(resolveProgressSelectionState(snapshot, key), action),",
    replacement: "state: progressControllerReducer(snapshot.state, action),",
  },
  {
    name: "M9",
    file: "owner",
    test: "routine",
    find: "    if (!registry.isCurrent(\"routine-save\", owner)) return { kind: \"stale\" };\n    const result = await registry.settle(\"routine-save\", owner, write());",
    replacement: "    const result = await registry.settle(\"routine-save\", owner, write());",
  },
  {
    name: "M10",
    file: "owner",
    test: "routine",
    find: "  return registry.finalize(\"routine-save\", owner);",
    replacement: "  return true;",
  },
  {
    name: "M12",
    file: "owner",
    test: "routine",
    find: "  if (!registry.isCurrent(\"cycle-delete\", owner)) return { kind: \"stale\" };\n  const result = await registry.settle(\"cycle-delete\", owner, write());",
    replacement: "  const result = await registry.settle(\"cycle-delete\", owner, write());",
  },
  {
    name: "M13",
    file: "routineHook",
    test: "routine",
    find: "      if (result.kind === \"discard\") {\n        return { kind: \"discard\" as const, shouldClearStoredDraft: true as const };\n      }",
    replacement: "      if (result.kind === \"discard\") {\n        return { kind: \"restore\" as const, setupDay: \"Lunes\", setupByDay: createSetupByDay(), recovery: { kind: \"full\" as const, discardedRowCount: 0 } };\n      }",
  },
  {
    name: "M14",
    file: "routineHook",
    test: "routine",
    find: "  const active = input.screen === \"registro-entrenamiento\" &&",
    replacement: "  const active = true || input.screen === \"registro-entrenamiento\" &&",
  },
  {
    name: "X4",
    file: "routineHook",
    test: "routine",
    find: "  const view = resolveView(current.draftPlan);",
    replacement: "  current = { draftPlan: createDefaultTrainingPlan(), activeRoutineDay: \"Lunes\" };\n  const view = resolveView(current.draftPlan);",
  },
];

const architectureProbes: Array<{
  name: "X1" | "X2" | "X3";
  file: "root" | "routineHook";
  find: string;
  replacement: string;
}> = [
  {
    name: "X1",
    file: "routineHook",
    find: "  replaceDraft(plan: TrainingPlan): void;",
    replacement: "  setDraftPlan(plan: TrainingPlan): void;",
  },
  {
    name: "X2",
    file: "root",
    find: "  async function executeRoutineSaveAdapter(",
    replacement: "  async function saveInitialRoutine(",
  },
  {
    name: "X3",
    file: "root",
    find: "  const {\n    displayTrainingPlan,\n  } = selectTrainingPlanSources(draftPlan, trainingDataView);",
    replacement: "  const [displayTrainingPlan] = [draftPlan];",
  },
];

const temporaryRoot = mkdtempSync(join(tmpdir(), "organizatech-p3-44-"));
try {
  for (const path of Object.values(files)) {
    const target = join(temporaryRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(path, target, { recursive: false });
  }
  const pristine = readSources(temporaryRoot);
  for (const probe of architectureProbes) {
    const path = join(temporaryRoot, files[probe.file]);
    const before = readFileSync(path, "utf8");
    const beforeHash = sha256(before);
    assert.ok(before.includes(probe.find), `${probe.name} encontró su seam arquitectónico`);
    writeFileSync(path, before.replace(probe.find, probe.replacement));
    assert.throws(
      () => validate(readSources(temporaryRoot)),
      `${probe.name} murió en el contrato productivo`,
    );
    writeFileSync(path, before);
    assert.equal(readFileSync(path, "utf8"), pristine[probe.file], `${probe.name} restauró byte a byte`);
    assert.equal(sha256(readFileSync(path, "utf8")), beforeHash, `${probe.name} restauró SHA-256`);
  }
  const routineTestPath = join(temporaryRoot, "routine-runtime.test.ts");
  const progressTestPath = join(temporaryRoot, "progress-runtime.test.ts");
  const routineTestSource = readFileSync(
    "src/features/routine-builder/model/routine-builder-operation-owner.test.ts",
    "utf8",
  );
  const progressTestSource = readFileSync(
    "src/features/progress/model/progress-selection-key.test.ts",
    "utf8",
  );
  const createRoutineTest = (ownerPath: string, hookPath: string) => routineTestSource
    .replace("\"./routine-builder-operation-owner\"", JSON.stringify(pathToFileURL(ownerPath).href))
    .replace(
      "\"@/features/routine-builder/hooks/useRoutineBuilderController\"",
      JSON.stringify(pathToFileURL(hookPath).href),
    );
  const createProgressTest = (hookPath: string) => progressTestSource
    .replace(
      "\"@/features/progress/hooks/useProgressController\"",
      JSON.stringify(pathToFileURL(hookPath).href),
    )
    .replace(
      "\"./progress-controller-state\"",
      JSON.stringify(pathToFileURL(join(process.cwd(), files.progressModel)).href),
    );
  const ownerPath = join(temporaryRoot, files.owner);
  const routineHookPath = join(temporaryRoot, files.routineHook);
  const progressHookPath = join(temporaryRoot, files.progressHook);
  writeFileSync(routineTestPath, createRoutineTest(ownerPath, routineHookPath));
  writeFileSync(progressTestPath, createProgressTest(progressHookPath));

  const mutationEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_PATH: join(process.cwd(), "node_modules"),
    TSX_DISABLE_CACHE: "1",
  };
  delete mutationEnvironment.NODE_TEST_CONTEXT;
  const runRuntimeTest = (path: string) => execFileSync(
    "npx",
    ["tsx", "--test", path],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: mutationEnvironment,
      stdio: "pipe",
      timeout: 15_000,
    },
  );
  assert.doesNotThrow(() => runRuntimeTest(routineTestPath), "baseline Routine Builder externo pasa");
  assert.doesNotThrow(() => runRuntimeTest(progressTestPath), "baseline Progress externo pasa");

  for (const probe of probes) {
    const path = join(temporaryRoot, files[probe.file]);
    const before = readFileSync(path, "utf8");
    const beforeHash = sha256(before);
    assert.ok(before.includes(probe.find), `${probe.name} encontró su seam`);
    const mutated = before.replace(probe.find, probe.replacement);
    assert.notEqual(mutated, before, `${probe.name} fue efectiva`);
    writeFileSync(path, mutated);
    const uniqueModulePath = `${path.slice(0, -3)}.${probe.name}.ts`;
    writeFileSync(uniqueModulePath, mutated);
    const uniqueTestPath = join(temporaryRoot, `${probe.name}.runtime.test.ts`);
    if (probe.test === "routine") {
      writeFileSync(uniqueTestPath, createRoutineTest(
        probe.file === "owner" ? uniqueModulePath : ownerPath,
        probe.file === "routineHook" ? uniqueModulePath : routineHookPath,
      ));
    } else {
      writeFileSync(uniqueTestPath, createProgressTest(uniqueModulePath));
    }
    assert.throws(
      () => runRuntimeTest(uniqueTestPath),
      `${probe.name} murió en runtime`,
    );
    writeFileSync(path, before);
    assert.equal(readFileSync(path, "utf8"), pristine[probe.file], `${probe.name} restauró byte a byte`);
    assert.equal(sha256(readFileSync(path, "utf8")), beforeHash, `${probe.name} restauró SHA-256`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

const mutationCount = architectureProbes.length + probes.length;
console.log(`P3-44 source contract and ${mutationCount}/${mutationCount} external mutation probes passed (14 previas + X4)`);
