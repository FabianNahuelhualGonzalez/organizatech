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
  readonly userId: string | null;
  readonly scope: string | null;
  readonly dataMode: SessionOperationDataMode;
  readonly operationId: string;
}

export type SessionOperationDataMode = "demo" | "supabase";

export interface SessionOperationOwnerLock {
  current: SessionOperationOwner | null;
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
  input: {
    dataMode?: SessionOperationDataMode;
    operationId?: string;
  } = {},
): SessionOperationOwner | null {
  if (currentOwner) return null;
  return Object.freeze({
    requestToken,
    userId: requestToken.userId,
    scope: requestToken.scope,
    dataMode: input.dataMode ?? (requestToken.userId ? "supabase" : "demo"),
    operationId: input.operationId ?? createSessionOperationId(),
  });
}

export function createSessionOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `session-operation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isSessionOperationOwner(
  currentOwner: SessionOperationOwner | null,
  expectedOwner: SessionOperationOwner,
): boolean {
  return currentOwner === expectedOwner;
}

export function isSessionOperationOwnerCurrent(input: {
  currentOwner: SessionOperationOwner | null;
  owner: SessionOperationOwner;
  isRequestCurrent: (token: SessionDataRequestToken) => boolean;
}): boolean {
  return isSessionOperationOwner(input.currentOwner, input.owner) &&
    input.isRequestCurrent(input.owner.requestToken);
}

export function invalidateSessionOperationOwners(
  locks: readonly SessionOperationOwnerLock[],
): void {
  for (const lock of locks) lock.current = null;
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
  const isCurrent = () => isSessionOperationOwnerCurrent({
    currentOwner: input.getCurrentOwner(),
    owner: input.owner,
    isRequestCurrent: input.isRequestCurrent,
  });

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
  const canFinalize = isSessionOperationOwnerCurrent({
    currentOwner: input.currentOwner,
    owner: input.owner,
    isRequestCurrent: input.isRequestCurrent,
  });

  return {
    canFinalize,
    released,
    nextOwner: releaseSessionOperationOwner(input.currentOwner, input.owner),
  };
}
