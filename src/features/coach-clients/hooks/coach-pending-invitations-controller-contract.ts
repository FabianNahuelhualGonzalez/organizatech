/** Position in DESC(createdAt, id), not an authorization token or frozen portfolio. */
export interface CoachPendingInvitationsCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface CoachPendingInvitationsQuery {
  readonly query: string;
  readonly limit: number;
  readonly cursor: CoachPendingInvitationsCursor | null;
}

export interface CoachPendingInvitationsItem extends CoachPendingInvitationsCursor {
  readonly recipientEmail: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: "pending" | "expired";
}

/** Counts/time describe this server call only, not all previously accumulated rows. */
export interface CoachPendingInvitationsPage {
  readonly serverNow: string;
  readonly totalPending: number;
  readonly matchingCount: number;
  readonly items: readonly CoachPendingInvitationsItem[];
  readonly nextCursor: CoachPendingInvitationsCursor | null;
}

/** Validated source: canonical UUIDs, strict ISO timestamps (microseconds/offsets), DTOs and query binding. */
export interface CoachPendingInvitationsSource {
  list(query: CoachPendingInvitationsQuery, options: { readonly signal: AbortSignal }): Promise<CoachPendingInvitationsPage>;
}

export type CoachPendingInvitationsIssue = "invalid_input" | "invalid_response" | "forbidden"
  | "operation_stale" | "aborted" | "timeout" | "unavailable";

export interface CoachPendingInvitationsSnapshot {
  /** Exact caller text, including an invalid string awaiting correction; never Unicode-normalized here. */
  readonly query: string;
  readonly pageSize: number;
  readonly phase: "idle" | "loading" | "loading-next" | "ready" | "error" | "disposed";
  readonly items: readonly CoachPendingInvitationsItem[];
  readonly serverNow: string | null;
  readonly totalPending: number | null;
  readonly matchingCount: number | null;
  readonly nextCursor: CoachPendingInvitationsCursor | null;
  readonly issue: CoachPendingInvitationsIssue | null;
}

export interface CoachPendingInvitationsControllerInput {
  readonly source: CoachPendingInvitationsSource;
  /** Bound to captured owner/generation/context. False observed permanently invalidates this instance. */
  readonly isCurrent: () => boolean;
  /** Integer 1..50; default 25. Invalid explicit configuration throws RangeError("invalid_input") before I/O. */
  readonly pageSize?: number;
}

export interface CoachPendingInvitationsController {
  getSnapshot(): CoachPendingInvitationsSnapshot;
  subscribe(listener: (snapshot: CoachPendingInvitationsSnapshot) => void): () => void;
  /** Reset raw query/cursor and cancel older work; no automatic request. False means invalid input. */
  setQuery(raw: string): boolean;
  /** First page; false if another request is active. */
  load(): Promise<boolean>;
  /** Replace any active request and load the first page, preserving same-query prior rows while loading. */
  reload(): Promise<boolean>;
  canLoadNext(): boolean;
  /** Failure preserves rows and cursor for a later explicit call. */
  loadNext(): Promise<boolean>;
  /** Cancel and purge server facts without fetching or reviving a disposed instance. */
  invalidate(): boolean;
  /** Clear data and settle cancelled public Promises even if the source ignores abort. */
  dispose(): void;
}
