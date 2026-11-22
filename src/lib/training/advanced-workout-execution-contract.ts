import type { ReactNode } from "react";

export interface AdvancedWorkoutExerciseIntegration {
  readonly isReady: boolean;
}

/** Frontera estable consumida por Active Workout; no expone modelos internos del ciclo. */
export interface AdvancedWorkoutExecutionIntegration {
  readonly isReady: boolean;
  readonly publishPendingPayload: () => boolean;
  readonly getExercise: (legacyExerciseId: string) => AdvancedWorkoutExerciseIntegration | null;
  readonly getExerciseVideoReference: (legacyExerciseId: string) => ReactNode | null;
}
