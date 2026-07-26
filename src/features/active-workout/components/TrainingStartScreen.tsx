import { Activity, CalendarDays, Dumbbell, Pencil } from "lucide-react";

import { formatKg } from "@/lib/progress/weight-format";
import type { ExerciseTemplate } from "@/lib/progress/types";

/**
 * Copia local privada de `RoutineMetricGrid` (organizatech-app.tsx:6164), pendiente de
 * consolidación en `src/components/ui/`. Se duplica aquí para no importar desde
 * organizatech-app.tsx ni introducir una carpeta shared/common en esta fase — también es usada
 * por `GuidedTrainingScreen`, que no se prepara todavía.
 */
function RoutineMetricGrid({
  targetSummary,
  exerciseLabel = "Ejercicios total",
}: {
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  exerciseLabel?: string;
}) {
  return (
    <div className="metric-grid wide dashboard-metric-grid routine-metric-grid">
      <div className="metric">
        <div className="metric-title-row">
          <span>KG totales de la rutina</span>
          <Dumbbell size={18} />
        </div>
        <strong>{formatKg(targetSummary.totalWeight)}</strong>
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>Total reps</span>
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

export interface TrainingStartScreenProps {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  routineDays: string[];
  switchDay: (day: string) => void;
  editRoutine: () => void;
  startTraining: () => void;
  isStartingTraining: boolean;
  notice: string;
}

export function TrainingStartScreen({
  day,
  routine,
  exercises,
  targetSummary,
  routineDays,
  switchDay,
  editRoutine,
  startTraining,
  isStartingTraining,
  notice,
}: TrainingStartScreenProps) {
  return (
    <section className="screen">
      <div className="card wide day-switcher-card">
        <div className="section-heading">
          <div>
            <h3>Selecciona rutina o día</h3>
            <p className="eyebrow">Cambia entre tus días registrados para iniciar el entrenamiento.</p>
          </div>
        </div>
        <div className="routine-day-pills">
          {routineDays.map((item) => (
            <button
              key={item}
              className={`routine-day-pill configured ${item === day ? "active" : ""}`}
              type="button"
              onClick={() => switchDay(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="card wide training-start-card">
        <div className="training-start-header">
          <div>
            <p className="eyebrow">Entrenamiento del día {day}</p>
            <h2>{routine}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Editar rutina semanal" onClick={editRoutine}>
            <Pencil size={17} />
          </button>
        </div>
        <p>Cuando estés listo, inicia el entrenamiento. Primero haremos un formulario de motivación rápido y luego verás tus ejercicios.</p>
        <RoutineMetricGrid targetSummary={targetSummary} />
        <div className="training-start-preview">
          {exercises.slice(0, 3).map((exercise) => (
            <div key={exercise.id}>
              <strong>{exercise.name}</strong>
              <span>{exercise.targetSets} series · {exercise.targetReps} reps · {formatKg(exercise.baseWeight)}</span>
            </div>
          ))}
        </div>
        <div className="training-start-actions">
          <button className="start-button" type="button" onClick={startTraining} disabled={isStartingTraining}>
            {isStartingTraining ? "Verificando..." : "Iniciar entrenamiento"}
          </button>
        </div>
        {notice ? <p className="setup-message">{notice}</p> : null}
      </div>
    </section>
  );
}
