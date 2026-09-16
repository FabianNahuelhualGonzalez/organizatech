import type { CoachClientDisconnectionAttempt, CoachClientDisconnectionController,
  CoachClientDisconnectionControllerInput, CoachClientDisconnectionIssue,
  CoachClientDisconnectionReceipt, CoachClientDisconnectionSnapshot } from "./coach-client-disconnection-contract";
import { copyDisconnectionRead, copyDisconnectionReceipt, copyDisconnectionSelection, disconnectionIssue,
  disconnectionOpaqueId, isDisconnectable, isDisconnected } from "./coach-client-disconnection-reconciliation";

const EMPTY: CoachClientDisconnectionSnapshot = Object.freeze({ confirmed: null, confirmationOpen: false,
  pending: null, attempt: null, issue: null, needsRefresh: true, disposed: false });
const UNCERTAIN: readonly CoachClientDisconnectionIssue[] = ["invalid_response", "aborted", "timeout", "unavailable"];

function unresolved(attempt: CoachClientDisconnectionAttempt | null): boolean {
  return attempt !== null && attempt.phase !== "resolved" && attempt.phase !== "rejected";
}

/** Pure controller for one explicitly captured target, never a student lookup or universal store. */
export function createCoachClientDisconnectionController(input: CoachClientDisconnectionControllerInput): CoachClientDisconnectionController {
  const { source, isCurrent, createRequestId } = input;
  const selection = copyDisconnectionSelection(input.selection);
  const listeners = new Set<(snapshot: CoachClientDisconnectionSnapshot) => void>();
  const usedRequestIds = new Set<string>();
  let state = EMPTY;
  let active: AbortController | null = null;

  function dispose(issue: CoachClientDisconnectionIssue | null = null) {
    if (state.disposed) return;
    const abort = active;
    active = null;
    usedRequestIds.clear();
    state = Object.freeze({ ...EMPTY, disposed: true, issue });
    const subscribers = [...listeners];
    listeners.clear();
    try { abort?.abort(); } catch { /* Local cleanup must still finish. */ }
    for (const listener of subscribers) { try { listener(state); } catch { /* Listener errors are not transport results. */ } }
  }

  function live(): boolean {
    if (state.disposed) return false;
    let current = false;
    try { current = isCurrent() === true; } catch { /* Fail closed and latch permanently. */ }
    if (!current) dispose("operation_stale");
    return current && !state.disposed;
  }

  function publish(patch: Partial<CoachClientDisconnectionSnapshot>): boolean {
    if (!live()) return false;
    const snapshot = Object.freeze({ ...state, ...patch });
    state = snapshot;
    for (const listener of [...listeners]) {
      if (!live() || state !== snapshot) break;
      try { listener(snapshot); } catch { /* A subscriber cannot turn success into uncertainty. */ }
    }
    return live();
  }

  function current(operation: AbortController): boolean { return live() && active === operation; }
  function available(): boolean { return live() && state.pending === null; }
  function begin(pending: NonNullable<CoachClientDisconnectionSnapshot["pending"]>): AbortController | null {
    if (!available()) return null;
    const operation = new AbortController();
    active = operation;
    publish({ pending, issue: null });
    return current(operation) ? operation : null;
  }
  function finish(operation: AbortController, patch: Partial<CoachClientDisconnectionSnapshot>) {
    if (!current(operation)) return;
    active = null;
    publish({ ...patch, pending: null });
  }
  function updateAttempt(attempt: CoachClientDisconnectionAttempt, patch: Partial<CoachClientDisconnectionAttempt>): CoachClientDisconnectionAttempt {
    return Object.freeze({ ...attempt, ...patch });
  }

  async function readCurrent(operation: AbortController, requireDisconnected = false): Promise<boolean> {
    if (!current(operation) || !selection) return false;
    let value;
    try { value = await source.readSelection(selection, { signal: operation.signal }); }
    catch (error) {
      if (!current(operation)) return false;
      const issue = disconnectionIssue(error);
      if (issue === "forbidden" || issue === "operation_stale") dispose(issue);
      else publish({ issue, needsRefresh: true });
      return false;
    }
    if (!current(operation)) return false;
    const confirmed = copyDisconnectionRead(value, selection);
    if (!current(operation)) return false;
    if (!confirmed || (requireDisconnected && !isDisconnected(confirmed))) {
      publish({ issue: "invalid_response", needsRefresh: true });
      return false;
    }
    return publish({ confirmed, needsRefresh: false }) && current(operation);
  }

  async function complete(operation: AbortController, attempt: CoachClientDisconnectionAttempt,
    receipt: CoachClientDisconnectionReceipt): Promise<boolean> {
    if (!current(operation)) return false;
    const recorded = updateAttempt(attempt, { phase: "recorded", receipt, retryAllowed: false });
    publish({ attempt: recorded, needsRefresh: true });
    if (!current(operation)) return false;
    if (!await readCurrent(operation, true)) { finish(operation, {}); return false; }
    finish(operation, { attempt: updateAttempt(recorded, { phase: "resolved" }), confirmationOpen: false, issue: null });
    return live();
  }

  async function dispatch(operation: AbortController, attempt: CoachClientDisconnectionAttempt, retrying: boolean): Promise<boolean> {
    if (!current(operation)) return false;
    let value;
    try { value = await source.disconnect(attempt.selection, attempt.requestId, { signal: operation.signal }); }
    catch (error) {
      if (!current(operation)) return false;
      const issue = disconnectionIssue(error);
      if (issue === "forbidden" || issue === "operation_stale") { dispose(issue); return false; }
      // A retry rejection cannot prove the first uncertain dispatch did not complete.
      if (retrying || UNCERTAIN.includes(issue)) {
        finish(operation, { attempt: updateAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue, needsRefresh: true });
      } else {
        publish({ attempt: updateAttempt(attempt, { phase: "rejected", retryAllowed: false }), issue, needsRefresh: true });
        if (issue === "state_conflict") await readCurrent(operation);
        finish(operation, {});
      }
      return false;
    }
    if (!current(operation)) return false;
    const receipt = copyDisconnectionReceipt(value, attempt.selection, attempt.requestId);
    if (!current(operation)) return false;
    if (!receipt) {
      finish(operation, { attempt: updateAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue: "invalid_response", needsRefresh: true });
      return false;
    }
    return complete(operation, attempt, receipt);
  }

  function canConfirm(): boolean {
    return available() && !unresolved(state.attempt) && !state.needsRefresh && state.confirmationOpen
      && state.confirmed !== null && isDisconnectable(state.confirmed);
  }

  if (!selection) dispose("invalid_selection");

  return Object.freeze<CoachClientDisconnectionController>({
    getSnapshot: () => { live(); return state; },
    subscribe: (listener) => {
      if (!live()) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: async () => {
      const operation = begin("load");
      if (!operation) return false;
      const loaded = await readCurrent(operation);
      finish(operation, loaded ? { issue: null } : {});
      return loaded && live();
    },
    openConfirmation: () => {
      if (!available() || unresolved(state.attempt) || state.needsRefresh || state.confirmationOpen
        || !state.confirmed || !isDisconnectable(state.confirmed)) return false;
      return publish({ confirmationOpen: true, issue: null });
    },
    cancelConfirmation: () => live() && state.confirmationOpen ? publish({ confirmationOpen: false }) : false,
    canConfirm,
    confirm: async () => {
      if (!canConfirm() || !selection) return false;
      const confirmed = state.confirmed;
      const operation = begin("confirm");
      if (!operation) return false;
      if (!state.confirmationOpen || state.confirmed !== confirmed) {
        finish(operation, { issue: "confirmation_changed" }); return false;
      }
      let requestId: string;
      try { requestId = createRequestId(); } catch { finish(operation, { issue: "invalid_request_id" }); return false; }
      if (!current(operation)) return false;
      if (!disconnectionOpaqueId(requestId) || usedRequestIds.has(requestId)) {
        finish(operation, { issue: "invalid_request_id" }); return false;
      }
      usedRequestIds.add(requestId);
      const attempt: CoachClientDisconnectionAttempt = Object.freeze({ selection, requestId,
        phase: "in-flight", receipt: null, retryAllowed: false });
      const previous = state.attempt;
      publish({ attempt });
      if (!current(operation)) return false;
      if (!state.confirmationOpen || state.confirmed !== confirmed) {
        finish(operation, { attempt: previous, issue: "confirmation_changed" }); return false;
      }
      return dispatch(operation, attempt, false);
    },
    reconcile: async () => {
      if (!available() || !unresolved(state.attempt)) return false;
      const attempt = state.attempt!;
      const operation = begin("reconcile");
      if (!operation) return false;
      if (attempt.receipt) return complete(operation, attempt, attempt.receipt);
      let value;
      try { value = await source.readOwnOperation(attempt.requestId, { signal: operation.signal }); }
      catch (error) {
        if (!current(operation)) return false;
        const issue = disconnectionIssue(error);
        if (issue === "forbidden" || issue === "operation_stale") dispose(issue);
        else finish(operation, { attempt: updateAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue, needsRefresh: true });
        return false;
      }
      if (!current(operation)) return false;
      if (value === null) {
        finish(operation, { attempt: updateAttempt(attempt, { phase: "uncertain", retryAllowed: true }), issue: null, needsRefresh: true });
        return false;
      }
      const receipt = copyDisconnectionReceipt(value, attempt.selection, attempt.requestId);
      if (!current(operation)) return false;
      if (!receipt) {
        finish(operation, { attempt: updateAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue: "invalid_response", needsRefresh: true });
        return false;
      }
      return complete(operation, attempt, receipt);
    },
    retry: async () => {
      if (!available() || state.attempt?.phase !== "uncertain" || !state.attempt.retryAllowed) return false;
      const attempt = updateAttempt(state.attempt, { phase: "in-flight", retryAllowed: false });
      const operation = begin("retry");
      if (!operation) return false;
      publish({ attempt });
      if (!current(operation)) return false;
      return dispatch(operation, attempt, true);
    },
    dispose: () => dispose(),
  });
}
