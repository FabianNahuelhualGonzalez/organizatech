import type { CoachInvitationActionKind, CoachInvitationActionsAttempt, CoachInvitationActionsController,
  CoachInvitationActionsControllerInput, CoachInvitationActionsIssue, CoachInvitationActionsOperation,
  CoachInvitationActionsSnapshot } from "./coach-invitation-actions-contract";
import { actionField, actionIssue, actionOpaque, copyActionOperation, copyActionRead, copyActionResult,
  resolveActionRead } from "./coach-invitation-actions-reconciliation";

const EMPTY: CoachInvitationActionsSnapshot = Object.freeze({ confirmed: null, pending: null, attempt: null,
  rateLimit: null, issue: null, needsRefresh: false, disposed: false });
const UNCERTAIN: readonly CoachInvitationActionsIssue[] = ["invalid_response", "request_conflict", "aborted", "timeout", "unavailable"];
interface Flight {
  readonly epoch: number;
  readonly kind: NonNullable<CoachInvitationActionsSnapshot["pending"]>;
  readonly abort: AbortController;
  readonly settle: (value: boolean) => void;
}

/** Invitation-specific lifecycle. Requires the atomic generation-bound source, never legacy fallback. */
export function createCoachInvitationActionsController(input: CoachInvitationActionsControllerInput): CoachInvitationActionsController {
  const { source, isCurrent, createRequestId } = input;
  let invitationId: string | null = null;
  try {
    const id = actionField(input.selection, "invitationId");
    if (actionOpaque(id)) invitationId = id;
  } catch { /* Invalid selection never reaches the source. */ }
  let state: CoachInvitationActionsSnapshot = invitationId ? EMPTY : Object.freeze({ ...EMPTY, issue: "invalid_selection" });
  const listeners = new Set<(snapshot: CoachInvitationActionsSnapshot) => void>();
  const usedRequestIds = new Set<string>();
  let active: Flight | null = null;
  let epoch = 0;
  let checking = false;
  let notifying = false;
  let transitioning = false;
  let uncertainHistory = false;

  function abort(flight: Flight | null) {
    if (!flight) return;
    flight.settle(false);
    try { flight.abort.abort(); } catch { /* Public completion is independent from transport cleanup. */ }
  }
  function emit() {
    if (notifying) return;
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        if (!state.disposed) live(false);
        try { listener(state); } catch { /* Listener exceptions are not write uncertainty. */ }
      }
    } finally { notifying = false; if (state.disposed) listeners.clear(); }
  }
  function dispose(issue: CoachInvitationActionsIssue | null = null, notify = true) {
    if (state.disposed) return;
    epoch += 1;
    const old = active;
    active = null;
    invitationId = null;
    uncertainHistory = false;
    usedRequestIds.clear();
    state = Object.freeze({ ...EMPTY, disposed: true, issue });
    abort(old);
    if (notify) emit();
    if (!notifying) listeners.clear();
  }
  function live(notify = true): boolean {
    if (state.disposed) return false;
    if (checking) { dispose("operation_stale", false); return false; }
    checking = true;
    let current = false;
    try { current = isCurrent() === true; } catch { /* Failed ownership guards latch stale. */ }
    finally { checking = false; }
    if (!current) dispose("operation_stale", notify);
    return !state.disposed;
  }
  function available(): boolean { return !notifying && !transitioning && live() && active === null && state.pending === null; }
  function current(flight: Flight): boolean { return live() && active === flight && epoch === flight.epoch; }
  function publish(patch: Partial<CoachInvitationActionsSnapshot>) {
    if (!live()) return;
    state = Object.freeze({ ...state, ...patch });
    emit();
  }
  function changed(attempt: CoachInvitationActionsAttempt, patch: Partial<CoachInvitationActionsAttempt>): CoachInvitationActionsAttempt {
    return Object.freeze({ ...attempt, ...patch });
  }
  function begin(kind: Flight["kind"]) {
    if (!available()) return null;
    let accept!: (value: boolean) => void;
    let settled = false;
    const promise = new Promise<boolean>((resolve) => { accept = resolve; });
    const flight: Flight = { kind, epoch: ++epoch, abort: new AbortController(),
      settle: (value) => { if (!settled) { settled = true; accept(value); } } };
    active = flight;
    publish({ pending: kind, issue: null });
    return { flight, promise };
  }
  function finish(flight: Flight, patch: Partial<CoachInvitationActionsSnapshot>, success = false) {
    if (!current(flight)) { flight.settle(false); return; }
    active = null;
    state = Object.freeze({ ...state, ...patch, pending: null });
    const completed = state;
    emit();
    flight.settle(success && live() && state === completed);
  }
  function failure(flight: Flight, attempt: CoachInvitationActionsAttempt | null, error: unknown, readFailure: boolean) {
    if (!current(flight)) { flight.settle(false); return; }
    const issue = actionIssue(error);
    if (!current(flight)) { flight.settle(false); return; }
    if (issue === "forbidden" || issue === "operation_stale") { dispose(issue); return; }
    if (!attempt) { finish(flight, { confirmed: null, issue, needsRefresh: true }); return; }
    const uncertain = readFailure || uncertainHistory || UNCERTAIN.includes(issue);
    if (uncertain && !attempt.operation) uncertainHistory = true;
    finish(flight, { confirmed: null, issue, needsRefresh: uncertain || attempt.operation !== null,
      attempt: changed(attempt, { phase: attempt.operation ? "recorded" : uncertain ? "uncertain" : "rejected",
        retryAllowed: false, resolution: null }) });
  }
  async function readLoad(flight: Flight, id: string) {
    if (!current(flight)) { flight.settle(false); return; }
    try {
      const read = source.readInvitation;
      if (!current(flight)) { flight.settle(false); return; }
      const value = await Reflect.apply(read, source, [id, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      const confirmed = copyActionRead(value, id);
      if (!current(flight)) { flight.settle(false); return; }
      uncertainHistory = false;
      finish(flight, { confirmed, attempt: null, rateLimit: null, issue: null, needsRefresh: false }, true);
    } catch (error) { failure(flight, null, error, true); }
  }
  async function readDetail(flight: Flight, attempt: CoachInvitationActionsAttempt, operation: CoachInvitationActionsOperation) {
    const recorded = changed(attempt, { phase: "recorded", operation, retryAllowed: false, resolution: null });
    if (!current(flight)) { flight.settle(false); return; }
    publish({ attempt: recorded, confirmed: null, rateLimit: null, needsRefresh: true });
    if (!current(flight)) { flight.settle(false); return; }
    try {
      const read = source.readInvitation;
      if (!current(flight)) { flight.settle(false); return; }
      const value = await Reflect.apply(read, source, [operation.invitationId, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      const result = resolveActionRead(value, operation);
      if (!current(flight)) { flight.settle(false); return; }
      finish(flight, { confirmed: result.confirmed, attempt: changed(recorded, { phase: "resolved", resolution: result.resolution }),
        needsRefresh: false, issue: null }, result.resolution === "reserved");
    } catch (error) { failure(flight, recorded, error, true); }
  }
  async function dispatch(flight: Flight, attempt: CoachInvitationActionsAttempt) {
    if (!current(flight)) { flight.settle(false); return; }
    try {
      const command = Object.freeze({ invitationId: attempt.invitationId, expectedGeneration: attempt.expectedGeneration, requestId: attempt.requestId });
      const write = attempt.action === "resend" ? source.resend : source.regenerate;
      if (!current(flight)) { flight.settle(false); return; }
      const value = await Reflect.apply(write, source, [command, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      const result = copyActionResult(value, attempt);
      if (!current(flight)) { flight.settle(false); return; }
      if (result.status === "rate_limited") {
        finish(flight, { confirmed: null, attempt: changed(attempt, { phase: uncertainHistory ? "uncertain" : "rate-limited",
          retryAllowed: !uncertainHistory, resolution: null }), issue: null, needsRefresh: uncertainHistory,
          rateLimit: Object.freeze({ serverNow: result.serverNow, retryAt: result.retryAt }) });
        return;
      }
      await readDetail(flight, attempt, result.operation);
    } catch (error) { failure(flight, attempt, error, false); }
  }
  async function reconcileAttempt(flight: Flight, attempt: CoachInvitationActionsAttempt) {
    if (!current(flight)) { flight.settle(false); return; }
    const tracking = changed(attempt, { phase: attempt.operation ? "recorded" : "uncertain", retryAllowed: false, resolution: null });
    publish({ attempt: tracking, confirmed: null, needsRefresh: true });
    if (!current(flight)) { flight.settle(false); return; }
    try {
      const read = source.readOwnOperation;
      if (!current(flight)) { flight.settle(false); return; }
      const value = await Reflect.apply(read, source, [attempt.requestId, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      if (value === null) {
        if (attempt.operation) { failure(flight, tracking, { code: "invalid_response" }, true); return; }
        finish(flight, { attempt: changed(tracking, { phase: "uncertain", retryAllowed: true }), issue: null, needsRefresh: true });
        return;
      }
      const operation = copyActionOperation(value, tracking);
      if (!current(flight)) { flight.settle(false); return; }
      await readDetail(flight, tracking, operation);
    } catch (error) { failure(flight, tracking, error, true); }
  }
  function can(action: CoachInvitationActionKind): boolean {
    return available() && invitationId !== null && state.attempt === null && state.confirmed?.id === invitationId
      && state.confirmed.state === (action === "resend" ? "pending" : "expired");
  }
  function send(action: CoachInvitationActionKind): Promise<boolean> {
    if (!can(action)) return Promise.resolve(false);
    const id = invitationId!;
    const expectedGeneration = state.confirmed!.generation;
    const started = begin(action);
    if (!started) return Promise.resolve(false);
    const { flight, promise } = started;
    if (!current(flight)) { flight.settle(false); return promise; }
    let requestId: unknown;
    try { requestId = createRequestId(); }
    catch { if (current(flight)) finish(flight, { issue: "invalid_request_id" }); return promise; }
    if (!current(flight)) { flight.settle(false); return promise; }
    if (!actionOpaque(requestId) || usedRequestIds.has(requestId)) {
      finish(flight, { issue: "invalid_request_id" }); return promise;
    }
    usedRequestIds.add(requestId);
    const attempt: CoachInvitationActionsAttempt = Object.freeze({ invitationId: id, expectedGeneration, requestId, action,
      phase: "in-flight", operation: null, retryAllowed: false, resolution: null });
    uncertainHistory = false;
    publish({ attempt, confirmed: null, rateLimit: null, needsRefresh: false });
    void dispatch(flight, attempt);
    return promise;
  }
  return Object.freeze<CoachInvitationActionsController>({
    getSnapshot: () => { live(false); return state; },
    subscribe: (listener) => { if (live() && typeof listener === "function") listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => {
      if (notifying || transitioning || !live() || invitationId === null) return Promise.resolve(false);
      if (state.attempt && state.attempt.phase !== "resolved" && state.attempt.phase !== "rejected") return Promise.resolve(false);
      if (active) {
        if (active.kind !== "load") return Promise.resolve(false);
        const old = active;
        active = null;
        epoch += 1;
        state = Object.freeze({ ...state, pending: null });
        transitioning = true;
        try { abort(old); } finally { transitioning = false; }
      }
      const started = begin("load");
      if (!started) return Promise.resolve(false);
      if (current(started.flight)) publish({ confirmed: null, needsRefresh: true });
      void readLoad(started.flight, invitationId!);
      return started.promise;
    },
    canResend: () => can("resend"),
    canRegenerate: () => can("regenerate"),
    resend: () => send("resend"),
    regenerate: () => send("regenerate"),
    reconcile: () => {
      if (!available() || state.attempt === null) return Promise.resolve(false);
      const attempt = state.attempt;
      const started = begin("reconcile");
      if (!started) return Promise.resolve(false);
      void reconcileAttempt(started.flight, attempt);
      return started.promise;
    },
    retry: () => {
      if (!available() || state.attempt?.operation !== null || !state.attempt.retryAllowed
        || (state.attempt.phase !== "uncertain" && state.attempt.phase !== "rate-limited")) return Promise.resolve(false);
      const attempt = changed(state.attempt, { phase: "in-flight", retryAllowed: false, resolution: null });
      const started = begin("retry");
      if (!started) return Promise.resolve(false);
      if (current(started.flight)) publish({ attempt, confirmed: null, needsRefresh: false });
      void dispatch(started.flight, attempt);
      return started.promise;
    },
    dispose: () => dispose(),
  });
}
