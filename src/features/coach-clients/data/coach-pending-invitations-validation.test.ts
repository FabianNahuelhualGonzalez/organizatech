import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError } from "./coach-invitations-contract";
import type { CoachPendingInvitationsQuery } from "./coach-pending-invitations-contract";
import { mapCoachPendingInvitationsPage, pendingInvitationsParameters, snapshotCoachPendingInvitationsQuery } from "./coach-pending-invitations-validation";

const id = (value: number) => `30000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const query = (changes = {}): CoachPendingInvitationsQuery => ({ query: "", limit: 25, cursor: null, ...changes });
const item = (value = 3, changes = {}) => ({ id: id(value), recipientEmail: "alumno@example.test",
  createdAt: "2026-09-09T08:00:00.000001+00:00", issuedAt: "2026-09-09T08:00:00.000001+00:00",
  expiresAt: "2026-09-16T08:00:00.000001+00:00", state: "pending", ...changes });
const page = (changes = {}) => ({ serverNow: "2026-09-09T09:00:00+00:00", totalPending: 1,
  matchingCount: 1, items: [item()], nextCursor: null, ...changes });
const invalid = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_response";
const badInput = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_input";

test("query snapshots exact allowlist, cursor micros and serialized number/null arguments", () => {
  const value = query({ query: " ÁLUMNO ", cursor: { id: id(8).toUpperCase(), createdAt: "2026-09-09T08:00:00.123456Z" } });
  const snapshot = snapshotCoachPendingInvitationsQuery(value);
  assert.notEqual(snapshot.cursor, value.cursor);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.cursor));
  assert.deepEqual(pendingInvitationsParameters(snapshot), { p_query: " ÁLUMNO ", p_limit: 25,
    p_cursor_created_at: "2026-09-09T08:00:00.123456Z", p_cursor_id: id(8) });
  assert.deepEqual(pendingInvitationsParameters(query()), { p_query: "", p_limit: 25, p_cursor_created_at: null, p_cursor_id: null });
});

test("invalid query, oversized UTF8, limits, cursor and ownership fail before capture", () => {
  const invalidValues: unknown[] = [null, [], {}, query({ query: null }), query({ query: "a".repeat(255) }),
    query({ query: "á".repeat(128) }), query({ query: "a\0b" }), query({ query: "\ud800" }),
    ...[null, 0, -1, 51, 1.5, "25", NaN, Infinity].map(limit => query({ limit })),
    query({ cursor: { id: id(1) } }), query({ cursor: { id: "not-id", createdAt: "2026-09-09T08:00:00Z" } }),
    query({ cursor: { id: id(1), createdAt: "infinity" } }), query({ cursor: { id: id(1), createdAt: "2026-02-30T08:00:00Z" } }),
    { ...query(), coach_user_id: id(1) }, { ...query(), [Symbol("hidden")]: true }];
  for (const value of invalidValues) assert.throws(() => snapshotCoachPendingInvitationsQuery(value as CoachPendingInvitationsQuery), badInput);
  for (const limit of [1, 25, 50]) assert.equal(snapshotCoachPendingInvitationsQuery(query({ limit })).limit, limit);
  assert.equal(snapshotCoachPendingInvitationsQuery(query({ query: "á".repeat(127) })).query.length, 127);
});

test("input accessors never run and hostile proxies are sanitized", () => {
  let calls = 0;
  const getter = { ...query(), get query() { calls++; throw Error("private"); } };
  const hostile = new Proxy({}, { ownKeys() { throw Error("private"); } });
  for (const value of [getter, hostile]) assert.throws(() => snapshotCoachPendingInvitationsQuery(value as CoachPendingInvitationsQuery), badInput);
  assert.equal(calls, 0);
});

test("minimal deeply frozen page keeps unknown active/inactive totals absent", () => {
  const result = mapCoachPendingInvitationsPage(page(), query());
  assert.deepEqual(result, page());
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.items) && Object.isFrozen(result.items[0]));
  assert.equal("active" in result, false);
  assert.deepEqual(mapCoachPendingInvitationsPage(page({ totalPending: 0, matchingCount: 0, items: [] }), query()).items, []);
});

test("server time determines expiry at exact microsecond, never phone clock", () => {
  const value = item(3, { issuedAt: "2026-09-02T09:00:00.000001Z", createdAt: "2026-09-02T09:00:00.000001Z",
    expiresAt: "2026-09-09T09:00:00.000001Z", state: "expired" });
  assert.equal(mapCoachPendingInvitationsPage(page({ serverNow: value.expiresAt, items: [value] }), query()).items[0].state, "expired");
  assert.throws(() => mapCoachPendingInvitationsPage(page({ serverNow: "2026-09-09T09:00:00.000000Z", items: [value] }), query()), invalid);
});

test("descending keyset preserves sub-millisecond ordering and UUID ties", () => {
  const rows = [item(3), item(2), item(9, { createdAt: "2026-09-09T08:00:00.000000Z" })];
  const nextCursor = { id: rows[2].id, createdAt: rows[2].createdAt };
  const result = mapCoachPendingInvitationsPage(page({ items: rows, totalPending: 8, matchingCount: 8, nextCursor }), query({ limit: 3 }));
  assert.deepEqual(result.nextCursor, nextCursor);
  assert.ok(Object.isFrozen(result.nextCursor));
  for (const changed of [[rows[1], rows[0], rows[2]], [rows[0], rows[0], rows[2]], [rows[2], rows[1], rows[0]]]) {
    assert.throws(() => mapCoachPendingInvitationsPage(page({ items: changed, totalPending: 3, matchingCount: 3 }), query()), invalid);
  }
});

test("cursor excludes anchor even across timezone representations", () => {
  const anchor = { id: id(3), createdAt: "2026-09-09T04:00:00.000001-04:00" };
  assert.throws(() => mapCoachPendingInvitationsPage(page(), query({ cursor: anchor })), invalid);
  const next = mapCoachPendingInvitationsPage(page({ items: [item(2)] }), query({ cursor: anchor }));
  assert.equal(next.items[0].id, id(2));
  assert.deepEqual(mapCoachPendingInvitationsPage(page({ totalPending: 0, matchingCount: 0, items: [] }), query({ cursor: anchor })).items, []);
});

test("totals are global, matching is before cursor, next is exact last row", () => {
  const value = page({ totalPending: 90, matchingCount: 4, nextCursor: { id: id(3), createdAt: item().createdAt } });
  assert.equal(mapCoachPendingInvitationsPage(value, query({ limit: 1 })).totalPending, 90);
  for (const changes of [{ matchingCount: 91 }, { matchingCount: -1 }, { totalPending: Infinity },
    { totalPending: Number.MAX_SAFE_INTEGER + 1 }, { matchingCount: 1.5 }, { nextCursor: null },
    { nextCursor: { id: id(2), createdAt: item().createdAt } }]) {
    assert.throws(() => mapCoachPendingInvitationsPage({ ...value, ...changes }, query({ limit: 1 })), invalid);
  }
  assert.throws(() => mapCoachPendingInvitationsPage(page({ items: [] }), query()), invalid);
  assert.throws(() => mapCoachPendingInvitationsPage(value, query({ limit: 2 })), invalid);
});

test("mapper preserves authoritative server matches instead of re-filtering Unicode in JS", () => {
  for (const [email, search] of [["álumno@example.test", " ALUMNO "], ["a%b@example.test", "%"], ["a_b@example.test", "_"], ["a\\b@example.test", "\\"], ["οσ@example.test", "ΟΣ"]]) {
    assert.equal(mapCoachPendingInvitationsPage(page({ items: [item(3, { recipientEmail: email })] }), query({ query: search })).items.length, 1);
  }
  assert.notEqual("ΟΣ".toLowerCase(), "οσ");
  // Literal wildcard behavior and Unicode search belong to the SQL runtime tests.
});

test("reject code, names, ownership and malformed consumed fields without projection leaks", () => {
  const additions = [{ code: "synthetic-code" }, { user_id: id(1) }, { studentName: "private" }, { generation: 1 }];
  const mutations = [{ state: "cancelled" }, { state: "accepted" }, { state: "expired" }, { id: "invalid" },
    { issuedAt: "2026-09-09T10:00:00Z", expiresAt: "2026-09-16T10:00:00Z" },
    { createdAt: "2026-09-10T08:00:00Z" }, { expiresAt: "2026-09-17T08:00:00.000001Z" },
    { recipientEmail: " ALUMNO@example.test " }, { recipientEmail: "x" }];
  for (const changes of [...additions, ...mutations]) assert.throws(() => mapCoachPendingInvitationsPage(page({ items: [item(3, changes)] }), query()), invalid);
  assert.throws(() => mapCoachPendingInvitationsPage({ ...page(), owner: id(1) }, query()), invalid);
});

test("reject sparse/oversize/getter arrays, malformed objects and proxies without throwing private errors", () => {
  let called = 0;
  const getterItems: unknown[] = [];
  Object.defineProperty(getterItems, "0", { enumerable: true, get() { called++; throw Error("private"); } });
  const getterRow = { ...item(), get recipientEmail() { called++; throw Error("private"); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [page({ items: new Array(1) }), page({ items: Array.from({ length: 51 }, () => item()) }),
    page({ items: getterItems }), page({ items: [getterRow] }), page({ items: [revoked.proxy] }), revoked.proxy,
    null, [], {}, new Proxy({}, { ownKeys() { throw Error("private"); } })]) {
    assert.throws(() => mapCoachPendingInvitationsPage(value, query()), invalid);
  }
  assert.equal(called, 0);
});
