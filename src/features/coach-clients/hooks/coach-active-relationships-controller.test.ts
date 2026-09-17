import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoachActiveRelationshipsController } from "./coach-active-relationships-controller";
import { createCoachPendingInvitationsController } from "./coach-pending-invitations-controller";
import type { CoachActiveRelationshipsItem, CoachActiveRelationshipsPage,
  CoachActiveRelationshipsQuery, CoachActiveRelationshipsSource } from "./coach-active-relationships-controller-contract";
import type { CoachPendingInvitationsPage, CoachPendingInvitationsQuery } from "./coach-pending-invitations-controller-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function settledFalse(work: Promise<boolean>) {
  assert.equal(await Promise.race([work, Promise.resolve("not settled")]), false);
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
function item(number: number, linkedAt = `2026-09-09T08:00:00.${String(number).padStart(6, "0")}Z`): CoachActiveRelationshipsItem {
  return { id: id(number), linkedAt, studentName: `Nombre consentido ${number}`, studentEmail: `Student-${number}@Example.test` };
}
function page(items: readonly CoachActiveRelationshipsItem[] = [], more = false, total = items.length): CoachActiveRelationshipsPage {
  const last = items.at(-1);
  return { serverNow: "2026-09-09T10:00:00Z", totalActive: total, matchingCount: total, items,
    nextCursor: more && last ? { id: last.id, linkedAt: last.linkedAt } : null };
}
function harness(pageSize?: number) {
  const context = { owner: "coach-A", generation: 1, portal: "coach" };
  const calls: { query: CoachActiveRelationshipsQuery; signal: AbortSignal }[] = [];
  const handler: CoachActiveRelationshipsSource = { list: async () => page() };
  const controller = createCoachActiveRelationshipsController({ pageSize,
    isCurrent: () => context.owner === "coach-A" && context.generation === 1 && context.portal === "coach",
    source: { list: (query, options) => { calls.push({ query, signal: options.signal }); return handler.list(query, options); } },
  });
  return { controller, handler, calls, context };
}

function pendingHarness() {
  const calls: { query: CoachPendingInvitationsQuery; signal: AbortSignal }[] = [];
  const pending = deferred<CoachPendingInvitationsPage>();
  const controller = createCoachPendingInvitationsController({ pageSize: 1, isCurrent: () => true,
    source: { list: (query, options) => { calls.push({ query, signal: options.signal }); return pending.promise; } },
  });
  return { controller, calls, pending };
}
function pendingPage(): CoachPendingInvitationsPage {
  return { serverNow: "2026-09-09T10:00:00Z", totalPending: 1, matchingCount: 1, nextCursor: null,
    items: [{ id: id(3), createdAt: "2026-09-09T08:00:00.000003Z", recipientEmail: "invitation@example.test",
      issuedAt: "2026-09-09T09:00:00Z", expiresAt: "2026-09-16T09:00:00Z", state: "pending" }] };
}

test("active construction/query/invalidation are idle; only explicit loads request the validated source", async () => {
  const h = harness();
  const initial = h.controller.getSnapshot();
  assert.deepEqual(initial, { query: "", pageSize: 25, phase: "idle", items: [], serverNow: null,
    totalActive: null, matchingCount: null, nextCursor: null, issue: null });
  assert.equal(initial, h.controller.getSnapshot());
  let notified = 0;
  h.controller.subscribe(() => { notified += 1; });
  assert.equal(notified, 0);
  assert.equal(h.controller.setQuery("  Consulta raw  "), true);
  assert.equal(h.controller.invalidate(), true);
  assert.equal(await h.controller.loadNext(), false);
  assert.equal(h.calls.length, 0);
  assert.equal(await h.controller.load(), true);
  assert.deepEqual(h.calls[0].query, { query: "  Consulta raw  ", limit: 25, cursor: null });
  assert.equal(h.controller.getSnapshot().totalActive, 0);
  assert.equal(h.controller.getSnapshot().phase, "ready");
});

test("active page sizes obey the same explicit technical bounds as pending", async () => {
  for (const size of [1, 50]) {
    const h = harness(size);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.calls[0].query.limit, size);
  }
  for (const size of [0, 51, -1, 1.5, NaN, Infinity, null, "25"]) {
    assert.throws(() => harness(size as number), { name: "RangeError", message: "invalid_input" });
  }
});

test("active identity copies the exact consented snapshots, not invitation normalization or inferred activity", async () => {
  const h = harness(1);
  const row = { ...item(3), studentName: "  ΟΣ e\u0301  ", studentEmail: "Mixed.Case@Example.test",
    ownerId: "not allowed", studentId: "not the episode", cycle: null, sessions: 0, state: "pending",
    recipientEmail: "different@example.test", createdAt: "not an active field", expiresAt: "not an active field" };
  const raw = { ...page([row], true, 2), totalPending: 55, ownership: "not allowed" };
  h.handler.list = async () => raw;
  h.controller.setQuery("nonmatching-js-search");
  assert.equal(await h.controller.load(), true);
  const snapshot = h.controller.getSnapshot();
  assert.deepEqual(Object.keys(snapshot.items[0]).sort(), ["id", "linkedAt", "studentEmail", "studentName"]);
  assert.equal(snapshot.items[0].studentName, row.studentName);
  assert.equal(snapshot.items[0].studentEmail, row.studentEmail);
  assert.equal(snapshot.items[0].id, id(3));
  assert.deepEqual(Object.keys(snapshot.nextCursor!).sort(), ["id", "linkedAt"]);
  assert.equal(Object.hasOwn(snapshot, "totalPending"), false);
  assert.equal(Object.hasOwn(snapshot, "ownership"), false);
  for (const value of [snapshot, snapshot.items, snapshot.items[0], snapshot.nextCursor, h.calls[0].query]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(Object.isFrozen(raw), false);
  assert.equal(Object.isFrozen(row), false);
  row.studentName = "mutated source";
  row.studentEmail = "mutated@example.test";
  Object.assign(raw.nextCursor!, { id: "mutated" });
  assert.equal(snapshot.items[0].studentName, "  ΟΣ e\u0301  ");
  assert.equal(snapshot.items[0].studentEmail, "Mixed.Case@Example.test");
  assert.equal(snapshot.nextCursor!.id, id(3));
});

test("finite future linkedAt is preserved; the controller does not invent an upper bound of serverNow", async () => {
  for (const linkedAt of ["0001-01-01T00:00:00Z", "2099-01-01T00:00:00.000001Z", "9999-12-31T23:59:59.999999Z"]) {
    const h = harness();
    h.handler.list = async () => page([item(1, linkedAt)]);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.controller.getSnapshot().items[0].linkedAt, linkedAt);
  }
});

test("active raw query validation preserves Unicode and never refilters consented name/email", async () => {
  for (const raw of ["a".repeat(254), "é".repeat(127), "😀".repeat(63) + "ab", "  ΟΣ %_\\ e\u0301  "]) {
    const h = harness();
    h.handler.list = async () => page([item(1)]);
    assert.equal(h.controller.setQuery(raw), true);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.calls[0].query.query, raw);
    assert.equal(h.controller.getSnapshot().query, raw);
    assert.equal(h.controller.getSnapshot().items.length, 1);
  }
  for (const raw of ["a".repeat(255), "é".repeat(128), "😀".repeat(64), "\0", "\ud800", "\udfff", "\ud800x"]) {
    const h = harness();
    assert.equal(h.controller.setQuery(raw), false);
    assert.equal(await h.controller.load(), false);
    assert.equal(await h.controller.reload(), false);
    assert.equal(h.controller.getSnapshot().query, raw);
    assert.equal(h.controller.getSnapshot().issue, "invalid_input");
    assert.equal(h.calls.length, 0);
  }
});

test("active keyset preserves linkedAt microseconds/offsets and canonical UUID tie ordering", async () => {
  const h = harness(2);
  h.handler.list = async () => page([item(4, "2026-09-09T04:00:00.000002-04:00"),
    item(3, "2026-09-09T08:00:00.000001Z")], true, 4);
  assert.equal(await h.controller.load(), true);
  h.handler.list = async () => page([item(2, "2026-09-09T10:00:00.000001+02:00"), item(1, "2026-09-09T08:00:00Z")]);
  assert.equal(await h.controller.loadNext(), true);
  assert.deepEqual(h.calls[1].query.cursor, { id: id(3), linkedAt: "2026-09-09T08:00:00.000001Z" });
  assert.equal(Object.isFrozen(h.calls[1].query.cursor), true);
  assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(4), id(3), id(2), id(1)]);
});

test("active rejects within-page and cross-page duplicates/order mistakes without losing prior rows", async () => {
  for (const rows of [[item(1), item(1)], [item(1), item(2)],
    [item(1, "2026-09-09T08:00:00Z"), item(2, "2026-09-09T04:00:00-04:00")]]) {
    const h = harness();
    h.handler.list = async () => page(rows);
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().totalActive, null);
  }
  for (const row of [item(4), item(3), { ...item(2), id: id(3) }]) {
    const h = harness(1);
    h.handler.list = async () => page([item(3)], true, 4);
    await h.controller.load();
    h.handler.list = async () => page([row]);
    assert.equal(await h.controller.loadNext(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.deepEqual(h.controller.getSnapshot().items.map((value) => value.id), [id(3)]);
    assert.equal(h.controller.getSnapshot().nextCursor!.id, id(3));
  }
});

test("active counts are per-call snapshots; a later empty page after revocation is valid", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  h.handler.list = async () => ({ ...page([item(2)], true, 2), serverNow: "2026-09-09T10:00:01Z" });
  assert.equal(await h.controller.loadNext(), true);
  h.handler.list = async () => ({ ...page(), serverNow: "2026-09-09T10:00:02Z" });
  assert.equal(await h.controller.loadNext(), true);
  assert.equal(h.controller.getSnapshot().items.length, 2);
  assert.equal(h.controller.getSnapshot().totalActive, 0);
  assert.equal(h.controller.getSnapshot().matchingCount, 0);
  assert.equal(h.controller.getSnapshot().serverNow, "2026-09-09T10:00:02Z");
  assert.equal(h.controller.getSnapshot().phase, "ready");
  assert.equal(h.controller.canLoadNext(), false);
});

test("active next remains single-flight and retries only after an explicit call with the same cursor", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  const deferredPage = deferred<CoachActiveRelationshipsPage>();
  h.handler.list = () => deferredPage.promise;
  const work = h.controller.loadNext();
  assert.equal(await h.controller.loadNext(), false);
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().phase, "loading-next");
  deferredPage.reject({ code: "timeout" });
  assert.equal(await work, false);
  assert.equal(h.controller.getSnapshot().phase, "error");
  assert.equal(h.controller.getSnapshot().items.length, 1);
  assert.equal(h.controller.canLoadNext(), true);
  assert.equal(h.calls.length, 2);
  const cursor = h.calls[1].query.cursor;
  h.handler.list = async () => page([item(2)]);
  assert.equal(await h.controller.loadNext(), true);
  assert.deepEqual(h.calls[2].query.cursor, cursor);
});

test("active query replacement settles cancelled work even when the old source ignores abort", async () => {
  const h = harness();
  const old = deferred<CoachActiveRelationshipsPage>();
  h.handler.list = () => old.promise;
  const work = h.controller.load();
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.setQuery("new"), true);
  await settledFalse(work);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.calls.length, 1);
  h.handler.list = async () => page([item(8)]);
  assert.equal(await h.controller.load(), true);
  old.resolve(page([item(1)]));
  await flush();
  assert.equal(h.controller.getSnapshot().query, "new");
  assert.equal(h.controller.getSnapshot().items[0].id, id(8));
});

test("active reload aborts next and replaces rows; late failure cannot dispose the new query epoch", async () => {
  const h = harness(1);
  h.handler.list = async () => page([item(3)], true, 3);
  await h.controller.load();
  const old = deferred<CoachActiveRelationshipsPage>();
  h.handler.list = () => old.promise;
  const next = h.controller.loadNext();
  const fresh = deferred<CoachActiveRelationshipsPage>();
  h.handler.list = () => fresh.promise;
  const reload = h.controller.reload();
  await settledFalse(next);
  assert.equal(h.controller.getSnapshot().items[0].id, id(3));
  assert.equal(h.controller.getSnapshot().nextCursor, null);
  fresh.reject({ code: "unavailable" });
  assert.equal(await reload, false);
  assert.equal(h.controller.getSnapshot().items[0].id, id(3));
  assert.equal(h.controller.canLoadNext(), false);
  h.handler.list = async () => page([item(8)]);
  assert.equal(await h.controller.reload(), true);
  old.reject({ code: "forbidden" });
  await flush();
  assert.equal(h.controller.getSnapshot().phase, "ready");
  assert.deepEqual(h.controller.getSnapshot().items.map((row) => row.id), [id(8)]);
});

test("active malformed page/identity/cursor does not become empty or partial success", async () => {
  const rows = [null, { id: id(1), createdAt: item(1).linkedAt, studentName: "name", studentEmail: "mail" },
    { ...item(1), studentName: null }, { ...item(1), studentEmail: undefined }, { ...item(1), id: "" },
    { ...item(1), linkedAt: "invalid" }, Object.defineProperty(item(1), "studentName", { get: () => { throw new Error("getter"); } })];
  const invalid = [null, {}, ...rows.map((row) => page([row as CoachActiveRelationshipsItem])),
    { ...page(), totalActive: -1 }, { ...page(), matchingCount: NaN }, { ...page(), totalActive: Number.MAX_SAFE_INTEGER + 1 },
    { ...page(), matchingCount: 1 }, { ...page(), items: new Array(1), totalActive: 1, matchingCount: 1 },
    { ...page([item(1)]), nextCursor: { id: id(1), createdAt: item(1).linkedAt } },
    { ...page([item(1)]), nextCursor: { id: id(2), linkedAt: item(2).linkedAt } },
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy"); } })];
  for (const value of invalid) {
    const h = harness();
    h.handler.list = async () => value as CoachActiveRelationshipsPage;
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().totalActive, null);
    assert.deepEqual(h.controller.getSnapshot().items, []);
  }
});

test("active source errors are safe enums with null facts, never an error-to-empty conversion", async () => {
  for (const code of ["invalid_input", "invalid_response", "aborted", "timeout", "unavailable"]) {
    const h = harness();
    h.handler.list = () => { throw { code, message: "synthetic private detail" }; };
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, code);
    assert.equal(h.controller.getSnapshot().totalActive, null);
    assert.equal(h.controller.getSnapshot().phase, "error");
    assert.equal(JSON.stringify(h.controller.getSnapshot()).includes("private"), false);
  }
  for (const error of [null, "private", { code: "unrecognized" },
    Object.defineProperty({}, "code", { get: () => { throw new Error("getter"); } }),
    new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("proxy"); } })]) {
    const h = harness();
    h.handler.list = () => { throw error; };
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, "unavailable");
  }
});

test("active forbidden/stale outcomes purge identity/search and permanently invalidate only that instance", async () => {
  for (const code of ["forbidden", "operation_stale"]) {
    const h = harness();
    h.controller.setQuery("identity search");
    h.handler.list = async () => page([item(1)]);
    await h.controller.load();
    h.handler.list = async () => { throw { code }; };
    assert.equal(await h.controller.reload(), false);
    assert.equal(h.controller.getSnapshot().phase, "disposed");
    assert.equal(h.controller.getSnapshot().issue, code);
    assert.equal(h.controller.getSnapshot().query, "");
    assert.deepEqual(h.controller.getSnapshot().items, []);
    assert.equal(h.controller.getSnapshot().totalActive, null);
    assert.equal(h.controller.setQuery("again"), false);
    assert.equal(h.controller.invalidate(), false);
    assert.equal(await h.controller.load(), false);
  }
});

test("active owner/generation/portal changes latch stale on snapshot read and settle ignored sources", async () => {
  for (const field of ["owner", "generation", "portal"] as const) {
    const h = harness();
    const old = deferred<CoachActiveRelationshipsPage>();
    h.handler.list = () => old.promise;
    const work = h.controller.load();
    if (field === "generation") h.context.generation = 2;
    else h.context[field] = "changed";
    assert.equal(h.controller.getSnapshot().phase, "disposed");
    await settledFalse(work);
    Object.assign(h.context, { owner: "coach-A", generation: 1, portal: "coach" });
    old.resolve(page([item(1)]));
    await flush();
    assert.equal(h.controller.getSnapshot().issue, "operation_stale");
    assert.equal(await h.controller.reload(), false);
    assert.equal(h.calls.length, 1);
  }
});

test("active listeners may invalidate before dispatch but cannot recursively start requests", async () => {
  for (const action of ["invalidate", "dispose", "query", "owner"]) {
    const h = harness();
    const nested: Promise<boolean>[] = [];
    h.controller.subscribe((snapshot) => {
      if (snapshot.phase !== "loading") return;
      nested.push(h.controller.reload(), h.controller.load(), h.controller.loadNext());
      if (action === "query") h.controller.setQuery("new");
      else if (action === "owner") h.context.generation += 1;
      else h.controller[action as "invalidate" | "dispose"]();
    });
    assert.equal(await h.controller.load(), false);
    assert.deepEqual(await Promise.all(nested), [false, false, false]);
    assert.equal(h.calls.length, 0);
  }
});

test("active listener failure and unsubscribe do not alter transport success; stale snapshot read stays silent", async () => {
  const h = harness();
  let unsubscribe = () => {};
  let removed = 0;
  let notifications = 0;
  h.controller.subscribe(() => { unsubscribe(); throw new Error("subscriber"); });
  unsubscribe = h.controller.subscribe(() => { removed += 1; });
  h.controller.subscribe(() => { notifications += 1; h.controller.getSnapshot(); });
  assert.equal(await h.controller.load(), true);
  assert.equal(removed, 0);
  assert.equal(h.controller.getSnapshot().issue, null);
  const previous = notifications;
  h.context.generation = 2;
  assert.equal(h.controller.getSnapshot().phase, "disposed");
  assert.equal(notifications, previous);
});

test("active invalidate/dispose settle never-resolving sources without retaining displayed facts", async () => {
  for (const action of ["invalidate", "dispose"] as const) {
    const h = harness();
    h.controller.setQuery("raw private search");
    h.handler.list = () => deferred<CoachActiveRelationshipsPage>().promise;
    const work = h.controller.load();
    h.controller[action]();
    await settledFalse(work);
    assert.equal(h.calls[0].signal.aborted, true);
    assert.deepEqual(h.controller.getSnapshot().items, []);
    assert.equal(h.controller.getSnapshot().totalActive, null);
    assert.equal(h.controller.getSnapshot().query, action === "invalidate" ? "raw private search" : "");
    h.handler.list = async () => page([item(1)]);
    assert.equal(await h.controller.load(), action === "invalidate");
  }
});

test("two real consumers can load simultaneously with separate query/cursor/count/identity shapes", async () => {
  const active = harness(1);
  const pending = pendingHarness();
  const activeDeferred = deferred<CoachActiveRelationshipsPage>();
  active.handler.list = () => activeDeferred.promise;
  active.controller.setQuery("active raw");
  pending.controller.setQuery("pending raw");
  const activeWork = active.controller.load();
  const pendingWork = pending.controller.load();
  assert.equal(active.calls.length, 1);
  assert.equal(pending.calls.length, 1);
  assert.equal(await active.controller.load(), false);
  assert.equal(await pending.controller.load(), false);
  activeDeferred.resolve(page([item(3)], true, 2));
  assert.equal(await activeWork, true);
  assert.equal(pending.controller.getSnapshot().phase, "loading");
  pending.pending.resolve(pendingPage());
  assert.equal(await pendingWork, true);
  // The same UUID and timestamp across the two sources are not cross-list duplicates.
  assert.equal(active.controller.getSnapshot().items[0].id, pending.controller.getSnapshot().items[0].id);
  assert.equal(active.controller.getSnapshot().query, "active raw");
  assert.equal(pending.controller.getSnapshot().query, "pending raw");
  assert.equal(active.controller.getSnapshot().totalActive, 2);
  assert.equal(pending.controller.getSnapshot().totalPending, 1);
  assert.equal(Object.hasOwn(active.controller.getSnapshot().items[0], "recipientEmail"), false);
  assert.equal(Object.hasOwn(pending.controller.getSnapshot().items[0], "studentName"), false);
  assert.equal(Object.hasOwn(active.controller.getSnapshot().nextCursor!, "createdAt"), false);
});

test("disposing or invalidating active does not abort, settle or mutate pending in-flight state", async () => {
  for (const action of ["invalidate", "dispose", "owner"] as const) {
    const active = harness();
    const pending = pendingHarness();
    active.handler.list = () => deferred<CoachActiveRelationshipsPage>().promise;
    const activeWork = active.controller.load();
    const pendingWork = pending.controller.load();
    if (action === "owner") { active.context.generation = 2; active.controller.getSnapshot(); }
    else active.controller[action]();
    await settledFalse(activeWork);
    assert.equal(pending.calls[0].signal.aborted, false);
    assert.equal(pending.controller.getSnapshot().phase, "loading");
    pending.pending.resolve(pendingPage());
    assert.equal(await pendingWork, true);
    assert.equal(pending.controller.getSnapshot().items.length, 1);
  }
});

test("listeners and request scheduling are per instance, not one feature-wide queue", async () => {
  const active = harness();
  const pending = pendingHarness();
  let pendingWork: Promise<boolean> | undefined;
  active.controller.subscribe((snapshot) => {
    if (snapshot.phase === "loading") pendingWork = pending.controller.load();
  });
  assert.equal(await active.controller.load(), true);
  assert.equal(pending.calls.length, 1);
  pending.pending.resolve(pendingPage());
  assert.equal(await pendingWork, true);
  pending.controller.dispose();
  assert.equal(active.controller.getSnapshot().phase, "ready");
  assert.equal(await active.controller.reload(), true);
});

test("separate active instances do not inherit a disposed instance's identity or cached rows", async () => {
  const first = harness();
  first.handler.list = async () => page([item(1)]);
  await first.controller.load();
  first.controller.dispose();
  const second = harness();
  assert.equal(second.controller.getSnapshot().phase, "idle");
  assert.equal(second.controller.getSnapshot().totalActive, null);
  assert.deepEqual(second.controller.getSnapshot().items, []);
  assert.equal(await second.controller.load(), true);
  assert.equal(first.controller.getSnapshot().phase, "disposed");
});

test("active wrapper and shared mechanics have only local imports and no SDK/UI/write/implicit clock machinery", () => {
  const wrapper = readFileSync(new URL("./coach-active-relationships-controller.ts", import.meta.url), "utf8");
  const core = readFileSync(new URL("./internal/coach-client-list-controller.ts", import.meta.url), "utf8");
  assert.deepEqual([...wrapper.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]),
    ["./coach-active-relationships-controller-contract", "./internal/coach-client-list-controller"]);
  assert.doesNotMatch(core, /from\s+["']/);
  assert.doesNotMatch(wrapper, /createdAt|expiresAt|issuedAt|recipientEmail|totalPending|cycle|sessions|progressRatio/);
  for (const source of [wrapper, core]) {
    assert.doesNotMatch(source, /\b(?:fetch|setTimeout|setInterval|getUser|localStorage|sessionStorage)\s*\(|Date\.now|new Date|Math\.random|crypto\./);
    assert.doesNotMatch(source, /["']use client["']|supabase|\.rpc\s*\(|\.from\s*\(["']/);
  }
});
