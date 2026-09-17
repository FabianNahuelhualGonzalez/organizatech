import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError, type CoachInvitationsErrorCode } from "./coach-invitations-contract";
import { createSupabaseCoachActiveRelationshipsRepository } from "./supabase-coach-active-relationships-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const query = { query: "", limit: 25, cursor: null };
const configuration = { url: "https://coach-active.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
const token = "synthetic-not-a-credential";
const empty = () => ({ serverNow: "2026-09-09T09:00:00.123456Z", totalActive: 0, matchingCount: 0, items: [], nextCursor: null });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const issue = (code: CoachInvitationsErrorCode) => (error: unknown) => error instanceof CoachInvitationsError
  && error.code === code && error.message === `coach-invitations-${code}`;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(done => setTimeout(done, 0));

function fixture(timeoutMilliseconds?: number) {
  let generation = 1, userId = owner, sessionCalls = 0, userCalls = 0;
  const requests: RequestInit[] = [];
  let onSession = async () => ({ data: { session: { user: { id: owner }, access_token: token } }, error: null as unknown });
  let onUser = async () => ({ data: { user: { id: owner } }, error: null as unknown });
  let onFetch = async () => json(empty());
  const expectedIdentity = { userId: owner, generation: 1 }, config = { ...configuration };
  const repo = createSupabaseCoachActiveRelationshipsRepository({ configuration: config, expectedIdentity, timeoutMilliseconds,
    isCurrent: (identity) => identity.userId === userId && identity.generation === generation,
    principal: { auth: {
      getSession: () => { sessionCalls++; return onSession(); },
      getUser: (capturedToken) => { userCalls++; assert.equal(capturedToken, token); return onUser(); },
    } },
    fetch: async (url, init = {}) => {
      assert.equal(String(url), `${configuration.url}/rest/v1/rpc/list_own_active_coach_relationships`);
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
      assert.equal(new Headers(init.headers).get("apikey"), configuration.publicKey);
      requests.push(init); return onFetch();
    },
  });
  return { repo, requests, config, expectedIdentity, counts: () => ({ sessionCalls, userCalls }),
    changeGeneration: () => { generation++; }, changeUser: () => { userId = other; },
    session: (next: typeof onSession) => { onSession = next; }, user: (next: typeof onUser) => { onUser = next; },
    transport: (next: typeof onFetch) => { onFetch = next; } };
}

test("real SDK POST serializes limit and null cursors with pinned principal, no Auth fetch", async () => {
  const f = fixture(); assert.deepEqual(await f.repo.listActiveRelationships(query), empty());
  assert.equal(f.requests.length, 1); assert.deepEqual(f.counts(), { sessionCalls: 1, userCalls: 1 });
  assert.deepEqual(JSON.parse(String(f.requests[0].body)), { p_query: "", p_limit: 25, p_cursor_linked_at: null, p_cursor_id: null });
});

test("SDK sends exact original bounded search and preserves microsecond cursor", async () => {
  const f = fixture(); await f.repo.listActiveRelationships({ query: " ÁLUMNO% ", limit: 50,
    cursor: { id: owner, linkedAt: "2026-09-09T09:00:00.123456Z" } });
  assert.deepEqual(JSON.parse(String(f.requests[0].body)), { p_query: " ÁLUMNO% ", p_limit: 50,
    p_cursor_linked_at: "2026-09-09T09:00:00.123456Z", p_cursor_id: owner });
});

test("public configuration and expected identity are snapshotted once", async () => {
  const f = fixture(); f.config.url = "https://other.example.invalid"; f.config.publicKey = "bad"; f.expectedIdentity.userId = other;
  await f.repo.listActiveRelationships(query); assert.equal(f.requests.length, 1);
});

test("invalid input never reads Auth or dispatches SDK fetch", async () => {
  const f = fixture(); await assert.rejects(f.repo.listActiveRelationships({ ...query, limit: 100 }), issue("invalid_input"));
  assert.deepEqual(f.counts(), { sessionCalls: 0, userCalls: 0 }); assert.equal(f.requests.length, 0);
});

test("verified principal mismatch is forbidden without network dispatch", async () => {
  const f = fixture(); f.user(async () => ({ data: { user: { id: other } }, error: null }));
  await assert.rejects(f.repo.listActiveRelationships(query), issue("forbidden")); assert.equal(f.requests.length, 0);
});

test("session/account generation guards reject before and after SDK dispatch", async () => {
  for (const after of [false, true]) {
    const f = fixture();
    if (after) f.transport(async () => { f.changeGeneration(); return json(empty()); }); else f.changeUser();
    await assert.rejects(f.repo.listActiveRelationships(query), issue("operation_stale"));
    assert.equal(f.requests.length, after ? 1 : 0);
  }
});

test("hung Auth consumes same deadline and cannot later initiate verified-user or RPC calls", async () => {
  const f = fixture(15); const waiting = deferred<{ data: { session: { user: { id: string }; access_token: string } }; error: unknown }>();
  f.session(() => waiting.promise); await assert.rejects(f.repo.listActiveRelationships(query), issue("timeout"));
  waiting.resolve({ data: { session: { user: { id: owner }, access_token: token } }, error: null }); await tick();
  assert.deepEqual(f.counts(), { sessionCalls: 1, userCalls: 0 }); assert.equal(f.requests.length, 0);
});

test("SDK malformed response/HTTP error fails, no stale or fabricated empty page", async () => {
  for (const [payload, status, expected] of [[{ code: "42501", message: "private" }, 403, "forbidden"],
    [{ code: "22023", message: "private" }, 400, "invalid_input"], [null, 200, "invalid_response"],
    [{ ...empty(), invitationCode: "private" }, 200, "invalid_response"]] as const) {
    const f = fixture(); f.transport(async () => json(payload, status));
    await assert.rejects(f.repo.listActiveRelationships(query), issue(expected)); assert.equal(f.requests.length, 1);
  }
});

test("SDK disables transient auto-retry on 503", async () => {
  const f = fixture(); f.transport(async () => json({ message: "private" }, 503));
  await assert.rejects(f.repo.listActiveRelationships(query), issue("unavailable")); assert.equal(f.requests.length, 1);
});

test("caller abort propagates to real SDK fetch signal and ignores late response", async () => {
  const f = fixture(); const waiting = deferred<Response>(); f.transport(() => waiting.promise);
  const stop = new AbortController(), promise = f.repo.listActiveRelationships(query, { signal: stop.signal });
  await tick(); stop.abort(); await assert.rejects(promise, issue("aborted"));
  assert.equal(f.requests[0].signal?.aborted, true); waiting.resolve(json(empty())); await tick(); assert.equal(f.requests.length, 1);
});

test("real SDK maps a minimal active identity page and keeps activity absent", async () => {
  const f = fixture();
  const linkedAt = "2026-09-09T08:00:00.123456Z";
  const payload = { ...empty(), totalActive: 2, matchingCount: 2,
    items: [{ id: other, studentName: "Álvaro", studentEmail: "alumno@example.test", linkedAt }],
    nextCursor: { id: other, linkedAt } };
  f.transport(async () => json(payload));
  const result = await f.repo.listActiveRelationships({ ...query, limit: 1 });
  assert.deepEqual(result, payload);
  assert.ok(Object.isFrozen(result.items[0]));
  assert.equal("progress" in result.items[0], false);
  assert.equal("cycle" in result.items[0], false);
  assert.equal(f.requests.length, 1);
});
