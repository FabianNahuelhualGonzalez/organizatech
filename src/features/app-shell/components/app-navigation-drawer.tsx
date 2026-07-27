import type { ReactNode } from "react";
import { LogOut } from "lucide-react";

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
  if (!isOpen) return null;

  return (
    <>
      <button className="menu-backdrop" aria-label="Cerrar menú" onClick={onClose} />
      <div className="menu-drawer-shell" role="dialog" aria-label="Menú de navegación">
        <div className="menu-drawer-top">
          <button className="drawer-close" aria-label="Cerrar menú" onClick={onClose}>
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
                  role="menuitem"
                  onClick={() => onNavigate(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="menu-account">
              <button className="logout-button" role="menuitem" onClick={onLogout} disabled={isLogoutDisabled}>
                <LogOut size={17} />
                Cerrar sesión
              </button>
            </div>
          </div>
          <button className="drawer-empty" aria-label="Cerrar menú" onClick={onClose} />
        </div>
      </div>
    </>
  );
}
