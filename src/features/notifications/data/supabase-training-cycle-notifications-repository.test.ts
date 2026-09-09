import assert from "node:assert/strict";
import test from "node:test";

import {
  captureTrainingCycleNotificationsOperation,
  isTrainingCycleNotificationAppId,
  listTrainingCycleNotificationsWithOperation,
  markTrainingCycleNotificationsReadWithOperation,
  type TrainingCycleNotificationsDataClient,
  type TrainingCycleNotificationsPrincipalClient,
} from "./supabase-training-cycle-notifications-repository";

const USER_A = "10000000-0000-4000-8000-000000000001";
const NOTIFICATION = "20000000-0000-4000-8000-000000000001";
const CYCLE = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";

function principal(overrides?: {
  readonly onGetSession?: () => void;
  readonly onGetUser?: () => void;
  readonly throwSession?: boolean;
  readonly throwUser?: boolean;
}): TrainingCycleNotificationsPrincipalClient {
  return {
    auth: {
      async getSession() {
        overrides?.onGetSession?.();
        if (overrides?.throwSession) throw new Error("provider-session-secret");
        return { data: { session: { access_token: "token-a", user: { id: USER_A } } }, error: null } as never;
      },
      async getUser(accessToken?: string) {
        assert.equal(accessToken, "token-a");
        overrides?.onGetUser?.();
        if (overrides?.throwUser) throw new Error("provider-user-secret");
        return { data: { user: { id: USER_A } }, error: null } as never;
      },
    },
  };
}

function notificationRow(index = 1) {
  const suffix = index.toString().padStart(12, "0");
  return {
    notificationId: `20000000-0000-4000-8000-${suffix}`,
    cycleId: CYCLE,
    eventKind: index % 2 === 0 ? "closed_t1" : "expires_t1",
    scheduledOn: "2026-09-07",
    title: `Aviso ${index}`,
    body: "Revisa la fecha de término de tu ciclo.",
    materializedAt: `2026-09-01T${String(Math.min(index, 23)).padStart(2, "0")}:00:00.000Z`,
    readAt: index === 1 ? "2026-09-01T12:00:00.000Z" : null,
  };
}

test("captura sesión A, fija el token y valida owner antes de construir Data", async () => {
  let current = true;
  let pinnedToken = "";
  let getUserCalls = 0;
  const dataClient = { rpc: async () => ({ data: null, error: null }) } as TrainingCycleNotificationsDataClient;
  const operation = await captureTrainingCycleNotificationsOperation({
    principal: principal({ onGetUser: () => { getUserCalls += 1; } }),
    expectedUserId: USER_A,
    isCurrent: () => current,
    createPinnedClient(accessToken) {
      pinnedToken = accessToken;
      return dataClient;
    },
  });
  assert.equal(pinnedToken, "token-a");
  assert.equal(operation.dataClient, dataClient);
  assert.equal("auth" in operation.dataClient, false);
  assert.equal(getUserCalls, 1);
  current = false;
});

test("cambio A→B tras cualquier await aborta la captura antes del cliente pinned", async () => {
  for (const principalOverrides of [
    { onGetSession: () => undefined },
    { onGetUser: () => undefined },
  ]) {
    let current = true;
    let pinnedCalls = 0;
    const selected = principalOverrides.onGetSession
      ? principal({ onGetSession: () => { current = false; } })
      : principal({ onGetUser: () => { current = false; } });
    await assert.rejects(captureTrainingCycleNotificationsOperation({
      principal: selected,
      expectedUserId: USER_A,
      isCurrent: () => current,
      createPinnedClient() {
        pinnedCalls += 1;
        return { rpc: async () => ({ data: null, error: null }) };
      },
    }), /operation-stale/);
    assert.equal(pinnedCalls, 0);
  }
});

test("errores Auth del proveedor quedan sanitizados", async () => {
  for (const selected of [principal({ throwSession: true }), principal({ throwUser: true })]) {
    await assert.rejects(
      captureTrainingCycleNotificationsOperation({
        principal: selected,
        expectedUserId: USER_A,
        isCurrent: () => true,
      }),
      (error: unknown) => error instanceof Error
        && error.message === "training-cycle-notifications-session-mismatch"
        && !error.message.includes("secret"),
    );
  }
});

test("lista fija portal Usuario, limita 50 y usa cursor keyset pareado", async () => {
  const rows = Array.from({ length: 50 }, (_, index) => notificationRow(index + 1));
  const last = rows.at(-1)!;
  let verifications = 0;
  const result = await listTrainingCycleNotificationsWithOperation({
    operation: {
      dataClient: { rpc: async (name, args) => {
        assert.equal(name, "list_own_training_cycle_notifications");
        assert.deepEqual(args, {
          p_portal_scope: "usuario",
          p_limit: 50,
          p_before_materialized_at: "2026-08-01T00:00:00.000Z",
          p_before_id: NOTIFICATION,
        });
        return {
          data: {
            items: rows,
            nextCursor: {
              beforeMaterializedAt: last.materializedAt,
              beforeId: last.notificationId,
            },
          },
          error: null,
        };
      } },
      verifyExpectedUser: async () => { verifications += 1; },
    },
    cursor: {
      beforeMaterializedAt: "2026-08-01T00:00:00.000Z",
      beforeId: NOTIFICATION,
    },
    isCurrent: () => true,
  });

  assert.equal(verifications, 1);
  assert.equal(result.notifications.length, 50);
  assert.equal(result.notifications[0]?.id, `training-cycle:${NOTIFICATION}`);
  assert.equal(result.notifications[0]?.target, "registro-entrenamiento");
  assert.equal(result.notifications[0]?.kind, "training-cycle");
  assert.equal(result.notifications[0]?.tone, "warning");
  assert.equal(result.notifications[1]?.tone, "success");
  assert.equal(result.seenRecords[0]?.id, `training-cycle:${NOTIFICATION}`);
  assert.deepEqual(result.nextCursor, {
    beforeMaterializedAt: last.materializedAt,
    beforeId: last.notificationId,
  });
});

test("lista fail-closed ante shapes desconocidos, más de 50 filas o cursor inconsistente", async () => {
  const invalidResults: unknown[] = [
    { items: [], nextCursor: null, unexpected: true },
    { items: [{ ...notificationRow(), unexpected: true }], nextCursor: null },
    { items: Array.from({ length: 51 }, (_, index) => notificationRow(index + 1)), nextCursor: null },
    {
      items: [notificationRow()],
      nextCursor: { beforeMaterializedAt: notificationRow().materializedAt, beforeId: NOTIFICATION },
    },
    { items: [{ ...notificationRow(), scheduledOn: "2026-02-31" }], nextCursor: null },
  ];

  for (const data of invalidResults) {
    await assert.rejects(listTrainingCycleNotificationsWithOperation({
      operation: {
        dataClient: { rpc: async () => ({ data, error: null }) },
        verifyExpectedUser: async () => undefined,
      },
      isCurrent: () => true,
    }), /training-cycle-notifications-invalid/);
  }
});

test("fallo RPC no filtra mensaje del proveedor y owner stale no publica filas", async () => {
  await assert.rejects(
    listTrainingCycleNotificationsWithOperation({
      operation: {
        dataClient: { rpc: async () => { throw new Error("database-password-secret"); } },
        verifyExpectedUser: async () => undefined,
      },
      isCurrent: () => true,
    }),
    (error: unknown) => error instanceof Error
      && error.message === "training-cycle-notifications-load-failed"
      && !error.message.includes("secret"),
  );

  let current = true;
  let verifications = 0;
  await assert.rejects(listTrainingCycleNotificationsWithOperation({
    operation: {
      dataClient: { rpc: async () => {
        current = false;
        return { data: { items: [notificationRow()], nextCursor: null }, error: null };
      } },
      verifyExpectedUser: async () => { verifications += 1; },
    },
    isCurrent: () => current,
  }), /operation-stale/);
  assert.equal(verifications, 0);
});

test("mark-read fija Usuario y reutiliza el mismo request UUID en replays exactos", async () => {
  const calls: Array<Readonly<Record<string, unknown>>> = [];
  let verifications = 0;
  const operation = {
    dataClient: { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
      assert.equal(name, "mark_own_training_cycle_notifications_read");
      calls.push(args);
      return {
        data: {
          responseKind: "accepted_operation",
          requestId: REQUEST,
          operationKind: "notifications_mark_read",
          aggregateId: REQUEST,
          resultVersion: null,
        },
        error: null,
      };
    } },
    verifyExpectedUser: async () => { verifications += 1; },
  };

  for (let replay = 0; replay < 2; replay += 1) {
    await markTrainingCycleNotificationsReadWithOperation({
      operation,
      ids: [NOTIFICATION],
      requestId: REQUEST,
      isCurrent: () => true,
    });
  }

  assert.equal(verifications, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], {
    p_request_id: REQUEST,
    p_portal_scope: "usuario",
    p_notification_ids: [NOTIFICATION],
  });
});

test("mark-read rechaza selección no allowlisted y receipts ambiguos", async () => {
  let rpcCalls = 0;
  const operation = {
    dataClient: { rpc: async () => {
      rpcCalls += 1;
      return {
        data: {
          responseKind: "accepted_operation",
          requestId: "50000000-0000-4000-8000-000000000001",
          operationKind: "notifications_mark_read",
          aggregateId: REQUEST,
          resultVersion: null,
        },
        error: null,
      };
    } },
    verifyExpectedUser: async () => undefined,
  };

  await assert.rejects(markTrainingCycleNotificationsReadWithOperation({
    operation,
    ids: [NOTIFICATION, NOTIFICATION],
    requestId: REQUEST,
    isCurrent: () => true,
  }), /invalid-selection/);
  assert.equal(rpcCalls, 0);

  await assert.rejects(markTrainingCycleNotificationsReadWithOperation({
    operation,
    ids: [NOTIFICATION],
    requestId: REQUEST,
    isCurrent: () => true,
  }), /invalid-receipt/);
  assert.equal(rpcCalls, 1);
});

test("identificador de app sólo acepta el prefijo lifecycle y UUID completo", () => {
  assert.equal(isTrainingCycleNotificationAppId(`training-cycle:${NOTIFICATION}`), true);
  assert.equal(isTrainingCycleNotificationAppId(`calendar:${NOTIFICATION}`), false);
  assert.equal(isTrainingCycleNotificationAppId("training-cycle:not-a-uuid"), false);
});
