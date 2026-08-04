import type { ActiveWorkoutControllerActions } from "@/features/active-workout/hooks/useActiveWorkoutController";
import type {
  ActiveWorkoutActionResult,
  ActiveWorkoutIdentityPort,
  ActiveWorkoutOperation,
  ActiveWorkoutOperationContext,
  ActiveWorkoutRuntimeSnapshot,
} from "@/features/active-workout/model/active-workout-boundary-contract";
import {
  finalizeSessionOperationOwner,
  isSessionOperationOwnerCurrent,
  settleSessionOperationPromise,
  tryAcquireSessionOperationOwner,
  type SessionOperationOwner,
  type SessionOperationOwnerLock,
} from "@/lib/session/active-workout-session-boundary";

export type ActiveWorkoutOperationLocks = Record<
  ActiveWorkoutOperation,
  SessionOperationOwnerLock
>;

export interface ActiveWorkoutOperationEngineInput {
  operation: ActiveWorkoutOperation;
  locks: ActiveWorkoutOperationLocks;
  identity: ActiveWorkoutIdentityPort;
  actions: Readonly<ActiveWorkoutControllerActions>;
  getRuntimeSnapshot(): ActiveWorkoutRuntimeSnapshot;
  replaceRuntimeSnapshot(snapshot: ActiveWorkoutRuntimeSnapshot): void;
  command(
    context: ActiveWorkoutOperationContext,
  ): Promise<ActiveWorkoutActionResult | void>;
}

export async function runActiveWorkoutOperation(
  input: ActiveWorkoutOperationEngineInput,
): Promise<ActiveWorkoutActionResult> {
  const ownerLock = input.locks[input.operation];
  const owner = tryAcquireSessionOperationOwner(
    ownerLock.current,
    input.identity.captureRequestToken(),
    { dataMode: input.identity.dataMode },
  );
  if (!owner) return "ignored";
  ownerLock.current = owner;

  const isCurrent = () => isSessionOperationOwnerCurrent({
    currentOwner: ownerLock.current,
    owner,
    isRequestCurrent: input.identity.isRequestTokenCurrent,
  });
  const context: ActiveWorkoutOperationContext = {
    owner,
    actions: input.actions,
    getRuntimeSnapshot: input.getRuntimeSnapshot,
    replaceRuntimeSnapshot: input.replaceRuntimeSnapshot,
    isCurrent,
    settle: (request) => settleSessionOperationPromise({
      request,
      owner,
      getCurrentOwner: () => ownerLock.current,
      isRequestCurrent: input.identity.isRequestTokenCurrent,
    }),
  };

  try {
    return (await input.command(context)) ?? "success";
  } finally {
    const finalization = finalizeSessionOperationOwner({
      currentOwner: ownerLock.current,
      owner,
      isRequestCurrent: input.identity.isRequestTokenCurrent,
    });
    ownerLock.current = finalization.nextOwner;
  }
}

export function createActiveWorkoutOperationLocks(): ActiveWorkoutOperationLocks {
  return {
    start: { current: null },
    readiness: { current: null },
    completion: { current: null },
  };
}

export function getActiveWorkoutOperationOwner(
  locks: ActiveWorkoutOperationLocks,
  operation: ActiveWorkoutOperation,
): SessionOperationOwner | null {
  return locks[operation].current;
}
