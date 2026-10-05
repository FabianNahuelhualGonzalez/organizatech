import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCoachCommercialPortfolio, type CoachCommercialPortfolio } from "./coach-commercial-portfolio";

const period = (id: string, episodeId: string, startsOn: string, amountClp: number,
  frequency: "daily" | "monthly", paidAt: string | null = null) => ({
  id, episodeId, startsOn, endsBefore: frequency === "daily" ? "2026-10-06" : "2026-11-05",
  amountClp, frequency, paidAt,
});
const portfolio: CoachCommercialPortfolio = {
  serverToday: "2026-10-05", currentMonth: "2026-10", activeCount: 3, unlinkedCount: 1,
  items: [
    { episodeId: "a", studentName: "A", linkedAt: "2026-10-01T00:00:00Z", unlinkedAt: null,
      agreementStart: "2026-10-05", agreementEnd: null, status: "active", version: "v1",
      latestPeriod: period("p1", "a", "2026-10-05", 45000, "monthly") },
    { episodeId: "b", studentName: "B", linkedAt: "2026-09-01T00:00:00Z", unlinkedAt: null,
      agreementStart: "2026-09-01", agreementEnd: null, status: "pending_renewal", version: "v2",
      latestPeriod: { ...period("p2", "b", "2026-09-01", 40000, "monthly"), endsBefore: "2026-10-01" } },
    { episodeId: "c", studentName: "C", linkedAt: "2026-10-01T00:00:00Z", unlinkedAt: null,
      agreementStart: null, agreementEnd: null, status: "needs_agreement", version: null, latestPeriod: null },
    { episodeId: "d", studentName: "D", linkedAt: "2026-01-01T00:00:00Z", unlinkedAt: "2026-09-30T00:00:00Z",
      agreementStart: "2026-01-01", agreementEnd: "2026-09-30", status: "not_continuing", version: "v3",
      latestPeriod: period("p3", "d", "2026-09-01", 40000, "monthly") },
  ],
  periods: [period("p1", "a", "2026-10-05", 45000, "monthly"),
    period("p2", "b", "2026-09-01", 40000, "monthly"),
    period("p3", "d", "2026-09-01", 40000, "monthly")],
  months: [
    { month: "2026-10", estimatedClp: 45000, confirmedPaymentsClp: 40000, periodCount: 1,
      students: 3, joined: 2, left: 0 },
    { month: "2026-09", estimatedClp: 80000, confirmedPaymentsClp: 0, periodCount: 2,
      students: 2, joined: 0, left: 1 },
    { month: "2025-12", estimatedClp: 20000, confirmedPaymentsClp: 20000, periodCount: 1,
      students: 0, joined: 0, left: 0 },
  ],
};

test("commercial summary separates booked estimate, confirmed payments, invitations and alerts", () => {
  const result = summarizeCoachCommercialPortfolio(portfolio);
  assert.equal(result.currentEstimatedClp, 45000);
  assert.equal(result.currentConfirmedPaymentsClp, 40000);
  assert.deepEqual(result.breakdown, [{ amountClp: 45000, frequency: "monthly", students: 1,
    periods: 1, estimatedClp: 45000 }]);
  assert.equal(result.alertCount, 2);
  assert.deepEqual(result.needsAgreement.map((item) => item.episodeId), ["c"]);
  assert.deepEqual(result.expired.map((item) => item.episodeId), ["b"]);
  assert.deepEqual(result.years.map((year) => year.year), [2026, 2025]);
  assert.deepEqual(result.years[0], { year: 2026, estimatedClp: 125000, confirmedPaymentsClp: 40000 });
});

test("daily breakdown counts distinct students separately from periods", () => {
  const data = { ...portfolio, serverToday: "2026-10-07", periods: [period("x", "a", "2026-10-05", 1000, "daily"),
    period("y", "a", "2026-10-06", 1000, "daily")], months: [] };
  const result = summarizeCoachCommercialPortfolio(data);
  assert.deepEqual(result.breakdown, [{ amountClp: 1000, frequency: "daily", students: 1,
    periods: 2, estimatedClp: 2000 }]);
});
