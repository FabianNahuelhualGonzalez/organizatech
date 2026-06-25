
import type { TrainingWorkoutReadinessPayload } from "@/lib/training/training-workout-readiness-repository";
export type TrainingWorkoutReadinessMode = "legacy" | "attempt_v2";

export interface TrainingWorkoutReadinessContext {
  enabled: boolean;
  cycleScoped: boolean;
  workoutAttemptId: string | null;
  cycleId: string | null;
  cycleDayId: string | null;
  workoutStartedAt: string | null;
}

export class TrainingWorkoutReadinessFlowError extends Error {
  constructor(message = "No pudimos preparar el formulario de entrenamiento para este intento.") {
    super(message);
    this.name = "TrainingWorkoutReadinessFlowError";
  }
}

export function resolveTrainingWorkoutReadinessMode(
  context: TrainingWorkoutReadinessContext,
): TrainingWorkoutReadinessMode {
  if (!context.enabled) return "legacy";
  if (!context.cycleScoped) return "legacy";

  if (!isNonEmptyString(context.workoutAttemptId) ||
    !isNonEmptyString(context.cycleId) ||
    !isNonEmptyString(context.cycleDayId) ||
    !isNonEmptyString(context.workoutStartedAt)) {
    throw new TrainingWorkoutReadinessFlowError();
  }

  return "attempt_v2";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export interface TrainingWorkoutReadinessFormValue {
  skipped: boolean;
  motivation?: unknown;
  hydration?: unknown;
  sleep?: unknown;
  energy?: unknown;
}

export function toTrainingWorkoutReadinessPayload(
  value: TrainingWorkoutReadinessFormValue,
): TrainingWorkoutReadinessPayload {
  if (value.skipped) return { skipped: true };

  if (!isReadinessScore(value.motivation) ||
    !isReadinessScore(value.hydration) ||
    !isReadinessScore(value.sleep) ||
    !isReadinessScore(value.energy)) {
    throw new TrainingWorkoutReadinessFlowError("Completa tu formulario diario antes de continuar.");
  }

  return {
    skipped: false,
    motivation: value.motivation,
    hydration: value.hydration,
    sleep: value.sleep,
    energy: value.energy,
  };
}

function isReadinessScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 1 && value <= 7;
}
