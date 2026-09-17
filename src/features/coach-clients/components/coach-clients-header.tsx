import { Plus } from "lucide-react";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import styles from "./coach-clients-header.module.css";

export function CoachClientsHeader({ titleId, onBack, onLink }: {
  readonly titleId: string;
  readonly onBack?: () => void;
  readonly onLink?: () => void;
}) {
  return (
    <header className={styles.header}>
      {onBack ? <AppBackButton onBack={onBack} /> : null}
      <h2 className={styles.title} id={titleId}>Tus clientes</h2>
      <button className={styles.add} type="button" onClick={onLink} disabled={!onLink}>
        <span><Plus size={13} strokeWidth={2.6} aria-hidden="true" />Agregar</span>
      </button>
    </header>
  );
}
