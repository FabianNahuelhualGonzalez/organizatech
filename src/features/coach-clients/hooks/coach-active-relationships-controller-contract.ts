/** Position in DESC(linkedAt, id); never an authorization token or student id. */
export interface CoachActiveRelationshipsCursor {
  readonly linkedAt: string;
  readonly id: string;
}
export interface CoachActiveRelationshipsQuery {
  readonly query: string;
  readonly limit: number;
  readonly cursor: CoachActiveRelationshipsCursor | null;
}
/** Only the active episode's consented identity snapshots; no activity or profile lookup. */
export interface CoachActiveRelationshipsItem extends CoachActiveRelationshipsCursor {
  readonly studentName: string;
  readonly studentEmail: string;
}
export interface CoachActiveRelationshipsPage {
  readonly serverNow: string;
  readonly totalActive: number;
  readonly matchingCount: number;
  readonly items: readonly CoachActiveRelationshipsItem[];
  readonly nextCursor: CoachActiveRelationshipsCursor | null;
}
/** Validated repository output: canonical UUIDs, finite ISO microsecond timestamps and query-bound DTO. */
export interface CoachActiveRelationshipsSource {
  list(query: CoachActiveRelationshipsQuery, options: { readonly signal: AbortSignal }): Promise<CoachActiveRelationshipsPage>;
}
export type CoachActiveRelationshipsIssue = "invalid_input" | "invalid_response" | "forbidden"
  | "operation_stale" | "aborted" | "timeout" | "unavailable";
export interface CoachActiveRelationshipsSnapshot {
  /** Exact bounded caller text; invalid strings remain available for correction. */
  readonly query: string;
  readonly pageSize: number;
  readonly phase: "idle" | "loading" | "loading-next" | "ready" | "error" | "disposed";
  readonly items: readonly CoachActiveRelationshipsItem[];
  /** Metadata describes the latest successful call, not all accumulated rows. */
  readonly serverNow: string | null;
  readonly totalActive: number | null;
  readonly matchingCount: number | null;
  readonly nextCursor: CoachActiveRelationshipsCursor | null;
  readonly issue: CoachActiveRelationshipsIssue | null;
}
export interface CoachActiveRelationshipsControllerInput {
  readonly source: CoachActiveRelationshipsSource;
  /** Bound to captured owner/generation/context. Any observed false permanently invalidates this instance. */
  readonly isCurrent: () => boolean;
  /** Integer 1..50; omitted means 25. Invalid explicit value throws RangeError("invalid_input") before I/O. */
  readonly pageSize?: number;
}
export interface CoachActiveRelationshipsController {
  getSnapshot(): CoachActiveRelationshipsSnapshot;
  subscribe(listener: (snapshot: CoachActiveRelationshipsSnapshot) => void): () => void;
  /** Cancel/reset without fetching, including the same raw string. False for invalid input. */
  setQuery(raw: string): boolean;
  /** Explicit first page; false if another request is active. */
  load(): Promise<boolean>;
  /** Replace active work; prior same-query rows remain while loading/error, but old cursor is discarded. */
  reload(): Promise<boolean>;
  canLoadNext(): boolean;
  /** Error preserves rows/cursor for another explicit call, never an automatic retry. */
  loadNext(): Promise<boolean>;
  /** Cancel and purge facts without fetching, preserving raw query if still current. */
  invalidate(): boolean;
  /** Permanently purge; cancelled public Promises settle even if source ignores abort. */
  dispose(): void;
}
