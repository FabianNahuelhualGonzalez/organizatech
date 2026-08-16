import styles from "@/ui/navigation/app-back-button.module.css";

export interface AppBackButtonProps {
  onBack: () => void;
}

export function AppBackButton({ onBack }: AppBackButtonProps) {
  return (
    <button
      className={styles.button}
      type="button"
      aria-label="Volver"
      onClick={onBack}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M5 12h6m3 0h1.5m3 0h.5" />
        <path d="M5 12l4 4" />
        <path d="M5 12l4 -4" />
      </svg>
    </button>
  );
}
