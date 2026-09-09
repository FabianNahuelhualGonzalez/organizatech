import styles from "@/features/training-cycle-builder/active-workout/components/training-cycle-execution.module.css";

export type TrainingCycleExecutionSyncPresentation =
  | { readonly status: "syncing" }
  | { readonly status: "synced" }
  | { readonly status: "error"; readonly retry: () => void };

export function TrainingCycleExecutionSyncStatus({
  presentation,
}: {
  readonly presentation: TrainingCycleExecutionSyncPresentation;
}) {
  return (
    <div
      className={styles.syncStatus}
      data-status={presentation.status}
      role={presentation.status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {presentation.status === "syncing" ? "Sincronizando ejecución del ciclo…" : null}
      {presentation.status === "synced" ? "Ejecución del ciclo sincronizada." : null}
      {presentation.status === "error" ? (
        <>
          <span>No se pudo sincronizar la ejecución del ciclo.</span>
          <button className={styles.syncRetry} type="button" onClick={presentation.retry}>
            Reintentar sincronización
          </button>
        </>
      ) : null}
    </div>
  );
}
