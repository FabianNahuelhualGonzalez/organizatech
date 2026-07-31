import { IconButton } from "@/ui/buttons/icon-button";

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
      onClick={onToggle}
    >
      <span className="hamburger-line" />
      <span className="hamburger-line" />
      <span className="hamburger-line" />
    </IconButton>
  );
}
