export interface WorkoutStartLock {
  current: boolean;
}

export function tryAcquireWorkoutStartLock(lock: WorkoutStartLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseWorkoutStartLock(lock: WorkoutStartLock): void {
  lock.current = false;
}
export interface ResolveWorkoutAttemptIdInput {
  enabled: boolean;
  cycleId: string | null;
  cycleDayId: string | null;
  existingWorkoutAttemptId: string | null;
}

export function resolveWorkoutAttemptId(
  input: ResolveWorkoutAttemptIdInput,
  generateId: () => string,
): string | null {
  if (input.existingWorkoutAttemptId) return input.existingWorkoutAttemptId;
  if (!input.enabled) return null;
  if (!input.cycleId) return null;
  if (!input.cycleDayId) return null;

  const generated = generateId();
  if (typeof generated !== "string" || generated.trim().length === 0) {
    throw new Error("No pudimos preparar la identidad del entrenamiento.");
  }
  return generated;
}

export function createWorkoutAttemptId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== "function") {
    throw new Error("crypto.randomUUID no esta disponible para crear la identidad del entrenamiento.");
  }
  return randomUUID.call(globalThis.crypto);
}
