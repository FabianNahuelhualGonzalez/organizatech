import type { ActiveWorkoutControllerActions } from "@/features/active-workout/hooks/useActiveWorkoutController";
import type { ActiveWorkoutControllerState } from "@/features/active-workout/model/active-workout-controller-state";
import type { DataMode } from "@/lib/supabase/session";
import type {
  SessionOperationOwner,
} from "@/lib/session/active-workout-session-boundary";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import type {
  ActiveWorkoutReadinessContext,
  PendingWorkoutReadinessLink,
} from "@/lib/training/workout-draft-storage";

export type ActiveWorkoutOperation = "start" | "readiness" | "completion";

export interface ActiveWorkoutRuntimeSnapshot {
  attemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
  readinessContext: ActiveWorkoutReadinessContext | null;
}

export interface ActiveWorkoutOperationContext {
  readonly owner: SessionOperationOwner;
  readonly actions: Readonly<ActiveWorkoutControllerActions>;
  getRuntimeSnapshot(): ActiveWorkoutRuntimeSnapshot;
  replaceRuntimeSnapshot(snapshot: ActiveWorkoutRuntimeSnapshot): void;
  isCurrent(): boolean;
  settle<T>(request: Promise<T>): Promise<
    | { kind: "success"; value: T }
    | { kind: "error"; error: unknown }
    | { kind: "stale" }
  >;
}

export type ActiveWorkoutActionResult = "success" | "stale" | "error" | "ignored";
export type ActiveWorkoutCompletionStatus = "idle" | "saving" | "error";
export type ActiveWorkoutReentryResult = "resume-memory" | "restore-draft" | "unavailable";

export interface ActiveWorkoutCompletionPublication {
  revision: number;
  status: ActiveWorkoutCompletionStatus;
}

export const INITIAL_ACTIVE_WORKOUT_COMPLETION_PUBLICATION: ActiveWorkoutCompletionPublication = {
  revision: 0,
  status: "idle",
};

export function beginActiveWorkoutCompletion(
  current: ActiveWorkoutCompletionPublication,
): ActiveWorkoutCompletionPublication {
  return { revision: current.revision + 1, status: "saving" };
}

export function settleActiveWorkoutCompletion(
  current: ActiveWorkoutCompletionPublication,
  capturedRevision: number,
  result: ActiveWorkoutActionResult,
): ActiveWorkoutCompletionPublication {
  if (current.revision !== capturedRevision) return current;
  return {
    revision: current.revision,
    status: result === "error" ? "error" : "idle",
  };
}

export function invalidateActiveWorkoutCompletion(
  current: ActiveWorkoutCompletionPublication,
): ActiveWorkoutCompletionPublication {
  return { revision: current.revision + 1, status: "idle" };
}

export function canRetryActiveWorkoutCompletion(status: ActiveWorkoutCompletionStatus) {
  return status === "error";
}

export interface ActiveWorkoutIdentityPort {
  dataMode: DataMode;
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface ActiveWorkoutCommandPorts {
  start(context: ActiveWorkoutOperationContext): Promise<ActiveWorkoutActionResult | void>;
  submitReadiness(
    value: TrainingReadiness,
    context: ActiveWorkoutOperationContext,
  ): Promise<ActiveWorkoutActionResult | void>;
  complete(context: ActiveWorkoutOperationContext): Promise<ActiveWorkoutActionResult | void>;
  resumeOrRestore(): ActiveWorkoutReentryResult;
}

export interface ActiveWorkoutIdentityReset {
  incomingRecoveryScope: BrowserStorageScope | null;
  resetHistory(): void;
}

export interface ActiveWorkoutBoundary {
  readonly state: Readonly<ActiveWorkoutControllerState>;
  readonly controllerActions: Readonly<ActiveWorkoutControllerActions>;
  readonly completionStatus: ActiveWorkoutCompletionStatus;
  start(): Promise<ActiveWorkoutActionResult>;
  submitReadiness(value: Omit<TrainingReadiness, "skipped">): Promise<void>;
  skipReadiness(): Promise<void>;
  pause(): void;
  resumeOrRestore(): ActiveWorkoutReentryResult;
  complete(): Promise<ActiveWorkoutActionResult>;
  retryCompletion(): Promise<ActiveWorkoutActionResult>;
  discard(): void;
  resetForIdentity(input: ActiveWorkoutIdentityReset): void;
  invalidateOperations(): void;
  getRuntimeSnapshot(): ActiveWorkoutRuntimeSnapshot;
  replaceRuntimeSnapshot(snapshot: ActiveWorkoutRuntimeSnapshot): void;
  abortStart(): void;
  consumeIncomingRecoveryScope(scope: BrowserStorageScope | null): void;
  getIncomingRecoveryScope(): BrowserStorageScope | null;
}
