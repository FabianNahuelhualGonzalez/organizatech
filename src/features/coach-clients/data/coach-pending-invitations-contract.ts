import type { CoachInvitationsIdentity } from "./coach-invitations-contract";

/** Cursor is a position, not an authorization token or a frozen portfolio. */
export interface CoachPendingInvitationsCursor {
  readonly createdAt: string;
  readonly id: string;
}
export interface CoachPendingInvitationsQuery {
  readonly query: string;
  readonly limit: number;
  readonly cursor: CoachPendingInvitationsCursor | null;
}
export interface CoachPendingInvitationRow extends CoachPendingInvitationsCursor {
  readonly recipientEmail: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: "pending" | "expired";
}
export interface CoachPendingInvitationsPage {
  readonly serverNow: string;
  /** All own unaccepted, uncancelled invitations, including expired invitations. */
  readonly totalPending: number;
  /** Matches before applying the cursor or page size. */
  readonly matchingCount: number;
  readonly items: readonly CoachPendingInvitationRow[];
  readonly nextCursor: CoachPendingInvitationsCursor | null;
}
export type CoachPendingInvitationsRpcName = "list_own_pending_coach_invitations";
export interface CoachPendingInvitationsParameters {
  readonly p_query: string;
  readonly p_limit: number;
  readonly p_cursor_created_at: string | null;
  readonly p_cursor_id: string | null;
}
export interface CoachPendingInvitationsPinnedClient {
  rpc(name: CoachPendingInvitationsRpcName, args: CoachPendingInvitationsParameters, signal: AbortSignal):
    PromiseLike<{ readonly data: unknown; readonly error: unknown | null }>;
}
export interface CapturedCoachPendingInvitationsOperation {
  readonly identity: CoachInvitationsIdentity;
  readonly client: CoachPendingInvitationsPinnedClient;
  readonly isCurrent: (identity: CoachInvitationsIdentity) => boolean;
}
