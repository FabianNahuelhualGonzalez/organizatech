import assert from "node:assert/strict";
import test from "node:test";
import { COACH_PAID_PERIOD_INITIAL_VERSION as initial, CoachPaidPeriodsError } from "./coach-paid-periods-contract";
import {
  mapCoachPaidPeriodRead, mapCoachPaidPeriodReceipt, mapCoachPaidPeriodWrite,
  paidCivilDate, paidDates, paidRecord, paidRpcEnvelope, paidUuid,
} from "./coach-paid-periods-validation";

const episodeId = "40000000-0000-4000-8000-000000000001";
const periodId = "50000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const version = "60000000-0000-4000-8000-000000000001";
const period = { id: periodId, linkEpisodeId: episodeId, start: "2026-09-01", end: "2026-09-30" };
const operation = { requestId, action: "confirm", period, version, recordedAt: "2026-09-09T06:00:00.123456+00:00" };
const expected = { requestId, episodeId, expectedVersion: initial, start: period.start, end: period.end, action: "confirm" as const };
const isError = (code = "invalid_response") => (error: unknown) => error instanceof CoachPaidPeriodsError
  && error.code === code && error.message === `coach-paid-periods-${code}`;

test("strict civil dates reproduce SQL bounds without timezone or Date normalization", () => {
  for (const valid of ["0001-01-01", "9999-12-31", "2000-02-29", "2024-02-29", "1900-02-28", "2026-12-31"]) {
    assert.equal(paidCivilDate(valid), valid);
  }
  for (const invalid of [null, undefined, 42, {}, "", "0000-01-01", "10000-01-01", "1900-02-29", "2026-02-29",
    "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "2026-1-01", "2026-01-1",
    " 2026-01-01", "2026-01-01 ", "2026-01-01\n", "2026-01-01T00:00:00Z", "2026-０１-01", "infinity", "2026-01-01 BC"]) {
    assert.throws(() => paidCivilDate(invalid), isError());
    assert.throws(() => paidCivilDate(invalid, "invalid_input"), isError("invalid_input"));
  }
  assert.deepEqual(paidDates("0001-01-01", "9999-12-31"), { start: "0001-01-01", end: "9999-12-31" });
  assert.throws(() => paidDates(period.start, period.start), isError());
  assert.throws(() => paidDates(period.end, period.start, "invalid_input"), isError("invalid_input"));
});

test("descriptor-safe allowlists and UUID parser reject ownership, getters, symbols and proxies", () => {
  let getterReads = 0;
  const getter = Object.defineProperty({}, "id", { enumerable: true, get() { getterReads++; return periodId; } });
  const hidden = Object.defineProperty({}, "id", { value: periodId, enumerable: false });
  const proxy = new Proxy({ id: periodId }, { ownKeys() { throw new Error("private detail"); } });
  for (const invalid of [null, [], {}, new Date(), { id: periodId, owner_id: episodeId },
    { id: periodId, [Symbol("secret")]: "private" }, getter, hidden, proxy, Object.create({ id: periodId })]) {
    assert.throws(() => paidRecord(invalid, ["id"]), isError());
  }
  assert.equal(getterReads, 0);
  assert.equal(paidUuid("ABCDEFAB-0000-4000-8000-000000000001"), "abcdefab-0000-4000-8000-000000000001");
  assert.equal(paidUuid(initial), initial);
  for (const invalid of [null, undefined, 1, "uuid", periodId.replaceAll("-", ""), `${periodId} `]) {
    assert.throws(() => paidUuid(invalid), isError());
  }
});

test("read result distinguishes no period from a recorded period with coherent version and episode", () => {
  assert.deepEqual(mapCoachPaidPeriodRead({ linkEpisodeId: episodeId, version: initial, period: null }, episodeId),
    { linkEpisodeId: episodeId, version: initial, period: null });
  const result = mapCoachPaidPeriodRead({ linkEpisodeId: episodeId, version, period }, episodeId);
  assert.deepEqual(result, { linkEpisodeId: episodeId, version, period });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.period));
  for (const invalid of [null, {}, { linkEpisodeId: episodeId, version, period: null },
    { linkEpisodeId: episodeId, version: initial, period }, { linkEpisodeId: requestId, version, period },
    { linkEpisodeId: episodeId, version, period: { ...period, linkEpisodeId: requestId } },
    { linkEpisodeId: episodeId, version, period, state: "paid" },
    { linkEpisodeId: episodeId, version, period: { ...period, end: period.start } },
    { linkEpisodeId: episodeId, version, period: { ...period, amount: 50000 } },
    { linkEpisodeId: episodeId, version, period: { ...period, id: "client-1" } }]) {
    assert.throws(() => mapCoachPaidPeriodRead(invalid, episodeId), isError());
  }
});

test("receipt maps only immutable SQL fields and preserves timestamp microseconds", () => {
  const input = structuredClone(operation);
  const result = mapCoachPaidPeriodReceipt(input, expected);
  input.period.end = "2026-10-31";
  assert.equal(result.period.end, "2026-09-30");
  assert.equal(result.recordedAt, operation.recordedAt);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.period));
  assert.deepEqual(Object.keys(result).sort(), ["action", "period", "recordedAt", "requestId", "version"]);
  for (const stamp of ["2026-09-09T03:00:00.123456-03:00", "2026-09-09T06:00:00Z", "0001-01-01T00:00:00+00:00"]) {
    assert.equal(mapCoachPaidPeriodReceipt({ ...operation, recordedAt: stamp }, { requestId }).recordedAt, stamp);
  }
  for (const invalid of ["2026-02-29T00:00:00Z", "2026-09-09", "2026-09-09T06:00:00.1234567Z", "0000-01-01T00:00:00Z",
    "2026-09-09T24:00:00Z", "2026-09-09T06:00:00+16:00", null]) {
    assert.throws(() => mapCoachPaidPeriodReceipt({ ...operation, recordedAt: invalid }, expected), isError());
  }
});

test("write responses verify caller action, IDs, dates and a changed noninitial CAS version", () => {
  const write = { status: "recorded", operation };
  assert.equal(mapCoachPaidPeriodWrite(write, expected).operation.action, "confirm");
  assert.equal(mapCoachPaidPeriodWrite({ status: "recorded", operation: { ...operation, action: "correct" } },
    { ...expected, action: "correct", periodId }).operation.period.id, periodId);
  for (const op of [{ ...operation, requestId: episodeId }, { ...operation, version: initial },
    { ...operation, action: "correct" }, { ...operation, action: "renewed" },
    { ...operation, period: { ...period, linkEpisodeId: requestId } },
    { ...operation, period: { ...period, start: "2026-09-02" } },
    { ...operation, period: { ...period, end: "2026-10-01" } },
    { ...operation, owner_id: episodeId }, { ...operation, payload: {} }, { ...operation, code: "AA2-AA2-AA2" }]) {
    assert.throws(() => mapCoachPaidPeriodWrite({ status: "recorded", operation: op }, expected), isError());
  }
  assert.throws(() => mapCoachPaidPeriodWrite(write, { ...expected, expectedVersion: version }), isError());
  assert.throws(() => mapCoachPaidPeriodWrite({ status: "recorded", operation: { ...operation, action: "correct" } },
    { ...expected, action: "correct", periodId: requestId }), isError());
  for (const invalid of [{ ...write, message: "Pagado" }, { ...write, sent: true },
    { ...write, status: "confirmed" }, { ...write, status: "paid" }, { status: "rate_limited", retryAt: operation.recordedAt }]) {
    assert.throws(() => mapCoachPaidPeriodWrite(invalid, expected), isError());
  }
});

test("reconciliation accepts either SQL action but not a different request or invented current state", () => {
  for (const action of ["confirm", "correct"] as const) {
    assert.equal(mapCoachPaidPeriodReceipt({ ...operation, action }, { requestId }).action, action);
  }
  assert.throws(() => mapCoachPaidPeriodReceipt({ ...operation, requestId: episodeId }, { requestId }), isError());
  assert.throws(() => mapCoachPaidPeriodReceipt({ ...operation, current: true }, { requestId }), isError());
});

test("transport metadata allowlist handles Supabase envelopes without trusting data/error contradictions", () => {
  const data = { status: "recorded", operation };
  assert.deepEqual(paidRpcEnvelope({ data, error: null, count: null, status: 200, statusText: "OK" }), { data, error: null });
  const error = { code: "40001", message: "private" };
  assert.deepEqual(paidRpcEnvelope({ data: null, error, status: 409 }), { data: null, error });
  assert.deepEqual(paidRpcEnvelope({ data: null, error: {}, status: 0, statusText: "" }), { data: null, error: {} });
  assert.deepEqual(paidRpcEnvelope({ data, error: null, success: true, count: null, status: 200, statusText: "OK" }), { data, error: null });
  assert.deepEqual(paidRpcEnvelope({ data: null, error, success: false, status: 409 }), { data: null, error });
  assert.deepEqual(paidRpcEnvelope({ data: null, error: {}, success: false, status: 0 }), { data: null, error: {} });
  let getterReads = 0;
  const getter = Object.defineProperty({ error: null }, "data", { enumerable: true, get() { getterReads++; return data; } });
  for (const invalid of [null, {}, [], { data }, { data, error: undefined }, { data, error }, { data: null, error: "private" },
    { data, error: null, message: "private" }, { data, error: null, status: 500 }, { data: null, error, status: 200 },
    { data, error: null, count: -1 }, { data, error: null, statusText: 123 },
    { data, error: null, status: 0 }, { data, error: null, status: 600 }, getter,
    { data, error: null, success: false }, { data: null, error, success: true },
    { data, error: null, success: "true" }, { data, error: null, success: undefined },
    { data, error: null, success: true, status: 500 }, { data: null, error, success: false, status: 200 },
    Object.defineProperty({ data, error: null }, "success", { enumerable: true, get() { getterReads++; return true; } }),
    new Proxy({ data, error: null }, { ownKeys() { throw new Error("private"); } })]) {
    assert.throws(() => paidRpcEnvelope(invalid), isError());
  }
  assert.equal(getterReads, 0);
});
