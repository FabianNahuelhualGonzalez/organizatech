import styles from "@/features/active-workout/active-workout.module.css";
import type { ActiveWorkoutSheetGoals } from "@/features/active-workout/model/active-workout-sheet";

export interface ExerciseGoalsCardProps {
  goals: ActiveWorkoutSheetGoals;
}

export function ExerciseGoalsCard({ goals }: ExerciseGoalsCardProps) {
  return (
    <section
      className={styles.sheetGoals}
      data-reps-complete={goals.repsComplete}
      aria-label="Objetivos del ejercicio"
      aria-live="polite"
    >
      <div className={styles.sheetGoalsRepetitions}>
        <div className={styles.sheetGoalsHeadline}>
          <div>
            <strong>{goals.totalReps}</strong>
            <span>de {goals.targetTotalReps} repeticiones</span>
          </div>
          <span>{goals.progressPercent}%</span>
        </div>
        <div
          className={styles.sheetGoalsTrack}
          role="progressbar"
          aria-label="Progreso de repeticiones"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={goals.progressPercent}
        >
          <span style={{ width: `${goals.progressPercent}%` }} />
        </div>
        <p>{goals.repsMessage}</p>
      </div>

      <div className={styles.sheetGoalsSplit}>
        <div className={styles.sheetGoal} data-complete={goals.weight.complete}>
          <div><span aria-hidden="true" /><span>PESO</span></div>
          <strong>{goals.weight.value}</strong>
          <p>{goals.weight.status}</p>
        </div>
        <div className={styles.sheetGoal} data-complete={goals.sets.complete}>
          <div><span aria-hidden="true" /><span>SERIES</span></div>
          <strong>{goals.sets.value}</strong>
          <p>{goals.sets.status}</p>
        </div>
      </div>
    </section>
  );
}
