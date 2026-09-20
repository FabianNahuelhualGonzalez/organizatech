import type {
  CoachPreferencesAction,
  CoachPreferencesController,
  CoachPreferencesControllerState,
  CoachPreferencesIssue,
  CoachPreferencesSnapshot,
  CoachPreferencesSource,
} from "./coach-preferences-controller-contract";

const EMPTY: CoachPreferencesControllerState = Object.freeze({
  confirmed: null, feeDraft: null, chatOpen: false, pending: null, issue: null, needsRefresh: true,
});
const ISSUES: readonly CoachPreferencesIssue[] = [
  "invalid_input", "invalid_response", "forbidden", "version_conflict",
  "operation_stale", "timeout", "unavailable",
];

function issueFrom(error: unknown): CoachPreferencesIssue {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return ISSUES.includes(code as CoachPreferencesIssue) ? code as CoachPreferencesIssue : "unavailable";
}

function snapshotOf(value: CoachPreferencesSnapshot): CoachPreferencesSnapshot {
  return Object.freeze({ monthlyFeeClp: value.monthlyFeeClp, version: value.version,
    chatInterestRegistered: value.chatInterestRegistered });
}

/** One controller per identity generation; no Auth, React, storage, money rules or UI copy. */
export function createCoachPreferencesController(input: {
  readonly source: CoachPreferencesSource;
  /** Must remain false after the captured account/portal/generation ceases to be current. */
  readonly isCurrent: () => boolean;
  /** Domain parser owns syntax; null means incomplete/invalid, never a default zero. */
  readonly parseFee: (raw: string) => number | null;
}): CoachPreferencesController {
  const { source, isCurrent, parseFee } = input;
  const listeners = new Set<(state: CoachPreferencesControllerState) => void>();
  let state = EMPTY;
  let disposed = false;

  function publish(patch: Partial<CoachPreferencesControllerState>) {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener(state);
  }

  function live() { return !disposed && isCurrent(); }
  function available() { return live() && state.pending === null; }

  function dispose(issue: CoachPreferencesIssue | null = null) {
    if (disposed) return;
    disposed = true;
    state = issue ? Object.freeze({ ...EMPTY, issue }) : EMPTY;
    for (const listener of listeners) listener(state);
    listeners.clear();
  }

  function feeValue(): number | null {
    if (state.feeDraft === null || !state.feeDraft.trim()) return null;
    const value = parseFee(state.feeDraft);
    return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function canWrite() { return available() && state.confirmed !== null && !state.needsRefresh; }
  function canSaveFee() {
    return canWrite() && state.confirmed!.version < Number.MAX_SAFE_INTEGER && feeValue() !== null;
  }

  async function run<T>(action: CoachPreferencesAction, perform: () => Promise<T>,
    accept: (result: T) => Partial<CoachPreferencesControllerState>): Promise<boolean> {
    if (!available()) return false;
    publish({ pending: action, issue: null });
    let result: T;
    try {
      // Publishing may synchronously invalidate the owner. Recheck before dispatch.
      if (!live()) return false;
      result = await perform();
    } catch (error) {
      if (!live()) return false;
      const issue = issueFrom(error);
      if (issue === "operation_stale" || issue === "forbidden") {
        dispose(issue);
        return false;
      }
      // No retry here. Preserve the draft and confirmed data until explicit reconciliation.
      publish({ pending: null, issue, needsRefresh: true });
      return false;
    }
    if (!live()) return false;
    // Publish outside the transport catch: a subscriber error is not a server failure.
    publish({ ...accept(result), pending: null, issue: null });
    return true;
  }

  return {
    getSnapshot: () => isCurrent() ? state : EMPTY,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: () => run("read", () => source.read(), (result) => ({
      confirmed: snapshotOf(result), needsRefresh: false,
    })),
    openFee: () => {
      if (!available() || !state.confirmed || state.chatOpen || state.feeDraft !== null) return false;
      publish({ feeDraft: state.confirmed.monthlyFeeClp === null ? "" : String(state.confirmed.monthlyFeeClp) });
      return true;
    },
    editFee: (raw) => {
      if (!available() || state.feeDraft === null) return false;
      publish({ feeDraft: raw });
      return true;
    },
    cancelFee: () => {
      if (!available() || state.feeDraft === null) return false;
      publish({ feeDraft: null });
      return true;
    },
    canSaveFee,
    saveFee: () => {
      if (!canWrite() || !state.confirmed || state.confirmed.version === Number.MAX_SAFE_INTEGER) return Promise.resolve(false);
      const monthlyFeeClp = feeValue();
      if (monthlyFeeClp === null) return Promise.resolve(false);
      const expectedVersion = state.confirmed.version;
      return run("save-fee", () => source.saveFee({ monthlyFeeClp, expectedVersion }), (fee) => ({
        confirmed: snapshotOf({ ...state.confirmed!, ...fee }), feeDraft: null, needsRefresh: false,
      }));
    },
    openChat: () => {
      if (!available() || !state.confirmed || state.feeDraft !== null || state.chatOpen) return false;
      publish({ chatOpen: true });
      return true;
    },
    cancelChat: () => {
      if (!available() || !state.chatOpen) return false;
      publish({ chatOpen: false });
      return true;
    },
    registerChatInterest: () => {
      if (!canWrite() || !state.chatOpen || state.confirmed!.chatInterestRegistered) return Promise.resolve(false);
      return run("register-chat", () => source.registerChatInterest(), () => ({
        confirmed: snapshotOf({ ...state.confirmed!, chatInterestRegistered: true }), needsRefresh: false,
      }));
    },
    dispose: () => dispose(),
  };
}
