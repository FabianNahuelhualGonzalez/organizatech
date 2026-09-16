export interface CoachDashboardPreferences {
  readonly monthlyFeeClp: number | null;
  readonly version: number;
  readonly chatInterestRegistered: boolean;
}

export interface CoachDashboardFee {
  readonly monthlyFeeClp: number;
  readonly version: number;
}

export type CoachPreferencesRpcName =
  | "read_own_coach_dashboard_preferences"
  | "save_own_coach_dashboard_fee"
  | "register_own_coach_chat_interest";

/** The adapter must use the captured access token, never mutable shared Auth state. */
export interface CoachPreferencesPinnedClient {
  rpc(
    name: CoachPreferencesRpcName,
    args: Readonly<Record<string, number>>,
    signal: AbortSignal,
  ): PromiseLike<{ readonly data: unknown; readonly error: { readonly code?: string } | null }>;
}

export interface CoachPreferencesOperation {
  readonly client: CoachPreferencesPinnedClient;
  readonly isCurrent: () => boolean;
}

export type CoachPreferencesErrorCode =
  | "invalid_input"
  | "invalid_response"
  | "forbidden"
  | "version_conflict"
  | "operation_stale"
  | "timeout"
  | "unavailable";

export class CoachPreferencesError extends Error {
  constructor(readonly code: CoachPreferencesErrorCode) {
    // Never forward Postgres/network messages, which may contain request data.
    super(`coach-preferences-${code}`);
    this.name = "CoachPreferencesError";
  }
}
