import type { CoachInvitationCreationAttempt, CoachInvitationCreationController, CoachInvitationCreationControllerInput,
  CoachInvitationCreationIssue, CoachInvitationCreationOperation, CoachInvitationCreationSnapshot,
} from "./coach-invitation-creation-contract";
import { copyCreationOperation, copyCreationResult, creationIssue, creationOpaque,
  resolveCreationRead } from "./coach-invitation-creation-reconciliation";

const EMPTY: CoachInvitationCreationSnapshot = Object.freeze({ isOpen: false, emailRaw: "", emailValid: false,
  pending: null, attempt: null, confirmed: null, rateLimit: null, issue: null, needsRefresh: false, disposed: false });
const UNCERTAIN: readonly CoachInvitationCreationIssue[] = ["invalid_response", "request_conflict", "aborted", "timeout", "unavailable"];
interface Flight {
  readonly kind: NonNullable<CoachInvitationCreationSnapshot["pending"]>;
  readonly epoch: number;
  readonly abort: AbortController;
  readonly previousAttempt: CoachInvitationCreationAttempt | null;
  readonly settle: (value: boolean) => void;
  dispatched: boolean;
}

/** One captured owner context and one retained reservation intent; never an email sender. */
export function createCoachInvitationCreationController(input: CoachInvitationCreationControllerInput): CoachInvitationCreationController {
  const { source, isCurrent, createRequestId, prepareRecipientEmail } = input;
  const listeners = new Set<(snapshot: CoachInvitationCreationSnapshot) => void>();
  const usedRequestIds = new Set<string>();
  let state = EMPTY;
  let preparedEmail: string | null = null;
  let epoch = 0;
  let draftRevision = 0;
  let openingRevision = 0;
  let active: Flight | null = null;
  let checking = false;
  let preparing = false;
  let notifying = false;
  let uncertainHistory = false;

  function abort(flight: Flight | null) {
    if (!flight) return;
    flight.settle(false);
    try { flight.abort.abort(); } catch { /* Local state and public completion do not depend on transport cleanup. */ }
  }
  function emit() {
    if (notifying) return;
    notifying = true;
    try {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        if (!state.disposed) live(false);
        try { listener(state); } catch { /* Subscriber errors never become transport uncertainty. */ }
      }
    } finally {
      notifying = false;
      if (state.disposed) listeners.clear();
    }
  }
  function dispose(issue: CoachInvitationCreationIssue | null = null, notify = true) {
    if (state.disposed) return;
    epoch += 1;
    draftRevision += 1;
    openingRevision += 1;
    preparedEmail = null;
    uncertainHistory = false;
    usedRequestIds.clear();
    const flight = active;
    active = null;
    state = Object.freeze({ ...EMPTY, disposed: true, issue });
    abort(flight);
    if (notify) emit();
    if (!notifying) listeners.clear();
  }
  function live(notify = true): boolean {
    if (state.disposed) return false;
    if (checking) { dispose("operation_stale", false); return false; }
    checking = true;
    let current = false;
    try { current = isCurrent() === true; } catch { /* Invalid owner guards fail closed permanently. */ }
    finally { checking = false; }
    if (!current) dispose("operation_stale", notify);
    return !state.disposed;
  }
  function publish(patch: Partial<CoachInvitationCreationSnapshot>) {
    if (!live()) return;
    state = Object.freeze({ ...state, ...patch });
    emit();
  }
  function current(flight: Flight): boolean { return live() && active === flight && epoch === flight.epoch; }
  function available(): boolean { return !notifying && !preparing && live() && active === null && state.pending === null; }
  function changed(attempt: CoachInvitationCreationAttempt, patch: Partial<CoachInvitationCreationAttempt>): CoachInvitationCreationAttempt {
    return Object.freeze({ ...attempt, ...patch });
  }
  function begin(kind: Flight["kind"]): { flight: Flight; promise: Promise<boolean> } | null {
    if (!available()) return null;
    let resolve!: (value: boolean) => void;
    let settled = false;
    const promise = new Promise<boolean>((accept) => { resolve = accept; });
    const flight: Flight = { kind, epoch: ++epoch, abort: new AbortController(), previousAttempt: state.attempt,
      dispatched: false, settle: (value) => { if (!settled) { settled = true; resolve(value); } } };
    active = flight;
    publish({ pending: kind, issue: null });
    return { flight, promise };
  }
  function finish(flight: Flight, patch: Partial<CoachInvitationCreationSnapshot>, success = false) {
    if (!current(flight)) { flight.settle(false); return; }
    active = null;
    state = Object.freeze({ ...state, ...patch, pending: null });
    const attempt = state.attempt;
    emit();
    flight.settle(success && live() && state.attempt === attempt && attempt?.resolution === "reserved");
  }
  function cancelInitial() {
    const flight = active;
    if (!flight || flight.kind !== "submit" || flight.dispatched) return;
    active = null;
    epoch += 1;
    state = Object.freeze({ ...state, pending: null, attempt: flight.previousAttempt });
    abort(flight);
  }
  function failure(flight: Flight, attempt: CoachInvitationCreationAttempt, error: unknown, readFailure: boolean) {
    if (!current(flight)) { flight.settle(false); return; }
    const issue = creationIssue(error);
    if (!current(flight)) { flight.settle(false); return; }
    if (issue === "forbidden" || issue === "operation_stale") { dispose(issue); return; }
    const uncertain = readFailure || uncertainHistory || UNCERTAIN.includes(issue);
    if (uncertain && attempt.operation === null) uncertainHistory = true;
    finish(flight, { attempt: changed(attempt, { phase: attempt.operation ? "recorded" : uncertain ? "uncertain" : "rejected",
      retryAllowed: false, resolution: null }), confirmed: null, issue, needsRefresh: uncertain || attempt.operation !== null });
  }

  async function readDetail(flight: Flight, attempt: CoachInvitationCreationAttempt, operation: CoachInvitationCreationOperation) {
    const recorded = changed(attempt, { operation, phase: "recorded", retryAllowed: false, resolution: null });
    if (!current(flight)) { flight.settle(false); return; }
    publish({ attempt: recorded, confirmed: null, rateLimit: null, needsRefresh: true });
    if (!current(flight)) { flight.settle(false); return; }
    try {
      const read = source.readInvitation;
      if (!current(flight)) { flight.settle(false); return; }
      const value = await Reflect.apply(read, source, [operation.invitationId, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      const result = resolveCreationRead(value, recorded, operation);
      if (!current(flight)) { flight.settle(false); return; }
      finish(flight, { attempt: changed(recorded, { phase: "resolved", resolution: result.resolution }),
        confirmed: result.confirmed, needsRefresh: false, issue: null }, result.resolution === "reserved");
    } catch (error) { failure(flight, recorded, error, true); }
  }

  async function dispatch(flight: Flight, attempt: CoachInvitationCreationAttempt) {
    if (!current(flight)) { flight.settle(false); return; }
    try {
      const command = Object.freeze({ recipientEmail: attempt.recipientEmail, requestId: attempt.requestId });
      const create = source.create;
      if (!current(flight)) { flight.settle(false); return; }
      // The call can synchronously close/edit via a synthetic source; from this point tracking must survive.
      flight.dispatched = true;
      const value = await Reflect.apply(create, source, [command, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      const result = copyCreationResult(value, attempt);
      if (!current(flight)) { flight.settle(false); return; }
      if (result.status === "rate_limited") {
        finish(flight, { attempt: changed(attempt, { phase: uncertainHistory ? "uncertain" : "rate-limited",
          retryAllowed: !uncertainHistory, resolution: null }), confirmed: null,
          rateLimit: Object.freeze({ serverNow: result.serverNow, retryAt: result.retryAt }), issue: null, needsRefresh: uncertainHistory });
        return;
      }
      await readDetail(flight, attempt, result.operation);
    } catch (error) { failure(flight, attempt, error, false); }
  }

  async function reconcileAttempt(flight: Flight, attempt: CoachInvitationCreationAttempt) {
    if (!current(flight)) { flight.settle(false); return; }
    const tracking = changed(attempt, { phase: attempt.operation ? "recorded" : "uncertain", retryAllowed: false, resolution: null });
    publish({ attempt: tracking, confirmed: null, needsRefresh: true });
    if (!current(flight)) { flight.settle(false); return; }
    try {
      // Unlike a completed write receipt, a reservation operation may later be cancelled.
      const read = source.readOperation;
      if (!current(flight)) { flight.settle(false); return; }
      const value = await Reflect.apply(read, source, [attempt.requestId, { signal: flight.abort.signal }]);
      if (!current(flight)) { flight.settle(false); return; }
      if (value === null) {
        if (attempt.operation !== null) { failure(flight, tracking, { code: "invalid_response" }, true); return; }
        finish(flight, { attempt: changed(tracking, { phase: "uncertain", retryAllowed: true }), issue: null, needsRefresh: true });
        return;
      }
      const operation = copyCreationOperation(value, tracking);
      if (!current(flight)) { flight.settle(false); return; }
      await readDetail(flight, tracking, operation);
    } catch (error) { failure(flight, tracking, error, true); }
  }

  function canSubmit(): boolean {
    return available() && state.isOpen && state.emailValid && preparedEmail !== null
      && (state.attempt === null || state.attempt.phase === "rejected");
  }

  return Object.freeze<CoachInvitationCreationController>({
    getSnapshot: () => { live(false); return state; },
    subscribe: (listener) => {
      if (live() && typeof listener === "function") listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open: () => {
      if (!live() || state.isOpen) return false;
      openingRevision += 1;
      publish({ isOpen: true });
      return live() && state.isOpen;
    },
    close: () => {
      if (!live() || !state.isOpen) return false;
      openingRevision += 1;
      state = Object.freeze({ ...state, isOpen: false });
      cancelInitial();
      emit();
      return live() && !state.isOpen;
    },
    setEmail: (raw) => {
      if (preparing || !live() || typeof raw !== "string") return false;
      const revision = ++draftRevision;
      preparedEmail = null;
      state = Object.freeze({ ...state, emailRaw: raw, emailValid: false });
      cancelInitial();
      preparing = true;
      let canonical: unknown = null;
      try { canonical = prepareRecipientEmail(raw); } catch { /* Format failure is local, with no raw exception data. */ }
      finally { preparing = false; }
      if (!live() || revision !== draftRevision) return false;
      preparedEmail = creationOpaque(canonical) ? canonical : null;
      publish({ emailValid: preparedEmail !== null });
      return live() && revision === draftRevision && state.emailValid;
    },
    canSubmit,
    submit: () => {
      if (!canSubmit()) return Promise.resolve(false);
      const email = preparedEmail!;
      const draft = draftRevision;
      const opening = openingRevision;
      const started = begin("submit");
      if (!started) return Promise.resolve(false);
      const { flight, promise } = started;
      if (!current(flight)) { flight.settle(false); return promise; }
      if (!state.isOpen || draft !== draftRevision || opening !== openingRevision) {
        finish(flight, { issue: "draft_changed" }); return promise;
      }
      let requestId: unknown;
      try { requestId = createRequestId(); }
      catch { if (current(flight)) finish(flight, { issue: "invalid_request_id" }); return promise; }
      if (!current(flight)) { flight.settle(false); return promise; }
      if (!creationOpaque(requestId) || usedRequestIds.has(requestId)) {
        finish(flight, { issue: "invalid_request_id" }); return promise;
      }
      usedRequestIds.add(requestId);
      const attempt: CoachInvitationCreationAttempt = Object.freeze({ requestId, recipientEmail: email,
        phase: "in-flight", operation: null, retryAllowed: false, resolution: null });
      uncertainHistory = false;
      publish({ attempt, confirmed: null, rateLimit: null, needsRefresh: false });
      if (!current(flight)) { flight.settle(false); return promise; }
      if (!state.isOpen || draft !== draftRevision || opening !== openingRevision) {
        finish(flight, { attempt: flight.previousAttempt, issue: "draft_changed" }); return promise;
      }
      void dispatch(flight, attempt);
      return promise;
    },
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
