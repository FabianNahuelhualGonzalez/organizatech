"use client";

import { WeeklyMetricProgressCard } from "@/features/progress/components/weekly-metric-progress-card";
import { WeeklyResultsPanel } from "@/features/progress/components/weekly-results-panel";
import { formatDecimalEs } from "@/lib/progress/weight-format";
import type { WeeklyExerciseComparisonModel } from "@/lib/progress/weekly-exercise-comparison";

export interface ComparisonScreenV2Props {
  model: WeeklyExerciseComparisonModel;
  routineDays: readonly string[];
  onDaySelect: (day: string) => void;
  onExerciseSelect: (exerciseId: string) => void;
  onWeekSelect: (week: number) => void;
}

export function ComparisonScreenV2({
  model,
  routineDays,
  onDaySelect,
  onExerciseSelect,
  onWeekSelect,
}: ComparisonScreenV2Props) {
  return (
    <section className="screen weekly-comparison-screen" data-section="weekly-comparison">
      <div className="weekly-comparison-shell">
        <div className="weekly-comparison-section select-day-section">
          <div>
            <h3>Selecciona el día</h3>
            <p>Cambia entre tus días registrados para revisar tu progreso.</p>
          </div>
          <label className="weekly-comparison-select" aria-label="Seleccionar día de entrenamiento">
            <select
              value={model.selectedDay}
              onChange={(event) => onDaySelect(event.target.value)}
            >
              {routineDays.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </label>
        </div>

        <section className="weekly-comparison-section">
          <h3>Rutina registrada {model.selectedDay}</h3>
          <p className="weekly-routine-name">{model.plannedRoutine ?? "Sin rutina registrada"}</p>
        </section>

        <section className="weekly-comparison-section">
          <h3>Rutina de entrenamiento registrada</h3>
          <p>Selecciona dentro de la tabla el ejercicio para obtener más detalles.</p>
          <div className="weekly-plan-table" role="table" aria-label="Rutina planificada del día">
            <div role="rowgroup">
              <div className="weekly-plan-row heading" role="row">
                <span role="columnheader">Ejercicios</span>
                <span role="columnheader">Series</span>
                <span role="columnheader">Reps</span>
                <span role="columnheader">KG</span>
              </div>
            </div>
            <div role="rowgroup">
              {model.plannedExercises.length > 0 ? model.plannedExercises.map((exercise) => (
                <div
                  className={`weekly-plan-row ${exercise.isSelected ? "active" : ""}`}
                  role="row"
                  key={exercise.exerciseId}
                  onClick={() => onExerciseSelect(exercise.exerciseId)}
                >
                  <span role="cell">
                    <button
                      className="weekly-plan-row-button"
                      type="button"
                      aria-pressed={exercise.isSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                        onExerciseSelect(exercise.exerciseId);
                      }}
                    >
                      {exercise.name}
                    </button>
                  </span>
                  <span role="cell">{exercise.targetSets}</span>
                  <span role="cell">{exercise.targetReps}</span>
                  <span role="cell">{formatDecimalEs(exercise.baseWeight)}</span>
                </div>
              )) : (
                <div className="weekly-comparison-empty">No hay ejercicios configurados para este día.</div>
              )}
            </div>
          </div>
        </section>

        <section className="weekly-comparison-section">
          <div className="weekly-results-heading">
            <h3>Tus resultados</h3>
            {model.availableWeeks.length > 0 ? (
              <label className="weekly-comparison-select week-select" aria-label="Seleccionar semana para comparar">
                <select
                  value={model.selectedWeek ?? ""}
                  onChange={(event) => onWeekSelect(Number(event.target.value))}
                >
                  {model.availableWeeks.map((week) => (
                    <option key={week} value={week}>Semana {week}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <WeeklyResultsPanel model={model} />
        </section>

        <WeeklyMetricProgressCard
          title="Compara los KG de tus ejercicios"
          helper="Selecciona un ejercicio para saber cómo vas evolucionando semana a semana."
          model={model}
          metric="kg"
        />

        <WeeklyMetricProgressCard
          title="Compara las repeticiones de tus ejercicios"
          helper="Selecciona un ejercicio para saber cómo vas evolucionando semana a semana."
          model={model}
          metric="reps"
        />
      </div>
    </section>
  );
}
