import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolvePersistedActiveFlow } from "@/features/app-shell/hooks/useAppNavigationController";
import { resolveNavigationTransition } from "@/features/app-shell/model/app-navigation-controller-state";
import {
  appShellControllerReducer,
  INITIAL_APP_SHELL_STATE,
  resolveTopbarHidden,
} from "@/features/app-shell/model/app-shell-controller-state";
import { createAuthNavigationReset, createFlowScreenTransition } from "@/lib/navigation/app-navigation-transition";

let shell = INITIAL_APP_SHELL_STATE;
shell = appShellControllerReducer(shell, { type: "menu_toggled" });
assert.deepEqual(shell, {
  isMenuOpen: true,
  isNotificationPanelOpen: false,
  isTopbarHidden: false,
});
shell = appShellControllerReducer(shell, { type: "notifications_toggled" });
assert.equal(shell.isMenuOpen, false, "NotificationPanel cierra Drawer");
assert.equal(shell.isNotificationPanelOpen, true);
shell = appShellControllerReducer(shell, { type: "menu_toggled" });
assert.equal(shell.isMenuOpen, true);
assert.equal(shell.isNotificationPanelOpen, false, "Drawer cierra NotificationPanel");
shell = appShellControllerReducer(shell, { type: "topbar_visibility_changed", hidden: true });
assert.deepEqual(
  appShellControllerReducer(shell, { type: "identity_reset" }),
  INITIAL_APP_SHELL_STATE,
  "identity/SIGNED_OUT cierra overlays y restaura topbar",
);

assert.equal(resolveTopbarHidden(70, 81), true);
assert.equal(resolveTopbarHidden(100, 90), false);
assert.equal(resolveTopbarHidden(20, 70), false);

const current = { screen: "perfil" as const, history: ["dashboard" as const, "comparacion" as const] };
assert.deepEqual(
  resolveNavigationTransition(current, createFlowScreenTransition("entrenamiento", "routine-day-opened")),
  { screen: "entrenamiento", history: current.history },
  "preserve conserva historial",
);
assert.deepEqual(
  resolveNavigationTransition(current, createAuthNavigationReset("login", "auth-screen-switch")),
  { screen: "login", history: [] },
  "auth reset limpia historial",
);

assert.equal(resolvePersistedActiveFlow({
  screen: "login",
  hasRoutinePlan: true,
  isEditingRoutinePlan: false,
  hasStartedTraining: false,
  readiness: null,
}), null);
assert.equal(resolvePersistedActiveFlow({
  screen: "entrenamiento",
  hasRoutinePlan: true,
  isEditingRoutinePlan: false,
  hasStartedTraining: true,
  readiness: { skipped: true },
}), "active_workout");

const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
const navigationHook = readFileSync("src/features/app-shell/hooks/useAppNavigationController.ts", "utf8");
const overlayEngine = readFileSync("src/ui/overlays/use-overlay-focus-management.ts", "utf8");
assert.doesNotMatch(root, /\bsetScreen(?:History)?\b/, "el root no conserva writers de navegación");
assert.match(root, /useAppNavigationController/);
assert.doesNotMatch(navigationHook, /active-workout|routine-builder|NotificationPanel|components\//);
assert.equal((overlayEngine.match(/activeOverlayOwners/g) ?? []).length > 0, true);
const controllerSources = [root, navigationHook, readFileSync("src/features/app-shell/hooks/useAppShellController.ts", "utf8")].join("\n");
assert.equal((controllerSources.match(/activeOverlayOwners/g) ?? []).length, 0, "P3-43 no duplica el stack de overlays");
