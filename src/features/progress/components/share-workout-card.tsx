import { Button } from "@/ui/buttons/button";
import { StatusMessage, type StatusMessageTone } from "@/ui/feedback/status-message";

import styles from "./share-workout-card.module.css";

/**
 * P3-38: preparación visual aislada. Modelo deliberadamente allowlisted — solo texto ya formateado
 * para mostrar. No acepta ExerciseEntry, métricas completas ni identificadores internos (UUID,
 * entryId, cycleId, lineage, userId, email, timestamps). La resolución de qué mostrar y la
 * construcción del payload compartible quedan fuera de esta tarea (P3-39).
 */
export interface ShareWorkoutCardDetailLine {
  readonly label: string;
  readonly value: string;
}

export interface ShareWorkoutCardModel {
  readonly title: string;
  readonly periodLabel: string;
  readonly detailLines: readonly ShareWorkoutCardDetailLine[];
  readonly footer?: string;
}

export interface ShareWorkoutCardProps {
  model: ShareWorkoutCardModel;
  onShare: () => void;
  isSharing?: boolean;
  statusMessage?: string | null;
  statusTone?: StatusMessageTone;
}

/**
 * Componente puramente presentacional: sin estado propio, sin acceso al navegador ni a
 * almacenamiento. `onShare` es el único control interactivo; la tarjeta en sí no lleva `onClick`.
 */
export function ShareWorkoutCard({
  model,
  onShare,
  isSharing = false,
  statusMessage = null,
  statusTone = "polite",
}: ShareWorkoutCardProps) {
  return (
    <section className={styles.shareCard}>
      <header className={styles.header}>
        <h3 className={styles.title}>{model.title}</h3>
        <p className={styles.period}>{model.periodLabel}</p>
      </header>

      <dl className={styles.detailList}>
        {model.detailLines.map((line, index) => (
          <div className={styles.detailRow} key={`${index}-${line.label}`}>
            <dt className={styles.detailLabel}>{line.label}</dt>
            <dd className={styles.detailValue}>{line.value}</dd>
          </div>
        ))}
      </dl>

      {model.footer ? <p className={styles.footer}>{model.footer}</p> : null}

      <Button className={styles.shareButton} type="button" onClick={onShare} disabled={isSharing}>
        {isSharing ? "Compartiendo..." : "Compartir"}
      </Button>

      {statusMessage ? (
        <StatusMessage className={styles.status} tone={statusTone}>
          {statusMessage}
        </StatusMessage>
      ) : null}
    </section>
  );
}
