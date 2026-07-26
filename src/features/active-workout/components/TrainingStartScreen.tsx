import { Pencil } from "lucide-react";

import { formatKg } from "@/lib/progress/weight-format";
import type { ExerciseTemplate } from "@/lib/progress/types";
import { RoutineMetricGrid } from "@/ui/data-display/metric-grid";

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
