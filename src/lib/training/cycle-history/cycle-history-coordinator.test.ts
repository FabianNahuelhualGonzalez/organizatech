import assert from "node:assert/strict";

import { createCycleHistoryLoadCoordinator } from "@/lib/training/cycle-history/cycle-history-coordinator";
import type {
  CycleHistoryDetail,
  CycleHistoryDetailResult,
} from "@/lib/training/cycle-history/cycle-history-service";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeDetail(cycleId: string): CycleHistoryDetail {
  const metadata = {
    cycleId,
    name: `Ciclo ${cycleId}`,
    cycleNumber: 1,
    cycleType: null,
    status: "completed" as const,
    plannedStartDate: "2026-06-01",
    plannedEndDate: "2026-06-28",
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-28T00:00:00.000Z",
    durationWeeks: 4,
    trainingDayCount: 3,
  };
  const breakdown = { cycleId, routines: [], weeksWithData: [] };
  const metrics = {
    totalVolumeKg: 0,
    registeredExerciseCount: 0,
    weeklyVolumeKg: {},
    volumeProgress: {
      state: "insufficient_data" as const,
      firstWeek: null,
      lastWeek: null,
      firstWeekVolume: null,
      lastWeekVolume: null,
      differenceKg: null,
    },
  };

  return {
    metadata,
    plan: { cycleId, routines: [] },
    breakdown,
    metrics,
    pdfModel: {
      generatedAt: "2026-07-21T00:00:00.000Z",
      filename: `cycle-${cycleId}.pdf`,
      personalData: {
        fullName: null,
        email: null,
        birthDate: null,
        age: null,
        gender: null,
        phoneNumber: null,
      },
      cycle: {
        cycleId,
        name: metadata.name,
        cycleNumber: 1,
        cycleType: null,
        status: "completed",
        plannedStartDate: metadata.plannedStartDate,
        plannedEndDate: metadata.plannedEndDate,
        durationWeeks: 4,
        weeksWithDataCount: 0,
      },
      metrics: { ...metrics, volumeProgressText: "Sin datos" },
      routines: [],
    },
    sessionCount: 0,
    entryCount: 0,
  };
}

function ready(cycleId: string): CycleHistoryDetailResult {
  return { status: "ready", cycleId, data: makeDetail(cycleId) };
}

async function testCacheHitByCycleId() {
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls += 1;
      return ready(cycleId);
    },
  });
  await coordinator.load("cycle-a");
  const second = await coordinator.load("cycle-a");
  assert.equal(calls, 1);
  assert.equal(second.status, "ready");
}

async function testConcurrentRequestsForSameCycleAreDeduplicated() {
  const deferred = createDeferred<CycleHistoryDetailResult>();
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail() {
      calls += 1;
      return deferred.promise;
    },
  });
  const first = coordinator.load("cycle-a");
  const second = coordinator.load("cycle-a");
  await Promise.resolve();
  assert.equal(calls, 1);
  deferred.resolve(ready("cycle-a"));
  await Promise.all([first, second]);
  assert.equal(coordinator.getState().status, "ready");
}

async function testInvalidateCycleForcesReload() {
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls += 1;
      return ready(cycleId);
    },
  });
  await coordinator.load("cycle-a");
  coordinator.invalidateCycle("cycle-a");
  assert.deepEqual(coordinator.getState(), { status: "idle" });
  await coordinator.load("cycle-a");
  assert.equal(calls, 2);
}

async function testInvalidateAllClearsEveryCycle() {
  const calls = new Map<string, number>();
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls.set(cycleId, (calls.get(cycleId) ?? 0) + 1);
      return ready(cycleId);
    },
  });
  await coordinator.load("cycle-a");
  await coordinator.load("cycle-b");
  coordinator.invalidateAll();
  assert.deepEqual(coordinator.getState(), { status: "idle" });
  await coordinator.load("cycle-a");
  await coordinator.load("cycle-b");
  assert.equal(calls.get("cycle-a"), 2);
  assert.equal(calls.get("cycle-b"), 2);
}

async function testLateCycleACannotReplaceCycleB() {
  const cycleA = createDeferred<CycleHistoryDetailResult>();
  const cycleB = createDeferred<CycleHistoryDetailResult>();
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      return cycleId === "cycle-a" ? cycleA.promise : cycleB.promise;
    },
  });

  const loadA = coordinator.load("cycle-a");
  const loadB = coordinator.load("cycle-b");
  cycleB.resolve(ready("cycle-b"));
  await loadB;
  assert.deepEqual(coordinator.getState(), {
    status: "ready",
    cycleId: "cycle-b",
    data: makeDetail("cycle-b"),
  });

  cycleA.resolve(ready("cycle-a"));
  const staleResult = await loadA;
  assert.equal(staleResult.status, "ready");
  assert.equal("cycleId" in staleResult ? staleResult.cycleId : null, "cycle-b");
  const activeState = coordinator.getState();
  assert.equal("cycleId" in activeState ? activeState.cycleId : null, "cycle-b");
}

async function testErrorsAreNotCached() {
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls += 1;
      if (calls === 1) throw new Error("select secret_column from private_table");
      return ready(cycleId);
    },
  });
  const failed = await coordinator.load("cycle-a");
  assert.equal(failed.status, "error");
  assert.doesNotMatch(JSON.stringify(failed), /secret_column|private_table/);
  assert.equal((await coordinator.load("cycle-a")).status, "ready");
  assert.equal(calls, 2);
}

async function testInvalidatedInFlightResponseIsNotCached() {
  const first = createDeferred<CycleHistoryDetailResult>();
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls += 1;
      return calls === 1 ? first.promise : ready(cycleId);
    },
  });
  const staleLoad = coordinator.load("cycle-a");
  coordinator.invalidateCycle("cycle-a");
  first.resolve(ready("cycle-a"));
  await staleLoad;
  assert.deepEqual(coordinator.getState(), { status: "idle" });
  await coordinator.load("cycle-a");
  assert.equal(calls, 2);
}

async function testInvalidateAllProtectsNextSessionContext() {
  const previousSession = createDeferred<CycleHistoryDetailResult>();
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls += 1;
      return calls === 1 ? previousSession.promise : ready(cycleId);
    },
  });
  const staleLoad = coordinator.load("shared-cycle-id");
  coordinator.invalidateAll();
  previousSession.resolve(ready("shared-cycle-id"));
  await staleLoad;
  await coordinator.load("shared-cycle-id");
  assert.equal(calls, 2);
  assert.equal(coordinator.getState().status, "ready");
}

async function testDisabledStateIsNotCachedAsCycleData() {
  let calls = 0;
  const coordinator = createCycleHistoryLoadCoordinator({
    async loadCycleDetail(cycleId) {
      calls += 1;
      return calls === 1 ? { status: "disabled" } : ready(cycleId);
    },
  });
  assert.deepEqual(await coordinator.load("cycle-a"), { status: "disabled" });
  assert.equal((await coordinator.load("cycle-a")).status, "ready");
  assert.equal(calls, 2);
}

async function run() {
  await testCacheHitByCycleId();
  await testConcurrentRequestsForSameCycleAreDeduplicated();
  await testInvalidateCycleForcesReload();
  await testInvalidateAllClearsEveryCycle();
  await testLateCycleACannotReplaceCycleB();
  await testErrorsAreNotCached();
  await testInvalidatedInFlightResponseIsNotCached();
  await testInvalidateAllProtectsNextSessionContext();
  await testDisabledStateIsNotCachedAsCycleData();

  console.log("cycle-history-coordinator tests passed");
}

void run();
