import type { CoachPreferencesControllerState } from "../hooks/coach-preferences-controller-contract";

/** Partial presentation only: no preview, formatting, validation copy or UI binding. */
export interface CoachPreferencesPresentation {
  readonly feeOpen: boolean;
  readonly feeRaw: string | null;
  readonly busy: boolean;
  readonly chatOpen: boolean;
  readonly isRegistered: boolean | null;
  readonly canSave: boolean;
  readonly canRegister: boolean;
}

/** Pass the current snapshot and its controller.canSaveFee() result together. */
export function projectCoachPreferencesPresentation(
  state: CoachPreferencesControllerState,
  canSaveFee: boolean,
): CoachPreferencesPresentation {
  const feeOpen = state.feeDraft !== null;
  const busy = state.pending !== null;
  const isRegistered = state.confirmed?.chatInterestRegistered ?? null;
  const canWrite = state.confirmed !== null && !state.needsRefresh && !busy;

  return Object.freeze({
    feeOpen,
    feeRaw: state.feeDraft,
    busy,
    chatOpen: state.chatOpen,
    isRegistered,
    canSave: canWrite && feeOpen && canSaveFee,
    canRegister: canWrite && state.chatOpen && isRegistered === false,
  });
}
