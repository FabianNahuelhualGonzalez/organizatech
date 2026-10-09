import type { CoachChatInterest, CoachChatInterestIssue } from "../data/coach-chat-interest-contract";

export interface CoachChatInterestState {
  readonly confirmed: CoachChatInterest | null;
  readonly chatOpen: boolean;
  readonly pending: "read" | "register" | null;
  readonly issue: CoachChatInterestIssue | null;
  readonly needsRefresh: boolean;
}

export interface CoachChatInterestSource {
  read(): Promise<CoachChatInterest>;
  register(): Promise<CoachChatInterest>;
}

const EMPTY: CoachChatInterestState = Object.freeze({
  confirmed: null, chatOpen: false, pending: null, issue: null, needsRefresh: true,
});
const ISSUES: readonly CoachChatInterestIssue[] = [
  "invalid_input", "invalid_response", "forbidden", "operation_stale", "timeout", "unavailable",
];

function issueFrom(error: unknown): CoachChatInterestIssue {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return ISSUES.includes(code as CoachChatInterestIssue) ? code as CoachChatInterestIssue : "unavailable";
}

/** One owner per identity generation; an uncertain registration needs an explicit readback. */
export function createCoachChatInterestController(input: {
  readonly source: CoachChatInterestSource;
  readonly isCurrent: () => boolean;
}) {
  const listeners = new Set<(state: CoachChatInterestState) => void>();
  let state = EMPTY;
  let disposed = false;

  function publish(patch: Partial<CoachChatInterestState>) {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) listener(state);
  }
  function live() { return !disposed && input.isCurrent(); }
  function available() { return live() && state.pending === null; }
  function dispose(issue: CoachChatInterestIssue | null = null) {
    if (disposed) return;
    disposed = true;
    state = issue ? Object.freeze({ ...EMPTY, issue }) : EMPTY;
    for (const listener of listeners) listener(state);
    listeners.clear();
  }
  async function run(action: "read" | "register", perform: () => Promise<CoachChatInterest>): Promise<boolean> {
    if (!available()) return false;
    publish({ pending: action, issue: null });
    let result: CoachChatInterest;
    try {
      if (!live()) return false;
      result = await perform();
    } catch (error) {
      if (!live()) return false;
      const issue = issueFrom(error);
      if (issue === "operation_stale" || issue === "forbidden") {
        dispose(issue);
        return false;
      }
      publish({ pending: null, issue, needsRefresh: true });
      return false;
    }
    if (!live()) return false;
    publish({ confirmed: Object.freeze({ chatInterestRegistered: result.chatInterestRegistered }),
      pending: null, issue: null, needsRefresh: false });
    return true;
  }

  return Object.freeze({
    getSnapshot: () => input.isCurrent() ? state : EMPTY,
    subscribe: (listener: (state: CoachChatInterestState) => void) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: () => run("read", () => input.source.read()),
    openChat: () => {
      if (!available() || !state.confirmed || state.chatOpen) return false;
      publish({ chatOpen: true });
      return true;
    },
    cancelChat: () => {
      if (!available() || !state.chatOpen) return false;
      publish({ chatOpen: false });
      return true;
    },
    registerChatInterest: () => {
      if (!available() || !state.chatOpen || !state.confirmed || state.needsRefresh
        || state.confirmed.chatInterestRegistered) return Promise.resolve(false);
      return run("register", () => input.source.register());
    },
    dispose: () => dispose(),
  });
}
