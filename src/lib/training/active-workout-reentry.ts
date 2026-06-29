export type ActiveWorkoutReentryDecision = "resume-memory" | "restore-draft" | "start-readiness";

export interface ActiveWorkoutMemoryState {
  attemptV2: boolean;
  hasStartedTraining: boolean;
  readiness: unknown;
  activeWorkoutStartedAt: string | null;
  workoutAttemptId: string | null;
  cycleId: string | null;
  cycleDayId: string | null;
}

export interface ActiveWorkoutAttemptRetentionState {
  screen: string;
  hasStartedTraining: boolean;
}

export function resolveActiveWorkoutReentryDecision(
  state: ActiveWorkoutMemoryState,
  hasRecoverableDraft: boolean,
): ActiveWorkoutReentryDecision {
  if (canResumeActiveWorkoutFromMemory(state)) return "resume-memory";
  if (hasRecoverableDraft) return "restore-draft";
  return "start-readiness";
}

export function canResumeActiveWorkoutFromMemory(state: ActiveWorkoutMemoryState): boolean {
  const hasLegacyActiveMemory = Boolean(state.hasStartedTraining && state.readiness && state.activeWorkoutStartedAt);
  if (!hasLegacyActiveMemory) return false;
  if (!state.attemptV2) return true;

  return Boolean(state.workoutAttemptId && state.cycleId && state.cycleDayId);
}

export function shouldRetainActiveWorkoutAttemptState(state: ActiveWorkoutAttemptRetentionState): boolean {
  return state.hasStartedTraining && [
    "dashboard",
    "comparacion",
    "historial-ciclos",
    "perfil",
  ].includes(state.screen);
}
