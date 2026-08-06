import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const controllerSource = readFileSync(
  "src/features/app-shell/hooks/useAppNavigationController.ts",
  "utf8",
);
const controllerModelSource = readFileSync(
  "src/features/app-shell/model/app-navigation-controller-state.ts",
  "utf8",
);
const transitionSource = readFileSync("src/lib/navigation/app-navigation-transition.ts", "utf8");
const notificationsControllerSource = readFileSync(
  "src/features/notifications/model/notifications-controller.ts",
  "utf8",
);

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontro el inicio: ${startMarker}`);
  assert.ok(end > start, `No se encontro el final: ${endMarker}`);
  return source.slice(start, end);
}

assert.equal((appSource.match(/\bsetScreen\b/g) ?? []).length, 0);
assert.equal((appSource.match(/\bsetScreenHistory\b/g) ?? []).length, 0);
assert.match(appSource, /useAppNavigationController/);
assert.match(controllerSource, /useState<ContextualNavigationState>/);
assert.equal((controllerSource.match(/\bsetState\(/g) ?? []).length, 1, "un único writer interno");
assert.match(controllerSource, /resolveContextualNavigation/);
assert.match(controllerSource, /resolveContextualBackNavigation/);
assert.match(controllerSource, /resolveActiveFlowRestoration/);
assert.match(controllerSource, /loadActiveFlow/);
assert.match(controllerSource, /saveActiveFlow/);
assert.doesNotMatch(controllerSource, /active-workout|routine-builder|NotificationPanel|components\//);

assert.match(controllerModelSource, /historyPolicy === "reset"/);
assert.match(controllerModelSource, /return \{ screen: transition\.screen, history: \[\] \}/);
assert.match(controllerModelSource, /history: \[\.\.\.current\.history\]/);
assert.match(transitionSource, /historyPolicy: "reset"/);
assert.match(transitionSource, /historyPolicy: "preserve"/);

const finishSource = sourceSection(
  appSource,
  "  function finishCompletedWorkout",
  "  async function buildCompletedTrainingSummarySnapshot",
);
assert.doesNotMatch(finishSource, /navigation\.(?:transition|reset|navigate)|setScreen/);
for (const marker of [
  "clearWorkoutDraft",
  "activeWorkoutBoundary.replaceRuntimeSnapshot",
  "activeWorkoutActions.finishWorkout()",
]) assert.ok(finishSource.includes(marker), `falta limpieza ${marker}`);
assert.equal(
  (appSource.match(/finishCompletedWorkout\(\);\s*\n\s*navigation\.transition\(resolveWorkoutCompletionTransition\(/g) ?? []).length,
  3,
  "los tres cierres navegan sólo después de persistir y limpiar",
);

assert.match(appSource, /navigation\.reset\("login"\)/);
assert.match(controllerSource, /resetToWorkout: \(\) => reset\("entrenamiento"\)/);
assert.match(controllerSource, /if \(reenterActiveWorkout\(ports\)\) return decision/);
assert.match(appSource, /function openRoutineDay[\s\S]*navigation\.reenterActiveWorkout\(\{/);
const notificationSource = sourceSection(
  appSource,
  "  function handleNotificationOpenIntent",
  "  function scrollToNotificationSection",
);
assert.match(notificationSource, /navigateTo\(intent\.target\)/);
assert.doesNotMatch(notificationSource, /navigation\.transition|setScreen/);
const notificationCommandSource = sourceSection(
  notificationsControllerSource,
  "        open(notification, publishIntent) {",
  "      };",
);
const notificationCommandMarkers = [
  "const intent = resolveNotificationOpenIntent(notification);",
  "const replayGuard = acquireOpenReplayGuard(owner, intent);",
  "if (!markSeen([notification.id])) {",
  "publishIntent(intent);",
];
let previousNotificationCommandIndex = -1;
for (const marker of notificationCommandMarkers) {
  const currentIndex = notificationCommandSource.indexOf(marker);
  assert.ok(currentIndex >= 0, `falta paso de navegación Notifications: ${marker}`);
  assert.ok(currentIndex > previousNotificationCommandIndex, `paso fuera de orden: ${marker}`);
  previousNotificationCommandIndex = currentIndex;
}
assert.match(appSource, /screen === "training-summary" && !trainingCompletionSummary[\s\S]{0,200}?navigation\.transition\(createFlowScreenTransition\("dashboard", "summary-state-sanitized"\)\)/);

console.log("app-navigation-controller contract tests passed");
