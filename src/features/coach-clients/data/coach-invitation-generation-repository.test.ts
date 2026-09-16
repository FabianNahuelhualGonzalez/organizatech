import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError, type CapturedCoachInvitationsOperation, type CoachInvitationsErrorCode,
  type CoachInvitationsPinnedClient, type CoachInvitationGenerationCommandInput } from "./coach-invitations-contract";
import { createCoachInvitationsRepository, createCoachInvitationsRpcAdapter } from "./coach-invitations-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const now = "2026-09-09T12:00:00.123456Z";
const command = { invitationId, requestId, expectedGeneration: 2 };
const receipt = (action: "resend" | "regenerate" = "resend") => ({ requestId, action, state: "reserved",
  invitationId, expectedGeneration: 2, generation: action === "regenerate" ? 3 : 2, reservedAt: now });
const recorded = (action: "resend" | "regenerate" = "resend") => ({ status: "recorded", serverNow: now, operation: receipt(action) });
const issue = (code: CoachInvitationsErrorCode) => (error: unknown) => error instanceof CoachInvitationsError
  && error.code === code && error.message === `coach-invitations-${code}` && !("cause" in error);
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const calls: Parameters<CoachInvitationsPinnedClient["rpc"]>[] = [];
  let captures = 0, current = true;
  let answer: unknown = recorded();
  let override: CoachInvitationsPinnedClient["rpc"] | null = null;
  const captured: CapturedCoachInvitationsOperation = { identity: { userId: owner, generation: 1 }, isCurrent: () => current,
    client: { rpc: (name, args, signal) => { calls.push([name, args, signal]);
      return override ? override(name, args, signal) : Promise.resolve({ data: answer, error: null }); } } };
  const repo = createCoachInvitationsRepository({ captureOperation: async () => { captures++; return captured; } });
  return { repo, calls, captured, captures: () => captures, answer: (value: unknown) => { answer = value; },
    transport: (value: CoachInvitationsPinnedClient["rpc"]) => { override = value; }, stale: () => { current = false; } };
}
test("two bound writes and read use exact distinct RPCs, numeric generation and caller id", async () => {
  const f = fixture();
  await f.repo.resendInvitationForGeneration(command);
  f.answer(recorded("regenerate")); await f.repo.regenerateInvitationForGeneration(command);
  f.answer(receipt("regenerate")); assert.equal((await f.repo.readOwnGenerationOperation(requestId))?.expectedGeneration, 2);
  assert.deepEqual(f.calls.map(([name, args]) => [name, args]), [
    ["resend_own_coach_invitation_for_generation", { p_invitation_id: invitationId, p_expected_generation: 2, p_request_id: requestId }],
    ["regenerate_own_coach_invitation_for_generation", { p_invitation_id: invitationId, p_expected_generation: 2, p_request_id: requestId }],
    ["read_own_coach_invitation_generation_operation", { p_request_id: requestId }],
  ]);
  assert.equal(f.captures(), 3); assert.ok(f.calls.every(([, args]) => Object.isFrozen(args)));
});
test("invalid intent never captures Auth or forwards ownership, code or raw fields", async () => {
  const f = fixture(); let getters = 0;
  const accessor = Object.defineProperty({ ...command }, "expectedGeneration", { enumerable: true, get() { getters++; return 2; } });
  const candidates = [null, [], {}, { ...command, expectedGeneration: "2" }, { ...command, expectedGeneration: 0 },
    { ...command, expectedGeneration: 2_147_483_648 }, { ...command, expectedGeneration: 1.5 },
    { ...command, user_id: owner }, { ...command, code: "code" }, { ...command, state: "pending" },
    { ...command, requestId: "bad" }, { ...command, invitationId: "bad" }, { ...command, [Symbol("owner")]: owner }, accessor,
    new Proxy(command, { getPrototypeOf() { throw new Error("private sentinel"); } })];
  for (const value of candidates) {
    for (const method of [f.repo.resendInvitationForGeneration, f.repo.regenerateInvitationForGeneration]) {
      await assert.rejects(method(value as CoachInvitationGenerationCommandInput), issue("invalid_input"));
    }
  }
  await assert.rejects(f.repo.readOwnGenerationOperation("bad"), issue("invalid_input"));
  assert.equal(f.captures(), 0); assert.equal(f.calls.length, 0); assert.equal(getters, 0);
});
test("bound intent primitives are snapshotted before asynchronous capture", async () => {
  const f = fixture(), capture = deferred<CapturedCoachInvitationsOperation>();
  const repo = createCoachInvitationsRepository({ captureOperation: () => capture.promise });
  const input = { ...command };
  const result = repo.resendInvitationForGeneration(input);
  input.expectedGeneration = 3; input.invitationId = owner; input.requestId = owner;
  capture.resolve(f.captured); await result;
  assert.deepEqual(f.calls[0][1], { p_invitation_id: invitationId, p_expected_generation: 2, p_request_id: requestId });
});
for (const [sql, code] of [["42501", "forbidden"], ["22023", "invalid_input"], ["P0002", "not_found"],
  ["55000", "state_conflict"], ["40001", "retry_required"], ["XX000", "unavailable"]] as const) {
  test(`generation SQLSTATE ${sql} sanitized without implicit retry`, async () => {
    const f = fixture(); f.transport(async () => ({ data: null, error: { code: sql, message: "private sentinel", details: "private sentinel" } }));
    await assert.rejects(f.repo.resendInvitationForGeneration(command), issue(code));
    assert.equal(f.calls.length, 1);
  });
}
test("integer MAX regeneration reaches server to yield exhausted state, not client overflow", async () => {
  const f = fixture(); f.transport(async () => ({ data: null, error: { code: "55000" } }));
  await assert.rejects(f.repo.regenerateInvitationForGeneration({ ...command, expectedGeneration: 2_147_483_647 }), issue("state_conflict"));
  assert.equal(f.calls[0][1].p_expected_generation, 2_147_483_647);
});
test("rate-limit never invents a receipt; explicit retry preserves id and expected generation", async () => {
  const f = fixture(); f.answer({ status: "rate_limited", serverNow: now, retryAt: "2026-09-09T12:01:00Z" });
  assert.equal((await f.repo.resendInvitationForGeneration(command)).status, "rate_limited");
  assert.equal(f.calls.length, 1); f.answer(recorded());
  await f.repo.resendInvitationForGeneration(command); assert.deepEqual(f.calls[0][1], f.calls[1][1]);
});
test("null only means missing; legacy or mismatched operation is rejected", async () => {
  const f = fixture(); f.answer(null); assert.equal(await f.repo.readOwnGenerationOperation(requestId), null);
  const { expectedGeneration: unused, ...legacy } = receipt(); void unused;
  for (const value of [{ ...legacy, episodeId: null }, { ...receipt(), requestId: owner }, { ...receipt(), generation: 3 }]) {
    f.answer(value); await assert.rejects(f.repo.readOwnGenerationOperation(requestId), issue("invalid_response"));
  }
  f.answer({ ...receipt(), state: "cancelled" });
  assert.equal((await f.repo.readOwnGenerationOperation(requestId))?.state, "cancelled");
});
test("stale before and after dispatch supersedes any transport outcome", async () => {
  const f = fixture(); f.stale();
  await assert.rejects(f.repo.resendInvitationForGeneration(command), issue("operation_stale")); assert.equal(f.calls.length, 0);
  for (const throws of [false, true]) {
    const g = fixture(); g.transport(async () => { g.stale(); if (throws) throw new Error("private sentinel"); return { data: recorded(), error: null }; });
    await assert.rejects(g.repo.resendInvitationForGeneration(command), issue("operation_stale")); assert.equal(g.calls.length, 1);
  }
});
test("bounded hung RPC and aborted capture do not retry or adopt late responses", async () => {
  const f = fixture(), pending = deferred<{ data: unknown; error: null }>();
  f.transport(() => pending.promise);
  const repo = createCoachInvitationsRepository({ captureOperation: async () => f.captured, timeoutMilliseconds: 20 });
  await assert.rejects(repo.resendInvitationForGeneration(command), issue("timeout"));
  assert.equal(f.calls[0][2].aborted, true); pending.resolve({ data: recorded(), error: null });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repo.regenerateInvitationForGeneration(command, { signal: controller.signal }), issue("aborted"));
  assert.equal(f.calls.length, 1);
});
test("adapter validates numeric bound generation and per-RPC allowlists independently", async () => {
  const calls: unknown[] = [];
  const adapter = createCoachInvitationsRpcAdapter({ rpc: (name, args, options) => {
    calls.push({ name, args, options }); return { abortSignal: async () => ({ data: null, error: null }) }; } });
  const signal = new AbortController().signal;
  const args = { p_invitation_id: invitationId, p_expected_generation: 2, p_request_id: requestId };
  await adapter.rpc("resend_own_coach_invitation_for_generation", args, signal);
  await adapter.rpc("regenerate_own_coach_invitation_for_generation", args, signal);
  await adapter.rpc("read_own_coach_invitation_generation_operation", { p_request_id: requestId }, signal);
  for (const invalid of [{ ...args, p_expected_generation: "2" }, { ...args, p_expected_generation: 0 }, { ...args, owner_id: owner }]) {
    await assert.rejects(Promise.resolve(adapter.rpc("resend_own_coach_invitation_for_generation", invalid, signal)), issue("invalid_input"));
  }
  await assert.rejects(Promise.resolve(adapter.rpc("resend_own_coach_invitation", args, signal)), issue("invalid_input"));
  await assert.rejects(Promise.resolve(adapter.rpc("read_own_coach_invitation_generation_operation", args, signal)), issue("invalid_input"));
  assert.equal(calls.length, 3);
});
