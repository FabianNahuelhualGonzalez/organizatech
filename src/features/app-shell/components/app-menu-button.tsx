export interface AppMenuButtonProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function AppMenuButton({ isOpen, onToggle }: AppMenuButtonProps) {
  return (
    <button
      className={`icon-button menu-trigger ${isOpen ? "active" : ""}`}
      aria-label="Abrir menú"
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <span className="hamburger-line" />
      <span className="hamburger-line" />
      <span className="hamburger-line" />
    </button>
  );
}
