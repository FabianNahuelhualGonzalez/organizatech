import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createCoachActiveRelationshipsRuntime, type CoachActiveRelationshipsRuntimeInput } from "./coach-active-relationships-runtime";
import { createCoachPendingInvitationsRuntime } from "./coach-pending-invitations-runtime";
import type { CoachActiveRelationshipRow, CoachActiveRelationshipsPage } from "../data/coach-active-relationships-contract";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const token = "synthetic-not-a-credential";
const configuration = { url: "https://coach-active.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
const serverNow = "2026-09-09T09:00:00.000001+00:00";
const row = (n: number): CoachActiveRelationshipRow => ({
  id: `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  studentName: `Alumno ${n}`, studentEmail: `fixture${n}@example.invalid`,
  linkedAt: `2026-09-09T08:00:00.${String(n).padStart(6, "0")}+00:00`,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
type Request = { name: string; body: Record<string, string | number | null>; signal?: AbortSignal | null };

/** Real installed SDK, synthetic Auth/fetch only. No network, DB or credentials. */
function fixture(pageSize = 2, timeoutMilliseconds?: number) {
  let current = true; let verifiedOwner = owner; let authCalls = 0; let verifyCalls = 0;
  let rows = [row(3), row(2), row(1)];
  let transport: ((request: Request) => Promise<Response>) | null = null;
  let sessionGate: Promise<void> | null = null;
  let onVerified: (() => void) | null = null;
  const requests: Request[] = [];
  const normalReply = (request: Request) => {
    assert.equal(request.name, "list_own_active_coach_relationships");
    assert.deepEqual(Object.keys(request.body).sort(), ["p_cursor_id", "p_cursor_linked_at", "p_limit", "p_query"]);
    const query = String(request.body.p_query);
    // Fixture matching only. Production matching remains server-owned Unicode.
    const filtered = rows.filter((value) => value.studentEmail.includes(query) || value.studentName.includes(query));
    const cursor = request.body.p_cursor_linked_at;
    const remaining = cursor === null ? filtered : filtered.filter((value) => value.linkedAt < String(cursor));
    const limit = Number(request.body.p_limit);
    const items = remaining.slice(0, limit);
    const last = items.at(-1);
    const page: CoachActiveRelationshipsPage = { serverNow, totalActive: rows.length, matchingCount: filtered.length,
      items, nextCursor: remaining.length > limit && last ? { id: last.id, linkedAt: last.linkedAt } : null };
    return json(page);
  };
  const input: CoachActiveRelationshipsRuntimeInput = {
    pageSize,
    connection: { configuration: { ...configuration }, expectedIdentity: { userId: owner, generation: 7 }, timeoutMilliseconds,
      isCurrent: (identity) => current && identity.userId === owner && identity.generation === 7,
      principal: { auth: {
        getSession: async () => { authCalls++; if (sessionGate) await sessionGate;
          return { data: { session: { user: { id: owner }, access_token: token } }, error: null }; },
        getUser: async (value) => { verifyCalls++; assert.equal(value, token); onVerified?.();
          return { data: { user: { id: verifiedOwner } }, error: null }; },
      } },
      fetch: async (url, init = {}) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.origin, configuration.url); assert.equal(init.method, "POST");
        assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
        assert.equal(new Headers(init.headers).get("apikey"), configuration.publicKey);
        const request = { name: parsed.pathname.split("/").at(-1)!, body: JSON.parse(String(init.body)), signal: init.signal };
        requests.push(request);
        return transport ? transport(request) : normalReply(request);
      },
    },
  };
  const controller = createCoachActiveRelationshipsRuntime(input);
  return { input, controller, requests, normalReply,
    counts: () => ({ authCalls, verifyCalls }), current: (value: boolean) => { current = value; },
    verifiedOwner: (value: string) => { verifiedOwner = value; },
    transport: (value: typeof transport) => { transport = value; }, rows: (value: typeof rows) => { rows = value; },
    sessionGate: (value: typeof sessionGate) => { sessionGate = value; }, onVerified: (value: typeof onVerified) => { onVerified = value; },
  };
}

test("construction performs no I/O; load uses the single own-list RPC with an exact allowlist", async () => {
  const f = fixture(); assert.deepEqual(f.counts(), { authCalls: 0, verifyCalls: 0 });
  assert.equal(await f.controller.load(), true);
  assert.deepEqual(f.requests[0].body, { p_query: "", p_limit: 2, p_cursor_linked_at: null, p_cursor_id: null });
  assert.deepEqual(f.counts(), { authCalls: 1, verifyCalls: 1 });
  assert.equal(f.controller.getSnapshot().phase, "ready");
  assert.equal(f.controller.getSnapshot().items.length, 2);
  assert.equal(f.controller.getSnapshot().totalActive, 3);
  assert.equal(f.controller.getSnapshot().matchingCount, 3);
  const state = JSON.stringify(f.controller.getSnapshot());
  assert.ok(state.includes("fixture3@example.invalid") && state.includes("fixture2@example.invalid"));
  assert.ok(!state.includes(token) && !state.includes(configuration.publicKey) && !state.includes(owner));
  f.controller.dispose();
});

test("next page preserves the exact microsecond cursor and does not reload a complete list", async () => {
  const f = fixture(); await f.controller.load();
  assert.equal(await f.controller.loadNext(), true);
  assert.deepEqual(f.requests[1].body, { p_query: "", p_limit: 2,
    p_cursor_linked_at: row(2).linkedAt, p_cursor_id: row(2).id });
  const state = JSON.stringify(f.controller.getSnapshot());
  for (const n of [1, 2, 3]) assert.ok(state.includes(row(n).studentEmail));
  assert.equal(f.controller.getSnapshot().items.length, 3);
  assert.equal(f.controller.getSnapshot().nextCursor, null);
  assert.equal(await f.controller.loadNext(), false); assert.equal(f.requests.length, 2); f.controller.dispose();
});

test("changing query aborts and settles an older read even if its fetch ignores abort", async () => {
  const f = fixture(); const late = deferred<Response>();
  f.transport(async (request) => request.body.p_query === "" ? late.promise : f.normalReply(request));
  const first = f.controller.load(); await setImmediate();
  assert.equal(f.controller.setQuery("fixture1"), true);
  assert.equal(await first, false); assert.equal(f.requests.length, 1);
  assert.equal(await f.controller.load(), true);
  assert.equal(f.requests[0].signal?.aborted, true);
  assert.deepEqual(f.requests[1].body, { p_query: "fixture1", p_limit: 2, p_cursor_linked_at: null, p_cursor_id: null });
  late.resolve(f.normalReply(f.requests[0])); await setImmediate();
  const state = JSON.stringify(f.controller.getSnapshot());
  assert.ok(state.includes(row(1).studentEmail)); assert.ok(!state.includes(row(3).studentEmail)); f.controller.dispose();
});

test("reload discards earlier pages and duplicate next-page calls remain single-flight", async () => {
  const f = fixture(); await f.controller.load(); const late = deferred<Response>();
  f.transport(async (request) => request.body.p_cursor_id !== null ? late.promise : f.normalReply(request));
  const next = f.controller.loadNext(); await setImmediate();
  assert.equal(await f.controller.loadNext(), false); assert.equal(f.requests.length, 2);
  f.rows([row(4)]); assert.equal(await f.controller.reload(), true); assert.equal(await next, false);
  assert.equal(f.requests[1].signal?.aborted, true);
  late.resolve(json({ serverNow, totalActive: 3, matchingCount: 3, items: [row(1)], nextCursor: null }));
  await setImmediate(); const state = JSON.stringify(f.controller.getSnapshot());
  assert.ok(state.includes(row(4).studentEmail)); assert.ok(!state.includes(row(1).studentEmail)); f.controller.dispose();
});

test("failed next page does not become an empty portfolio or silently retry", async () => {
  const f = fixture(); await f.controller.load();
  f.transport(async () => json({ code: "XX000", message: "private sentinel" }, 503));
  assert.equal(await f.controller.loadNext(), false); assert.equal(f.requests.length, 2);
  const state = JSON.stringify(f.controller.getSnapshot());
  assert.ok(state.includes(row(3).studentEmail) && state.includes("unavailable"));
  assert.equal(f.controller.getSnapshot().phase, "error");
  assert.equal(f.controller.getSnapshot().issue, "unavailable");
  assert.ok(!state.includes("private sentinel"));
  f.transport(null); assert.equal(await f.controller.loadNext(), true);
  assert.deepEqual(f.requests[1].body, f.requests[2].body); f.controller.dispose();
});

test("snapshot counts may shrink when a relationship is revoked between pages", async () => {
  const f = fixture(); await f.controller.load(); f.rows([row(3)]);
  assert.equal(await f.controller.loadNext(), true);
  assert.equal(f.controller.getSnapshot().totalActive, 1);
  assert.equal(f.controller.getSnapshot().matchingCount, 1);
  assert.equal(await f.controller.loadNext(), false); assert.equal(f.requests.length, 2);
  // Loaded pages are not a transactionally frozen portfolio. Reload obtains a new first page.
  assert.equal(await f.controller.reload(), true);
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes(row(2).studentEmail)); f.controller.dispose();
});

test("captured config, identity and page size cannot be retargeted by input mutation", async () => {
  const f = fixture();
  Object.assign(f.input.connection.configuration, { url: "https://wrong.example.invalid", publicKey: "sb_publishable_other" });
  Object.assign(f.input.connection.expectedIdentity, { userId: other, generation: 99 });
  Object.assign(f.input, { pageSize: 50 });
  assert.equal(await f.controller.load(), true); assert.equal(f.requests[0].body.p_limit, 2); f.controller.dispose();
});

test("identity invalidation observed during Auth is permanent even if callback later returns true", async () => {
  const f = fixture(); f.onVerified(() => f.current(false));
  assert.equal(await f.controller.load(), false); assert.equal(f.requests.length, 0);
  f.current(true); f.onVerified(null);
  assert.equal(await f.controller.load(), false); assert.equal(f.requests.length, 0);
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("@example.invalid")); f.controller.dispose();
});

test("a mismatched verified user never sends RPC or exposes the previous page", async () => {
  const f = fixture(); await f.controller.load(); f.verifiedOwner(other);
  assert.equal(await f.controller.loadNext(), false); assert.equal(f.requests.length, 1);
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("@example.invalid"));
  f.verifiedOwner(owner); assert.equal(await f.controller.reload(), false); f.controller.dispose();
});

test("explicit invalidation and disposal settle pending reads and discard late results", async () => {
  for (const action of ["invalidate", "dispose"] as const) {
    const f = fixture(); const late = deferred<Response>(); f.transport(async () => late.promise);
    const loading = f.controller.load(); await setImmediate(); f.controller[action]();
    assert.equal(await loading, false); assert.equal(f.requests[0].signal?.aborted, true);
    late.resolve(f.normalReply(f.requests[0])); await setImmediate();
    assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("@example.invalid"));
    if (action === "dispose") assert.equal(await f.controller.load(), false);
    else {
      assert.equal(f.requests.length, 1); f.transport(null);
      assert.equal(await f.controller.load(), true);
    }
    f.controller.dispose();
  }
});

test("total deadline covers a non-abortable Auth read and prevents late verification or RPC", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(2, 100); const gate = deferred<void>(); f.sessionGate(gate.promise);
  const loading = f.controller.load(); await setImmediate(); t.mock.timers.tick(100);
  assert.equal(await loading, false); assert.equal(f.requests.length, 0);
  assert.ok(JSON.stringify(f.controller.getSnapshot()).includes("timeout"));
  gate.resolve(); await setImmediate(); assert.equal(f.counts().verifyCalls, 0);
  f.sessionGate(null); assert.equal(await f.controller.reload(), true); f.controller.dispose();
});

test("transport deadline aborts and discards a success returned after timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(2, 100); const late = deferred<Response>(); f.transport(async () => late.promise);
  const loading = f.controller.load(); await setImmediate(); t.mock.timers.tick(100);
  assert.equal(await loading, false); assert.equal(f.requests[0].signal?.aborted, true);
  late.resolve(f.normalReply(f.requests[0])); await setImmediate();
  assert.ok(JSON.stringify(f.controller.getSnapshot()).includes("timeout"));
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("@example.invalid")); f.controller.dispose();
});

test("invalid responses and forbidden reads never masquerade as a successful empty state", async () => {
  for (const kind of ["malformed", "forbidden"] as const) {
    const f = fixture();
    f.transport(async () => kind === "forbidden" ? json({ code: "42501", message: "private sentinel" }, 403)
      : json({ serverNow, totalActive: 0, matchingCount: 0, items: [], nextCursor: null, code: "private sentinel" }));
    assert.equal(await f.controller.load(), false); const state = JSON.stringify(f.controller.getSnapshot());
    assert.ok(state.includes(kind === "forbidden" ? "forbidden" : "invalid_response"));
    assert.ok(!state.includes("private sentinel")); assert.equal(f.requests.length, 1); f.controller.dispose();
  }
});

test("invalid technical page sizes fail before any Auth or HTTP work", () => {
  const f = fixture();
  for (const pageSize of [0, 51, NaN, Infinity, 1.5]) assert.throws(() => createCoachActiveRelationshipsRuntime({ ...f.input, pageSize }));
  assert.deepEqual(f.counts(), { authCalls: 0, verifyCalls: 0 }); f.controller.dispose();
});

test("an account change observed in a snapshot purges loaded rows without another request", async () => {
  const f = fixture(); await f.controller.load(); f.current(false);
  assert.equal(f.controller.getSnapshot().items.length, 0);
  assert.equal(f.controller.getSnapshot().totalActive, null);
  f.current(true); assert.equal(await f.controller.reload(), false);
  assert.equal(f.requests.length, 1); f.controller.dispose();
});

test("invalid queries fail locally and never send malformed data to the source", async () => {
  const f = fixture();
  for (const query of ["a".repeat(255), "é".repeat(128), "a\0b", "\ud800"]) {
    assert.equal(f.controller.setQuery(query), false);
    assert.equal(await f.controller.load(), false);
    assert.equal(f.controller.getSnapshot().issue, "invalid_input");
  }
  assert.deepEqual(f.counts(), { authCalls: 0, verifyCalls: 0 });
  assert.equal(f.controller.setQuery("fixture1"), true);
  assert.equal(await f.controller.load(), true); assert.equal(f.requests.length, 1); f.controller.dispose();
});

test("active identity is exact, searchable by name and may retain a finite future linkedAt", async () => {
  const f = fixture();
  const value = { ...row(1), studentName: "Nombre sin coincidencia en correo", linkedAt: "2027-01-01T00:00:00.123456Z" };
  f.rows([value]);
  assert.equal(f.controller.setQuery("Nombre"), true);
  assert.equal(await f.controller.load(), true);
  assert.deepEqual(f.controller.getSnapshot().items, [value]);
  assert.deepEqual(Object.keys(f.controller.getSnapshot().items[0]).sort(), ["id", "linkedAt", "studentEmail", "studentName"]);
  for (const field of ["totalPending", "createdAt", "recipientEmail", "cycle", "progress", "trainingSessions"]) {
    assert.equal(JSON.stringify(f.controller.getSnapshot()).includes(`\"${field}\"`), false);
  }
  f.controller.dispose();
});

test("active and pending SDK runtimes share neither loaded data nor cancellation state", async () => {
  const f = fixture(); let pendingCalls = 0;
  const pending = createCoachPendingInvitationsRuntime({ pageSize: 2,
    connection: { ...f.input.connection, fetch: async (url, init = {}) => {
      assert.equal(String(url), `${configuration.url}/rest/v1/rpc/list_own_pending_coach_invitations`);
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
      pendingCalls++;
      return json({ serverNow, totalPending: 1, matchingCount: 1, items: [{ id: row(1).id,
        recipientEmail: "pending-only@example.invalid", createdAt: "2026-09-09T08:00:00.000001Z",
        issuedAt: "2026-09-09T08:00:00.000001Z", expiresAt: "2026-09-16T08:00:00.000001Z", state: "pending" }],
      nextCursor: null });
    } },
  });
  assert.deepEqual(await Promise.all([f.controller.load(), pending.load()]), [true, true]);
  const pendingSnapshot = pending.getSnapshot();
  assert.equal(f.controller.getSnapshot().totalActive, 3);
  assert.equal(pendingSnapshot.totalPending, 1);
  assert.equal(f.controller.setQuery("fixture1"), true);
  assert.equal(pending.getSnapshot(), pendingSnapshot);
  assert.equal(await f.controller.load(), true);
  assert.equal(pending.getSnapshot(), pendingSnapshot);
  assert.equal(pendingCalls, 1);
  pending.dispose();
  assert.equal(f.controller.getSnapshot().items[0].studentName, "Alumno 1");
  assert.equal(await f.controller.reload(), true);
  f.controller.dispose();
});
