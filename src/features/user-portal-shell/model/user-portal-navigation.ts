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

export interface UserPortalNavigationModel {
  readonly activeItemId: UserPortalDestinationId;
  readonly items: typeof USER_PORTAL_NAVIGATION_ITEMS;
}

export type UserPortalNavigateHandler = (destinationId: UserPortalDestinationId) => void;
export type UserPortalLogoutHandler = () => void | Promise<void>;

export function createUserPortalNavigationModel(
  activeItemId: UserPortalDestinationId,
): UserPortalNavigationModel {
  return {
    activeItemId,
    items: USER_PORTAL_NAVIGATION_ITEMS,
  };
}

export function isUserPortalDestination(
  item: UserPortalNavigationItem,
): item is UserPortalDestination {
  return item.kind === "destination";
}
