import { ChevronDown } from "lucide-react";

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
  const hasCurrentObservation = observationValue.trim().length > 0;
  return (
    <div className="exercise-reference-card" key={exerciseId}>
      <div className="exercise-reference-header">
        <span>Referencia de hoy</span>
      </div>

      <div className="exercise-reference-block objective">
        <p className="exercise-reference-label">Objetivo</p>
        <strong className="exercise-reference-value">{presentation.objectiveText}</strong>
      </div>

      <div className={`exercise-reference-block detail ${presentation.status}`}>
        {presentation.seriesRows.length > 0 ? (
          <details className="exercise-series-details" key={`series-${exerciseId}`}>
            <summary>
              <span>{presentation.seriesDetailTitle}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="exercise-series-detail-list">
              {presentation.seriesRows.map((row) => (
                <div className="exercise-series-detail-row" key={`${row.label}-${row.value}`}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </details>
        ) : (
          <>
            <p className="exercise-reference-label">{presentation.lastHeaderText}</p>
            {presentation.status === "loading" ? (
              <div className="exercise-performance-skeleton" aria-label="Cargando historial del ejercicio" />
            ) : (
              <strong className="exercise-reference-value muted">{presentation.lastSummaryText}</strong>
            )}
          </>
        )}
      </div>

      <div className="exercise-reference-block goal">
        <p className="exercise-reference-label">Meta de hoy</p>
        <strong className="exercise-reference-value">{presentation.todayGoalText}</strong>
      </div>

      <details className="exercise-reference-block observation" key={`observation-${exerciseId}`}>
        <summary>
          <span>{hasCurrentObservation ? "Observación registrada" : "Añadir nuevo comentario"}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="exercise-observation-content">
          <p className="exercise-reference-label">Observación del ejercicio</p>

          <div className="exercise-observation-history">
            <p className="exercise-observation-history-label">{observationPresentation.historyLabel}</p>
            {observationPresentation.status === "loading" ? (
              <div className="exercise-performance-skeleton" aria-label="Cargando observación anterior" />
            ) : (
              <p className="exercise-observation-history-text">{observationPresentation.historyText}</p>
            )}
          </div>

          <label className="exercise-observation-field" htmlFor={observationFieldId}>
            <span className="exercise-observation-field-label">Añadir nuevo comentario</span>
            <textarea
              id={observationFieldId}
              className="exercise-observation-textarea"
              rows={3}
              value={observationValue}
              onChange={(event) => onObservationChange(event.target.value)}
            />
            <span className="exercise-observation-hint">
              Registra sensaciones, técnica o algún detalle para tu próxima sesión.
            </span>
          </label>
        </div>
      </details>
    </div>
  );
}
