import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static notification panel visual preparation contract only.
 *
 * This test does not render React, simulate notification clicks or execute
 * browser, navigation, persistence or session behavior.
 */
const panelPath = "src/features/notifications/components/NotificationPanel.tsx";
const groupPath = "src/features/notifications/components/NotificationGroup.tsx";
const iconsPath = "src/features/notifications/components/NotificationIcons.tsx";
const panelSource = readFileSync(panelPath, "utf8");
const groupSource = readFileSync(groupPath, "utf8");
const iconsSource = readFileSync(iconsPath, "utf8");
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");

assert.equal(
  (panelSource.match(/export function NotificationPanel\b/g) ?? []).length,
  1,
  "NotificationPanel debe tener una sola definición preparada",
);
assert.match(panelSource, /import \{ NotificationGroup \} from "\.\/NotificationGroup";/);
assert.match(
  groupSource,
  /import \{ renderNotificationIcon \} from "@\/features\/notifications\/components\/NotificationIcons";/,
  "NotificationPanel reutiliza NotificationIcons mediante la implementación canónica NotificationGroup",
);
assert.doesNotMatch(panelSource, /function NotificationGroup\b|function renderNotificationIcon\b/);

for (const forbiddenDependency of [
  "@/components/organizatech-app",
  "@/features/app-shell/",
  "@/lib/navigation/",
  "@/lib/data/repository",
  "@/lib/storage/",
  "@/lib/supabase/",
  "localStorage",
  "sessionStorage",
  "window.",
  "document.",
  "setTimeout",
  "querySelector",
  "scrollIntoView",
  "useEffect",
  "useState",
  "setScreen",
  "markNotificationsSeen",
  "toggleNotifications",
  "openNotificationTarget",
  "scrollToNotificationSection",
]) {
  assert.doesNotMatch(
    panelSource,
    new RegExp(forbiddenDependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
}

for (const propName of [
  "isOpen",
  "subtitle",
  "totalNotificationsCount",
  "newNotifications",
  "historyNotifications",
  "seenNotificationRecordsById",
  "emptyMessage",
  "onClose",
  "onOpenNotification",
]) {
  assert.match(panelSource, new RegExp(`\\b${propName}:`));
}
assert.match(panelSource, /if \(!isOpen\) return null;/);
assert.match(panelSource, /className="notification-backdrop"/);
assert.match(panelSource, /aria-label="Cerrar notificaciones"/);
assert.match(panelSource, /onClick=\{onClose\}/);
assert.match(panelSource, /className="notification-panel" role="dialog" aria-label="Notificaciones"/);
assert.match(panelSource, /className="notification-panel-header"/);
assert.match(panelSource, /<strong>Notificaciones<\/strong>/);
assert.match(panelSource, /<span>\{subtitle\}<\/span>/);
assert.match(panelSource, /totalNotificationsCount > 0/);
assert.match(panelSource, /className="notification-list"/);
assert.match(panelSource, /className="notification-empty">\{emptyMessage\}<\/p>/);
assert.doesNotMatch(panelSource, /data-section=/);

const newGroupIndex = panelSource.indexOf('title="Nuevas"');
const historyGroupIndex = panelSource.indexOf('title="Historial"');
assert.ok(newGroupIndex >= 0, "el grupo Nuevas debe permanecer");
assert.ok(historyGroupIndex > newGroupIndex, "Historial debe renderizarse después de Nuevas");
assert.equal((panelSource.match(/<NotificationGroup\b/g) ?? []).length, 2);
assert.equal((groupSource.match(/export function NotificationGroup\b/g) ?? []).length, 1);
assert.equal((iconsSource.match(/export function renderNotificationIcon\b/g) ?? []).length, 1);

assert.doesNotMatch(appSource, /@\/features\/notifications\/components\/NotificationPanel/);
assert.match(appSource, /className="notification-backdrop"/);
assert.match(appSource, /className="notification-panel" role="dialog" aria-label="Notificaciones"/);
assert.match(appSource, /title="Nuevas"[\s\S]*title="Historial"/);
assert.match(appSource, /<p className="notification-empty">\{NOTIFICATION_EMPTY_MESSAGE\}<\/p>/);
assert.match(appSource, /function toggleNotifications\(\)/);
assert.match(appSource, /function openNotificationTarget\(notification: AppNotification\)/);
assert.match(appSource, /function scrollToNotificationSection\(section\?: AppNotificationSection\)/);

const openTargetStart = appSource.indexOf("function openNotificationTarget");
const openTargetEnd = appSource.indexOf("function scrollToNotificationSection", openTargetStart);
const openTargetSource = appSource.slice(openTargetStart, openTargetEnd);
const resolveIntentIndex = openTargetSource.indexOf("resolveNotificationOpenIntent(notification)");
const markSeenIndex = openTargetSource.indexOf("markNotificationsSeen([intent.notificationId])");
const closePanelIndex = openTargetSource.indexOf("setIsNotificationPanelOpen(false)");
const navigateIndex = openTargetSource.indexOf("navigateTo(intent.target)");
const scrollIndex = openTargetSource.indexOf("scrollToNotificationSection(intent.section ?? undefined)");
assert.ok(
  resolveIntentIndex >= 0 &&
    markSeenIndex > resolveIntentIndex &&
    closePanelIndex > markSeenIndex &&
    navigateIndex > closePanelIndex &&
    scrollIndex > navigateIndex,
  "el orden funcional productivo debe permanecer fuera del componente visual",
);

assert.doesNotMatch(packageSource, /notification-panel-visual-preparation-contract\.test\.ts/);

console.log("notification panel visual static preparation contract tests passed");
