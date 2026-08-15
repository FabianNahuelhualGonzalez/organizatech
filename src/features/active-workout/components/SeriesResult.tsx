import { Check, X } from "lucide-react";

import styles from "@/features/active-workout/active-workout.module.css";
import type { ExerciseMetrics } from "@/lib/progress/types";
import { buildExerciseCurrentResultPresentation } from "@/lib/training/exercise-current-result-presentation";

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
  const supportingItems = result.items.filter((item) => item.label !== "Repeticiones");

  return (
    <section className={styles.objectives} data-tone={result.tone} aria-labelledby="exercise-objectives-title">
      <h3 id="exercise-objectives-title">Objetivos</h3>
      <div className={styles.repetitionGoal}>
        <strong>{result.headline}</strong>
        <span>{result.message}</span>
      </div>
      <div className={styles.goalGrid}>
        {supportingItems.map((item) => (
          <div
            className={`${styles.goalCard} ${item.tone === "partial" ? styles.pendingGoal : styles.reachedGoal}`}
            data-tone={item.tone}
            key={item.label}
          >
            <span className={styles.goalIcon} aria-hidden="true">
              {item.tone === "partial" ? <X size={20} /> : <Check size={20} />}
            </span>
            <strong>{item.detail}</strong>
            <span className={styles.goalLabel}>{item.label}</span>
            <span className={styles.goalValue}>{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
