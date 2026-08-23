import assert from "node:assert/strict";
import test from "node:test";

import type { UserPortalShellCandidateProps } from "@/features/user-portal-shell/components/user-portal-shell-candidate";
import {
  USER_PORTAL_NAVIGATION_ITEMS,
  createUserPortalNavigationModel,
  isUserPortalDestination,
  type UserPortalDestinationId,
} from "@/features/user-portal-shell/model/user-portal-navigation";

const EXPECTED_IDS = [
  "profile",
  "dashboard",
  "training",
  "comparison",
  "edit-cycle",
  "cycle-history",
  "logout",
] as const;

const EXPECTED_LABELS = [
  "Mi perfil",
  "Panel principal",
  "Entrenemos",
  "Comparación semanal",
  "Modificar ciclo de entrenamiento",
  "Historial ciclo de entrenamiento",
  "Cerrar sesión",
] as const;

test("el contrato del menú Usuario conserva orden, IDs estables y sólo opciones actuales", () => {
  assert.deepEqual(USER_PORTAL_NAVIGATION_ITEMS.map(({ id }) => id), EXPECTED_IDS);
  assert.deepEqual(USER_PORTAL_NAVIGATION_ITEMS.map(({ label }) => label), EXPECTED_LABELS);
  const serializedLabels = USER_PORTAL_NAVIGATION_ITEMS.map(({ label }) => String(label));
  assert.equal(serializedLabels.includes("Calendario"), false);
  assert.equal(serializedLabels.includes("Mensajes"), false);
});

test("los seis destinos están habilitados y logout permanece como acción independiente", () => {
  const destinations = USER_PORTAL_NAVIGATION_ITEMS.filter(isUserPortalDestination);
  const logoutItems = USER_PORTAL_NAVIGATION_ITEMS.filter(({ kind }) => kind === "logout");

  assert.equal(destinations.length, 6);
  assert.equal(destinations.every(({ availability }) => availability === "enabled"), true);
  assert.deepEqual(logoutItems, [
    { id: "logout", label: "Cerrar sesión", kind: "logout", availability: "action" },
  ]);
});

test("cada modelo representa exactamente una opción activa y nunca activa logout", () => {
  const destinationIds = USER_PORTAL_NAVIGATION_ITEMS
    .filter(isUserPortalDestination)
    .map(({ id }) => id);

  for (const activeItemId of destinationIds) {
    const model = createUserPortalNavigationModel(activeItemId);
    const activeItems = model.items.filter(
      (item) => isUserPortalDestination(item) && item.id === model.activeItemId,
    );

    assert.equal(activeItems.length, 1, `${activeItemId}: una sola opción activa`);
    assert.equal(model.activeItemId, activeItemId);
    assert.equal(model.items, USER_PORTAL_NAVIGATION_ITEMS);
  }
});

test("los callbacks del candidato emiten destinos tipados y separan cierre, campana y logout", async () => {
  const events: string[] = [];
  const visited: UserPortalDestinationId[] = [];

  const callbacks = {
    onOpen: () => events.push("open"),
    onClose: () => events.push("close"),
    onNavigate: (destinationId) => visited.push(destinationId),
    onToggleNotifications: () => events.push("notifications"),
    onLogout: async () => {
      events.push("logout");
    },
  } satisfies Pick<
    UserPortalShellCandidateProps,
    "onOpen" | "onClose" | "onNavigate" | "onToggleNotifications" | "onLogout"
  >;

  callbacks.onOpen();
  callbacks.onNavigate("profile");
  callbacks.onNavigate("cycle-history");
  callbacks.onToggleNotifications();
  callbacks.onClose();
  await callbacks.onLogout();

  assert.deepEqual(visited, ["profile", "cycle-history"]);
  assert.deepEqual(events, ["open", "notifications", "close", "logout"]);
});
