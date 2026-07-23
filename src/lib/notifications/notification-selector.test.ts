import assert from "node:assert/strict";

import {
  NOTIFICATION_EMPTY_MESSAGE,
  VISIBLE_NEW_NOTIFICATIONS_LIMIT,
  buildNotificationBadgeAriaLabel,
  buildNotificationBadgeText,
  buildNotificationItemStateLabel,
  buildNotificationPanelSubtitleText,
  resolveNotificationItemReferenceDate,
  selectNotificationView,
} from "@/lib/notifications/notification-selector";
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

// CASO 6 (parcial) — Selección: nuevas (no vistas, limitadas) e historial (vistas, por seenAt descendente).
function testSelectNotificationViewSplitsNewAndHistoryCorrectly() {
  const notifications = Array.from({ length: 8 }, (_, index) => buildNotification({ id: `n-${index}` }));
  const seenRecords: SeenNotificationRecord[] = [
    { id: "n-1", seenAt: 100 },
    { id: "n-3", seenAt: 300 },
    { id: "n-5", seenAt: 200 },
  ];

  const view = selectNotificationView(notifications, seenRecords);

  assert.deepEqual(
    view.newNotifications.map((n) => n.id),
    ["n-0", "n-2", "n-4", "n-6", "n-7"].slice(0, VISIBLE_NEW_NOTIFICATIONS_LIMIT),
    "las nuevas deben excluir las vistas y respetar el límite visible",
  );
  assert.equal(view.newNotifications.length, VISIBLE_NEW_NOTIFICATIONS_LIMIT);
  assert.deepEqual(
    view.historyNotifications.map((n) => n.id),
    ["n-3", "n-5", "n-1"],
    "el historial debe ordenarse por seenAt descendente (más recientemente vista primero)",
  );
  assert.equal(view.unseenCount, VISIBLE_NEW_NOTIFICATIONS_LIMIT);
}

function testSelectNotificationViewDoesNotMutateInputs() {
  const notifications = [buildNotification({ id: "a" }), buildNotification({ id: "b" })];
  const seenRecords: SeenNotificationRecord[] = [{ id: "a", seenAt: 100 }];
  const notificationsSnapshot = JSON.parse(JSON.stringify(notifications));
  const seenSnapshot = JSON.parse(JSON.stringify(seenRecords));

  selectNotificationView(notifications, seenRecords);

  assert.deepEqual(notifications, notificationsSnapshot);
  assert.deepEqual(seenRecords, seenSnapshot);
}

// CASO 13 (parcial) — Aislamiento: dos evaluaciones con conjuntos de "vistos" de identidades distintas
// nunca se contaminan entre sí (no hay estado compartido/global).
function testSelectNotificationViewIsolatesIndependentSeenSets() {
  const notifications = [buildNotification({ id: "shared-1" }), buildNotification({ id: "shared-2" })];
  const userASeen: SeenNotificationRecord[] = [{ id: "shared-1", seenAt: 1 }];
  const userBSeen: SeenNotificationRecord[] = [{ id: "shared-2", seenAt: 1 }];

  const viewA = selectNotificationView(notifications, userASeen);
  const viewB = selectNotificationView(notifications, userBSeen);

  assert.deepEqual(viewA.newNotifications.map((n) => n.id), ["shared-2"]);
  assert.deepEqual(viewB.newNotifications.map((n) => n.id), ["shared-1"]);
  assert.deepEqual(viewA.historyNotifications.map((n) => n.id), ["shared-1"]);
  assert.deepEqual(viewB.historyNotifications.map((n) => n.id), ["shared-2"]);
}

// CASO 15 — Textos: singular/plural y literales exactos de producción.
function testDerivedTextsMatchProductionExactlyIncludingSingularPlural() {
  assert.equal(buildNotificationPanelSubtitleText(1, 5), "1 nueva noticia");
  assert.equal(buildNotificationPanelSubtitleText(2, 5), "2 nuevas noticias");
  assert.equal(buildNotificationPanelSubtitleText(0, 3), "Historial");
  assert.equal(buildNotificationPanelSubtitleText(0, 0), "Sin pendientes");

  assert.equal(buildNotificationBadgeText(0), null);
  assert.equal(buildNotificationBadgeText(1), "1");
  assert.equal(buildNotificationBadgeText(9), "9");
  assert.equal(buildNotificationBadgeText(10), "+9");
  assert.equal(buildNotificationBadgeText(42), "+9");

  assert.equal(buildNotificationBadgeAriaLabel(0), null);
  assert.equal(buildNotificationBadgeAriaLabel(3), "3 notificaciones nuevas");

  assert.equal(NOTIFICATION_EMPTY_MESSAGE, "No tienes notificaciones por ahora.");
}

function testNotificationItemStateLabelUsesVistoNuevoAndFormattedDate() {
  const now = new Date(2026, 6, 23, 10, 0, 0);
  const seenLabel = buildNotificationItemStateLabel(true, "2026-07-23T09:00:00.000Z", now);
  const newLabel = buildNotificationItemStateLabel(false, "2026-07-22T09:00:00.000Z", now);
  assert.equal(seenLabel, "Visto · Hoy");
  assert.equal(newLabel, "Nuevo · Ayer");
}

// CASO 5 — Límites de día: un registro justo antes/después de medianoche local se etiqueta según el
// día LOCAL, no UTC accidental — se construyen ambos lados con el constructor local de Date (no ISO
// UTC crudo) para que el resultado no dependa de la zona horaria del entorno de ejecución.
function testDayBoundaryUsesLocalMidnightNotUtcAccidental() {
  const now = new Date(2026, 6, 23, 0, 5, 0); // 00:05 local, recién cruzada la medianoche
  const justBeforeMidnightYesterday = new Date(2026, 6, 22, 23, 55, 0).toISOString();
  const stillTodayEarlyMorning = new Date(2026, 6, 23, 0, 1, 0).toISOString();

  assert.equal(buildNotificationItemStateLabel(false, justBeforeMidnightYesterday, now), "Nuevo · Ayer");
  assert.equal(buildNotificationItemStateLabel(false, stillTodayEarlyMorning, now), "Nuevo · Hoy");
}

function testResolveNotificationItemReferenceDateUsesSeenAtWhenAvailable() {
  const notification = buildNotification({ id: "x", createdAt: "2026-07-01T00:00:00.000Z" });
  const seenRecord: SeenNotificationRecord = { id: "x", seenAt: new Date(2026, 6, 20, 12, 0, 0).getTime() };

  assert.equal(resolveNotificationItemReferenceDate(notification, seenRecord), new Date(seenRecord.seenAt).toISOString());
  assert.equal(resolveNotificationItemReferenceDate(notification, undefined), "2026-07-01T00:00:00.000Z");
}

testSelectNotificationViewSplitsNewAndHistoryCorrectly();
testSelectNotificationViewDoesNotMutateInputs();
testSelectNotificationViewIsolatesIndependentSeenSets();
testDerivedTextsMatchProductionExactlyIncludingSingularPlural();
testNotificationItemStateLabelUsesVistoNuevoAndFormattedDate();
testDayBoundaryUsesLocalMidnightNotUtcAccidental();
testResolveNotificationItemReferenceDateUsesSeenAtWhenAvailable();

console.log("notification-selector tests passed");
