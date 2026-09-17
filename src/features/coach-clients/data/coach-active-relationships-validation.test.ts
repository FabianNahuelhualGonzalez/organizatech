import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError } from "./coach-invitations-contract";
import type { CoachActiveRelationshipsQuery } from "./coach-active-relationships-contract";
import { activeRelationshipsParameters, mapCoachActiveRelationshipsPage, snapshotCoachActiveRelationshipsQuery } from "./coach-active-relationships-validation";

const id = (value: number) => `30000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const query = (changes = {}): CoachActiveRelationshipsQuery => ({ query: "", limit: 25, cursor: null, ...changes });
const item = (value = 3, changes = {}) => ({ id: id(value), studentName: "Álvaro Alumno", studentEmail: "alumno@example.test",
  linkedAt: "2026-09-09T08:00:00.000001+00:00", ...changes });
const page = (changes = {}) => ({ serverNow: "2026-09-09T09:00:00+00:00", totalActive: 1,
  matchingCount: 1, items: [item()], nextCursor: null, ...changes });
const invalid = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_response";
const badInput = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_input";

test("active query freezes exact allowlist, original search and microsecond cursor", () => {
  const value = query({ query: " ÁLUMNO ", cursor: { id: id(8).toUpperCase(), linkedAt: "2026-09-09T08:00:00.123456Z" } });
  const snapshot = snapshotCoachActiveRelationshipsQuery(value);
  assert.notEqual(snapshot.cursor, value.cursor);
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.cursor));
  assert.deepEqual(activeRelationshipsParameters(snapshot), { p_query: " ÁLUMNO ", p_limit: 25,
    p_cursor_linked_at: "2026-09-09T08:00:00.123456Z", p_cursor_id: id(8) });
  assert.deepEqual(activeRelationshipsParameters(query()), { p_query: "", p_limit: 25, p_cursor_linked_at: null, p_cursor_id: null });
});

test("query rejects invalid text, UTF8 bounds, limits, cursors and ownership fields", () => {
  const invalidValues: unknown[] = [null, [], {}, query({ query: null }), query({ query: "a".repeat(255) }),
    query({ query: "á".repeat(128) }), query({ query: "a\0b" }), query({ query: "\ud800" }),
    ...[null, 0, -1, 51, 1.5, "25", NaN, Infinity].map(limit => query({ limit })),
    query({ cursor: { id: id(1) } }), query({ cursor: { id: "not-id", linkedAt: "2026-09-09T08:00:00Z" } }),
    ...["infinity", "2026-02-30T08:00:00Z", "0001-01-01T00:00:00+00:01", "9999-12-31T23:59:59-00:01"].map(linkedAt => query({ cursor: { id: id(1), linkedAt } })),
    { ...query(), coach_user_id: id(1) }, { ...query(), [Symbol("hidden")]: true }];
  for (const value of invalidValues) assert.throws(() => snapshotCoachActiveRelationshipsQuery(value as CoachActiveRelationshipsQuery), badInput);
  for (const limit of [1, 25, 50]) assert.equal(snapshotCoachActiveRelationshipsQuery(query({ limit })).limit, limit);
  assert.equal(snapshotCoachActiveRelationshipsQuery(query({ query: "á".repeat(127) })).query.length, 127);
  assert.equal(snapshotCoachActiveRelationshipsQuery(query({ query: "🏋️" })).query, "🏋️");
});

test("input accessors never execute and hostile proxies are sanitized", () => {
  let calls = 0;
  const getter = { ...query(), get query() { calls++; throw Error("private"); } };
  const hostile = new Proxy({}, { ownKeys() { throw Error("private"); } });
  for (const value of [getter, hostile]) assert.throws(() => snapshotCoachActiveRelationshipsQuery(value as CoachActiveRelationshipsQuery), badInput);
  assert.equal(calls, 0);
});

test("minimal frozen snapshot preserves names/emails and contains no invented activity", () => {
  const result = mapCoachActiveRelationshipsPage(page(), query());
  assert.deepEqual(result, page());
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.items) && Object.isFrozen(result.items[0]));
  for (const field of ["cycle", "progress", "studentId", "coachId", "trainingSessions", "endedAt"]) assert.equal(field in result.items[0], false);
  assert.deepEqual(mapCoachActiveRelationshipsPage(page({ totalActive: 0, matchingCount: 0, items: [] }), query()).items, []);
  const snapshot = item(3, { studentName: "  José 🏋️  ", studentEmail: " Legacy-Address " });
  assert.deepEqual(mapCoachActiveRelationshipsPage(page({ items: [snapshot] }), query()).items[0], snapshot);
});

test("SQL-compatible snapshot lengths use Unicode codepoints and UTF8 bytes", () => {
  const valid = item(3, { studentName: "🙂".repeat(201), studentEmail: "á".repeat(127) });
  assert.deepEqual(mapCoachActiveRelationshipsPage(page({ items: [valid] }), query()).items[0], valid);
  for (const changes of [{ studentName: " " }, { studentName: "🙂".repeat(202) },
    { studentEmail: "ab" }, { studentEmail: "á".repeat(128) }, { studentEmail: "a\0b" },
    { studentName: "\ud800" }, { studentName: null }, { studentEmail: 123 }]) {
    assert.throws(() => mapCoachActiveRelationshipsPage(page({ items: [item(3, changes)] }), query()), invalid);
  }
});

test("future finite linkedAt is a stored snapshot, not a new scheduling constraint", () => {
  const future = item(3, { linkedAt: "2027-01-01T00:00:00Z" });
  assert.equal(mapCoachActiveRelationshipsPage(page({ items: [future] }), query()).items[0].linkedAt, future.linkedAt);
  assert.ok(snapshotCoachActiveRelationshipsQuery(query({ cursor: { id: id(3), linkedAt: "9999-12-31T23:59:59.999999Z" } })).cursor);
  for (const linkedAt of ["infinity", "0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"]) {
    assert.throws(() => mapCoachActiveRelationshipsPage(page({ items: [item(3, { linkedAt })] }), query()), invalid);
  }
});

test("descending keyset preserves sub-millisecond ordering and UUID ties", () => {
  const rows = [item(3), item(2), item(9, { linkedAt: "2026-09-09T08:00:00.000000Z" })];
  const nextCursor = { id: rows[2].id, linkedAt: rows[2].linkedAt };
  const result = mapCoachActiveRelationshipsPage(page({ items: rows, totalActive: 8, matchingCount: 8, nextCursor }), query({ limit: 3 }));
  assert.deepEqual(result.nextCursor, nextCursor);
  assert.ok(Object.isFrozen(result.nextCursor));
  for (const changed of [[rows[1], rows[0], rows[2]], [rows[0], rows[0], rows[2]], [rows[2], rows[1], rows[0]]]) {
    assert.throws(() => mapCoachActiveRelationshipsPage(page({ items: changed, totalActive: 3, matchingCount: 3 }), query()), invalid);
  }
});

test("cursor excludes exact anchor across timezone representations and permits empty revoked page", () => {
  const anchor = { id: id(3), linkedAt: "2026-09-09T04:00:00.000001-04:00" };
  assert.throws(() => mapCoachActiveRelationshipsPage(page(), query({ cursor: anchor })), invalid);
  assert.equal(mapCoachActiveRelationshipsPage(page({ items: [item(2)] }), query({ cursor: anchor })).items[0].id, id(2));
  assert.deepEqual(mapCoachActiveRelationshipsPage(page({ totalActive: 0, matchingCount: 0, items: [] }), query({ cursor: anchor })).items, []);
});

test("fresh global and matching counts are not computed from the limited page", () => {
  const value = page({ totalActive: 90, matchingCount: 4, nextCursor: { id: id(3), linkedAt: item().linkedAt } });
  assert.equal(mapCoachActiveRelationshipsPage(value, query({ limit: 1 })).totalActive, 90);
  for (const changes of [{ matchingCount: 91 }, { matchingCount: -1 }, { totalActive: Infinity },
    { totalActive: Number.MAX_SAFE_INTEGER + 1 }, { matchingCount: 1.5 }, { nextCursor: null },
    { nextCursor: { id: id(2), linkedAt: item().linkedAt } }]) {
    assert.throws(() => mapCoachActiveRelationshipsPage({ ...value, ...changes }, query({ limit: 1 })), invalid);
  }
  assert.throws(() => mapCoachActiveRelationshipsPage(page({ items: [] }), query()), invalid);
  assert.throws(() => mapCoachActiveRelationshipsPage(value, query({ limit: 2 })), invalid);
});

test("matching by name or email stays authoritative in SQL, no contextual JS Unicode refilter", () => {
  for (const [studentName, search] of [["Álvaro", " ALVARO "], ["A%B", "%"], ["A_B", "_"], ["A\\B", "\\"], ["οσ", "ΟΣ"]]) {
    assert.equal(mapCoachActiveRelationshipsPage(page({ items: [item(3, { studentName })] }), query({ query: search })).items.length, 1);
  }
  assert.notEqual("ΟΣ".toLowerCase(), "οσ");
});

test("reject code, ownership, ended and activity fields instead of projecting excess data", () => {
  for (const changes of [{ code: "synthetic" }, { user_id: id(1) }, { studentId: id(1) },
    { coach_user_id: id(1) }, { endedAt: null }, { cycle: null }, { progress: 0 }, { id: "invalid" }]) {
    assert.throws(() => mapCoachActiveRelationshipsPage(page({ items: [item(3, changes)] }), query()), invalid);
  }
  assert.throws(() => mapCoachActiveRelationshipsPage({ ...page(), owner: id(1) }, query()), invalid);
});

test("sparse/getter/oversize arrays and hostile objects fail without private errors or accessor execution", () => {
  let called = 0;
  const getterItems: unknown[] = [];
  Object.defineProperty(getterItems, "0", { enumerable: true, get() { called++; throw Error("private"); } });
  const getterRow = { ...item(), get studentName() { called++; throw Error("private"); } };
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [page({ items: new Array(1) }), page({ items: Array.from({ length: 51 }, () => item()) }),
    page({ items: getterItems }), page({ items: [getterRow] }), page({ items: [revoked.proxy] }), revoked.proxy,
    null, [], {}, new Proxy({}, { ownKeys() { throw Error("private"); } })]) {
    assert.throws(() => mapCoachActiveRelationshipsPage(value, query()), invalid);
  }
  assert.equal(called, 0);
});
