import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError, type CoachInvitationsErrorCode } from "./coach-invitations-contract";
import { createSupabaseCoachInvitationsRepository } from "./supabase-coach-invitations-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const requestId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const episodeId = "40000000-0000-4000-8000-000000000001";
const now = "2026-09-09T06:00:00.123456+00:00";
// Public/credential fixtures are synthetic; every SDK fetch is intercepted.
const configuration = { url: "https://coach-invitations.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
const token = "synthetic-session-token-not-a-credential";
const session = () => ({ data: { session: { user: { id: owner }, access_token: token } }, error: null });
const verified = () => ({ data: { user: { id: owner } }, error: null });
const operation = (action = "create") => ({ requestId, action,
  state: action === "cancel" || action === "revoke" ? "completed" : "reserved",
  invitationId: action === "revoke" ? null : invitationId,
  episodeId: action === "revoke" ? episodeId : null,
  generation: action === "revoke" ? null : action === "regenerate" ? 2 : 1, reservedAt: now });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const issue = (code: CoachInvitationsErrorCode) => (error: unknown) => error instanceof CoachInvitationsError
  && error.code === code && error.message === `coach-invitations-${code}` && !("cause" in error);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function fixture(timeoutMilliseconds?: number) {
  let currentUser = owner;
  let generation = 1;
  let sessionCalls = 0;
  let userCalls = 0;
  let onSession = async () => session();
  let onUser = async () => verified();
  let transport: ((name: string, init: RequestInit) => Promise<Response>) | null = null;
  const requests: { name: string; body: unknown; init: RequestInit }[] = [];
  const expectedIdentity = { userId: owner, generation: 1 };
  const config = { ...configuration };
  const repo = createSupabaseCoachInvitationsRepository({
    configuration: config, expectedIdentity, timeoutMilliseconds,
    isCurrent: (identity) => identity.userId === currentUser && identity.generation === generation,
    principal: { auth: {
      getSession: () => { sessionCalls++; return onSession(); },
      getUser: (value) => { userCalls++; assert.equal(value, token); return onUser(); },
    } },
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.origin, configuration.url);
      assert.match(parsed.pathname, /^\/rest\/v1\/rpc\/[a-z_]+$/);
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
      assert.equal(new Headers(init.headers).get("apikey"), configuration.publicKey);
      const name = parsed.pathname.split("/").at(-1)!;
      requests.push({ name, body: JSON.parse(String(init.body)), init });
      if (transport) return transport(name, init);
      if (name === "read_own_coach_invitation") return json({ id: invitationId,
        recipientEmail: "synthetic@example.test", state: "pending", generation: 1,
        createdAt: now, issuedAt: now, expiresAt: "2026-09-16T06:00:00.123456+00:00", cancelledAt: null, code: "AA2-AA2-AA2" });
      if (name === "read_own_coach_invitation_operation") return json(operation());
      if (name === "read_own_coach_relationship") return json({ id: episodeId, studentName: "Synthetic Student",
        studentEmail: "synthetic@example.test", linkedAt: now, endedAt: null });
      return json({ status: "recorded", serverNow: now, operation: operation(name.split("_")[0]) });
    },
  });
  return { repo, requests, config, expectedIdentity,
    counters: () => ({ sessionCalls, userCalls }),
    session: (next: typeof onSession) => { onSession = next; },
    user: (next: typeof onUser) => { onUser = next; },
    transport: (next: typeof transport) => { transport = next; },
    changeUser: () => { currentUser = other; },
    changeGeneration: () => { generation++; },
  };
}

test("real SDK serializes all eight RPCs as POST with pinned identity and exact allowlists", async () => {
  const f = fixture();
  const created = await f.repo.createInvitation({ recipientEmail: " Synthetic@Example.Test ", requestId });
  assert.ok(created.status === "recorded" && created.operation.state === "reserved");
  await f.repo.resendInvitation({ invitationId, requestId });
  await f.repo.regenerateInvitation({ invitationId, requestId });
  await f.repo.cancelInvitation({ invitationId, requestId });
  await f.repo.revokeRelationship({ episodeId, requestId });
  await f.repo.readInvitation(invitationId);
  await f.repo.readOwnOperation(requestId);
  await f.repo.readRelationship(episodeId);
  assert.deepEqual(f.requests.map(({ name, body }) => [name, body]), [
    ["create_own_coach_invitation", { p_recipient_email: "synthetic@example.test", p_request_id: requestId }],
    ["resend_own_coach_invitation", { p_invitation_id: invitationId, p_request_id: requestId }],
    ["regenerate_own_coach_invitation", { p_invitation_id: invitationId, p_request_id: requestId }],
    ["cancel_own_coach_invitation", { p_invitation_id: invitationId, p_request_id: requestId }],
    ["revoke_own_coach_relationship", { p_episode_id: episodeId, p_request_id: requestId }],
    ["read_own_coach_invitation", { p_invitation_id: invitationId }],
    ["read_own_coach_invitation_operation", { p_request_id: requestId }],
    ["read_own_coach_relationship", { p_episode_id: episodeId }],
  ]);
  assert.deepEqual(f.counters(), { sessionCalls: 8, userCalls: 8 });
});

test("runtime snapshots config/expected identity and verifies the exact captured credential", async () => {
  const f = fixture();
  f.config.url = "https://different-project.example.invalid";
  f.config.publicKey = "sb_publishable_changed";
  f.expectedIdentity.userId = other; f.expectedIdentity.generation = 2;
  await f.repo.readOwnOperation(requestId);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.counters(), { sessionCalls: 1, userCalls: 1 });
});

test("invalid identity or non-public configuration is rejected before Auth/fetch", () => {
  const input = { configuration, expectedIdentity: { userId: owner, generation: 1 }, isCurrent: () => true,
    principal: { auth: { getSession: async () => { assert.fail("no Auth"); }, getUser: async () => { assert.fail("no Auth"); } } },
    fetch: async () => { assert.fail("no fetch"); } };
  for (const publicKey of ["", "sb_secret_synthetic_not_a_key", "unknown", "sb_publishable_bad key",
    "e30." + btoa(JSON.stringify({ role: "service_role" })) + ".synthetic", "e30.bnVsbA.synthetic"]) {
    assert.throws(() => createSupabaseCoachInvitationsRepository({ ...input, configuration: { ...configuration, publicKey } }), issue("invalid_input"));
  }
  for (const url of ["bad", "http://remote.example.invalid", "https://user:password@example.invalid", configuration.url + "?x=1", configuration.url + "#x"]) {
    assert.throws(() => createSupabaseCoachInvitationsRepository({ ...input, configuration: { ...configuration, url } }), issue("invalid_input"));
  }
  for (const expectedIdentity of [{ userId: "fake", generation: 1 }, { userId: owner, generation: -1 }, { userId: owner, generation: 0.1 }]) {
    assert.throws(() => createSupabaseCoachInvitationsRepository({ ...input, expectedIdentity }), issue("invalid_input"));
  }
  // A synthetic legacy anon key is accepted as public configuration, not authenticated here.
  assert.doesNotThrow(() => createSupabaseCoachInvitationsRepository({ ...input,
    configuration: { ...configuration, publicKey: "e30." + btoa(JSON.stringify({ role: "anon" })) + ".synthetic" } }));
});

test("missing/mismatching session and failed remote identity verification never issue an RPC", async () => {
  for (const mode of ["missing", "other-session", "bad-token", "session-error", "other-user", "user-error"]) {
    const f = fixture();
    if (mode === "missing") f.session(async () => ({ data: { session: null }, error: null }) as never);
    if (mode === "other-session") f.session(async () => ({ ...session(), data: { session: { ...session().data.session, user: { id: other } } } }));
    if (mode === "bad-token") f.session(async () => ({ ...session(), data: { session: { ...session().data.session, access_token: "bad token" } } }));
    if (mode === "session-error") f.session(async () => ({ ...session(), error: new Error("private sentinel") }) as never);
    if (mode === "other-user") f.user(async () => ({ data: { user: { id: other } }, error: null }));
    if (mode === "user-error") f.user(async () => ({ ...verified(), error: new Error("private sentinel") }) as never);
    await assert.rejects(f.repo.readOwnOperation(requestId), issue("forbidden"));
    assert.equal(f.requests.length, 0);
  }
});

test("account/portal generation changes before or during capture block subsequent calls", async () => {
  for (const change of ["changeUser", "changeGeneration"] as const) {
    const before = fixture(); before[change]();
    await assert.rejects(before.repo.readOwnOperation(requestId), issue("operation_stale"));
    assert.deepEqual(before.counters(), { sessionCalls: 0, userCalls: 0 });
    const during = fixture(); during.session(async () => { during[change](); return session(); });
    await assert.rejects(during.repo.readOwnOperation(requestId), issue("operation_stale"));
    assert.deepEqual(during.counters(), { sessionCalls: 1, userCalls: 0 });
    assert.equal(during.requests.length, 0);
    const verifiedThenStale = fixture(); verifiedThenStale.user(async () => { verifiedThenStale[change](); return verified(); });
    await assert.rejects(verifiedThenStale.repo.readOwnOperation(requestId), issue("operation_stale"));
    assert.equal(verifiedThenStale.requests.length, 0);
  }
});

test("capture deadline and caller abort suppress late non-abortable Auth continuations", async () => {
  const f = fixture(20); const pending = deferred<ReturnType<typeof session>>();
  f.session(() => pending.promise);
  await assert.rejects(f.repo.readOwnOperation(requestId), issue("timeout"));
  pending.resolve(session()); await tick();
  assert.deepEqual(f.counters(), { sessionCalls: 1, userCalls: 0 }); assert.equal(f.requests.length, 0);
  const g = fixture(); const user = deferred<ReturnType<typeof verified>>(); const controller = new AbortController();
  g.user(() => user.promise);
  const result = g.repo.readOwnOperation(requestId, { signal: controller.signal });
  await tick(); controller.abort();
  await assert.rejects(result, issue("aborted"));
  user.resolve(verified()); await tick(); assert.equal(g.requests.length, 0);
});

test("single budget aborts hung SDK fetch and ignores a late response", async () => {
  const f = fixture(20); const pending = deferred<Response>();
  f.transport(async () => pending.promise);
  await assert.rejects(f.repo.readOwnOperation(requestId), issue("timeout"));
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].init.signal?.aborted, true);
  pending.resolve(json(operation())); await tick(); assert.equal(f.requests.length, 1);
});

test("late SDK responses after session change never reach a different generation", async () => {
  const f = fixture();
  f.transport(async () => { f.changeGeneration(); return json(operation()); });
  await assert.rejects(f.repo.readOwnOperation(requestId), issue("operation_stale"));
  assert.equal(f.requests.length, 1);
});

test("HTTP/network uncertainty is sanitized, not retried, and can reconcile the same requestId", async () => {
  for (const kind of ["http", "network"] as const) {
    const f = fixture();
    f.transport(async () => { if (kind === "network") throw new Error("private sentinel");
      return json({ code: "XX000", message: "private sentinel", details: "private sentinel" }, 503); });
    await assert.rejects(f.repo.createInvitation({ recipientEmail: "synthetic@example.test", requestId }), issue("unavailable"));
    assert.equal(f.requests.length, 1);
    f.transport(null);
    assert.equal((await f.repo.readOwnOperation(requestId))?.requestId, requestId);
    assert.equal(f.requests.length, 2);
  }
});

test("SDK malformed successes and private Auth exceptions are sanitized without inventing delivery", async () => {
  const f = fixture(); f.transport(async () => json({ status: "sent", recipientEmail: "private sentinel" }));
  await assert.rejects(f.repo.createInvitation({ recipientEmail: "synthetic@example.test", requestId }), issue("invalid_response"));
  const g = fixture(); g.session(async () => { throw new Error("private sentinel"); });
  await assert.rejects(g.repo.readOwnOperation(requestId), issue("unavailable"));
  assert.equal(g.requests.length, 0);
});
