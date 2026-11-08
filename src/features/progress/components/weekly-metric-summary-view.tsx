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
  const firstWeekPlan = model.firstWeekPlanComparison;
  const differenceLabel = formatMetricDifference(summary.difference, metric);
  const toneClass = summary.tone === "positive" ? "positive" : summary.tone === "negative" ? "danger" : "neutral";

  if (summary.status === "unavailable" || !baseline || !effective) {
    return <div className="weekly-comparison-empty">Sin historial suficiente para este ejercicio.</div>;
  }

  if (firstWeekPlan) {
    const difference = summary.difference ?? 0;
    return (
      <div className={`weekly-metric-summary ${metric === "reps" ? "reps-summary" : "kg-summary"}`}>
        <div>
          <h4>Planificado</h4>
          <strong>{metric === "kg" ? formatKg(firstWeekPlan.targetWeight) : `${firstWeekPlan.targetTotalReps} repeticiones`}</strong>
          <span>Registro realizado</span>
          <small>{formatWeeklyComparisonDate(firstWeekPlan.actual.date)}</small>
        </div>
        <div className="weekly-metric-divider" aria-hidden="true" />
        <div>
          <h4>Semana 1</h4>
          <strong>{metric === "kg" ? formatKg(firstWeekPlan.actual.weight) : `${firstWeekPlan.actual.totalReps} repeticiones`}</strong>
          <span>Registro de entrenamiento</span>
          <small>{formatWeeklyComparisonDate(firstWeekPlan.actual.date)}</small>
        </div>
        <p className={`weekly-metric-difference ${toneClass}`}>
          {metric === "kg" ? differenceLabel : `${difference > 0 ? "+" : ""}${difference} repeticiones`}
        </p>
        <p className="weekly-metric-insight">{firstWeekPlanInsight(difference, metric)}</p>
      </div>
    );
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

function firstWeekPlanInsight(difference: number, metric: "kg" | "reps") {
  if (metric === "kg") {
    if (difference === 0) return "Usaste el peso que planificaste para este ejercicio.";
    return difference > 0
      ? `Usaste ${formatKg(difference)} más que lo planificado.`
      : `Usaste ${formatKg(Math.abs(difference))} menos que lo planificado.`;
  }
  if (difference === 0) return "Completaste las repeticiones planificadas.";
  const count = Math.abs(difference);
  const unit = count === 1 ? "repetición" : "repeticiones";
  return difference > 0
    ? `Superaste lo planificado por ${count} ${unit}.`
    : `Te ${count === 1 ? "faltó" : "faltaron"} ${count} ${unit} para cumplir lo planificado.`;
}
