"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

import styles from "./cycle-history.module.css";

export function CycleHistoryIdleState() {
  return <p className={styles.stateNeutral}>Selecciona un ciclo para comenzar.</p>;
}

export function CycleHistoryDisabledState() {
  return (
    <p className={styles.stateNeutral}>
      El historial de ciclos no está disponible en este contexto todavía.
    </p>
  );
}

export function CycleHistoryLoadingState({ label }: { label: string }) {
  return (
    <div className={styles.stateLoading} role="status" aria-live="polite">
      <span className={styles.skeletonLine} aria-hidden="true" />
      <span className={styles.skeletonLine} aria-hidden="true" />
      <span className={styles.stateLoadingLabel}>{label}</span>
    </div>
  );
}

export function CycleHistoryEmptyState({ message }: { message: string }) {
  return <p className={styles.stateNeutral}>{message}</p>;
}

export function CycleHistoryErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.stateError} role="alert">
      <p className={styles.stateErrorMessage}>
        <AlertTriangle size={16} aria-hidden="true" /> {message}
      </p>
      {onRetry ? (
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
