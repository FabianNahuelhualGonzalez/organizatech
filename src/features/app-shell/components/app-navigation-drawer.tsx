"use client";

import type { ReactNode } from "react";
import { LogOut } from "lucide-react";

import {
  OVERLAY_INITIAL_FOCUS_ATTRIBUTE,
  useOverlayFocusManagement,
} from "@/ui/overlays/use-overlay-focus-management";

/** Id estable del contenedor, referenciado por `aria-controls` desde el trigger del menú. */
export const APP_NAVIGATION_DRAWER_ID = "app-navigation-drawer";

export interface AppNavigationItem<ItemId extends string = string> {
  id: ItemId;
  label: string;
  isActive: boolean;
}

export interface AppNavigationDrawerProps<ItemId extends string = string> {
  isOpen: boolean;
  profileHeader: ReactNode;
  items: readonly AppNavigationItem<ItemId>[];
  isLogoutDisabled: boolean;
  onClose: () => void;
  onNavigate: (itemId: ItemId) => void;
  onLogout: () => void;
}

export function AppNavigationDrawer<ItemId extends string>({
  isOpen,
  profileHeader,
  items,
  isLogoutDisabled,
  onClose,
  onNavigate,
  onLogout,
}: AppNavigationDrawerProps<ItemId>) {
  // El hook se invoca ANTES del return condicional: las reglas de hooks exigen un orden estable
  // entre renders. Quien decide si el motor actúa es `isActive`, no el early return.
  const drawerRef = useOverlayFocusManagement<HTMLDivElement>({
    isActive: isOpen,
    onClose,
    canClose: true,
  });

  if (!isOpen) return null;

  return (
    <>
      <button className="menu-backdrop" type="button" aria-label="Cerrar menú" onClick={onClose} />
      <div
        ref={drawerRef}
        id={APP_NAVIGATION_DRAWER_ID}
        className="menu-drawer-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        tabIndex={-1}
      >
        <div className="menu-drawer-top">
          <button
            className="drawer-close"
            type="button"
            aria-label="Cerrar menú"
            onClick={onClose}
            {...{ [OVERLAY_INITIAL_FOCUS_ATTRIBUTE]: "" }}
          >
            <span className="drawer-x-line" />
            <span className="drawer-x-line" />
          </button>
        </div>
        <div className="menu-drawer-body">
          <div className="menu-panel" role="menu" aria-label="Menú principal">
            {profileHeader}
            <div className="menu-grid">
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`menu-link ${item.isActive ? "active" : ""}`}
                  type="button"
                  role="menuitem"
                  onClick={() => onNavigate(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="menu-account">
              <button className="logout-button" type="button" role="menuitem" onClick={onLogout} disabled={isLogoutDisabled}>
                <LogOut size={17} />
                Cerrar sesión
              </button>
            </div>
          </div>
          <button className="drawer-empty" type="button" aria-label="Cerrar menú" onClick={onClose} />
        </div>
      </div>
    </>
  );
}
