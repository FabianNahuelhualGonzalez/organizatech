export interface AppShellControllerState {
  isMenuOpen: boolean;
  isNotificationPanelOpen: boolean;
  isTopbarHidden: boolean;
}

export type AppShellControllerAction =
  | { type: "menu_toggled" }
  | { type: "menu_closed" }
  | { type: "notifications_toggled" }
  | { type: "notifications_closed" }
  | { type: "topbar_visibility_changed"; hidden: boolean }
  | { type: "identity_reset" };

export const INITIAL_APP_SHELL_STATE: AppShellControllerState = {
  isMenuOpen: false,
  isNotificationPanelOpen: false,
  isTopbarHidden: false,
};

export function appShellControllerReducer(
  state: AppShellControllerState,
  action: AppShellControllerAction,
): AppShellControllerState {
  switch (action.type) {
    case "menu_toggled":
      return {
        ...state,
        isMenuOpen: !state.isMenuOpen,
        isNotificationPanelOpen: false,
      };
    case "menu_closed":
      return state.isMenuOpen ? { ...state, isMenuOpen: false } : state;
    case "notifications_toggled":
      return {
        ...state,
        isMenuOpen: false,
        isNotificationPanelOpen: !state.isNotificationPanelOpen,
      };
    case "notifications_closed":
      return state.isNotificationPanelOpen
        ? { ...state, isNotificationPanelOpen: false }
        : state;
    case "topbar_visibility_changed":
      return state.isTopbarHidden === action.hidden
        ? state
        : { ...state, isTopbarHidden: action.hidden };
    case "identity_reset":
      return INITIAL_APP_SHELL_STATE;
    default:
      return assertNever(action);
  }
}

export function resolveTopbarHidden(previousY: number, currentY: number) {
  return currentY > 80 && currentY > previousY;
}

function assertNever(value: never): never {
  throw new Error(`Acción App Shell no soportada: ${JSON.stringify(value)}`);
}
