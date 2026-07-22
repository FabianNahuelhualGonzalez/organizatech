import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createCycleHistoryAppController } from "@/lib/training/cycle-history/cycle-history-app-controller";
import type {
  CycleHistoryLoadCoordinator,
  CycleHistoryLoadState,
} from "@/lib/training/cycle-history/cycle-history-coordinator";
import type {
  CycleHistoryListResult,
  CycleHistoryService,
} from "@/lib/training/cycle-history/cycle-history-service";
import type { CycleHistoryCycleMetadata } from "@/lib/training/cycle-history/cycle-history-types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeCycle(cycleId: string, cycleNumber: number): CycleHistoryCycleMetadata {
  return {
    cycleId,
    name: `Ciclo ${cycleNumber}`,
    cycleNumber,
    cycleType: "mesociclo",
    status: "completed",
    plannedStartDate: "2026-06-01",
    plannedEndDate: "2026-06-28",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-28T00:00:00.000Z",
    durationWeeks: 4,
    trainingDayCount: cycleNumber === 1 ? null : 3,
  };
}

function createListService(results: Array<CycleHistoryListResult | Promise<CycleHistoryListResult>>) {
  let calls = 0;
  const service: CycleHistoryService = {
    async listCycles() {
      const result = results[Math.min(calls, results.length - 1)];
      calls += 1;
      return result;
    },
    async loadCycleDetail(cycleId) {
      return {
        status: "error",
        cycleId,
        error: { code: "unused", message: "Detalle controlado por el coordinator del test." },
      };
    },
  };
  return { service, getCalls: () => calls };
}

function createFakeCoordinator(
  loadImpl: (cycleId: string) => Promise<CycleHistoryLoadState> = async (cycleId) => ({
    status: "error",
    cycleId,
    error: { code: "detail_test", message: "No pudimos cargar el detalle de este ciclo." },
  }),
) {
  const loadCalls: string[] = [];
  const invalidatedCycles: string[] = [];
  let invalidateAllCalls = 0;
  let state: CycleHistoryLoadState = { status: "idle" };
  const coordinator: CycleHistoryLoadCoordinator = {
    getState: () => state,
    async load(cycleId) {
      loadCalls.push(cycleId);
      state = { status: "loading", cycleId };
      state = await loadImpl(cycleId);
      return state;
    },
    invalidateCycle(cycleId) {
      invalidatedCycles.push(cycleId);
      state = { status: "idle" };
    },
    invalidateAll() {
      invalidateAllCalls += 1;
      state = { status: "idle" };
    },
  };
  return {
    coordinator,
    loadCalls,
    invalidatedCycles,
    getInvalidateAllCalls: () => invalidateAllCalls,
  };
}

async function testDisabledDoesNotQueryRepositories() {
  const list = createListService([{ status: "ready", cycles: [makeCycle("cycle-a", 1)] }]);
  const detail = createFakeCoordinator();
  const controller = createCycleHistoryAppController({
    enabled: false,
    service: list.service,
    coordinator: detail.coordinator,
  });

  await controller.loadList();

  assert.equal(list.getCalls(), 0);
  assert.deepEqual(detail.loadCalls, []);
  assert.deepEqual(controller.getState(), {
    listState: { status: "disabled" },
    expandedCycleId: null,
    detailState: { status: "disabled" },
  });
}

async function testReadyPreservesOrderAndLoadsOnlyNewestDetail() {
  const newest = makeCycle("cycle-newest", 4);
  const older = makeCycle("cycle-older", 3);
  const list = createListService([{ status: "ready", cycles: [newest, older] }]);
  const detail = createFakeCoordinator();
  const controller = createCycleHistoryAppController({
    enabled: true,
    service: list.service,
    coordinator: detail.coordinator,
  });

  await controller.loadList();

  const state = controller.getState();
  assert.equal(state.listState.status, "ready");
  assert.deepEqual(
    state.listState.status === "ready" ? state.listState.cycles.map((cycle) => cycle.cycleId) : [],
    ["cycle-newest", "cycle-older"],
  );
  assert.equal(state.expandedCycleId, "cycle-newest");
  assert.deepEqual(detail.loadCalls, ["cycle-newest"], "no debe precargar todos los detalles");
}

async function testChangingSelectionLoadsCorrectCycleWithoutReordering() {
  const cycles = [makeCycle("cycle-newest", 4), makeCycle("cycle-older", 3)];
  const list = createListService([{ status: "ready", cycles }]);
  const detail = createFakeCoordinator();
  const controller = createCycleHistoryAppController({
    enabled: true,
    service: list.service,
    coordinator: detail.coordinator,
  });
  await controller.loadList();

  await controller.toggleCycle("cycle-older");

  const state = controller.getState();
  assert.equal(state.expandedCycleId, "cycle-older");
  assert.deepEqual(detail.loadCalls, ["cycle-newest", "cycle-older"]);
  assert.deepEqual(
    state.listState.status === "ready" ? state.listState.cycles.map((cycle) => cycle.cycleId) : [],
    ["cycle-newest", "cycle-older"],
  );

  await controller.toggleCycle("cycle-older");
  assert.equal(controller.getState().expandedCycleId, null);
  assert.deepEqual(detail.loadCalls, ["cycle-newest", "cycle-older"]);
}

async function testRefreshKeepsValidUserSelectionAndEmptyClearsIt() {
  const newest = makeCycle("cycle-newest", 4);
  const older = makeCycle("cycle-older", 3);
  const list = createListService([
    { status: "ready", cycles: [newest, older] },
    { status: "ready", cycles: [newest, older] },
    { status: "empty", cycles: [] },
  ]);
  const detail = createFakeCoordinator();
  const controller = createCycleHistoryAppController({
    enabled: true,
    service: list.service,
    coordinator: detail.coordinator,
  });
  await controller.loadList();
  await controller.toggleCycle("cycle-older");

  await controller.retryList();
  assert.equal(controller.getState().expandedCycleId, "cycle-older");
  assert.deepEqual(detail.loadCalls, ["cycle-newest", "cycle-older"]);

  await controller.retryList();
  assert.deepEqual(controller.getState(), {
    listState: { status: "empty", cycles: [] },
    expandedCycleId: null,
    detailState: { status: "idle" },
  });
}

async function testListAndDetailRetryAreIndependent() {
  const cycle = makeCycle("cycle-a", 1);
  const list = createListService([
    { status: "error", error: { code: "list_error", message: "No pudimos cargar el historial de ciclos." } },
    { status: "ready", cycles: [cycle] },
  ]);
  const detail = createFakeCoordinator();
  const controller = createCycleHistoryAppController({
    enabled: true,
    service: list.service,
    coordinator: detail.coordinator,
  });

  await controller.loadList();
  assert.equal(controller.getState().listState.status, "error");
  await controller.retryList();
  assert.equal(controller.getState().listState.status, "ready");

  await controller.retryCycle("cycle-a");
  assert.deepEqual(detail.invalidatedCycles, ["cycle-a"]);
  assert.deepEqual(detail.loadCalls, ["cycle-a", "cycle-a"]);
}

async function testInvalidationPreventsPreviousIdentityListFromReappearing() {
  const deferred = createDeferred<CycleHistoryListResult>();
  const list = createListService([deferred.promise]);
  const detail = createFakeCoordinator();
  const controller = createCycleHistoryAppController({
    enabled: true,
    service: list.service,
    coordinator: detail.coordinator,
  });

  const pending = controller.loadList();
  controller.invalidateAll();
  assert.deepEqual(controller.getState(), {
    listState: { status: "idle" },
    expandedCycleId: null,
    detailState: { status: "idle" },
  });

  deferred.resolve({ status: "ready", cycles: [makeCycle("previous-user-cycle", 9)] });
  await pending;
  assert.equal(controller.getState().listState.status, "idle");
  assert.equal(controller.getState().expandedCycleId, null);
  assert.equal(detail.getInvalidateAllCalls(), 1);
  assert.deepEqual(detail.loadCalls, []);
}

async function testInvalidationPreventsPreviousIdentityDetailFromReappearing() {
  const deferred = createDeferred<CycleHistoryLoadState>();
  const list = createListService([{ status: "ready", cycles: [makeCycle("shared-cycle", 1)] }]);
  const detail = createFakeCoordinator(() => deferred.promise);
  const controller = createCycleHistoryAppController({
    enabled: true,
    service: list.service,
    coordinator: detail.coordinator,
  });

  const pending = controller.loadList();
  await Promise.resolve();
  assert.equal(controller.getState().detailState.status, "loading");
  controller.invalidateAll();
  deferred.resolve({
    status: "error",
    cycleId: "shared-cycle",
    error: { code: "stale", message: "No debe volver a mostrarse." },
  });
  await pending;

  assert.deepEqual(controller.getState(), {
    listState: { status: "idle" },
    expandedCycleId: null,
    detailState: { status: "idle" },
  });
}

function testProductiveWiringContract() {
  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const containerSource = readFileSync(
    "src/components/training/cycle-history/CycleHistoryProductiveContainer.tsx",
    "utf8",
  );
  const qaSource = readFileSync(
    "src/app/qa/training-cycle-history/training-cycle-history-qa-client.tsx",
    "utf8",
  );

  assert.match(appSource, /import \{ CycleHistoryProductiveContainer \} from "@\/components\/training\/cycle-history";/);
  assert.match(appSource, /<CycleHistoryProductiveContainer/);
  assert.match(appSource, /enabled={isTrainingCyclesRepositoryActive}/);
  assert.match(appSource, /identityKey={supabaseUser\?\.id \?\? null}/);
  assert.doesNotMatch(appSource, /function CycleHistoryScreen\(/);
  assert.doesNotMatch(appSource, /function PersistedCycleHistoryScreen\(/);

  assert.match(containerSource, /createRepositoryCycleHistoryDataSource\(\)/);
  assert.match(containerSource, /createCycleHistoryService/);
  assert.match(containerSource, /createCycleHistoryLoadCoordinator/);
  assert.match(containerSource, /controller\.invalidateAll\(\)/);
  assert.match(containerSource, /onRetryList={\(\) => void controller\.retryList\(\)}/);
  assert.doesNotMatch(containerSource, /Blob|jsPDF|html2canvas|createObjectURL/);

  assert.match(qaSource, /export function TrainingCycleHistoryQaClient/);
  assert.doesNotMatch(qaSource, /CycleHistoryProductiveContainer/);
}

async function run() {
  await testDisabledDoesNotQueryRepositories();
  await testReadyPreservesOrderAndLoadsOnlyNewestDetail();
  await testChangingSelectionLoadsCorrectCycleWithoutReordering();
  await testRefreshKeepsValidUserSelectionAndEmptyClearsIt();
  await testListAndDetailRetryAreIndependent();
  await testInvalidationPreventsPreviousIdentityListFromReappearing();
  await testInvalidationPreventsPreviousIdentityDetailFromReappearing();
  testProductiveWiringContract();
  console.log("cycle-history-app-controller tests passed");
}

void run();
