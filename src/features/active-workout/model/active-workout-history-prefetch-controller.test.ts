import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createActiveWorkoutHistoryPrefetchController,
  createActiveWorkoutHistoryPrefetchKey,
  createActiveWorkoutHistoryViewKey,
  isActiveWorkoutHistoryPublicationCurrent,
  type ActiveWorkoutHistoryPrefetchInput,
  type ActiveWorkoutHistoryPublication,
  type ActiveWorkoutHistoryPublicationOwner,
} from "@/features/active-workout/model/active-workout-history-prefetch-controller";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";

const CURRENT = "11111111-1111-4111-8111-111111111111";
const NEXT = "22222222-2222-4222-8222-222222222222";
const SECOND_NEXT = "33333333-3333-4333-8333-333333333333";
const OUTSIDE_WINDOW = "44444444-4444-4444-8444-444444444444";
const WORKOUT_STARTED_AT = "2026-08-06T12:00:00.000Z";

function token(
  userId: string | null = "user-a",
  generation = 1,
  scope: string | null = "authenticated:user-a",
): SessionDataRequestToken {
  return Object.freeze({ userId, generation, scope });
}

function input(
  requestToken: SessionDataRequestToken = token(),
  overrides: Partial<ActiveWorkoutHistoryPrefetchInput> = {},
): ActiveWorkoutHistoryPrefetchInput {
  return {
    requestToken,
    historyScope: { source: "cycle-scoped", cycleId: "cycle-a" },
    activeExerciseLineageId: CURRENT,
    workoutStartedAt: WORKOUT_STARTED_AT,
    performancePrefetchLineageIds: [CURRENT, NEXT, SECOND_NEXT, OUTSIDE_WINDOW],
    ...overrides,
  };
}

function performance(
  exerciseLineageId: string,
  sessionId = `session-${exerciseLineageId.slice(0, 4)}`,
): LatestExercisePerformance {
  return {
    sessionId,
    exerciseLineageId,
    trainedDate: "2026-08-05",
    trainedAt: "2026-08-05T12:00:00.000Z",
    completedAt: "2026-08-05T13:00:00.000Z",
    createdAt: "2026-08-05T12:00:00.000Z",
    series: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, reject, resolve };
}

function isSameToken(left: SessionDataRequestToken, right: SessionDataRequestToken) {
  return left.generation === right.generation &&
    left.userId === right.userId &&
    left.scope === right.scope;
}

test("prioriza el actual, limita la ventana a dos siguientes y nunca supera dos operaciones", async () => {
  const gates = new Map<string, ReturnType<typeof deferred<LatestExercisePerformance | null>>>();
  const calls: string[] = [];
  let active = 0;
  let maximumActive = 0;
  let currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls.push(exerciseLineageId);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const gate = deferred<LatestExercisePerformance | null>();
      gates.set(exerciseLineageId, gate);
      const result = await gate.promise;
      active -= 1;
      return result;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });

  const schedule = controller.synchronize(input(currentToken));
  assert.deepEqual(calls, [CURRENT, NEXT], "actual entra antes que cualquier prefetch");
  assert.equal(schedule.prefetch.length, 2, "sólo agenda los dos ejercicios siguientes");
  assert.equal(maximumActive, 2);

  gates.get(CURRENT)?.resolve(performance(CURRENT));
  await schedule.current;
  assert.deepEqual(calls, [CURRENT, NEXT, SECOND_NEXT]);
  assert.equal(calls.includes(OUTSIDE_WINDOW), false);

  gates.get(NEXT)?.resolve(performance(NEXT));
  gates.get(SECOND_NEXT)?.resolve(performance(SECOND_NEXT));
  await Promise.all(schedule.prefetch);
  assert.equal(maximumActive, 2);
  currentToken = token("user-b");
  controller.dispose();
});

test("deduplica la promise exacta de una key pendiente", async () => {
  const gate = deferred<LatestExercisePerformance | null>();
  let calls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      calls += 1;
      return gate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  const first = controller.synchronize(request);
  const second = controller.synchronize(request);
  assert.ok(first.current);
  assert.equal(second.current, first.current);
  assert.equal(calls, 1);

  gate.resolve(performance(CURRENT));
  await first.current;
  controller.dispose();
});

test("usuarios distintos con igual generación, scope y contexto tienen keys y promises aisladas", async () => {
  const gates: Array<ReturnType<typeof deferred<LatestExercisePerformance | null>>> = [];
  let currentToken = token("user-a", 7, "shared-scope");
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      const gate = deferred<LatestExercisePerformance | null>();
      gates.push(gate);
      return gate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });
  const sharedContext = {
    source: "cycle-scoped" as const,
    cycleId: "cycle-shared",
    workoutStartedAt: WORKOUT_STARTED_AT,
  };
  const userAKey = createActiveWorkoutHistoryPrefetchKey({
    requestToken: currentToken,
    ...sharedContext,
  }, CURRENT);
  const aSchedule = controller.synchronize(input(currentToken, {
    historyScope: sharedContext,
    performancePrefetchLineageIds: [CURRENT],
  }));

  currentToken = token("user-b", 7, "shared-scope");
  const userBKey = createActiveWorkoutHistoryPrefetchKey({
    requestToken: currentToken,
    ...sharedContext,
  }, CURRENT);
  const bSchedule = controller.synchronize(input(currentToken, {
    historyScope: sharedContext,
    performancePrefetchLineageIds: [CURRENT],
  }));

  assert.notEqual(userAKey, userBKey, "userId debe participar materialmente en la key");
  assert.notEqual(aSchedule.current, bSchedule.current, "A y B nunca deduplican la misma promise");
  gates[0]?.resolve(performance(CURRENT, "session-a"));
  gates[1]?.resolve(performance(CURRENT, "session-b"));
  await Promise.all([aSchedule.current, bSchedule.current]);

  assert.equal(controller.synchronize(input(currentToken, {
    historyScope: sharedContext,
    performancePrefetchLineageIds: [CURRENT],
  })).current, null, "B conserva sólo su propio cache hit");
  currentToken = token("user-a", 7, "shared-scope");
  const aAgain = controller.synchronize(input(currentToken, {
    historyScope: sharedContext,
    performancePrefetchLineageIds: [CURRENT],
  }));
  assert.ok(aAgain.current, "volver a A no reutiliza el cache de B");
  gates[2]?.resolve(performance(CURRENT, "session-a-new"));
  await aAgain.current;
  controller.dispose();
});

test("cache hit ready publica inmediatamente sin request nueva", async () => {
  let calls = 0;
  const publications: ActiveWorkoutHistoryPublication[] = [];
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls += 1;
      return performance(exerciseLineageId);
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await controller.synchronize(request).current;
  const beforeCacheHit = publications.length;
  const cacheHit = controller.synchronize(request);

  assert.equal(cacheHit.current, null);
  assert.equal(calls, 1);
  assert.equal(publications.length, beforeCacheHit + 1);
  assert.equal(publications.at(-1)?.status, "ready");
  assert.equal(publications.at(-1)?.performance?.exerciseLineageId, CURRENT);
  controller.dispose();
});

test("cachea empty y lo publica sin repetir la consulta", async () => {
  let calls = 0;
  const publications: ActiveWorkoutHistoryPublication[] = [];
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      calls += 1;
      return null;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await controller.synchronize(request).current;
  const cacheHit = controller.synchronize(request);
  assert.equal(cacheHit.current, null);
  assert.equal(calls, 1);
  assert.equal(publications.at(-1)?.status, "empty");
  assert.equal(publications.at(-1)?.performance, null);
  controller.dispose();
});

test("un cambio externo de epoch sin synchronize descarta y no cachea la request pendiente", async () => {
  const firstGate = deferred<LatestExercisePerformance | null>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  const originalToken = token("user-a", 1, "scope-a");
  let currentToken = originalToken;
  let calls = 0;
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls += 1;
      return calls === 1 ? firstGate.promise : performance(exerciseLineageId, "retry");
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });
  const request = input(originalToken, { performancePrefetchLineageIds: [CURRENT] });
  const pending = controller.synchronize(request);
  const publicationsBeforeResolve = publications.length;

  currentToken = token("user-a", 2, "scope-a");
  firstGate.resolve(performance(CURRENT, "stale-epoch"));
  await pending.current;
  assert.equal(publications.length, publicationsBeforeResolve, "epoch stale no publica success");

  const retryOldContext = controller.synchronize(request);
  assert.ok(retryOldContext.current, "el success stale tampoco entra al cache");
  assert.equal(calls, 2);
  await retryOldContext.current;
  controller.dispose();
});

test("invalidate borra un ready cacheado y obliga una request nueva en el mismo contexto", async () => {
  let calls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls += 1;
      return performance(exerciseLineageId, `request-${calls}`);
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await controller.synchronize(request).current;
  assert.equal(controller.synchronize(request).current, null, "precondición: existe cache ready");
  controller.invalidate();
  const afterInvalidation = controller.synchronize(request);

  assert.ok(afterInvalidation.current, "cache.clear() debe convertir la siguiente selección en miss");
  await afterInvalidation.current;
  assert.equal(calls, 2);
  controller.dispose();
});

test("cada instancia mantiene una cache privada", async () => {
  let calls = 0;
  const currentToken = token();
  const dependencies = {
    fetchPerformance: async ({ exerciseLineageId }: { exerciseLineageId: string }) => {
      calls += 1;
      return performance(exerciseLineageId, `instance-${calls}`);
    },
    isRequestTokenCurrent: (candidate: SessionDataRequestToken) =>
      isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  };
  const firstController = createActiveWorkoutHistoryPrefetchController(dependencies);
  const secondController = createActiveWorkoutHistoryPrefetchController(dependencies);
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await firstController.synchronize(request).current;
  await secondController.synchronize(request).current;

  assert.equal(calls, 2, "una cache global convertiría la segunda carga en un cache hit incorrecto");
  firstController.dispose();
  secondController.dispose();
});

test("revalidación legítima conserva el snapshot visible", async () => {
  const revalidation = deferred<LatestExercisePerformance | null>();
  let calls = 0;
  const publications: ActiveWorkoutHistoryPublication[] = [];
  const currentToken = token();
  const original = performance(CURRENT, "session-original");
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      calls += 1;
      return calls === 1 ? original : revalidation.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await controller.synchronize(request).current;
  const pending = controller.revalidateCurrent();
  assert.ok(pending);
  assert.equal(publications.at(-1)?.status, "loading");
  assert.equal(publications.at(-1)?.performance?.sessionId, "session-original");

  revalidation.resolve(performance(CURRENT, "session-revalidated"));
  await pending;
  assert.equal(publications.at(-1)?.status, "ready");
  assert.equal(publications.at(-1)?.performance?.sessionId, "session-revalidated");
  controller.dispose();
});

test("error → retry publica loading y reemplaza el error con el resultado productivo", async () => {
  const retryGate = deferred<LatestExercisePerformance | null>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  let calls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      calls += 1;
      if (calls === 1) throw new Error("fallo productivo");
      return retryGate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await controller.synchronize(request).current;
  assert.equal(publications.at(-1)?.status, "error");
  assert.notEqual(publications.at(-1)?.error, "");

  const retry = controller.revalidateCurrent();
  assert.ok(retry);
  assert.equal(calls, 2);
  assert.equal(publications.at(-1)?.status, "loading");
  assert.equal(publications.at(-1)?.loading, true);
  assert.equal(publications.at(-1)?.error, "");

  retryGate.resolve(performance(CURRENT, "session-after-retry"));
  await retry;
  assert.equal(publications.at(-1)?.status, "ready");
  assert.equal(publications.at(-1)?.performance?.sessionId, "session-after-retry");
  controller.dispose();
});

test("un segundo retry durante la petición activa reutiliza la promise y no duplica queries", async () => {
  const retryGate = deferred<LatestExercisePerformance | null>();
  let calls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls += 1;
      return calls === 1
        ? performance(exerciseLineageId, "session-original")
        : retryGate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  await controller.synchronize(request).current;
  const firstRetry = controller.revalidateCurrent();
  const secondRetry = controller.revalidateCurrent();

  assert.ok(firstRetry);
  assert.equal(secondRetry, firstRetry);
  assert.equal(calls, 2, "dos clicks comparten una sola consulta productiva");

  retryGate.resolve(performance(CURRENT, "session-retried-once"));
  await firstRetry;
  assert.equal(calls, 2);
  controller.dispose();
});

test("un retry tardío del ejercicio anterior nunca se publica sobre el nuevo ejercicio", async () => {
  const retryGate = deferred<LatestExercisePerformance | null>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  let currentCalls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      if (exerciseLineageId === CURRENT) {
        currentCalls += 1;
        return currentCalls === 1
          ? performance(CURRENT, "current-original")
          : retryGate.promise;
      }
      return performance(NEXT, "next-selected");
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });

  await controller.synchronize(input(currentToken, {
    performancePrefetchLineageIds: [CURRENT],
  })).current;
  const retry = controller.revalidateCurrent();
  assert.ok(retry);
  await controller.synchronize(input(currentToken, {
    activeExerciseLineageId: NEXT,
    performancePrefetchLineageIds: [NEXT],
  })).current;
  assert.equal(publications.at(-1)?.performance?.sessionId, "next-selected");

  const publicationsBeforeStaleResolve = publications.length;
  retryGate.resolve(performance(CURRENT, "current-late-retry"));
  await retry;
  assert.equal(publications.length, publicationsBeforeStaleResolve);
  assert.equal(publications.at(-1)?.exerciseLineageId, NEXT);
  assert.equal(publications.at(-1)?.performance?.sessionId, "next-selected");
  controller.dispose();
});

test("un cambio de identidad/sesión invalida el retry pendiente y descarta su respuesta", async () => {
  const retryGate = deferred<LatestExercisePerformance | null>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  let currentToken = token("user-a", 1, "session-a");
  let userACalls = 0;
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      if (currentToken.userId === "user-a") {
        userACalls += 1;
        return userACalls === 1
          ? performance(exerciseLineageId, "user-a-original")
          : retryGate.promise;
      }
      return performance(exerciseLineageId, "user-b-current");
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });

  await controller.synchronize(input(currentToken, {
    performancePrefetchLineageIds: [CURRENT],
  })).current;
  const staleRetry = controller.revalidateCurrent();
  assert.ok(staleRetry);

  currentToken = token("user-b", 2, "session-b");
  await controller.synchronize(input(currentToken, {
    performancePrefetchLineageIds: [CURRENT],
  })).current;
  assert.equal(publications.at(-1)?.performance?.sessionId, "user-b-current");

  const publicationsBeforeStaleResolve = publications.length;
  retryGate.resolve(performance(CURRENT, "user-a-late-retry"));
  await staleRetry;
  assert.equal(publications.length, publicationsBeforeStaleResolve);
  assert.equal(publications.at(-1)?.performance?.sessionId, "user-b-current");
  controller.dispose();
});

test("un ejercicio ya precargado se publica al seleccionarlo sin request nueva", async () => {
  const publications: ActiveWorkoutHistoryPublication[] = [];
  const calls: string[] = [];
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls.push(exerciseLineageId);
      return performance(exerciseLineageId);
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });

  const first = controller.synchronize(input(currentToken));
  await Promise.all([first.current, ...first.prefetch]);
  assert.equal(
    publications.some((publication) => publication.exerciseLineageId === NEXT),
    false,
    "un prefetch resuelto permanece silencioso hasta seleccionar ese lineage",
  );
  const selectedLineageCalls = calls.filter((lineageId) => lineageId === NEXT).length;
  const selected = controller.synchronize(input(currentToken, {
    activeExerciseLineageId: NEXT,
    performancePrefetchLineageIds: [CURRENT, NEXT, SECOND_NEXT, OUTSIDE_WINDOW],
  }));

  assert.equal(selected.current, null);
  assert.equal(
    calls.filter((lineageId) => lineageId === NEXT).length,
    selectedLineageCalls,
    "seleccionar el cache hit no repite su request aunque avance la ventana de prefetch",
  );
  assert.equal(publications.at(-1)?.status, "ready");
  assert.equal(publications.at(-1)?.exerciseLineageId, NEXT);
  controller.dispose();
});

test("A→SIGNED_OUT→B descarta la respuesta de A y sólo publica B", async () => {
  const gates = new Map<string, ReturnType<typeof deferred<LatestExercisePerformance | null>>>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  let currentToken = token("user-a", 1, "scope-a");
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      const owner = currentToken.userId ?? "signed-out";
      const gate = deferred<LatestExercisePerformance | null>();
      gates.set(owner, gate);
      return gate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });

  const aSchedule = controller.synchronize(input(currentToken, { performancePrefetchLineageIds: [CURRENT] }));
  currentToken = token(null, 2, null);
  const signedOut = controller.synchronize(input(currentToken, { performancePrefetchLineageIds: [CURRENT] }));
  assert.equal(signedOut.current, null);
  currentToken = token("user-b", 3, "scope-b");
  const bSchedule = controller.synchronize(input(currentToken, { performancePrefetchLineageIds: [CURRENT] }));

  gates.get("user-a")?.resolve(performance(CURRENT, "session-a"));
  await aSchedule.current;
  assert.equal(publications.some((entry) => entry.performance?.sessionId === "session-a"), false);

  gates.get("user-b")?.resolve(performance(CURRENT, "session-b"));
  await bSchedule.current;
  assert.equal(publications.at(-1)?.performance?.sessionId, "session-b");
  controller.dispose();
});

test("A→SIGNED_OUT→B descarta un error tardío de A sin contaminar B", async () => {
  const gates = new Map<string, ReturnType<typeof deferred<LatestExercisePerformance | null>>>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  let currentToken = token("user-a", 1, "scope-a");
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      const owner = currentToken.userId ?? "signed-out";
      const gate = deferred<LatestExercisePerformance | null>();
      gates.set(owner, gate);
      return gate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });

  const aSchedule = controller.synchronize(input(currentToken, { performancePrefetchLineageIds: [CURRENT] }));
  currentToken = token(null, 2, null);
  controller.synchronize(input(currentToken, { performancePrefetchLineageIds: [CURRENT] }));
  currentToken = token("user-b", 3, "scope-b");
  const bSchedule = controller.synchronize(input(currentToken, { performancePrefetchLineageIds: [CURRENT] }));

  gates.get("user-a")?.reject(new Error("late A failure"));
  await aSchedule.current;
  assert.equal(
    publications.some((entry) => entry.status === "error"),
    false,
    "el error tardío de A no se publica bajo B",
  );

  gates.get("user-b")?.resolve(performance(CURRENT, "session-b-after-a-error"));
  await bSchedule.current;
  assert.equal(publications.at(-1)?.performance?.sessionId, "session-b-after-a-error");
  controller.dispose();
});

test("generación, scope, source, ciclo y workoutStartedAt forman parte de invalidación", async () => {
  let currentToken = token();
  let calls = 0;
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async ({ exerciseLineageId }) => {
      calls += 1;
      return performance(exerciseLineageId, `session-${calls}`);
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });
  const noPrefetch = { performancePrefetchLineageIds: [CURRENT] } as const;

  await controller.synchronize(input(currentToken, noPrefetch)).current;
  currentToken = token("user-a", 2, "authenticated:user-a");
  await controller.synchronize(input(currentToken, noPrefetch)).current;
  currentToken = token("user-a", 2, "authenticated:user-a:rotated");
  await controller.synchronize(input(currentToken, noPrefetch)).current;
  await controller.synchronize(input(currentToken, {
    ...noPrefetch,
    historyScope: { source: "legacy", cycleId: "cycle-a" },
  })).current;
  await controller.synchronize(input(currentToken, {
    ...noPrefetch,
    historyScope: { source: "legacy", cycleId: "cycle-b" },
  })).current;
  await controller.synchronize(input(currentToken, {
    ...noPrefetch,
    historyScope: { source: "legacy", cycleId: "cycle-b" },
    workoutStartedAt: "2026-08-06T13:00:00.000Z",
  })).current;

  assert.equal(calls, 6);
  controller.dispose();
});

test("cambiar ciclo invalida cache sin filtrar la consulta lineage-wide", async () => {
  const params: unknown[] = [];
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async (requestParams) => {
      params.push(requestParams);
      return performance(requestParams.exerciseLineageId);
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });

  await controller.synchronize(input(currentToken, {
    historyScope: { source: "cycle-scoped", cycleId: "cycle-a" },
    performancePrefetchLineageIds: [CURRENT],
  })).current;
  await controller.synchronize(input(currentToken, {
    historyScope: { source: "cycle-scoped", cycleId: "cycle-b" },
    performancePrefetchLineageIds: [CURRENT],
  })).current;

  assert.equal(params.length, 2);
  for (const requestParams of params) {
    assert.deepEqual(requestParams, {
      exerciseLineageId: CURRENT,
      currentSessionId: null,
      beforeTimestamp: WORKOUT_STARTED_AT,
    });
  }
  controller.dispose();
});

test("unmount invalida en vuelo y vuelve inerte la instancia", async () => {
  const gate = deferred<LatestExercisePerformance | null>();
  const publications: ActiveWorkoutHistoryPublication[] = [];
  let calls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      calls += 1;
      return gate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: (publication) => publications.push(publication),
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  const schedule = controller.synchronize(request);
  controller.dispose();
  const publicationCountAfterDispose = publications.length;
  gate.resolve(performance(CURRENT));
  await schedule.current;
  const afterUnmount = controller.synchronize(request);

  assert.equal(publications.length, publicationCountAfterDispose);
  assert.equal(afterUnmount.current, null);
  assert.equal(calls, 1);
});

test("un finally stale no elimina una promise nueva para la misma key", async () => {
  const gates: Array<ReturnType<typeof deferred<LatestExercisePerformance | null>>> = [];
  let calls = 0;
  const currentToken = token();
  const controller = createActiveWorkoutHistoryPrefetchController({
    fetchPerformance: async () => {
      calls += 1;
      const gate = deferred<LatestExercisePerformance | null>();
      gates.push(gate);
      return gate.promise;
    },
    isRequestTokenCurrent: (candidate) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  });
  const request = input(currentToken, { performancePrefetchLineageIds: [CURRENT] });

  const stale = controller.synchronize(request);
  controller.invalidate();
  const fresh = controller.synchronize(request);
  assert.equal(calls, 2);

  gates[0]?.resolve(performance(CURRENT, "stale"));
  await stale.current;
  const deduped = controller.synchronize(request);
  assert.equal(deduped.current, fresh.current);
  assert.equal(calls, 2, "el finally viejo no debe habilitar una tercera request");

  gates[1]?.resolve(performance(CURRENT, "fresh"));
  await fresh.current;
  controller.dispose();
});

test("no precarga observaciones ni muta draft, inputs parciales o lista del caller", async () => {
  let observationCalls = 0;
  const currentToken = token();
  const lineageIds = Object.freeze([CURRENT, NEXT, SECOND_NEXT]);
  const draft = Object.freeze({
    ownerId: "user-a",
    exerciseId: "exercise-current",
    series: Object.freeze([{ reps: "8", weight: "80" }]),
    observation: "input parcial",
  });
  const beforeDraft = JSON.stringify(draft);
  const dependenciesWithObservationProbe = {
    fetchPerformance: async ({ exerciseLineageId }: { exerciseLineageId: string }) =>
      performance(exerciseLineageId),
    fetchObservation: async () => {
      observationCalls += 1;
      return null;
    },
    isRequestTokenCurrent: (candidate: SessionDataRequestToken) => isSameToken(candidate, currentToken),
    publishCurrent: () => {},
  };
  const controller = createActiveWorkoutHistoryPrefetchController(dependenciesWithObservationProbe);
  const request = Object.freeze(input(currentToken, {
    performancePrefetchLineageIds: lineageIds,
  }));

  const schedule = controller.synchronize(request);
  await Promise.all([schedule.current, ...schedule.prefetch]);

  assert.equal(observationCalls, 0);
  assert.deepEqual(request.performancePrefetchLineageIds, lineageIds);
  assert.equal(JSON.stringify(draft), beforeDraft);
  assert.equal(draft.ownerId, "user-a");
  assert.equal(draft.exerciseId, "exercise-current");
  assert.deepEqual(draft.series, [{ reps: "8", weight: "80" }]);
  assert.equal(draft.observation, "input parcial");
  controller.dispose();
});

test("la key distingue generación, identidad, scope, source, ciclo, corte y lineage", () => {
  const base = {
    requestToken: token(),
    source: "cycle-scoped" as const,
    cycleId: "cycle-a",
    workoutStartedAt: WORKOUT_STARTED_AT,
  };
  const baseKey = createActiveWorkoutHistoryPrefetchKey(base, CURRENT);
  const variants = [
    createActiveWorkoutHistoryPrefetchKey({ ...base, requestToken: token("user-a", 2) }, CURRENT),
    createActiveWorkoutHistoryPrefetchKey({ ...base, requestToken: token("user-b", 1, "authenticated:user-b") }, CURRENT),
    createActiveWorkoutHistoryPrefetchKey({ ...base, requestToken: token("user-a", 1, "scope-b") }, CURRENT),
    createActiveWorkoutHistoryPrefetchKey({ ...base, source: "legacy" }, CURRENT),
    createActiveWorkoutHistoryPrefetchKey({ ...base, cycleId: "cycle-b" }, CURRENT),
    createActiveWorkoutHistoryPrefetchKey({ ...base, workoutStartedAt: "2026-08-06T13:00:00.000Z" }, CURRENT),
    createActiveWorkoutHistoryPrefetchKey(base, NEXT),
  ];

  assert.equal(new Set([baseKey, ...variants]).size, variants.length + 1);
});

test("la publicación visible falla cerrado entre ejercicio, sesión, identidad y canal", () => {
  const viewKey = createActiveWorkoutHistoryViewKey({
    channel: "performance",
    activeExerciseId: "exercise-a",
    activeExerciseLineageId: CURRENT,
    workoutStartedAt: WORKOUT_STARTED_AT,
    historySource: "cycle-scoped",
    cycleId: "cycle-a",
    observationUserId: null,
  });
  const requestToken = token();
  const owner: ActiveWorkoutHistoryPublicationOwner = { viewKey, requestToken };
  const isCurrent = (candidate: SessionDataRequestToken) => isSameToken(candidate, requestToken);

  assert.equal(isActiveWorkoutHistoryPublicationCurrent(owner, viewKey, isCurrent), true);
  assert.equal(isActiveWorkoutHistoryPublicationCurrent(null, viewKey, isCurrent), false);
  assert.equal(isActiveWorkoutHistoryPublicationCurrent(owner, `${viewKey}:exercise-b`, isCurrent), false);
  assert.equal(isActiveWorkoutHistoryPublicationCurrent(owner, viewKey, () => false), false);

  for (const changedViewKey of [
    createActiveWorkoutHistoryViewKey({
      channel: "performance",
      activeExerciseId: "exercise-b",
      activeExerciseLineageId: NEXT,
      workoutStartedAt: WORKOUT_STARTED_AT,
      historySource: "cycle-scoped",
      cycleId: "cycle-a",
      observationUserId: null,
    }),
    createActiveWorkoutHistoryViewKey({
      channel: "performance",
      activeExerciseId: "exercise-a",
      activeExerciseLineageId: CURRENT,
      workoutStartedAt: "2026-08-06T13:00:00.000Z",
      historySource: "cycle-scoped",
      cycleId: "cycle-a",
      observationUserId: null,
    }),
    createActiveWorkoutHistoryViewKey({
      channel: "observation",
      activeExerciseId: "exercise-a",
      activeExerciseLineageId: CURRENT,
      workoutStartedAt: WORKOUT_STARTED_AT,
      historySource: null,
      cycleId: null,
      observationUserId: "user-a",
    }),
  ]) {
    assert.notEqual(changedViewKey, viewKey);
    assert.equal(isActiveWorkoutHistoryPublicationCurrent(owner, changedViewKey, isCurrent), false);
  }
});

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function getHookIntegrationViolations(source: string): string[] {
  const code = stripComments(source);
  const violations: string[] = [];
  if (!/createActiveWorkoutHistoryPrefetchController\s*\(\s*\{/.test(code)) {
    violations.push("controller_disconnected");
  }
  if (!/controller\.dispose\s*\(\s*\)/.test(code)) {
    violations.push("dispose_missing");
  }
  if (!code.includes("historyScope?: ActiveWorkoutHistoryScope")) {
    violations.push("history_scope_api_missing");
  }
  if (!code.includes("performancePrefetchLineageIds?: readonly string[]")) {
    violations.push("lineage_api_missing");
  }
  if (!code.includes("retryExerciseHistory: () => void")) {
    violations.push("retry_api_missing");
  }
  if (!/const retryExerciseHistory = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\);/.test(code)) {
    violations.push("retry_identity_unstable");
  }
  if (!/retryExercisePerformanceRef\.current\?\.\(\)/.test(code)) {
    violations.push("retry_current_ref_disconnected");
  }
  if (!/controller\.revalidateCurrent\(\)/.test(code)) {
    violations.push("controller_retry_disconnected");
  }
  if (!/const retryCurrentPerformance = \(\) => \{\s*void loadCurrentPerformance\(\);\s*\}/.test(code)) {
    violations.push("fallback_retry_disconnected");
  }
  if (!code.includes("if (pendingLoad) return pendingLoad;")) {
    violations.push("fallback_single_flight_missing");
  }
  if (
    (code.match(/isActiveWorkoutHistoryPublicationCurrent\(/g) ?? []).length < 2 ||
    !code.includes("latestExercisePerformance: isPerformancePublicationCurrent ?") ||
    !code.includes("latestExerciseObservation: isObservationPublicationCurrent ?")
  ) {
    violations.push("synchronous_publication_gate_missing");
  }

  const synchronizeStart = code.search(
    /(?:getPerformancePrefetchController\(\)|controller)\.synchronize\(\{/,
  );
  const synchronizeEnd = synchronizeStart >= 0 ? code.indexOf("});", synchronizeStart) : -1;
  if (synchronizeStart < 0 || synchronizeEnd < 0) {
    violations.push("synchronize_missing");
  } else {
    const synchronizeBlock = code.slice(synchronizeStart, synchronizeEnd);
    for (const requiredField of [
      "requestToken",
      "historyScope",
      "activeExerciseLineageId",
      "workoutStartedAt: activeWorkoutStartedAt",
      "performancePrefetchLineageIds",
    ]) {
      if (!synchronizeBlock.includes(requiredField)) {
        violations.push(`synchronize_missing_${requiredField}`);
      }
    }
    if (/observation/i.test(synchronizeBlock)) {
      violations.push("observation_mixed_into_prefetch");
    }
  }
  return violations;
}

test("el hook integra lifecycle, API opt-in, retry estable y mantiene observaciones fuera del prefetch", () => {
  const hookSource = readFileSync(
    new URL("../hooks/useActiveWorkoutExerciseHistory.ts", import.meta.url),
    "utf8",
  );

  assert.deepEqual(getHookIntegrationViolations(hookSource), []);
  assert.match(
    hookSource,
    /if \(historyScope && performancePrefetchLineageIds\)/,
    "el root actual conserva el fallback hasta entregar ambos campos",
  );
  assert.equal(
    (hookSource.match(/loadLatestExerciseObservationForRequest\(/g) ?? []).length,
    1,
    "observaciones conservan un único flujo current-only",
  );
  assert.doesNotMatch(
    hookSource.slice(
      hookSource.indexOf("controller.synchronize({"),
      hookSource.indexOf("// Fallback compatible"),
    ),
    /Observation|observation/,
  );
});

test("mutation probes de integración detectan desconexión, dispose omitido, mezcla y pérdida de cutoff", () => {
  const hookSource = readFileSync(
    new URL("../hooks/useActiveWorkoutExerciseHistory.ts", import.meta.url),
    "utf8",
  );
  const mutations = [
    {
      expected: "controller_disconnected",
      source: hookSource.replace(
        "createActiveWorkoutHistoryPrefetchController({",
        "createDisconnectedHistoryPrefetchController({ /* createActiveWorkoutHistoryPrefetchController */",
      ),
    },
    {
      expected: "dispose_missing",
      source: hookSource.replace("controller.dispose();", "/* controller.dispose(); */"),
    },
    {
      expected: "observation_mixed_into_prefetch",
      source: hookSource.replace(
        "requestToken,\n        historyScope,",
        "requestToken,\n        observationUserId,\n        historyScope,",
      ),
    },
    {
      expected: "synchronize_missing_workoutStartedAt: activeWorkoutStartedAt",
      source: hookSource.replace(
        "        activeExerciseLineageId: activeWorkoutExerciseLineageId,\n        workoutStartedAt: activeWorkoutStartedAt,\n        performancePrefetchLineageIds,",
        "        activeExerciseLineageId: activeWorkoutExerciseLineageId,\n        /* workoutStartedAt eliminado */\n        performancePrefetchLineageIds,",
      ),
    },
    {
      expected: "retry_api_missing",
      source: hookSource.replace(
        "retryExerciseHistory: () => void;",
        "/* retryExerciseHistory eliminado del resultado */",
      ),
    },
    {
      expected: "retry_identity_unstable",
      source: hookSource.replace(
        "const retryExerciseHistory = useCallback(() => {",
        "const retryExerciseHistory = () => {",
      ).replace("\n  }, []);", "\n  };"),
    },
    {
      expected: "controller_retry_disconnected",
      source: hookSource.replace(
        "void controller.revalidateCurrent();",
        "/* reintento controller desconectado */",
      ),
    },
    {
      expected: "fallback_retry_disconnected",
      source: hookSource.replace(
        "void loadCurrentPerformance();",
        "/* reintento fallback desconectado */",
      ),
    },
    {
      expected: "fallback_single_flight_missing",
      source: hookSource.replace(
        "if (pendingLoad) return pendingLoad;",
        "/* single-flight fallback eliminado */",
      ),
    },
    {
      expected: "synchronous_publication_gate_missing",
      source: hookSource.replace(
        "latestExercisePerformance: isPerformancePublicationCurrent ? latestExercisePerformance : null,",
        "latestExercisePerformance,",
      ),
    },
  ];

  for (const mutation of mutations) {
    assert.ok(
      getHookIntegrationViolations(mutation.source).includes(mutation.expected),
      `debe morir la mutación ${mutation.expected}`,
    );
  }
  assert.deepEqual(
    getHookIntegrationViolations(hookSource),
    [],
    "los probes son in-memory y preservan la fuente byte a byte",
  );
  assert.equal(
    readFileSync(new URL("../hooks/useActiveWorkoutExerciseHistory.ts", import.meta.url), "utf8"),
    hookSource,
    "la fuente productiva queda restaurada byte a byte tras todos los probes",
  );
});
