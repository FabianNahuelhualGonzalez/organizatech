import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const notificationGroupSource = readFileSync("src/features/notifications/components/NotificationGroup.tsx", "utf8");
const notificationsControllerSource = readFileSync("src/features/notifications/model/notifications-controller.ts", "utf8");
const notificationsHookSource = readFileSync("src/features/notifications/hooks/useNotificationsController.ts", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const modelTestSource = readFileSync("src/lib/notifications/notification-model.test.ts", "utf8");

function sourceSection(startMarker: string, endMarker: string): string {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontro el inicio del contrato: ${startMarker}`);
  assert.ok(end > start, `No se encontro el final del contrato: ${endMarker}`);
  return appSource.slice(start, end);
}

function assertInOrder(source: string, markers: string[]) {
  let previous = -1;
  markers.forEach((marker) => {
    const current = source.indexOf(marker);
    assert.ok(current >= 0, `Falta el paso requerido: ${marker}`);
    assert.ok(current > previous, `El paso esta fuera de orden: ${marker}`);
    previous = current;
  });
}

// CASO 1: la aplicacion delega la construccion completa al modelo puro.
assert.match(appSource, /useNotificationsController\(\{/);
assert.match(notificationsControllerSource, /const appNotifications = buildAppNotifications\(catalogInput, now\)/);
assert.match(notificationGroupSource, /resolveNotificationIconKey\(notification\.category\)/);

// CASO 2: seleccion y textos derivados salen del selector puro.
assert.match(notificationsControllerSource, /selectNotificationView\(appNotifications, seenRecords\)/);
assert.match(notificationsControllerSource, /buildNotificationPanelSubtitleText/);
assert.match(notificationsControllerSource, /buildNotificationBadgeText/);
assert.match(notificationsControllerSource, /buildNotificationBadgeAriaLabel/);
assert.match(notificationGroupSource, /buildNotificationItemStateLabel\(/);
assert.match(notificationGroupSource, /resolveNotificationItemReferenceDate\(notification, seenRecord\)/);
assert.match(appSource, /\{NOTIFICATION_EMPTY_MESSAGE\}/);

// CASO 3: el controller conserva ref/persistencia y ejecuta I/O fuera de cualquier updater React.
const markSeenSource = notificationsControllerSource.slice(
  notificationsControllerSource.indexOf("      function markSeen"),
  notificationsControllerSource.indexOf("      return {", notificationsControllerSource.indexOf("      function markSeen")),
);
assertInOrder(markSeenSource, [
  "markNotificationsSeen(seenRecords, ids)",
  "input.storage.save(persistable, owner.scope)",
  "publish(persistable)",
]);
assert.doesNotMatch(markSeenSource, /new Map\(|\.sort\(|\.slice\(/, "React no debe reconstruir la regla de visto");
assert.doesNotMatch(notificationsHookSource, /set[A-Za-z]+\(\(current\)/);

// CASOS 4-6: el intent semantico se materializa con P2-D y los efectos quedan en React.
const openTargetSource = sourceSection("  function handleNotificationOpenIntent", "  function scrollToNotificationSection");
assertInOrder(openTargetSource, [
  "appShell.closeNotifications()",
  "activeWorkoutActions.clearTrainingCompletionSummary()",
  "setDashboardDayOverride(intent.dashboardDayOverride)",
  "dispatchProgressController({ type: \"day_selected\", day: intent.comparisonDayOverride })",
  "navigateTo(intent.target)",
  "scrollToNotificationSection(intent.section ?? undefined)",
]);
const openCommandStart = notificationsControllerSource.indexOf("        open(notification, publishIntent) {");
const openCommandEnd = notificationsControllerSource.indexOf("      };", openCommandStart);
assert.ok(openCommandStart >= 0 && openCommandEnd > openCommandStart, "se encontró el command open de Notifications");
const openCommandSource = notificationsControllerSource.slice(openCommandStart, openCommandEnd);
assertInOrder(openCommandSource, [
  "const intent = resolveNotificationOpenIntent(notification);",
  "const replayGuard = acquireOpenReplayGuard(owner, intent);",
  "if (!replayGuard) return false;",
  "if (!markSeen([notification.id])) {",
  "publishIntent(intent);",
]);
assert.doesNotMatch(openTargetSource, /setScreen\(/, "La apertura no debe crear navegacion paralela a P2-D");

const scrollSource = sourceSection("  function scrollToNotificationSection", "  const menuScreens");
assert.match(scrollSource, /document\.querySelector/);
assert.match(scrollSource, /window\.setTimeout/);
assert.match(scrollSource, /scrollIntoView/);

// CASO 7: no quedan reglas de dominio duplicadas en el componente.
[
  "buildAppNotifications",
  "createAppNotification",
  "isProfilePersonalDataIncomplete",
  "dedupeNotifications",
  "sortNotificationsByPriority",
  "compareNotifications",
  "getNotificationPriorityRank",
  "getNotificationVisual",
].forEach((name) => {
  assert.doesNotMatch(appSource, new RegExp(`(?:function|const)\\s+${name}\\b`), `${name} no debe redefinirse localmente`);
});
assert.doesNotMatch(appSource, /const VISIBLE_NEW_NOTIFICATIONS_LIMIT\b/);
assert.doesNotMatch(appSource, /const SEEN_NOTIFICATIONS_MAX_RECORDS\b/);
// Desde P3-07C el root importa NotificationPanel (que a su vez consume NotificationGroup);
// el root no importa el grupo directamente ni lo redefine.
assert.match(appSource, /import \{ NotificationPanel \} from "@\/features\/notifications\/components\/NotificationPanel";/);
assert.match(notificationGroupSource, /export function NotificationGroup\b/);
assert.doesNotMatch(appSource, /^\s*function NotificationGroup\b/m);

// CASO 8: la suite normal mantiene las pruebas conductuales del modelo que cubren sus ramas.
assert.match(packageSource, /tsx src\/lib\/notifications\/notification-model\.test\.ts/);
[
  "feature-notification-center-v1",
  "feature-weekly-comparison-v1",
  "complete-profile-v1",
  "feature-profile-phone-v1",
  "training-status-v2",
  "weekly-comparison-v1",
  "weekly-progress-v1",
  "smart-analysis-v1",
].forEach((branchId) => {
  assert.ok(modelTestSource.includes(branchId), `Falta cobertura de dominio para ${branchId}`);
});

console.log("notification-integration-contract tests passed");
