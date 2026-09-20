import assert from "node:assert/strict";
import test from "node:test";

import type { AppNotification } from "@/lib/notifications/notification-types";
import {
  getOrCreateTrainingCycleMarkReadRequestId,
  selectOwnedTrainingCycleNotificationsSnapshot,
  shouldReloadAfterTrainingCycleMarkReadFailure,
} from "./usePersistedTrainingCycleNotifications";

const notification: AppNotification = {
  id: "training-cycle:20000000-0000-4000-8000-000000000001",
  title: "Mañana termina tu ciclo",
  summary: "Puedes extenderlo antes del cierre automático.",
  category: "Entrenamiento",
  tone: "warning",
  priority: "high",
  dedupeKey: "training-cycle:20000000-0000-4000-8000-000000000001",
  target: "registro-entrenamiento",
  kind: "training-cycle",
  createdAt: "2026-09-01T12:00:00.000Z",
};

test("snapshot Usuario A nunca se publica bajo B, Coach o contexto nulo", () => {
  const snapshotA = {
    ownerContextKey: "identity-a:usuario",
    notifications: [notification],
    seenRecords: [{ id: notification.id, seenAt: 1 }],
    nextCursor: {
      beforeMaterializedAt: notification.createdAt,
      beforeId: "20000000-0000-4000-8000-000000000001",
    },
  };

  assert.deepEqual(selectOwnedTrainingCycleNotificationsSnapshot(snapshotA, "identity-a:usuario"), {
    notifications: [notification],
    seenRecords: [{ id: notification.id, seenAt: 1 }],
    nextCursor: snapshotA.nextCursor,
  });
  for (const contextKey of ["identity-b:usuario", "identity-a:coach", null]) {
    assert.deepEqual(selectOwnedTrainingCycleNotificationsSnapshot(snapshotA, contextKey), {
      notifications: [],
      seenRecords: [],
      nextCursor: null,
    });
  }
});

test("mark-read conserva un request UUID estable por contexto y notificación", () => {
  const registry = new Map<string, string>();
  let created = 0;
  const createRequestId = () => {
    created += 1;
    return `40000000-0000-4000-8000-${created.toString().padStart(12, "0")}`;
  };
  const first = getOrCreateTrainingCycleMarkReadRequestId(
    registry,
    "identity-a:usuario",
    notification.id,
    createRequestId,
  );
  const replay = getOrCreateTrainingCycleMarkReadRequestId(
    registry,
    "identity-a:usuario",
    notification.id,
    createRequestId,
  );
  const otherOwner = getOrCreateTrainingCycleMarkReadRequestId(
    registry,
    "identity-b:usuario",
    notification.id,
    createRequestId,
  );

  assert.equal(first, replay);
  assert.notEqual(first, otherOwner);
  assert.equal(created, 2);
});

test("fallo tardío sólo recarga la generación propietaria vigente", () => {
  assert.equal(shouldReloadAfterTrainingCycleMarkReadFailure(4, 4), true);
  assert.equal(shouldReloadAfterTrainingCycleMarkReadFailure(4, 5), false);
});
