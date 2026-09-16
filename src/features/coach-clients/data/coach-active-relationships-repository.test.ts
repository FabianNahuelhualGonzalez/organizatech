import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError, type CoachInvitationsErrorCode } from "./coach-invitations-contract";
import type { CapturedCoachActiveRelationshipsOperation, CoachActiveRelationshipsParameters, CoachActiveRelationshipsQuery } from "./coach-active-relationships-contract";
import { createCoachActiveRelationshipsRepository } from "./coach-active-relationships-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const query: CoachActiveRelationshipsQuery = { query: "", limit: 25, cursor: null };
const empty = () => ({ serverNow: "2026-09-09T09:00:00Z", totalActive: 0, matchingCount: 0, items: [], nextCursor: null });
const issue = (code: CoachInvitationsErrorCode) => (error: unknown) => error instanceof CoachInvitationsError
  && error.code === code && error.message === `coach-invitations-${code}` && !("cause" in error);
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(done => setTimeout(done, 0));
function fixture(timeoutMilliseconds?: number) {
  let current = true;
  let captures = 0;
  const calls: { name: string; args: CoachActiveRelationshipsParameters; signal: AbortSignal }[] = [];
  let transport = async (): Promise<{ data: unknown; error: unknown }> => ({ data: empty(), error: null });
  const operation: CapturedCoachActiveRelationshipsOperation = {
    identity: { userId: owner, generation: 1 }, isCurrent: () => current,
    client: { rpc: async (name, args, signal) => { calls.push({ name, args, signal }); return transport(); } },
  };
  let capture = async () => operation;
  const repo = createCoachActiveRelationshipsRepository({ timeoutMilliseconds,
    captureOperation: () => { captures++; return capture(); } });
  return { repo, operation, calls, captures: () => captures, stale: () => { current = false; },
    transport: (next: typeof transport) => { transport = next; }, capture: (next: typeof capture) => { capture = next; } };
}

test("list emits only exact read RPC parameters and does not cache or retry", async () => {
  const f = fixture();
  assert.deepEqual(await f.repo.listActiveRelationships(query), empty());
  assert.equal(f.calls[0].name, "list_own_active_coach_relationships");
  assert.deepEqual(f.calls[0].args, { p_query: "", p_limit: 25, p_cursor_linked_at: null, p_cursor_id: null });
  assert.ok(Object.isFrozen(f.calls[0].args));
  await f.repo.listActiveRelationships(query);
  assert.equal(f.captures(), 2); assert.equal(f.calls.length, 2);
});

test("invalid raw inputs and already-aborted requests never capture", async () => {
  const f = fixture();
  await assert.rejects(f.repo.listActiveRelationships({ ...query, user_id: owner } as CoachActiveRelationshipsQuery), issue("invalid_input"));
  const stop = new AbortController(); stop.abort();
  await assert.rejects(f.repo.listActiveRelationships(query, { signal: stop.signal }), issue("aborted"));
  assert.equal(f.captures(), 0);
});

test("snapshot query and cursor before asynchronous capture", async () => {
  const f = fixture(); const capture = deferred<CapturedCoachActiveRelationshipsOperation>();
  f.capture(() => capture.promise);
  const input = { query: "alumno", limit: 25, cursor: { id: owner, linkedAt: "2026-09-09T09:00:00Z" } };
  const promise = f.repo.listActiveRelationships(input);
  input.query = "other"; input.limit = 50; input.cursor.id = "invalid";
  capture.resolve(f.operation); await promise;
  assert.equal(f.calls[0].args.p_query, "alumno"); assert.equal(f.calls[0].args.p_limit, 25); assert.equal(f.calls[0].args.p_cursor_id, owner);
});

test("capture timeout and abort prevent late RPC dispatch", async () => {
  for (const abort of [false, true]) {
    const f = fixture(15), waiting = deferred<CapturedCoachActiveRelationshipsOperation>();
    f.capture(() => waiting.promise); const stop = new AbortController();
    const promise = f.repo.listActiveRelationships(query, { signal: stop.signal });
    if (abort) stop.abort();
    await assert.rejects(promise, issue(abort ? "aborted" : "timeout"));
    waiting.resolve(f.operation); await tick(); assert.equal(f.calls.length, 0);
  }
});

test("transport timeout aborts signal even if source ignores it, late result cannot escape", async () => {
  const f = fixture(15), waiting = deferred<{ data: unknown; error: unknown }>();
  f.transport(() => waiting.promise);
  await assert.rejects(f.repo.listActiveRelationships(query), issue("timeout"));
  assert.equal(f.calls[0].signal.aborted, true);
  waiting.resolve({ data: empty(), error: null }); await tick(); assert.equal(f.calls.length, 1);
});

test("explicit abort after dispatch rejects and leaves no second call", async () => {
  const f = fixture(), waiting = deferred<{ data: unknown; error: unknown }>();
  f.transport(() => waiting.promise); const stop = new AbortController();
  const promise = f.repo.listActiveRelationships(query, { signal: stop.signal }); await tick(); stop.abort();
  await assert.rejects(promise, issue("aborted")); assert.equal(f.calls[0].signal.aborted, true);
  waiting.resolve({ data: empty(), error: null }); await tick(); assert.equal(f.calls.length, 1);
});

test("identity change rejects before RPC and after resolved/rejected transport", async () => {
  const before = fixture(); before.stale(); await assert.rejects(before.repo.listActiveRelationships(query), issue("operation_stale"));
  assert.equal(before.calls.length, 0);
  for (const reject of [false, true]) {
    const f = fixture(); f.transport(async () => { f.stale(); if (reject) throw Error("private"); return { data: empty(), error: null }; });
    await assert.rejects(f.repo.listActiveRelationships(query), issue("operation_stale"));
  }
});

test("SQL errors sanitize known codes and never project errors as empty portfolio", async () => {
  for (const [code, expected] of [["42501", "forbidden"], ["22023", "invalid_input"], ["other", "unavailable"]] as const) {
    const f = fixture(); f.transport(async () => ({ data: empty(), error: { code, message: "private", details: "private" } }));
    await assert.rejects(f.repo.listActiveRelationships(query), issue(expected)); assert.equal(f.calls.length, 1);
  }
});

test("invalid JSON/data and accessors fail closed, no accessor is executed", async () => {
  let reads = 0;
  const bad = { get data() { reads++; throw Error("private"); }, error: null };
  for (const result of [{ data: null, error: null }, { data: {}, error: null }, bad]) {
    const f = fixture(); f.transport(async () => result);
    await assert.rejects(f.repo.listActiveRelationships(query), issue("invalid_response"));
  }
  assert.equal(reads, 0);
});

test("hostile capture/transport errors and malformed identity are sanitized", async () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const thrown of [Error("private"), revoked.proxy, { get code() { throw Error("private"); } }]) {
    const f = fixture(); f.transport(async () => { throw thrown; });
    await assert.rejects(f.repo.listActiveRelationships(query), issue("unavailable"));
  }
  const f = fixture(); f.capture(async () => ({ ...f.operation, identity: { userId: owner, generation: -1 } }));
  await assert.rejects(f.repo.listActiveRelationships(query), issue("invalid_response")); assert.equal(f.calls.length, 0);
});

test("deadline configuration is bounded", () => {
  for (const timeout of [0, -1, 30_001, Infinity, 0.5]) assert.throws(() => fixture(timeout), issue("invalid_input"));
});

test("repository snapshots its configured capture function", async () => {
  const f = fixture();
  const input = { captureOperation: async () => f.operation };
  const repo = createCoachActiveRelationshipsRepository(input);
  input.captureOperation = async () => { throw Error("unexpected replacement"); };
  assert.deepEqual(await repo.listActiveRelationships(query), empty());
});
