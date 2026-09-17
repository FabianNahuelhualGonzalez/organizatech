import assert from "node:assert/strict";

import {
  SEEN_NOTIFICATIONS_MAX_RECORDS,
  markNotificationsSeen,
  resolveNotificationOpenIntent,
} from "@/lib/notifications/notification-state";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";

function buildNotification(overrides: Partial<AppNotification> & Pick<AppNotification, "id">): AppNotification {
  return {
    title: "Título",
    summary: "Resumen",
    category: "Novedades",
    tone: "info",
    priority: "low",
    dedupeKey: overrides.id,
    target: "dashboard",
    kind: "feature",
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

// CASO 9 — Leída: marcar como vista modifica únicamente la notificación correcta.
function testMarkNotificationsSeenAffectsOnlyTheTargetedNotification() {
  const now = new Date(2026, 6, 23, 10, 0, 0);
  const current: SeenNotificationRecord[] = [{ id: "already-seen", seenAt: 1000 }];

  const next = markNotificationsSeen(current, ["new-one"], now);

  assert.equal(next.length, 2);
  assert.deepEqual(next.find((record) => record.id === "already-seen"), { id: "already-seen", seenAt: 1000 }, "un registro ya visto no debe alterarse");
  assert.deepEqual(next.find((record) => record.id === "new-one"), { id: "new-one", seenAt: now.getTime() });
}

// Marcar como vista una notificación ya vista no debe actualizar su seenAt original (idempotente).
function testMarkingAnAlreadySeenNotificationAgainKeepsOriginalSeenAt() {
  const current: SeenNotificationRecord[] = [{ id: "x", seenAt: 500 }];
  const next = markNotificationsSeen(current, ["x"], new Date(2026, 6, 23, 10, 0, 0));
  assert.deepEqual(next, [{ id: "x", seenAt: 500 }]);
}

// CASO 10 — "Descartada": en producción no existe una acción de descarte separada de "marcar como
// vista" (confirmado por búsqueda exhaustiva en organizatech-app.tsx: no hay ningún "dismiss"). Se
// verifica el comportamiento real más cercano: marcar una notificación como vista no debe eliminar ni
// alterar las demás, y nunca muta el arreglo/fuente recibidos.
function testMarkingOneNotificationSeenDoesNotRemoveOrMutateOthersOrTheSource() {
  const current: SeenNotificationRecord[] = [
    { id: "a", seenAt: 100 },
    { id: "b", seenAt: 200 },
  ];
  const snapshot = JSON.parse(JSON.stringify(current));

  const next = markNotificationsSeen(current, ["c"], new Date(2026, 6, 23, 10, 0, 0));

  assert.deepEqual(current, snapshot, "el arreglo recibido no debe mutarse");
  assert.ok(next.some((record) => record.id === "a"), "los registros previos no deben desaparecer");
  assert.ok(next.some((record) => record.id === "b"), "los registros previos no deben desaparecer");
  assert.equal(next.length, 3);
}

function testMarkNotificationsSeenWithEmptyIdsIsANoOpReturningTheSameReference() {
  const current: SeenNotificationRecord[] = [{ id: "a", seenAt: 100 }];
  const next = markNotificationsSeen(current, [], new Date(2026, 6, 23, 10, 0, 0));
  assert.equal(next, current, "sin ids que marcar, debe retornar exactamente la misma referencia (no-op)");
}

function testMarkNotificationsSeenTrimsToMaxRecords() {
  const current: SeenNotificationRecord[] = Array.from({ length: SEEN_NOTIFICATIONS_MAX_RECORDS }, (_, index) => ({
    id: `old-${index}`,
    seenAt: index,
  }));
  const next = markNotificationsSeen(current, ["new-record"], new Date(2026, 6, 23, 10, 0, 0));

  assert.equal(next.length, SEEN_NOTIFICATIONS_MAX_RECORDS, "no debe superar el máximo de registros");
  assert.ok(next.some((record) => record.id === "new-record"), "el nuevo registro debe conservarse");
  assert.ok(!next.some((record) => record.id === "old-0"), "el registro más antiguo debe descartarse al recortar");
}

// CASO 13 (parcial) — Aislamiento: marcar como vistas las notificaciones de una identidad no debe
// afectar los registros de otra identidad (no hay estado compartido entre llamadas).
function testMarkNotificationsSeenIsolatesIndependentIdentities() {
  const userARecords: SeenNotificationRecord[] = [{ id: "shared-id", seenAt: 10 }];
  const userBRecords: SeenNotificationRecord[] = [];

  const userANext = markNotificationsSeen(userARecords, ["another"], new Date(2026, 6, 23, 10, 0, 0));
  const userBNext = markNotificationsSeen(userBRecords, ["shared-id"], new Date(2026, 6, 23, 10, 0, 0));

  assert.ok(userANext.some((record) => record.id === "another"));
  assert.ok(!userBNext.some((record) => record.seenAt === 10), "el registro de la identidad A no debe filtrarse a la identidad B");
  assert.equal(userBNext.length, 1);
}

// CASO 14 — Inmutabilidad: no debe mutarse la notificación recibida al resolver la intención de apertura.
function testResolveNotificationOpenIntentDoesNotMutateNotification() {
  const notification = buildNotification({ id: "n-1", target: "dashboard", day: "Jueves", section: "training-carousel" });
  const snapshot = JSON.parse(JSON.stringify(notification));

  resolveNotificationOpenIntent(notification);

  assert.deepEqual(notification, snapshot);
}

function testResolveNotificationOpenIntentSetsDashboardDayOverrideOnlyForDashboardTarget() {
  const notification = buildNotification({ id: "n-1", target: "dashboard", day: "Jueves", section: "training-carousel" });
  const intent = resolveNotificationOpenIntent(notification);

  assert.deepEqual(intent, {
    notificationId: "n-1",
    target: "dashboard",
    dashboardDayOverride: "Jueves",
    comparisonDayOverride: null,
    section: "training-carousel",
  });
}

function testResolveNotificationOpenIntentSetsComparisonDayOverrideOnlyForComparisonTarget() {
  const notification = buildNotification({ id: "n-2", target: "comparacion", day: "Lunes", section: "weekly-comparison" });
  const intent = resolveNotificationOpenIntent(notification);

  assert.deepEqual(intent, {
    notificationId: "n-2",
    target: "comparacion",
    dashboardDayOverride: null,
    comparisonDayOverride: "Lunes",
    section: "weekly-comparison",
  });
}

function testResolveNotificationOpenIntentHasNoDayOverrideForProfileTargetEvenWithDay() {
  // Defensivo: en producción "perfil" nunca trae `day`, pero si lo trajera no debe activar ningún
  // override (solo "dashboard"/"comparacion" lo hacen, igual que las dos condiciones reales).
  const notification = buildNotification({ id: "n-3", target: "perfil", day: "Lunes", section: "profile-avatar" });
  const intent = resolveNotificationOpenIntent(notification);

  assert.equal(intent.dashboardDayOverride, null);
  assert.equal(intent.comparisonDayOverride, null);
  assert.equal(intent.section, "profile-avatar");
}

function testResolveNotificationOpenIntentHasNullSectionWhenAbsent() {
  const notification = buildNotification({ id: "n-4", target: "dashboard" });
  const intent = resolveNotificationOpenIntent(notification);
  assert.equal(intent.section, null);
  assert.equal(intent.dashboardDayOverride, null);
}

testMarkNotificationsSeenAffectsOnlyTheTargetedNotification();
testMarkingAnAlreadySeenNotificationAgainKeepsOriginalSeenAt();
testMarkingOneNotificationSeenDoesNotRemoveOrMutateOthersOrTheSource();
testMarkNotificationsSeenWithEmptyIdsIsANoOpReturningTheSameReference();
testMarkNotificationsSeenTrimsToMaxRecords();
testMarkNotificationsSeenIsolatesIndependentIdentities();
testResolveNotificationOpenIntentDoesNotMutateNotification();
testResolveNotificationOpenIntentSetsDashboardDayOverrideOnlyForDashboardTarget();
testResolveNotificationOpenIntentSetsComparisonDayOverrideOnlyForComparisonTarget();
testResolveNotificationOpenIntentHasNoDayOverrideForProfileTargetEvenWithDay();
testResolveNotificationOpenIntentHasNullSectionWhenAbsent();

console.log("notification-state tests passed");
