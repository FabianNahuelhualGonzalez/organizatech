import { Activity, CalendarDays, Dumbbell } from "lucide-react";

import { calculateWeeklySummary } from "@/lib/progress/calculations";
import { formatKg } from "@/lib/progress/weight-format";
import { TrendValue } from "@/ui/data-display/trend-value";

export interface RoutineMetricGridProps {
  targetSummary: {
    totalWeight: number;
    volume: number;
    reps: number;
    exerciseCount: number;
  };
  weightLabel?: string;
  repsLabel?: string;
  exerciseLabel?: string;
}

export function RoutineMetricGrid({
  targetSummary,
  weightLabel = "KG totales de la rutina",
  repsLabel = "Total reps",
  exerciseLabel = "Ejercicios total",
}: RoutineMetricGridProps) {
  return (
    <div className="metric-grid wide dashboard-metric-grid routine-metric-grid">
      <div className="metric">
        <div className="metric-title-row">
          <span>{weightLabel}</span>
          <Dumbbell size={18} />
        </div>
        <strong>{formatKg(targetSummary.totalWeight)}</strong>
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>{repsLabel}</span>
          <Activity size={18} />
        </div>
        <strong>{targetSummary.reps}</strong>
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>{exerciseLabel}</span>
          <CalendarDays size={18} />
        </div>
        <strong>{targetSummary.exerciseCount}</strong>
      </div>
    </div>
  );
}

export interface MetricGridProps {
  summary: ReturnType<typeof calculateWeeklySummary>;
}

export function MetricGrid({ summary }: MetricGridProps) {
  return (
    <div className="metric-grid wide dashboard-metric-grid">
      <div className="metric">
        <div className="metric-title-row">
          <span>Volumen de trabajo</span>
          <Dumbbell size={18} />
        </div>
        <strong>{formatKg(summary.volumeTotal)}</strong>
        <TrendValue value={summary.volumePercentage} suffix="%" />
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>Total reps</span>
          <Activity size={18} />
        </div>
        <strong>{summary.totalReps}</strong>
        <TrendValue value={summary.repsDifference} />
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>Ejercicios</span>
          <CalendarDays size={18} />
        </div>
        <strong>{summary.exerciseCount}</strong>
        <TrendValue value={summary.exerciseDifference} />
      </div>
    </div>
  );
}
