import styles from "@/features/active-workout/active-workout.module.css";
import {
  ActiveWorkoutSheetBoundary,
  type ActiveWorkoutSheetBoundaryProps,
} from "@/features/active-workout/components/ActiveWorkoutSheetBoundary";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";

export interface GuidedTrainingScreenProps extends ActiveWorkoutSheetBoundaryProps {
  drafts: Record<string, ExerciseDraft>;
}

/**
 * Frontera presentacional estable del entrenamiento guiado. El estado, los efectos y la
 * reconciliación del bottom sheet pertenecen al hijo feature-owned `ActiveWorkoutSheetBoundary`.
 * Esta pantalla no consulta datos, no posee hooks y no agrega estado al composition root.
 */
export function GuidedTrainingScreen(props: GuidedTrainingScreenProps) {
  return (
    <section className={styles.guidedScreen} aria-labelledby="guided-routine-title">
      <ActiveWorkoutSheetBoundary {...props} />
    </section>
  );
}
