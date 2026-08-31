import type { ReactNode, Ref } from "react";

export interface AdvancedWorkoutLegacyDraftProjection {
  readonly weight: string;
  readonly reps: readonly (number | "")[];
}

export interface AdvancedWorkoutExerciseIntegration {
  readonly isReady: boolean;
  readonly legacyDraftProjection: AdvancedWorkoutLegacyDraftProjection;
  readonly renderRegistrationFields: (initialControlRef: Ref<HTMLInputElement>) => ReactNode;
}

/** Frontera estable consumida por Active Workout; no expone modelos internos del ciclo. */
export interface AdvancedWorkoutExecutionIntegration {
  readonly isReady: boolean;
  readonly publishPendingPayload: () => boolean;
  readonly getExercise: (legacyExerciseId: string) => AdvancedWorkoutExerciseIntegration | null;
}
