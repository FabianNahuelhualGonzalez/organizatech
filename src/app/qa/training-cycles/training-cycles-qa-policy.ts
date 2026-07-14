export type QaAuthStatus = "checking" | "authenticated" | "unauthenticated";
export type QaActionKind = "load" | "create" | "update";
export interface QaMutationLock {
  current: boolean;
}

const QA_ACTION_ERROR_MESSAGES: Record<QaActionKind, string> = {
  load: "No fue posible cargar los ciclos de prueba.",
  create: "No fue posible crear el ciclo de prueba.",
  update: "No fue posible actualizar el ciclo de prueba.",
};

export function getQaActionErrorMessage(action: QaActionKind): string {
  return QA_ACTION_ERROR_MESSAGES[action];
}

export function canRunQaAction(authStatus: QaAuthStatus, isBusy: boolean): boolean {
  return authStatus === "authenticated" && !isBusy;
}

export function tryAcquireQaMutationLock(lock: QaMutationLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseQaMutationLock(lock: QaMutationLock): void {
  lock.current = false;
}

export function canMutateQaCycle(
  authStatus: QaAuthStatus,
  isBusy: boolean,
  cycleId: string | null | undefined,
  createdCycleIds: ReadonlySet<string>,
): boolean {
  return Boolean(
    canRunQaAction(authStatus, isBusy) &&
    cycleId &&
    createdCycleIds.has(cycleId),
  );
}

export function rememberCreatedQaCycle(
  current: ReadonlySet<string>,
  cycleId: string,
): Set<string> {
  const next = new Set(current);
  next.add(cycleId);
  return next;
}
