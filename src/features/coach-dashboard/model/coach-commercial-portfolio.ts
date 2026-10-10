/** Commercial facts only. Training cycles and pending invitations are separate. */
import type { CoachCommercialFrequency } from "@/lib/coach-commercial-terms";
export { COACH_COMMERCIAL_FREQUENCIES } from "@/lib/coach-commercial-terms";
export type { CoachCommercialFrequency } from "@/lib/coach-commercial-terms";
export type CoachCommercialStatus = "needs_agreement" | "active" | "pending_renewal" | "not_continuing";

export interface CoachCommercialItem {
  readonly episodeId: string;
  readonly studentName: string;
  readonly linkedAt: string;
  readonly unlinkedAt: string | null;
  readonly agreementStart: string | null;
  readonly agreementEnd: string | null;
  readonly status: CoachCommercialStatus;
  readonly version: string | null;
  readonly latestPeriod: CoachCommercialPeriod | null;
  /** Server aggregate for paginated reads; legacy snapshots omit it. */
  readonly periodCount?: number;
}
export interface CoachCommercialPeriod {
  readonly id: string;
  readonly episodeId: string;
  readonly startsOn: string;
  /** Exclusive Santiago civil date. */
  readonly endsBefore: string;
  readonly amountClp: number;
  readonly frequency: CoachCommercialFrequency;
  readonly paidAt: string | null;
}
export interface CoachCommercialMonth {
  readonly month: string;
  readonly estimatedClp: number;
  readonly confirmedPaymentsClp: number;
  readonly periodCount: number;
  readonly students: number;
  readonly joined: number;
  readonly left: number;
}
export interface CoachCommercialPortfolio {
  readonly serverToday: string;
  readonly currentMonth: string;
  readonly activeCount: number;
  readonly unlinkedCount: number;
  readonly items: readonly CoachCommercialItem[];
  readonly periods: readonly CoachCommercialPeriod[];
  readonly months: readonly CoachCommercialMonth[];
  readonly itemCursor?: string | null;
  readonly monthCursor?: string | null;
  readonly stats?: CoachCommercialPageStats;
}

export interface CoachCommercialPageStats {
  readonly alertCount: number;
  readonly pendingCount: number;
  readonly renewedCount: number;
  readonly declinedCount: number;
  readonly pendingAmount: number;
  readonly monthlyRiskCount: number;
  readonly monthlyRiskAmount: number;
  readonly maxStudents: number;
  readonly currentBreakdown: readonly CoachCommercialBreakdown[];
  readonly years: readonly CoachCommercialYear[];
}

export interface CoachCommercialBreakdown {
  readonly amountClp: number;
  readonly frequency: CoachCommercialFrequency;
  readonly students: number;
  readonly periods: number;
  readonly estimatedClp: number;
}
export interface CoachCommercialYear {
  readonly year: number;
  readonly estimatedClp: number;
  readonly confirmedPaymentsClp: number;
}
export interface CoachCommercialSummary {
  readonly currentEstimatedClp: number;
  readonly currentConfirmedPaymentsClp: number;
  readonly breakdown: readonly CoachCommercialBreakdown[];
  readonly activeCount: number;
  readonly unlinkedCount: number;
  readonly alertCount: number;
  readonly needsAgreement: readonly CoachCommercialItem[];
  readonly expired: readonly CoachCommercialItem[];
  readonly expiringSoon: readonly CoachCommercialItem[];
  readonly pendingRenewal: readonly CoachCommercialItem[];
  readonly renewed: readonly CoachCommercialItem[];
  readonly notContinuing: readonly CoachCommercialItem[];
  readonly months: readonly CoachCommercialMonth[];
  readonly years: readonly CoachCommercialYear[];
}

function add(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("coach-commercial-overflow");
  return sum;
}

/** Current estimate books each confirmed period in its start month. A manual
 * payment is booked in its confirmation month; neither number is cash forecast.
 * The server supplies complete owner-scoped facts. No invitation is counted.
 */
export function summarizeCoachCommercialPortfolio(portfolio: CoachCommercialPortfolio): CoachCommercialSummary {
  const current = portfolio.months.find((month) => month.month === portfolio.currentMonth);
  const currentPeriods = portfolio.periods.filter((period) => period.startsOn.slice(0, 7) === portfolio.currentMonth
    && period.startsOn <= portfolio.serverToday);
  const breakdown = new Map<string, CoachCommercialBreakdown>();
  const studentsByBreakdown = new Map<string, Set<string>>();
  for (const period of currentPeriods) {
    const key = `${period.frequency}:${period.amountClp}`;
    const prior = breakdown.get(key);
    const students = studentsByBreakdown.get(key) ?? new Set<string>();
    students.add(period.episodeId);
    studentsByBreakdown.set(key, students);
    breakdown.set(key, {
      amountClp: period.amountClp, frequency: period.frequency,
      students: students.size, periods: (prior?.periods ?? 0) + 1,
      estimatedClp: add(prior?.estimatedClp ?? 0, period.amountClp),
    });
  }
  const active = portfolio.items.filter((item) => item.unlinkedAt === null);
  const needsAgreement = active.filter((item) => item.status === "needs_agreement");
  const pendingRenewal = active.filter((item) => item.status === "pending_renewal");
  const expired = pendingRenewal.filter((item) => item.latestPeriod!.endsBefore < portfolio.serverToday);
  const nextWeek = new Date(`${portfolio.serverToday}T12:00:00Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const limit = nextWeek.toISOString().slice(0, 10);
  const expiringSoon = active.filter((item) => item.status === "active" && item.latestPeriod !== null
    && item.latestPeriod.endsBefore > portfolio.serverToday && item.latestPeriod.endsBefore <= limit);
  const periodCountByEpisode = new Map<string, number>();
  for (const period of portfolio.periods) {
    periodCountByEpisode.set(period.episodeId, (periodCountByEpisode.get(period.episodeId) ?? 0) + 1);
  }
  const renewed = portfolio.items.filter((item) => (item.periodCount ?? periodCountByEpisode.get(item.episodeId) ?? 0) > 1);
  const notContinuing = portfolio.items.filter((item) => item.status === "not_continuing");
  const years = new Map<number, CoachCommercialYear>();
  for (const month of portfolio.months) {
    const year = Number(month.month.slice(0, 4));
    const prior = years.get(year);
    years.set(year, { year, estimatedClp: add(prior?.estimatedClp ?? 0, month.estimatedClp),
      confirmedPaymentsClp: add(prior?.confirmedPaymentsClp ?? 0, month.confirmedPaymentsClp) });
  }
  return Object.freeze({
    currentEstimatedClp: current?.estimatedClp ?? 0,
    currentConfirmedPaymentsClp: current?.confirmedPaymentsClp ?? 0,
    breakdown: portfolio.stats?.currentBreakdown ?? Object.freeze([...breakdown.values()]),
    activeCount: portfolio.activeCount, unlinkedCount: portfolio.unlinkedCount,
    alertCount: portfolio.stats?.alertCount ?? new Set([...needsAgreement, ...pendingRenewal, ...expiringSoon].map((item) => item.episodeId)).size,
    needsAgreement, expired, expiringSoon, pendingRenewal, renewed, notContinuing,
    months: portfolio.months, years: portfolio.stats?.years ?? Object.freeze([...years.values()].sort((a, b) => b.year - a.year)),
  });
}
