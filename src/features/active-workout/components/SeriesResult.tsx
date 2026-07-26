import { buildExerciseCurrentResultPresentation } from "@/lib/training/exercise-current-result-presentation";
import type { ExerciseMetrics } from "@/lib/progress/types";

export interface SeriesResultProps {
  entry: ExerciseMetrics;
}

export function SeriesResult({ entry }: SeriesResultProps) {
  const result = buildExerciseCurrentResultPresentation({
    totalReps: entry.totalReps,
    targetTotalReps: entry.targetTotalReps,
    completedSets: entry.completedSets,
    targetSets: entry.targetSets,
    actualWeight: entry.weight,
    targetWeight: entry.previousWeight,
  });

  return (
    <div className={`series-result session-summary ${result.tone}`}>
      <p className="series-result-label">Resumen de tu sesión</p>
      <div className="session-summary-hero">
        <strong>{result.headline}</strong>
        <span>{result.message}</span>
      </div>
      <div className="session-summary-grid">
        {result.items.map((item) => (
          <div className={`session-summary-item ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.detail}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
