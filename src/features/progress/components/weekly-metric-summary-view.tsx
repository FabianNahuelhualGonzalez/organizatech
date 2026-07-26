import { formatWeeklyComparisonDate } from "@/features/progress/weekly-comparison-date";
import { buildMetricInsight, formatMetricDifference } from "@/lib/progress/metric-insight";
import type {
  WeeklyExerciseComparisonModel,
  WeeklyExerciseMetricSummary,
} from "@/lib/progress/weekly-exercise-comparison";
import { formatKg } from "@/lib/progress/weight-format";

export interface WeeklyMetricSummaryViewProps {
  summary: WeeklyExerciseMetricSummary;
  model: WeeklyExerciseComparisonModel;
  metric: "kg" | "reps";
}

export function WeeklyMetricSummaryView({
  summary,
  model,
  metric,
}: WeeklyMetricSummaryViewProps) {
  const baseline = model.resultComparison.baseline;
  const effective = model.resultComparison.effective;
  const differenceLabel = formatMetricDifference(summary.difference, metric);
  const toneClass = summary.tone === "positive" ? "positive" : summary.tone === "negative" ? "danger" : "neutral";

  if (summary.status === "unavailable" || !baseline || !effective) {
    return <div className="weekly-comparison-empty">Sin historial suficiente para este ejercicio.</div>;
  }

  if (model.emptyState === "insufficient_chart_data") {
    return (
      <div className="weekly-comparison-empty">
        {model.availableWeeks.length <= 1
          ? "Esta es tu primera referencia registrada para este ejercicio. Cuando registres otra semana, podremos mostrar tu evolución."
          : "Esta es tu primera semana registrada para este ejercicio. Selecciona una semana posterior para ver la evolución."}
      </div>
    );
  }

  return (
    <div className={`weekly-metric-summary ${metric === "reps" ? "reps-summary" : "kg-summary"}`}>
      <div>
        <h4>Cómo iniciaste</h4>
        <strong>{metric === "kg" ? formatKg(baseline.weight) : baseline.repsLabel}</strong>
        <span>Fecha inicio</span>
        <small>{formatWeeklyComparisonDate(baseline.date)}</small>
      </div>
      <div className="weekly-metric-divider" aria-hidden="true" />
      <div>
        <h4>Actualmente</h4>
        <strong>{metric === "kg" ? formatKg(effective.weight) : effective.repsLabel}</strong>
        <span>Fecha actual</span>
        <small>{formatWeeklyComparisonDate(effective.date)}</small>
      </div>
      <p className={`weekly-metric-difference ${toneClass}`}>{differenceLabel}</p>
      {metric === "kg" && summary.difference === 0 ? (
        <p className="weekly-metric-insight">Aún no hay diferencias en peso. Apenas registres una variación, la mostraremos aquí.</p>
      ) : (
        <p className="weekly-metric-insight">{buildMetricInsight(summary.difference, metric)}</p>
      )}
    </div>
  );
}
