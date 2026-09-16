/** Minimal operation projection after repository validation. Reserved is not an email receipt. */
export interface CoachInvitationCreationOperation {
  readonly requestId: string;
  readonly action: "create";
  readonly state: "reserved" | "cancelled";
  readonly invitationId: string;
  readonly generation: number;
  readonly reservedAt: string;
}
/** No code, dates, profile lookup, delivery or activity fields are needed by this consumer. */
export interface CoachInvitationCreationRead {
  readonly id: string;
  readonly recipientEmail: string;
  readonly generation: number;
  readonly state: "pending" | "expired" | "cancelled" | "accepted";
}
export interface CoachInvitationCreationCommand {
  readonly recipientEmail: string;
  readonly requestId: string;
}
export type CoachInvitationCreationResult =
  | Readonly<{ status: "recorded"; serverNow: string; operation: CoachInvitationCreationOperation }>
  | Readonly<{ status: "rate_limited"; serverNow: string; retryAt: string }>;
export interface CoachInvitationCreationCallOptions { readonly signal?: AbortSignal }
/** Validated repository; MAIN owns Auth, UUIDs, full DTO/clock validation and total deadlines. */
export interface CoachInvitationCreationSource {
  create(command: CoachInvitationCreationCommand, options?: CoachInvitationCreationCallOptions): Promise<CoachInvitationCreationResult>;
  readOperation(requestId: string, options?: CoachInvitationCreationCallOptions): Promise<CoachInvitationCreationOperation | null>;
  readInvitation(invitationId: string, options?: CoachInvitationCreationCallOptions): Promise<CoachInvitationCreationRead>;
}
export type CoachInvitationCreationIssue = "invalid_input" | "invalid_request_id" | "draft_changed"
  | "invalid_response" | "forbidden" | "not_found" | "state_conflict" | "request_conflict"
  | "retry_required" | "operation_stale" | "aborted" | "timeout" | "unavailable";
export interface CoachInvitationCreationAttempt {
  readonly requestId: string;
  /** Canonical email frozen at submit; later draft edits never change this intent. */
  readonly recipientEmail: string;
  readonly phase: "in-flight" | "uncertain" | "recorded" | "resolved" | "rejected" | "rate-limited";
  readonly operation: CoachInvitationCreationOperation | null;
  readonly retryAllowed: boolean;
  /** Technical reservation resolution, never client relationship state or provider delivery. */
  readonly resolution: "reserved" | "inactive" | null;
}
export interface CoachInvitationCreationSnapshot {
  readonly isOpen: boolean;
  readonly emailRaw: string;
  /** Format readiness only, not uniqueness, an account lookup or authorization. */
  readonly emailValid: boolean;
  readonly pending: "submit" | "reconcile" | "retry" | null;
  readonly attempt: CoachInvitationCreationAttempt | null;
  readonly confirmed: CoachInvitationCreationRead | null;
  readonly rateLimit: Readonly<{ serverNow: string; retryAt: string }> | null;
  readonly issue: CoachInvitationCreationIssue | null;
  readonly needsRefresh: boolean;
  readonly disposed: boolean;
}
export interface CoachInvitationCreationControllerInput {
  readonly source: CoachInvitationCreationSource;
  /** Captured owner/generation/portal; observed false/throw permanently purges this instance. */
  readonly isCurrent: () => boolean;
  /** One invocation per new attempt; MAIN validates canonical UUIDs. Never called by retry/reconcile. */
  readonly createRequestId: () => string;
  /** Captured synchronous, I/O-free adapter of the existing normalizeRecipientEmail; throws on invalid input. */
  readonly prepareRecipientEmail: (raw: string) => string;
}
export interface CoachInvitationCreationController {
  getSnapshot(): CoachInvitationCreationSnapshot;
  subscribe(listener: (snapshot: CoachInvitationCreationSnapshot) => void): () => void;
  open(): boolean;
  /** Before initial dispatch cancels it; afterwards closes locally without aborting/discarding tracking. */
  close(): boolean;
  /** Preserve exact raw text; false for invalid format. Never replaces an already dispatched intent. */
  setEmail(raw: string): boolean;
  canSubmit(): boolean;
  /** Initial explicit reservation only. True requires matching create/reserved plus fresh pending detail. */
  submit(): Promise<boolean>;
  /** Always rereads operation, even when known; then reads current detail. No write or new requestId. */
  reconcile(): Promise<boolean>;
  /** Same immutable command only: after null operation read, or an initial authoritative rate limit. */
  retry(): Promise<boolean>;
  /** Permanent local purge/abort; settles public work even if source ignores abort. Not remote rollback. */
  dispose(): void;
}
