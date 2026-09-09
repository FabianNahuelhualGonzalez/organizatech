import type { ReactNode } from "react";
import type { TrainingCompletionSummary } from "@/lib/training/training-completion-summary";

export interface TrainingCompletionSummaryScreenProps {
  summary: TrainingCompletionSummary;
  onDashboard: () => void;
  advancedExecutionSync?: ReactNode;
}

export function TrainingCompletionSummaryScreen({
  summary,
  onDashboard,
  advancedExecutionSync,
}: TrainingCompletionSummaryScreenProps) {
  const previousDateLabel = summary.exercises.find((exercise) => exercise.comparisonStatus === "ready" && exercise.previousDateLabel)?.previousDateLabel ?? "";
  const currentDateLabel = summary.exercises[0]?.currentDateLabel ?? "";

  return (
    <section className="training-completion-screen">
      <div className="training-completion-title">
        <h2>Resumen de tu entrenamiento</h2>
        <p>Estos fueron tus resultados</p>
      </div>

      <article className="training-completion-card">
        <header className="training-completion-card-header">
          <span className="training-completion-day">{summary.dayLabel}</span>
          <span className="training-completion-status">{summary.statusLabel}</span>
        </header>

        <div className="training-completion-meta">
          <h3><span>Entrenamiento:</span> {summary.workoutName}</h3>
          <p><strong>Fase:</strong> {summary.cycleLabel} | {summary.weekLabel} | {summary.progressLabel}</p>
          <p><strong>Duración:</strong> {summary.durationLabel}</p>
        </div>

        <div className="training-completion-table" role="table" aria-label="Comparación de ejercicios del entrenamiento completado">
          <div role="rowgroup">
            <div className="training-completion-row heading" role="row">
              <span role="columnheader">Ejercicio y Series</span>
              <span role="columnheader">Anterior{previousDateLabel && <small>{previousDateLabel}</small>}</span>
              <span role="columnheader">Actual{currentDateLabel && <small>{currentDateLabel}</small>}</span>
              <span role="columnheader">Resultado</span>
            </div>
          </div>
          <div role="rowgroup">
            {summary.exercises.map((exercise) => (
              <div className="training-completion-row" role="row" key={exercise.exerciseId}>
                <div role="cell" className="exercise-cell">
                  <strong>{exercise.exerciseName}</strong>
                  <span>{exercise.currentSeriesCount} {exercise.currentSeriesCount === 1 ? "serie" : "series"}</span>
                </div>
                <div role="cell">
                  {exercise.comparisonStatus === "ready" ? (
                    <>
                      <span>{exercise.previousTotalReps ?? "—"} reps</span>
                      <span>{exercise.previousWeightLabel}</span>
                    </>
                  ) : (
                    <span className="muted-result">{exercise.comparisonStatus === "first_reference" ? "—" : "No disponible"}</span>
                  )}
                </div>
                <div role="cell">
                  <span>{exercise.currentTotalReps} reps</span>
                  <span>{exercise.currentWeightLabel}</span>
                </div>
                <div role="cell" className="result-cell">
                  {exercise.resultLines.map((line, index) => (
                    <span className={line.tone} key={`${exercise.exerciseId}-${line.label}-${index}`}>{line.label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {advancedExecutionSync ?? null}

        <button className="button training-completion-button" type="button" onClick={onDashboard}>
          Ir al panel principal
        </button>
      </article>
    </section>
  );
}
