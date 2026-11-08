import { WeeklySeriesColumn } from "@/features/progress/components/weekly-series-column";
import type { WeeklyExerciseComparisonModel } from "@/lib/progress/weekly-exercise-comparison";
import { formatKg } from "@/lib/progress/weight-format";

export interface WeeklyResultsPanelProps {
  model: WeeklyExerciseComparisonModel;
}

export function WeeklyResultsPanel({ model }: WeeklyResultsPanelProps) {
  const baseline = model.resultComparison.baseline;
  const effective = model.resultComparison.effective;
  const firstWeekPlan = model.firstWeekPlanComparison;

  if (!model.selectedExercise) {
    return <div className="weekly-comparison-empty">Selecciona un día con ejercicios para revisar resultados.</div>;
  }

  if (!baseline) {
    return (
      <div className="weekly-results-card">
        <p className="weekly-results-kicker">Este es tu ejercicio registrado</p>
        <strong>{model.selectedExercise.name} <span>{model.selectedExercise.targetSets} x {model.selectedExercise.targetReps} · {formatKg(model.selectedExercise.baseWeight)}</span></strong>
        <div className="weekly-comparison-empty">Aún no hay registros reales para este ejercicio. Cuando completes una semana, podremos mostrar tu evolución.</div>
      </div>
    );
  }

  const isFirstReferenceOnly = model.emptyState === "insufficient_chart_data";
  const firstReferenceCopy = model.availableWeeks.length <= 1
    ? "Esta es tu primera referencia registrada. Cuando completes otra semana, podremos comparar tu evolución."
    : "Esta es tu primera semana registrada para este ejercicio. Selecciona una semana posterior para comparar tu evolución.";

  return (
    <div className="weekly-results-card">
      <p className="weekly-results-kicker">Este es tu ejercicio registrado</p>
      <strong>{model.selectedExercise.name} <span>{model.selectedExercise.targetSets} x {model.selectedExercise.targetReps} · {formatKg(model.selectedExercise.baseWeight)}</span></strong>
      {model.isUsingFallbackBaseline ? (
        <p className="weekly-results-note">Usaremos tu primera semana registrada como punto de partida.</p>
      ) : null}
      {firstWeekPlan ? (
        <>
          <div className="weekly-results-grid">
            <div className="weekly-series-column">
              <span>Rutina planificada</span>
              <small>{firstWeekPlan.targetSets} series de {firstWeekPlan.targetReps} reps</small>
              {Array.from({ length: firstWeekPlan.targetSets }, (_, index) => (
                <div className="weekly-series-pill" key={`planned-${index}`}>
                  <span>S{index + 1}:</span>
                  <strong>{formatKg(firstWeekPlan.targetWeight)} · {firstWeekPlan.targetReps} reps</strong>
                </div>
              ))}
            </div>
            <WeeklySeriesColumn title="Semana 1" record={firstWeekPlan.actual} />
          </div>
          <p className="weekly-results-note">
            Realizaste {firstWeekPlan.completedSets} de {firstWeekPlan.targetSets} series y {firstWeekPlan.actual.totalReps} de {firstWeekPlan.targetTotalReps} repeticiones planificadas.
          </p>
        </>
      ) : isFirstReferenceOnly ? (
        <div className="weekly-comparison-empty">{firstReferenceCopy}</div>
      ) : (
        <div className="weekly-results-grid">
          <WeeklySeriesColumn title={`Semana ${baseline.week}`} record={baseline} />
          <WeeklySeriesColumn title={`Semana ${effective?.week ?? "—"}`} record={effective} />
        </div>
      )}
      <p className="weekly-results-note">{firstWeekPlan ? "Rutina planificada vs semana 1" : "Primer registro vs semana elegida"}</p>
    </div>
  );
}
