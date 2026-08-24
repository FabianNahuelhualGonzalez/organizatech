import type { Screen } from "@/lib/navigation/app-navigation";

export const USER_PORTAL_DRAWER_ID = "user-portal-navigation-drawer";

export const USER_PORTAL_NAVIGATION_ITEMS = [
  { id: "profile", label: "Mi perfil", kind: "destination", availability: "enabled" },
  { id: "dashboard", label: "Panel principal", kind: "destination", availability: "enabled" },
  { id: "training", label: "Entrenemos", kind: "destination", availability: "enabled" },
  {
    id: "comparison",
    label: "Comparación semanal",
    kind: "destination",
    availability: "enabled",
  },
  {
    id: "edit-cycle",
    label: "Modificar ciclo de entrenamiento",
    kind: "destination",
    availability: "enabled",
  },
  {
    id: "cycle-history",
    label: "Historial ciclo de entrenamiento",
    kind: "destination",
    availability: "enabled",
  },
  { id: "logout", label: "Cerrar sesión", kind: "logout", availability: "action" },
] as const;

export type UserPortalNavigationItem = (typeof USER_PORTAL_NAVIGATION_ITEMS)[number];
export type UserPortalDestination = Extract<UserPortalNavigationItem, { kind: "destination" }>;
export type UserPortalDestinationId = UserPortalDestination["id"];
export type UserPortalLogoutItem = Extract<UserPortalNavigationItem, { kind: "logout" }>;

export type UserPortalScreen = Extract<
  Screen,
  | "perfil"
  | "dashboard"
  | "entrenamiento"
  | "comparacion"
  | "registro-entrenamiento"
  | "historial-ciclos"
>;

export const USER_PORTAL_DESTINATION_SCREENS = {
  profile: "perfil",
  dashboard: "dashboard",
  training: "entrenamiento",
  comparison: "comparacion",
  "edit-cycle": "registro-entrenamiento",
  "cycle-history": "historial-ciclos",
} as const satisfies Record<UserPortalDestinationId, UserPortalScreen>;

const USER_PORTAL_ACTIVE_DESTINATIONS = {
  perfil: "profile",
  dashboard: "dashboard",
  entrenamiento: "training",
  "training-summary": "training",
  comparacion: "comparison",
  "registro-entrenamiento": "edit-cycle",
  "historial-ciclos": "cycle-history",
} as const satisfies Partial<Record<Screen, UserPortalDestinationId>>;

const USER_PORTAL_RENDERABLE_SCREENS: readonly Screen[] = [
  "perfil",
  "dashboard",
  "entrenamiento",
  "training-summary",
  "comparacion",
  "registro-entrenamiento",
  "historial-ciclos",
];

export interface UserPortalNavigationModel {
  readonly activeItemId: UserPortalDestinationId | null;
  readonly items: readonly UserPortalNavigationItem[];
}

export type UserPortalNavigateHandler = (destinationId: UserPortalDestinationId) => void;
export type UserPortalScreenNavigateHandler = (screen: UserPortalScreen) => void;
export type UserPortalLogoutHandler = () => void | Promise<void>;

export function createUserPortalNavigationModel(
  input: {
    readonly currentScreen: Screen;
    readonly visibleScreens: readonly Screen[];
  },
): UserPortalNavigationModel {
  const visibleDestinationIds = new Set(
    input.visibleScreens
      .map(resolveUserPortalScreenDestination)
      .filter((destinationId): destinationId is UserPortalDestinationId => destinationId !== null),
  );
  const activeItemId = resolveUserPortalScreenDestination(input.currentScreen);

  return {
    activeItemId: activeItemId && visibleDestinationIds.has(activeItemId)
      ? activeItemId
      : null,
    items: USER_PORTAL_NAVIGATION_ITEMS.filter((item) => (
      item.kind === "logout" || visibleDestinationIds.has(item.id)
    )),
  };
}

export function resolveUserPortalDestinationScreen(
  destinationId: UserPortalDestinationId,
): UserPortalScreen {
  return USER_PORTAL_DESTINATION_SCREENS[destinationId];
}

export function resolveUserPortalScreenDestination(
  screen: Screen,
): UserPortalDestinationId | null {
  return USER_PORTAL_ACTIVE_DESTINATIONS[
    screen as keyof typeof USER_PORTAL_ACTIVE_DESTINATIONS
  ] ?? null;
}

export function isUserPortalRenderableScreen(screen: Screen): boolean {
  return USER_PORTAL_RENDERABLE_SCREENS.includes(screen);
}

export function isUserPortalDestination(
  item: UserPortalNavigationItem,
): item is UserPortalDestination {
  return item.kind === "destination";
}
