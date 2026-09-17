import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoachInvitationActionsController } from "./coach-invitation-actions-controller";
import type { CoachInvitationActionKind, CoachInvitationActionsCommand, CoachInvitationActionsController,
  CoachInvitationActionsOperation, CoachInvitationActionsRead, CoachInvitationActionsResult,
  CoachInvitationActionsSource } from "./coach-invitation-actions-contract";

const max = 2_147_483_647;
const serverNow = "2026-09-09T12:00:00.123456Z";
const retryAt = "2026-09-09T12:01:00.123456Z";
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
async function settlesFalse(promise: Promise<boolean>) { assert.equal(await Promise.race([promise, Promise.resolve("pending")]), false); }
function detail(generation = 1, state: CoachInvitationActionsRead["state"] = "pending"): CoachInvitationActionsRead {
  return { id: "invitation-A", generation, state,
    expiresAt: "2026-09-16T12:00:00.123456Z", code: state === "pending" ? "AB2-CD3-EF4" : null };
}
function operation(action: CoachInvitationActionKind, command: CoachInvitationActionsCommand): CoachInvitationActionsOperation {
  return { ...command, action, generation: command.expectedGeneration + (action === "regenerate" ? 1 : 0),
    state: "reserved", reservedAt: serverNow };
}
function recorded(op: CoachInvitationActionsOperation): CoachInvitationActionsResult { return { status: "recorded", serverNow, operation: op }; }
function rateLimited(): CoachInvitationActionsResult { return { status: "rate_limited", serverNow, retryAt }; }
function harness(initial = detail(), factory?: () => string) {
  const context = { owner: "coach-A", generation: 1, portal: "coach", selected: "invitation-A" };
  const backend = { read: initial, operations: new Map<string, CoachInvitationActionsOperation>() };
  const calls: { kind: CoachInvitationActionKind | "read" | "operation"; command?: CoachInvitationActionsCommand; id?: string; signal?: AbortSignal }[] = [];
  let ids = 0;
  function reserve(action: CoachInvitationActionKind, command: CoachInvitationActionsCommand) {
    const old = backend.operations.get(command.requestId);
    if (old) return recorded(old);
    if (command.invitationId !== backend.read.id || command.expectedGeneration !== backend.read.generation
      || backend.read.state !== (action === "resend" ? "pending" : "expired")
      || (action === "regenerate" && command.expectedGeneration === max)) throw { code: "state_conflict" };
    const op = operation(action, command);
    backend.read = detail(op.generation);
    backend.operations.set(op.requestId, op);
    return recorded(op);
  }
  const handler: CoachInvitationActionsSource = {
    resend: async (command) => reserve("resend", command),
    regenerate: async (command) => reserve("regenerate", command),
    readInvitation: async () => backend.read,
    readOwnOperation: async (id) => backend.operations.get(id) ?? null,
  };
  const source: CoachInvitationActionsSource = {
    resend: (command, options) => { calls.push({ kind: "resend", command, signal: options?.signal }); return handler.resend(command, options); },
    regenerate: (command, options) => { calls.push({ kind: "regenerate", command, signal: options?.signal }); return handler.regenerate(command, options); },
    readInvitation: (id, options) => { calls.push({ kind: "read", id, signal: options?.signal }); return handler.readInvitation(id, options); },
    readOwnOperation: (id, options) => { calls.push({ kind: "operation", id, signal: options?.signal }); return handler.readOwnOperation(id, options); },
  };
  const input = { selection: { invitationId: "invitation-A" }, source,
    isCurrent: () => context.owner === "coach-A" && context.generation === 1 && context.portal === "coach" && context.selected === "invitation-A",
    createRequestId: () => { ids += 1; return factory ? factory() : "request-" + ids; } };
  const controller = createCoachInvitationActionsController(input);
  return { context, backend, handler, source, calls, input, controller, ids: () => ids };
}
async function ready(h: ReturnType<typeof harness>) { assert.equal(await h.controller.load(), true); h.calls.length = 0; }
async function uncertain(h: ReturnType<typeof harness>, action: CoachInvitationActionKind = "resend") {
  await ready(h);
  h.handler[action] = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller[action](), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
}

test("construction is idle without callbacks/I/O; action readiness requires explicit confirmed server load", async () => {
  const h = harness();
  assert.deepEqual(h.controller.getSnapshot(), { confirmed: null, pending: null, attempt: null, rateLimit: null,
    issue: null, needsRefresh: false, disposed: false });
  let count = 0;
  const off = h.controller.subscribe(() => { count += 1; });
  assert.equal(count, 0);
  assert.equal(h.controller.canResend(), false); assert.equal(h.controller.canRegenerate(), false);
  assert.deepEqual(await Promise.all([h.controller.resend(), h.controller.regenerate(), h.controller.retry(), h.controller.reconcile()]), [false, false, false, false]);
  assert.equal(h.calls.length, 0); assert.equal(h.ids(), 0);
  await ready(h);
  assert.equal(h.controller.canResend(), true); assert.equal(h.controller.canRegenerate(), false);
  assert.equal(h.ids(), 0); off();
});

test("server pending/expired/closed determines action without implicit clocks or generation defaults", async () => {
  for (const state of ["pending", "expired", "cancelled", "accepted"] as const) {
    const h = harness(detail(7, state)); await ready(h);
    assert.equal(h.controller.canResend(), state === "pending");
    assert.equal(h.controller.canRegenerate(), state === "expired");
    const wrong = state === "expired" ? "resend" : "regenerate";
    assert.equal(await h.controller[wrong](), false);
    if (state === "cancelled" || state === "accepted") assert.equal(await h.controller.resend(), false);
    assert.equal(h.calls.length, 0); assert.equal(h.ids(), 0);
  }
});

test("resend freezes exact id/generation/request; regeneration freezes old generation and confirms G+1", async () => {
  for (const action of ["resend", "regenerate"] as const) {
    const h = harness(detail(12, action === "resend" ? "pending" : "expired")); await ready(h);
    assert.equal(await h.controller[action](), true);
    assert.deepEqual(h.calls.map((call) => call.kind), [action, "read"]);
    assert.deepEqual(h.calls[0].command, { invitationId: "invitation-A", expectedGeneration: 12, requestId: "request-1" });
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.attempt!.expectedGeneration, 12);
    assert.equal(snapshot.attempt!.operation!.expectedGeneration, 12);
    assert.equal(snapshot.confirmed!.generation, action === "resend" ? 12 : 13);
    assert.equal(snapshot.attempt!.resolution, "reserved");
    assert.equal(h.controller.canResend(), false); assert.equal(h.controller.canRegenerate(), false);
    assert.equal(await h.controller[action](), false); assert.equal(h.ids(), 1);
  }
});

test("new explicit load is required after resolved action before another new id/action", async () => {
  const h = harness(detail(2, "expired")); await ready(h);
  assert.equal(await h.controller.regenerate(), true);
  assert.equal(await h.controller.resend(), false);
  await ready(h);
  assert.equal(h.controller.getSnapshot().attempt, null);
  assert.equal(await h.controller.resend(), true);
  assert.equal(h.calls[0].command!.expectedGeneration, 3);
  assert.equal(h.calls[0].command!.requestId, "request-2");
});

test("post-read generation race is rejected by the synthetic atomic source without rebasing or fallback", async () => {
  for (const action of ["resend", "regenerate"] as const) {
    const h = harness(detail(1, action === "resend" ? "pending" : "expired")); await ready(h);
    h.backend.read = detail(2, action === "resend" ? "pending" : "expired");
    assert.equal(await h.controller[action](), false);
    assert.equal(h.calls[0].command!.expectedGeneration, 1);
    assert.equal(h.backend.operations.size, 0);
    assert.equal(h.controller.getSnapshot().issue, "state_conflict");
    assert.equal(h.controller.getSnapshot().attempt!.phase, "rejected");
    assert.equal(h.controller.canResend(), false);
    assert.equal(h.calls.length, 1);
  }
});

test("generation range is strict through INT_MAX; regenerate MAX is sent unchanged for server conflict", async () => {
  for (const value of [null, undefined, 0, -1, 1.5, NaN, Infinity, max + 1, Number.MAX_SAFE_INTEGER, "1"]) {
    const h = harness({ ...detail(), generation: value as number });
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.ids(), 0);
  }
  const resend = harness(detail(max)); await ready(resend);
  assert.equal(await resend.controller.resend(), true);
  const regenerate = harness(detail(max, "expired")); await ready(regenerate);
  assert.equal(regenerate.controller.canRegenerate(), true);
  assert.equal(await regenerate.controller.regenerate(), false);
  assert.equal(regenerate.calls[0].command!.expectedGeneration, max);
  assert.equal(regenerate.controller.getSnapshot().issue, "state_conflict");
});

test("load failure is not empty/zero/closed and invalid selections never reach source", async () => {
  const h = harness();
  h.handler.readInvitation = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().confirmed, null);
  assert.equal(h.controller.getSnapshot().pending, null);
  assert.equal(h.controller.getSnapshot().issue, "timeout");
  for (const selection of [null, {}, { invitationId: "" }, { invitationId: 0 }, { get invitationId() { throw Error("private"); } },
    new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private"); } })]) {
    const c = createCoachInvitationActionsController({ ...h.input, selection: selection as typeof h.input.selection });
    assert.equal(c.getSnapshot().issue, "invalid_selection");
    assert.equal(await c.load(), false); assert.equal(await c.resend(), false);
  }
  assert.equal(h.calls.length, 1);
});

test("allowlist copies authorized code but omits email/provider/ownership without touching unrelated getters", async () => {
  const original = { ...detail(4), recipientEmail: "private", ownerId: "private", get privateValue() { throw Error("must not read"); } };
  const h = harness(original); await ready(h);
  assert.deepEqual(h.controller.getSnapshot().confirmed, detail(4));
  assert.equal(Object.isFrozen(original), false);
  original.generation = 8;
  assert.equal(h.controller.getSnapshot().confirmed!.generation, 4);
  const rawOp = { ...operation("resend", { invitationId: "invitation-A", expectedGeneration: 4, requestId: "request-1" }), provider: "private" };
  const rawResult = { ...recorded(rawOp), delivery: "private" };
  h.handler.resend = async () => rawResult;
  h.handler.readInvitation = async () => detail(4);
  assert.equal(await h.controller.resend(), true);
  const s = h.controller.getSnapshot();
  assert.equal(Object.isFrozen(h.input), false); assert.equal(Object.isFrozen(h.input.selection), false);
  assert.equal(Object.isFrozen(h.source), false); assert.equal(Object.isFrozen(rawOp), false); assert.equal(Object.isFrozen(rawResult), false);
  assert.equal(Object.isFrozen(s), true); assert.equal(Object.isFrozen(s.attempt), true);
  assert.equal(Object.isFrozen(s.attempt!.operation), true); assert.equal(Object.isFrozen(s.confirmed), true);
  assert.deepEqual(Object.keys(s.attempt!.operation!).sort(), ["requestId", "action", "state", "invitationId", "expectedGeneration", "generation", "reservedAt"].sort());
  assert.equal(s.confirmed?.code, "AB2-CD3-EF4");
  assert.doesNotMatch(JSON.stringify(s), /private|provider|delivery|recipientEmail|ownerId|privateValue/);
});

test("double taps and cross-action calls are single-flight through post-write detail read", async () => {
  const h = harness(); await ready(h);
  const mutation = deferred<CoachInvitationActionsResult>(); h.handler.resend = () => mutation.promise;
  const work = h.controller.resend();
  assert.equal(await h.controller.resend(), false); assert.equal(await h.controller.regenerate(), false);
  assert.equal(await h.controller.load(), false); assert.equal(await h.controller.reconcile(), false); assert.equal(await h.controller.retry(), false);
  assert.equal(h.calls.length, 1); assert.equal(h.ids(), 1);
  const fresh = deferred<CoachInvitationActionsRead>(); h.handler.readInvitation = () => fresh.promise;
  mutation.resolve(recorded(operation("resend", h.calls[0].command!))); await flush();
  assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
  assert.equal(await h.controller.load(), false); assert.equal(await h.controller.resend(), false);
  fresh.resolve(detail()); assert.equal(await work, true);
});

test("replacing load settles cancelled public promise despite ignored abort and discards late success/error", async () => {
  for (const late of ["success", "error"] as const) {
    const h = harness(); const old = deferred<CoachInvitationActionsRead>();
    h.handler.readInvitation = () => old.promise;
    const first = h.controller.load();
    h.handler.readInvitation = async () => detail(9, "expired");
    assert.equal(await h.controller.load(), true); await settlesFalse(first);
    assert.equal(h.calls[0].signal!.aborted, true);
    if (late === "success") old.resolve(detail(1)); else old.reject(Error("late private"));
    await flush();
    assert.deepEqual(h.controller.getSnapshot().confirmed, detail(9, "expired"));
    assert.equal(h.controller.getSnapshot().issue, null);
  }
});

test("aborting a replaced load cannot start a reentrant third read or write", async () => {
  const h = harness(); const old = deferred<CoachInvitationActionsRead>(); const nested: Promise<boolean>[] = [];
  h.handler.readInvitation = (_id, options) => {
    options!.signal!.addEventListener("abort", () => { nested.push(h.controller.load(), h.controller.resend()); });
    return old.promise;
  };
  const first = h.controller.load(); h.handler.readInvitation = async () => detail(5);
  assert.equal(await h.controller.load(), true); await settlesFalse(first);
  assert.deepEqual(await Promise.all(nested), [false, false]);
  assert.equal(h.calls.length, 2); old.resolve(detail());
});

test("load failure after resolved action does not discard operation evidence or authorize a new intent", async () => {
  const h = harness(); await ready(h); await h.controller.resend();
  const attempt = h.controller.getSnapshot().attempt;
  h.handler.readInvitation = async () => { throw { code: "unavailable" }; };
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().attempt, attempt);
  assert.equal(h.controller.getSnapshot().confirmed, null);
  assert.equal(h.controller.canResend(), false);
});

test("timeout/null reconciliation only allows exact same action/id/generation/request retry", async () => {
  for (const action of ["resend", "regenerate"] as const) {
    const h = harness(detail(5, action === "resend" ? "pending" : "expired")); await uncertain(h, action);
    const first = h.calls[0].command;
    assert.equal(await h.controller.retry(), false); assert.equal(await h.controller.load(), false);
    assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, true);
    assert.equal(h.calls[1].id, "request-1");
    h.handler[action] = async (command) => { h.backend.read = detail(action === "resend" ? 5 : 6); return recorded(operation(action, command)); };
    assert.equal(await h.controller.retry(), true);
    assert.deepEqual(h.calls[2].command, first);
    assert.equal(h.calls[2].kind, action); assert.equal(h.ids(), 1);
  }
});

test("retry never drops expectedGeneration or switches resend to regeneration when state changed", async () => {
  const h = harness(); await uncertain(h); await h.controller.reconcile();
  h.backend.read = detail(2, "expired");
  h.handler.resend = async (command) => { assert.equal(command.expectedGeneration, 1); throw { code: "state_conflict" }; };
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
  assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
  assert.equal(h.calls.some((call) => call.kind === "regenerate"), false);
  assert.equal(h.ids(), 1);
});

test("recorded reconciliation always rereads operation and fresh detail, with no new request/write", async () => {
  const h = harness(); await uncertain(h);
  h.backend.operations.set("request-1", operation("resend", h.calls[0].command!));
  assert.equal(await h.controller.reconcile(), true);
  assert.deepEqual(h.calls.map((call) => call.kind), ["resend", "operation", "read"]);
  assert.equal(await h.controller.reconcile(), true);
  assert.deepEqual(h.calls.slice(-2).map((call) => call.kind), ["operation", "read"]);
  assert.equal(h.ids(), 1);
});

test("known operation null never becomes absence; v1 conflict is an error and cannot enable retry", async () => {
  const h = harness(); await ready(h); await h.controller.resend();
  const known = h.controller.getSnapshot().attempt!.operation;
  h.handler.readOwnOperation = async () => null;
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().attempt!.operation, known);
  assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
  assert.equal(h.controller.getSnapshot().issue, "invalid_response");
  for (const code of ["invalid_input", "request_conflict", "state_conflict"] as const) {
    const c = harness(); await uncertain(c);
    c.handler.readOwnOperation = async () => { throw { code }; };
    assert.equal(await c.controller.reconcile(), false);
    assert.equal(c.controller.getSnapshot().attempt!.retryAllowed, false);
    assert.equal(c.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(await c.controller.retry(), false);
  }
});

test("old operations may become cancelled; newer detail is inactive, never a newly adopted reservation", async () => {
  const h = harness(); await ready(h); await h.controller.resend();
  const old = h.backend.operations.get("request-1")!;
  h.backend.operations.set("request-1", { ...old, state: "cancelled" });
  h.backend.read = detail(2);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "resolved");
  assert.equal(h.controller.getSnapshot().attempt!.resolution, "inactive");
  assert.equal(h.controller.getSnapshot().confirmed, null);
  assert.equal(h.controller.getSnapshot().attempt!.operation!.generation, 1);
  assert.equal(h.controller.canResend(), false);
});

test("exact closed states resolve inactive for reserved/cancelled operations with no other action", async () => {
  for (const action of ["resend", "regenerate"] as const) for (const opState of ["reserved", "cancelled"] as const) {
    for (const state of ["expired", "cancelled", "accepted"] as const) {
      const h = harness(detail(8, action === "resend" ? "pending" : "expired")); await ready(h);
      const generation = action === "resend" ? 8 : 9;
      h.handler[action] = async (command) => recorded({ ...operation(action, command), state: opState });
      h.handler.readInvitation = async () => detail(generation, state);
      assert.equal(await h.controller[action](), false);
      assert.equal(h.controller.getSnapshot().attempt!.resolution, "inactive");
      assert.equal(h.controller.getSnapshot().confirmed!.state, state);
      assert.equal(h.controller.getSnapshot().issue, null);
      assert.equal(h.calls.length, 2);
    }
  }
});

test("older generation and cancelled-plus-pending same generation preserve unresolved evidence", async () => {
  for (const cancelled of [false, true]) {
    const h = harness(detail(4)); await ready(h);
    h.handler.resend = async (command) => recorded({ ...operation("resend", command), state: cancelled ? "cancelled" : "reserved" });
    h.handler.readInvitation = async () => detail(cancelled ? 4 : 3);
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(await h.controller.load(), false);
  }
});

test("cancelled operation never reverts reserved even when same current detail looks valid", async () => {
  const h = harness(); await ready(h);
  h.handler.resend = async (command) => recorded({ ...operation("resend", command), state: "cancelled" });
  h.handler.readInvitation = async () => detail(1, "cancelled");
  await h.controller.resend();
  h.handler.readOwnOperation = async () => operation("resend", h.calls[0].command!);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().attempt!.operation!.state, "cancelled");
  assert.equal(h.controller.getSnapshot().issue, "invalid_response");
});

test("malformed or mismatched operation bindings are not receipts and prevent fresh-detail dispatch", async () => {
  for (const patch of [{ action: "create" }, { action: "regenerate" }, { requestId: "other" }, { invitationId: "other" },
    { expectedGeneration: 2 }, { generation: 2 }, { expectedGeneration: undefined }, { generation: 0 },
    { expectedGeneration: max + 1 }, { state: "completed" }, { reservedAt: null }]) {
    const h = harness(); await ready(h);
    h.handler.resend = async (command) => recorded({ ...operation("resend", command), ...patch } as CoachInvitationActionsOperation);
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
  }
  const regen = harness(detail(4, "expired")); await ready(regen);
  regen.handler.regenerate = async (command) => recorded({ ...operation("regenerate", command), generation: 4 });
  assert.equal(await regen.controller.regenerate(), false); assert.equal(regen.calls.length, 1);
});

test("initial server rate-limit permits explicit backend recheck of the same immutable command", async () => {
  const h = harness(); await ready(h);
  h.handler.resend = async () => rateLimited();
  assert.equal(await h.controller.resend(), false);
  const s = h.controller.getSnapshot();
  assert.deepEqual(s.rateLimit, { serverNow, retryAt }); assert.equal(Object.isFrozen(s.rateLimit), true);
  assert.equal(s.attempt!.phase, "rate-limited"); assert.equal(s.attempt!.retryAllowed, true);
  assert.equal(await h.controller.load(), false); assert.equal(await h.controller.regenerate(), false);
  assert.equal(await h.controller.retry(), false);
  assert.deepEqual(h.calls[0].command, h.calls[1].command);
  assert.equal(h.ids(), 1); assert.equal(h.calls.length, 2);
});

test("rate-limit after prior uncertainty cannot erase it or directly authorize another retry", async () => {
  const h = harness(); await uncertain(h); await h.controller.reconcile();
  h.handler.resend = async () => rateLimited();
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
  assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
  assert.equal(h.controller.getSnapshot().needsRefresh, true);
  assert.equal(await h.controller.retry(), false);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, true);
  assert.equal(h.ids(), 1);
});

test("definitive rejection requires load and new request id; ids cannot be recycled across intentions", async () => {
  const h = harness(detail(), () => "same-request"); await ready(h);
  h.handler.resend = async () => { throw { code: "state_conflict" }; };
  assert.equal(await h.controller.resend(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "rejected");
  assert.equal(await h.controller.resend(), false); await ready(h);
  assert.equal(await h.controller.resend(), false);
  assert.equal(h.controller.getSnapshot().issue, "invalid_request_id");
  assert.equal(h.calls.length, 0); assert.equal(h.ids(), 2);
});

test("transient failures preserve frozen binding and block new actions until explicit reconciliation", async () => {
  for (const code of ["aborted", "timeout", "unavailable", "invalid_response", "request_conflict"]) {
    const h = harness(detail(42)); await ready(h); h.handler.resend = async () => { throw { code }; };
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.controller.getSnapshot().attempt!.expectedGeneration, 42);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(await h.controller.resend(), false); assert.equal(await h.controller.regenerate(), false);
    assert.equal(await h.controller.load(), false); assert.equal(await h.controller.retry(), false);
    assert.equal(h.ids(), 1);
  }
});

test("post-operation detail failure keeps receipt; reconcile verifies operation again before publishing", async () => {
  const h = harness(); await ready(h);
  h.handler.readInvitation = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller.resend(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
  assert.equal(await h.controller.retry(), false);
  h.handler.readInvitation = async () => detail();
  assert.equal(await h.controller.reconcile(), true);
  assert.deepEqual(h.calls.map((call) => call.kind), ["resend", "read", "operation", "read"]);
});

test("request-id callback reentry cannot load/write twice and context invalidation prevents dispatch", async () => {
  for (const change of ["dispose", "generation", "selection"] as const) {
    const nested: Promise<boolean>[] = [];
    const h: ReturnType<typeof harness> = harness(detail(), () => {
      nested.push(h.controller.load(), h.controller.resend(), h.controller.regenerate(), h.controller.reconcile(), h.controller.retry());
      if (change === "dispose") h.controller.dispose();
      else if (change === "generation") h.context.generation = 2;
      else h.context.selected = "invitation-B";
      return "request-factory";
    });
    await ready(h);
    assert.equal(await h.controller.resend(), false);
    assert.deepEqual(await Promise.all(nested), [false, false, false, false, false]);
    assert.equal(h.calls.length, 0); assert.equal(h.ids(), 1);
    assert.equal(h.controller.getSnapshot().disposed, true);
  }
  for (const factory of [() => "", () => " ", () => { throw Error("private factory"); }]) {
    const h = harness(detail(), factory); await ready(h);
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_request_id"); assert.equal(h.calls.length, 0);
  }
});

test("captured selection/callback references do not follow mutable caller input", async () => {
  const h = harness(); await ready(h);
  h.input.selection.invitationId = "invitation-B";
  h.input.isCurrent = () => false;
  h.input.createRequestId = () => { throw Error("mutated"); };
  assert.equal(await h.controller.resend(), true);
  assert.equal(h.calls[0].command!.invitationId, "invitation-A");
  assert.equal(h.ids(), 1);
});

test("listeners are isolated, unsubscribe is effective, and reentrant async methods never dispatch", async () => {
  const h = harness(); await ready(h);
  let removed = 0; let off = () => {};
  const nested: Promise<boolean>[] = [];
  h.controller.subscribe(() => {
    off(); nested.push(h.controller.load(), h.controller.resend(), h.controller.regenerate(), h.controller.retry(), h.controller.reconcile());
    throw Error("listener private");
  });
  off = h.controller.subscribe(() => { removed += 1; });
  assert.equal(await h.controller.resend(), true);
  assert.equal(removed, 0); assert.equal((await Promise.all(nested)).every((result) => result === false), true);
  assert.equal(h.controller.getSnapshot().issue, null); assert.equal(h.ids(), 1);
});

test("listener invalidation at pending or attempt publication prevents any write", async () => {
  for (const stage of ["pending", "attempt"] as const) {
    const h = harness(); await ready(h);
    h.controller.subscribe((s) => {
      if (stage === "pending" ? s.pending === "resend" : s.attempt !== null) h.context.generation = 2;
    });
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.calls.length, 0); assert.equal(h.controller.getSnapshot().disposed, true);
  }
});

test("load completion listener cannot turn success into dispatch, and disposal changes public result to false", async () => {
  const h = harness();
  h.controller.subscribe((s) => { if (s.confirmed) h.controller.dispose(); });
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().disposed, true);
  assert.equal(h.ids(), 0);
});

test("getSnapshot purges account/session-generation/portal/selection changes monotonically without I/O", async () => {
  for (const key of ["owner", "generation", "portal", "selected"] as const) {
    const h = harness(); await ready(h); let notices = 0;
    h.controller.subscribe(() => { notices += 1; });
    const before = h.context[key];
    Object.assign(h.context, { [key]: key === "generation" ? 2 : "changed" });
    assert.equal(h.controller.getSnapshot().disposed, true);
    assert.equal(h.controller.getSnapshot().confirmed, null); assert.equal(notices, 0);
    Object.assign(h.context, { [key]: before });
    assert.equal(await h.controller.load(), false); assert.equal(await h.controller.resend(), false);
    assert.equal(h.calls.length, 0);
  }
});

test("throwing or recursively inspecting current-context guards fail closed without escaping", async () => {
  const h = harness();
  const c = createCoachInvitationActionsController({ ...h.input, isCurrent: () => { throw Error("private guard"); } });
  assert.equal(c.getSnapshot().disposed, true); assert.equal(await c.load(), false);
  const recursive: CoachInvitationActionsController = createCoachInvitationActionsController({ ...h.input, isCurrent: () => { recursive.getSnapshot(); return true; } });
  assert.equal(recursive.getSnapshot().disposed, true); assert.equal(await recursive.resend(), false);
  assert.equal(h.calls.length, 0);
});

test("dispose settles ignored source promises in load/write/operation/detail; late results cannot restore state", async () => {
  for (const stage of ["load", "write", "operation", "detail"] as const) for (const outcome of ["success", "error"] as const) {
    const h = harness(); const pending = deferred<unknown>();
    let work: Promise<boolean>;
    if (stage === "load") {
      h.handler.readInvitation = () => pending.promise as Promise<CoachInvitationActionsRead>; work = h.controller.load();
    } else if (stage === "operation") {
      await uncertain(h); h.handler.readOwnOperation = () => pending.promise as Promise<CoachInvitationActionsOperation | null>;
      work = h.controller.reconcile();
    } else {
      await ready(h);
      if (stage === "write") h.handler.resend = () => pending.promise as Promise<CoachInvitationActionsResult>;
      else h.handler.readInvitation = () => pending.promise as Promise<CoachInvitationActionsRead>;
      work = h.controller.resend(); await flush();
    }
    const count = h.calls.length;
    h.controller.dispose(); await settlesFalse(work);
    assert.equal(h.calls[count - 1].signal!.aborted, true);
    assert.deepEqual(h.controller.getSnapshot(), { confirmed: null, pending: null, attempt: null, rateLimit: null,
      issue: null, needsRefresh: false, disposed: true });
    if (outcome === "success") pending.resolve(detail()); else pending.reject(Error("late private"));
    await flush(); assert.equal(h.calls.length, count);
    assert.equal(await h.controller.load(), false); assert.equal(await h.controller.retry(), false);
  }
});

test("late mutation after context change cannot trigger detail or resolve into another owner", async () => {
  const h = harness(); await ready(h);
  const write = deferred<CoachInvitationActionsResult>(); h.handler.resend = () => write.promise;
  const work = h.controller.resend(); h.context.generation = 2;
  write.resolve(recorded(operation("resend", h.calls[0].command!)));
  assert.equal(await work, false);
  assert.equal(h.calls.length, 1); assert.equal(h.controller.getSnapshot().attempt, null);
  h.context.generation = 1; assert.equal(h.controller.getSnapshot().disposed, true);
});

test("fatal errors purge while malformed errors/getters remain safe uncertainty and clear pending", async () => {
  for (const code of ["forbidden", "operation_stale"]) {
    const h = harness(); await ready(h); h.handler.resend = async () => { throw { code }; };
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.controller.getSnapshot().disposed, true); assert.equal(h.controller.getSnapshot().attempt, null);
  }
  for (const error of [null, "private", new Error("private JWT"), { code: "rate_limited", message: "private" },
    { get code() { throw Error("private getter"); } }, new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private proxy"); } })]) {
    const h = harness(); await ready(h); h.handler.resend = () => { throw error; };
    assert.equal(await h.controller.resend(), false);
    assert.equal(h.controller.getSnapshot().issue, "unavailable");
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain"); assert.equal(h.controller.getSnapshot().pending, null);
    assert.doesNotMatch(JSON.stringify(h.controller.getSnapshot()), /private|JWT/);
  }
});

test("malformed response fields/getters/Proxies cannot escape, hang pending, or publish false facts", async () => {
  for (const result of [null, {}, [], { status: "other" }, { status: "rate_limited", serverNow, retryAt: null },
    { get status() { throw Error("private"); } }, new Proxy({}, { getOwnPropertyDescriptor() { throw Error("private"); } })]) {
    const h = harness(); await ready(h); h.handler.resend = async () => result as unknown as CoachInvitationActionsResult;
    assert.equal(await h.controller.resend(), false); assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
  }
  for (const read of [null, {}, { ...detail(), id: "other" }, { ...detail(), state: "sent" },
    { ...detail(), get generation() { throw Error("private"); } }]) {
    const h = harness(); h.handler.readInvitation = async () => read as CoachInvitationActionsRead;
    assert.equal(await h.controller.load(), false); assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().confirmed, null);
  }
});

test("method accessor invalidation is checked before dispatching load/write/reconcile/detail", async () => {
  for (const method of ["readInvitation", "resend", "readOwnOperation", "detail"] as const) {
    const h = harness();
    if (method === "readOwnOperation") await uncertain(h);
    else if (method !== "readInvitation") await ready(h);
    const key = method === "detail" ? "readInvitation" : method;
    const original = h.source[key];
    Object.defineProperty(h.source, key, { get: () => { h.controller.dispose(); return original; } });
    const before = h.calls.length;
    const result = method === "readInvitation" ? h.controller.load() : method === "readOwnOperation" ? h.controller.reconcile() : h.controller.resend();
    assert.equal(await result, false);
    assert.equal(h.calls.length, before + (method === "detail" ? 1 : 0));
    assert.equal(h.controller.getSnapshot().disposed, true);
  }
});

test("malformed source methods and reentrant response proxies are sanitized before any further dispatch", async () => {
  const h = harness(); await ready(h);
  Object.defineProperty(h.source, "resend", { get: () => { throw Error("private method"); } });
  assert.equal(await h.controller.resend(), false);
  assert.equal(h.controller.getSnapshot().issue, "unavailable");
  assert.equal(h.controller.getSnapshot().pending, null);
  const proxy = harness(); await ready(proxy);
  proxy.handler.resend = async (command) => new Proxy(recorded(operation("resend", command)), {
    getOwnPropertyDescriptor(target, key) { proxy.controller.dispose(); return Object.getOwnPropertyDescriptor(target, key); },
  });
  assert.equal(await proxy.controller.resend(), false); assert.equal(proxy.calls.length, 1);
  assert.equal(proxy.controller.getSnapshot().disposed, true);
});

test("actions remain pure, feature-local and incapable of v1 fallback, email/provider or automatic I/O", () => {
  const controller = readFileSync(new URL("./coach-invitation-actions-controller.ts", import.meta.url), "utf8");
  const helper = readFileSync(new URL("./coach-invitation-actions-reconciliation.ts", import.meta.url), "utf8");
  const contract = readFileSync(new URL("./coach-invitation-actions-contract.ts", import.meta.url), "utf8");
  assert.deepEqual([...controller.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ["./coach-invitation-actions-contract", "./coach-invitation-actions-reconciliation"]);
  assert.deepEqual([...helper.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]), ["./coach-invitation-actions-contract"]);
  for (const code of [controller, helper]) {
    assert.doesNotMatch(code, /\b(?:fetch|setTimeout|setInterval|getUser|localStorage|sessionStorage)\s*\(|Date\.now|new Date|Math\.random|crypto\./);
    assert.doesNotMatch(code, /supabase|\.rpc\s*\(|["']use client["']|normalizeRecipientEmail|source\.(?:cancel|create|revoke)/);
    assert.doesNotMatch(code, /actionField\(value,\s*["'](?:recipientEmail|provider|delivery)["']\)/);
  }
  assert.doesNotMatch(contract, /readonly (?:email|recipientEmail|provider|delivery|canCopy|canShare)\s*[?:]/);
});
