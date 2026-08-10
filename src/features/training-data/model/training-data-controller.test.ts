import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  coordinateAuthenticatedSessionEvent,
  createAuthenticatedSessionCoordinator,
} from "@/features/app-shell/model/authenticated-session-coordinator";
import { createLoginSubmitOwnerController } from "@/features/app-shell/model/login-submit-owner";
import {
  createTrainingDataController,
  type TrainingDataController,
} from "@/features/training-data/model/training-data-controller";
import { selectTrainingDataView } from "@/features/training-data/model/training-data-selectors";
import type { CycleScopedTrainingDataSnapshot } from "@/features/training-data/model/training-data-state";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  type SessionDataEpoch,
} from "@/lib/session/session-data-epoch";
import {
  assembleCycleScopedTrainingSessionData,
  getCycleScopedTrainingPlan,
  getCycleScopedTrainingSessionRawData,
  type CycleScopedTrainingPlan,
  type CycleScopedTrainingSessionData,
  type CycleScopedTrainingSessionRawData,
} from "@/lib/training/cycle-scoped-training-repository";
import type { TrainingDataSource } from "@/lib/training/training-data-source";
import {
  getActiveTrainingCycle,
  TrainingCycleRepositoryError,
  type TrainingCycle,
} from "@/lib/training/training-cycles-repository";
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

async function withWatchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), 300);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

function createSession(id: string, cycleId = "cycle-a") {
  return {
    id,
    routineId: `routine-${cycleId}`,
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
      exerciseId: `exercise-${cycleId}`,
      exerciseName: `Press ${cycleId}`,
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

function rawSessionData(
  data: CycleScopedTrainingSessionData,
): CycleScopedTrainingSessionRawData {
  return { mapped: data } as unknown as CycleScopedTrainingSessionRawData;
}

function source(overrides: Partial<TrainingDataSource> = {}): TrainingDataSource {
  return {
    loadActiveCycle: async () => null,
    loadCycleHistory: async () => [],
    loadLegacySnapshot: async () => appData("default"),
    ensureProfile: async () => undefined,
    loadCyclePlan: async (cycleId) => createPlan(cycleId),
    loadCycleSessionRows: async () => rawSessionData({ sessions: [], entries: [] }),
    assembleCycleSessions: (_cycleId, _plan, rawData) => (
      rawData as unknown as { mapped: CycleScopedTrainingSessionData }
    ).mapped,
    ...overrides,
  };
}

function controller(
  identity: ReturnType<typeof createIdentityHarness>,
  dataSource: TrainingDataSource,
): TrainingDataController {
  return createTrainingDataController({
    identity: identity.identity,
    source: dataSource,
    translateCycleError: (error) => error instanceof Error ? error.message : "cycle error",
  });
}

test("history y Profile deferred nunca retrasan dashboardReady", async () => {
  const identity = createIdentityHarness();
  const active = deferred<TrainingCycle | null>();
  const history = deferred<TrainingCycle[]>();
  const profile = deferred<void>();
  let legacyLoads = 0;
  let historyLoads = 0;
  let profileLoads = 0;
  const dataController = controller(identity, source({
    loadActiveCycle: () => active.promise,
    loadCycleHistory: () => { historyLoads += 1; return history.promise; },
    ensureProfile: () => { profileLoads += 1; return profile.promise; },
    loadLegacySnapshot: async () => { legacyLoads += 1; return appData("forbidden"); },
    loadCycleSessionRows: async () => {
      const session = createSession("session-a");
      return rawSessionData({ sessions: [session], entries: [...session.entries] });
    },
  }));
  dataController.reset({ cyclesEnabled: true });

  const milestones = dataController.startRefreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  await Promise.resolve();
  assert.deepEqual(
    { historyLoads, profileLoads },
    { historyLoads: 0, profileLoads: 0 },
    "background ni siquiera comienza antes del canon",
  );
  active.resolve(createCycle("cycle-a"));
  const dashboard = await withWatchdog(milestones.dashboardReady, "dashboard no espera background");
  assert.equal(dashboard.kind, "success");
  assert.equal(legacyLoads, 0, "canon scoped no carga el snapshot legacy completo");
  assert.equal(selectTrainingDataView(dataController.getState(), createDefaultTrainingPlan()).mode, "cycle-scoped");
  assert.equal(dataController.getState().cycleHistory.status, "loading");
  assert.equal(dataController.getState().profilePrerequisite.status, "loading");
  assert.deepEqual({ historyLoads, profileLoads }, { historyLoads: 1, profileLoads: 1 });

  history.resolve([createCycle("history-a", "legacy")]);
  profile.resolve();
  assert.equal((await milestones.backgroundSettled).kind, "success");
});

test("history tardío de A no publica bajo B", async () => {
  const identity = createIdentityHarness("user-a");
  const historyA = deferred<TrainingCycle[]>();
  const historyB = deferred<TrainingCycle[]>();
  const histories = [historyA, historyB];
  const dataController = controller(identity, source({
    loadCycleHistory: () => histories.shift()!.promise,
  }));
  dataController.reset({ cyclesEnabled: true });
  const loadA = dataController.startRefreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  await loadA.dashboardReady;

  identity.advance(null, true);
  dataController.reset({ cyclesEnabled: false });
  identity.advance("user-b");
  dataController.reset({ cyclesEnabled: true });
  const loadB = dataController.startRefreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  await loadB.dashboardReady;
  const historyForB = createCycle("history-b", "legacy");
  historyB.resolve([historyForB]);
  await loadB.backgroundSettled;
  historyA.resolve([createCycle("late-a", "legacy")]);
  const settledA = await loadA.backgroundSettled;

  assert.equal(settledA.results.find((result) => result.resource === "cycle-history")?.kind, "stale");
  const state = dataController.getState();
  assert.equal(state.cycleHistory.status, "ready");
  assert.equal(state.cycleHistory.status === "ready" ? state.cycleHistory.data[0]?.id : null, "history-b");
});

test("elige un solo canon: scoped evita legacy y fallback legacy sigue funcionando", async () => {
  const identity = createIdentityHarness();
  const calls = { legacy: 0, plan: 0, sessions: 0 };
  const scopedController = controller(identity, source({
    loadActiveCycle: async () => createCycle("cycle-scoped"),
    loadLegacySnapshot: async () => { calls.legacy += 1; return appData("legacy"); },
    loadCyclePlan: async (cycleId) => { calls.plan += 1; return createPlan(cycleId); },
    loadCycleSessionRows: async () => {
      calls.sessions += 1;
      return rawSessionData({ sessions: [], entries: [] });
    },
  }));
  scopedController.reset({ cyclesEnabled: true });
  await scopedController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.deepEqual(calls, { legacy: 0, plan: 1, sessions: 1 });

  const legacyController = controller(identity, source({
    loadActiveCycle: async () => createCycle("legacy", "ui-main-production"),
    loadLegacySnapshot: async () => { calls.legacy += 1; return appData("legacy"); },
    loadCyclePlan: async (cycleId) => { calls.plan += 1; return createPlan(cycleId); },
  }));
  legacyController.reset({ cyclesEnabled: true });
  await legacyController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.deepEqual(calls, { legacy: 1, plan: 1, sessions: 1 });
  assert.equal(selectTrainingDataView(legacyController.getState(), createDefaultTrainingPlan()).mode, "legacy");
});

test("plan y sesiones se publican atómicamente", async () => {
  const identity = createIdentityHarness();
  const plan = deferred<CycleScopedTrainingPlan>();
  const sessions = deferred<{ sessions: ReturnType<typeof createSession>[]; entries: ReturnType<typeof createSession>["entries"] }>();
  const dataController = controller(identity, source({
    loadActiveCycle: async () => createCycle("cycle-a"),
    loadCyclePlan: () => plan.promise,
    loadCycleSessionRows: async () => rawSessionData(await sessions.promise),
  }));
  dataController.reset({ cyclesEnabled: true });
  const load = dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  await Promise.resolve();
  plan.resolve(createPlan("cycle-a"));
  await Promise.resolve();
  assert.equal(dataController.getState().cycleScoped.status, "loading");
  assert.equal("snapshot" in dataController.getState().cycleScoped, false, "plan aislado no se publica");

  const session = createSession("session-a");
  sessions.resolve({ sessions: [session], entries: [...session.entries] });
  assert.equal((await load).kind, "success");
  const scoped = dataController.getState().cycleScoped;
  assert.equal(scoped.status, "ready");
  assert.equal(scoped.status === "ready" ? scoped.snapshot.sessions[0]?.id : null, "session-a");
});

test("refresh de misma identidad mantiene Dashboard visible y no activa blocker", async () => {
  const identity = createIdentityHarness();
  const secondPlan = deferred<CycleScopedTrainingPlan>();
  const secondSessions = deferred<{ sessions: ReturnType<typeof createSession>[]; entries: ReturnType<typeof createSession>["entries"] }>();
  let planLoads = 0;
  let sessionLoads = 0;
  const dataController = controller(identity, source({
    loadActiveCycle: async () => createCycle("cycle-a"),
    loadCyclePlan: async (cycleId) => {
      planLoads += 1;
      return planLoads === 1 ? createPlan(cycleId) : secondPlan.promise;
    },
    loadCycleSessionRows: async () => {
      sessionLoads += 1;
      if (sessionLoads === 1) {
        const session = createSession("first");
        return rawSessionData({ sessions: [session], entries: [...session.entries] });
      }
      return rawSessionData(await secondSessions.promise);
    },
  }));
  dataController.reset({ cyclesEnabled: true });
  await dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });

  const refresh = dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  await Promise.resolve();
  assert.equal(selectTrainingDataView(dataController.getState(), createDefaultTrainingPlan()).mode, "cycle-scoped");
  secondPlan.resolve(createPlan("cycle-a"));
  await Promise.resolve();
  assert.equal(dataController.getState().cycleScoped.status, "loading");
  assert.equal(selectTrainingDataView(dataController.getState(), createDefaultTrainingPlan()).mode, "cycle-scoped");

  const session = createSession("second");
  secondSessions.resolve({ sessions: [session], entries: [...session.entries] });
  assert.equal((await refresh).kind, "success");
});

test("error crítico bloquea y error background no reemplaza un canon válido", async () => {
  const identity = createIdentityHarness();
  const critical = controller(identity, source({
    loadActiveCycle: async () => { throw new Error("active failed"); },
    loadCycleHistory: async () => { throw new Error("history failed"); },
    ensureProfile: async () => { throw new Error("profile failed"); },
  }));
  critical.reset({ cyclesEnabled: true });
  const failed = critical.startRefreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.equal((await failed.dashboardReady).kind, "error");
  const blocked = selectTrainingDataView(critical.getState(), createDefaultTrainingPlan());
  assert.equal(blocked.mode, "blocked");
  assert.equal(blocked.mode === "blocked" ? blocked.reason : null, "cycle-error");
  assert.equal((await failed.backgroundSettled).kind, "error");

  const valid = controller(identity, source({
    loadActiveCycle: async () => createCycle("cycle-valid"),
    loadCycleHistory: async () => { throw new Error("history failed"); },
  }));
  valid.reset({ cyclesEnabled: true });
  const milestones = valid.startRefreshForIdentity({ mode: "supabase", cyclesEnabled: true });
  assert.equal((await milestones.dashboardReady).kind, "success");
  assert.equal((await milestones.backgroundSettled).kind, "error");
  assert.equal(selectTrainingDataView(valid.getState(), createDefaultTrainingPlan()).mode, "cycle-scoped");
});

test("SIGNED_IN produce una carga y navegación; TOKEN_REFRESHED no reinicia", async () => {
  const identity = createIdentityHarness();
  const coordinator = createAuthenticatedSessionCoordinator();
  let loads = 0;
  let navigations = 0;
  const run = () => coordinator.continueSession(identity.capture(), "dashboard", {
    refresh: async () => { loads += 1; return { kind: "success" as const }; },
    isCurrent: identity.identity.isRequestTokenCurrent,
    onStart: () => undefined,
    onComplete: () => { navigations += 1; },
  });
  const signedIn = coordinateAuthenticatedSessionEvent({
    event: "SIGNED_IN",
    state: { userId: "user-a" },
    currentIdentity: { userId: "user-a", scope: "supabase:user-a" },
    nextIdentity: { userId: "user-a", scope: "supabase:user-a" },
    intent: "dashboard",
    hasAuthenticatedSession: true,
  }, {
    applySameIdentitySession: () => undefined,
    applyNewIdentitySession: () => assert.fail("identidad inesperada"),
    canContinueAfterSessionApplied: () => true,
    continueSession: run,
  });
  assert.ok(signedIn.continuation);
  await signedIn.continuation;
  assert.deepEqual({ loads, navigations }, { loads: 1, navigations: 1 });

  const refreshed = coordinateAuthenticatedSessionEvent({
    event: "TOKEN_REFRESHED",
    state: { userId: "user-a" },
    currentIdentity: { userId: "user-a", scope: "supabase:user-a" },
    nextIdentity: { userId: "user-a", scope: "supabase:user-a" },
    intent: "dashboard",
    hasAuthenticatedSession: true,
  }, {
    applySameIdentitySession: () => undefined,
    applyNewIdentitySession: () => assert.fail("identidad inesperada"),
    canContinueAfterSessionApplied: () => true,
    continueSession: run,
  });
  assert.equal(refreshed.continuation, null);
  assert.deepEqual({ loads, navigations }, { loads: 1, navigations: 1 });
});

test("A→SIGNED_OUT→A usa generación nueva y descarta success/error/finally antiguos", async () => {
  const identity = createIdentityHarness("user-a");
  const oldLegacy = deferred<ReturnType<typeof appData>>();
  const newLegacy = deferred<ReturnType<typeof appData>>();
  const queue = [oldLegacy, newLegacy];
  const dataController = controller(identity, source({
    loadLegacySnapshot: () => queue.shift()!.promise,
  }));
  dataController.reset({ cyclesEnabled: false });
  const oldLoad = dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: false });
  identity.advance(null, true);
  dataController.reset({ cyclesEnabled: false });
  identity.advance("user-a");
  dataController.reset({ cyclesEnabled: false });
  const newLoad = dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: false });
  newLegacy.resolve(appData("new-generation"));
  assert.equal((await newLoad).kind, "success");
  oldLegacy.reject(new Error("late old error"));
  assert.equal((await oldLoad).kind, "stale");
  const current = dataController.getState().appData;
  assert.equal(current.status === "ready" ? current.data.exercises[0]?.name : null, "Press new-generation");
});

test("ciclo activo descarta success/error/finally stale en A→B y nueva generación de A", async () => {
  for (const nextUserId of ["user-b", "user-a"] as const) {
    for (const outcome of ["success", "error"] as const) {
      const identity = createIdentityHarness("user-a");
      const active = deferred<TrainingCycle | null>();
      let capturedGuard: (() => boolean) | undefined;
      const dataController = controller(identity, source({
        loadActiveCycle: (_expectedUserId, isExpectedRequestCurrent) => {
          capturedGuard = isExpectedRequestCurrent;
          return active.promise;
        },
      }));
      dataController.reset({ cyclesEnabled: true });
      const pending = dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true });
      await Promise.resolve();
      assert.equal(capturedGuard?.(), true);

      identity.advance(null, true);
      dataController.reset({ cyclesEnabled: true });
      identity.advance(nextUserId);
      dataController.reset({ cyclesEnabled: true });
      assert.equal(capturedGuard?.(), false);
      const stateAfterTransition = structuredClone(dataController.getState());

      if (outcome === "success") active.resolve(createCycle("cycle-old"));
      else active.reject(new Error("late active error"));
      assert.equal((await pending).kind, "stale");
      assert.deepEqual(
        dataController.getState(),
        stateAfterTransition,
        `${nextUserId}/${outcome}: success, error y finally stale no publican sobre la generación nueva`,
      );
    }
  }
});

test("Active Workout sólo se restaura después del canon completo", async () => {
  const identity = createIdentityHarness();
  const plan = deferred<CycleScopedTrainingPlan>();
  const sessions = deferred<{ sessions: ReturnType<typeof createSession>[]; entries: ReturnType<typeof createSession>["entries"] }>();
  const dataController = controller(identity, source({
    loadActiveCycle: async () => createCycle("cycle-a"),
    loadCyclePlan: () => plan.promise,
    loadCycleSessionRows: async () => rawSessionData(await sessions.promise),
  }));
  dataController.reset({ cyclesEnabled: true });
  const coordinator = createAuthenticatedSessionCoordinator();
  let restores = 0;
  const continuation = coordinator.continueSession(identity.capture(), "restore-active-flow", {
    refresh: () => dataController.refreshForIdentity({ mode: "supabase", cyclesEnabled: true }),
    isCurrent: identity.identity.isRequestTokenCurrent,
    onStart: () => undefined,
    onComplete: () => { restores += 1; },
  });
  await Promise.resolve();
  plan.resolve(createPlan("cycle-a"));
  await Promise.resolve();
  assert.equal(restores, 0, "plan parcial no restaura Active Workout");
  const session = createSession("session-a");
  sessions.resolve({ sessions: [session], entries: [...session.entries] });
  await continuation;
  assert.equal(restores, 1);
});

interface ScheduledRead {
  label: string;
  resolve(value: { data: unknown; error: null }): void;
  value: { data: unknown; error: null };
}

type CriticalReadScenario = "normal" | "no-sessions" | "historical-reference";

function createCriticalReadHarness(scenario: CriticalReadScenario) {
  const pending: ScheduledRead[] = [];
  const labels: string[] = [];
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const userId = "user-a";
  let authLock = Promise.resolve();
  const withSessions = scenario !== "no-sessions";
  const referencedExerciseId = scenario === "historical-reference"
    ? "exercise-historical"
    : "exercise-a";
  const relatedExercise = {
    id: referencedExerciseId, user_id: userId, cycle_id: "cycle-a", day_id: "day-a",
    name: scenario === "historical-reference" ? "Sentadilla histórica" : "Sentadilla",
    target_sets: 3, target_reps: 8, base_weight: 80, side_weight: null, sort_order: 1,
    created_at: "2026-08-01T00:00:00.000Z", deleted_at: null, notes: null,
    source_legacy_exercise_id: null, exercise_lineage_id: "lineage-a",
  };
  const tableRows: Record<string, unknown[]> = {
    training_cycles: [{
      id: "cycle-a", user_id: userId, name: "Ciclo A", cycle_number: 1,
      cycle_type: "meso", goal: "Hipertrofia", started_at: "2026-08-01T00:00:00.000Z",
      ended_at: null, planned_start_date: "2026-08-01", planned_end_date: "2026-08-31",
      status: "active", plan_snapshot: { source: "cycle-scoped" }, summary_snapshot: null,
      created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
      deleted_at: null,
    }],
    training_cycle_routines: [{
      id: "routine-a", cycle_id: "cycle-a", name: "Rutina A", sort_order: 1, notes: null,
    }],
    training_cycle_days: [{
      id: "day-a", cycle_id: "cycle-a", routine_id: "routine-a", week_index: 1,
      day_code: "monday", sort_order: 1, notes: null,
    }],
    training_cycle_exercises: [{
      id: "exercise-a", cycle_id: "cycle-a", day_id: "day-a", name: "Sentadilla",
      target_sets: 3, target_reps: 8, base_weight: 80, side_weight: null, sort_order: 1,
      created_at: "2026-08-01T00:00:00.000Z", notes: null,
      source_legacy_exercise_id: null, exercise_lineage_id: "lineage-a",
    }],
    training_sessions: withSessions ? [{
      id: "session-a", cycle_id: "cycle-a", cycle_day_id: "day-a", week_number: 1,
      trained_at: "2026-08-08T10:00:00.000Z", calendar_week_start: "2026-08-03",
      planned_day: "monday", planned_date: "2026-08-08", trained_date: "2026-08-08",
      status: "completed", completed_at: "2026-08-08T11:00:00.000Z", deleted_at: null,
      notes: null, created_at: "2026-08-08T10:00:00.000Z",
    }] : [],
    exercise_entries: withSessions ? [{
      id: "entry-a", session_id: "session-a", exercise_id: null,
      training_cycle_exercise_id: referencedExerciseId, exercise_lineage_id: "lineage-a",
      weight: 80, previous_weight: 75, reps: [8, 8, 7], rir: "2", notes: null,
      created_at: "2026-08-08T10:10:00.000Z",
      training_cycle_exercises: relatedExercise,
    }] : [],
  };

  function schedule(label: string, data: unknown) {
    labels.push(label);
    return new Promise<{ data: unknown; error: null }>((resolve) => {
      pending.push({ label, resolve, value: { data, error: null } });
    });
  }

  function from(table: string) {
    let selectColumns = "";
    const query = {
      select(columns: string) { selectColumns = columns; return query; },
      eq(column: string, value: unknown) {
        filters.push({ table, column, value });
        return query;
      },
      is() { return query; },
      in() { return query; },
      order() { return query; },
      maybeSingle() {
        return schedule(table, tableRows[table]?.[0] ?? null);
      },
      then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
        onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        const label = table === "exercise_entries" && selectColumns.includes("training_cycle_exercises(")
          ? "exercise_entries+historical-references"
          : table;
        return schedule(label, tableRows[table] ?? []).then(onfulfilled, onrejected);
      },
    };
    return query;
  }

  function getUserWithAuthLock() {
    const request = authLock.then(() => schedule("auth.getUser", { user: { id: userId } }));
    authLock = request.then(() => undefined, () => undefined);
    return request;
  }

  const client = {
    auth: {
      getUser: getUserWithAuthLock,
    },
    from,
  } as unknown as SupabaseClient;

  return {
    client,
    labels,
    filters,
    signInWithPassword: () => schedule("auth.signInWithPassword", {
      session: { user: { id: userId } },
    }),
    takeWave() {
      const wave = pending.splice(0);
      for (const read of wave) read.resolve(read.value);
      return wave.map((read) => read.label);
    },
    get pendingCount() { return pending.length; },
  };
}

async function flushCriticalReadHarness() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

test("ciclo activo filtra owner y rechaza A→B/nueva generación después del SELECT", async () => {
  for (const transition of ["A→B", "misma cuenta/nueva generación"] as const) {
    const harness = createCriticalReadHarness("no-sessions");
    let generation = 1;
    const capturedGeneration = generation;
    const operation = getActiveTrainingCycle(
      "user-a",
      () => generation === capturedGeneration,
      () => harness.client,
    );

    await flushCriticalReadHarness();
    assert.deepEqual(harness.takeWave(), ["auth.getUser"]);
    await flushCriticalReadHarness();
    assert.deepEqual(harness.takeWave(), ["training_cycles"]);
    generation += 1;

    await assert.rejects(operation, (error: unknown) => (
      error instanceof TrainingCycleRepositoryError && error.code === "session_expired"
    ), transition);
    assert.ok(
      harness.filters.some((filter) => (
        filter.table === "training_cycles" &&
        filter.column === "user_id" &&
        filter.value === "user-a"
      )),
      `${transition}: la fila se filtra por el owner autenticado`,
    );
  }
});

async function measureScopedCriticalReads(scenario: CriticalReadScenario) {
  const harness = createCriticalReadHarness(scenario);
  const identity = createIdentityHarness();
  const loginOwner = createLoginSubmitOwnerController();
  const history = deferred<TrainingCycle[]>();
  const profile = deferred<void>();
  const backgroundCalls = { history: 0, profile: 0 };
  const dataController = controller(identity, source({
    loadActiveCycle: (expectedUserId, isExpectedRequestCurrent) => getActiveTrainingCycle(
      expectedUserId,
      isExpectedRequestCurrent,
      () => harness.client,
    ),
    loadCycleHistory: () => {
      backgroundCalls.history += 1;
      return history.promise;
    },
    ensureProfile: () => {
      backgroundCalls.profile += 1;
      return profile.promise;
    },
    loadLegacySnapshot: async () => assert.fail("el canon scoped no debe leer legacy"),
    loadCyclePlan: (cycleId, expectedUserId, isExpectedRequestCurrent) => (
      getCycleScopedTrainingPlan(
        cycleId,
        expectedUserId,
        () => harness.client,
        isExpectedRequestCurrent,
      )
    ),
    loadCycleSessionRows: (cycleId, expectedUserId, isExpectedRequestCurrent) => (
      getCycleScopedTrainingSessionRawData(
        cycleId,
        expectedUserId,
        () => harness.client,
        isExpectedRequestCurrent,
      )
    ),
    assembleCycleSessions: assembleCycleScopedTrainingSessionData,
  }));
  dataController.reset({ cyclesEnabled: true });
  let settled = false;
  let failure: unknown;
  let milestones: ReturnType<TrainingDataController["startRefreshForIdentity"]> | undefined;
  let sessionData: CycleScopedTrainingDataSnapshot | undefined;
  const operation = (async () => {
    const login = loginOwner.start(() => harness.signInWithPassword());
    assert.equal(login.kind, "started");
    if (login.kind !== "started") return;
    assert.deepEqual(loginOwner.start(() => harness.signInWithPassword()), { kind: "busy" });
    assert.equal((await login.promise).kind, "success");
    milestones = dataController.startRefreshForIdentity({ mode: "supabase", cyclesEnabled: true });
    const dashboardResult = await milestones.dashboardReady;
    assert.equal(dashboardResult.kind, "success");
    const scoped = dataController.getState().cycleScoped;
    assert.ok(scoped.status === "ready" || scoped.status === "empty");
    sessionData = scoped.snapshot;
  })()
    .catch((error: unknown) => { failure = error; })
    .finally(() => { settled = true; });

  const waves: string[][] = [];
  for (let guard = 0; !settled && guard < 10; guard += 1) {
    for (let flush = 0; flush < 8; flush += 1) await Promise.resolve();
    if (harness.pendingCount > 0) waves.push(harness.takeWave());
  }
  await operation;
  if (failure) throw failure;
  assert.ok(milestones);
  assert.deepEqual(backgroundCalls, { history: 1, profile: 1 });
  const requestCountAtDashboard = harness.labels.length;
  history.resolve([]);
  profile.resolve();
  assert.equal((await milestones.backgroundSettled).kind, "success");
  assert.equal(harness.labels.length, requestCountAtDashboard, "background no agrega requests críticas");
  loginOwner.dispose();
  return {
    requestCount: harness.labels.length,
    waves,
    labels: harness.labels,
    sessionData,
    state: dataController.getState(),
  };
}

test("PERF-05C real incluye login y respeta ≤12 requests/≤6 ondas", async () => {
  const normal = await measureScopedCriticalReads("normal");
  const noSessions = await measureScopedCriticalReads("no-sessions");
  const historical = await measureScopedCriticalReads("historical-reference");
  const expectedLabels = [
    "auth.signInWithPassword",
    "auth.getUser",
    "training_cycles",
    "auth.getUser",
    "auth.getUser",
    "training_cycle_routines",
    "training_cycle_days",
    "training_cycle_exercises",
    "training_sessions",
    "exercise_entries+historical-references",
  ];

  for (const measurement of [normal, noSessions, historical]) {
    assert.equal(measurement.requestCount, 10);
    assert.equal(measurement.waves.length, 6);
    assert.deepEqual(measurement.labels, expectedLabels);
    assert.deepEqual(measurement.waves, [
      ["auth.signInWithPassword"],
      ["auth.getUser"],
      ["training_cycles"],
      ["auth.getUser"],
      [
        "auth.getUser",
        "training_cycle_routines",
        "training_cycle_days",
        "training_cycle_exercises",
      ],
      ["training_sessions", "exercise_entries+historical-references"],
    ]);
    assert.ok(measurement.requestCount <= 12);
    assert.ok(measurement.waves.length <= 6);
    assert.ok(measurement.state.cycleScoped.status === "ready" || measurement.state.cycleScoped.status === "empty");
  }
  assert.deepEqual(
    noSessions.sessionData && {
      sessions: noSessions.sessionData.sessions,
      entries: noSessions.sessionData.entries,
    },
    { sessions: [], entries: [] },
  );
  assert.equal(
    historical.sessionData?.entries[0]?.exerciseName,
    "Sentadilla histórica",
    "la referencia histórica viaja consolidada en entries sin una solicitud posterior",
  );
});

interface ContractSources {
  controller: string;
  owner: string;
  source: string;
  coordinator: string;
  repository: string;
  cyclesRepository: string;
}

function between(sourceText: string, start: string, end: string): string {
  const startIndex = sourceText.indexOf(start);
  const endIndex = sourceText.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `segmento ausente: ${start}`);
  return sourceText.slice(startIndex, endIndex);
}

function assertPerf05cContract(sources: ContractSources) {
  for (const port of [
    "loadActiveCycle(",
    "loadCycleHistory()",
    "loadLegacySnapshot(",
    "ensureProfile(",
    "loadCyclePlan(",
    "loadCycleSessionRows(",
    "assembleCycleSessions(",
  ]) assert.ok(sources.source.includes(port), `port ausente: ${port}`);
  assert.doesNotMatch(sources.source, /\bloadCycles\s*\(/);

  const critical = between(sources.controller, "async function refreshDashboardCanon", "function settleBackground");
  assert.doesNotMatch(critical, /refreshCycleHistory|ensureProfile|backgroundSettled|Promise\.all/);
  assert.equal((critical.match(/controller\.refreshAppData\(mode\)/g) ?? []).length, 2);
  assert.ok(critical.indexOf("await refreshActiveCycle()") < critical.lastIndexOf("controller.refreshAppData(mode)"));
  assert.match(critical, /isCycleScopedTrainingCycle\(activeCycle\)[\s\S]*return cyclesResult;[\s\S]*return controller\.refreshAppData\(mode\);/);

  const start = between(sources.controller, "startRefreshForIdentity({", "refreshForIdentity(input)");
  assert.match(start, /const dashboardReady = refreshDashboardCanon/);
  assert.match(start, /backgroundSettled: dashboardReady\.then/);
  assert.ok(start.indexOf("dashboardReady.then") < start.indexOf("controller.refreshCycleHistory()"));
  assert.ok(start.indexOf("dashboardReady.then") < start.indexOf("refreshProfilePrerequisite(mode)"));
  assert.match(start, /Promise\.all\(\[historySettled, profileSettled\]\)\.then\(settleBackground\)/);

  const snapshotLoad = between(
    sources.controller,
    "async function loadCycleSnapshot",
    "async function refreshProfilePrerequisite",
  );
  const parallelIndex = snapshotLoad.indexOf("const [plan, rawSessionData] = await Promise.all([");
  const planIndex = snapshotLoad.indexOf("source.loadCyclePlan(", parallelIndex);
  const sessionsIndex = snapshotLoad.indexOf("source.loadCycleSessionRows(", parallelIndex);
  const parallelEnd = snapshotLoad.indexOf("]);", parallelIndex);
  const assembleIndex = snapshotLoad.indexOf(
    "source.assembleCycleSessions(cycleId, plan, rawSessionData)",
    parallelEnd,
  );
  const snapshotIndex = snapshotLoad.indexOf("const snapshot: CycleScopedTrainingDataSnapshot", assembleIndex);
  assert.ok(
    parallelIndex >= 0 &&
      planIndex > parallelIndex &&
      sessionsIndex > parallelIndex &&
      planIndex < parallelEnd &&
      sessionsIndex < parallelEnd &&
      assembleIndex > parallelEnd &&
      snapshotIndex > assembleIndex,
    "plan y filas de sesiones parten en paralelo y sólo luego se ensamblan",
  );
  assert.doesNotMatch(snapshotLoad.slice(parallelIndex, snapshotIndex), /publish\(/);
  assert.equal(
    (snapshotLoad.match(/if \(!owners\.isCurrent\(owner\)\) return \{ kind: "stale", state \};/g) ?? []).length,
    3,
    "se conserva el guard antes y después del ensamblado y en error",
  );
  assert.match(snapshotLoad, /entries: \[\.\.\.sessionData\.entries\],[\s\S]*sessions: \[\.\.\.sessionData\.sessions\],/);
  assert.match(sources.controller, /previousForCycle[\s\S]*status: "loading", cycleId, previous: previousForCycle/);
  assert.match(sources.controller, /return \{ kind: "error", state, resource: "active-cycle", error \};/);

  const rawLoader = between(
    sources.repository,
    "export async function getCycleScopedTrainingSessionRawData",
    "export function assembleCycleScopedTrainingSessionData",
  );
  assert.match(rawLoader, /\] = await Promise\.all\(\[/);
  assert.match(rawLoader, /\.from\("training_sessions"\)[\s\S]*\.from\("exercise_entries"\)/);
  assert.match(rawLoader, /training_sessions!inner\(id,user_id,cycle_id,deleted_at\)/);
  assert.match(rawLoader, /training_cycle_exercises\(id,user_id,cycle_id,day_id,name,target_sets,target_reps/);
  assert.doesNotMatch(rawLoader, /\.from\("training_cycle_exercises"\)/);
  assert.equal(
    (rawLoader.match(/assertExpectedCycleScopedRequestCurrent\(expectedUserId, isExpectedRequestCurrent\);/g) ?? []).length,
    3,
    "el owner síncrono fail-closed valida antes, después de auth y después de las lecturas raw",
  );
  assert.doesNotMatch(rawLoader, /await assertExpectedCycleScopedRepositoryUser/);

  const activeController = between(
    sources.controller,
    "async function refreshActiveCycle",
    "async function refreshDashboardCanon",
  );
  assert.match(activeController, /source\.loadActiveCycle\([\s\S]*owner\.requestToken\.userId \?\? undefined,[\s\S]*\(\) => owners\.isCurrent\(owner\)/);
  assert.equal(
    (activeController.match(/if \(!owners\.isCurrent\(owner\)\) return \{ kind: "stale", state \};/g) ?? []).length,
    2,
  );
  const activeRepository = between(
    sources.cyclesRepository,
    "export async function getActiveTrainingCycle",
    "export async function getNextTrainingCycleNumber",
  );
  assert.match(activeRepository, /\.eq\("user_id", userId\)/);
  assert.equal(
    (activeRepository.match(/assertExpectedTrainingCycleRequestCurrent\(expectedUserId, isExpectedRequestCurrent\);/g) ?? []).length,
    3,
    "ciclo activo valida owner antes de auth, antes del SELECT y post-await",
  );

  assert.match(sources.owner, /requestToken: identity\.captureRequestToken\(\)/);
  assert.match(sources.owner, /owner\.lifecycle === lifecycle/);
  assert.match(sources.owner, /owner\.requestId === latestRequestIds\[owner\.resource\]/);
  assert.match(sources.owner, /identity\.isRequestTokenCurrent\(owner\.requestToken\)/);
  assert.match(sources.owner, /owner\.cycleId === selectedCycleId/);
  assert.match(sources.owner, /"cycle-history": 0/);

  const history = between(sources.controller, "async refreshCycleHistory()", "reloadCycleSnapshot(cycleId)");
  assert.match(history, /const owner = owners\.begin\("cycle-history"\)/);
  assert.equal(
    (history.match(/if \(!owners\.isCurrent\(owner\)\) return \{ kind: "stale", resource: "cycle-history" \};/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(history, /appData:|cycleScoped:/);

  const continuation = between(sources.coordinator, "operation.promise = (async () =>", "return operation.promise");
  assert.ok(continuation.indexOf("await ports.refresh()") < continuation.indexOf("ports.onComplete("));
}

function replaceLast(sourceText: string, find: string, replacement: string): string {
  const index = sourceText.lastIndexOf(find);
  assert.ok(index >= 0, `texto de mutación ausente: ${find}`);
  return sourceText.slice(0, index) + replacement + sourceText.slice(index + find.length);
}

test("mutation probes PERF-05C detectan regresiones del DAG", () => {
  const originals: ContractSources = {
    controller: readFileSync("src/features/training-data/model/training-data-controller.ts", "utf8"),
    owner: readFileSync("src/features/training-data/model/training-data-request-owner.ts", "utf8"),
    source: readFileSync("src/lib/training/training-data-source.ts", "utf8"),
    coordinator: readFileSync("src/features/app-shell/model/authenticated-session-coordinator.ts", "utf8"),
    repository: readFileSync("src/lib/training/cycle-scoped-training-repository.ts", "utf8"),
    cyclesRepository: readFileSync("src/lib/training/training-cycles-repository.ts", "utf8"),
  };
  assertPerf05cContract(originals);

  const probes: Array<{
    name: string;
    target: keyof ContractSources;
    mutate(value: string): string;
  }> = [
    {
      name: "reintroducir history en el await crítico",
      target: "controller",
      mutate: (value) => value.replace(
        "    if (!cyclesEnabled) return controller.refreshAppData(mode);",
        "    await controller.refreshCycleHistory();\n    if (!cyclesEnabled) return controller.refreshAppData(mode);",
      ),
    },
    {
      name: "cargar legacy y scoped completos simultáneamente",
      target: "controller",
      mutate: (value) => value.replace(
        "    const cyclesResult = await refreshActiveCycle();",
        "    void controller.refreshAppData(mode);\n    const cyclesResult = await refreshActiveCycle();",
      ),
    },
    {
      name: "navegar antes del canon",
      target: "coordinator",
      mutate: (value) => value.replace(
        "          const refreshResult = await ports.refresh();",
        "          ports.onComplete(operation.intent, \"success\");\n          const refreshResult = await ports.refresh();",
      ),
    },
    {
      name: "hacer esperar sesiones por el plan",
      target: "controller",
      mutate: (value) => value.replace(
        `      const [plan, rawSessionData] = await Promise.all([`,
        `      const [plan, rawSessionData] = await sequentialReads([`,
      ),
    },
    {
      name: "publicar plan parcial antes del ensamblado",
      target: "controller",
      mutate: (value) => value.replace(
        "      if (!owners.isCurrent(owner)) return { kind: \"stale\", state };\n      const sessionData = source.assembleCycleSessions(cycleId, plan, rawSessionData);",
        "      if (!owners.isCurrent(owner)) return { kind: \"stale\", state };\n      publish(state);\n      const sessionData = source.assembleCycleSessions(cycleId, plan, rawSessionData);",
      ),
    },
    {
      name: "omitir entries del canon",
      target: "controller",
      mutate: (value) => value.replace(
        "        entries: [...sessionData.entries],",
        "        entries: [],",
      ),
    },
    {
      name: "quitar guard post-await del snapshot",
      target: "controller",
      mutate: (value) => value.replace(
        "      if (!owners.isCurrent(owner)) return { kind: \"stale\", state };\n      const sessionData = source.assembleCycleSessions(cycleId, plan, rawSessionData);",
        "      const sessionData = source.assembleCycleSessions(cycleId, plan, rawSessionData);",
      ),
    },
    {
      name: "quitar guard post-await del repositorio raw",
      target: "repository",
      mutate: (value) => value.replace(
        "  assertExpectedCycleScopedRequestCurrent(expectedUserId, isExpectedRequestCurrent);\n\n  if (sessionsError)",
        "  if (sessionsError)",
      ),
    },
    {
      name: "quitar guard post-await del ciclo activo",
      target: "cyclesRepository",
      mutate: (value) => value.replace(
        "  assertExpectedTrainingCycleRequestCurrent(expectedUserId, isExpectedRequestCurrent);\n  if (error)",
        "  if (error)",
      ),
    },
    {
      name: "quitar token",
      target: "owner",
      mutate: (value) => value.replace("        identity.isRequestTokenCurrent(owner.requestToken) &&\n", ""),
    },
    {
      name: "quitar epoch/lifecycle",
      target: "owner",
      mutate: (value) => value.replace("return owner.lifecycle === lifecycle &&\n", "return "),
    },
    {
      name: "quitar requestId",
      target: "owner",
      mutate: (value) => value.replace("        owner.requestId === latestRequestIds[owner.resource] &&\n", ""),
    },
    {
      name: "quitar cycleId",
      target: "owner",
      mutate: (value) => value.replace(
        "        (owner.resource !== \"cycle-snapshot\" || owner.cycleId === selectedCycleId);",
        "        true;",
      ),
    },
    {
      name: "reemplazar snapshot visible por loading vacío",
      target: "controller",
      mutate: (value) => value.replace(
        "        ? { status: \"loading\", cycleId, previous: previousForCycle }",
        "        ? { status: \"loading\", cycleId }",
      ),
    },
    {
      name: "ocultar error crítico",
      target: "controller",
      mutate: (value) => value.replace(
        "return { kind: \"error\", state, resource: \"active-cycle\", error };",
        "return { kind: \"stale\", state };",
      ),
    },
    {
      name: "permitir background A→B",
      target: "controller",
      mutate: (value) => value.replace(
        "if (!owners.isCurrent(owner)) return { kind: \"stale\", resource: \"cycle-history\" };",
        "if (false) return { kind: \"stale\", resource: \"cycle-history\" };",
      ),
    },
    {
      name: "reintroducir Profile en el milestone",
      target: "controller",
      mutate: (value) => value.replace(
        "    if (!cyclesEnabled) return controller.refreshAppData(mode);",
        "    await source.ensureProfile(mode);\n    if (!cyclesEnabled) return controller.refreshAppData(mode);",
      ),
    },
    {
      name: "eliminar fallback legacy",
      target: "controller",
      mutate: (value) => replaceLast(value, "return controller.refreshAppData(mode);", "return cyclesResult;"),
    },
  ];

  for (const probe of probes) {
    const mutated = probe.mutate(originals[probe.target]);
    assert.notEqual(mutated, originals[probe.target], `mutación inefectiva: ${probe.name}`);
    assert.throws(
      () => assertPerf05cContract({ ...originals, [probe.target]: mutated }),
      `el contrato debe detectar: ${probe.name}`,
    );
  }
});
