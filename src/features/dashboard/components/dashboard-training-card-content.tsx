import {
  buildDashboardCarouselTableAriaLabel,
  buildDashboardOverflowLabel,
} from "@/lib/dashboard/dashboard-presentation";
import type { TrainingCarouselCardModel } from "@/lib/training/training-carousel-card-presentation";

export interface DashboardTrainingCardContentProps {
  model: TrainingCarouselCardModel;
}

export function DashboardTrainingCardContent({ model }: DashboardTrainingCardContentProps) {
  const overflowLabel = buildDashboardOverflowLabel(model.additionalExerciseCount);

  return (
    <div className="dashboard-training-card-content">
      <div className="dashboard-training-heading">
        <span className="dashboard-day-pill">{model.day}</span>
        <span className={`dashboard-status-badge ${model.status}`}>
          {model.statusLabel}
        </span>
      </div>
      <div className={`dashboard-routine-name ${model.status}`}>
        <span>Entrenamiento:</span>
        <strong>{model.routineName}</strong>
      </div>
      <div className="dashboard-exercise-table" role="table" aria-label={buildDashboardCarouselTableAriaLabel(model.day)}>
        <div className="dashboard-exercise-table-row heading" role="row">
          <span role="columnheader">Ejercicio</span>
          <span role="columnheader">Series</span>
          <span role="columnheader">Reps</span>
          <span role="columnheader">kg</span>
        </div>
        {model.rows.map((row) => (
          <div className="dashboard-exercise-table-row" role="row" key={`${row.source}-${row.id}`}>
            <strong role="cell" title={row.name}>{row.name}</strong>
            <span role="cell">{row.sets}</span>
            <span role="cell">{row.reps}</span>
            <span role="cell">{row.kg}</span>
          </div>
        ))}
      </div>
      {overflowLabel ? (
        <p className="dashboard-more-exercises">{overflowLabel}</p>
      ) : null}
    </div>
  );
}
