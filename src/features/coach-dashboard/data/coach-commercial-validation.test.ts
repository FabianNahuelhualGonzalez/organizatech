import assert from "node:assert/strict";
import test from "node:test";
import { COACH_COMMERCIAL_INITIAL_VERSION } from "./coach-commercial-contract";
import { mapCoachCommercialCommand, mapCoachCommercialPortfolio,
  mapCoachCommercialReceipt } from "./coach-commercial-validation";

const episodeId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const periodId = "10000000-0000-4000-8000-000000000003";
const version = "10000000-0000-4000-8000-000000000004";
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
