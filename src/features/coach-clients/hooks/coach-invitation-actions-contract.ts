export type CoachInvitationActionKind = "resend" | "regenerate";
export interface CoachInvitationActionsSelection { readonly invitationId: string }
/** Authorized server state; no email, code, identity or delivery fields. */
export interface CoachInvitationActionsRead {
  readonly id: string;
  readonly generation: number;
  readonly state: "pending" | "expired" | "cancelled" | "accepted";
}
export interface CoachInvitationActionsCommand {
  readonly invitationId: string;
  /** Invitation generation from explicit confirmed load, not Auth/session generation. */
  readonly expectedGeneration: number;
  readonly requestId: string;
}
export interface CoachInvitationActionsOperation {
  readonly requestId: string;
  readonly action: CoachInvitationActionKind;
  readonly state: "reserved" | "cancelled";
  readonly invitationId: string;
  readonly expectedGeneration: number;
  readonly generation: number;
  readonly reservedAt: string;
}
export type CoachInvitationActionsResult =
  | Readonly<{ status: "recorded"; serverNow: string; operation: CoachInvitationActionsOperation }>
  | Readonly<{ status: "rate_limited"; serverNow: string; retryAt: string }>;
export interface CoachInvitationActionsCallOptions { readonly signal?: AbortSignal }
/** Validated v2 source. Atomic expectedGeneration binding is mandatory; never adapt by dropping it.
 * The adapter owns authorization, canonical UUID/DTO/clock validation and total deadlines. */
export interface CoachInvitationActionsSource {
  resend(command: CoachInvitationActionsCommand, options?: CoachInvitationActionsCallOptions): Promise<CoachInvitationActionsResult>;
  regenerate(command: CoachInvitationActionsCommand, options?: CoachInvitationActionsCallOptions): Promise<CoachInvitationActionsResult>;
  readInvitation(invitationId: string, options?: CoachInvitationActionsCallOptions): Promise<CoachInvitationActionsRead>;
  /** A legacy-operation conflict is an error, NOT null or a v2 operation without its binding. */
  readOwnOperation(requestId: string, options?: CoachInvitationActionsCallOptions): Promise<CoachInvitationActionsOperation | null>;
}
export type CoachInvitationActionsIssue = "invalid_selection" | "invalid_request_id"
  | "invalid_input" | "invalid_response" | "forbidden" | "not_found" | "state_conflict"
  | "request_conflict" | "retry_required" | "operation_stale" | "aborted" | "timeout" | "unavailable";
export interface CoachInvitationActionsAttempt extends CoachInvitationActionsCommand {
  readonly action: CoachInvitationActionKind;
  readonly phase: "in-flight" | "uncertain" | "recorded" | "resolved" | "rejected" | "rate-limited";
  readonly operation: CoachInvitationActionsOperation | null;
  readonly retryAllowed: boolean;
  /** Reservation only; never provider acceptance, email delivery or a client relationship. */
  readonly resolution: "reserved" | "inactive" | null;
}
export interface CoachInvitationActionsSnapshot {
  readonly confirmed: CoachInvitationActionsRead | null;
  readonly pending: "load" | "resend" | "regenerate" | "reconcile" | "retry" | null;
  readonly attempt: CoachInvitationActionsAttempt | null;
  readonly rateLimit: Readonly<{ serverNow: string; retryAt: string }> | null;
  readonly issue: CoachInvitationActionsIssue | null;
  readonly needsRefresh: boolean;
  readonly disposed: boolean;
}
export interface CoachInvitationActionsControllerInput {
  readonly selection: CoachInvitationActionsSelection;
  readonly source: CoachInvitationActionsSource;
  /** Captured owner/session generation/portal/selection; false or throw is permanently stale. */
  readonly isCurrent: () => boolean;
  /** One new id per new admitted action; never invoked by load/reconcile/retry/dispose. */
  readonly createRequestId: () => string;
}
export interface CoachInvitationActionsController {
  getSnapshot(): CoachInvitationActionsSnapshot;
  subscribe(listener: (snapshot: CoachInvitationActionsSnapshot) => void): () => void;
  /** Explicit read; may replace an earlier load, never an unresolved mutation.
   * Successful load releases a resolved/rejected attempt for a new explicit action. */
  load(): Promise<boolean>;
  canResend(): boolean;
  canRegenerate(): boolean;
  /** Explicit reserve only; true requires exact operation binding plus fresh pending state. */
  resend(): Promise<boolean>;
  regenerate(): Promise<boolean>;
  /** Always read the same operation, then fresh invitation; never sends a write. */
  reconcile(): Promise<boolean>;
  /** Same frozen action/id/generation/requestId, after null read or initial validated rate limit. */
  retry(): Promise<boolean>;
  /** Purges/aborts locally and settles pending work even when source ignores abort. No rollback. */
  dispose(): void;
}
