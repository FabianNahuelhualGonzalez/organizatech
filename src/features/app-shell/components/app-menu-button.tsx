import { IconButton } from "@/ui/buttons/icon-button";
import { APP_NAVIGATION_DRAWER_ID } from "./app-navigation-drawer";

export interface AppMenuButtonProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function AppMenuButton({ isOpen, onToggle }: AppMenuButtonProps) {
  return (
    <IconButton
      className={`menu-trigger ${isOpen ? "active" : ""}`}
      aria-label="Abrir menú"
      aria-expanded={isOpen}
      aria-controls={APP_NAVIGATION_DRAWER_ID}
      onClick={onToggle}
    >
      <span className="hamburger-line" />
      <span className="hamburger-line" />
      <span className="hamburger-line" />
    </IconButton>
  );
}
