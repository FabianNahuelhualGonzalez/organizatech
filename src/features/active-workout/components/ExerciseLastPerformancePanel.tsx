import styles from "@/features/active-workout/active-workout.module.css";
import {
  invokeActiveWorkoutHistoryRetry,
  type ActiveWorkoutSheetPanel,
} from "@/features/active-workout/model/active-workout-sheet";
import type { ActiveWorkoutHistoryPublicationStatus } from "@/features/active-workout/model/active-workout-history-prefetch-controller";
import type { ExerciseLastObservationPresentation } from "@/lib/training/exercise-last-observation-presentation";
import type { ExerciseLastPerformancePresentation } from "@/lib/training/exercise-last-performance-presentation";

export interface ExerciseLastPerformancePanelProps {
  presentation: ExerciseLastPerformancePresentation;
  historyStatus: ActiveWorkoutHistoryPublicationStatus;
  exerciseId: string;
  targetSets: number;
  observationPresentation: ExerciseLastObservationPresentation;
  observationValue: string;
  onObservationChange: (value: string) => void;
  openPanel: ActiveWorkoutSheetPanel | null;
  onTogglePanel: (panel: ActiveWorkoutSheetPanel) => void;
  retryExerciseHistory: () => void;
}

/**
 * Presenta las dos referencias auxiliares de la hoja. El estado del acordeón pertenece a
 * active-workout y nunca se mezcla con el draft ni con el loader productivo. Sólo una sección
 * puede estar abierta a la vez.
 */
export function ExerciseLastPerformancePanel({
  presentation,
  historyStatus,
  exerciseId,
  targetSets,
  observationPresentation,
  observationValue,
  onObservationChange,
  openPanel,
  onTogglePanel,
  retryExerciseHistory,
}: ExerciseLastPerformancePanelProps) {
  const observationFieldId = `exercise-observation-${exerciseId}`;
  const observationHintId = `${observationFieldId}-hint`;
  const historyPanelId = `exercise-history-${exerciseId}`;
  const historyTriggerId = `${historyPanelId}-trigger`;
  const commentPanelId = `exercise-comment-${exerciseId}`;
  const hasCurrentObservation = observationValue.trim().length > 0;

  function retryHistory() {
    if (!invokeActiveWorkoutHistoryRetry(retryExerciseHistory)) return;
    window.requestAnimationFrame(() => {
      document.getElementById(historyTriggerId)?.focus({ preventScroll: true });
    });
  }

  return (
    <div className={styles.sheetReferencePanel} key={exerciseId}>
      <div className={styles.sheetReferencePills}>
        <button
          className={styles.sheetReferencePill}
          id={historyTriggerId}
          data-kind="history"
          type="button"
          aria-expanded={openPanel === "history"}
          aria-controls={historyPanelId}
          onClick={() => onTogglePanel("history")}
        >
          Registro de la semana pasada
        </button>
        <button
          className={styles.sheetReferencePill}
          data-kind="comment"
          type="button"
          aria-expanded={openPanel === "comment"}
          aria-controls={commentPanelId}
          onClick={() => onTogglePanel("comment")}
        >
          {hasCurrentObservation ? "Comentario en borrador" : "Comentario"}
        </button>
      </div>

      {openPanel === "history" ? (
        <section
          className={styles.sheetDrawer}
          id={historyPanelId}
          aria-label="Registro de la semana pasada"
          aria-live="polite"
        >
          {historyStatus === "idle" ? (
            <p className={styles.sheetHistoryEmpty}>
              Registro anterior no disponible todavía.
            </p>
          ) : historyStatus === "loading" ? (
            <>
              <p className={styles.sheetHistoryDate}>CARGANDO…</p>
              {Array.from({ length: Math.min(Math.max(1, targetSets), 5) }, (_, index) => (
                <div className={styles.sheetHistorySkeletonRow} aria-hidden="true" key={index}>
                  <span />
                  <span />
                </div>
              ))}
            </>
          ) : historyStatus === "ready" ? (
            <>
              <p className={styles.sheetHistoryDate}>{presentation.lastHeaderText}</p>
              <div className={styles.sheetHistoryRows}>
                {presentation.seriesRows.map((row) => (
                  <div className={styles.sheetHistoryRow} key={`${row.label}-${row.value}`}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : historyStatus === "empty" ? (
            <p className={styles.sheetHistoryEmpty}>
              Sin registro anterior de este ejercicio.
            </p>
          ) : (
            <div className={styles.sheetHistoryError} role="alert">
              <p>No se pudo cargar el registro anterior.</p>
              <button
                type="button"
                onClick={retryHistory}
              >
                Reintentar
              </button>
            </div>
          )}
        </section>
      ) : null}

      {openPanel === "comment" ? (
        <section
          className={styles.sheetDrawer}
          id={commentPanelId}
          aria-label="Comentario del ejercicio"
        >
            <div className={styles.sheetObservationHistory}>
              <p>{observationPresentation.historyLabel}</p>
              {observationPresentation.status === "loading" ? (
                <div className={styles.sheetObservationLoading} role="status" aria-live="polite">
                  <span>{observationPresentation.historyText}</span>
                  <span aria-hidden="true" />
                </div>
              ) : (
                <p
                  className={styles.sheetObservationText}
                  role={observationPresentation.status === "error" ? "alert" : "status"}
                >
                  {observationPresentation.historyText}
                </p>
              )}
            </div>

            <label className={styles.sheetObservationField} htmlFor={observationFieldId}>
              <span>Nueva observación</span>
              <textarea
                id={observationFieldId}
                rows={4}
                value={observationValue}
                aria-describedby={observationHintId}
                onChange={(event) => onObservationChange(event.target.value)}
              />
              <small id={observationHintId}>
                Registra sensaciones, técnica o algún detalle para tu próxima sesión.
              </small>
            </label>
        </section>
      ) : null}
    </div>
  );
}
