import assert from "node:assert/strict";
import test from "node:test";
import {
  CoachInvitationsError,
  type CapturedCoachInvitationsOperation,
  type CoachInvitationsErrorCode,
  type CoachInvitationsPinnedClient,
  type CoachInvitationsRpcName,
} from "./coach-invitations-contract";
import { createCoachInvitationsRepository, createCoachInvitationsRpcAdapter } from "./coach-invitations-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const episodeId = "40000000-0000-4000-8000-000000000001";
const now = "2026-09-09T06:00:00.123456+00:00";
const detail = { id: invitationId, recipientEmail: "synthetic@example.test", state: "pending", generation: 1,
  createdAt: now, issuedAt: now, expiresAt: "2026-09-16T06:00:00.123456+00:00", cancelledAt: null, code: "AA2-AA2-AA2" };
const operation = (action = "create") => ({ requestId, action,
  state: action === "cancel" || action === "revoke" ? "completed" : "reserved",
  invitationId: action === "revoke" ? null : invitationId, episodeId: action === "revoke" ? episodeId : null,
  generation: action === "revoke" ? null : action === "regenerate" ? 2 : 1, reservedAt: now });
const recorded = (action = "create") => ({ status: "recorded", serverNow: now, operation: operation(action) });
const isError = (code: CoachInvitationsErrorCode) => (error: unknown) =>
  error instanceof CoachInvitationsError && error.code === code && error.message === `coach-invitations-${code}`;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
  const calls: Array<{ name: CoachInvitationsRpcName; args: Readonly<Record<string, string | number>>; signal: AbortSignal }> = [];
  let generation = 1;
  let userId = owner;
  let captures = 0;
  let answer: unknown = recorded();
  let transport: CoachInvitationsPinnedClient["rpc"] | undefined;
  const captured: CapturedCoachInvitationsOperation = {
    identity: { userId: owner, generation: 1 },
    isCurrent: (snapshot) => snapshot.userId === userId && snapshot.generation === generation,
    client: { rpc: (name, args, signal) => {
      calls.push({ name, args, signal });
      return transport ? transport(name, args, signal) : Promise.resolve({ data: answer, error: null });
    } },
  };
  const repo = createCoachInvitationsRepository({ captureOperation: async () => { captures++; return captured; } });
  return { repo, calls, captured, get captures() { return captures; },
    setAnswer(value: unknown) { answer = value; },
    setTransport(value: CoachInvitationsPinnedClient["rpc"]) { transport = value; },
    changeGeneration() { generation++; }, changeUser() { userId = episodeId; } };
}

test("five commands forward only exact RPC allowlists and the caller requestId", async () => {
  const h = harness();
  await h.repo.createInvitation({ recipientEmail: " Synthetic@Example.Test ", requestId: requestId.toUpperCase() });
  h.setAnswer(recorded("resend")); await h.repo.resendInvitation({ invitationId, requestId });
  h.setAnswer(recorded("regenerate")); await h.repo.regenerateInvitation({ invitationId, requestId });
  h.setAnswer(recorded("cancel")); await h.repo.cancelInvitation({ invitationId, requestId });
  h.setAnswer(recorded("revoke")); await h.repo.revokeRelationship({ episodeId, requestId });
  assert.deepEqual(h.calls.map(({ name, args }) => [name, args]), [
    ["create_own_coach_invitation", { p_recipient_email: "synthetic@example.test", p_request_id: requestId }],
    ["resend_own_coach_invitation", { p_invitation_id: invitationId, p_request_id: requestId }],
    ["regenerate_own_coach_invitation", { p_invitation_id: invitationId, p_request_id: requestId }],
    ["cancel_own_coach_invitation", { p_invitation_id: invitationId, p_request_id: requestId }],
    ["revoke_own_coach_relationship", { p_episode_id: episodeId, p_request_id: requestId }],
  ]);
  assert.ok(h.calls.every(({ args }) => Object.isFrozen(args)));
});

test("three own reads use ids only; missing operation remains null without retries", async () => {
  const h = harness();
  h.setAnswer(detail); assert.equal((await h.repo.readInvitation(invitationId)).state, "pending");
  h.setAnswer(operation()); assert.equal((await h.repo.readOwnOperation(requestId))?.state, "reserved");
  h.setAnswer(null); assert.equal(await h.repo.readOwnOperation(requestId), null);
  h.setAnswer({ id: episodeId, studentName: "Synthetic Student", studentEmail: "student@example.test", linkedAt: now, endedAt: null });
  assert.equal((await h.repo.readRelationship(episodeId)).endedAt, null);
  assert.deepEqual(h.calls.map(({ name, args }) => [name, args]), [
    ["read_own_coach_invitation", { p_invitation_id: invitationId }],
    ["read_own_coach_invitation_operation", { p_request_id: requestId }],
    ["read_own_coach_invitation_operation", { p_request_id: requestId }],
    ["read_own_coach_relationship", { p_episode_id: episodeId }],
  ]);
});

test("invalid ids, extra ownership/code/state and non-data form properties never capture or dispatch", async () => {
  const h = harness();
  const valid = { recipientEmail: "synthetic@example.test", requestId };
  const getter = Object.defineProperty({ requestId }, "recipientEmail", { enumerable: true, get() { throw new Error("private detail"); } });
  const malicious = new Proxy(valid, { getPrototypeOf() { throw new Error("private detail"); } });
  for (const input of [null, [], {}, { ...valid, user_id: owner }, { ...valid, code: detail.code },
    { ...valid, state: "accepted" }, { ...valid, [Symbol("ownership")]: owner }, getter, malicious,
    { ...valid, requestId: "invitation-1" }, { ...valid, recipientEmail: "a@@example.test" },
    { ...valid, recipientEmail: "a".repeat(321) }]) {
    await assert.rejects(h.repo.createInvitation(input as never), isError("invalid_input"));
  }
  await assert.rejects(h.repo.cancelInvitation({ invitationId, requestId, owner_id: owner } as never), isError("invalid_input"));
  await assert.rejects(h.repo.revokeRelationship({ episodeId: "fake-id", requestId }), isError("invalid_input"));
  for (const invalid of [null, 42, "fake-id", `${invitationId} `]) {
    await assert.rejects(h.repo.readInvitation(invalid as never), isError("invalid_input"));
    await assert.rejects(h.repo.readOwnOperation(invalid as never), isError("invalid_input"));
    await assert.rejects(h.repo.readRelationship(invalid as never), isError("invalid_input"));
  }
  assert.equal(h.captures, 0); assert.equal(h.calls.length, 0);
});

test("input snapshot cannot change while capture is pending", async () => {
  const h = harness(); const pending = deferred<CapturedCoachInvitationsOperation>();
  const repo = createCoachInvitationsRepository({ captureOperation: () => pending.promise });
  const input = { recipientEmail: "original@example.test", requestId };
  const result = repo.createInvitation(input);
  input.recipientEmail = "changed@example.test"; input.requestId = episodeId;
  pending.resolve(h.captured); await result;
  assert.deepEqual(h.calls[0].args, { p_recipient_email: "original@example.test", p_request_id: requestId });
});

test("stale before dispatch or after a successful/rejected RPC cannot reach a different session", async () => {
  for (const change of ["changeUser", "changeGeneration"] as const) {
    const before = harness(); before[change]();
    await assert.rejects(before.repo.readOwnOperation(requestId), isError("operation_stale"));
    assert.equal(before.calls.length, 0);
    for (const rejected of [false, true]) {
      const after = harness();
      after.setTransport(async () => { after[change](); if (rejected) throw new Error("private response detail"); return { data: operation(), error: null }; });
      await assert.rejects(after.repo.readOwnOperation(requestId), isError("operation_stale"));
      assert.equal(after.calls.length, 1);
    }
  }
});

test("known SQL errors are sanitized and 40001 is a technical retry, never a preference version conflict", async () => {
  for (const [database, mapped] of [["42501", "forbidden"], ["22023", "invalid_input"], ["P0002", "not_found"],
    ["55000", "state_conflict"], ["40001", "retry_required"], ["23505", "unavailable"]] as const) {
    const h = harness();
    h.setTransport(async () => ({ data: null, error: { code: database, message: "private data", details: "private data", hint: "private data" } }));
    await assert.rejects(h.repo.createInvitation({ recipientEmail: "synthetic@example.test", requestId }), isError(mapped));
    assert.equal(h.calls.length, 1);
  }
  const h = harness();
  const tainted = new CoachInvitationsError("forbidden"); tainted.message = "private data";
  h.setTransport(async () => { throw tainted; });
  await assert.rejects(h.repo.readOwnOperation(requestId), isError("forbidden"));
  h.setTransport(async () => { throw new Error("private data"); });
  await assert.rejects(h.repo.readOwnOperation(requestId), isError("unavailable"));
  assert.equal(h.calls.length, 2);
});

test("rate limits and cancelled replays never fabricate email success or trigger another RPC", async () => {
  const h = harness();
  h.setAnswer({ status: "rate_limited", serverNow: now, retryAt: "2026-09-09T07:00:00.123456+00:00" });
  assert.equal((await h.repo.createInvitation({ recipientEmail: "synthetic@example.test", requestId })).status, "rate_limited");
  h.setAnswer({ ...recorded(), operation: { ...operation(), state: "cancelled" } });
  const replay = await h.repo.createInvitation({ recipientEmail: "synthetic@example.test", requestId });
  assert.ok(replay.status === "recorded" && replay.operation.state === "cancelled");
  assert.equal(h.calls.length, 2);
  for (const response of [{ ...recorded(), sent: true }, { ...recorded(), message: "Correo enviado" },
    { ...recorded(), operation: { ...operation(), code: detail.code } },
    { ...recorded(), operation: { ...operation(), requestId: episodeId } },
    { ...recorded(), operation: { ...operation(), action: "resend" } }]) {
    h.setAnswer(response);
    await assert.rejects(h.repo.createInvitation({ recipientEmail: "synthetic@example.test", requestId }), isError("invalid_response"));
  }
});

test("all known target references are checked, including late read results", async () => {
  const h = harness();
  h.setAnswer({ ...recorded("resend"), operation: { ...operation("resend"), invitationId: episodeId } });
  await assert.rejects(h.repo.resendInvitation({ invitationId, requestId }), isError("invalid_response"));
  h.setAnswer({ ...recorded("revoke"), operation: { ...operation("revoke"), episodeId: invitationId } });
  await assert.rejects(h.repo.revokeRelationship({ episodeId, requestId }), isError("invalid_response"));
  h.setAnswer({ ...detail, id: episodeId });
  await assert.rejects(h.repo.readInvitation(invitationId), isError("invalid_response"));
  h.setAnswer({ ...operation(), requestId: episodeId });
  await assert.rejects(h.repo.readOwnOperation(requestId), isError("invalid_response"));
});

test("deadline releases hung capture and a late capture cannot start transport", async () => {
  const h = harness(); const pending = deferred<CapturedCoachInvitationsOperation>(); let signal: AbortSignal | undefined;
  const repo = createCoachInvitationsRepository({ timeoutMilliseconds: 15, captureOperation: (value) => { signal = value; return pending.promise; } });
  await assert.rejects(repo.readOwnOperation(requestId), isError("timeout"));
  assert.equal(signal?.aborted, true); pending.resolve(h.captured); await tick();
  assert.equal(h.calls.length, 0);
});

test("one deadline includes capture plus transport and aborts the same signal", async () => {
  const h = harness(); let signal: AbortSignal | undefined;
  h.setTransport((_name, _args, value) => { assert.equal(value, signal); return new Promise(() => undefined); });
  const repo = createCoachInvitationsRepository({ timeoutMilliseconds: 20, captureOperation: async (value) => {
    signal = value; await new Promise((resolve) => setTimeout(resolve, 5)); return h.captured;
  } });
  await assert.rejects(repo.readOwnOperation(requestId), isError("timeout"));
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, true);
});

test("caller abort before capture or during transport is distinct from timeout; late settlement stays ignored", async () => {
  const h = harness(); const already = new AbortController(); already.abort("private reason");
  await assert.rejects(h.repo.readOwnOperation(requestId, { signal: already.signal }), isError("aborted"));
  assert.equal(h.captures, 0);
  const controller = new AbortController(); const pending = deferred<{ data: unknown; error: null }>();
  h.setTransport(() => { controller.abort("private reason"); return pending.promise; });
  await assert.rejects(h.repo.readOwnOperation(requestId, { signal: controller.signal }), isError("aborted"));
  pending.resolve({ data: operation(), error: null }); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, true);
});

test("invalid deadline configuration never captures or dispatches", () => {
  for (const milliseconds of [0, -1, 0.5, NaN, Infinity, 30_001, 2_147_483_648]) {
    assert.throws(() => createCoachInvitationsRepository({ timeoutMilliseconds: milliseconds,
      captureOperation: async () => { throw new Error("must not capture"); } }), isError("invalid_input"));
  }
});

test("existing pinned Supabase RPC adapter forces POST and forwards AbortSignal without Auth or retries", async () => {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const adapter = createCoachInvitationsRpcAdapter({ rpc(name, args, options) {
    calls.push({ name, args, options });
    return { abortSignal(signal) { assert.equal(signal, controller.signal); return Promise.resolve({ data: operation(), error: null }); } };
  } });
  await adapter.rpc("read_own_coach_invitation_operation", { p_request_id: requestId }, controller.signal);
  assert.deepEqual(calls, [{ name: "read_own_coach_invitation_operation", args: { p_request_id: requestId }, options: { get: false, head: false } }]);
  await assert.rejects(Promise.resolve(adapter.rpc("read_own_coach_invitation_operation", { p_request_id: requestId, p_owner_id: owner }, controller.signal)), isError("invalid_input"));
  await assert.rejects(Promise.resolve(adapter.rpc("accept_own_coach_invitation" as never, {}, controller.signal)), isError("invalid_input"));
  controller.abort();
  await assert.rejects(Promise.resolve(adapter.rpc("read_own_coach_invitation_operation", { p_request_id: requestId }, controller.signal)), isError("aborted"));
  assert.equal(calls.length, 1);
});

test("adapter and repository compose without an SDK/Auth constructor", async () => {
  const calls: unknown[] = [];
  const adapter = createCoachInvitationsRpcAdapter({ rpc(name, args, options) {
    calls.push({ name, args, options });
    return { abortSignal: async () => ({ data: recorded(), error: null }) };
  } });
  const repo = createCoachInvitationsRepository({ captureOperation: async () => ({ identity: { userId: owner, generation: 1 },
    isCurrent: (identity) => identity.userId === owner && identity.generation === 1, client: adapter }) });
  const result = await repo.createInvitation({ recipientEmail: " Synthetic@Example.Test ", requestId });
  assert.equal(result.status, "recorded");
  assert.deepEqual(calls, [{ name: "create_own_coach_invitation", args: { p_recipient_email: "synthetic@example.test", p_request_id: requestId }, options: { get: false, head: false } }]);
});

test("caller abort during capture prevents dispatch even if capture resolves late", async () => {
  const h = harness(); const capture = deferred<CapturedCoachInvitationsOperation>();
  const controller = new AbortController();
  const repo = createCoachInvitationsRepository({ captureOperation: () => capture.promise });
  const result = repo.readOwnOperation(requestId, { signal: controller.signal });
  await tick(); controller.abort();
  await assert.rejects(result, isError("aborted"));
  capture.resolve(h.captured); await tick();
  assert.equal(h.calls.length, 0);
});

test("hostile thrown error accessors and RPC data accessors never disclose their messages", async () => {
  const h = harness();
  const hostile = new CoachInvitationsError("forbidden");
  Object.defineProperty(hostile, "code", { get() { throw new Error("private detail"); } });
  h.setTransport(async () => { throw hostile; });
  await assert.rejects(h.repo.readOwnOperation(requestId), isError("unavailable"));
  let reads = 0;
  h.setTransport(async () => Object.defineProperty({ error: null }, "data", { get() { reads++; throw new Error("private detail"); } }) as never);
  await assert.rejects(h.repo.readOwnOperation(requestId), isError("invalid_response"));
  assert.equal(reads, 0);
});
