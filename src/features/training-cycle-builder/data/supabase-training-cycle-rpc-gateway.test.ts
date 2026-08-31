import assert from "node:assert/strict";
import test from "node:test";

import {
  StableTrainingCycleRequestIds,
  TrainingCycleRpcGateway,
  type TrainingCycleRpcDataClient,
  type TrainingCycleRpcPrincipalClient,
} from "./supabase-training-cycle-rpc-gateway";
import { TrainingCycleTransportError, type TrainingCycleRpcPlan } from "./training-cycle-rpc-types";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID_2 = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID_3 = "20000000-0000-4000-8000-000000000003";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const DRAFT_ID_2 = "30000000-0000-4000-8000-000000000002";
const CYCLE_ID = "40000000-0000-4000-8000-000000000001";
const CATALOG_ID = "50000000-0000-4000-8000-000000000001";

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
