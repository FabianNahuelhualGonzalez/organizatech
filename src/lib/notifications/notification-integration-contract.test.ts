import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
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
assert.match(appSource, /import \{[\s\S]*?buildAppNotifications,[\s\S]*?resolveNotificationIconKey,[\s\S]*?\} from "@\/lib\/notifications\/notification-model";/);
assert.match(appSource, /const appNotifications = useMemo\(\(\) => buildAppNotifications\(\{/);

// CASO 2: seleccion y textos derivados salen del selector puro.
assert.match(appSource, /selectNotificationView\(appNotifications, seenNotificationRecords\)/);
assert.match(appSource, /buildNotificationPanelSubtitleText\(unseenNotificationCount, appNotifications\.length\)/);
assert.match(appSource, /buildNotificationBadgeText\(unseenNotificationCount\)/);
assert.match(appSource, /buildNotificationBadgeAriaLabel\(unseenNotificationCount\)/);
assert.match(appSource, /buildNotificationItemStateLabel\(/);
assert.match(appSource, /resolveNotificationItemReferenceDate\(notification, seenRecord\)/);
assert.match(appSource, /\{NOTIFICATION_EMPTY_MESSAGE\}/);

// CASO 3: React conserva estado/persistencia, pero la transicion inmutable es la pura.
const markSeenSource = sourceSection("  function markNotificationsSeen", "  function toggleNotifications");
assertInOrder(markSeenSource, [
  "setSeenNotificationRecords((current) => {",
  "transitionNotificationsSeen(current, ids)",
  "saveSeenNotificationRecords(next, scope)",
  "return next",
]);
assert.doesNotMatch(markSeenSource, /new Map\(|\.sort\(|\.slice\(/, "React no debe reconstruir la regla de visto");

// CASOS 4-6: el intent semantico se materializa con P2-D y los efectos quedan en React.
const openTargetSource = sourceSection("  function openNotificationTarget", "  function scrollToNotificationSection");
assertInOrder(openTargetSource, [
  "resolveNotificationOpenIntent(notification)",
  "markNotificationsSeen([intent.notificationId])",
  "setIsNotificationPanelOpen(false)",
  "setTrainingCompletionSummary(null)",
  "setDashboardDayOverride(intent.dashboardDayOverride)",
  "setComparisonDay(intent.comparisonDayOverride)",
  "navigateTo(intent.target)",
  "scrollToNotificationSection(intent.section ?? undefined)",
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
assert.match(appSource, /resolveNotificationIconKey\(notification\.category\)/);

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
