/** Consumer-owned port: integration supplies the validated, bounded data repository. */
export interface CoachPreferencesSource {
  read(): Promise<CoachPreferencesSnapshot>;
  saveFee(input: { readonly monthlyFeeClp: number; readonly expectedVersion: number }): Promise<{
    readonly monthlyFeeClp: number;
    readonly version: number;
  }>;
  registerChatInterest(): Promise<{ readonly chatInterestRegistered: true }>;
}

export interface CoachPreferencesSnapshot {
  readonly monthlyFeeClp: number | null;
  readonly version: number;
  readonly chatInterestRegistered: boolean;
}

export type CoachPreferencesAction = "read" | "save-fee" | "register-chat";
export type CoachPreferencesIssue = "invalid_input" | "invalid_response" | "forbidden"
  | "version_conflict" | "operation_stale" | "timeout" | "unavailable";

export interface CoachPreferencesControllerState {
  readonly confirmed: CoachPreferencesSnapshot | null;
  /** null = sheet closed; empty string = open with no fee configured. */
  readonly feeDraft: string | null;
  readonly chatOpen: boolean;
  readonly pending: CoachPreferencesAction | null;
  readonly issue: CoachPreferencesIssue | null;
  /** A failed/uncertain operation must be reconciled by a successful read before another write. */
  readonly needsRefresh: boolean;
}

export interface CoachPreferencesController {
  getSnapshot(): CoachPreferencesControllerState;
  subscribe(listener: (state: CoachPreferencesControllerState) => void): () => void;
  load(): Promise<boolean>;
  openFee(): boolean;
  editFee(raw: string): boolean;
  cancelFee(): boolean;
  canSaveFee(): boolean;
  saveFee(): Promise<boolean>;
  openChat(): boolean;
  cancelChat(): boolean;
  registerChatInterest(): Promise<boolean>;
  /** Mandatory on unmount or account/portal/generation replacement. Not a logout. */
  dispose(): void;
}
