import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoachInvitationCreationController } from "./coach-invitation-creation-controller";
import type { CoachInvitationCreationCommand, CoachInvitationCreationController, CoachInvitationCreationOperation,
  CoachInvitationCreationRead, CoachInvitationCreationResult, CoachInvitationCreationSource } from "./coach-invitation-creation-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
async function settledFalse(work: Promise<boolean>) {
  assert.equal(await Promise.race([work, Promise.resolve("not settled")]), false);
}
const canonicalEmail = "student@example.test";
const serverNow = "2026-09-09T10:00:00.000001Z";
const retryAt = "2026-09-09T11:00:00.000001Z";

// Synthetic synchronous adapter with the already approved normalization; no portfolio lookup.
function prepareEmail(raw: string): string {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (/\u0000|[\uD800-\uDFFF]/u.test(raw) || bytes(raw) > 320) throw new Error("synthetic invalid input");
  const value = raw.replace(/^ +| +$/g, "").toLowerCase();
  if (bytes(value) < 3 || bytes(value) > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) throw new Error("synthetic invalid input");
  return value;
}
function receipt(requestId = "request-1", overrides: Partial<CoachInvitationCreationOperation> = {}): CoachInvitationCreationOperation {
  return { requestId, action: "create", state: "reserved", invitationId: "invitation-A", generation: 1,
    reservedAt: "2026-09-09T10:00:00Z", ...overrides };
}
function read(overrides: Partial<CoachInvitationCreationRead> = {}): CoachInvitationCreationRead {
  return { id: "invitation-A", recipientEmail: canonicalEmail, generation: 1, state: "pending", ...overrides };
}
function recorded(operation = receipt()): CoachInvitationCreationResult { return { status: "recorded", serverNow, operation }; }
function rateLimited(): CoachInvitationCreationResult { return { status: "rate_limited", serverNow, retryAt }; }

function harness(options: { prepare?: (raw: string) => string; factory?: () => string } = {}) {
  const context = { owner: "coach-A", generation: 1, portal: "coach" };
  const backend = { operation: null as CoachInvitationCreationOperation | null, detail: read() };
  const calls: { kind: "create" | "operation" | "detail"; command?: CoachInvitationCreationCommand; id?: string; signal?: AbortSignal }[] = [];
  let ids = 0;
  let preparations = 0;
  const handler: CoachInvitationCreationSource = {
    create: async (command) => { backend.operation = receipt(command.requestId); backend.detail = read({ recipientEmail: command.recipientEmail }); return recorded(backend.operation); },
    readOperation: async () => backend.operation,
    readInvitation: async () => backend.detail,
  };
  const source: CoachInvitationCreationSource = {
    create: (command, call) => { calls.push({ kind: "create", command, signal: call?.signal }); return handler.create(command, call); },
    readOperation: (id, call) => { calls.push({ kind: "operation", id, signal: call?.signal }); return handler.readOperation(id, call); },
    readInvitation: (id, call) => { calls.push({ kind: "detail", id, signal: call?.signal }); return handler.readInvitation(id, call); },
  };
  const input = { source, isCurrent: () => context.owner === "coach-A" && context.generation === 1 && context.portal === "coach",
    createRequestId: () => { ids += 1; return options.factory ? options.factory() : `request-${ids}`; },
    prepareRecipientEmail: (raw: string) => { preparations += 1; return options.prepare ? options.prepare(raw) : prepareEmail(raw); },
  };
  const controller = createCoachInvitationCreationController(input);
  return { controller, input, source, handler, calls, backend, context, ids: () => ids, preparations: () => preparations };
}
function ready(h: ReturnType<typeof harness>, raw = "  STUDENT@Example.Test  ") {
  assert.equal(h.controller.setEmail(raw), true);
  assert.equal(h.controller.open(), true);
  assert.equal(h.controller.canSubmit(), true);
}
async function uncertain(h: ReturnType<typeof harness>) {
  ready(h);
  h.handler.create = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
}

test("construction/open/edit/close/subscribe perform no source I/O or request id generation", async () => {
  const h = harness();
  const initial = h.controller.getSnapshot();
  assert.deepEqual(initial, { isOpen: false, emailRaw: "", emailValid: false, pending: null, attempt: null,
    confirmed: null, rateLimit: null, issue: null, needsRefresh: false, disposed: false });
  assert.equal(initial, h.controller.getSnapshot());
  let notifications = 0;
  const unsubscribe = h.controller.subscribe(() => { notifications += 1; });
  assert.equal(notifications, 0);
  assert.equal(h.preparations(), 0);
  assert.equal(await h.controller.submit(), false);
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(await h.controller.retry(), false);
  ready(h);
  assert.equal(h.controller.open(), false);
  assert.equal(h.controller.close(), true);
  assert.equal(h.controller.close(), false);
  assert.equal(h.controller.canSubmit(), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.ids(), 0);
  unsubscribe();
});

test("canonical aliases bind exactly to the intent; raw draft is not overwritten by confirmed detail", async () => {
  for (const raw of ["STUDENT@EXAMPLE.TEST", "  student@example.test  "]) {
    const h = harness();
    ready(h, raw);
    assert.equal(await h.controller.submit(), true);
    assert.deepEqual(h.calls.map((call) => call.kind), ["create", "detail"]);
    assert.deepEqual(h.calls[0].command, { recipientEmail: canonicalEmail, requestId: "request-1" });
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.emailRaw, raw);
    assert.equal(snapshot.confirmed!.recipientEmail, canonicalEmail);
    assert.equal(snapshot.attempt!.phase, "resolved");
    assert.equal(snapshot.attempt!.resolution, "reserved");
    assert.equal(h.controller.canSubmit(), false);
    assert.equal(await h.controller.submit(), false);
    h.controller.close(); h.controller.open(); h.controller.setEmail("another@example.test");
    assert.equal(h.controller.canSubmit(), false);
    assert.equal(h.ids(), 1);
  }
});

test("normalizer callback owns exact email rules; no old TLD2/Unicode trim rule or lookup is introduced", async () => {
  const shortTld = harness();
  ready(shortTld, " USER@EXAMPLE.1 ");
  assert.equal(await shortTld.controller.submit(), true);
  assert.equal(shortTld.calls[0].command!.recipientEmail, "user@example.1");
  for (const raw of ["", "invalid", "\tuser@example.test\t", "\u00a0user@example.test", "x\0@example.test", "\ud800@example.test", "x".repeat(321)]) {
    const h = harness();
    h.controller.open();
    assert.equal(h.controller.setEmail(raw), false);
    assert.equal(h.controller.getSnapshot().emailRaw, raw);
    assert.equal(h.controller.getSnapshot().emailValid, false);
    assert.equal(h.controller.canSubmit(), false);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.calls.length, 0);
    assert.equal(h.ids(), 0);
  }
  const injected = harness({ prepare: () => "authoritative@example.1" });
  ready(injected, "raw accepted by the injected validator");
  assert.equal(await injected.controller.submit(), true);
  assert.equal(injected.calls[0].command!.recipientEmail, "authoritative@example.1");
});

test("only allowlisted immutable copies escape; code/provider material is not read or published", async () => {
  const h = harness();
  const operation = { ...receipt(), code: "not copied", ownerId: "not copied" };
  const detail = { ...read(), providerAccepted: true, cycle: null };
  let codeReads = 0;
  Object.defineProperty(detail, "code", { get: () => { codeReads += 1; throw new Error("must not access"); } });
  h.handler.create = async () => ({ ...recorded(operation), delivery: "delivered" });
  h.handler.readInvitation = async () => detail;
  ready(h);
  assert.equal(await h.controller.submit(), true);
  const snapshot = h.controller.getSnapshot();
  assert.equal(codeReads, 0);
  assert.deepEqual(Object.keys(snapshot.confirmed!).sort(), ["generation", "id", "recipientEmail", "state"]);
  assert.deepEqual(Object.keys(snapshot.attempt!.operation!).sort(), ["action", "generation", "invitationId", "requestId", "reservedAt", "state"]);
  assert.deepEqual(Object.keys(h.calls[0].command!).sort(), ["recipientEmail", "requestId"]);
  for (const value of [snapshot, snapshot.attempt, snapshot.attempt!.operation, snapshot.confirmed, h.calls[0].command]) assert.equal(Object.isFrozen(value), true);
  for (const value of [h.input, h.source, operation, detail]) assert.equal(Object.isFrozen(value), false);
  operation.generation = 8; detail.recipientEmail = "changed@example.test";
  assert.equal(snapshot.attempt!.operation!.generation, 1);
  assert.equal(snapshot.confirmed!.recipientEmail, canonicalEmail);
  assert.doesNotMatch(JSON.stringify(snapshot), /code|provider|delivery|canCopy|canShare|cycle|ownerId/);
});

test("single-flight spans reservation and subsequent detail; duplicate clicks never generate another id", async () => {
  const h = harness();
  const mutation = deferred<CoachInvitationCreationResult>();
  const detail = deferred<CoachInvitationCreationRead>();
  h.handler.create = () => mutation.promise;
  h.handler.readInvitation = () => detail.promise;
  ready(h);
  const work = h.controller.submit();
  assert.equal(h.controller.getSnapshot().pending, "submit");
  assert.equal(await h.controller.submit(), false);
  assert.equal(await h.controller.retry(), false);
  assert.equal(await h.controller.reconcile(), false);
  mutation.resolve(recorded());
  await flush();
  assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
  assert.equal(h.controller.getSnapshot().pending, "submit");
  assert.equal(h.controller.canSubmit(), false);
  detail.resolve(read());
  assert.equal(await work, true);
  assert.equal(h.ids(), 1);
  assert.deepEqual(h.calls.map((call) => call.kind), ["create", "detail"]);
});

test("closed invitation states reconcile the exact binding as inactive, without another action", async () => {
  for (const state of ["expired", "cancelled", "accepted"] as const) {
    for (const operationState of ["reserved", "cancelled"] as const) {
      const h = harness();
      h.handler.create = async () => recorded(receipt("request-1", { state: operationState }));
      h.handler.readInvitation = async () => read({ state });
      ready(h);
      assert.equal(await h.controller.submit(), false);
      assert.equal(h.controller.getSnapshot().attempt!.phase, "resolved");
      assert.equal(h.controller.getSnapshot().attempt!.resolution, "inactive");
      assert.equal(h.controller.getSnapshot().confirmed!.state, state);
      assert.equal(h.controller.getSnapshot().issue, null);
      assert.equal(h.controller.canSubmit(), false);
      assert.equal(h.calls.length, 2);
    }
  }
});

test("new generation resolves old intent inactive without adopting new detail; older/contradictory facts keep tracking", async () => {
  for (const operationState of ["reserved", "cancelled"] as const) {
    const h = harness();
    h.handler.create = async () => recorded(receipt("request-1", { state: operationState }));
    h.handler.readInvitation = async () => read({ generation: 2 });
    ready(h);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().attempt!.resolution, "inactive");
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().attempt!.operation!.generation, 1);
  }
  for (const [operation, detail] of [[receipt("request-1", { generation: 2 }), read()],
    [receipt("request-1", { state: "cancelled" }), read()]] as const) {
    const h = harness();
    h.handler.create = async () => recorded(operation);
    h.handler.readInvitation = async () => detail;
    ready(h);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().needsRefresh, true);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.canSubmit(), false);
  }
});

test("wrong request/action is rejected before detail lookup; wrong detail target/email never becomes confirmed", async () => {
  for (const operation of [receipt("other-request"), { ...receipt(), action: "resend" }, { ...receipt(), action: "revoke" }]) {
    const h = harness();
    h.handler.create = async () => recorded(operation as CoachInvitationCreationOperation);
    ready(h);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().issue, "request_conflict");
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(h.calls.length, 1);
  }
  for (const detail of [read({ id: "other-invitation" }), read({ recipientEmail: "other@example.test" }),
    read({ recipientEmail: "STUDENT@EXAMPLE.TEST" })]) {
    const h = harness();
    h.handler.readInvitation = async () => detail;
    ready(h);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().issue, "request_conflict");
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
    assert.equal(h.controller.getSnapshot().attempt!.resolution, null);
  }
});

test("transport uncertainty preserves the command, blocks new submit and never creates a new id automatically", async () => {
  for (const code of ["timeout", "aborted", "unavailable", "invalid_response", "request_conflict"]) {
    const h = harness();
    ready(h);
    h.handler.create = async () => { throw { code, message: "synthetic private" }; };
    assert.equal(await h.controller.submit(), false);
    h.controller.setEmail("edited@example.test"); h.controller.close(); h.controller.open();
    assert.equal(h.controller.getSnapshot().attempt!.recipientEmail, canonicalEmail);
    assert.equal(h.controller.getSnapshot().emailRaw, "edited@example.test");
    assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
    assert.equal(h.controller.canSubmit(), false);
    assert.equal(await h.controller.submit(), false);
    assert.equal(await h.controller.retry(), false);
    assert.equal(h.ids(), 1);
    assert.equal(h.calls.length, 1);
    assert.equal(JSON.stringify(h.controller.getSnapshot()).includes("private"), false);
  }
});

test("null operation read enables only explicit same-id/email retry, not edited draft or a new attempt", async () => {
  const h = harness();
  await uncertain(h);
  h.controller.setEmail("edited@example.test"); h.controller.close();
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.calls[1].id, "request-1");
  assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, true);
  assert.equal(h.controller.canSubmit(), false);
  h.handler.create = async (command) => { h.backend.operation = receipt(command.requestId); return recorded(h.backend.operation); };
  assert.equal(await h.controller.retry(), true);
  assert.deepEqual(h.calls[2].command, h.calls[0].command);
  assert.equal(h.controller.getSnapshot().emailRaw, "edited@example.test");
  assert.equal(h.controller.getSnapshot().isOpen, false);
  assert.equal(h.ids(), 1);
  assert.equal(h.preparations(), 2);
  assert.deepEqual(h.calls.map((call) => call.kind), ["create", "operation", "create", "detail"]);
});

test("reconciliation with a matching operation reads fresh detail without issuing create again", async () => {
  const h = harness();
  await uncertain(h);
  h.backend.operation = receipt();
  assert.equal(await h.controller.reconcile(), true);
  assert.deepEqual(h.calls.map((call) => call.kind), ["create", "operation", "detail"]);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "resolved");
  assert.equal(h.ids(), 1);
});

test("reconcile rereads a known mutable reservation; cancellation/regeneration cannot reuse stale success", async () => {
  const h = harness();
  ready(h);
  assert.equal(await h.controller.submit(), true);
  h.backend.operation = receipt("request-1", { state: "cancelled" });
  h.backend.detail = read({ generation: 2 });
  assert.equal(await h.controller.reconcile(), false);
  assert.deepEqual(h.calls.map((call) => call.kind), ["create", "detail", "operation", "detail"]);
  assert.equal(h.controller.getSnapshot().attempt!.operation!.state, "cancelled");
  assert.equal(h.controller.getSnapshot().attempt!.resolution, "inactive");
  assert.equal(h.controller.getSnapshot().confirmed, null);
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.ids(), 1);
});

test("null or conflicting operation after known evidence never discards it or permits retry", async () => {
  for (const value of [null, receipt("request-1", { invitationId: "other" }), receipt("request-1", { generation: 2 }), receipt("other-request")]) {
    const h = harness();
    ready(h);
    await h.controller.submit();
    h.handler.readOperation = async () => value;
    assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().attempt!.operation!.invitationId, "invitation-A");
    assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
    assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().needsRefresh, true);
    assert.equal(await h.controller.retry(), false);
  }
});

test("cancelled operation cannot be replayed as reserved later", async () => {
  const h = harness();
  h.handler.create = async () => recorded(receipt("request-1", { state: "cancelled" }));
  h.handler.readInvitation = async () => read({ state: "cancelled" });
  ready(h);
  assert.equal(await h.controller.submit(), false);
  h.handler.readOperation = async () => receipt();
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().issue, "invalid_response");
  assert.equal(h.controller.getSnapshot().attempt!.operation!.state, "cancelled");
  assert.equal(h.calls.filter((call) => call.kind === "create").length, 1);
});

test("detail failure retains recorded operation and next reconcile rereads operation plus detail", async () => {
  const h = harness();
  ready(h);
  h.handler.readInvitation = async () => { throw { code: "timeout" }; };
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
  assert.equal(h.controller.getSnapshot().pending, null);
  h.handler.readInvitation = async () => read();
  assert.equal(await h.controller.reconcile(), true);
  assert.deepEqual(h.calls.map((call) => call.kind), ["create", "detail", "operation", "detail"]);
  assert.equal(h.ids(), 1);
});

test("initial authoritative rate limit permits explicit same-id retry without a clock, polling or extra read", async () => {
  const h = harness();
  const raw = { status: "rate_limited" as const, serverNow, retryAt };
  h.handler.create = async () => raw;
  ready(h);
  assert.equal(await h.controller.submit(), false);
  const limited = h.controller.getSnapshot();
  assert.equal(limited.attempt!.phase, "rate-limited");
  assert.equal(limited.attempt!.retryAllowed, true);
  assert.deepEqual(limited.rateLimit, { serverNow, retryAt });
  assert.equal(Object.isFrozen(limited.rateLimit), true);
  assert.equal(Object.isFrozen(raw), false);
  assert.equal(h.calls.length, 1);
  h.controller.setEmail("different@example.test");
  assert.equal(h.controller.canSubmit(), false);
  assert.equal(await h.controller.submit(), false);
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].command, h.calls[0].command);
  h.handler.create = async () => recorded();
  assert.equal(await h.controller.retry(), true);
  assert.equal(h.ids(), 1);
  assert.equal(h.controller.getSnapshot().rateLimit, null);
  assert.equal(h.controller.getSnapshot().confirmed!.recipientEmail, canonicalEmail);
});

test("rate limit after uncertain history does not establish absence of the first reservation", async () => {
  const h = harness();
  await uncertain(h);
  await h.controller.reconcile();
  h.handler.create = async () => rateLimited();
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
  assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
  assert.equal(h.controller.getSnapshot().needsRefresh, true);
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.ids(), 1);
  h.backend.operation = receipt();
  assert.equal(await h.controller.reconcile(), true);
  assert.equal(h.calls.filter((call) => call.kind === "create").length, 2);
});

test("technical/business rejection after an uncertain retry remains uncertain, never a fresh id", async () => {
  for (const code of ["invalid_input", "state_conflict", "not_found", "retry_required"]) {
    const h = harness();
    await uncertain(h);
    await h.controller.reconcile();
    h.handler.create = async () => { throw { code }; };
    assert.equal(await h.controller.retry(), false);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(h.controller.getSnapshot().attempt!.retryAllowed, false);
    assert.equal(h.controller.canSubmit(), false);
    assert.equal(h.ids(), 1);
  }
});

test("initial definitive rejection permits a new explicit intent, while reused request ids are rejected locally", async () => {
  const h = harness();
  ready(h);
  h.handler.create = async () => { throw { code: "state_conflict" }; };
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.controller.getSnapshot().attempt!.phase, "rejected");
  h.controller.setEmail("other@example.test");
  h.handler.create = async (command) => { h.backend.detail = read({ recipientEmail: command.recipientEmail }); return recorded(receipt(command.requestId)); };
  assert.equal(await h.controller.submit(), true);
  assert.equal(h.ids(), 2);
  assert.equal(h.calls[1].command!.requestId, "request-2");
  const reused = harness({ factory: () => "same-id" });
  ready(reused);
  reused.handler.create = async () => { throw { code: "invalid_input" }; };
  assert.equal(await reused.controller.submit(), false);
  reused.controller.setEmail("changed@example.test");
  assert.equal(await reused.controller.submit(), false);
  assert.equal(reused.controller.getSnapshot().issue, "invalid_request_id");
  assert.equal(reused.calls.length, 1);
});

test("pre-dispatch close/edit from listeners prevents the first write and settles local promise", async () => {
  for (const phase of ["pending", "attempt"] as const) {
    for (const action of ["close", "edit"] as const) {
      const h = harness();
      ready(h);
      h.controller.subscribe((snapshot) => {
        if (snapshot.pending !== "submit" || (phase === "attempt" && snapshot.attempt === null)) return;
        if (action === "close") h.controller.close();
        else h.controller.setEmail("edited@example.test");
      });
      assert.equal(await h.controller.submit(), false);
      assert.equal(h.calls.length, 0);
      assert.equal(h.controller.getSnapshot().pending, null);
      assert.equal(h.controller.getSnapshot().attempt, null);
    }
  }
});

test("close after dispatch preserves the pending promise and frozen intent despite edits and reopening", async () => {
  const h = harness();
  const mutation = deferred<CoachInvitationCreationResult>();
  h.handler.create = () => mutation.promise;
  ready(h);
  const work = h.controller.submit();
  h.controller.close(); h.controller.setEmail("edited@example.test"); h.controller.open();
  assert.equal(h.calls[0].signal!.aborted, false);
  assert.equal(h.controller.getSnapshot().pending, "submit");
  assert.equal(h.controller.getSnapshot().attempt!.recipientEmail, canonicalEmail);
  assert.equal(await Promise.race([work, Promise.resolve("still pending")]), "still pending");
  assert.equal(h.controller.canSubmit(), false);
  mutation.resolve(recorded());
  assert.equal(await work, true);
  assert.equal(h.controller.getSnapshot().emailRaw, "edited@example.test");
  assert.equal(h.controller.getSnapshot().confirmed!.recipientEmail, canonicalEmail);
});

test("synchronous source closure is already post-dispatch and does not erase a real reservation", async () => {
  const h = harness();
  ready(h);
  h.handler.create = () => { h.controller.close(); return Promise.resolve(recorded()); };
  assert.equal(await h.controller.submit(), true);
  assert.equal(h.controller.getSnapshot().isOpen, false);
  assert.equal(h.calls[0].signal!.aborted, false);
  assert.equal(h.controller.getSnapshot().attempt!.resolution, "reserved");
});

test("request id factory is single-use, reentrant-safe and cannot dispatch after editing/closing/context invalidation", async () => {
  for (const action of ["edit", "close", "dispose", "owner"] as const) {
    const h: ReturnType<typeof harness> = harness({ factory: () => {
      void h.controller.submit(); void h.controller.reconcile(); void h.controller.retry();
      if (action === "edit") h.controller.setEmail("edited@example.test");
      else if (action === "owner") h.context.generation = 2;
      else h.controller[action]();
      return "request-callback";
    } });
    ready(h);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.ids(), 1);
    assert.equal(h.calls.length, 0);
    assert.equal(h.controller.getSnapshot().pending, null);
  }
  for (const factory of [() => "", () => " ", () => { throw new Error("private id failure"); }]) {
    const h = harness({ factory });
    ready(h);
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_request_id");
    assert.equal(h.calls.length, 0);
  }
});

test("normalizer is captured and reentry cannot start writes or replace raw text recursively", async () => {
  const nested: Promise<boolean>[] = [];
  const h: ReturnType<typeof harness> = harness({ prepare: (raw) => {
    assert.equal(h.controller.setEmail("recursive@example.test"), false);
    nested.push(h.controller.submit());
    return prepareEmail(raw);
  } });
  ready(h);
  assert.deepEqual(await Promise.all(nested), [false]);
  h.input.prepareRecipientEmail = () => { throw new Error("mutated callback must not run"); };
  h.input.createRequestId = () => { throw new Error("mutated factory must not run"); };
  h.input.isCurrent = () => false;
  assert.equal(await h.controller.submit(), true);
  assert.equal(h.controller.getSnapshot().emailRaw, "  STUDENT@Example.Test  ");
  const stale = harness({ prepare: (raw) => { stale.context.generation = 2; return prepareEmail(raw); } });
  assert.equal(stale.controller.setEmail(canonicalEmail), false);
  assert.equal(stale.controller.getSnapshot().disposed, true);
  assert.equal(stale.calls.length, 0);
});

test("listeners cannot recursively submit/retry/reconcile; exceptions and unsubscribe do not become write uncertainty", async () => {
  const h = harness();
  ready(h);
  let removed = 0;
  let unsubscribe = () => {};
  const nested: Promise<boolean>[] = [];
  h.controller.subscribe(() => {
    unsubscribe();
    nested.push(h.controller.submit(), h.controller.reconcile(), h.controller.retry());
    throw new Error("subscriber private detail");
  });
  unsubscribe = h.controller.subscribe(() => { removed += 1; });
  assert.equal(await h.controller.submit(), true);
  assert.equal(removed, 0);
  assert.ok((await Promise.all(nested)).every((value) => value === false));
  assert.equal(h.controller.getSnapshot().issue, null);
  assert.equal(h.ids(), 1);
});

test("ready listener editing another draft does not clear or rebind the resolved reservation", async () => {
  const h = harness();
  ready(h);
  h.controller.subscribe((snapshot) => {
    if (snapshot.attempt?.phase === "resolved" && snapshot.emailRaw !== "new@example.test") h.controller.setEmail("new@example.test");
  });
  assert.equal(await h.controller.submit(), true);
  assert.equal(h.controller.getSnapshot().emailRaw, "new@example.test");
  assert.equal(h.controller.getSnapshot().attempt!.recipientEmail, canonicalEmail);
  assert.equal(h.controller.getSnapshot().confirmed!.recipientEmail, canonicalEmail);
});

test("account, same-user generation or portal changes latch purge and settle even an ignored source", async () => {
  for (const field of ["owner", "generation", "portal"] as const) {
    const h = harness();
    ready(h);
    const pending = deferred<CoachInvitationCreationResult>();
    h.handler.create = () => pending.promise;
    const work = h.controller.submit();
    if (field === "generation") h.context.generation = 2;
    else h.context[field] = "different";
    assert.equal(h.controller.getSnapshot().disposed, true);
    await settledFalse(work);
    Object.assign(h.context, { owner: "coach-A", generation: 1, portal: "coach" });
    pending.resolve(recorded());
    await flush();
    assert.equal(h.controller.getSnapshot().emailRaw, "");
    assert.equal(h.controller.getSnapshot().attempt, null);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().issue, "operation_stale");
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.calls.length, 1);
  }
});

test("false owner guard before source/detail dispatch prevents I/O and never revives", async () => {
  const h = harness();
  ready(h);
  h.controller.subscribe((snapshot) => { if (snapshot.pending === "submit") h.context.generation = 2; });
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.calls.length, 0);
  const late = harness();
  ready(late);
  late.handler.create = async () => { late.context.generation = 2; return recorded(); };
  assert.equal(await late.controller.submit(), false);
  assert.equal(late.calls.length, 1);
  assert.equal(late.controller.getSnapshot().disposed, true);
});

test("throwing/reentrant guards fail closed and getSnapshot stale purge does not recurse through listeners", async () => {
  const h = harness();
  ready(h);
  let notifications = 0;
  h.controller.subscribe(() => { notifications += 1; h.controller.getSnapshot(); });
  await h.controller.submit();
  const before = notifications;
  h.context.generation = 2;
  assert.equal(h.controller.getSnapshot().disposed, true);
  assert.equal(notifications, before);
  const base = harness();
  const throwing = createCoachInvitationCreationController({ ...base.input, isCurrent: () => { throw new Error("private guard"); } });
  assert.equal(throwing.open(), false);
  assert.equal(throwing.getSnapshot().disposed, true);
  const controller: CoachInvitationCreationController = createCoachInvitationCreationController({ ...base.input,
    isCurrent: () => { controller.getSnapshot(); return true; } });
  assert.equal(controller.open(), false);
  assert.equal(controller.getSnapshot().disposed, true);
});

test("dispose settles ignored mutation, operation and detail Promises; late success/error cannot restore any facts", async () => {
  for (const phase of ["create", "operation", "detail"] as const) {
    for (const reject of [false, true]) {
      const h = harness();
      const later = deferred<unknown>();
      let work: Promise<boolean>;
      if (phase === "operation") {
        await uncertain(h);
        h.handler.readOperation = () => later.promise as Promise<CoachInvitationCreationOperation | null>;
        work = h.controller.reconcile();
      } else {
        ready(h);
        if (phase === "create") h.handler.create = () => later.promise as Promise<CoachInvitationCreationResult>;
        else h.handler.readInvitation = () => later.promise as Promise<CoachInvitationCreationRead>;
        work = h.controller.submit();
        await flush();
      }
      h.controller.dispose();
      await settledFalse(work);
      if (reject) later.reject({ code: "timeout", message: "private late error" });
      else later.resolve(phase === "create" ? recorded() : phase === "operation" ? receipt() : read());
      await flush();
      const snapshot = h.controller.getSnapshot();
      assert.equal(snapshot.disposed, true);
      assert.equal(snapshot.pending, null);
      assert.equal(snapshot.attempt, null);
      assert.equal(snapshot.confirmed, null);
      assert.equal(snapshot.emailRaw, "");
      assert.equal(snapshot.issue, null);
      assert.equal(h.controller.open(), false);
      assert.equal(h.controller.setEmail(canonicalEmail), false);
      assert.equal(await h.controller.retry(), false);
      assert.equal(h.calls.at(-1)!.signal!.aborted, true);
    }
  }
});

test("fatal source errors purge, while malformed errors/getters are safe uncertainty and clear pending", async () => {
  for (const code of ["forbidden", "operation_stale"]) {
    const h = harness();
    ready(h);
    h.handler.create = () => { throw { code }; };
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().disposed, true);
    assert.equal(h.controller.getSnapshot().attempt, null);
    assert.equal(h.controller.getSnapshot().issue, code);
  }
  for (const error of [null, undefined, "private", { code: "unknown" },
    Object.defineProperty({}, "code", { get: () => { throw new Error("getter"); } }),
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy"); } })]) {
    const h = harness();
    ready(h);
    h.handler.create = () => { throw error; };
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().issue, "unavailable");
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(h.controller.getSnapshot().pending, null);
  }
});

test("malformed creation results and accessor/proxy fields never escape or leave pending", async () => {
  const bad = [null, {}, { status: "sent", serverNow }, { status: "rate_limited", serverNow, retryAt: null },
    { ...recorded(), serverNow: null }, recorded(receipt("request-1", { generation: NaN })),
    recorded(receipt("request-1", { generation: 0 })), recorded(receipt("request-1", { generation: Number.MAX_SAFE_INTEGER + 1 })),
    recorded({ ...receipt(), state: "completed" } as unknown as CoachInvitationCreationOperation),
    Object.defineProperty({}, "status", { get: () => { throw new Error("private accessor"); } }),
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("private proxy"); } })];
  for (const result of bad) {
    const h = harness();
    ready(h);
    h.handler.create = async () => result as CoachInvitationCreationResult;
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "uncertain");
    assert.equal(h.controller.getSnapshot().confirmed, null);
  }
});

test("malformed detail/read-operation methods are caught while retaining the correct attempt evidence", async () => {
  for (const value of [null, { ...read(), state: "active" }, { ...read(), generation: -1 }, { ...read(), generation: NaN },
    Object.defineProperty(read(), "recipientEmail", { get: () => { throw new Error("getter"); } }),
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy"); } })]) {
    const h = harness();
    ready(h);
    h.handler.readInvitation = async () => value as CoachInvitationCreationRead;
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.controller.getSnapshot().attempt!.phase, "recorded");
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().pending, null);
  }
  const h = harness();
  await uncertain(h);
  Object.defineProperty(h.source, "readOperation", { get: () => { throw new Error("private method getter"); } });
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.controller.getSnapshot().attempt!.requestId, "request-1");
  assert.equal(h.controller.getSnapshot().issue, "unavailable");
  assert.equal(h.controller.getSnapshot().pending, null);
});

test("source method accessors cannot dispatch after closing the first intent or invalidating its context", async () => {
  for (const action of ["close", "dispose", "generation"] as const) {
    const h = harness();
    ready(h);
    const create = h.source.create;
    Object.defineProperty(h.source, "create", { get: () => {
      if (action === "generation") h.context.generation = 2;
      else h.controller[action]();
      return create;
    } });
    assert.equal(await h.controller.submit(), false);
    assert.equal(h.calls.length, 0);
    assert.equal(h.controller.getSnapshot().pending, null);
  }
  const detail = harness();
  ready(detail);
  const readDetail = detail.source.readInvitation;
  Object.defineProperty(detail.source, "readInvitation", { get: () => { detail.controller.dispose(); return readDetail; } });
  assert.equal(await detail.controller.submit(), false);
  assert.deepEqual(detail.calls.map((call) => call.kind), ["create"]);
  const operation = harness();
  await uncertain(operation);
  const readOperation = operation.source.readOperation;
  Object.defineProperty(operation.source, "readOperation", { get: () => { operation.context.generation = 2; return readOperation; } });
  assert.equal(await operation.controller.reconcile(), false);
  assert.deepEqual(operation.calls.map((call) => call.kind), ["create"]);
  assert.equal(operation.controller.getSnapshot().disposed, true);
});

test("reentrant data proxy invalidation is observed before any detail dispatch or publication", async () => {
  const h = harness();
  ready(h);
  h.handler.create = async () => new Proxy(recorded(), { getOwnPropertyDescriptor: (target, key) => {
    h.controller.dispose(); return Object.getOwnPropertyDescriptor(target, key);
  } });
  assert.equal(await h.controller.submit(), false);
  assert.equal(h.controller.getSnapshot().disposed, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.getSnapshot().attempt, null);
});

test("creation lifecycle stays local and has no code/provider/UI/lookup/clock/automatic retry capability", () => {
  const controller = readFileSync(new URL("./coach-invitation-creation-controller.ts", import.meta.url), "utf8");
  const helper = readFileSync(new URL("./coach-invitation-creation-reconciliation.ts", import.meta.url), "utf8");
  const contract = readFileSync(new URL("./coach-invitation-creation-contract.ts", import.meta.url), "utf8");
  assert.deepEqual([...controller.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]),
    ["./coach-invitation-creation-contract", "./coach-invitation-creation-reconciliation"]);
  assert.deepEqual([...helper.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]), ["./coach-invitation-creation-contract"]);
  for (const code of [controller, helper]) {
    assert.doesNotMatch(code, /\b(?:fetch|setTimeout|setInterval|getUser|localStorage|sessionStorage)\s*\(|Date\.now|new Date|Math\.random|crypto\./);
    assert.doesNotMatch(code, /["']use client["']|supabase|\.rpc\s*\(|\.from\s*\(["']|checkCoachInvitationEmail/);
    assert.doesNotMatch(code, /field\(value,\s*["'](?:code|provider|delivery)["']\)/);
  }
  assert.doesNotMatch(contract, /readonly (?:code|provider|delivery|canCopy|canShare|cycle|studentName|studentId)\s*[?:]/);
});
