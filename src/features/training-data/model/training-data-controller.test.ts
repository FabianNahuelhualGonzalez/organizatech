import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createTrainingDataController,
  type TrainingDataController,
} from "@/features/training-data/model/training-data-controller";
import {
  selectTrainingDataView,
} from "@/features/training-data/model/training-data-selectors";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  type SessionDataEpoch,
} from "@/lib/session/session-data-epoch";
import type { CycleScopedTrainingPlan } from "@/lib/training/cycle-scoped-training-repository";
import type { TrainingDataSource } from "@/lib/training/training-data-source";
import type { TrainingCycle } from "@/lib/training/training-cycles-repository";
import { createDefaultTrainingPlan } from "@/lib/training/training-plan-rules";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createIdentityHarness(userId = "user-a") {
  let epoch: SessionDataEpoch = createSessionDataEpoch({
    userId,
    scope: `supabase:${userId}`,
  });
  return {
    identity: {
      captureRequestToken: () => captureSessionDataRequestToken(epoch),
      isRequestTokenCurrent: (token: ReturnType<typeof captureSessionDataRequestToken>) =>
        isSessionDataRequestTokenCurrent(epoch, token),
    },
    advance(nextUserId: string | null, force = false) {
      epoch = advanceSessionDataEpoch(epoch, {
        userId: nextUserId,
        scope: nextUserId ? `supabase:${nextUserId}` : null,
      }, { force });
    },
    capture() {
      return captureSessionDataRequestToken(epoch);
    },
  };
}

function createCycle(id: string, source = "cycle-scoped"): TrainingCycle {
  return {
    id,
    name: `Ciclo ${id}`,
    cycleNumber: 1,
    cycleType: "meso",
    goal: "Hipertrofia",
    startedAt: "2026-08-03T00:00:00.000Z",
    endedAt: null,
    plannedStartDate: "2026-08-03",
    plannedEndDate: "2026-08-31",
    status: "active",
    planSnapshot: { source, cycleType: "meso", durationWeeks: 4 },
    summarySnapshot: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    deletedAt: null,
  };
}

function createPlan(cycleId: string, empty = false): CycleScopedTrainingPlan {
  return {
    routines: empty ? [] : [{
      id: `routine-${cycleId}`,
      cycleId,
      name: "Torso",
      sortOrder: 0,
      notes: null,
      days: [{
        id: `day-${cycleId}`,
        cycleId,
        routineId: `routine-${cycleId}`,
        weekIndex: 1,
        dayCode: "monday",
        sortOrder: 0,
        notes: null,
        exercises: [{
          id: `exercise-${cycleId}`,
          cycleId,
          dayId: `day-${cycleId}`,
          name: `Press ${cycleId}`,
          targetSets: 3,
          targetReps: 8,
          baseWeight: 50,
          sideWeight: null,
          sortOrder: 0,
          notes: null,
          sourceLegacyExerciseId: null,
          exerciseLineageId: `lineage-${cycleId}`,
        }],
      }],
    }],
  };
}

function createSession(id: string) {
  return {
    id,
    routineId: "routine-a",
    routine: "Torso",
    weekNumber: 1,
    calendarWeekStart: "2026-08-03",
    plannedDay: "monday" as const,
    plannedDate: "2026-08-03",
    trainedDate: "2026-08-03",
    trainedAt: "2026-08-03",
    status: "completed" as const,
    entries: [{
      id: `entry-${id}`,
      sessionId: id,
      exerciseId: "exercise-a",
      exerciseName: "Press",
      routine: "Torso",
      week: 1,
      date: "2026-08-03",
      targetSets: 3,
      targetReps: 8,
      weight: 50,
      previousWeight: 45,
      reps: [8, 8, 8],
    }],
  };
}

function appData(label: string) {
  return {
    exercises: [{
      id: `exercise-${label}`,
      routine: "Torso",
      name: `Press ${label}`,
      targetSets: 3,
      targetReps: 8,
      baseWeight: 50,
      day: "Lunes",
    }],
    entries: [],
    sessions: [],
    source: "supabase" as const,
  };
}

function createController(
  identityHarness: ReturnType<typeof createIdentityHarness>,
  source: TrainingDataSource,
): TrainingDataController {
  return createTrainingDataController({
    identity: identityHarness.identity,
    source,
    translateCycleError: (error) => error instanceof Error ? error.message : "cycle error",
  });
}

function unreachableSource(overrides: Partial<TrainingDataSource>): TrainingDataSource {
  return {
    loadAppData: async () => appData("default"),
    loadCycles: async () => ({ active: null, history: [] }),
    loadCyclePlan: async (cycleId) => createPlan(cycleId),
    loadCycleSessions: async () => ({ sessions: [], entries: [] }),
    ...overrides,
  };
}

async function testLatestAppDataAndStaleFinally() {
  const identity = createIdentityHarness();
  const first = deferred<ReturnType<typeof appData>>();
  const second = deferred<ReturnType<typeof appData>>();
  const queue = [first, second];
  const controller = createController(identity, unreachableSource({
    loadAppData: () => queue.shift()!.promise,
  }));
  controller.reset({ cyclesEnabled: false });

  const requestA = controller.refreshAppData("supabase");
  const requestB = controller.refreshAppData("supabase");
  second.resolve(appData("b"));
  assert.equal((await requestB).kind, "success");
  first.resolve(appData("a"));
  assert.equal((await requestA).kind, "stale");
  assert.equal(controller.getState().appData.status, "ready");
  const state = controller.getState();
  assert.equal(state.appData.status === "ready" ? state.appData.data.exercises[0]?.name : null, "Press b");

  const third = deferred<ReturnType<typeof appData>>();
  const fourth = deferred<ReturnType<typeof appData>>();
  queue.push(third, fourth);
  const staleRequest = controller.refreshAppData("supabase");
  const currentRequest = controller.refreshAppData("supabase");
  third.resolve(appData("stale"));
  assert.equal((await staleRequest).kind, "stale");
  assert.equal(controller.getState().appData.status, "loading", "un settle stale no apaga loading nuevo");
  fourth.resolve(appData("current"));
  assert.equal((await currentRequest).kind, "success");
}

async function testCycleRequestIdCycleIdAndAtomicPublication() {
  const identity = createIdentityHarness();
  const planA1 = deferred<CycleScopedTrainingPlan>();
  const planA2 = deferred<CycleScopedTrainingPlan>();
  const planA3 = deferred<CycleScopedTrainingPlan>();
  const planB = deferred<CycleScopedTrainingPlan>();
  const plans = [planA1, planA2, planA3, planB];
  const sessionA2 = deferred<{ sessions: ReturnType<typeof createSession>[]; entries: [] }>();
  const sessionB = deferred<{ sessions: ReturnType<typeof createSession>[]; entries: [] }>();
  const sessions = [sessionA2, sessionB];
  const controller = createController(identity, unreachableSource({
    loadCyclePlan: () => plans.shift()!.promise,
    loadCycleSessions: () => sessions.shift()!.promise,
  }));

  const firstA = controller.reloadCycleSnapshot("cycle-a");
  const secondA = controller.reloadCycleSnapshot("cycle-a");
  planA2.resolve(createPlan("cycle-a"));
  await Promise.resolve();
  assert.equal(controller.getState().cycleScoped.status, "loading", "resolver plan no publica snapshot parcial");
  sessionA2.resolve({ sessions: [createSession("session-a2")], entries: [] });
  assert.equal((await secondA).kind, "success");
  const readyA = controller.getState().cycleScoped;
  assert.equal(readyA.status, "ready");
  if (readyA.status === "ready") {
    assert.equal("exercises" in readyA.snapshot, false, "exercises se derivan del plan y no forman un segundo canon");
    assert.equal(readyA.snapshot.sessions[0]?.id, "session-a2");
  }
  planA1.resolve(createPlan("cycle-a"));
  assert.equal((await firstA).kind, "stale", "requestId protege el mismo cycleId");

  const requestA = controller.reloadCycleSnapshot("cycle-a");
  const requestB = controller.reloadCycleSnapshot("cycle-b");
  planB.resolve(createPlan("cycle-b"));
  sessionB.resolve({ sessions: [createSession("session-b")], entries: [] });
  assert.equal((await requestB).kind, "success");
  // requestA no tiene un deferred restante: queda stale después de cambiar el cycleId.
  assert.equal(controller.getState().cycleScoped.status, "ready");
  const current = controller.getState().cycleScoped;
  assert.equal(current.status === "ready" ? current.cycleId : null, "cycle-b");
  controller.reset({ cyclesEnabled: false });
  planA3.resolve(createPlan("cycle-a"));
  assert.equal((await requestA).kind, "stale");
}

async function testIdentityEpochAndReentry() {
  const identity = createIdentityHarness("user-a");
  const requestA = deferred<ReturnType<typeof appData>>();
  const requestB = deferred<ReturnType<typeof appData>>();
  const requestAReentry = deferred<ReturnType<typeof appData>>();
  const queue = [requestA, requestB, requestAReentry];
  const controller = createController(identity, unreachableSource({
    loadAppData: () => queue.shift()!.promise,
  }));

  const loadA = controller.refreshAppData("supabase");
  identity.advance(null, true);
  controller.reset({ cyclesEnabled: false });
  identity.advance("user-b");
  controller.reset({ cyclesEnabled: false });
  const loadB = controller.refreshAppData("supabase");
  requestA.resolve(appData("late-a"));
  assert.equal((await loadA).kind, "stale", "A no publica después de SIGNED_OUT/B");
  requestB.resolve(appData("b"));
  assert.equal((await loadB).kind, "success");

  identity.advance(null, true);
  controller.reset({ cyclesEnabled: false });
  identity.advance("user-a");
  controller.reset({ cyclesEnabled: false });
  const loadAAgain = controller.refreshAppData("supabase");
  requestAReentry.resolve(appData("a-reentry"));
  assert.equal((await loadAAgain).kind, "success", "el mismo user reingresa con generation nueva");
}

async function testDuplicateBootstrapLatestWins() {
  const identity = createIdentityHarness();
  const appA = deferred<ReturnType<typeof appData>>();
  const appB = deferred<ReturnType<typeof appData>>();
  const cyclesA = deferred<{ active: null; history: [] }>();
  const cyclesB = deferred<{ active: null; history: [] }>();
  const appQueue = [appA, appB];
  const cyclesQueue = [cyclesA, cyclesB];
  const controller = createController(identity, unreachableSource({
    loadAppData: () => appQueue.shift()!.promise,
    loadCycles: () => cyclesQueue.shift()!.promise,
  }));
  controller.reset({ cyclesEnabled: true });

  const bootstrap = controller.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  const initialSession = controller.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  appB.resolve(appData("initial-session"));
  cyclesB.resolve({ active: null, history: [] });
  assert.equal((await initialSession).kind, "success");
  appA.resolve(appData("late-bootstrap"));
  cyclesA.resolve({ active: null, history: [] });
  assert.equal((await bootstrap).kind, "stale");
  const current = controller.getState().appData;
  assert.equal(
    current.status === "ready" ? current.data.exercises[0]?.name : null,
    "Press initial-session",
  );
}

async function testLifecycleInvalidatesEveryLane() {
  const identity = createIdentityHarness();
  const app = deferred<ReturnType<typeof appData>>();
  const cycles = deferred<{ active: null; history: [] }>();
  const controller = createController(identity, unreachableSource({
    loadAppData: () => app.promise,
    loadCycles: () => cycles.promise,
  }));
  controller.reset({ cyclesEnabled: true });
  const pendingApp = controller.refreshAppData("supabase");
  const pendingCycles = controller.refreshCycles();
  controller.reset({ cyclesEnabled: false });
  app.resolve(appData("late-reset"));
  cycles.resolve({ active: null, history: [] });
  assert.equal((await pendingApp).kind, "stale");
  assert.equal((await pendingCycles).kind, "stale");

  const unmountApp = deferred<ReturnType<typeof appData>>();
  const unmountController = createController(identity, unreachableSource({
    loadAppData: () => unmountApp.promise,
  }));
  const pendingUnmount = unmountController.refreshAppData("supabase");
  unmountController.invalidateAll();
  unmountApp.resolve(appData("late-unmount"));
  assert.equal((await pendingUnmount).kind, "stale");
}

async function testCycleCompletionRefreshesOnlySelectedCycle() {
  const identity = createIdentityHarness();
  let activeCycle = createCycle("cycle-a");
  const lateSessions = deferred<{ sessions: ReturnType<typeof createSession>[]; entries: [] }>();
  let sessionLoadCount = 0;
  const controller = createController(identity, unreachableSource({
    loadCycles: async () => ({ active: activeCycle, history: [] }),
    loadCycleSessions: async (cycleId) => {
      if (cycleId === "cycle-b") return { sessions: [], entries: [] };
      sessionLoadCount += 1;
      if (sessionLoadCount === 1) return { sessions: [], entries: [] };
      return lateSessions.promise;
    },
  }));
  controller.reset({ cyclesEnabled: true });
  assert.equal((await controller.refreshCycles()).kind, "success");
  const completionRefresh = controller.reloadCycleSessions("cycle-a");
  activeCycle = createCycle("cycle-b");
  assert.equal((await controller.refreshCycles()).kind, "success");
  lateSessions.resolve({ sessions: [createSession("late-cycle-a")], entries: [] });
  assert.equal((await completionRefresh).kind, "stale");
  assert.equal((await controller.reloadCycleSessions("cycle-a")).kind, "stale");
}

async function testCycleScopedLoadingBlocksLoadedLegacyData() {
  const identity = createIdentityHarness();
  const cycleId = "cycle-loading";
  const activeCycle = createCycle(cycleId);
  const pendingPlan = deferred<CycleScopedTrainingPlan>();
  const pendingSessions = deferred<Awaited<ReturnType<TrainingDataSource["loadCycleSessions"]>>>();
  const legacySession = createSession("legacy-loaded");
  const legacyData = {
    ...appData("legacy-loaded"),
    entries: [...legacySession.entries],
    sessions: [legacySession],
  };
  const legacyPlan = {
    ...createDefaultTrainingPlan(),
    mesoObjective: "Resistencia",
  };
  const scopedSession = createSession("scoped-current");
  scopedSession.routineId = `routine-${cycleId}`;
  scopedSession.entries[0]!.exerciseId = `exercise-${cycleId}`;
  scopedSession.entries[0]!.exerciseName = `Press ${cycleId}`;

  const controller = createController(identity, unreachableSource({
    loadAppData: async () => legacyData,
    loadCycles: async () => ({ active: activeCycle, history: [] }),
    loadCyclePlan: () => pendingPlan.promise,
    loadCycleSessions: () => pendingSessions.promise,
  }));
  controller.reset({ cyclesEnabled: false });
  assert.equal((await controller.refreshAppData("supabase")).kind, "success");

  const loadedLegacyResource = controller.getState().appData;
  assert.equal(loadedLegacyResource.status, "ready");
  if (loadedLegacyResource.status !== "ready") return;
  assert.equal(loadedLegacyResource.data.exercises[0]?.id, "exercise-legacy-loaded");
  assert.equal(loadedLegacyResource.data.entries[0]?.id, "entry-legacy-loaded");
  assert.equal(loadedLegacyResource.data.sessions[0]?.id, "legacy-loaded");
  const loadedLegacyView = selectTrainingDataView(controller.getState(), legacyPlan);
  assert.equal(loadedLegacyView.mode, "legacy");
  assert.equal(loadedLegacyView.plan.mesoObjective, "Resistencia");

  const emittedModes: string[] = [];
  const unsubscribe = controller.subscribe((state) => {
    emittedModes.push(selectTrainingDataView(state, legacyPlan).mode);
  });
  const cycleRefresh = controller.refreshCycles();
  await Promise.resolve();

  const loadingState = controller.getState();
  assert.equal(loadingState.cycles.status, "ready", "el ciclo activo ya fue confirmado");
  assert.equal(
    loadingState.cycles.status === "ready" ? loadingState.cycles.data.active?.id : null,
    cycleId,
  );
  assert.equal(loadingState.cycleScoped.status, "loading", "el snapshot sigue pendiente");
  const loadingView = selectTrainingDataView(loadingState, legacyPlan);
  assert.equal(loadingView.mode, "blocked");
  if (loadingView.mode !== "blocked") return;
  assert.equal(loadingView.reason, "cycle-loading");
  assert.equal(loadingView.exercises.length, 0);
  assert.equal(loadingView.entries.length, 0);
  assert.equal(loadingView.sessions.length, 0);
  assert.equal(loadedLegacyResource.data.exercises.length, 1, "legacy existe pero permanece oculto");
  assert.equal(loadedLegacyResource.data.entries.length, 1, "entries legacy existen pero permanecen ocultas");
  assert.equal(loadedLegacyResource.data.sessions.length, 1, "sessions legacy existen pero permanecen ocultas");

  pendingPlan.resolve(createPlan(cycleId));
  await Promise.resolve();
  assert.equal(controller.getState().cycleScoped.status, "loading", "resolver plan no publica parcialmente");
  assert.equal(selectTrainingDataView(controller.getState(), legacyPlan).mode, "blocked");
  assert.doesNotMatch(emittedModes.join(","), /legacy/, "no existe emision legacy durante la carga scoped");

  pendingSessions.resolve({
    sessions: [scopedSession],
    entries: [...scopedSession.entries],
  });
  assert.equal((await cycleRefresh).kind, "success");
  unsubscribe();

  const readyView = selectTrainingDataView(controller.getState(), legacyPlan);
  assert.equal(readyView.mode, "cycle-scoped");
  assert.equal(readyView.activeCycle?.id, cycleId);
  assert.equal(readyView.plan.mesoObjective, activeCycle.goal);
  assert.equal(readyView.cyclePlan?.routines[0]?.cycleId, cycleId);
  assert.equal(readyView.exercises[0]?.id, `exercise-${cycleId}`);
  assert.equal(readyView.entries[0]?.exerciseId, `exercise-${cycleId}`);
  assert.equal(readyView.sessions[0]?.id, "scoped-current");
  assert.deepEqual(emittedModes, ["blocked", "blocked", "blocked", "cycle-scoped"]);
}

async function testBlockedMatrixAndNoLegacyFallback() {
  const identity = createIdentityHarness();
  const activeCycle = createCycle("cycle-a");
  const cycleError = new Error("No pudimos resolver el ciclo activo.");
  const errorController = createController(identity, unreachableSource({
    loadAppData: async () => appData("legacy"),
    loadCycles: async () => { throw cycleError; },
  }));
  errorController.reset({ cyclesEnabled: true });
  const errorResult = await errorController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.equal(errorResult.kind, "error");
  const errorView = selectTrainingDataView(errorController.getState(), createDefaultTrainingPlan());
  assert.equal(errorView.mode, "blocked");
  assert.deepEqual(errorView.exercises, [], "error de ciclos no filtra legacy");

  const emptyController = createController(identity, unreachableSource({
    loadAppData: async () => appData("legacy"),
    loadCycles: async () => ({ active: activeCycle, history: [] }),
    loadCyclePlan: async () => createPlan(activeCycle.id, true),
    loadCycleSessions: async () => ({ sessions: [], entries: [] }),
  }));
  emptyController.reset({ cyclesEnabled: true });
  const emptyResult = await emptyController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.equal(emptyResult.kind, "success");
  const emptyView = selectTrainingDataView(emptyController.getState(), createDefaultTrainingPlan());
  assert.equal(emptyView.mode, "blocked");
  assert.deepEqual(emptyView.exercises, []);

  const demoController = createController(identity, unreachableSource({
    loadAppData: async () => appData("demo"),
  }));
  demoController.reset({ cyclesEnabled: false });
  await demoController.refreshForIdentity({ mode: "demo", cyclesEnabled: false });
  assert.equal(selectTrainingDataView(demoController.getState(), createDefaultTrainingPlan()).mode, "legacy");

  const supabaseWithoutCycles = createController(identity, unreachableSource({
    loadAppData: async () => appData("supabase-without-cycles"),
  }));
  supabaseWithoutCycles.reset({ cyclesEnabled: false });
  await supabaseWithoutCycles.refreshForIdentity({ mode: "supabase", cyclesEnabled: false });
  assert.equal(
    selectTrainingDataView(supabaseWithoutCycles.getState(), createDefaultTrainingPlan()).mode,
    "legacy",
  );

  const noCycleController = createController(identity, unreachableSource({
    loadCycles: async () => ({ active: null, history: [] }),
  }));
  noCycleController.reset({ cyclesEnabled: true });
  await noCycleController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.equal(selectTrainingDataView(noCycleController.getState(), createDefaultTrainingPlan()).mode, "legacy");

  const legacyCycleController = createController(identity, unreachableSource({
    loadCycles: async () => ({ active: createCycle("legacy", "ui-main-production"), history: [] }),
  }));
  legacyCycleController.reset({ cyclesEnabled: true });
  await legacyCycleController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.equal(selectTrainingDataView(legacyCycleController.getState(), createDefaultTrainingPlan()).mode, "legacy");

  const readyController = createController(identity, unreachableSource({
    loadCycles: async () => ({ active: activeCycle, history: [] }),
  }));
  readyController.reset({ cyclesEnabled: true });
  await readyController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  const readyView = selectTrainingDataView(readyController.getState(), createDefaultTrainingPlan());
  assert.equal(readyView.mode, "cycle-scoped");
  assert.equal(readyView.plan.mesoObjective, activeCycle.goal, "display plan se deriva del ciclo persistido");
  assert.equal(readyView.exercises[0]?.name, "Press cycle-a", "exercises se derivan del plan atomico");
}

async function testTypedPostWriteCommandsInvalidateReads() {
  const identity = createIdentityHarness();
  const initial = deferred<ReturnType<typeof appData>>();
  const initialController = createController(identity, unreachableSource({
    loadAppData: () => initial.promise,
  }));
  initialController.reset({ cyclesEnabled: false });
  const initialLoad = initialController.refreshAppData("supabase");
  initial.resolve(appData("initial"));
  await initialLoad;
  const staleRead = initialController.refreshAppData("supabase");
  assert.equal(initialController.appendLegacySession(createSession("saved"), identity.capture()), true);
  assert.equal((await staleRead).kind, "stale", "append invalida una lectura legacy anterior");
  assert.equal(initialController.getState().appData.status, "ready");
  const afterAppend = initialController.getState().appData;
  assert.equal(afterAppend.status === "ready" ? afterAppend.data.sessions[0]?.id : null, "saved");
  assert.equal(initialController.appendLegacySession(createSession("saved"), identity.capture()), true);
  const afterDuplicateAppend = initialController.getState().appData;
  assert.equal(
    afterDuplicateAppend.status === "ready" ? afterDuplicateAppend.data.sessions.length : 0,
    1,
    "completion legacy agrega exactamente una sesion",
  );
  initialController.clearForCycleSetup(identity.capture());
  const afterClear = initialController.getState().appData;
  assert.deepEqual(afterClear.status === "ready" ? afterClear.data.sessions : null, []);
  initialController.invalidateAll();

  const pendingPlan = deferred<CycleScopedTrainingPlan>();
  const pendingCycles = deferred<{ active: null; history: [] }>();
  const invalidationController = createController(identity, unreachableSource({
    loadCyclePlan: () => pendingPlan.promise,
    loadCycles: () => pendingCycles.promise,
  }));
  invalidationController.reset({ cyclesEnabled: true });
  const staleCycleSnapshot = invalidationController.reloadCycleSnapshot("cycle-a");
  const staleCycles = invalidationController.refreshCycles();
  invalidationController.clearForCycleSetup(identity.capture());
  pendingPlan.resolve(createPlan("cycle-a"));
  pendingCycles.resolve({ active: null, history: [] });
  assert.equal((await staleCycleSnapshot).kind, "stale");
  assert.equal((await staleCycles).kind, "stale");
}

interface BoundaryContractSources {
  controller: string;
  owner: string;
  selectors: string;
  state: string;
  app: string;
}

function assertTrainingDataBoundarySourceContract(sources: BoundaryContractSources) {
  assert.match(sources.owner, /requestToken: identity\.captureRequestToken\(\)/);
  assert.match(sources.owner, /owner\.lifecycle === lifecycle/);
  assert.match(sources.owner, /owner\.requestId === latestRequestIds\[owner\.resource\]/);
  assert.match(sources.owner, /identity\.isRequestTokenCurrent\(owner\.requestToken\)/);
  assert.match(sources.owner, /owner\.cycleId === selectedCycleId/);
  assert.match(sources.controller, /owners\.isCurrent\(owner\)/);
  assert.doesNotMatch(
    sources.controller,
    /finally\s*\{[\s\S]*?publish\(/,
    "un finally no puede publicar ni apagar loading sin validar el owner",
  );

  const planAwait = sources.controller.indexOf("const plan = await source.loadCyclePlan(cycleId);");
  const sessionsAwait = sources.controller.indexOf(
    "const sessionData = await source.loadCycleSessions(cycleId, plan);",
    planAwait,
  );
  assert.ok(planAwait >= 0 && sessionsAwait > planAwait, "plan y sessions deben cargarse en orden");
  assert.doesNotMatch(
    sources.controller.slice(planAwait, sessionsAwait),
    /publish\(/,
    "el plan aislado no puede publicarse antes de sessions",
  );
  assert.match(sources.controller.slice(sessionsAwait), /const snapshot: CycleScopedTrainingDataSnapshot/);

  assert.doesNotMatch(
    sources.state.match(/export interface CycleScopedTrainingDataSnapshot \{[\s\S]*?\n\}/)?.[0] ?? "",
    /\bexercises\s*:/,
    "el snapshot no mantiene un segundo canon de exercises",
  );
  assert.match(
    sources.selectors,
    /if \(state\.cycles\.status === "error"\) \{\s*return createBlockedView\(/,
  );
  assert.match(
    sources.selectors,
    /if \(state\.cycleScoped\.status === "error"\) \{\s*return createBlockedView\(/,
  );
  assert.doesNotMatch(
    sources.app,
    /\bgetActiveTrainingCycle\b|\bgetTrainingCycleHistory\b|\bgetCycleScopedTrainingPlan\b|\bgetCycleScopedTrainingSessionData\b|\bloadAppData\b/,
    "el root no puede recuperar reads extraidos del boundary",
  );
  assert.match(sources.app, /createCycleScopedTrainingCycleFromSetup[\s\S]*refreshTrainingCyclesBoundary\(\)/);
  assert.match(sources.app, /addCycleScopedTrainingDaysAndExercises\([\s\S]*reloadCycleScopedBoundary\(activeCycle\.id\)/);
  assert.match(sources.app, /startNewTrainingCycle[\s\S]*trainingDataController\.clearForCycleSetup\(operationOwner\.requestToken\)/);
  assert.match(sources.app, /deleteCurrentTrainingCycle[\s\S]*refreshTrainingCyclesBoundary\(\)/);
  assert.doesNotMatch(sources.app, /<ShareWorkoutCard\b|from ["'][^"']*workout-share/);
}

function runTrainingDataBoundaryMutationProbes(sources: BoundaryContractSources) {
  const probes: Array<{
    name: string;
    target: keyof BoundaryContractSources;
    mutate(source: string): string;
  }> = [
    {
      name: "eliminar token P3-41",
      target: "owner",
      mutate: (source) => source.replace(
        "        identity.isRequestTokenCurrent(owner.requestToken) &&\n",
        "",
      ),
    },
    {
      name: "eliminar requestId latest-wins y permitir publicacion tardia A-B",
      target: "owner",
      mutate: (source) => source.replace(
        "        owner.requestId === latestRequestIds[owner.resource] &&\n",
        "",
      ),
    },
    {
      name: "eliminar guard cycleId",
      target: "owner",
      mutate: (source) => source.replace(
        "        (owner.resource !== \"cycle-snapshot\" || owner.cycleId === selectedCycleId);",
        "        true;",
      ),
    },
    {
      name: "finally stale apaga loading nuevo",
      target: "controller",
      mutate: (source) => `${source}\nfinally { publish(state); }\n`,
    },
    {
      name: "publicacion parcial entre plan y sessions",
      target: "controller",
      mutate: (source) => source.replace(
        "      const plan = await source.loadCyclePlan(cycleId);\n",
        "      const plan = await source.loadCyclePlan(cycleId);\n      publish(state);\n",
      ),
    },
    {
      name: "fallback legacy durante error cycle-scoped",
      target: "selectors",
      mutate: (source) => source.replace(
        "  if (state.cycleScoped.status === \"error\") {\n    return createBlockedView(",
        "  if (state.cycleScoped.status === \"error\") {\n    return createLegacyView(",
      ),
    },
    {
      name: "segundo canon de exercises",
      target: "state",
      mutate: (source) => source.replace(
        "  plan: CycleScopedTrainingPlan;\n",
        "  plan: CycleScopedTrainingPlan;\n  exercises: readonly ExerciseTemplate[];\n",
      ),
    },
    {
      name: "conectar ShareWorkoutCard",
      target: "app",
      mutate: (source) => `${source}\nimport { ShareWorkoutCard } from \"@/features/active-workout/workout-share\";\n`,
    },
  ];

  for (const probe of probes) {
    const mutated = probe.mutate(sources[probe.target]);
    assert.notEqual(mutated, sources[probe.target], `probe sin mutacion efectiva: ${probe.name}`);
    assert.throws(
      () => assertTrainingDataBoundarySourceContract({ ...sources, [probe.target]: mutated }),
      `el contrato debe detectar: ${probe.name}`,
    );
  }
}

async function main() {
  await testLatestAppDataAndStaleFinally();
  await testCycleRequestIdCycleIdAndAtomicPublication();
  await testIdentityEpochAndReentry();
  await testDuplicateBootstrapLatestWins();
  await testLifecycleInvalidatesEveryLane();
  await testCycleCompletionRefreshesOnlySelectedCycle();
  await testCycleScopedLoadingBlocksLoadedLegacyData();
  await testBlockedMatrixAndNoLegacyFallback();
  await testTypedPostWriteCommandsInvalidateReads();

  const controllerSource = readFileSync("src/features/training-data/model/training-data-controller.ts", "utf8");
  const stateSource = readFileSync("src/features/training-data/model/training-data-state.ts", "utf8");
  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const boundarySources: BoundaryContractSources = {
    controller: controllerSource,
    owner: readFileSync("src/features/training-data/model/training-data-request-owner.ts", "utf8"),
    selectors: readFileSync("src/features/training-data/model/training-data-selectors.ts", "utf8"),
    state: stateSource,
    app: appSource,
  };
  assertTrainingDataBoundarySourceContract(boundarySources);
  runTrainingDataBoundaryMutationProbes(boundarySources);
  assert.match(controllerSource, /requestToken/);
  assert.match(controllerSource, /owners\.isCurrent/);
  assert.match(controllerSource, /cycleId/);
  assert.doesNotMatch(stateSource, /cycleScopedExercises/);
  assert.doesNotMatch(appSource, /<ShareWorkoutCard\b|from ["'][^"']*workout-share/);
  console.log("training data controller tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
