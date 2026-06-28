import type { PendingWorkoutReadinessLink } from "@/lib/training/workout-draft-storage";

export interface CreateWorkoutReadinessPendingLinkInput {
  enabled: boolean;
  cycleScoped: boolean;
  workoutAttemptId: string | null | undefined;
  trainingSessionId: string | null | undefined;
}

export class TrainingWorkoutReadinessLinkFlowError extends Error {
  constructor(message = "No pudimos preparar la vinculacion del formulario con el entrenamiento guardado.") {
    super(message);
    this.name = "TrainingWorkoutReadinessLinkFlowError";
  }
}

export function createWorkoutReadinessPendingLink(
  input: CreateWorkoutReadinessPendingLinkInput,
): PendingWorkoutReadinessLink | null {
  if (!input.enabled || !input.cycleScoped) return null;

  if (!isNonEmptyString(input.workoutAttemptId) || !isNonEmptyString(input.trainingSessionId)) {
    throw new TrainingWorkoutReadinessLinkFlowError();
  }

  return {
    workoutAttemptId: input.workoutAttemptId,
    trainingSessionId: input.trainingSessionId,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
