import { Pencil } from "lucide-react";

import styles from "@/features/active-workout/active-workout.module.css";
import { formatDecimalEs } from "@/lib/progress/weight-format";
import type { ExerciseTemplate } from "@/lib/progress/types";
import { flexibleRoutineLabel } from "@/lib/training/flexible-training-schedule";
import { IconButton } from "@/ui/buttons/icon-button";
import { RoutineMetricGrid } from "@/ui/data-display/metric-grid";

export interface TrainingStartScreenProps {
  day: string;
  flexibleSchedule?: boolean;
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
  flexibleSchedule = false,
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
    <section className={`screen ${styles.screen}`} aria-labelledby="training-start-title">
      <header className={`wide ${styles.startIntro}`}>
        <h2 id="training-start-title">{flexibleSchedule ? "Elige la rutina de hoy" : "Selecciona el día de entrenamiento para comenzar"}</h2>
      </header>

      <article className={`card wide training-start-card ${styles.workoutCard}`}>
        <header className={styles.routineHeader}>
          <div className={styles.routineTitle}>
            <h3>Rutina registrada {flexibleSchedule ? flexibleRoutineLabel(day) : day}</h3>
            <p>{routine}</p>
          </div>

          <div className={styles.routineControls}>
            <label className={styles.daySelector}>
              <span className={styles.srOnly}>{flexibleSchedule ? "Rutina de hoy" : "Día de entrenamiento"}</span>
              <select value={day} onChange={(event) => switchDay(event.target.value)}>
                {routineDays.map((item) => (
                  <option value={item} key={item}>{flexibleSchedule ? flexibleRoutineLabel(item) : item}</option>
                ))}
              </select>
            </label>
            <IconButton
              className={styles.editRoutineButton}
              type="button"
              aria-label="Editar rutina semanal"
              onClick={editRoutine}
            >
              <Pencil size={15} aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        <section className={styles.planSection} aria-labelledby="training-plan-title">
          <div className={styles.sectionHeading}>
            <h3 id="training-plan-title">Rutina de entrenamiento registrada</h3>
            <p>Esta es tu pauta de entrenamiento.</p>
          </div>

          <div
            className={styles.exerciseTable}
            role="table"
            aria-label={`Ejercicios de ${routine} para ${flexibleSchedule ? flexibleRoutineLabel(day) : day}`}
          >
            <div className={styles.tableHeader} role="row">
              <span role="columnheader">Ejercicios</span>
              <span role="columnheader">Series</span>
              <span role="columnheader">Reps</span>
              <span role="columnheader">KG</span>
            </div>
            <div role="rowgroup">
              {exercises.map((exercise) => (
                <div className={styles.tableRow} role="row" key={exercise.id}>
                  <span className={styles.exerciseNameCell} role="cell">{exercise.name}</span>
                  <span role="cell">{exercise.targetSets}</span>
                  <span role="cell">{exercise.targetReps}</span>
                  <span role="cell">{formatDecimalEs(exercise.baseWeight)}</span>
                </div>
              ))}
            </div>
          </div>
          {exercises.length === 0 ? (
            <p className={styles.emptyTableMessage} role="status">
              {flexibleSchedule ? "No hay ejercicios registrados para esta rutina." : "No hay ejercicios registrados para este día."}
            </p>
          ) : null}
        </section>

        <div className={styles.metricScope}>
          <RoutineMetricGrid
            targetSummary={targetSummary}
            weightLabel="Total de KG de la rutina"
            repsLabel="Total Reps"
            exerciseLabel="Total ejercicios registrados"
          />
        </div>

        <div className={styles.actionRow}>
          <button
            className={`start-button ${styles.primaryAction}`}
            type="button"
            onClick={startTraining}
            disabled={isStartingTraining}
            aria-busy={isStartingTraining}
          >
            {isStartingTraining ? "Verificando..." : "Iniciar entrenamiento"}
          </button>
        </div>
        {notice ? (
          <p className={styles.notice} role="status" aria-live="polite">{notice}</p>
        ) : null}
      </article>
    </section>
  );
}
