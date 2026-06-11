export const PROTECTED_ACTIVE_CYCLE_MESSAGE =
  "Existe un ciclo activo protegido. No se puede crear un nuevo ciclo automaticamente sin autorizacion.";

interface TrainingCycleProtectionCandidate {
  cycleNumber: number;
  planSnapshot: Record<string, unknown>;
}

export function isProtectedTrainingCycle(cycle: TrainingCycleProtectionCandidate) {
  if (cycle.cycleNumber === 1) return true;

  const source = cycle.planSnapshot.source;
  return source !== "cycle-scoped" && source !== "cycle-scoped-qa";
}

export function canFinishTrainingCycle(
  cycle: TrainingCycleProtectionCandidate,
  status: "completed" | "cancelled",
  explicitlyConfirmed = false,
) {
  if (!isProtectedTrainingCycle(cycle)) return true;
  return status === "completed" && explicitlyConfirmed;
}
