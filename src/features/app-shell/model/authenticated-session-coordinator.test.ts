import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import {
  coordinateAuthenticatedSessionEvent,
  createAuthenticatedSessionCoordinator,
  type AuthenticatedSessionIntent,
} from "@/features/app-shell/model/authenticated-session-coordinator";
import {
  activeWorkoutControllerReducer,
  createInitialActiveWorkoutControllerState,
} from "@/features/active-workout/model/active-workout-controller-state";
import { translateAuthError } from "@/lib/supabase/auth-errors";
import {
  resolveActiveWorkoutSessionBoundary,
  tryAcquireSessionOperationOwner,
} from "@/lib/session/active-workout-session-boundary";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  type AuthenticatedRefreshResultKind,
  type SessionDataEpoch,
} from "@/lib/session/session-data-epoch";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

let unsettledDeferreds = 0;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  let settled = false;
  unsettledDeferreds += 1;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      unsettledDeferreds -= 1;
      resolvePromise(value);
    };
    reject = (reason) => {
      if (settled) return;
      settled = true;
      unsettledDeferreds -= 1;
      rejectPromise(reason);
    };
  });
  return { promise, resolve, reject };
}

async function withWatchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`timeout async: ${label}`)), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

after(() => {
  assert.equal(unsettledDeferreds, 0, "todos los deferred async deben finalizar");
});

function createPorts(input: {
  getEpoch(): SessionDataEpoch;
  refresh(): Promise<{ kind: AuthenticatedRefreshResultKind }>;
  onStart?(): void;
  onComplete?(intent: AuthenticatedSessionIntent, kind: "success" | "error"): void;
}) {
  return {
    refresh: input.refresh,
    isCurrent: (token: ReturnType<typeof captureSessionDataRequestToken>) => (
      isSessionDataRequestTokenCurrent(input.getEpoch(), token)
    ),
    onStart: input.onStart ?? (() => undefined),
    onComplete: input.onComplete ?? (() => undefined),
  };
}

for (const order of ["SIGNED_IN-before-handler", "handler-before-SIGNED_IN"] as const) {
  test(`login válido converge en un refresh y una navegación: ${order}`, async () => {
    const identity = { userId: "user-a", scope: "supabase:user-a" };
    const epoch = createSessionDataEpoch(identity);
    const token = captureSessionDataRequestToken(epoch);
    const coordinator = createAuthenticatedSessionCoordinator();
    const refresh = createDeferred<{ kind: "success" }>();
    let refreshes = 0;
    let navigations = 0;
    let formsCleared = 0;
    let destination: AuthenticatedSessionIntent | null = null;
    const ports = createPorts({
      getEpoch: () => epoch,
      refresh: () => {
        refreshes += 1;
        return refresh.promise;
      },
      onComplete: (intent) => {
        navigations += 1;
        formsCleared += 1;
        destination = intent;
      },
    });

    const firstIntent = order === "SIGNED_IN-before-handler" ? "restore-active-flow" : "dashboard";
    const secondIntent = order === "SIGNED_IN-before-handler" ? "dashboard" : "restore-active-flow";
    const first = coordinator.continueSession(token, firstIntent, ports);
    const second = coordinator.continueSession(token, secondIntent, ports);
    refresh.resolve({ kind: "success" });

    assert.deepEqual(await withWatchdog(Promise.all([first, second]), `login ${order}`), [
      { kind: "completed", refreshKind: "success" },
      { kind: "completed", refreshKind: "success" },
    ]);
    assert.equal(refreshes, 1);
    assert.equal(navigations, 1);
    assert.equal(formsCleared, 1);
    assert.equal(destination, "dashboard");
  });
}

test("INITIAL_SESSION y bootstrap concurrentes comparten continuación restore", async () => {
  const epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const token = captureSessionDataRequestToken(epoch);
  const coordinator = createAuthenticatedSessionCoordinator();
  const refresh = createDeferred<{ kind: "success" }>();
  let refreshes = 0;
  let completions = 0;
  const ports = createPorts({
    getEpoch: () => epoch,
    refresh: () => { refreshes += 1; return refresh.promise; },
    onComplete: (intent) => {
      assert.equal(intent, "restore-active-flow");
      completions += 1;
    },
  });
  const fromInitialSession = coordinator.continueSession(token, "restore-active-flow", ports);
  const fromBootstrap = coordinator.continueSession(token, "restore-active-flow", ports);
  refresh.resolve({ kind: "success" });
  await withWatchdog(Promise.all([fromInitialSession, fromBootstrap]), "INITIAL_SESSION + bootstrap");
  assert.equal(refreshes, 1);
  assert.equal(completions, 1);
});

test("refresh error conserva sesión y completa; stale no publica ni navega", async () => {
  for (const kind of ["error", "stale"] as const) {
    const epoch = createSessionDataEpoch({ userId: `user-${kind}`, scope: `supabase:user-${kind}` });
    const coordinator = createAuthenticatedSessionCoordinator();
    let completions = 0;
    const result = await coordinator.continueSession(
      captureSessionDataRequestToken(epoch),
      "dashboard",
      createPorts({
        getEpoch: () => epoch,
        refresh: async () => ({ kind }),
        onComplete: () => { completions += 1; },
      }),
    );
    if (kind === "error") {
      assert.deepEqual(result, { kind: "completed", refreshKind: "error" });
      assert.equal(completions, 1);
      assert.equal(epoch.userId, "user-error");
    } else {
      assert.deepEqual(result, { kind: "stale" });
      assert.equal(completions, 0);
    }
  }
});

test("begin A → reset → success pendiente queda stale y no restablece A", async () => {
  const epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const token = captureSessionDataRequestToken(epoch);
  const coordinator = createAuthenticatedSessionCoordinator();
  const refresh = createDeferred<{ kind: "success" }>();
  const calls = { completions: 0, navigations: 0, clearAuth: 0, publications: 0 };
  const pending = coordinator.continueSession(token, "dashboard", createPorts({
    getEpoch: () => epoch,
    refresh: () => refresh.promise,
    onComplete: () => {
      calls.completions += 1;
      calls.navigations += 1;
      calls.clearAuth += 1;
      calls.publications += 1;
    },
  }));

  coordinator.reset();
  refresh.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pending, "reset invalida A"), { kind: "stale" });
  assert.deepEqual(calls, { completions: 0, navigations: 0, clearAuth: 0, publications: 0 });

  let retryRefreshes = 0;
  assert.deepEqual(await coordinator.continueSession(token, "dashboard", createPorts({
    getEpoch: () => epoch,
    refresh: async () => { retryRefreshes += 1; return { kind: "success" }; },
  })), { kind: "completed", refreshKind: "success" });
  assert.equal(retryRefreshes, 1, "A no puede quedar established por la promesa invalidada");
});

test("begin A → reset → begin B: finally antiguo no borra inFlight B", async () => {
  const epochA = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const epochB = createSessionDataEpoch({ userId: "user-b", scope: "supabase:user-b" });
  const coordinator = createAuthenticatedSessionCoordinator();
  const refreshA = createDeferred<{ kind: "success" }>();
  const refreshB = createDeferred<{ kind: "success" }>();
  const calls = { refreshA: 0, refreshB: 0, completeA: 0, completeB: 0 };
  const pendingA = coordinator.continueSession(
    captureSessionDataRequestToken(epochA),
    "restore-active-flow",
    {
      refresh: () => { calls.refreshA += 1; return refreshA.promise; },
      isCurrent: () => true,
      onStart: () => undefined,
      onComplete: () => { calls.completeA += 1; },
    },
  );
  coordinator.reset();
  const tokenB = captureSessionDataRequestToken(epochB);
  const portsB = {
    refresh: () => { calls.refreshB += 1; return refreshB.promise; },
    isCurrent: () => true,
    onStart: () => undefined,
    onComplete: () => { calls.completeB += 1; },
  };
  const pendingB = coordinator.continueSession(tokenB, "dashboard", portsB);

  refreshA.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pendingA, "A resuelve despues de reset"), { kind: "stale" });
  const joinedB = coordinator.continueSession(tokenB, "restore-active-flow", portsB);
  assert.equal(joinedB, pendingB, "finally de A debe conservar la operación B in-flight");
  assert.deepEqual(calls, { refreshA: 1, refreshB: 1, completeA: 0, completeB: 0 });

  refreshB.resolve({ kind: "success" });
  assert.deepEqual(
    await withWatchdog(Promise.all([pendingB, joinedB]), "B completa una vez"),
    [
      { kind: "completed", refreshKind: "success" },
      { kind: "completed", refreshKind: "success" },
    ],
  );
  assert.deepEqual(calls, { refreshA: 1, refreshB: 1, completeA: 0, completeB: 1 });
});

test("begin A → reset → A en nueva generación completa sólo la operación nueva", async () => {
  let epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const coordinator = createAuthenticatedSessionCoordinator();
  const oldRefresh = createDeferred<{ kind: "success" }>();
  const newRefresh = createDeferred<{ kind: "success" }>();
  let completions = 0;
  const oldPending = coordinator.continueSession(
    captureSessionDataRequestToken(epoch),
    "dashboard",
    createPorts({ getEpoch: () => epoch, refresh: () => oldRefresh.promise, onComplete: () => { completions += 1; } }),
  );
  coordinator.reset();
  epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null }, { force: true });
  epoch = advanceSessionDataEpoch(epoch, { userId: "user-a", scope: "supabase:user-a" });
  const newPending = coordinator.continueSession(
    captureSessionDataRequestToken(epoch),
    "dashboard",
    createPorts({ getEpoch: () => epoch, refresh: () => newRefresh.promise, onComplete: () => { completions += 1; } }),
  );
  oldRefresh.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(oldPending, "A generación antigua"), { kind: "stale" });
  newRefresh.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(newPending, "A generación nueva"), {
    kind: "completed",
    refreshKind: "success",
  });
  assert.equal(completions, 1);
});

test("reset después de completion elimina established y obliga full refresh", async () => {
  const epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const token = captureSessionDataRequestToken(epoch);
  const coordinator = createAuthenticatedSessionCoordinator();
  let refreshes = 0;
  const ports = () => createPorts({
    getEpoch: () => epoch,
    refresh: async () => { refreshes += 1; return { kind: "success" }; },
  });
  await coordinator.continueSession(token, "dashboard", ports());
  assert.deepEqual(await coordinator.continueSession(token, "dashboard", ports()), { kind: "same-identity" });
  coordinator.reset();
  assert.deepEqual(await coordinator.continueSession(token, "dashboard", ports()), {
    kind: "completed",
    refreshKind: "success",
  });
  assert.equal(refreshes, 2);
});

test("doble reset es seguro e invalida definitivamente la continuación previa", async () => {
  const epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const coordinator = createAuthenticatedSessionCoordinator();
  const refresh = createDeferred<{ kind: "success" }>();
  let completions = 0;
  const pending = coordinator.continueSession(
    captureSessionDataRequestToken(epoch),
    "dashboard",
    createPorts({ getEpoch: () => epoch, refresh: () => refresh.promise, onComplete: () => { completions += 1; } }),
  );
  assert.doesNotThrow(() => {
    coordinator.reset();
    coordinator.reset();
  });
  refresh.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pending, "doble reset"), { kind: "stale" });
  assert.equal(completions, 0);
});

test("foreground de misma identidad conserva snapshot ready y Active Workout byte a byte", async () => {
  const epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const token = captureSessionDataRequestToken(epoch);
  const coordinator = createAuthenticatedSessionCoordinator();
  await coordinator.continueSession(token, "restore-active-flow", createPorts({
    getEpoch: () => epoch,
    refresh: async () => ({ kind: "success" }),
  }));

  const activeOwner = tryAcquireSessionOperationOwner(null, token, {
    dataMode: "supabase",
    operationId: "completion-owner-a",
  });
  assert.ok(activeOwner);
  let reducerState = activeWorkoutControllerReducer(
    createInitialActiveWorkoutControllerState(),
    {
      type: "workout_recovered",
      transition: {
        activeExerciseIndex: 2,
        activeWorkoutStartedAt: "2026-08-04T12:00:00.000Z",
        activeWorkoutAttemptId: "attempt-a",
        pendingReadinessLink: {
          workoutAttemptId: "attempt-a",
          trainingSessionId: "session-a",
        },
        hasStartedTraining: true,
        readiness: { motivation: 6, hydration: 5, sleep: 4, energy: 6, skipped: false },
        exerciseDrafts: {
          "exercise-a": {
            weight: "82.5",
            rir: "2",
            reps: [10, 9, ""],
            registered: true,
            observation: "tempo controlado",
          },
        },
      },
    },
  );
  reducerState = activeWorkoutControllerReducer(reducerState, { type: "readiness_save_started" });
  reducerState = activeWorkoutControllerReducer(reducerState, {
    type: "readiness_error_published",
    error: "error-a",
  });
  const state = {
    screen: "entrenamiento",
    history: ["dashboard"],
    trainingData: { cycles: "ready", cycleScoped: "ready", cycleId: "cycle-a" },
    activeWorkout: {
      position: 3,
      reducerState,
      refs: {
        attemptId: "attempt-a",
        pendingLink: { workoutAttemptId: "attempt-a", trainingSessionId: "session-a" },
        readinessContext: {
          workoutAttemptId: "attempt-a",
          cycleId: "cycle-a",
          cycleDayId: "cycle-day-a",
          workoutStartedAt: "2026-08-04T12:00:00.000Z",
        },
      },
      draft: { scope: "supabase:user-a", updatedAt: 100 },
      owner: activeOwner,
      busy: true,
      notice: "notice-a",
      error: "error-a",
    },
  };
  const before = structuredClone(state);
  const calls = {
    sessionUpdates: 0,
    resetActiveWorkout: 0,
    discard: 0,
    restoreOrReentry: 0,
    clearDraft: 0,
    navigation: 0,
    fullTrainingDataRefresh: 0,
    cyclesLoad: 0,
    planLoad: 0,
    sessionsLoad: 0,
    writes: 0,
    ownerReleases: 0,
    blockersPublished: 0,
    clearAuth: 0,
  };
  const foregroundPorts = createPorts({
    getEpoch: () => epoch,
    refresh: async () => {
      calls.fullTrainingDataRefresh += 1;
      calls.cyclesLoad += 1;
      calls.planLoad += 1;
      calls.sessionsLoad += 1;
      return { kind: "success" };
    },
    onStart: () => { calls.blockersPublished += 1; },
    onComplete: () => {
      calls.navigation += 1;
      calls.restoreOrReentry += 1;
      calls.clearAuth += 1;
    },
  });

  const foregroundEvents = [
    "SIGNED_IN",
    "INITIAL_SESSION",
    "TOKEN_REFRESHED",
    "SIGNED_IN",
    "SIGNED_IN",
    "TOKEN_REFRESHED",
    "INITIAL_SESSION",
  ] as const;
  for (const event of foregroundEvents) {
    const eventResult = coordinateAuthenticatedSessionEvent({
      event,
      state: { userId: "user-a", accessToken: `token-${event}` },
      currentIdentity: epoch,
      nextIdentity: { userId: "user-a", scope: "supabase:user-a" },
      intent: "restore-active-flow",
      hasAuthenticatedSession: true,
    }, {
      applySameIdentitySession: () => { calls.sessionUpdates += 1; },
      applyNewIdentitySession: () => {
        calls.resetActiveWorkout += 1;
        calls.discard += 1;
        calls.clearDraft += 1;
        calls.ownerReleases += 1;
        reducerState = activeWorkoutControllerReducer(reducerState, { type: "active_workout_reset" });
      },
      canContinueAfterSessionApplied: () => true,
      continueSession: (_nextState, intent) => coordinator.continueSession(token, intent, foregroundPorts),
    });
    assert.equal(eventResult.identity, "same-identity");
    assert.equal(eventResult.proceedAfterSessionApplied, true);
    if (event === "TOKEN_REFRESHED") {
      assert.equal(eventResult.continuation, null);
    } else {
      assert.ok(eventResult.continuation);
      assert.deepEqual(
        await eventResult.continuation,
        { kind: "same-identity" },
        event,
      );
    }
  }
  assert.deepEqual(state, before);
  assert.equal(state.activeWorkout.owner, activeOwner);
  assert.equal(isSessionDataRequestTokenCurrent(epoch, activeOwner.requestToken), true);
  assert.deepEqual(calls, {
    sessionUpdates: foregroundEvents.length,
    resetActiveWorkout: 0,
    discard: 0,
    restoreOrReentry: 0,
    clearDraft: 0,
    navigation: 0,
    fullTrainingDataRefresh: 0,
    cyclesLoad: 0,
    planLoad: 0,
    sessionsLoad: 0,
    writes: 0,
    ownerReleases: 0,
    blockersPublished: 0,
    clearAuth: 0,
  });
  assert.equal(epoch.generation, 0);
});

test("A→B directo invalida respuesta y Active Workout de A antes de cargar B", async () => {
  let epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const tokenA = captureSessionDataRequestToken(epoch);
  const ownerA = tryAcquireSessionOperationOwner(null, tokenA, {
    dataMode: "supabase",
    operationId: "owner-a",
  });
  assert.ok(ownerA);
  const coordinator = createAuthenticatedSessionCoordinator();
  const refreshA = createDeferred<{ kind: "success" }>();
  const refreshB = createDeferred<{ kind: "success" }>();
  const publications: string[] = [];
  const pendingA = coordinator.continueSession(tokenA, "restore-active-flow", createPorts({
    getEpoch: () => epoch,
    refresh: () => refreshA.promise,
    onComplete: () => publications.push("A"),
  }));

  const boundary = resolveActiveWorkoutSessionBoundary({
    currentIdentity: epoch,
    nextIdentity: { userId: "user-b", scope: "supabase:user-b" },
    event: "session_applied",
  });
  assert.equal(boundary.invalidateEpoch, true);
  assert.equal(boundary.resetActiveWorkoutMemory, true);
  epoch = advanceSessionDataEpoch(epoch, { userId: "user-b", scope: "supabase:user-b" });
  assert.equal(isSessionDataRequestTokenCurrent(epoch, ownerA.requestToken), false);
  const resetWorkout = activeWorkoutControllerReducer(
    activeWorkoutControllerReducer(createInitialActiveWorkoutControllerState(), { type: "training_started" }),
    { type: "active_workout_reset" },
  );
  assert.deepEqual(resetWorkout, createInitialActiveWorkoutControllerState());

  const pendingB = coordinator.continueSession(
    captureSessionDataRequestToken(epoch),
    "restore-active-flow",
    createPorts({
      getEpoch: () => epoch,
      refresh: () => refreshB.promise,
      onComplete: () => publications.push("B"),
    }),
  );
  refreshA.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pendingA, "A directo stale"), { kind: "stale" });
  assert.deepEqual(publications, []);
  refreshB.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pendingB, "B directo completa"), { kind: "completed", refreshKind: "success" });
  assert.deepEqual(publications, ["B"]);
});

test("A→SIGNED_OUT→B invalida A y B ejecuta carga completa", async () => {
  let epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const tokenA = captureSessionDataRequestToken(epoch);
  const coordinator = createAuthenticatedSessionCoordinator();
  const refreshA = createDeferred<{ kind: "success" }>();
  const refreshB = createDeferred<{ kind: "success" }>();
  const publications: string[] = [];
  const pendingA = coordinator.continueSession(tokenA, "restore-active-flow", createPorts({
    getEpoch: () => epoch,
    refresh: () => refreshA.promise,
    onComplete: () => publications.push("A"),
  }));

  epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null }, { force: true });
  coordinator.reset();
  epoch = advanceSessionDataEpoch(epoch, { userId: "user-b", scope: "supabase:user-b" });
  const tokenB = captureSessionDataRequestToken(epoch);
  const pendingB = coordinator.continueSession(tokenB, "restore-active-flow", createPorts({
    getEpoch: () => epoch,
    refresh: () => refreshB.promise,
    onComplete: () => publications.push("B"),
  }));
  refreshA.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pendingA, "A logout stale"), { kind: "stale" });
  assert.deepEqual(publications, []);
  refreshB.resolve({ kind: "success" });
  assert.deepEqual(await withWatchdog(pendingB, "B post logout completa"), { kind: "completed", refreshKind: "success" });
  assert.deepEqual(publications, ["B"]);
});

test("misma cuenta tras logout usa nueva generación y realiza carga fría", async () => {
  let epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const coordinator = createAuthenticatedSessionCoordinator();
  let refreshes = 0;
  const ports = () => createPorts({
    getEpoch: () => epoch,
    refresh: async () => { refreshes += 1; return { kind: "success" }; },
  });
  await coordinator.continueSession(captureSessionDataRequestToken(epoch), "dashboard", ports());
  epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null }, { force: true });
  coordinator.reset();
  epoch = advanceSessionDataEpoch(epoch, { userId: "user-a", scope: "supabase:user-a" });
  await coordinator.continueSession(captureSessionDataRequestToken(epoch), "restore-active-flow", ports());
  assert.equal(refreshes, 2);
  assert.equal(epoch.generation, 2);
});

test("reinicio frío sin coordinator establecido conserva validación y restore canónico", async () => {
  const epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const coordinator = createAuthenticatedSessionCoordinator();
  let refreshes = 0;
  let restores = 0;
  const result = await coordinator.continueSession(
    captureSessionDataRequestToken(epoch),
    "restore-active-flow",
    createPorts({
      getEpoch: () => epoch,
      refresh: async () => { refreshes += 1; return { kind: "success" }; },
      onComplete: (intent) => {
        if (intent === "restore-active-flow") restores += 1;
      },
    }),
  );
  assert.deepEqual(result, { kind: "completed", refreshKind: "success" });
  assert.equal(refreshes, 1);
  assert.equal(restores, 1);
});

test("credenciales inválidas conservan Login y copy canónico", () => {
  const state = { screen: "login", navigations: 0, fieldsCleared: false };
  assert.equal(translateAuthError({ message: "Invalid login credentials" }), "Correo o contraseña incorrectos.");
  assert.deepEqual(state, { screen: "login", navigations: 0, fieldsCleared: false });
});

function assertForegroundSourceContract(input: { root: string; coordinator: string }) {
  assert.doesNotMatch(
    input.root,
    /useEffect\(\(\) => \{[\s\S]*refreshTrainingCyclesBoundary\(\)[\s\S]*isTrainingCyclesRepositoryActive, supabaseUser\?\.id/,
  );
  assert.match(
    input.root,
    /continueAuthenticatedSession\([\s\S]*authenticatedSessionCoordinatorRef\.current\.continueSession/,
  );
  assert.match(input.coordinator, /let revision = 0;/);
  assert.match(input.coordinator, /const operationRevision = revision;/);
  assert.match(
    input.coordinator,
    /operationRevision !== revision \|\|\s*refreshResult\.kind === "stale"/,
  );
  assert.match(
    input.coordinator,
    /ports\.onComplete\(operation\.intent, refreshResult\.kind\);\s*if \(operationRevision !== revision\) return \{ kind: "stale" \};\s*establishedKey = key;/,
  );
  assert.match(input.coordinator, /finally \{\s*if \(inFlight === operation\) inFlight = null;/);
  assert.match(
    input.coordinator,
    /reset\(\) \{\s*revision \+= 1;\s*establishedKey = null;\s*inFlight = null;/,
  );
  assert.match(input.coordinator, /if \(establishedKey === key\) \{[\s\S]*kind: "same-identity"/);
  assert.match(
    input.coordinator,
    /export function coordinateAuthenticatedSessionEvent[\s\S]*if \(isSameIdentity\) \{\s*ports\.applySameIdentitySession\(input\.state\);\s*\} else \{\s*ports\.applyNewIdentitySession\(input\.state\);/,
  );

  const listenerStart = input.root.indexOf("const authSubscription = supabase?.auth.onAuthStateChange");
  const listenerEnd = input.root.indexOf("}).data.subscription;", listenerStart);
  assert.ok(listenerStart >= 0 && listenerEnd > listenerStart, "listener auth productivo ausente");
  const listener = input.root.slice(listenerStart, listenerEnd);
  assert.equal((listener.match(/coordinateAuthenticatedSessionEvent\(/g) ?? []).length, 1);
  assert.equal((listener.match(/applySessionState,/g) ?? []).length, 2);
  assert.doesNotMatch(listener, /applySessionState\(nextState\)/);
  assert.doesNotMatch(
    listener,
    /resetActiveWorkoutSessionState\(|activeWorkoutBoundary\.(?:discard|resetForIdentity)\(|clearWorkoutDraft\(|refreshTrainingDataForSession\(|appNavigationController\.reset\(|navigation\.(?:reset|transition)\(/,
    "el listener debe delegar sin efectos destructivos residuales",
  );

  const clearStart = input.root.indexOf("function clearUserSessionState");
  const clearEnd = input.root.indexOf("function restoreActiveFlowForSession", clearStart);
  const clearSession = input.root.slice(clearStart, clearEnd > clearStart ? clearEnd : undefined);
  assert.match(clearSession, /authenticatedSessionCoordinatorRef\.current\.reset\(\)/);
}

for (const mutation of [
  {
    name: "reintroducir carga de ciclos competidora durante login",
    target: "root" as const,
    apply: (source: string) => `${source}\nuseEffect(() => { if (isTrainingCyclesRepositoryActive) void refreshTrainingCyclesBoundary(); }, [isTrainingCyclesRepositoryActive, supabaseUser?.id]);\n`,
  },
  {
    name: "reintroducir refresh completo ante SIGNED_IN de misma identidad",
    target: "coordinator" as const,
    apply: (source: string) => source.replace("if (establishedKey === key) {", "if (false && establishedKey === key) {"),
  },
  {
    name: "eliminar invalidación interna del reset",
    target: "coordinator" as const,
    apply: (source: string) => source.replace("      revision += 1;\n", ""),
  },
  {
    name: "permitir onComplete después de reset",
    target: "coordinator" as const,
    apply: (source: string) => source.replace(
      "            operationRevision !== revision ||\n            refreshResult.kind === \"stale\" ||",
      "            refreshResult.kind === \"stale\" ||",
    ),
  },
  {
    name: "permitir que finally antiguo borre inFlight nuevo",
    target: "coordinator" as const,
    apply: (source: string) => source.replace(
      "if (inFlight === operation) inFlight = null;",
      "inFlight = null;",
    ),
  },
  {
    name: "agregar reset destructivo exacto tras seam same-identity",
    target: "root" as const,
    apply: (source: string) => source.replace(
      "      if (!authEventResult.proceedAfterSessionApplied) return;",
      "      resetActiveWorkoutSessionState(null);\n      if (!authEventResult.proceedAfterSessionApplied) return;",
    ),
  },
  {
    name: "agregar refresh completo tras seam same-identity",
    target: "root" as const,
    apply: (source: string) => source.replace(
      "      if (!authEventResult.proceedAfterSessionApplied) return;",
      "      void refreshTrainingDataForSession(nextState.dataMode);\n      if (!authEventResult.proceedAfterSessionApplied) return;",
    ),
  },
  {
    name: "permitir navegación tras seam same-identity",
    target: "root" as const,
    apply: (source: string) => source.replace(
      "      if (!authEventResult.proceedAfterSessionApplied) return;",
      "      navigation.transition(createAuthNavigationReset(\"dashboard\", \"session-established\"));\n      if (!authEventResult.proceedAfterSessionApplied) return;",
    ),
  },
  {
    name: "eliminar reset del coordinador en SIGNED_OUT",
    target: "root" as const,
    apply: (source: string) => source.replace(
      "    authenticatedSessionCoordinatorRef.current.reset();\n",
      "",
    ),
  },
] as const) {
  test(`mutation probe externo: ${mutation.name}`, () => {
    const originals = {
      root: readFileSync("src/components/organizatech-app.tsx", "utf8"),
      coordinator: readFileSync("src/features/app-shell/model/authenticated-session-coordinator.ts", "utf8"),
    };
    const mutated = mutation.apply(originals[mutation.target]);
    assert.notEqual(mutated, originals[mutation.target]);
    const directory = mkdtempSync(join(tmpdir(), "organizatech-auth-foreground-"));
    const temporary = join(directory, `${mutation.target}.probe`);
    try {
      writeFileSync(temporary, mutated, "utf8");
      assert.throws(() => assertForegroundSourceContract({
        ...originals,
        [mutation.target]: readFileSync(temporary, "utf8"),
      }));
      writeFileSync(temporary, originals[mutation.target], "utf8");
      assert.equal(readFileSync(temporary, "utf8"), originals[mutation.target]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
