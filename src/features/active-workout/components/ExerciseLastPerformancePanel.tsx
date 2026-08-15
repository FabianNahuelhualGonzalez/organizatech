import { ChevronDown } from "lucide-react";

import styles from "@/features/active-workout/active-workout.module.css";
import type { ExerciseLastObservationPresentation } from "@/lib/training/exercise-last-observation-presentation";
import type { ExerciseLastPerformancePresentation } from "@/lib/training/exercise-last-performance-presentation";

export interface ExerciseLastPerformancePanelProps {
  presentation: ExerciseLastPerformancePresentation;
  exerciseId: string;
  observationPresentation: ExerciseLastObservationPresentation;
  observationValue: string;
  onObservationChange: (value: string) => void;
}

export function ExerciseLastPerformancePanel({
  presentation,
  exerciseId,
  observationPresentation,
  observationValue,
  onObservationChange,
}: ExerciseLastPerformancePanelProps) {
  const observationFieldId = `exercise-observation-${exerciseId}`;
  const observationHintId = `${observationFieldId}-hint`;
  const hasCurrentObservation = observationValue.trim().length > 0;

  return (
    <div className={`exercise-reference-card ${styles.referencePanel}`} key={exerciseId}>
      <details
        className="exercise-series-details"
        data-disclosure
        key={`series-${exerciseId}`}
      >
        <summary>
          <span>
            {presentation.status === "found"
              ? presentation.seriesDetailTitle
              : presentation.lastSummaryText}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={styles.disclosureContent}>
          <p className={styles.historyTitle}>{presentation.lastHeaderText}</p>
          {presentation.seriesRows.length > 0 ? (
            <div className="exercise-series-detail-list">
              {presentation.seriesRows.map((row) => (
                <div className="exercise-series-detail-row" key={`${row.label}-${row.value}`}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          ) : presentation.status === "loading" ? (
            <div className={styles.loadingState} role="status" aria-live="polite">
              <span>{presentation.lastSummaryText}</span>
              <div className="exercise-performance-skeleton" aria-hidden="true" />
            </div>
          ) : (
            <p
              className={styles.historyStatus}
              role={presentation.status === "error" ? "alert" : "status"}
            >
              {presentation.lastSummaryText}
            </p>
          )}
          <p className={styles.historyComparison}>{presentation.comparisonText}</p>
          <p className={styles.todayGoal}>{presentation.todayGoalText}</p>
        </div>
      </details>

      <details className="exercise-reference-block observation" data-disclosure key={`observation-${exerciseId}`}>
        <summary>
          <span>{hasCurrentObservation ? "Comentario en borrador" : "Añadir nuevo comentario"}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className={`exercise-observation-content ${styles.disclosureContent}`}>
          <div className="exercise-observation-history">
            <p className="exercise-observation-history-label">{observationPresentation.historyLabel}</p>
            {observationPresentation.status === "loading" ? (
              <div className={styles.loadingState} role="status" aria-live="polite">
                <span>{observationPresentation.historyText}</span>
                <div className="exercise-performance-skeleton" aria-hidden="true" />
              </div>
            ) : (
              <p
                className="exercise-observation-history-text"
                role={observationPresentation.status === "error" ? "alert" : "status"}
              >
                {observationPresentation.historyText}
              </p>
            )}
          </div>

          <label className="exercise-observation-field" htmlFor={observationFieldId}>
            <span className="exercise-observation-field-label">Nueva observación</span>
            <textarea
              id={observationFieldId}
              className="exercise-observation-textarea"
              rows={4}
              value={observationValue}
              aria-describedby={observationHintId}
              onChange={(event) => onObservationChange(event.target.value)}
            />
            <span className="exercise-observation-hint" id={observationHintId}>
              Registra sensaciones, técnica o algún detalle para tu próxima sesión.
            </span>
          </label>
        </div>
      </details>
    </div>
  );
}
