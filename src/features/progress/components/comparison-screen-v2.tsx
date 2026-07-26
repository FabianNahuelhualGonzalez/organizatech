"use client";

import { useEffect, useMemo, useState } from "react";

import { WeeklyMetricProgressCard } from "@/features/progress/components/weekly-metric-progress-card";
import { WeeklyResultsPanel } from "@/features/progress/components/weekly-results-panel";
import { formatDecimalEs } from "@/lib/progress/weight-format";
import {
  buildWeeklyExerciseComparisonModel,
} from "@/lib/progress/weekly-exercise-comparison";
import type {
  ExerciseMetrics,
  ExerciseTemplate,
} from "@/lib/progress/types";

export interface ComparisonScreenV2Props {
  exercises: ExerciseTemplate[];
  metrics: ExerciseMetrics[];
  currentWeek: number;
  routineDays: string[];
  selectedDay: string;
  setSelectedDay: (day: string) => void;
}

export function ComparisonScreenV2({
  exercises,
  metrics,
  currentWeek,
  routineDays,
  selectedDay,
  setSelectedDay,
}: ComparisonScreenV2Props) {
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const activeDay = routineDays.includes(selectedDay) ? selectedDay : routineDays[0] ?? selectedDay;
  const comparisonModel = useMemo(() => buildWeeklyExerciseComparisonModel({
    plannedExercises: exercises,
    entries: metrics,
    selectedDay: activeDay,
    selectedExerciseId,
    selectedWeek,
    currentWeek,
  }), [activeDay, currentWeek, exercises, metrics, selectedExerciseId, selectedWeek]);

  useEffect(() => {
    if (comparisonModel.selectedExerciseId && comparisonModel.selectedExerciseId !== selectedExerciseId) {
      setSelectedExerciseId(comparisonModel.selectedExerciseId);
    }
  }, [comparisonModel.selectedExerciseId, selectedExerciseId]);

  useEffect(() => {
    if (comparisonModel.selectedWeek !== selectedWeek) {
      setSelectedWeek(comparisonModel.selectedWeek);
    }
  }, [comparisonModel.selectedWeek, selectedWeek]);

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
              value={activeDay}
              onChange={(event) => {
                setSelectedDay(event.target.value);
                setSelectedExerciseId("");
                setSelectedWeek(null);
              }}
            >
              {routineDays.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </label>
        </div>

        <section className="weekly-comparison-section">
          <h3>Rutina registrada {comparisonModel.selectedDay}</h3>
          <p className="weekly-routine-name">{comparisonModel.plannedRoutine ?? "Sin rutina registrada"}</p>
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
              {comparisonModel.plannedExercises.length > 0 ? comparisonModel.plannedExercises.map((exercise) => (
                <div
                  className={`weekly-plan-row ${exercise.isSelected ? "active" : ""}`}
                  role="row"
                  key={exercise.exerciseId}
                  onClick={() => {
                    setSelectedExerciseId(exercise.exerciseId);
                    setSelectedWeek(null);
                  }}
                >
                  <span role="cell">
                    <button
                      className="weekly-plan-row-button"
                      type="button"
                      aria-pressed={exercise.isSelected}
                      onClick={() => {
                        setSelectedExerciseId(exercise.exerciseId);
                        setSelectedWeek(null);
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
            {comparisonModel.availableWeeks.length > 0 ? (
              <label className="weekly-comparison-select week-select" aria-label="Seleccionar semana para comparar">
                <select
                  value={comparisonModel.selectedWeek ?? ""}
                  onChange={(event) => setSelectedWeek(Number(event.target.value))}
                >
                  {comparisonModel.availableWeeks.map((week) => (
                    <option key={week} value={week}>Semana {week}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <WeeklyResultsPanel model={comparisonModel} />
        </section>

        <WeeklyMetricProgressCard
          title="Compara los KG de tus ejercicios"
          helper="Selecciona un ejercicio para saber cómo vas evolucionando semana a semana."
          model={comparisonModel}
          metric="kg"
        />

        <WeeklyMetricProgressCard
          title="Compara las repeticiones de tus ejercicios"
          helper="Selecciona un ejercicio para saber cómo vas evolucionando semana a semana."
          model={comparisonModel}
          metric="reps"
        />
      </div>
    </section>
  );
}
