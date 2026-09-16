import type {
  CapturedCoachInvitationsOperation,
  CoachInvitationCallOptions,
  CoachInvitationsPinnedClient,
  CoachInvitationsSupabaseRpcPort,
} from "./coach-invitations-contract";

export type CoachPaidPeriodsRpcName = "confirm_own_coach_paid_period" | "correct_own_coach_paid_period"
  | "read_own_coach_paid_period" | "read_own_coach_paid_period_operation";
export type CoachPaidPeriodAction = "confirm" | "correct";

/** Same captured identity/generation protocol; a separate four-RPC allowlist. */
export type CapturedCoachPaidPeriodsOperation = Omit<CapturedCoachInvitationsOperation, "client"> & {
  readonly client: CoachPaidPeriodsPinnedClient;
};
export interface CoachPaidPeriodsPinnedClient {
  rpc(name: CoachPaidPeriodsRpcName, args: Readonly<Record<string, string>>,
    signal: AbortSignal): ReturnType<CoachInvitationsPinnedClient["rpc"]>;
}
/** An existing pinned RPC-only port, never an Auth client/constructor. */
export interface CoachPaidPeriodsSupabaseRpcPort {
  rpc(name: CoachPaidPeriodsRpcName, args: Readonly<Record<string, string>>,
    options: Parameters<CoachInvitationsSupabaseRpcPort["rpc"]>[2]): ReturnType<CoachInvitationsSupabaseRpcPort["rpc"]>;
}
export type CoachPaidPeriodCallOptions = CoachInvitationCallOptions;

export const COACH_PAID_PERIOD_INITIAL_VERSION = "00000000-0000-0000-0000-000000000000";
export interface CoachPaidPeriod {
  readonly id: string;
  readonly linkEpisodeId: string;
  readonly start: string;
  readonly end: string;
}
export type CoachPaidPeriodReadResult = {
  readonly linkEpisodeId: string;
} & (
  | { readonly version: typeof COACH_PAID_PERIOD_INITIAL_VERSION; readonly period: null }
  | { readonly version: string; readonly period: CoachPaidPeriod }
);
export interface CoachPaidPeriodReceipt<A extends CoachPaidPeriodAction = CoachPaidPeriodAction> {
  readonly requestId: string;
  readonly action: A;
  readonly period: CoachPaidPeriod;
  readonly version: string;
  readonly recordedAt: string;
}
export interface CoachPaidPeriodWriteResult<A extends CoachPaidPeriodAction = CoachPaidPeriodAction> {
  readonly status: "recorded";
  readonly operation: CoachPaidPeriodReceipt<A>;
}
export interface CoachPaidPeriodConfirmInput {
  readonly episodeId: string;
  readonly start: string;
  readonly end: string;
  readonly expectedVersion: string;
  readonly requestId: string;
}
export interface CoachPaidPeriodCorrectInput extends CoachPaidPeriodConfirmInput { readonly periodId: string }

const codes = ["invalid_input", "invalid_response", "forbidden", "not_found", "inactive_relationship",
  "request_conflict", "version_conflict", "conflict", "operation_stale", "aborted", "timeout", "unavailable"] as const;
export type CoachPaidPeriodsErrorCode = typeof codes[number];
/** Technical identifiers only; never copy server/form messages into visible UI. */
export class CoachPaidPeriodsError extends Error {
  readonly code: CoachPaidPeriodsErrorCode;
  constructor(code: CoachPaidPeriodsErrorCode) {
    const safe = codes.includes(code) ? code : "unavailable";
    super(`coach-paid-periods-${safe}`);
    this.name = "CoachPaidPeriodsError";
    this.code = safe;
  }
}
