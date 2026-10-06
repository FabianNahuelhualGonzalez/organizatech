import assert from "node:assert/strict";
import test from "node:test";
import { COACH_COMMERCIAL_INITIAL_VERSION, CoachCommercialError,
  type CoachCommercialCommand, type CoachCommercialReceipt } from "./coach-commercial-contract";
import { isDefinitiveCoachCommercialRejection, matchesCoachCommercialOperation,
  snapshotCoachCommercialCommand } from "./coach-commercial-operation";
import { mapCoachCommercialCommand, mapCoachCommercialOverview, mapCoachCommercialPage, mapCoachCommercialPortfolio,
  mapCoachCommercialReceipt } from "./coach-commercial-validation";

const episodeId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const periodId = "10000000-0000-4000-8000-000000000003";
const version = "10000000-0000-4000-8000-000000000004";
const recordedVersion = "10000000-0000-4000-8000-000000000005";
const base = { action: "start", episodeId, requestId, expectedVersion: COACH_COMMERCIAL_INITIAL_VERSION,
  amountClp: 45000, frequency: "monthly", startsOn: "2026-10-05", agreementEndsOn: null };

test("write allowlist accepts exact commercial fields and rejects ownership injection", () => {
  const mapped = mapCoachCommercialCommand(base);
  assert.deepEqual(Object.keys(mapped.args), ["p_action", "p_episode_id", "p_request_id", "p_expected_version",
    "p_period_id", "p_amount_clp", "p_frequency", "p_starts_on", "p_agreement_ends_on"]);
  assert.equal(mapped.args.p_amount_clp, 45000);
  for (const injection of [{ ...base, coach_user_id: episodeId }, { ...base, student_user_id: episodeId },
    { ...base, amountClp: 0 }, { ...base, frequency: "hourly" }, { ...base, startsOn: "2026-02-30" }]) {
    assert.throws(() => mapCoachCommercialCommand(injection));
  }
  assert.throws(() => mapCoachCommercialCommand(null));
});

test("bounded overview validates server totals independently of visible rows", () => {
  const overview = {
    serverToday: "2026-10-05", currentMonth: "2026-10", items: [], itemCursor: "2026-10-01T00:00:00.000000+00:00|" + episodeId,
    months: [{ month: "2026-10", estimatedClp: 45000, confirmedPaymentsClp: 20000,
      periodCount: 1, students: 8, joined: 2, left: 0 }], monthCursor: "2026-10",
    stats: { activeCount: 8, unlinkedCount: 3, alertCount: 4, pendingCount: 2,
      renewedCount: 5, declinedCount: 1, pendingAmount: 70000,
      monthlyRiskCount: 2, monthlyRiskAmount: 70000, maxStudents: 10,
      currentBreakdown: [{ frequency: "monthly", amountClp: 45000, students: 1,
        periods: 1, estimatedClp: 45000 }],
      years: [{ year: 2026, estimatedClp: 500000, confirmedPaymentsClp: 200000 }] },
  };
  const mapped = mapCoachCommercialOverview(overview);
  assert.equal(mapped.stats?.alertCount, 4);
  assert.equal(mapped.months[0].estimatedClp, 45000);
  assert.throws(() => mapCoachCommercialOverview({ ...overview, ownerId: episodeId }));
  assert.throws(() => mapCoachCommercialOverview({ ...overview,
    stats: { ...overview.stats, pendingAmount: -1 } }));
  assert.deepEqual(mapCoachCommercialPage({ rows: [], nextCursor: null }, "periods").rows, []);
  assert.throws(() => mapCoachCommercialPage({ rows: [], nextCursor: "bad" }, "student"));
});

test("receipt and portfolio reject forged episode, amount and unknown fields", () => {
  const receipt = { status: "recorded", action: "start", requestId, episodeId, periodId, version,
    recordedAt: "2026-10-05T12:00:00Z" };
  assert.equal(mapCoachCommercialReceipt(receipt, { action: "start", episodeId }).version, version);
  assert.throws(() => mapCoachCommercialReceipt(receipt, { episodeId: requestId }));
  assert.throws(() => mapCoachCommercialReceipt(receipt, { requestId: episodeId }));
  assert.throws(() => mapCoachCommercialReceipt({ ...receipt, ownerId: episodeId }));
  const portfolio = {
    serverToday: "2026-10-05", currentMonth: "2026-10", activeCount: 1, unlinkedCount: 0,
    items: [{ episodeId, studentName: "Synthetic", linkedAt: "2026-10-01T00:00:00Z", unlinkedAt: null,
      agreementStart: "2026-10-05", agreementEnd: null, status: "active", version,
      latestPeriod: { id: periodId, episodeId, startsOn: "2026-10-05", endsBefore: "2026-11-05",
        amountClp: 45000, frequency: "monthly", paidAt: null } }],
    periods: [{ id: periodId, episodeId, startsOn: "2026-10-05", endsBefore: "2026-11-05",
      amountClp: 45000, frequency: "monthly", paidAt: null }],
    months: [{ month: "2026-10", estimatedClp: 45000, confirmedPaymentsClp: 0, periodCount: 1,
      students: 1, joined: 1, left: 0 }],
  };
  assert.equal(mapCoachCommercialPortfolio(portfolio).periods[0].amountClp, 45000);
  assert.throws(() => mapCoachCommercialPortfolio({ ...portfolio, periods: [{ ...portfolio.periods[0], amountClp: -1 }] }));
  assert.throws(() => mapCoachCommercialPortfolio({ ...portfolio, periods: [{ ...portfolio.periods[0], episodeId: requestId }] }));
});

test("a retry rejection cannot settle an earlier uncertain commercial write", () => {
  for (const code of ["version_conflict", "forbidden", "inactive_relationship", "request_conflict"] as const) {
    assert.equal(isDefinitiveCoachCommercialRejection(new CoachCommercialError(code)), true);
    assert.equal(isDefinitiveCoachCommercialRejection(new CoachCommercialError(code), true), false);
  }
  for (const code of ["timeout", "aborted", "unavailable", "invalid_response"] as const) {
    assert.equal(isDefinitiveCoachCommercialRejection(new CoachCommercialError(code)), false);
  }
  assert.equal(isDefinitiveCoachCommercialRejection(new Error("unknown")), false);
});

test("an uncertain request retains an immutable allowlisted command for exact retry", () => {
  const mutable = { ...base };
  const saved = snapshotCoachCommercialCommand(mutable as CoachCommercialCommand);
  mutable.amountClp = 70000;
  if (!("amountClp" in saved)) throw new Error("expected-commercial-terms");
  assert.equal(saved.amountClp, 45000);
  assert.equal(Object.isFrozen(saved), true);
  assert.throws(() => snapshotCoachCommercialCommand({ ...base, coach_user_id: episodeId } as CoachCommercialCommand));
});

test("reconciled commercial receipts bind to the original action, episode, request and target", () => {
  const command: CoachCommercialCommand = { action: "confirm_payment", episodeId, periodId, requestId,
    expectedVersion: version };
  const receipt: CoachCommercialReceipt = { status: "recorded", action: "confirm_payment", episodeId,
    periodId, requestId, version: recordedVersion, recordedAt: "2026-10-05T12:00:00Z" };
  assert.equal(matchesCoachCommercialOperation(command, receipt), true);
  assert.equal(matchesCoachCommercialOperation(command, { ...receipt, episodeId: requestId }), false);
  assert.equal(matchesCoachCommercialOperation(command, { ...receipt, requestId: episodeId }), false);
  assert.equal(matchesCoachCommercialOperation(command, { ...receipt, periodId: requestId }), false);
  assert.equal(matchesCoachCommercialOperation(command, { ...receipt, action: "renew" }), false);
  assert.equal(matchesCoachCommercialOperation(command, { ...receipt, version }), false);
  const exit: CoachCommercialCommand = { action: "not_continuing", episodeId, requestId, expectedVersion: version };
  assert.equal(matchesCoachCommercialOperation(exit, { ...receipt, action: "not_continuing", periodId: null }), true);
  assert.equal(matchesCoachCommercialOperation(exit, { ...receipt, action: "not_continuing" }), false);
});
