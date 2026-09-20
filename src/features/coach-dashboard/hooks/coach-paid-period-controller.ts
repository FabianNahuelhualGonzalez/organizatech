import {
  acceptCoachRenewalDraftDates, cancelCoachRenewalDraft, cancelCoachRenewalDraftDates,
  editCoachRenewalDraftDates, openCoachRenewalDraftDates, openCoachRenewalPeriodDraft,
  prepareCoachRenewalPeriodCommand, selectCoachRenewalDraftState,
  type CoachRenewalDraft,
} from "../model/coach-renewal-draft";
import type {
  CoachPaidPeriodAttempt, CoachPaidPeriodController, CoachPaidPeriodControllerInput,
  CoachPaidPeriodControllerIssue, CoachPaidPeriodControllerSnapshot, CoachPaidPeriodOperationReceipt,
} from "./coach-paid-period-controller-contract";
import { copyCoachPaidPeriodRead, copyMatchingCoachPaidPeriodReceipt,
  matchesCoachPaidPeriodBaseline, paidOpaqueId } from "./coach-paid-period-reconciliation";

const EMPTY: CoachPaidPeriodControllerSnapshot = Object.freeze({ confirmed: null, draft: null, pending: null,
  attempt: null, issue: null, needsRefresh: true, disposed: false });
const SOURCE_ISSUES: readonly CoachPaidPeriodControllerIssue[] = ["invalid_input", "invalid_response", "forbidden",
  "not_found", "inactive_relationship", "request_conflict", "version_conflict", "conflict", "operation_stale", "aborted", "timeout", "unavailable"];
const UNCERTAIN: readonly CoachPaidPeriodControllerIssue[] = ["invalid_response", "aborted", "timeout", "unavailable"];

function issueFrom(error: unknown): CoachPaidPeriodControllerIssue {
  try {
    if (error === null || typeof error !== "object") return "unavailable";
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const code: unknown = descriptor && "value" in descriptor ? descriptor.value : null;
    return typeof code === "string" && SOURCE_ISSUES.includes(code as CoachPaidPeriodControllerIssue)
      ? code as CoachPaidPeriodControllerIssue : "unavailable";
  } catch { return "unavailable"; }
}

function unresolved(attempt: CoachPaidPeriodAttempt | null): boolean {
  return attempt !== null && attempt.phase !== "resolved" && attempt.phase !== "rejected";
}

/** One captured identity/generation and selected episode. Construction performs no I/O. */
export function createCoachPaidPeriodController(input: CoachPaidPeriodControllerInput): CoachPaidPeriodController {
  const { source, validation, isCurrent, createRequestId } = input;
  const selection = Object.freeze({ renewalId: input.selection.renewalId, episodeId: input.selection.episodeId });
  const listeners = new Set<(snapshot: CoachPaidPeriodControllerSnapshot) => void>();
  const usedRequestIds = new Set<string>();
  let state = EMPTY;
  let active: AbortController | null = null;
  let sentDraft: CoachRenewalDraft | null = null;

  function dispose(issue: CoachPaidPeriodControllerIssue | null = null) {
    if (state.disposed) return;
    const abort = active;
    active = null;
    sentDraft = null;
    usedRequestIds.clear();
    state = Object.freeze({ ...EMPTY, disposed: true, issue });
    const subscribers = [...listeners];
    listeners.clear();
    abort?.abort();
    for (const listener of subscribers) { try { listener(state); } catch { /* A subscriber cannot alter transport outcome. */ } }
  }

  function live(): boolean {
    if (state.disposed) return false;
    let current = false;
    try { current = isCurrent(); } catch { /* Failure invalidates, never reactivates. */ }
    if (!current) dispose("operation_stale");
    return current;
  }

  function publish(patch: Partial<CoachPaidPeriodControllerSnapshot>) {
    if (state.disposed) return;
    const snapshot = Object.freeze({ ...state, ...patch });
    state = snapshot;
    for (const listener of [...listeners]) {
      if (!live() || state !== snapshot) break;
      try { listener(snapshot); } catch { /* Subscriber errors are not write uncertainty. */ }
    }
  }

  function current(operation: AbortController): boolean { return live() && active === operation; }
  function available(): boolean { return live() && state.pending === null; }
  function begin(pending: NonNullable<CoachPaidPeriodControllerSnapshot["pending"]>): AbortController | null {
    if (!available()) return null;
    const operation = new AbortController();
    active = operation;
    publish({ pending, issue: null });
    return current(operation) ? operation : null;
  }
  function finish(operation: AbortController, patch: Partial<CoachPaidPeriodControllerSnapshot>) {
    if (!current(operation)) return;
    active = null;
    publish({ ...patch, pending: null });
  }

  function withAttempt(attempt: CoachPaidPeriodAttempt, patch: Partial<CoachPaidPeriodAttempt>): CoachPaidPeriodAttempt {
    return Object.freeze({ ...attempt, ...patch });
  }

  function validDraftBinding(): boolean {
    if (!state.confirmed || !state.draft?.periodContext) return false;
    return matchesCoachPaidPeriodBaseline(selection.renewalId, state.draft.baseline, state.draft.periodContext, state.confirmed);
  }

  async function readLatest(operation: AbortController, afterWrite?: CoachPaidPeriodAttempt): Promise<boolean> {
    if (!current(operation)) return false;
    try {
      const value = await source.readPeriod(selection.episodeId, { signal: operation.signal });
      if (!current(operation)) return false;
      const confirmed = copyCoachPaidPeriodRead(value, selection.episodeId, validation);
      // This ledger never resets a version or deletes paid periods through its RPCs.
      // A write receipt followed by pre-write/absent facts is not a completed refresh.
      if (!confirmed || (afterWrite && (!confirmed.period || confirmed.version === afterWrite.command.expectedVersion))) {
        publish({ issue: "invalid_response", needsRefresh: true }); return false;
      }
      publish({ confirmed, needsRefresh: false });
      return current(operation);
    } catch (error) {
      if (!current(operation)) return false;
      const issue = issueFrom(error);
      if (["forbidden", "inactive_relationship", "operation_stale"].includes(issue)) dispose(issue);
      else publish({ issue, needsRefresh: true });
      return false;
    }
  }

  async function completeRecorded(operation: AbortController, attempt: CoachPaidPeriodAttempt,
    receipt: CoachPaidPeriodOperationReceipt): Promise<boolean> {
    if (!current(operation)) return false;
    const recorded = withAttempt(attempt, { phase: "recorded", receipt, retryAllowed: false });
    publish({ attempt: recorded, needsRefresh: true });
    if (!current(operation)) return false;
    if (!await readLatest(operation, attempt)) { finish(operation, {}); return false; }
    if (!current(operation)) return false;
    const draft = state.draft === sentDraft && sentDraft !== null ? cancelCoachRenewalDraft(sentDraft) : state.draft;
    finish(operation, { attempt: withAttempt(recorded, { phase: "resolved" }), draft, issue: null });
    return live();
  }

  async function dispatch(operation: AbortController, attempt: CoachPaidPeriodAttempt, retrying: boolean): Promise<boolean> {
    if (!current(operation)) return false;
    const { command } = attempt;
    const request = Object.freeze({ episodeId: attempt.episodeId, start: command.dates.start, end: command.dates.end,
      expectedVersion: command.expectedVersion, requestId: attempt.requestId });
    let result;
    try {
      result = await (command.action === "correct"
        ? source.correctPeriod(Object.freeze({ ...request, periodId: command.periodId }), { signal: operation.signal })
        : source.confirmPeriod(request, { signal: operation.signal }));
    } catch (error) {
      if (!current(operation)) return false;
      const issue = issueFrom(error);
      if (["forbidden", "inactive_relationship", "operation_stale"].includes(issue)) { dispose(issue); return false; }
      // A rejection of a retry cannot prove that its earlier uncertain dispatch failed.
      if (retrying || UNCERTAIN.includes(issue)) {
        finish(operation, { attempt: withAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue, needsRefresh: true });
        return false;
      }
      publish({ attempt: withAttempt(attempt, { phase: "rejected", retryAllowed: false }), issue, needsRefresh: true });
      if (issue === "version_conflict") await readLatest(operation);
      finish(operation, {});
      return false;
    }
    if (!current(operation)) return false;
    const receipt = result?.status === "recorded" ? copyMatchingCoachPaidPeriodReceipt(result.operation, attempt, validation) : null;
    if (!receipt) {
      finish(operation, { attempt: withAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue: "invalid_response", needsRefresh: true });
      return false;
    }
    return completeRecorded(operation, attempt, receipt);
  }

  function local(update: (draft: CoachRenewalDraft) => CoachRenewalDraft): boolean {
    if (!live() || !state.draft) return false;
    const draft = update(state.draft);
    if (draft === state.draft) return false;
    publish({ draft });
    return live();
  }

  function canSave(): boolean {
    return available() && !unresolved(state.attempt) && !state.needsRefresh && validDraftBinding()
      && prepareCoachRenewalPeriodCommand(state.draft!, validation).kind === "ready";
  }

  if (!paidOpaqueId(selection.renewalId) || !paidOpaqueId(selection.episodeId)) dispose("invalid_binding");

  return Object.freeze<CoachPaidPeriodController>({
    getSnapshot: () => { live(); return state; },
    subscribe: (listener: (snapshot: CoachPaidPeriodControllerSnapshot) => void) => {
      if (!live()) return () => undefined;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load: async () => {
      const operation = begin("load");
      if (!operation) return false;
      const loaded = await readLatest(operation);
      finish(operation, loaded ? { issue: null } : {});
      return loaded && live();
    },
    open: (baseline, target) => {
      if (!available() || unresolved(state.attempt) || state.needsRefresh || !state.confirmed || state.draft?.detailOpen) return false;
      let draft: CoachRenewalDraft | null = null;
      try {
        draft = openCoachRenewalPeriodDraft(baseline, target);
        if (draft && !matchesCoachPaidPeriodBaseline(selection.renewalId, draft.baseline, draft.periodContext!, state.confirmed)) draft = null;
      } catch { /* Malformed caller bindings cannot become partial drafts. */ }
      if (!draft) { publish({ issue: "invalid_binding" }); return false; }
      publish({ draft, issue: null });
      return live();
    },
    openDates: (dates) => local((draft) => openCoachRenewalDraftDates(draft, dates)),
    editDates: (dates) => local((draft) => editCoachRenewalDraftDates(draft, dates)),
    acceptDates: () => local((draft) => {
      const result = acceptCoachRenewalDraftDates(draft, validation);
      return result.kind === "accepted" ? result.draft : draft;
    }),
    cancelDates: () => local(cancelCoachRenewalDraftDates),
    selectState: (next) => next === "pending" || next === "declined" ? local((draft) => selectCoachRenewalDraftState(draft, next)) : false,
    cancelDetail: () => local((draft) => draft.detailOpen ? cancelCoachRenewalDraft(draft) : draft),
    canSave,
    save: async () => {
      if (!canSave()) return false;
      const draft = state.draft!;
      const confirmed = state.confirmed!;
      const prepared = prepareCoachRenewalPeriodCommand(draft, validation);
      if (prepared.kind !== "ready") return false;
      const operation = begin("save");
      if (!operation) return false;
      if (state.draft !== draft || state.confirmed !== confirmed) { finish(operation, { issue: "draft_changed" }); return false; }
      let requestId: string;
      try { requestId = createRequestId(); } catch { finish(operation, { issue: "invalid_request_id" }); return false; }
      if (!current(operation)) return false;
      if (!paidOpaqueId(requestId) || usedRequestIds.has(requestId)) { finish(operation, { issue: "invalid_request_id" }); return false; }
      usedRequestIds.add(requestId);
      const attempt: CoachPaidPeriodAttempt = Object.freeze({ requestId, episodeId: selection.episodeId,
        command: prepared.command, previousPeriodId: confirmed.period?.id ?? null,
        phase: "in-flight", receipt: null, retryAllowed: false });
      const previousAttempt = state.attempt;
      publish({ attempt });
      // A synchronous subscriber/factory may edit, cancel or invalidate before dispatch.
      if (!current(operation)) return false;
      if (state.draft !== draft || state.confirmed !== confirmed) {
        finish(operation, { attempt: previousAttempt, issue: "draft_changed" }); return false;
      }
      sentDraft = draft;
      return dispatch(operation, attempt, false);
    },
    reconcile: async () => {
      if (!available() || !unresolved(state.attempt)) return false;
      const attempt = state.attempt!;
      const operation = begin("reconcile");
      if (!operation) return false;
      if (attempt.receipt !== null) return completeRecorded(operation, attempt, attempt.receipt);
      let value;
      try { value = await source.readOwnOperation(attempt.requestId, { signal: operation.signal }); }
      catch (error) {
        if (!current(operation)) return false;
        const issue = issueFrom(error);
        if (["forbidden", "inactive_relationship", "operation_stale"].includes(issue)) dispose(issue);
        else finish(operation, { attempt: withAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue, needsRefresh: true });
        return false;
      }
      if (!current(operation)) return false;
      if (value === null) {
        finish(operation, { attempt: withAttempt(attempt, { phase: "uncertain", retryAllowed: true }), issue: null, needsRefresh: true });
        return false;
      }
      const receipt = copyMatchingCoachPaidPeriodReceipt(value, attempt, validation);
      if (!receipt) {
        finish(operation, { attempt: withAttempt(attempt, { phase: "uncertain", retryAllowed: false }), issue: "invalid_response", needsRefresh: true });
        return false;
      }
      return completeRecorded(operation, attempt, receipt);
    },
    retry: async () => {
      if (!available() || state.attempt?.phase !== "uncertain" || !state.attempt.retryAllowed) return false;
      const attempt = withAttempt(state.attempt, { phase: "in-flight", retryAllowed: false });
      const operation = begin("retry");
      if (!operation) return false;
      publish({ attempt });
      if (!current(operation)) return false;
      return dispatch(operation, attempt, true);
    },
    dispose: () => dispose(),
  });
}
