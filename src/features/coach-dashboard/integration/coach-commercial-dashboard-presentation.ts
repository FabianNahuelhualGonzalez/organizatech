import type { CoachDashboardViewModel, CoachMetricView, CoachRenewalRowView } from "../components/coach-dashboard-view";
import { summarizeCoachCommercialPortfolio, type CoachCommercialItem,
  type CoachCommercialPortfolio } from "../model/coach-commercial-portfolio";
import { civilDate, FREQUENCY_LABELS } from "../model/coach-commercial-display";
import { formatCoachClpAmount } from "../model/coach-dashboard-money";

const unknown: CoachMetricView = { value: null, label: "Sin información" };
const count = (value: number): CoachMetricView => ({ value, label: String(value) });
const money = (value: number | null): CoachMetricView => ({
  value, label: value === null ? "Sin información" : `${formatCoachClpAmount(value)} CLP`,
});

function monthName(value: string, short = false): string {
  return new Intl.DateTimeFormat("es-CL", {
    month: short ? "short" : "long", ...(short ? {} : { year: "numeric" }), timeZone: "UTC",
  }).format(new Date(`${value}-01T12:00:00Z`));
}

function initials(name: string): string {
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => [...part][0] ?? "").join("");
}

function sumAmounts(items: readonly CoachCommercialItem[]): number | null {
  let total = 0;
  for (const item of items) {
    const amount = item.latestPeriod?.amountClp ?? 0;
    if (total > Number.MAX_SAFE_INTEGER - amount) return null;
    total += amount;
  }
  return total;
}

function renewalRow(item: CoachCommercialItem, state: CoachRenewalRowView["state"]): CoachRenewalRowView {
  const stateLabel = state === "pending" ? "Pendiente" : state === "renewed" ? "Renovado" : "No continúa";
  const subtitle = item.latestPeriod
    ? `${FREQUENCY_LABELS[item.latestPeriod.frequency]} · ${money(item.latestPeriod.amountClp).label}`
    : "Sin período comercial";
  return {
    id: item.episodeId, clientName: item.studentName, state, stateLabel, subtitle,
    subtitleTone: state === "pending" ? "pending" : state === "renewed" ? "ok" : "neutral",
    endDateLabel: item.latestPeriod ? civilDate(item.latestPeriod.endsBefore) : null,
    remainingLabel: null,
    ariaLabel: `${item.studentName}, ${stateLabel.toLowerCase()}, ${subtitle}`,
    canOpen: item.unlinkedAt === null,
  };
}

/** Maps only server-confirmed commercial facts into the existing Coach cards. */
export function buildCoachCommercialDashboardView(input: {
  readonly base: CoachDashboardViewModel;
  readonly portfolio: CoachCommercialPortfolio | null;
  readonly selectedMonthId: string | null;
  readonly pendingInvitations: number | null;
}): CoachDashboardViewModel {
  const { base, portfolio } = input;
  if (!portfolio) return {
    ...base,
    income: { ...base.income, amount: unknown, formulaLabel: null, atRisk: unknown,
      potential: unknown, potentialLabel: "PAGOS CONFIRMADOS", potentialNote: null },
    portfolio: { ...base.portfolio, alert: unknown, inactive: unknown },
    alerts: { description: "Acuerdos y renovaciones que necesitan atención.", rows: [],
      emptyLabel: "Información comercial no disponible", footerLabel: null },
    chart: { months: [], selectedMonthId: null, emptyLabel: "Histórico comercial no disponible", noSelectionLabel: null },
    renewals: { ...base.renewals, atStake: unknown, stack: null, rows: [],
      emptyLabel: "Información comercial no disponible", retentionLabel: null },
  };

  const summary = summarizeCoachCommercialPortfolio(portfolio);
  const currentMonth = portfolio.months.find((month) => month.month === portfolio.currentMonth);
  const monthlyRisk = summary.pendingRenewal.filter((item) => item.latestPeriod?.endsBefore.slice(0, 7) === portfolio.currentMonth);
  const alerts = new Map<string, { item: CoachCommercialItem; reason: string; tone: "pending" | "error" }>();
  for (const item of summary.needsAgreement) alerts.set(item.episodeId, { item, reason: "Sin acuerdo comercial", tone: "pending" });
  for (const item of summary.expiringSoon) alerts.set(item.episodeId, { item, reason: "Próximo a vencer", tone: "pending" });
  for (const item of summary.pendingRenewal) alerts.set(item.episodeId, { item,
    reason: item.latestPeriod && item.latestPeriod.endsBefore <= portfolio.serverToday ? "Período vencido" : "Renovación pendiente",
    tone: "error" });

  const maxStudents = portfolio.stats?.maxStudents
    ?? summary.months.reduce((max, month) => Math.max(max, month.students), 0);
  const best = summary.months.find((month) => month.students === maxStudents && maxStudents > 0)?.month;
  const months = summary.months.map((month) => ({
    id: month.month, shortLabel: monthName(month.month, true), fullLabel: monthName(month.month),
    ariaLabel: `${monthName(month.month)}: ${month.students} alumnos, ingreso estimado ${money(month.estimatedClp).label}`,
    students: count(month.students), joined: count(month.joined), left: count(month.left),
    leftTone: "neutral" as const, estimatedIncome: money(month.estimatedClp),
    confirmedPayments: money(month.confirmedPaymentsClp),
    readingLabel: month.periodCount === 0 ? "Sin períodos iniciados" : null,
    readingTone: "neutral" as const, isBest: month.month === best,
    barRatio: maxStudents > 0 ? month.students / maxStudents : 0,
  }));

  const pending = summary.pendingRenewal;
  const declined = summary.notContinuing;
  const occupied = new Set([...pending, ...declined].map((item) => item.episodeId));
  const renewed = summary.renewed.filter((item) => !occupied.has(item.episodeId));
  const renewalRows = [
    ...pending.map((item) => renewalRow(item, "pending")),
    ...renewed.map((item) => renewalRow(item, "renewed")),
    ...declined.map((item) => renewalRow(item, "declined")),
  ];
  const renewalCounts = portfolio.stats
    ? { pending: portfolio.stats.pendingCount, renewed: portfolio.stats.renewedCount,
      declined: portfolio.stats.declinedCount }
    : { pending: pending.length, renewed: renewed.length, declined: declined.length };
  const totalRenewals = renewalCounts.pending + renewalCounts.renewed + renewalCounts.declined;

  return {
    ...base,
    income: { ...base.income, amount: money(currentMonth?.estimatedClp ?? null), comparisonLabel: null,
      formulaLabel: currentMonth ? `${currentMonth.periodCount} períodos iniciados este mes` : null,
      atRisk: money(currentMonth ? portfolio.stats?.monthlyRiskAmount ?? sumAmounts(monthlyRisk) : null),
      atRiskNote: (portfolio.stats?.monthlyRiskCount ?? monthlyRisk.length)
        ? `${portfolio.stats?.monthlyRiskCount ?? monthlyRisk.length} renovaciones pendientes` : null,
      potential: money(currentMonth?.confirmedPaymentsClp ?? null), potentialLabel: "PAGOS CONFIRMADOS",
      potentialNote: currentMonth ? "Este mes" : null },
    portfolio: { ...base.portfolio, active: count(summary.activeCount), alert: count(summary.alertCount),
      pending: input.pendingInvitations === null ? unknown : count(input.pendingInvitations),
      inactive: count(summary.unlinkedCount) },
    alerts: { description: "Acuerdos y renovaciones que necesitan atención.",
      rows: [...alerts.values()].map(({ item, reason, tone }) => ({
        id: item.episodeId, clientName: item.studentName, initials: initials(item.studentName), reason,
        whenLabel: null, dateLabel: item.latestPeriod ? civilDate(item.latestPeriod.endsBefore) : null, tone,
      })),
      emptyLabel: summary.alertCount === 0 ? "No hay alertas comerciales registradas." : null,
      footerLabel: portfolio.itemCursor ? "Cargar más" : null },
    chart: { months, selectedMonthId: months.some((month) => month.id === input.selectedMonthId)
      ? input.selectedMonthId : null,
      emptyLabel: months.length === 0 ? "Aún no hay meses comerciales registrados." : null,
      noSelectionLabel: months.length ? "Selecciona un mes para ver su detalle." : null,
      hasMore: Boolean(portfolio.monthCursor) },
    renewals: { ...base.renewals,
      atStake: money(totalRenewals ? portfolio.stats?.pendingAmount ?? sumAmounts(pending) : null),
      stack: totalRenewals ? { ariaLabel: `${renewalCounts.renewed} renovadas, ${renewalCounts.pending} pendientes, ${renewalCounts.declined} no continuadas`,
        segments: [
          { state: "renewed" as const, label: `${renewalCounts.renewed} renovadas`, ratio: renewalCounts.renewed / totalRenewals },
          { state: "pending" as const, label: `${renewalCounts.pending} pendientes`, ratio: renewalCounts.pending / totalRenewals },
          { state: "declined" as const, label: `${renewalCounts.declined} no continúan`, ratio: renewalCounts.declined / totalRenewals },
        ] } : null,
      rows: renewalRows, emptyLabel: totalRenewals ? null : "Aún no hay datos de renovaciones.",
      retentionLabel: null, hasMore: Boolean(portfolio.itemCursor) },
  };
}
