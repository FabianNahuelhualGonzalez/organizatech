import type { CoachInvitationsIdentity } from "./coach-invitations-contract";

/** Cursor is a position, not an authorization token or a frozen portfolio. */
export interface CoachActiveRelationshipsCursor {
  readonly linkedAt: string;
  readonly id: string;
}
export interface CoachActiveRelationshipsQuery {
  readonly query: string;
  readonly limit: number;
  readonly cursor: CoachActiveRelationshipsCursor | null;
}
export interface CoachActiveRelationshipRow extends CoachActiveRelationshipsCursor {
  /** Consented episode snapshots, not a global profile/email lookup. */
  readonly studentName: string;
  readonly studentEmail: string;
}
export interface CoachActiveRelationshipsPage {
  readonly serverNow: string;
  /** All own relationship episodes that have not ended. */
  readonly totalActive: number;
  /** Matches before applying the cursor or page size. */
  readonly matchingCount: number;
  readonly items: readonly CoachActiveRelationshipRow[];
  readonly nextCursor: CoachActiveRelationshipsCursor | null;
}
export type CoachActiveRelationshipsRpcName = "list_own_active_coach_relationships";
export interface CoachActiveRelationshipsParameters {
  readonly p_query: string;
  readonly p_limit: number;
  readonly p_cursor_linked_at: string | null;
  readonly p_cursor_id: string | null;
}
export interface CoachActiveRelationshipsPinnedClient {
  rpc(name: CoachActiveRelationshipsRpcName, args: CoachActiveRelationshipsParameters, signal: AbortSignal):
    PromiseLike<{ readonly data: unknown; readonly error: unknown | null }>;
}
export interface CapturedCoachActiveRelationshipsOperation {
  readonly identity: CoachInvitationsIdentity;
  readonly client: CoachActiveRelationshipsPinnedClient;
  readonly isCurrent: (identity: CoachInvitationsIdentity) => boolean;
}
