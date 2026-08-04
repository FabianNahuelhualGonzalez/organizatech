"use client";

import { useCallback, useEffect, useReducer } from "react";

import {
  appShellControllerReducer,
  INITIAL_APP_SHELL_STATE,
  resolveTopbarHidden,
} from "@/features/app-shell/model/app-shell-controller-state";

export interface AppShellController {
  isMenuOpen: boolean;
  isNotificationPanelOpen: boolean;
  isTopbarHidden: boolean;
  closeMenu(): void;
  closeNotifications(): void;
  closeAll(): void;
  toggleMenu(onOpened?: () => void): void;
  toggleNotifications(): void;
}

export function useAppShellController(): AppShellController {
  const [state, dispatch] = useReducer(appShellControllerReducer, INITIAL_APP_SHELL_STATE);

  const closeMenu = useCallback(() => dispatch({ type: "menu_closed" }), []);
  const closeNotifications = useCallback(() => dispatch({ type: "notifications_closed" }), []);
  const closeAll = useCallback(() => dispatch({ type: "identity_reset" }), []);
  const toggleMenu = useCallback((onOpened?: () => void) => {
    if (!state.isMenuOpen) onOpened?.();
    dispatch({ type: "menu_toggled" });
  }, [state.isMenuOpen]);
  const toggleNotifications = useCallback(
    () => dispatch({ type: "notifications_toggled" }),
    [],
  );

  useEffect(() => {
    let lastY = window.scrollY;
    function handleScroll() {
      const currentY = window.scrollY;
      dispatch({
        type: "topbar_visibility_changed",
        hidden: resolveTopbarHidden(lastY, currentY),
      });
      lastY = currentY;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return {
    isMenuOpen: state.isMenuOpen,
    isNotificationPanelOpen: state.isNotificationPanelOpen,
    isTopbarHidden: state.isTopbarHidden,
    closeMenu,
    closeNotifications,
    closeAll,
    toggleMenu,
    toggleNotifications,
  };
}
