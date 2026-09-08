import assert from "node:assert/strict";
import test from "node:test";
import { TRAINING_CYCLE_AUTH_DEADLINE_MS, TRAINING_CYCLE_RPC_DEADLINE_MS } from "./training-cycle-transport-deadline";

import {
  StableTrainingCycleRequestIds,
  TrainingCycleRpcGateway,
  type TrainingCycleRpcDataClient,
  type TrainingCycleRpcPrincipalClient,
} from "./supabase-training-cycle-rpc-gateway";
import {
  TrainingCycleCommittedMutationError,
  TrainingCycleTransportError,
  type TrainingCycleRpcPlan,
} from "./training-cycle-rpc-types";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID_2 = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID_3 = "20000000-0000-4000-8000-000000000003";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const DRAFT_ID_2 = "30000000-0000-4000-8000-000000000002";
const CYCLE_ID = "40000000-0000-4000-8000-000000000001";
const CATALOG_ID = "50000000-0000-4000-8000-000000000001";

test("create/save de borrador permite Objetivo sin ejercicios y devuelve sus versiones reales", async () => {
  const calls: string[] = [];
  const emptyPlan: TrainingCycleRpcPlan = { days: [{ day: "tuesday", name: "", order: 0, exercises: [] }] };
  const repo = gateway({ requestIds: [REQUEST_ID, REQUEST_ID_2], dataClient: {
    async rpc(name, args) {
      calls.push(name);
      assert.deepEqual(args.p_plan, emptyPlan);
      return { data: {
        responseKind: "accepted_operation", requestId: args.p_request_id,
        operationKind: name === "create_own_training_cycle_draft" ? "draft_create" : "draft_save",
        aggregateId: DRAFT_ID, resultVersion: calls.length,
      }, error: null };
    },
  } });
  const input = { goal: "volume" as const, startDate: "2026-09-09", endDate: "2026-10-21", plan: emptyPlan };
  assert.equal((await repo.createDraft({ ...input, origin: "manual" })).resultVersion, 1);
  assert.equal((await repo.saveDraft({ ...input, draftId: DRAFT_ID, expectedVersion: 1 })).resultVersion, 2);
  assert.deepEqual(calls, ["create_own_training_cycle_draft", "save_own_training_cycle_draft"]);
});

test("Auth sin respuesta termina con error acotado y no inicia escrituras tardías", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveSession!: (result: Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getSession"]>>) => void;
  let calls = 0;
  const base = principal();
  const repo = new TrainingCycleRpcGateway({
    expectedUserId: USER_ID, portalScope: "usuario", isCurrent: () => true, createRequestId: () => REQUEST_ID,
    principal: { auth: { ...base.auth, getSession: () => new Promise((resolve) => { resolveSession = resolve; }) } },
    createPinnedClient: () => ({ async rpc() { calls++; return { data: null, error: null }; } }),
  });
  const result = assert.rejects(repo.createDraft({ origin: "manual", goal: "volume", startDate: "2026-09-01", endDate: "2026-10-01", plan }),
    (error) => error instanceof TrainingCycleTransportError && error.code === "service_unavailable");
  await new Promise(setImmediate);
  t.mock.timers.tick(TRAINING_CYCLE_AUTH_DEADLINE_MS);
  await result;
  resolveSession(await base.auth.getSession());
  await new Promise(setImmediate);
  assert.equal(calls, 0);
});

test("RPC colgado aborta transporte y su retry conserva el request ID del resultado incierto", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ids: unknown[] = [];
  let signal: AbortSignal | undefined;
  const repo = gateway({ dataClient: {
    rpc(_name, args) {
      ids.push(args.p_request_id);
      if (ids.length === 1) {
        const pending = new Promise<{ data: unknown; error: null }>(() => {});
        return Object.assign(pending, { abortSignal(value: AbortSignal) { signal = value; return pending; } });
      }
      return Promise.resolve({ data: {
        responseKind: "accepted_operation", requestId: args.p_request_id, operationKind: "draft_save",
        aggregateId: DRAFT_ID, resultVersion: 2,
      }, error: null });
    },
  } });
  const input = { draftId: DRAFT_ID, expectedVersion: 1, goal: "volume" as const, startDate: "2026-09-01", endDate: "2026-10-01", plan };
  const failed = assert.rejects(repo.saveDraft(input),
    (error) => error instanceof TrainingCycleTransportError && error.code === "service_unavailable");
  await new Promise(setImmediate);
  t.mock.timers.tick(TRAINING_CYCLE_RPC_DEADLINE_MS);
  await failed;
  assert.equal(signal?.aborted, true);
  assert.equal((await repo.saveDraft(input)).resultVersion, 2);
  assert.deepEqual(ids, [REQUEST_ID, REQUEST_ID]);
});

const plan: TrainingCycleRpcPlan = {
  days: [{
    day: "monday",
    name: "Empuje",
    order: 0,
    exercises: [{
      catalogExerciseId: CATALOG_ID,
      order: 0,
      technique: "linear",
      videoUrl: null,
      sets: [{ order: 0, targetReps: 10, targetKg: 100, toFailure: false, drops: [] }],
    }],
  }],
};

function preparedDraftResponse(requestId: unknown) {
  return {
    responseKind: "prepared_draft",
    requestId,
    operationKind: "draft_duplicate",
    aggregateId: DRAFT_ID,
    resultVersion: 1,
    draft: {
      draftId: DRAFT_ID,
      origin: "duplicate",
      sourceCycleId: CYCLE_ID,
      state: "draft",
      version: 1,
      goal: "volume",
      startDate: "2026-09-01",
      endDate: "2026-10-13",
      plan,
      activatedCycleId: null,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
    exerciseSources: [{
      kind: "catalog",
      id: CATALOG_ID,
      name: "Press",
      muscleGroup: "pectoral",
      videoUrl: null,
    }],
  };
}

function principal(counters?: {
  readonly user?: { value: number };
  readonly session?: { value: number };
}): TrainingCycleRpcPrincipalClient {
  return {
    auth: {
      async getSession() {
        if (counters?.session) counters.session.value += 1;
        return {
          data: {
            session: {
              access_token: "captured-token",
              user: { id: USER_ID },
            },
          },
          error: null,
        } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getSession"]>>;
      },
      async getUser(accessToken?: string) {
        assert.equal(accessToken, "captured-token");
        if (counters?.user) counters.user.value += 1;
        return {
          data: { user: { id: USER_ID } },
          error: null,
        } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getUser"]>>;
      },
    },
  };
}

function gateway(input: {
  readonly dataClient: TrainingCycleRpcDataClient;
  readonly requestIds?: readonly string[];
  readonly userChecks?: { value: number };
  readonly sessionChecks?: { value: number };
  readonly isCurrent?: () => boolean;
}) {
  const ids = [...(input.requestIds ?? [REQUEST_ID])];
  return new TrainingCycleRpcGateway({
    expectedUserId: USER_ID,
    portalScope: "usuario",
    isCurrent: input.isCurrent ?? (() => true),
    principal: principal({ user: input.userChecks, session: input.sessionChecks }),
    createPinnedClient(accessToken) {
      assert.equal(accessToken, "captured-token");
      return input.dataClient;
    },
    createRequestId() {
      const id = ids.shift();
      if (!id) throw new Error("request-id-fixture-exhausted");
      return id;
    },
  });
}

test("request IDs sobreviven un retry incierto y rotan después del acknowledgement", () => {
  const ids = [REQUEST_ID, REQUEST_ID_2];
  const owner = new StableTrainingCycleRequestIds(() => ids.shift()!);
  const payload = { version: 1, plan };
  const first = owner.get("draft_save", "usuario", payload);
  const replay = owner.get("draft_save", "usuario", { plan, version: 1 });
  assert.equal(first, REQUEST_ID);
  assert.equal(replay, REQUEST_ID);
  owner.acknowledge("draft_save", "usuario", payload, first);
  assert.equal(owner.get("draft_save", "usuario", payload), REQUEST_ID_2);
});

test("createCustomExercise canoniza youtu.be y elimina tracking en la última frontera", async () => {
  const calls: Array<Readonly<Record<string, unknown>>> = [];
  const repo = gateway({
    dataClient: {
      async rpc(name, args) {
        assert.equal(name, "create_own_training_custom_exercise");
        calls.push(args);
        return {
          data: {
            responseKind: "accepted_operation",
            requestId: args.p_request_id,
            operationKind: "custom_exercise_create",
            aggregateId: CATALOG_ID,
            resultVersion: null,
          },
          error: null,
        };
      },
    },
  });

  await repo.createCustomExercise({
    name: "  Press personalizado  ",
    muscleGroup: "pectoral",
    videoUrl: " https://youtu.be/AbCdEfGhI_1?si=tracking-value ",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.p_name, "Press personalizado");
  assert.equal(
    calls[0]!.p_video_url,
    "https://www.youtube.com/watch?v=AbCdEfGhI_1",
  );
  assert.equal("user_id" in calls[0]!, false);
});

test("save valida el token una vez, confirma sesión local y rota request UUID tras cada ACK", async () => {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const userChecks = { value: 0 };
  const sessionChecks = { value: 0 };
  const repo = gateway({
    requestIds: [REQUEST_ID, REQUEST_ID_2],
    userChecks,
    sessionChecks,
    dataClient: {
      async rpc(name, args) {
        assert.equal(name, "save_own_training_cycle_draft");
        calls.push(args);
        return {
          data: {
            responseKind: "accepted_operation",
            requestId: args.p_request_id,
            operationKind: "draft_save",
            aggregateId: DRAFT_ID,
            resultVersion: 2,
          },
          error: null,
        };
      },
    },
  });
  const input = {
    draftId: DRAFT_ID,
    expectedVersion: 1,
    goal: "strength" as const,
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    plan,
  };
  await repo.saveDraft(input);
  await repo.saveDraft(input);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.p_request_id, REQUEST_ID);
  assert.equal(calls[1]!.p_request_id, REQUEST_ID_2);
  assert.equal(calls[0]!.p_portal_scope, "usuario");
  assert.equal("user_id" in calls[0]!, false);
  assert.equal(userChecks.value, 2);
  assert.equal(sessionChecks.value, 6);
});

test("un fallo Auth posterior no puede convertir un commit RPC aceptado en FAIL", async () => {
  let userChecks = 0;
  let rpcCalls = 0;
  const repo = new TrainingCycleRpcGateway({
    expectedUserId: USER_ID,
    portalScope: "usuario",
    isCurrent: () => true,
    principal: {
      auth: {
        async getSession() {
          return {
            data: {
              session: {
                access_token: "captured-token",
                user: { id: USER_ID },
              },
            },
            error: null,
          } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getSession"]>>;
        },
        async getUser(accessToken?: string) {
          assert.equal(accessToken, "captured-token");
          userChecks += 1;
          if (userChecks > 1) {
            return {
              data: { user: null },
              error: { message: "transient auth failure" },
            } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getUser"]>>;
          }
          return {
            data: { user: { id: USER_ID } },
            error: null,
          } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getUser"]>>;
        },
      },
    },
    createPinnedClient() {
      return {
        async rpc(name, args) {
          assert.equal(name, "save_own_training_cycle_draft");
          rpcCalls += 1;
          return {
            data: {
              responseKind: "accepted_operation",
              requestId: args.p_request_id,
              operationKind: "draft_save",
              aggregateId: DRAFT_ID,
              resultVersion: 2,
            },
            error: null,
          };
        },
      };
    },
    createRequestId: () => REQUEST_ID,
  });

  const result = await repo.saveDraft({
    draftId: DRAFT_ID,
    expectedVersion: 1,
    goal: "strength",
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    plan,
  });

  assert.equal(result.resultVersion, 2);
  assert.equal(rpcCalls, 1);
  assert.equal(userChecks, 1);
});

test("autosave y activación secuencial usan una validación Auth remota por RPC", async () => {
  const calls: string[] = [];
  const userChecks = { value: 0 };
  const sessionChecks = { value: 0 };
  const repo = gateway({
    requestIds: [REQUEST_ID, REQUEST_ID_2],
    userChecks,
    sessionChecks,
    dataClient: {
      async rpc(name, args) {
        calls.push(name);
        if (name === "save_own_training_cycle_draft") {
          return {
            data: {
              responseKind: "accepted_operation",
              requestId: args.p_request_id,
              operationKind: "draft_save",
              aggregateId: DRAFT_ID,
              resultVersion: 2,
            },
            error: null,
          };
        }
        assert.equal(name, "activate_own_training_cycle_draft");
        return {
          data: {
            responseKind: "accepted_operation",
            requestId: args.p_request_id,
            operationKind: "cycle_activate",
            aggregateId: CYCLE_ID,
            resultVersion: 1,
          },
          error: null,
        };
      },
    },
  });

  await repo.saveDraft({
    draftId: DRAFT_ID,
    expectedVersion: 1,
    goal: "strength",
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    plan,
  });
  await repo.activateDraft(DRAFT_ID, 2);

  assert.deepEqual(calls, [
    "save_own_training_cycle_draft",
    "activate_own_training_cycle_draft",
  ]);
  assert.equal(userChecks.value, 2);
  assert.equal(sessionChecks.value, 6);
});

test("el guard detecta ciclos legacy y canónicos con un payload read-only mínimo", async () => {
  const calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
  const repo = gateway({
    dataClient: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: { cycleId: CYCLE_ID, hasCanonicalPlan: false },
          error: null,
        };
      },
    },
  });

  assert.deepEqual(await repo.getActiveCycleGuard(), {
    cycleId: CYCLE_ID,
    hasCanonicalPlan: false,
  });
  assert.deepEqual(calls, [{
    name: "get_own_active_training_cycle_guard",
    args: { p_portal_scope: "usuario" },
  }]);
});

test("la adaptación legacy es owner-scoped, idempotente y no envía ownership", async () => {
  const calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
  const repo = gateway({
    requestIds: [REQUEST_ID],
    dataClient: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: {
            responseKind: "legacy_compatibility",
            requestId: args.p_request_id,
            cycleId: CYCLE_ID,
            status: "adapted",
            version: 1,
            reason: null,
          },
          error: null,
        };
      },
    },
  });

  const result = await repo.adaptActiveLegacyCycle(CYCLE_ID);
  assert.equal(result.status, "adapted");
  assert.deepEqual(calls, [{
    name: "adapt_own_active_legacy_training_cycle",
    args: {
      p_request_id: REQUEST_ID,
      p_portal_scope: "usuario",
      p_expected_cycle_id: CYCLE_ID,
    },
  }]);
  assert.equal("user_id" in calls[0]!.args, false);
});

test("el reemplazo atómico usa sólo request, portal, fechas y el activo confirmado", async () => {
  const calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
  const repo = gateway({
    dataClient: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: preparedDraftResponse(args.p_request_id),
          error: null,
        };
      },
    },
  });

  const result = await repo.replaceActiveCycleToDraft({
    expectedActiveCycleId: CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  });
  assert.equal(result.aggregateId, DRAFT_ID);
  assert.equal(result.resultVersion, 1);
  assert.deepEqual(Object.keys(calls[0]!.args).sort(), [
    "p_end_date",
    "p_expected_active_cycle_id",
    "p_portal_scope",
    "p_request_id",
    "p_start_date",
  ]);
  assert.equal(calls[0]!.name, "replace_own_active_training_cycle_to_draft");
  assert.equal(calls[0]!.args.p_expected_active_cycle_id, CYCLE_ID);
  assert.equal(calls[0]!.args.p_portal_scope, "usuario");
  assert.equal("user_id" in calls[0]!.args, false);
});

test("un retry incierto del reemplazo conserva el mismo request idempotente", async () => {
  let attempt = 0;
  const requestIds: unknown[] = [];
  const repo = gateway({
    requestIds: [REQUEST_ID, REQUEST_ID_2],
    dataClient: {
      async rpc(name, args) {
        assert.equal(name, "replace_own_active_training_cycle_to_draft");
        requestIds.push(args.p_request_id);
        attempt += 1;
        if (attempt === 1) {
          return { data: null, error: { code: "08006", message: "private transport detail" } };
        }
        return {
          data: preparedDraftResponse(args.p_request_id),
          error: null,
        };
      },
    },
  });

  await assert.rejects(
    repo.replaceActiveCycleToDraft({ expectedActiveCycleId: CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13" }),
    (error) => error instanceof TrainingCycleTransportError && error.code === "service_unavailable",
  );
  await repo.replaceActiveCycleToDraft({ expectedActiveCycleId: CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13" });
  assert.deepEqual(requestIds, [REQUEST_ID, REQUEST_ID]);
});

test("una respuesta malformada posterior al commit se distingue de un rechazo pre-commit", async () => {
  const repo = gateway({
    dataClient: {
      async rpc(name, args) {
        assert.equal(name, "replace_own_active_training_cycle_to_draft");
        const response = preparedDraftResponse(args.p_request_id);
        return {
          data: { ...response, exerciseSources: [] },
          error: null,
        };
      },
    },
  });

  await assert.rejects(
    repo.replaceActiveCycleToDraft({
      expectedActiveCycleId: CYCLE_ID,
      startDate: "2026-09-01",
      endDate: "2026-10-13",
    }),
    (error) => error instanceof TrainingCycleCommittedMutationError,
  );
});

test("stale y verificación de sesión posteriores a la respuesta exitosa son committed", async () => {
  let current = true;
  const staleRepo = gateway({
    isCurrent: () => current,
    dataClient: {
      async rpc(_name, args) {
        current = false;
        return { data: preparedDraftResponse(args.p_request_id), error: null };
      },
    },
  });
  await assert.rejects(
    staleRepo.replaceActiveCycleToDraft({ expectedActiveCycleId: CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13" }),
    (error) => error instanceof TrainingCycleCommittedMutationError,
  );

  let sessionChecks = 0;
  const verifyRepo = new TrainingCycleRpcGateway({
    expectedUserId: USER_ID,
    portalScope: "usuario",
    isCurrent: () => true,
    principal: {
      auth: {
        async getSession() {
          sessionChecks += 1;
          const valid = sessionChecks < 3;
          return { data: { session: valid ? { access_token: "captured-token", user: { id: USER_ID } } : null }, error: null } as never;
        },
        async getUser() {
          return { data: { user: { id: USER_ID } }, error: null } as never;
        },
      },
    },
    createPinnedClient: () => ({
      async rpc(_name, args) {
        return { data: preparedDraftResponse(args.p_request_id), error: null };
      },
    }),
    createRequestId: () => REQUEST_ID,
  });
  await assert.rejects(
    verifyRepo.replaceActiveCycleToDraft({ expectedActiveCycleId: CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13" }),
    (error) => error instanceof TrainingCycleCommittedMutationError,
  );
});

test("mismatch de request u operación tras respuesta exitosa es committed", async () => {
  for (const mutation of [
    { requestId: REQUEST_ID_2 },
    { operationKind: "draft_save" },
  ]) {
    const repo = gateway({
      dataClient: {
        async rpc(_name, args) {
          return { data: { ...preparedDraftResponse(args.p_request_id), ...mutation }, error: null };
        },
      },
    });
    await assert.rejects(
      repo.replaceActiveCycleToDraft({ expectedActiveCycleId: CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13" }),
      (error) => error instanceof TrainingCycleCommittedMutationError,
    );
  }
});

test("rechazo RPC previo al commit conserva clasificación no committed", async () => {
  const repo = gateway({
    dataClient: { async rpc() { return { data: null, error: { code: "42501", message: "denied" } }; } },
  });
  await assert.rejects(
    repo.replaceActiveCycleToDraft({ expectedActiveCycleId: CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13" }),
    (error) => error instanceof TrainingCycleTransportError
      && !(error instanceof TrainingCycleCommittedMutationError),
  );
});

test("un cambio local de sesión falla cerrado antes de despachar el RPC", async () => {
  let sessionChecks = 0;
  let rpcCalls = 0;
  const repo = new TrainingCycleRpcGateway({
    expectedUserId: USER_ID,
    portalScope: "usuario",
    isCurrent: () => true,
    principal: {
      auth: {
        async getSession() {
          sessionChecks += 1;
          const changed = sessionChecks > 1;
          return {
            data: {
              session: {
                access_token: changed ? "other-token" : "captured-token",
                user: { id: changed ? DRAFT_ID : USER_ID },
              },
            },
            error: null,
          } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getSession"]>>;
        },
        async getUser() {
          return {
            data: { user: { id: USER_ID } },
            error: null,
          } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getUser"]>>;
        },
      },
    },
    createPinnedClient() {
      return {
        async rpc() {
          rpcCalls += 1;
          return { data: null, error: null };
        },
      };
    },
  });

  await assert.rejects(
    repo.getActiveCycle(),
    (error) => error instanceof TrainingCycleTransportError && error.code === "session_mismatch",
  );
  assert.equal(rpcCalls, 0);
});

test("un cambio local de sesión posterior al RPC falla cerrado sin repetir Auth remoto", async () => {
  let sessionChecks = 0;
  let userChecks = 0;
  let rpcCalls = 0;
  const repo = new TrainingCycleRpcGateway({
    expectedUserId: USER_ID,
    portalScope: "usuario",
    isCurrent: () => true,
    principal: {
      auth: {
        async getSession() {
          sessionChecks += 1;
          const changed = sessionChecks > 2;
          return {
            data: {
              session: {
                access_token: changed ? "other-token" : "captured-token",
                user: { id: changed ? DRAFT_ID : USER_ID },
              },
            },
            error: null,
          } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getSession"]>>;
        },
        async getUser(accessToken?: string) {
          assert.equal(accessToken, "captured-token");
          userChecks += 1;
          return {
            data: { user: { id: USER_ID } },
            error: null,
          } as unknown as Awaited<ReturnType<TrainingCycleRpcPrincipalClient["auth"]["getUser"]>>;
        },
      },
    },
    createPinnedClient() {
      return {
        async rpc(name) {
          assert.equal(name, "get_own_active_training_cycle");
          rpcCalls += 1;
          return { data: null, error: null };
        },
      };
    },
  });

  await assert.rejects(
    repo.getActiveCycle(),
    (error) => error instanceof TrainingCycleTransportError && error.code === "session_mismatch",
  );
  assert.equal(rpcCalls, 1);
  assert.equal(userChecks, 1);
  assert.equal(sessionChecks, 3);
});

test("un resultado incierto conserva request UUID sólo hasta recibir un ACK", async () => {
  const calls: Readonly<Record<string, unknown>>[] = [];
  let attempt = 0;
  const repo = gateway({
    requestIds: [REQUEST_ID, REQUEST_ID_2],
    dataClient: {
      async rpc(_name, args) {
        calls.push(args);
        attempt += 1;
        if (attempt === 1) {
          return { data: null, error: { code: "08006", message: "private transport detail" } };
        }
        return {
          data: {
            responseKind: "accepted_operation",
            requestId: args.p_request_id,
            operationKind: "draft_save",
            aggregateId: DRAFT_ID,
            resultVersion: attempt,
          },
          error: null,
        };
      },
    },
  });
  const input = {
    draftId: DRAFT_ID,
    expectedVersion: 1,
    goal: "strength" as const,
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    plan,
  };

  await assert.rejects(
    repo.saveDraft(input),
    (error) => error instanceof TrainingCycleTransportError
      && error.code === "service_unavailable"
      && !/private|transport/i.test(error.message),
  );
  await repo.saveDraft(input);
  await repo.saveDraft(input);
  assert.deepEqual(
    calls.map((call) => call.p_request_id),
    [REQUEST_ID, REQUEST_ID, REQUEST_ID_2],
  );
});

test("create→discard→create idéntico usa otro intent y otro aggregate", async () => {
  const requestIds: unknown[] = [];
  let createCount = 0;
  const repo = gateway({
    requestIds: [REQUEST_ID, REQUEST_ID_2, REQUEST_ID_3],
    dataClient: {
      async rpc(name, args) {
        requestIds.push(args.p_request_id);
        if (name === "create_own_training_cycle_draft") {
          createCount += 1;
          return {
            data: {
              responseKind: "accepted_operation",
              requestId: args.p_request_id,
              operationKind: "draft_create",
              aggregateId: createCount === 1 ? DRAFT_ID : DRAFT_ID_2,
              resultVersion: 1,
            },
            error: null,
          };
        }
        assert.equal(name, "discard_own_training_cycle_draft");
        return {
          data: {
            responseKind: "accepted_operation",
            requestId: args.p_request_id,
            operationKind: "draft_discard",
            aggregateId: DRAFT_ID,
            resultVersion: 1,
          },
          error: null,
        };
      },
    },
  });
  const input = {
    origin: "manual" as const,
    goal: "strength" as const,
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    plan,
  };

  const first = await repo.createDraft(input);
  await repo.discardDraft(first.aggregateId, first.resultVersion!);
  const second = await repo.createDraft(input);

  assert.equal(first.aggregateId, DRAFT_ID);
  assert.equal(second.aggregateId, DRAFT_ID_2);
  assert.notEqual(first.requestId, second.requestId);
  assert.deepEqual(requestIds, [REQUEST_ID, REQUEST_ID_2, REQUEST_ID_3]);
});

test("40001 se publica como conflicto sanitizado y no se reintenta", async () => {
  let calls = 0;
  const repo = gateway({
    dataClient: {
      async rpc() {
        calls += 1;
        return { data: null, error: { code: "40001", message: "secret database detail" } };
      },
    },
  });
  await assert.rejects(
    repo.extendActiveCycle({ cycleId: CYCLE_ID, expectedVersion: 1, newEndDate: "2026-11-01" }),
    (error) => {
      assert.ok(error instanceof TrainingCycleTransportError);
      assert.equal(error.code, "conflict");
      assert.doesNotMatch(error.message, /secret|database/i);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("PGRST202 identifica backend aún no migrado para conservar el fallback legacy", async () => {
  const repo = gateway({
    dataClient: {
      async rpc() {
        return { data: null, error: { code: "PGRST202", message: "schema detail" } };
      },
    },
  });
  await assert.rejects(repo.getActiveCycle(), (error) => {
    assert.ok(error instanceof TrainingCycleTransportError);
    assert.equal(error.code, "not_supported");
    assert.doesNotMatch(error.message, /schema/i);
    return true;
  });
});

test("mutaciones concurrentes se serializan y nunca compiten en RPC", async () => {
  let concurrent = 0;
  let maximum = 0;
  const repo = gateway({
    requestIds: [REQUEST_ID, REQUEST_ID_2],
    dataClient: {
      async rpc(name, args) {
        assert.equal(name, "extend_own_active_training_cycle");
        concurrent += 1;
        maximum = Math.max(maximum, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrent -= 1;
        return {
          data: {
            responseKind: "accepted_operation",
            requestId: args.p_request_id,
            operationKind: "cycle_extend",
            aggregateId: CYCLE_ID,
            resultVersion: args.p_new_end_date === "2026-11-01" ? 2 : 3,
          },
          error: null,
        };
      },
    },
  });
  const [first, second] = await Promise.all([
    repo.extendActiveCycle({ cycleId: CYCLE_ID, expectedVersion: 1, newEndDate: "2026-11-01" }),
    repo.extendActiveCycle({ cycleId: CYCLE_ID, expectedVersion: 2, newEndDate: "2026-12-01" }),
  ]);
  assert.equal(maximum, 1);
  assert.equal(first.resultVersion, 2);
  assert.equal(second.resultVersion, 3);
});

test("cursor keyset que no avanza falla cerrado", async () => {
  const cursor = {
    afterSourceKind: "catalog" as const,
    afterSortOrder: 1,
    afterName: "press plano",
    afterSourceId: CATALOG_ID,
  };
  const repo = gateway({
    dataClient: {
      async rpc() {
        return { data: { items: [], nextCursor: cursor }, error: null };
      },
    },
  });
  await assert.rejects(
    repo.listCatalog({ cursor }),
    (error) => error instanceof TrainingCycleTransportError && error.code === "invalid_response",
  );
});

test("owner epoch obsoleto detiene la operación antes de exponer resultados", async () => {
  let current = true;
  const userChecks = { value: 0 };
  const sessionChecks = { value: 0 };
  let rpcCalls = 0;
  const repo = gateway({
    isCurrent: () => current,
    userChecks,
    sessionChecks,
    dataClient: {
      async rpc() {
        rpcCalls += 1;
        current = false;
        return { data: null, error: null };
      },
    },
  });
  await assert.rejects(
    repo.getActiveCycle(),
    (error) => error instanceof TrainingCycleTransportError && error.code === "stale_operation",
  );
  assert.equal(rpcCalls, 1);
  assert.equal(userChecks.value, 1);
  assert.equal(sessionChecks.value, 2);
});
