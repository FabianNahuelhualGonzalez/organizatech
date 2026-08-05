import {
  finalizeSessionOperationOwner,
  invalidateSessionOperationOwners,
  isSessionOperationOwnerCurrent,
  settleSessionOperationPromise,
  tryAcquireSessionOperationOwner,
  type SessionOperationDataMode,
  type SessionOperationOwner,
  type SessionOperationOwnerLock,
  type SessionOperationPromiseResult,
} from "@/lib/session/active-workout-session-boundary";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";

export type RoutineBuilderOperation = "routine-save" | "cycle-create" | "cycle-delete";

export interface RoutineBuilderOperationIdentityPort {
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface RoutineBuilderOperationRegistry {
  acquire(operation: RoutineBuilderOperation, dataMode: SessionOperationDataMode): SessionOperationOwner | null;
  isCurrent(operation: RoutineBuilderOperation, owner: SessionOperationOwner): boolean;
  settle<T>(operation: RoutineBuilderOperation, owner: SessionOperationOwner, request: Promise<T>):
    ReturnType<typeof settleSessionOperationPromise<T>>;
  finalize(operation: RoutineBuilderOperation, owner: SessionOperationOwner): boolean;
  invalidateAll(): void;
}

export type RoutineBuilderOwnedWrite = () => Promise<unknown>;

export type RoutineBuilderWorkflowResult =
  | { kind: "success" }
  | { kind: "stale" }
  | { kind: "error"; error: unknown };

export interface RoutineBuilderOwnedOperationContext {
  readonly dataMode: SessionOperationDataMode;
  readonly userId: string | null;
  readonly requestToken: SessionDataRequestToken;
  isCurrent(): boolean;
  settle<T>(request: Promise<T>): Promise<SessionOperationPromiseResult<T>>;
}

export interface RoutineBuilderRoutineSaveContext extends RoutineBuilderOwnedOperationContext {
  runLegacyBatch(writes: readonly RoutineBuilderOwnedWrite[]): Promise<RoutineBuilderWorkflowResult>;
  completeSetupContinuation(): boolean;
}

export interface RoutineBuilderCycleDeleteContext extends RoutineBuilderOwnedOperationContext {
  runRepositoryWrite(write: RoutineBuilderOwnedWrite): Promise<RoutineBuilderWorkflowResult>;
}

export type RoutineBuilderOwnedWorkflowRunResult<T> =
  | { kind: "busy" }
  | { kind: "completed"; value: T; finalized: boolean }
  | { kind: "error"; error: unknown; finalized: boolean };

export function createRoutineBuilderOperationRegistry(
  identity: RoutineBuilderOperationIdentityPort,
): RoutineBuilderOperationRegistry {
  const locks: Record<RoutineBuilderOperation, SessionOperationOwnerLock> = {
    "routine-save": { current: null },
    "cycle-create": { current: null },
    "cycle-delete": { current: null },
  };

  return {
    acquire(operation, dataMode) {
      const lock = locks[operation];
      const owner = tryAcquireSessionOperationOwner(
        lock.current,
        identity.captureRequestToken(),
        { dataMode },
      );
      if (owner) lock.current = owner;
      return owner;
    },
    isCurrent(operation, owner) {
      return isSessionOperationOwnerCurrent({
        currentOwner: locks[operation].current,
        owner,
        isRequestCurrent: identity.isRequestTokenCurrent,
      });
    },
    settle(operation, owner, request) {
      return settleSessionOperationPromise({
        request,
        owner,
        getCurrentOwner: () => locks[operation].current,
        isRequestCurrent: identity.isRequestTokenCurrent,
      });
    },
    finalize(operation, owner) {
      const lock = locks[operation];
      const result = finalizeSessionOperationOwner({
        currentOwner: lock.current,
        owner,
        isRequestCurrent: identity.isRequestTokenCurrent,
      });
      lock.current = result.nextOwner;
      return result.canFinalize;
    },
    invalidateAll() {
      invalidateSessionOperationOwners(Object.values(locks));
    },
  };
}

export async function runLegacyRoutineSaveBatch(
  registry: RoutineBuilderOperationRegistry,
  owner: SessionOperationOwner,
  writes: readonly RoutineBuilderOwnedWrite[],
): Promise<RoutineBuilderWorkflowResult> {
  for (const write of writes) {
    if (!registry.isCurrent("routine-save", owner)) return { kind: "stale" };
    const result = await registry.settle("routine-save", owner, write());
    if (result.kind !== "success") return result;
  }
  return { kind: "success" };
}

export function completeRoutineSetupContinuation(
  registry: RoutineBuilderOperationRegistry,
  owner: SessionOperationOwner,
): boolean {
  return registry.finalize("routine-save", owner);
}

export async function runCycleDeleteWrite(
  registry: RoutineBuilderOperationRegistry,
  owner: SessionOperationOwner,
  write: RoutineBuilderOwnedWrite,
): Promise<RoutineBuilderWorkflowResult> {
  if (!registry.isCurrent("cycle-delete", owner)) return { kind: "stale" };
  const result = await registry.settle("cycle-delete", owner, write());
  return result.kind === "success" ? { kind: "success" } : result;
}

async function runOwnedWorkflow<T, Context extends RoutineBuilderOwnedOperationContext>(input: {
  registry: RoutineBuilderOperationRegistry;
  operation: RoutineBuilderOperation;
  dataMode: SessionOperationDataMode;
  createContext(owner: SessionOperationOwner): Context;
  execute(context: Context): Promise<T>;
}): Promise<RoutineBuilderOwnedWorkflowRunResult<T>> {
  const owner = input.registry.acquire(input.operation, input.dataMode);
  if (!owner) return { kind: "busy" };

  let result: { kind: "completed"; value: T } | { kind: "error"; error: unknown };
  try {
    result = { kind: "completed", value: await input.execute(input.createContext(owner)) };
  } catch (error) {
    result = { kind: "error", error };
  }
  const finalized = input.registry.finalize(input.operation, owner);
  return { ...result, finalized };
}

function createOwnedOperationContext(
  registry: RoutineBuilderOperationRegistry,
  operation: RoutineBuilderOperation,
  owner: SessionOperationOwner,
): RoutineBuilderOwnedOperationContext {
  return {
    dataMode: owner.dataMode,
    userId: owner.userId,
    requestToken: owner.requestToken,
    isCurrent: () => registry.isCurrent(operation, owner),
    settle: (request) => registry.settle(operation, owner, request),
  };
}

export function runRoutineSaveWorkflow<T>(input: {
  registry: RoutineBuilderOperationRegistry;
  dataMode: SessionOperationDataMode;
  execute(context: RoutineBuilderRoutineSaveContext): Promise<T>;
}) {
  return runOwnedWorkflow({
    ...input,
    operation: "routine-save",
    createContext(owner): RoutineBuilderRoutineSaveContext {
      return {
        ...createOwnedOperationContext(input.registry, "routine-save", owner),
        runLegacyBatch: (writes) => runLegacyRoutineSaveBatch(input.registry, owner, writes),
        completeSetupContinuation: () => completeRoutineSetupContinuation(input.registry, owner),
      };
    },
  });
}

export function runCycleCreateWorkflow<T>(input: {
  registry: RoutineBuilderOperationRegistry;
  dataMode: SessionOperationDataMode;
  execute(context: RoutineBuilderOwnedOperationContext): Promise<T>;
}) {
  return runOwnedWorkflow({
    ...input,
    operation: "cycle-create",
    createContext: (owner) => createOwnedOperationContext(input.registry, "cycle-create", owner),
  });
}

export function runCycleDeleteWorkflow<T>(input: {
  registry: RoutineBuilderOperationRegistry;
  dataMode: SessionOperationDataMode;
  execute(context: RoutineBuilderCycleDeleteContext): Promise<T>;
}) {
  return runOwnedWorkflow({
    ...input,
    operation: "cycle-delete",
    createContext(owner): RoutineBuilderCycleDeleteContext {
      return {
        ...createOwnedOperationContext(input.registry, "cycle-delete", owner),
        runRepositoryWrite: (write) => runCycleDeleteWrite(input.registry, owner, write),
      };
    },
  });
}
