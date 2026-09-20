import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoachPendingInvitationsController } from "./coach-pending-invitations-controller";
import type { CoachPendingInvitationsController, CoachPendingInvitationsItem, CoachPendingInvitationsPage,
  CoachPendingInvitationsQuery, CoachPendingInvitationsSource,
} from "./coach-pending-invitations-controller-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function item(number: number, createdAt = `2026-09-09T08:00:00.${String(number).padStart(6, "0")}Z`): CoachPendingInvitationsItem {
  return { id: id(number), createdAt, recipientEmail: `invited-${number}@example.test`,
    issuedAt: "2026-09-09T09:00:00Z", expiresAt: "2026-09-16T09:00:00Z", state: "pending" };
}
function page(items: readonly CoachPendingInvitationsItem[] = [], next = false, count = items.length): CoachPendingInvitationsPage {
  const last = items.at(-1);
  return { serverNow: "2026-09-09T10:00:00Z", totalPending: count, matchingCount: count, items,
    nextCursor: next && last ? { id: last.id, createdAt: last.createdAt } : null };
}

function harness(pageSize?: number) {
  const context = { user: "owner-A", generation: 1, selectedContext: "coach" };
  const calls: { query: CoachPendingInvitationsQuery; signal: AbortSignal }[] = [];
  const handler: CoachPendingInvitationsSource = { list: async () => page() };
  const controller = createCoachPendingInvitationsController({ pageSize,
    isCurrent: () => context.user === "owner-A" && context.generation === 1 && context.selectedContext === "coach",
    source: { list: (query, options) => { calls.push({ query, signal: options.signal }); return handler.list(query, options); } },
  });
  return { controller, context, calls, handler };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }

// A pending source is deliberately never resolved: cancelled public work must already settle.
async function settledFalse(promise: Promise<boolean>) {
  const marker = Symbol("still pending");
  assert.equal(await Promise.race([promise, Promise.resolve(marker)]), false);
}

test("construction, subscription, search and invalidation are idle and never dispatch implicitly", async () => {
  const h = harness();
  const initial = h.controller.getSnapshot();
  assert.deepEqual(initial, { query: "", pageSize: 25, phase: "idle", items: [], serverNow: null,
    totalPending: null, matchingCount: null, nextCursor: null, issue: null });
  assert.equal(h.controller.getSnapshot(), initial);
  let notifications = 0;
  const unsubscribe = h.controller.subscribe(() => { notifications += 1; });
  assert.equal(notifications, 0);
  assert.equal(h.controller.setQuery("raw search"), true);
  assert.equal(h.controller.invalidate(), true);
  assert.equal(await h.controller.loadNext(), false);
  assert.equal(h.controller.canLoadNext(), false);
  assert.equal(h.calls.length, 0);
  unsubscribe();
  h.controller.dispose();
});

test("page size is explicit bounded configuration, not a source-side default", async () => {
  for (const pageSize of [1, 25, 50]) {
    const h = harness(pageSize);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.calls[0].query.limit, pageSize);
  }
  for (const pageSize of [0, -1, 51, 1.1, NaN, Infinity, null, "25"]) {
    assert.throws(() => harness(pageSize as number), { name: "RangeError", message: "invalid_input" });
  }
});

test("raw Unicode query is bounded by UTF8 bytes without normalization or client filtering", async () => {
  for (const raw of ["", "a".repeat(254), "é".repeat(127), "😀".repeat(63) + "ab", "  ΟΣ e\u0301  "]) {
    const h = harness();
    h.handler.list = async () => page([item(1)]);
    assert.equal(h.controller.setQuery(raw), true);
    assert.equal(h.calls.length, 0);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.calls[0].query.query, raw);
    assert.equal(h.controller.getSnapshot().query, raw);
    assert.equal(h.controller.getSnapshot().items.length, 1);
  }
});

test("invalid raw text is preserved, clears prior facts, and never reaches source", async () => {
  for (const raw of ["a".repeat(255), "é".repeat(128), "😀".repeat(64), "x\0y", "\ud800", "\udc00", "\ud800x", "x\udfff"]) {
    const h = harness();
    h.handler.list = async () => page([item(1)]);
    await h.controller.load();
    assert.equal(h.controller.setQuery(raw), false);
    assert.equal(await h.controller.load(), false);
    assert.equal(await h.controller.reload(), false);
    assert.equal(await h.controller.loadNext(), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.controller.getSnapshot().query, raw);
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(h.controller.getSnapshot().issue, "invalid_input");
    assert.equal(h.controller.getSnapshot().totalPending, null);
    assert.deepEqual(h.controller.getSnapshot().items, []);
    assert.equal(h.controller.setQuery("corrected"), true);
    assert.equal(h.controller.getSnapshot().phase, "idle");
  }
  const h = harness();
  assert.equal(h.controller.setQuery(null as unknown as string), false);
  assert.equal(h.calls.length, 0);
});

test("load is single-flight and source snapshots are copied/frozen with an exact field allowlist", async () => {
  const h = harness(1);
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const work = h.controller.load();
  assert.equal(h.controller.getSnapshot().phase, "loading");
  assert.equal(await h.controller.load(), false);
  assert.equal(await h.controller.loadNext(), false);
  assert.equal(h.calls.length, 1);
  const row = { ...item(2), name: "not part of the DTO", code: "not copied", ownerId: "not copied" };
  const raw = { ...page([row], true, 2), private: "not copied" };
  pending.resolve(raw);
  assert.equal(await work, true);
  const snapshot = h.controller.getSnapshot();
  assert.equal(snapshot.items[0] === row, false);
  assert.deepEqual(Object.keys(snapshot.items[0]).sort(), ["createdAt", "expiresAt", "id", "issuedAt", "recipientEmail", "state"]);
  assert.equal(Object.hasOwn(snapshot, "private"), false);
  for (const value of [snapshot, snapshot.items, snapshot.items[0], snapshot.nextCursor, h.calls[0].query]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(raw), false);
  assert.equal(Object.isFrozen(row), false);
  row.recipientEmail = "changed@example.test";
  Object.assign(raw.nextCursor!, { id: "changed" });
  assert.equal(snapshot.items[0].recipientEmail, "invited-2@example.test");
  assert.equal(snapshot.nextCursor!.id, id(2));
});

test("changed search settles cancelled public promise even if source ignores abort forever", async () => {
  const h = harness();
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const old = h.controller.load();
  assert.equal(h.controller.setQuery("new"), true);
  await settledFalse(old);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.calls.length, 1);
  h.handler.list = async () => page([item(9)]);
  assert.equal(await h.controller.load(), true);
  pending.resolve(page([item(1)]));
  await flush();
  assert.equal(h.controller.getSnapshot().query, "new");
  assert.equal(h.controller.getSnapshot().items[0].id, id(9));
  assert.equal(h.calls[1].query.cursor, null);
});

test("setting the same query also resets the cursor and aborts active work without refetching", async () => {
  const h = harness();
  h.controller.setQuery("same");
  h.handler.list = () => deferred<CoachPendingInvitationsPage>().promise;
  const work = h.controller.load();
  assert.equal(h.controller.setQuery("same"), true);
  await settledFalse(work);
  assert.equal(h.controller.getSnapshot().phase, "idle");
  assert.equal(h.calls.length, 1);
});

test("reload replaces an active first page; late rejection cannot overwrite its result", async () => {
  const h = harness();
  const oldSource = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => oldSource.promise;
  const old = h.controller.load();
  h.handler.list = async () => page([item(2)]);
  assert.equal(await h.controller.reload(), true);
  await settledFalse(old);
  oldSource.reject({ code: "forbidden", message: "synthetic hidden message" });
  await flush();
  assert.equal(h.controller.getSnapshot().phase, "ready");
  assert.equal(h.controller.getSnapshot().items[0].id, id(2));
  assert.equal(h.calls[1].query.cursor, null);
});

test("reload keeps same-query rows while loading/error but discards obsolete pagination", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const work = h.controller.reload();
  assert.equal(h.controller.getSnapshot().items.length, 1);
  assert.equal(h.controller.getSnapshot().phase, "loading");
  assert.equal(h.controller.getSnapshot().nextCursor, null);
  pending.reject({ code: "timeout" });
  assert.equal(await work, false);
  assert.equal(h.controller.getSnapshot().phase, "error");
  assert.equal(h.controller.getSnapshot().items[0].id, id(3));
  assert.equal(h.controller.getSnapshot().matchingCount, 3);
  assert.equal(h.controller.canLoadNext(), false);
  assert.equal(await h.controller.loadNext(), false);
  h.handler.list = async () => page([item(8)]);
  assert.equal(await h.controller.reload(), true);
  assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(8)]);
});

test("next failure preserves rows and cursor for explicit retry of the same position", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const next = h.controller.loadNext();
  assert.equal(h.controller.getSnapshot().phase, "loading-next");
  assert.equal(await h.controller.loadNext(), false);
  assert.equal(h.controller.canLoadNext(), false);
  pending.reject({ code: "unavailable" });
  assert.equal(await next, false);
  assert.equal(h.controller.getSnapshot().phase, "error");
  assert.equal(h.controller.getSnapshot().items[0].id, id(3));
  assert.equal(h.controller.canLoadNext(), true);
  assert.equal(h.calls.length, 2);
  const failedCursor = h.calls[1].query.cursor;
  h.handler.list = async () => page([item(2)], true, 3);
  assert.equal(await h.controller.loadNext(), true);
  assert.deepEqual(h.calls[2].query.cursor, failedCursor);
  assert.equal(Object.isFrozen(h.calls[2].query.cursor), true);
  assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(3), id(2)]);
});

test("reload supersedes pending next page and never mixes its late rows", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const next = h.controller.loadNext();
  h.handler.list = async () => page([item(8)]);
  assert.equal(await h.controller.reload(), true);
  await settledFalse(next);
  pending.resolve(page([item(2)]));
  await flush();
  assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(8)]);
  assert.equal(h.calls[2].query.cursor, null);
});

test("microsecond keyset ordering supports offsets and canonical id tie-break without Date millisecond loss", async () => {
  const h = harness(2);
  const a = item(4, "2026-09-09T04:00:00.000002-04:00");
  const b = item(3, "2026-09-09T08:00:00.000001Z");
  h.handler.list = async () => page([a, b], true, 4);
  assert.equal(await h.controller.load(), true);
  const c = item(2, "2026-09-09T10:00:00.000001+02:00");
  const d = item(1, "2026-09-09T08:00:00Z");
  h.handler.list = async () => page([c, d]);
  assert.equal(await h.controller.loadNext(), true);
  assert.deepEqual(h.calls[1].query.cursor, { id: b.id, createdAt: b.createdAt });
  assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(4), id(3), id(2), id(1)]);
});

test("offset-equivalent cursor retains original wire timestamp and works before the Unix epoch", async () => {
  const h = harness(1);
  const a = item(2, "1969-12-31T23:59:59.999999Z");
  h.handler.list = async () => ({ ...page([a], true, 2), nextCursor: { id: a.id, createdAt: "1970-01-01T00:59:59.999999+01:00" } });
  assert.equal(await h.controller.load(), true);
  h.handler.list = async () => page([item(1, "1969-12-31T23:59:59.999998Z")]);
  assert.equal(await h.controller.loadNext(), true);
  assert.equal(h.calls[1].query.cursor!.createdAt, "1970-01-01T00:59:59.999999+01:00");
});

test("duplicate ids and non-descending rows within a page are rejected without false empty success", async () => {
  for (const rows of [[item(1), item(1)], [item(1), item(2)],
    [item(1, "2026-09-09T08:00:00.000001Z"), item(2, "2026-09-09T04:00:00.000001-04:00")]]) {
    const h = harness();
    h.handler.list = async () => page(rows);
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(h.controller.getSnapshot().totalPending, null);
  }
});

test("cross-page duplicates or positions ahead of cursor never mix with accumulated rows", async () => {
  for (const bad of [item(4), item(3), { ...item(2), id: id(3) }]) {
    const h = harness(1);
    h.handler.list = async () => page([item(3)], true, 4);
    await h.controller.load();
    h.handler.list = async () => page([bad]);
    assert.equal(await h.controller.loadNext(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(3)]);
    assert.equal(h.controller.getSnapshot().nextCursor!.id, id(3));
    assert.equal(h.controller.canLoadNext(), true);
  }
});

test("each call updates counts/time independently; shrinking membership is not accumulated corruption", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  h.handler.list = async () => ({ ...page([item(2)], true, 2), serverNow: "2026-09-09T10:00:01Z" });
  assert.equal(await h.controller.loadNext(), true);
  h.handler.list = async () => ({ ...page(), serverNow: "2026-09-09T10:00:02Z" });
  assert.equal(await h.controller.loadNext(), true);
  const snapshot = h.controller.getSnapshot();
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.matchingCount, 0);
  assert.equal(snapshot.totalPending, 0);
  assert.equal(snapshot.serverNow, "2026-09-09T10:00:02Z");
  assert.equal(snapshot.nextCursor, null);
  assert.equal(snapshot.phase, "ready");
});

test("ordinary errors remain safe enum errors, never invented empty or zero data", async () => {
  for (const code of ["timeout", "aborted", "unavailable", "invalid_input", "invalid_response"]) {
    const h = harness();
    h.handler.list = async () => { throw { code, message: "private synthetic detail" }; };
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, code);
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(h.controller.getSnapshot().totalPending, null);
    assert.equal(h.controller.getSnapshot().matchingCount, null);
    assert.equal(JSON.stringify(h.controller.getSnapshot()).includes("private"), false);
    assert.equal(h.calls.length, 1);
  }
});

test("synchronous throws and malformed source errors settle without pending or leaking messages", async () => {
  const errors = [null, undefined, "secret-shaped synthetic error", { code: "unknown" }, new Error("not exposed"),
    Object.defineProperty({}, "code", { get: () => { throw new Error("getter"); } }),
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy"); } })];
  for (const error of errors) {
    const h = harness();
    h.handler.list = () => { throw error; };
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(h.controller.getSnapshot().issue, "unavailable");
    h.handler.list = async () => page();
    assert.equal(await h.controller.load(), true);
  }
});

test("malformed pages, getters and proxies become invalid_response without hanging", async () => {
  const malformed = [null, {}, { ...page(), matchingCount: NaN }, { ...page(), totalPending: -1 },
    { ...page(), matchingCount: 1, totalPending: 0 }, { ...page(), totalPending: Number.MAX_SAFE_INTEGER + 1 },
    { ...page(), items: [item(1)] }, { ...page(), items: new Array(1), matchingCount: 1, totalPending: 1 },
    page([{ ...item(1), state: "accepted" } as unknown as CoachPendingInvitationsItem]),
    page([{ ...item(1), createdAt: "invalid" }]),
    { ...page([item(1)]), nextCursor: { id: id(2), createdAt: item(2).createdAt } },
    { ...page(), nextCursor: { id: id(2), createdAt: item(2).createdAt } },
    Object.defineProperty(page(), "items", { get: () => { throw new Error("must not run"); } }),
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy"); } })];
  for (const result of malformed) {
    const h = harness(1);
    h.handler.list = async () => result as CoachPendingInvitationsPage;
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().serverNow, null);
  }
});

test("fatal forbidden/stale source errors purge prior facts and never revive", async () => {
  for (const code of ["forbidden", "operation_stale"]) {
    const h = harness(1);
    h.controller.setQuery("private search");
    h.handler.list = async () => page([item(3)], true, 3);
    await h.controller.load();
    h.handler.list = async () => { throw { code }; };
    assert.equal(await h.controller.loadNext(), false);
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.phase, "disposed");
    assert.equal(snapshot.issue, code);
    assert.equal(snapshot.query, "");
    assert.deepEqual(snapshot.items, []);
    assert.equal(snapshot.totalPending, null);
    assert.equal(h.controller.setQuery("new"), false);
    assert.equal(h.controller.invalidate(), false);
    assert.equal(await h.controller.reload(), false);
    assert.equal(h.calls.length, 2);
  }
});

test("account/generation/context changes cancel pending promises monotonically with no late data", async () => {
  for (const change of ["user", "generation", "selectedContext"] as const) {
    const h = harness();
    const pending = deferred<CoachPendingInvitationsPage>();
    h.handler.list = () => pending.promise;
    const work = h.controller.load();
    if (change === "generation") h.context.generation = 2;
    else h.context[change] = "other";
    assert.equal(h.controller.getSnapshot().phase, "disposed");
    await settledFalse(work);
    Object.assign(h.context, { user: "owner-A", generation: 1, selectedContext: "coach" });
    assert.equal(await h.controller.reload(), false);
    pending.resolve(page([item(1)]));
    await flush();
    assert.deepEqual(h.controller.getSnapshot().items, []);
    assert.equal(h.calls[0].signal.aborted, true);
    assert.equal(h.calls.length, 1);
  }
});

test("owner invalidation on source return purges even without a caller snapshot read", async () => {
  const h = harness();
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const work = h.controller.load();
  h.context.generation = 2;
  pending.resolve(page([item(1)]));
  assert.equal(await work, false);
  assert.equal(h.controller.getSnapshot().phase, "disposed");
  assert.deepEqual(h.controller.getSnapshot().items, []);
});

test("getSnapshot detects stale ownership without recursive subscriber notification", async () => {
  const h = harness();
  let notified = 0;
  h.controller.subscribe(() => { notified += 1; h.controller.getSnapshot(); });
  await h.controller.load();
  const before = notified;
  h.context.generation = 2;
  assert.equal(h.controller.getSnapshot().phase, "disposed");
  assert.equal(notified, before);
});

test("throwing or reentrant ownership guards fail closed instead of recursing", async () => {
  const throwing = createCoachPendingInvitationsController({ source: { list: async () => { assert.fail("no source"); } },
    isCurrent: () => { throw new Error("guard"); } });
  assert.equal(await throwing.load(), false);
  assert.equal(throwing.getSnapshot().phase, "disposed");
  const controller: CoachPendingInvitationsController = createCoachPendingInvitationsController({ source: { list: async () => { assert.fail("no source"); } },
    isCurrent: () => { controller.getSnapshot(); return true; } });
  assert.equal(await controller.load(), false);
  assert.equal(controller.getSnapshot().phase, "disposed");
});

test("a synchronous listener can cancel/invalidate before dispatch; reentrant reads are blocked", async () => {
  for (const action of ["invalidate", "dispose", "query", "account"]) {
    const h = harness();
    const attempts: Promise<boolean>[] = [];
    h.controller.subscribe((snapshot) => {
      if (snapshot.phase !== "loading") return;
      attempts.push(h.controller.reload(), h.controller.loadNext(), h.controller.load());
      if (action === "query") h.controller.setQuery("new");
      else if (action === "account") h.context.generation = 2;
      else h.controller[action as "invalidate" | "dispose"]();
    });
    assert.equal(await h.controller.load(), false);
    assert.deepEqual(await Promise.all(attempts), [false, false, false]);
    assert.equal(h.calls.length, 0);
  }
});

test("listener exceptions/unsubscribe are isolated and later listeners see latest snapshot", async () => {
  const h = harness();
  let removedCalls = 0;
  let unsubscribe = () => {};
  h.controller.subscribe(() => { unsubscribe(); throw new Error("subscriber only"); });
  unsubscribe = h.controller.subscribe(() => { removedCalls += 1; });
  const phases: string[] = [];
  h.controller.subscribe((snapshot) => { phases.push(snapshot.phase); });
  assert.equal(await h.controller.load(), true);
  assert.equal(removedCalls, 0);
  assert.deepEqual(phases, ["loading", "ready"]);
  assert.equal(h.controller.getSnapshot().issue, null);
});

test("a ready listener changing query prevents old success from claiming the new query loaded", async () => {
  const h = harness();
  h.controller.subscribe((snapshot) => { if (snapshot.phase === "ready") h.controller.setQuery("new"); });
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().query, "new");
  assert.equal(h.controller.getSnapshot().phase, "idle");
  assert.equal(h.calls.length, 1);
});

test("invalidate clears server facts but retains raw query and allows explicit reload in the same context", async () => {
  const h = harness();
  h.controller.setQuery("  search  ");
  h.handler.list = async () => page([item(1)]);
  await h.controller.load();
  assert.equal(h.controller.invalidate(), true);
  assert.equal(h.controller.getSnapshot().query, "  search  ");
  assert.deepEqual(h.controller.getSnapshot().items, []);
  assert.equal(h.controller.getSnapshot().serverNow, null);
  assert.equal(h.calls.length, 1);
  assert.equal(await h.controller.load(), true);
  assert.equal(h.calls[1].query.cursor, null);
});

test("invalidation and disposal settle unresolved requests; disposed controller cannot be reused", async () => {
  for (const action of ["invalidate", "dispose"] as const) {
    const h = harness();
    h.controller.setQuery("private query");
    h.handler.list = () => deferred<CoachPendingInvitationsPage>().promise;
    const work = h.controller.load();
    h.controller[action]();
    await settledFalse(work);
    assert.equal(h.calls[0].signal.aborted, true);
    assert.deepEqual(h.controller.getSnapshot().items, []);
    if (action === "dispose") {
      assert.equal(h.controller.getSnapshot().query, "");
      assert.equal(h.controller.getSnapshot().phase, "disposed");
      assert.equal(h.controller.setQuery("another"), false);
      assert.equal(await h.controller.load(), false);
      assert.equal(await h.controller.reload(), false);
      assert.equal(await h.controller.loadNext(), false);
      assert.equal(h.controller.invalidate(), false);
      h.controller.dispose();
      h.controller.subscribe(() => { assert.fail("disposed listener"); });
    }
    assert.equal(h.calls.length, 1);
  }
});

test("late outcomes after disposal never restore rows or errors", async () => {
  for (const reject of [false, true]) {
    const h = harness();
    const pending = deferred<CoachPendingInvitationsPage>();
    h.handler.list = () => pending.promise;
    const work = h.controller.load();
    h.controller.dispose();
    await settledFalse(work);
    if (reject) pending.reject({ code: "timeout" });
    else pending.resolve(page([item(1)]));
    await flush();
    assert.equal(h.controller.getSnapshot().phase, "disposed");
    assert.equal(h.controller.getSnapshot().issue, null);
    assert.deepEqual(h.controller.getSnapshot().items, []);
  }
});

test("invalid query cancels a live page immediately and a late result cannot remove its validation issue", async () => {
  const h = harness();
  const pending = deferred<CoachPendingInvitationsPage>();
  h.handler.list = () => pending.promise;
  const work = h.controller.load();
  assert.equal(h.controller.setQuery("invalid\0query"), false);
  await settledFalse(work);
  pending.resolve(page([item(1)]));
  await flush();
  assert.equal(h.controller.getSnapshot().query, "invalid\0query");
  assert.equal(h.controller.getSnapshot().issue, "invalid_input");
  assert.equal(h.controller.getSnapshot().phase, "error");
  assert.equal(h.calls.length, 1);
});

test("source-side synchronous invalidation cannot commit the subsequently returned page", async () => {
  const h = harness();
  h.handler.list = () => {
    h.controller.invalidate();
    return Promise.resolve(page([item(1)]));
  };
  assert.equal(await h.controller.load(), false);
  await flush();
  assert.equal(h.controller.getSnapshot().phase, "idle");
  assert.equal(h.controller.getSnapshot().serverNow, null);
  assert.equal(h.calls[0].signal.aborted, true);
});

test("pending wrapper and private mechanics stay feature-local without SDK/UI/implicit clock or retry machinery", () => {
  const code = readFileSync(new URL("./coach-pending-invitations-controller.ts", import.meta.url), "utf8");
  const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./coach-pending-invitations-controller-contract", "./internal/coach-client-list-controller"]);
  const mechanics = readFileSync(new URL("./internal/coach-client-list-controller.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mechanics, /from\s+["']/);
  for (const source of [code, mechanics]) {
    assert.doesNotMatch(source, /\b(?:fetch|setTimeout|setInterval|getUser|localStorage|sessionStorage)\s*\(|Date\.now|new Date|Math\.random|crypto\./);
    assert.doesNotMatch(source, /["']use client["']|supabase|\.rpc\s*\(|\.from\s*\(["']/);
  }
});
