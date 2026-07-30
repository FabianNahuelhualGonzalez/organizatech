import type {
  SessionDataIdentity,
  SessionDataRequestToken,
} from "@/lib/session/session-data-epoch";

export type ActiveWorkoutSessionBoundaryEvent = "session_applied" | "signed_out";

export interface ActiveWorkoutSessionBoundaryDecision {
  invalidateEpoch: boolean;
  forceEpochAdvance: boolean;
  resetActiveWorkoutMemory: boolean;
  clearClosingStorageScope: boolean;
  clearIncomingWorkoutDraft: false;
}

export interface SessionOperationOwner {
  readonly requestToken: SessionDataRequestToken;
}

export type SessionOperationPromiseResult<T> =
  | { kind: "success"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "stale" };

export interface SessionOperationFinalization {
  canFinalize: boolean;
  released: boolean;
  nextOwner: SessionOperationOwner | null;
}

export function resolveActiveWorkoutSessionBoundary(input: {
  currentIdentity: SessionDataIdentity;
  nextIdentity: SessionDataIdentity;
  event: ActiveWorkoutSessionBoundaryEvent;
}): ActiveWorkoutSessionBoundaryDecision {
  if (input.event === "signed_out") {
    return {
      invalidateEpoch: true,
      forceEpochAdvance: true,
      resetActiveWorkoutMemory: true,
      clearClosingStorageScope: true,
      clearIncomingWorkoutDraft: false,
    };
  }

  const identityChanged = input.currentIdentity.userId !== input.nextIdentity.userId ||
    input.currentIdentity.scope !== input.nextIdentity.scope;

  return {
    invalidateEpoch: identityChanged,
    forceEpochAdvance: false,
    resetActiveWorkoutMemory: identityChanged,
    clearClosingStorageScope: false,
    clearIncomingWorkoutDraft: false,
  };
}

export function resolveIncomingWorkoutDraftRecoveryScope<TScope extends string>(input: {
  scope: TScope | null;
  willAttemptAutomaticRecovery: boolean;
}): TScope | null {
  return input.willAttemptAutomaticRecovery ? input.scope : null;
}

export function tryAcquireSessionOperationOwner(
  currentOwner: SessionOperationOwner | null,
  requestToken: SessionDataRequestToken,
): SessionOperationOwner | null {
  if (currentOwner) return null;
  return { requestToken };
}

export function isSessionOperationOwner(
  currentOwner: SessionOperationOwner | null,
  expectedOwner: SessionOperationOwner,
): boolean {
  return currentOwner === expectedOwner;
}

export function releaseSessionOperationOwner(
  currentOwner: SessionOperationOwner | null,
  expectedOwner: SessionOperationOwner,
): SessionOperationOwner | null {
  return isSessionOperationOwner(currentOwner, expectedOwner) ? null : currentOwner;
}

export async function settleSessionOperationPromise<T>(input: {
  request: Promise<T>;
  owner: SessionOperationOwner;
  getCurrentOwner: () => SessionOperationOwner | null;
  isRequestCurrent: (token: SessionDataRequestToken) => boolean;
}): Promise<SessionOperationPromiseResult<T>> {
  const isCurrent = () => isSessionOperationOwner(input.getCurrentOwner(), input.owner) &&
    input.isRequestCurrent(input.owner.requestToken);

  try {
    const value = await input.request;
    return isCurrent() ? { kind: "success", value } : { kind: "stale" };
  } catch (error) {
    return isCurrent() ? { kind: "error", error } : { kind: "stale" };
  }
}

export function finalizeSessionOperationOwner(input: {
  currentOwner: SessionOperationOwner | null;
  owner: SessionOperationOwner;
  isRequestCurrent: (token: SessionDataRequestToken) => boolean;
}): SessionOperationFinalization {
  const released = isSessionOperationOwner(input.currentOwner, input.owner);
  const canFinalize = released && input.isRequestCurrent(input.owner.requestToken);

  return {
    canFinalize,
    released,
    nextOwner: releaseSessionOperationOwner(input.currentOwner, input.owner),
  };
}
