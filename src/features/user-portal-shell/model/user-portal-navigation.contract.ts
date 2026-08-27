import assert from "node:assert/strict";
import test from "node:test";

import {
  USER_PORTAL_DESTINATION_SCREENS,
  USER_PORTAL_NAVIGATION_ITEMS,
  createUserPortalNavigationModel,
  isUserPortalDestination,
  isUserPortalRenderableScreen,
  resolveUserPortalDestinationScreen,
  resolveUserPortalScreenDestination,
  type UserPortalDestinationId,
  type UserPortalScreen,
} from "@/features/user-portal-shell/model/user-portal-navigation";
import type { Screen } from "@/lib/navigation/app-navigation";
import { resolveMenuScreens } from "@/lib/navigation/app-navigation-intent";

const PRIMARY_SCREENS: readonly Screen[] = [
  "perfil",
  "dashboard",
  "entrenamiento",
  "comparacion",
  "registro-entrenamiento",
  "historial-ciclos",
  "calendario",
];

const EXPECTED_IDS = [
  "profile",
  "dashboard",
  "training",
  "comparison",
  "edit-cycle",
  "cycle-history",
  "calendar",
  "logout",
] as const;

const EXPECTED_LABELS = [
  "Mi perfil",
  "Panel principal",
  "Entrenemos",
  "Comparación semanal",
  "Modificar ciclo de entrenamiento",
  "Historial ciclo de entrenamiento",
  "Calendario",
  "Cerrar sesión",
] as const;

test("el menú Usuario conserva orden, IDs, etiquetas y sólo opciones aprobadas", () => {
  assert.deepEqual(USER_PORTAL_NAVIGATION_ITEMS.map(({ id }) => id), EXPECTED_IDS);
  assert.deepEqual(USER_PORTAL_NAVIGATION_ITEMS.map(({ label }) => label), EXPECTED_LABELS);
  const labels = USER_PORTAL_NAVIGATION_ITEMS.map(({ label }) => String(label));
  assert.equal(labels.includes("Calendario"), true);
  assert.equal(labels.includes("Mensajes"), false);
  assert.equal(USER_PORTAL_NAVIGATION_ITEMS.filter(isUserPortalDestination).length, 7);
});

test("el mapeo visual a Screen es exacto, total y reversible", () => {
  assert.deepEqual(USER_PORTAL_DESTINATION_SCREENS, {
    profile: "perfil",
    dashboard: "dashboard",
    training: "entrenamiento",
    comparison: "comparacion",
    "edit-cycle": "registro-entrenamiento",
    "cycle-history": "historial-ciclos",
    calendar: "calendario",
  });

  for (const destinationId of Object.keys(
    USER_PORTAL_DESTINATION_SCREENS,
  ) as UserPortalDestinationId[]) {
    const screen = resolveUserPortalDestinationScreen(destinationId);
    assert.equal(resolveUserPortalScreenDestination(screen), destinationId);
  }
});

test("el modelo consume la visibilidad canónica y nunca deshabilita destinos ofrecidos", () => {
  const withoutEntries = resolveMenuScreens(PRIMARY_SCREENS, false, 0);
  const model = createUserPortalNavigationModel({
    currentScreen: "dashboard",
    visibleScreens: withoutEntries,
  });

  assert.deepEqual(
    model.items.map(({ id }) => id),
    ["profile", "dashboard", "training", "comparison", "edit-cycle", "calendar", "logout"],
  );
  assert.equal(model.items.every((item) => (
    item.kind === "logout" || item.availability === "enabled"
  )), true);

  const withHistory = createUserPortalNavigationModel({
    currentScreen: "historial-ciclos",
    visibleScreens: resolveMenuScreens(PRIMARY_SCREENS, false, 1),
  });
  assert.equal(withHistory.items.some(({ id }) => id === "cycle-history"), true);
  assert.equal(withHistory.activeItemId, "cycle-history");
});

test("la opción activa deriva de la pantalla real e incluye el resumen interno de entrenamiento", () => {
  const expected = new Map<Screen, UserPortalDestinationId>([
    ["perfil", "profile"],
    ["dashboard", "dashboard"],
    ["entrenamiento", "training"],
    ["training-summary", "training"],
    ["comparacion", "comparison"],
    ["registro-entrenamiento", "edit-cycle"],
    ["historial-ciclos", "cycle-history"],
    ["calendario", "calendar"],
  ]);

  for (const [screen, activeItemId] of expected) {
    const model = createUserPortalNavigationModel({
      currentScreen: screen,
      visibleScreens: PRIMARY_SCREENS,
    });
    assert.equal(model.activeItemId, activeItemId, screen);
  }

  const hiddenActive = createUserPortalNavigationModel({
    currentScreen: "historial-ciclos",
    visibleScreens: resolveMenuScreens(PRIMARY_SCREENS, false, 0),
  });
  assert.equal(hiddenActive.activeItemId, null, "no declara activa una opción ausente");
});

test("cada destino visual ejecuta una sola navegación tipada", () => {
  const calls: UserPortalScreen[] = [];
  const navigate = (screen: UserPortalScreen) => calls.push(screen);

  for (const item of USER_PORTAL_NAVIGATION_ITEMS) {
    if (!isUserPortalDestination(item)) continue;
    navigate(resolveUserPortalDestinationScreen(item.id));
  }

  assert.deepEqual(calls, PRIMARY_SCREENS);
  assert.equal(calls.length, 7);
});

test("el modelo visual identifica únicamente las pantallas productivas del portal Usuario", () => {
  assert.equal(isUserPortalRenderableScreen("dashboard"), true);
  for (const screen of [
    "login",
    "registro",
    "recuperar-password",
    "nueva-password",
    "recovery-expired",
  ] as const) {
    assert.equal(isUserPortalRenderableScreen(screen), false, screen);
  }
});
