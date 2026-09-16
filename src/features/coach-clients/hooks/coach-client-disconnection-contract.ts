/** Explicit authorized target. An accepted invitation never becomes a relationship target. */
export type CoachClientDisconnectionSelection = Readonly<{ kind: "invitation" | "relationship"; id: string }>;

/** No code, name, email, ownership or activity is exposed by this consumer port. */
export type CoachClientDisconnectionRead =
  | Readonly<{ kind: "invitation"; id: string; state: "pending" | "expired" | "cancelled" | "accepted" }>
  | Readonly<{ kind: "relationship"; id: string; endedAt: string | null }>;

export interface CoachClientDisconnectionReceipt {
  readonly kind: "invitation" | "relationship";
  readonly id: string;
  readonly requestId: string;
  readonly completed: true;
}

export interface CoachClientDisconnectionCallOptions { readonly signal?: AbortSignal }

/** The adapter owns UUID/DTO validation, action projection, authorization and total deadlines. */
export interface CoachClientDisconnectionSource {
  readSelection(selection: CoachClientDisconnectionSelection, options?: CoachClientDisconnectionCallOptions): Promise<CoachClientDisconnectionRead>;
  disconnect(selection: CoachClientDisconnectionSelection, requestId: string, options?: CoachClientDisconnectionCallOptions): Promise<CoachClientDisconnectionReceipt>;
  readOwnOperation(requestId: string, options?: CoachClientDisconnectionCallOptions): Promise<CoachClientDisconnectionReceipt | null>;
}

export type CoachClientDisconnectionIssue = "invalid_selection" | "invalid_request_id" | "confirmation_changed"
  | "invalid_input" | "invalid_response" | "forbidden" | "not_found" | "state_conflict"
  | "request_conflict" | "operation_stale" | "aborted" | "timeout" | "unavailable";

export interface CoachClientDisconnectionAttempt {
  readonly selection: CoachClientDisconnectionSelection;
  readonly requestId: string;
  readonly phase: "in-flight" | "uncertain" | "recorded" | "resolved" | "rejected";
  readonly receipt: CoachClientDisconnectionReceipt | null;
  /** Only an explicit null operation read enables retry of this exact selection/requestId. */
  readonly retryAllowed: boolean;
}

export interface CoachClientDisconnectionSnapshot {
  readonly confirmed: CoachClientDisconnectionRead | null;
  readonly confirmationOpen: boolean;
  readonly pending: "load" | "confirm" | "reconcile" | "retry" | null;
  /** A resolved receipt's requestId is the stable signal for a future portfolio invalidation. */
  readonly attempt: CoachClientDisconnectionAttempt | null;
  readonly issue: CoachClientDisconnectionIssue | null;
  readonly needsRefresh: boolean;
  readonly disposed: boolean;
}

export interface CoachClientDisconnectionControllerInput {
  readonly selection: CoachClientDisconnectionSelection;
  readonly source: CoachClientDisconnectionSource;
  /** Bound to captured account + generation/portal + selection. False observed is permanent. */
  readonly isCurrent: () => boolean;
  /** Unique id per new logical attempt; never invoked by reconcile or retry. */
  readonly createRequestId: () => string;
}

export interface CoachClientDisconnectionController {
  getSnapshot(): CoachClientDisconnectionSnapshot;
  subscribe(listener: (snapshot: CoachClientDisconnectionSnapshot) => void): () => void;
  load(): Promise<boolean>;
  openConfirmation(): boolean;
  /** Local closure never removes an already dispatched/uncertain attempt. */
  cancelConfirmation(): boolean;
  canConfirm(): boolean;
  confirm(): Promise<boolean>;
  reconcile(): Promise<boolean>;
  retry(): Promise<boolean>;
  /** Abort locally, clear data and discard late results; not a remote rollback. */
  dispose(): void;
}
