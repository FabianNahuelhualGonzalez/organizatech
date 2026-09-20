export type CoachInvitationAction = "create" | "resend" | "regenerate" | "cancel" | "revoke";
export type CoachInvitationsRpcName =
  | "create_own_coach_invitation"
  | "resend_own_coach_invitation"
  | "regenerate_own_coach_invitation"
  | "cancel_own_coach_invitation"
  | "revoke_own_coach_relationship"
  | "read_own_coach_invitation"
  | "read_own_coach_invitation_operation"
  | "read_own_coach_relationship"
  | "resend_own_coach_invitation_for_generation"
  | "regenerate_own_coach_invitation_for_generation"
  | "read_own_coach_invitation_generation_operation";

export type CoachInvitationsRpcArgs = Readonly<Record<string, string | number>>;

export interface CoachInvitationsIdentity {
  readonly userId: string;
  readonly generation: number;
}

/** Already authenticated/pinned transport supplied by the session boundary.
 * It must not read mutable shared Auth state or retry requests automatically. */
export interface CoachInvitationsPinnedClient {
  rpc(name: CoachInvitationsRpcName, args: CoachInvitationsRpcArgs, signal: AbortSignal):
    PromiseLike<{ readonly data: unknown; readonly error: unknown | null }>;
}

/** Structural slice of an ALREADY PINNED Supabase client; no Auth API is accepted. */
export interface CoachInvitationsSupabaseRpcPort {
  rpc(name: CoachInvitationsRpcName, args: CoachInvitationsRpcArgs, options: { readonly get: false; readonly head: false }): {
    abortSignal(signal: AbortSignal): PromiseLike<{ readonly data: unknown; readonly error: unknown | null }>;
  };
}

export interface CapturedCoachInvitationsOperation {
  readonly identity: CoachInvitationsIdentity;
  readonly client: CoachInvitationsPinnedClient;
  /** Compare BOTH userId and session generation with the live session. */
  readonly isCurrent: (captured: CoachInvitationsIdentity) => boolean;
}

interface OperationBase {
  readonly requestId: string;
  readonly reservedAt: string;
}
export type CoachInvitationOperation = OperationBase & (
  | { readonly action: "create" | "resend" | "regenerate"; readonly state: "reserved" | "cancelled";
      readonly invitationId: string; readonly episodeId: null; readonly generation: number }
  | { readonly action: "cancel"; readonly state: "completed";
      readonly invitationId: string; readonly episodeId: null; readonly generation: number }
  | { readonly action: "revoke"; readonly state: "completed";
      readonly invitationId: null; readonly episodeId: string; readonly generation: null }
);

export type CoachInvitationMutationResult =
  | { readonly status: "recorded"; readonly serverNow: string; readonly operation: CoachInvitationOperation }
  | { readonly status: "rate_limited"; readonly serverNow: string; readonly retryAt: string };

/** A receipt bound to the generation observed when this explicit intent began.
 * Reservation is not email acceptance/delivery or learner consent. */
export interface CoachInvitationGenerationOperation extends OperationBase {
  readonly action: "resend" | "regenerate";
  readonly state: "reserved" | "cancelled";
  readonly invitationId: string;
  readonly expectedGeneration: number;
  readonly generation: number;
}
export type CoachInvitationGenerationMutationResult =
  | { readonly status: "recorded"; readonly serverNow: string; readonly operation: CoachInvitationGenerationOperation }
  | { readonly status: "rate_limited"; readonly serverNow: string; readonly retryAt: string };

interface InvitationBase {
  readonly id: string;
  readonly recipientEmail: string;
  readonly generation: number;
  readonly createdAt: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
export type CoachInvitationDetail = InvitationBase & (
  | { readonly state: "pending"; readonly code: string; readonly cancelledAt: null }
  | { readonly state: "cancelled"; readonly code: null; readonly cancelledAt: string }
  | { readonly state: "expired" | "accepted"; readonly code: null; readonly cancelledAt: null }
);
export interface CoachRelationshipDetail {
  readonly id: string;
  readonly studentName: string;
  readonly studentEmail: string;
  readonly linkedAt: string;
  readonly endedAt: string | null;
}

export interface CoachInvitationCreateInput { readonly recipientEmail: string; readonly requestId: string }
export interface CoachInvitationCommandInput { readonly invitationId: string; readonly requestId: string }
export interface CoachInvitationGenerationCommandInput extends CoachInvitationCommandInput { readonly expectedGeneration: number }
export interface CoachRelationshipRevokeInput { readonly episodeId: string; readonly requestId: string }
export interface CoachInvitationCallOptions { readonly signal?: AbortSignal }

const errorCodes = ["invalid_input", "invalid_response", "forbidden", "not_found", "state_conflict",
  "retry_required", "operation_stale", "aborted", "timeout", "unavailable"] as const;
export type CoachInvitationsErrorCode = typeof errorCodes[number];
export class CoachInvitationsError extends Error {
  readonly code: CoachInvitationsErrorCode;
  constructor(code: CoachInvitationsErrorCode) {
    const safeCode = errorCodes.includes(code) ? code : "unavailable";
    super(`coach-invitations-${safeCode}`);
    this.name = "CoachInvitationsError";
    this.code = safeCode;
  }
}
