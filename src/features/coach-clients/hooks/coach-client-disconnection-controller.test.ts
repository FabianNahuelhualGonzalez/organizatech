import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoachClientDisconnectionController } from "./coach-client-disconnection-controller";
import type { CoachClientDisconnectionController, CoachClientDisconnectionRead, CoachClientDisconnectionReceipt,
  CoachClientDisconnectionSelection, CoachClientDisconnectionSource } from "./coach-client-disconnection-contract";

const invitation: CoachClientDisconnectionRead = Object.freeze({ kind: "invitation", id: "invitation-A", state: "pending" });
const relationship: CoachClientDisconnectionRead = Object.freeze({ kind: "relationship", id: "relationship-A", endedAt: null });
const endedAt = "2026-09-09T03:00:00Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function done(selection: CoachClientDisconnectionSelection, requestId: string): CoachClientDisconnectionReceipt {
  return { kind: selection.kind, id: selection.id, requestId, completed: true };
}
function closed(read: CoachClientDisconnectionRead): CoachClientDisconnectionRead {
  return read.kind === "invitation" ? { ...read, state: "cancelled" } : { ...read, endedAt };
}

function harness(initial: CoachClientDisconnectionRead = invitation, factory?: () => string) {
  const selection = { kind: initial.kind, id: initial.id };
  const context = { userId: "coach-A", generation: 1, selectionId: initial.id };
  const backend = { read: initial, operation: null as CoachClientDisconnectionReceipt | null };
  const calls: { method: "read" | "write" | "operation"; selection?: CoachClientDisconnectionSelection;
    requestId?: string; signal?: AbortSignal }[] = [];
  let generated = 0;
  const handlers: CoachClientDisconnectionSource = {
    readSelection: async () => backend.read,
    disconnect: async (target, requestId) => { backend.read = closed(backend.read); backend.operation = done(target, requestId); return backend.operation; },
    readOwnOperation: async () => backend.operation,
  };
  const source: CoachClientDisconnectionSource = {
    readSelection: (target, options) => { calls.push({ method: "read", selection: target, signal: options?.signal }); return handlers.readSelection(target, options); },
    disconnect: (target, requestId, options) => { calls.push({ method: "write", selection: target, requestId, signal: options?.signal }); return handlers.disconnect(target, requestId, options); },
    readOwnOperation: (requestId, options) => { calls.push({ method: "operation", requestId, signal: options?.signal }); return handlers.readOwnOperation(requestId, options); },
  };
  const input = { selection, source, isCurrent: () => context.userId === "coach-A" && context.generation === 1 && context.selectionId === initial.id,
    createRequestId: () => { generated += 1; return factory ? factory() : `request-${generated}`; } };
  const controller = createCoachClientDisconnectionController(input);
  return { controller, backend, handlers, source, input, selection, context, calls, ids: () => generated };
}

async function ready(h: ReturnType<typeof harness>) {
  assert.equal(await h.controller.load(), true);
  assert.equal(h.controller.openConfirmation(), true);
  assert.equal(h.controller.canConfirm(), true);
}

function throwingProperty(name: string, rest: object = {}): object {
  return Object.defineProperty({ ...rest }, name, { get: () => { throw new Error("synthetic accessor"); } });
}

test("construction, subscribe, open and cancel never read or write implicitly", async () => {
  const h = harness();
  const initial = h.controller.getSnapshot();
  let notified = 0;
  const unsubscribe = h.controller.subscribe(() => { notified += 1; });
  assert.equal(h.controller.getSnapshot(), initial);
  assert.equal(notified, 0);
  assert.equal(h.controller.openConfirmation(), false);
  assert.equal(h.controller.cancelConfirmation(), false);
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.ids(), 0);
  await ready(h);
  assert.equal(h.controller.openConfirmation(), false);
  assert.equal(h.controller.cancelConfirmation(), true);
  assert.equal(await h.controller.confirm(), false);
  assert.deepEqual(h.calls.map((call) => call.method), ["read"]);
  assert.equal(h.ids(), 0);
  unsubscribe();
});

test("pending/expired invitation and active relationship require explicit confirmation, then terminal read", async () => {
  for (const initial of [invitation, { ...invitation, state: "expired" } as CoachClientDisconnectionRead, relationship]) {
    const h = harness(initial);
    await ready(h);
    h.selection.id = "mutated-after-construction";
    assert.equal(await h.controller.confirm(), true);
    assert.deepEqual(h.calls.map((call) => call.method), ["read", "write", "read"]);
    assert.deepEqual(h.calls[1].selection, { kind: initial.kind, id: initial.id });
    assert.equal(h.calls[1].requestId, "request-1");
    assert.equal(Object.isFrozen(h.calls[1].selection), true);
    const snapshot = h.controller.getSnapshot();
    assert.deepEqual(snapshot.confirmed, closed(initial));
    assert.equal(snapshot.attempt?.phase, "resolved");
    assert.deepEqual(snapshot.attempt?.receipt, done({ kind: initial.kind, id: initial.id }, "request-1"));
    assert.equal(snapshot.confirmationOpen, false);
    assert.equal(h.ids(), 1);
    assert.equal(h.controller.openConfirmation(), false);
  }
});

test("accepted/cancelled invitations and ended relationships are not new disconnection targets", async () => {
  for (const initial of [
    { ...invitation, state: "accepted" }, { ...invitation, state: "cancelled" }, { ...relationship, endedAt },
  ] as CoachClientDisconnectionRead[]) {
    const h = harness(initial);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.controller.openConfirmation(), false);
    assert.equal(h.controller.canConfirm(), false);
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.ids(), 0);
    assert.equal(h.controller.getSnapshot().attempt, null);
  }
});

test("failed reads are not initial/empty facts and never fabricate a successful disconnection", async () => {
  const h = harness();
  h.handlers.readSelection = async () => { throw { code: "unavailable" }; };
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().confirmed, null);
  assert.equal(h.controller.getSnapshot().pending, null);
  assert.equal(h.controller.getSnapshot().needsRefresh, true);
  assert.equal(h.controller.openConfirmation(), false);
  h.handlers.readSelection = async () => invitation;
  await ready(h);
  const known = h.controller.getSnapshot().confirmed;
  h.handlers.readSelection = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().confirmed, known);
  assert.equal(h.controller.canConfirm(), false);
});

test("malformed read bindings/state, getters and Proxies sanitize without leaving pending", async () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const value of [null, [], {}, { ...invitation, id: "other" }, { ...invitation, kind: "relationship" },
    { ...invitation, state: "invented" }, throwingProperty("kind"), throwingProperty("state", { kind: "invitation", id: "invitation-A" }),
    new Proxy({}, { get: (_, key) => { if (key === "then") return undefined; throw new Error("proxy getter"); } }), revoked.proxy]) {
    const h = harness();
    h.handlers.readSelection = async () => value as CoachClientDisconnectionRead;
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.ok(["invalid_response", "unavailable"].includes(h.controller.getSnapshot().issue!));
    assert.equal(h.controller.openConfirmation(), false);
  }
  for (const value of [undefined, "", 3, false]) {
    const h = harness(relationship);
    h.handlers.readSelection = async () => ({ ...relationship, endedAt: value }) as CoachClientDisconnectionRead;
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
  }
});

test("malformed selections are rejected before I/O and remain disposed", async () => {
  const h = harness();
  for (const selection of [null, {}, { kind: "invitation", id: "" }, { kind: "student", id: "A" }, throwingProperty("id", { kind: "invitation" })]) {
    const controller = createCoachClientDisconnectionController({ ...h.input, selection: selection as CoachClientDisconnectionSelection });
    assert.equal(controller.getSnapshot().disposed, true);
    assert.equal(controller.getSnapshot().issue, "invalid_selection");
    assert.equal(await controller.load(), false);
    assert.equal(controller.openConfirmation(), false);
  }
  assert.equal(h.calls.length, 0);
});

test("double tap is single-flight, including request factory and load/reconcile/retry", async () => {
  const h = harness();
  await ready(h);
  const pending = deferred<CoachClientDisconnectionReceipt>();
  h.handlers.disconnect = () => pending.promise;
  const first = h.controller.confirm();
  assert.equal(await h.controller.confirm(), false);
  assert.equal(await h.controller.load(), false);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
  assert.equal(h.ids(), 1);
  h.backend.read = closed(invitation);
  pending.resolve(done(h.calls[1].selection!, "request-1"));
  assert.equal(await first, true);
});

test("cancel during dispatch keeps tracking, cannot reopen/duplicate, and does not undo completion", async () => {
  const h = harness();
  await ready(h);
  const pending = deferred<CoachClientDisconnectionReceipt>();
  h.handlers.disconnect = () => pending.promise;
  const saving = h.controller.confirm();
  const attempt = h.controller.getSnapshot().attempt;
  assert.equal(h.controller.cancelConfirmation(), true);
  assert.equal(h.controller.getSnapshot().attempt, attempt);
  assert.equal(h.controller.openConfirmation(), false);
  assert.equal(await h.controller.confirm(), false);
  h.backend.read = closed(invitation);
  pending.resolve(done(h.calls[1].selection!, "request-1"));
  assert.equal(await saving, true);
  assert.equal(h.controller.getSnapshot().confirmationOpen, false);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
});

test("cancel during uncertainty preserves attempt and permits only its explicit same-id retry", async () => {
  const h = harness();
  await ready(h);
  const normal = h.handlers.disconnect;
  h.handlers.disconnect = async () => { throw { code: "timeout" }; };
  await h.controller.confirm();
  const attempt = h.controller.getSnapshot().attempt;
  h.controller.cancelConfirmation();
  assert.equal(h.controller.getSnapshot().attempt, attempt);
  assert.equal(h.controller.openConfirmation(), false);
  assert.equal(await h.controller.retry(), false);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().attempt?.retryAllowed, true);
  h.handlers.disconnect = normal;
  assert.equal(await h.controller.retry(), true);
  const writes = h.calls.filter((call) => call.method === "write");
  assert.equal(writes[0].selection, writes[1].selection);
  assert.equal(writes[0].requestId, writes[1].requestId);
  assert.equal(h.ids(), 1);
});

test("synchronous listeners cannot dispatch after identity/selection invalidation at either publication", async () => {
  for (const moment of ["pending", "attempt"]) {
    const h = harness();
    await ready(h);
    h.controller.subscribe((snapshot) => {
      if (snapshot.pending === "confirm" && (moment === "pending" || snapshot.attempt !== null)) h.context.selectionId = "other-selection";
    });
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.controller.getSnapshot().disposed, true);
    h.context.selectionId = "invitation-A";
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().attempt, null);
  }
});

test("listener cancellation before dispatch does not write or leave an uncertain attempt", async () => {
  for (const moment of ["pending", "attempt"]) {
    const h = harness();
    await ready(h);
    h.controller.subscribe((snapshot) => {
      if (snapshot.pending === "confirm" && snapshot.confirmationOpen && (moment === "pending" || snapshot.attempt)) h.controller.cancelConfirmation();
    });
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.controller.getSnapshot().attempt, null);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().issue, "confirmation_changed");
  }
});

test("factory side effects are rechecked before source dispatch", async () => {
  let sideEffect: () => void = () => undefined;
  const h = harness(invitation, () => { sideEffect(); return "factory-id"; });
  await ready(h);
  sideEffect = () => { h.controller.cancelConfirmation(); };
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.getSnapshot().pending, null);
  h.controller.openConfirmation();
  sideEffect = () => { h.context.generation = 2; };
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.getSnapshot().disposed, true);
});

test("account/same-user generation/selection changes abort late results and never reactivate", async () => {
  for (const field of ["userId", "generation", "selectionId"] as const) {
    const h = harness();
    const pending = deferred<CoachClientDisconnectionRead>();
    h.handlers.readSelection = () => pending.promise;
    const loading = h.controller.load();
    const original = h.context[field];
    if (field === "generation") h.context.generation = 2;
    else h.context[field] = "changed";
    assert.equal(h.controller.getSnapshot().disposed, true);
    assert.equal(h.calls[0].signal?.aborted, true);
    if (field === "generation") h.context.generation = original as number;
    else h.context[field] = original as string;
    pending.resolve(invitation);
    assert.equal(await loading, false);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(await h.controller.load(), false);
  }
});

test("explicit dispose aborts dispatched writes, clears data, and ignores late completion", async () => {
  const h = harness(relationship);
  await ready(h);
  const pending = deferred<CoachClientDisconnectionReceipt>();
  h.handlers.disconnect = () => pending.promise;
  const confirming = h.controller.confirm();
  const request = h.calls[1];
  h.controller.dispose();
  assert.equal(request.signal?.aborted, true);
  assert.deepEqual(h.controller.getSnapshot(), { confirmed: null, confirmationOpen: false, pending: null,
    attempt: null, issue: null, needsRefresh: true, disposed: true });
  pending.resolve(done(request.selection!, request.requestId!));
  assert.equal(await confirming, false);
  assert.equal(h.calls.filter((call) => call.method === "read").length, 1);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.openConfirmation(), false);
});

test("uncertain errors never auto-retry and load alone does not resolve the original attempt", async () => {
  for (const code of ["timeout", "aborted", "unavailable", "invalid_response"]) {
    const h = harness();
    await ready(h);
    h.handlers.disconnect = async () => { throw { code }; };
    assert.equal(await h.controller.confirm(), false);
    const attempt = h.controller.getSnapshot().attempt;
    assert.equal(attempt?.phase, "uncertain");
    assert.equal(attempt?.retryAllowed, false);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(await h.controller.retry(), false);
    assert.equal(await h.controller.confirm(), false);
    h.backend.read = closed(invitation);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.controller.getSnapshot().attempt, attempt);
    assert.equal(h.controller.canConfirm(), false);
    assert.equal(h.ids(), 1);
  }
});

test("receipt binding includes kind/id/requestId/completed on direct response and reconciliation", async () => {
  const transforms = [
    (value: CoachClientDisconnectionReceipt) => ({ ...value, kind: "relationship" }),
    (value: CoachClientDisconnectionReceipt) => ({ ...value, id: "other" }),
    (value: CoachClientDisconnectionReceipt) => ({ ...value, requestId: "other" }),
    (value: CoachClientDisconnectionReceipt) => ({ ...value, completed: false }),
    (value: CoachClientDisconnectionReceipt) => ({ ...value, completed: 1 }),
  ];
  for (const transform of transforms) {
    const h = harness();
    await ready(h);
    h.handlers.disconnect = async (selection, requestId) => transform(done(selection, requestId)) as CoachClientDisconnectionReceipt;
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
    h.backend.operation = transform(done({ kind: "invitation", id: "invitation-A" }, "request-1")) as CoachClientDisconnectionReceipt;
    assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().attempt?.retryAllowed, false);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.calls.filter((call) => call.method === "read").length, 1);
  }
});

test("a valid receipt must be followed by cancelled/ended, never pending/expired/accepted or still active", async () => {
  for (const after of [invitation, { ...invitation, state: "expired" }, { ...invitation, state: "accepted" }, relationship] as CoachClientDisconnectionRead[]) {
    const h = harness(after.kind === "invitation" ? invitation : relationship);
    await ready(h);
    const known = h.controller.getSnapshot().confirmed;
    h.handlers.disconnect = async (selection, requestId) => { h.backend.read = after; return done(selection, requestId); };
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.controller.getSnapshot().attempt?.phase, "recorded");
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().confirmed, known);
    assert.equal(h.controller.getSnapshot().confirmationOpen, true);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(await h.controller.retry(), false);
    h.backend.read = closed(after);
    assert.equal(await h.controller.reconcile(), true);
    assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
    assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
    assert.equal(h.calls.filter((call) => call.method === "operation").length, 0);
  }
});

test("read failure after a receipt preserves recorded evidence and never resends", async () => {
  const h = harness(relationship);
  await ready(h);
  const read = h.handlers.readSelection;
  h.handlers.readSelection = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "recorded");
  assert.equal(h.controller.getSnapshot().attempt?.receipt?.completed, true);
  assert.equal(h.controller.getSnapshot().pending, null);
  h.handlers.readSelection = read;
  assert.equal(await h.controller.reconcile(), true);
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
});

test("null operation read only enables explicit retry of the identical request and target", async () => {
  const h = harness();
  await ready(h);
  const normal = h.handlers.disconnect;
  h.handlers.disconnect = async () => { throw { code: "timeout" }; };
  await h.controller.confirm();
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.calls.at(-1)?.requestId, "request-1");
  assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(h.controller.getSnapshot().attempt?.retryAllowed, true);
  assert.equal(h.controller.canConfirm(), false);
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
  h.handlers.disconnect = normal;
  assert.equal(await h.controller.retry(), true);
  const writes = h.calls.filter((call) => call.method === "write");
  assert.equal(writes[0].selection, writes[1].selection);
  assert.equal(writes[0].requestId, writes[1].requestId);
  assert.equal(h.ids(), 1);
});

test("uncertain receipt reconciliation completes only this operation and separately reads terminal state", async () => {
  const h = harness(relationship);
  await ready(h);
  h.handlers.disconnect = async () => { throw { code: "unavailable" }; };
  await h.controller.confirm();
  h.backend.operation = done({ kind: "relationship", id: "relationship-A" }, "request-1");
  h.backend.read = closed(relationship);
  assert.equal(await h.controller.reconcile(), true);
  assert.deepEqual(h.calls.map((call) => call.method), ["read", "write", "operation", "read"]);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(h.controller.getSnapshot().attempt?.receipt?.requestId, "request-1");
});

test("state_conflict refreshes facts without false success or converting accepted invitation to revoke", async () => {
  const h = harness();
  await ready(h);
  h.handlers.disconnect = async () => { h.backend.read = { ...invitation, state: "accepted" }; throw { code: "state_conflict" }; };
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "rejected");
  assert.equal(h.controller.getSnapshot().attempt?.receipt, null);
  assert.equal(h.controller.getSnapshot().issue, "state_conflict");
  assert.deepEqual(h.controller.getSnapshot().confirmed, { ...invitation, state: "accepted" });
  assert.equal(h.controller.canConfirm(), false);
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
  assert.equal(h.calls[1].selection?.kind, "invitation");
});

test("state_conflict on retry cannot settle the first uncertain dispatch", async () => {
  const h = harness();
  await ready(h);
  h.handlers.disconnect = async () => { throw { code: "timeout" }; };
  await h.controller.confirm();
  await h.controller.reconcile();
  h.handlers.disconnect = async () => { throw { code: "state_conflict" }; };
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(h.controller.getSnapshot().attempt?.retryAllowed, false);
  assert.equal(h.controller.getSnapshot().pending, null);
  assert.equal(h.ids(), 1);
});

test("forbidden/stale errors dispose without reporting completion", async () => {
  for (const code of ["forbidden", "operation_stale"]) {
    const h = harness();
    await ready(h);
    h.handlers.disconnect = async () => { throw { code }; };
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.controller.getSnapshot().disposed, true);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().attempt, null);
    assert.equal(await h.controller.retry(), false);
  }
});

test("malformed error objects/getters/Proxies are safe in load/write/reconcile, never pending forever", async () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const error of [null, "raw private message", { code: "rate_limited" }, throwingProperty("code"),
    new Proxy({}, { get: () => { throw new Error("error proxy"); } }), revoked.proxy]) {
    const h = harness();
    await ready(h);
    h.handlers.disconnect = async () => { throw error; };
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().issue, "unavailable");
    assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
    h.handlers.readOwnOperation = async () => { throw error; };
    assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
    h.handlers.readSelection = async () => { throw error; };
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
  }
});

test("receipt getters/Proxies and source method getters sanitize without hanging or false success", async () => {
  const valid = done({ kind: "invitation", id: "invitation-A" }, "request-1");
  for (const value of [throwingProperty("completed", valid), throwingProperty("requestId", valid),
    new Proxy({}, { get: (_, key) => { if (key === "then") return undefined; throw new Error("receipt proxy"); } })]) {
    const h = harness();
    await ready(h);
    h.handlers.disconnect = async () => value as CoachClientDisconnectionReceipt;
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
    h.handlers.readOwnOperation = async () => value as CoachClientDisconnectionReceipt;
    assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
  }
  const h = harness();
  await ready(h);
  Object.defineProperty(h.handlers, "disconnect", { get: () => { throw new Error("source method"); } });
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.controller.getSnapshot().pending, null);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
});

test("source accessor reentrancy cannot revive a controller invalidated while sanitizing", async () => {
  const h = harness();
  await ready(h);
  h.handlers.disconnect = async (selection, requestId) => Object.defineProperty(done(selection, requestId), "completed", {
    get: () => { h.controller.dispose(); return true; },
  });
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.controller.getSnapshot().disposed, true);
  assert.equal(h.controller.getSnapshot().pending, null);
  assert.equal(h.calls.filter((call) => call.method === "read").length, 1);
});

test("reconcile/retry guard synchronous invalidation and remain single-flight", async () => {
  const h = harness();
  await ready(h);
  h.handlers.disconnect = async () => { throw { code: "timeout" }; };
  await h.controller.confirm();
  const pending = deferred<CoachClientDisconnectionReceipt | null>();
  h.handlers.readOwnOperation = () => pending.promise;
  const checking = h.controller.reconcile();
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(await h.controller.retry(), false);
  pending.resolve(null);
  await checking;
  h.controller.subscribe((snapshot) => { if (snapshot.pending === "retry") h.context.generation = 2; });
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
  assert.equal(h.controller.getSnapshot().disposed, true);
});

test("listener exceptions and reentrant double-confirm never create writes or false uncertainty", async () => {
  const h = harness();
  await ready(h);
  let attempts = 0;
  h.controller.subscribe(() => { throw new Error("private listener data"); });
  h.controller.subscribe((snapshot) => {
    if (snapshot.pending === "confirm") { attempts += 1; void h.controller.confirm(); }
  });
  assert.equal(await h.controller.confirm(), true);
  assert.equal(h.controller.getSnapshot().issue, null);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
  assert.ok(attempts > 0);
  assert.doesNotThrow(() => h.controller.dispose());
});

test("invalid/reused request factories never dispatch a new logical attempt", async () => {
  for (const factory of [() => "", () => " \n", () => { throw throwingProperty("message"); }]) {
    const h = harness(invitation, factory);
    await ready(h);
    assert.equal(await h.controller.confirm(), false);
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().issue, "invalid_request_id");
    assert.equal(h.calls.length, 1);
  }
  const h = harness(invitation, () => "same-id");
  await ready(h);
  h.handlers.disconnect = async () => { throw { code: "state_conflict" }; };
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.controller.canConfirm(), true);
  assert.equal(await h.controller.confirm(), false);
  assert.equal(h.controller.getSnapshot().issue, "invalid_request_id");
  assert.equal(h.calls.filter((call) => call.method === "write").length, 1);
});

test("allowlists never read identity/code extras; snapshots and completion signals are frozen", async () => {
  let reads = 0;
  const raw = { ...invitation };
  for (const key of ["code", "name", "email", "owner_id"]) Object.defineProperty(raw, key, { get: () => { reads += 1; throw new Error("not authorized"); } });
  const h = harness(raw);
  await ready(h);
  assert.equal(reads, 0);
  assert.deepEqual(Object.keys(h.controller.getSnapshot().confirmed!).sort(), ["id", "kind", "state"]);
  assert.equal(await h.controller.confirm(), true);
  const snapshot = h.controller.getSnapshot();
  for (const value of [snapshot, snapshot.confirmed, snapshot.attempt, snapshot.attempt?.selection, snapshot.attempt?.receipt]) assert.equal(Object.isFrozen(value), true);
  assert.deepEqual(Object.keys(snapshot.attempt!.receipt!).sort(), ["completed", "id", "kind", "requestId"]);
  const signal = snapshot.attempt!.receipt!.requestId;
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot(), snapshot);
  assert.equal(signal, "request-1");
});

test("an isCurrent callback that disposes then returns true cannot re-enable subscription or dispatch", async () => {
  const h = harness();
  let controller: CoachClientDisconnectionController | null = null;
  controller = createCoachClientDisconnectionController({ ...h.input, isCurrent: () => { controller?.dispose(); return true; } });
  assert.equal(await controller.load(), false);
  assert.equal(controller.getSnapshot().disposed, true);
  assert.equal(h.calls.length, 0);
});

test("controller/reconciliation have no payment draft, data, UI, clock, randomness or I/O dependency", () => {
  for (const name of ["coach-client-disconnection-contract.ts", "coach-client-disconnection-controller.ts", "coach-client-disconnection-reconciliation.ts"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage)\b|Date\.now|new Date\(|Math\.random|randomUUID|setTimeout|setInterval|\.rpc\(|process\.env/);
    assert.doesNotMatch(source, /from ["'][^"']*(?:\/data\/|\/components\/|coach-dashboard|supabase)[^"']*["']/);
  }
});
