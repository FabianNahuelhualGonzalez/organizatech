import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { CoachInvitationsPrincipal } from "./coach-invitations-operation";
import { CoachPaidPeriodsError, type CoachPaidPeriodsErrorCode } from "./coach-paid-periods-contract";
import { createSupabaseCoachPaidPeriodsRepository } from "./supabase-coach-paid-periods-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const episodeId = "20000000-0000-4000-8000-000000000001";
const periodId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const version = "50000000-0000-4000-8000-000000000001";
const zero = "00000000-0000-0000-0000-000000000000";
const recordedAt = "2026-09-09T06:00:00.123456+00:00";
// Synthetic fixtures only. Every SDK fetch below is intercepted; no external I/O.
const configuration = { url: "https://coach-paid-periods.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
const token = "synthetic-session-token-not-a-credential";
const command = { episodeId, start: "2026-09-10", end: "2026-10-10", expectedVersion: zero, requestId };
const period = { id: periodId, linkEpisodeId: episodeId, start: command.start, end: command.end };
const receipt = (action = "confirm") => ({ requestId, action, period, version, recordedAt });
type SessionReply = Awaited<ReturnType<CoachInvitationsPrincipal["auth"]["getSession"]>>;
type UserReply = Awaited<ReturnType<CoachInvitationsPrincipal["auth"]["getUser"]>>;
const session = (id = owner, accessToken = token): SessionReply => ({
  data: { session: { user: { id }, access_token: accessToken } }, error: null,
});
const verified = (id = owner): UserReply => ({ data: { user: { id } }, error: null });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const issue = (code: CoachPaidPeriodsErrorCode) => (error: unknown) => error instanceof CoachPaidPeriodsError
  && error.code === code && error.message === `coach-paid-periods-${code}` && !("cause" in error);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(timeoutMilliseconds?: number) {
  let currentUser = owner; let generation = 1;
  let sessionCalls = 0; let userCalls = 0;
  let onSession: () => PromiseLike<SessionReply> = async () => session();
  let onUser: () => PromiseLike<UserReply> = async () => verified();
  let transport: ((name: string, init: RequestInit) => Promise<Response>) | null = null;
  const requests: { name: string; body: unknown; signal: AbortSignal | null | undefined }[] = [];
  const config = { ...configuration }; const expectedIdentity = { userId: owner, generation: 1 };
  const repo = createSupabaseCoachPaidPeriodsRepository({ configuration: config, expectedIdentity,
    timeoutMilliseconds, isCurrent: (identity) => identity.userId === currentUser && identity.generation === generation,
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
      requests.push({ name, body: JSON.parse(String(init.body)), signal: init.signal });
      if (transport) return transport(name, init);
      if (name === "read_own_coach_paid_period") return json({ linkEpisodeId: episodeId, period, version });
      if (name === "read_own_coach_paid_period_operation") return json(receipt());
      return json({ status: "recorded", operation: receipt(name.startsWith("correct") ? "correct" : "confirm") });
    },
  });
  return { repo, requests, config, expectedIdentity,
    counters: () => ({ sessionCalls, userCalls }),
    session: (next: typeof onSession) => { onSession = next; },
    user: (next: typeof onUser) => { onUser = next; },
    transport: (next: typeof transport) => { transport = next; },
    changeUser: () => { currentUser = other; }, changeGeneration: () => { generation++; },
  };
}

test("paid runtime serializes four narrow RPCs through the real SDK and pinned principal", async () => {
  const f = fixture();
  assert.equal((await f.repo.confirmPeriod(command)).operation.action, "confirm");
  assert.equal((await f.repo.correctPeriod({ ...command, periodId })).operation.action, "correct");
  assert.deepEqual(await f.repo.readPeriod(episodeId), { linkEpisodeId: episodeId, period, version });
  assert.equal((await f.repo.readOwnOperation(requestId))?.recordedAt, recordedAt);
  assert.deepEqual(f.requests.map(({ name, body }) => [name, body]), [
    ["confirm_own_coach_paid_period", { p_episode_id: episodeId, p_start: command.start, p_end: command.end,
      p_expected_version: zero, p_request_id: requestId }],
    ["correct_own_coach_paid_period", { p_episode_id: episodeId, p_period_id: periodId, p_start: command.start,
      p_end: command.end, p_expected_version: zero, p_request_id: requestId }],
    ["read_own_coach_paid_period", { p_episode_id: episodeId }],
    ["read_own_coach_paid_period_operation", { p_request_id: requestId }],
  ]);
  assert.deepEqual(f.counters(), { sessionCalls: 4, userCalls: 4 });
});

test("public config and identity are snapshotted; absent period and receipt remain genuine nulls", async () => {
  const f = fixture();
  f.config.url = "https://different.example.invalid"; f.config.publicKey = "sb_publishable_changed";
  f.expectedIdentity.userId = other; f.expectedIdentity.generation = 2;
  f.transport(async (name) => json(name.endsWith("_operation") ? null : { linkEpisodeId: episodeId, period: null, version: zero }));
  assert.deepEqual(await f.repo.readPeriod(episodeId), { linkEpisodeId: episodeId, period: null, version: zero });
  assert.equal(await f.repo.readOwnOperation(requestId), null);
  assert.equal(f.requests.length, 2);
});

test("invalid/private configuration and identity fail with paid errors before any Auth or fetch", () => {
  const input = { configuration, expectedIdentity: { userId: owner, generation: 1 }, isCurrent: () => true,
    principal: { auth: { getSession: async () => { assert.fail("no Auth"); }, getUser: async () => { assert.fail("no Auth"); } } },
    fetch: async () => { assert.fail("no fetch"); } };
  for (const publicKey of ["", "sb_secret_synthetic", "unknown", "sb_publishable_bad key",
    "e30." + btoa(JSON.stringify({ role: "service_role" })) + ".synthetic", "e30.bnVsbA.synthetic"]) {
    assert.throws(() => createSupabaseCoachPaidPeriodsRepository({ ...input, configuration: { ...configuration, publicKey } }), issue("invalid_input"));
  }
  for (const url of ["bad", "http://remote.example.invalid", "https://user:password@example.invalid", configuration.url + "?x=1", configuration.url + "#x"]) {
    assert.throws(() => createSupabaseCoachPaidPeriodsRepository({ ...input, configuration: { ...configuration, url } }), issue("invalid_input"));
  }
  for (const expectedIdentity of [{ userId: "fake", generation: 1 }, { userId: owner, generation: -1 }, { userId: owner, generation: 0.1 }]) {
    assert.throws(() => createSupabaseCoachPaidPeriodsRepository({ ...input, expectedIdentity }), issue("invalid_input"));
  }
  assert.doesNotThrow(() => createSupabaseCoachPaidPeriodsRepository({ ...input,
    configuration: { ...configuration, publicKey: "e30." + btoa(JSON.stringify({ role: "anon" })) + ".synthetic" } }));
});

test("missing, mismatching or rejected Auth never writes; private exceptions are sanitized", async () => {
  for (const mode of ["missing", "other", "bad-token", "failed-verification", "private-exception"]) {
    const f = fixture();
    if (mode === "missing") f.session(async () => ({ data: { session: null }, error: null }));
    if (mode === "other") f.session(async () => session(other));
    if (mode === "bad-token") f.session(async () => session(owner, "bad token"));
    if (mode === "failed-verification") f.user(async () => verified(other));
    if (mode === "private-exception") f.session(async () => { throw new Error("private sentinel"); });
    await assert.rejects(f.repo.confirmPeriod(command), issue(mode === "private-exception" ? "unavailable" : "forbidden"));
    assert.equal(f.requests.length, 0);
  }
});

test("account and portal generation switches invalidate capture and both late SDK outcomes", async () => {
  for (const change of ["changeUser", "changeGeneration"] as const) {
    const before = fixture(); before[change]();
    await assert.rejects(before.repo.confirmPeriod(command), issue("operation_stale"));
    assert.deepEqual(before.counters(), { sessionCalls: 0, userCalls: 0 });
    const during = fixture(); during.session(async () => { during[change](); return session(); });
    await assert.rejects(during.repo.confirmPeriod(command), issue("operation_stale"));
    assert.deepEqual(during.counters(), { sessionCalls: 1, userCalls: 0 });
    const afterVerification = fixture(); afterVerification.user(async () => { afterVerification[change](); return verified(); });
    await assert.rejects(afterVerification.repo.confirmPeriod(command), issue("operation_stale"));
    assert.equal(afterVerification.requests.length, 0);
    for (const reject of [false, true]) {
      const late = fixture(); late.transport(async () => {
        late[change](); if (reject) throw new Error("private sentinel");
        return json({ status: "recorded", operation: receipt() });
      });
      await assert.rejects(late.repo.confirmPeriod(command), issue("operation_stale"));
      assert.equal(late.requests.length, 1);
    }
  }
});

test("credential used by SDK stays the exact token verified even if the session object changes", async () => {
  const f = fixture(); const captured = session();
  f.session(async () => captured);
  f.user(async () => { Object.assign(captured.data.session!, { access_token: "different-synthetic-token" }); return verified(); });
  await f.repo.readPeriod(episodeId);
  assert.equal(f.requests.length, 1);
});

test("capture timeout and caller abort suppress non-abortable late Auth continuations", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(80); const delayedSession = deferred<SessionReply>(); f.session(() => delayedSession.promise);
  const failed = assert.rejects(f.repo.confirmPeriod(command), issue("timeout"));
  await setImmediate(); t.mock.timers.tick(80); await failed; delayedSession.resolve(session()); await setImmediate();
  assert.deepEqual(f.counters(), { sessionCalls: 1, userCalls: 0 }); assert.equal(f.requests.length, 0);
  const g = fixture(); const delayedUser = deferred<UserReply>(); const abort = new AbortController();
  g.user(() => delayedUser.promise);
  const aborted = assert.rejects(g.repo.confirmPeriod(command, { signal: abort.signal }), issue("aborted"));
  await setImmediate(); abort.abort(); await aborted;
  delayedUser.resolve(verified()); await setImmediate(); assert.equal(g.requests.length, 0);
});

test("capture and SDK transport share one deadline and never retry or implicitly reconcile", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(100); const delayed = deferred<SessionReply>(); const response = deferred<Response>();
  f.session(() => delayed.promise); f.transport(async () => response.promise);
  const failed = assert.rejects(f.repo.confirmPeriod(command), issue("timeout"));
  t.mock.timers.tick(60); delayed.resolve(session()); await setImmediate();
  assert.equal(f.requests.length, 1); t.mock.timers.tick(40); await failed;
  assert.equal(f.requests[0].signal?.aborted, true);
  response.resolve(json({ status: "recorded", operation: receipt() })); await setImmediate();
  t.mock.timers.tick(30_000); await setImmediate(); assert.equal(f.requests.length, 1);
});

test("HTTP/network uncertainty performs one write then only explicit same-request reconciliation", async () => {
  for (const kind of ["http", "network"] as const) {
    const f = fixture(); f.transport(async () => {
      if (kind === "network") throw new Error("private sentinel");
      return json({ code: "XX000", message: "private sentinel", details: "private sentinel" }, 503);
    });
    await assert.rejects(f.repo.confirmPeriod(command), issue("unavailable")); assert.equal(f.requests.length, 1);
    f.transport(null); assert.equal((await f.repo.readOwnOperation(requestId))?.requestId, requestId);
    assert.deepEqual(f.requests.map((r) => r.name), ["confirm_own_coach_paid_period", "read_own_coach_paid_period_operation"]);
  }
});

test("SDK errors preserve business conflict codes; malformed or mismatching successes are rejected", async () => {
  for (const [code, message, expected] of [
    ["40001", "coach_paid_period_version_conflict", "version_conflict"],
    ["22023", "coach_paid_period_request_conflict", "request_conflict"],
    ["55000", "private sentinel", "inactive_relationship"],
  ] as const) {
    const f = fixture(); f.transport(async () => json({ code, message, details: "private sentinel" }, 409));
    await assert.rejects(f.repo.confirmPeriod(command), issue(expected)); assert.equal(f.requests.length, 1);
  }
  for (const operation of [{ ...receipt(), requestId: other }, { ...receipt(), period: { ...period, linkEpisodeId: other } },
    { ...receipt(), private: "sentinel" }]) {
    const f = fixture(); f.transport(async () => json({ status: "recorded", operation }));
    await assert.rejects(f.repo.confirmPeriod(command), issue("invalid_response")); assert.equal(f.requests.length, 1);
  }
});
