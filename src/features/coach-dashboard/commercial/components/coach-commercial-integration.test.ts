import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachDashboardViewModel } from "../../components/coach-dashboard-view";
import { buildCoachCommercialDashboardView } from "../../integration/coach-commercial-dashboard-presentation";
import type { CoachCommercialPortfolio } from "../../model/coach-commercial-portfolio";
import { canConfirmLatestPayment, latestAction } from "../../model/coach-commercial-display";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)]
    .map((match) => [match[1], match[1]]));
};
const { CoachDashboardView } = requireComponent("../../components/coach-dashboard.tsx") as typeof import("../../components/coach-dashboard");
const { CoachCommercialStudent } = requireComponent("./coach-commercial-student.tsx") as typeof import("./coach-commercial-student");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

const metric = (value: number | null, label: string) => ({ value, label });
function base(): CoachDashboardViewModel {
  const unknown = metric(null, "Sin información");
  return {
    welcome: { coachName: "Coach", todayLabel: "fecha" },
    income: { amount: unknown, comparisonLabel: null, comparisonTone: "neutral", formulaLabel: null,
      atRisk: unknown, atRiskNote: null, potential: unknown, potentialLabel: "POTENCIAL", potentialNote: null },
    portfolio: { totalLabel: null, active: unknown, alert: unknown, pending: unknown, inactive: unknown,
      activeNote: "Vínculos aceptados" },
    alerts: { description: "", rows: [], emptyLabel: null, footerLabel: null },
    chart: { months: [], selectedMonthId: null, emptyLabel: null, noSelectionLabel: null },
    renewals: { title: "Renovaciones", description: "Períodos comerciales", atStake: unknown,
      stack: null, rows: [], emptyLabel: null, retentionLabel: null },
  };
}

const current = { id: "period-current", episodeId: "accepted", startsOn: "2026-10-05",
  endsBefore: "2026-11-05", amountClp: 45000, frequency: "monthly" as const, paidAt: null };
const expired = { id: "period-expired", episodeId: "due", startsOn: "2026-09-01",
  endsBefore: "2026-10-01", amountClp: 30000, frequency: "monthly" as const, paidAt: "2026-09-02T12:00:00Z" };
const portfolio: CoachCommercialPortfolio = {
  serverToday: "2026-10-05", currentMonth: "2026-10", activeCount: 2, unlinkedCount: 0,
  items: [
    { episodeId: "accepted", studentName: "Alumno aceptado", linkedAt: "2026-10-02T12:00:00Z",
      unlinkedAt: null, agreementStart: "2026-10-05", agreementEnd: null,
      status: "active", version: "v1", latestPeriod: current },
    { episodeId: "due", studentName: "Alumno por renovar", linkedAt: "2026-09-01T12:00:00Z",
      unlinkedAt: null, agreementStart: "2026-09-01", agreementEnd: null,
      status: "pending_renewal", version: "v2", latestPeriod: expired },
  ],
  periods: [current, expired],
  months: [{ month: "2026-10", estimatedClp: 45000, confirmedPaymentsClp: 20000,
    periodCount: 1, students: 2, joined: 1, left: 0 }],
};

test("existing dashboard cards receive distinct real estimate, payments, alerts and month facts", () => {
  const view = buildCoachCommercialDashboardView({ base: base(), portfolio,
    selectedMonthId: "2026-10", pendingInvitations: 3 });
  assert.deepEqual([view.income.amount.value, view.income.potential.value], [45000, 20000]);
  assert.equal(view.income.potentialLabel, "PAGOS CONFIRMADOS");
  assert.deepEqual([view.portfolio.active.value, view.portfolio.pending.value], [2, 3]);
  assert.deepEqual(view.alerts.rows.map((row) => row.id), ["due"]);
  assert.equal(view.chart.months[0].confirmedPayments?.value, 20000);
  assert.equal(view.chart.months[0].estimatedIncome.value, 45000);
  assert.equal(view.renewals.rows[0].state, "pending");
  const markup = renderToStaticMarkup(createElement(CoachDashboardView, { view, actions: {} }));
  const headings = ["INGRESO DE ESTE MES", "Tus alumnos", "Requieren tu atención", "Tus asesorías mes a mes", "Renovaciones"];
  for (let i = 1; i < headings.length; i++) assert.ok(markup.indexOf(headings[i - 1]) < markup.indexOf(headings[i]));
  assert.match(markup, /PAGOS CONFIRMADOS/);
  assert.match(markup, /45\.000 CLP/);
  assert.doesNotMatch(markup, /Portafolio comercial/);
});

test("paged dashboard keeps server totals beyond the visible commercial rows", () => {
  const partial: CoachCommercialPortfolio = { ...portfolio, items: [portfolio.items[0]], periods: [],
    itemCursor: "next", monthCursor: "2026-10", stats: {
      alertCount: 7, pendingCount: 6, renewedCount: 8, declinedCount: 2,
      pendingAmount: 180000, monthlyRiskCount: 4, monthlyRiskAmount: 120000,
      maxStudents: 10, currentBreakdown: [], years: [{ year: 2026, estimatedClp: 500000,
        confirmedPaymentsClp: 320000 }],
    } };
  const view = buildCoachCommercialDashboardView({ base: base(), portfolio: partial,
    selectedMonthId: "2026-10", pendingInvitations: 3 });
  assert.deepEqual([view.income.amount.value, view.income.potential.value,
    view.income.atRisk.value, view.portfolio.alert.value, view.renewals.atStake.value],
  [45000, 20000, 120000, 7, 180000]);
  assert.match(view.renewals.stack?.ariaLabel ?? "", /8 renovadas, 6 pendientes, 2 no continuadas/);
  assert.equal(view.chart.hasMore, true);
  assert.equal(view.renewals.hasMore, true);
  assert.equal(view.alerts.footerLabel, "Cargar más");
});

test("missing portfolio never falls back to tariff times invitations or invents months", () => {
  const initial = base();
  const legacy = { ...initial, income: { ...initial.income, amount: metric(99999, "$99.999") } };
  const view = buildCoachCommercialDashboardView({ base: legacy, portfolio: null,
    selectedMonthId: null, pendingInvitations: 2 });
  assert.equal(view.income.amount.value, null);
  assert.equal(view.income.potential.value, null);
  assert.deepEqual(view.alerts.rows, []);
  assert.deepEqual(view.chart.months, []);
  assert.deepEqual(view.renewals.rows, []);
});

test("an empty server portfolio shows no invented income, payment or renewal amount", () => {
  const view = buildCoachCommercialDashboardView({ base: base(), portfolio: {
    serverToday: "2026-10-05", currentMonth: "2026-10", activeCount: 0, unlinkedCount: 0,
    items: [], periods: [], months: [],
  }, selectedMonthId: null, pendingInvitations: 1 });
  assert.equal(view.income.amount.value, null);
  assert.equal(view.income.potential.value, null);
  assert.equal(view.renewals.atStake.value, null);
  assert.deepEqual(view.chart.months, []);
  assert.equal(view.portfolio.active.value, 0);
  assert.equal(view.portfolio.pending.value, 1);
});

test("accepted student can start an agreement; only the latest unpaid future period can be corrected", () => {
  const accepted = portfolio.items[0];
  const noAgreement = { ...accepted, status: "needs_agreement" as const, version: null, latestPeriod: null };
  assert.equal(latestAction(noAgreement, portfolio.serverToday), "start");
  assert.equal(latestAction(accepted, portfolio.serverToday), null);
  assert.equal(canConfirmLatestPayment(accepted, portfolio.serverToday), true);
  const future = { ...accepted, latestPeriod: { ...current, startsOn: "2026-10-12", endsBefore: "2026-11-12" } };
  assert.equal(latestAction(future, portfolio.serverToday), "correct_future");
  assert.equal(latestAction({ ...future, latestPeriod: { ...future.latestPeriod, paidAt: "2026-10-05T12:00:00Z" } }, portfolio.serverToday), null);
  assert.equal(latestAction(portfolio.items[1], portfolio.serverToday), "renew");
});

test("productive student sheet shows CLP, indefinite term, payment, renewal exit and read-only history", () => {
  const noop = () => undefined;
  const render = (item: CoachCommercialPortfolio["items"][number], periods = portfolio.periods) =>
    renderToStaticMarkup(createElement(CoachCommercialStudent, { item, periods, today: portfolio.serverToday,
      busy: false, uncertain: false, retryAllowed: false, needsRefresh: false, issue: null,
      onSubmit: noop, onReconcile: noop, onRetry: noop, onReload: noop }));
  assert.match(render(portfolio.items[0]), /45\.000 CLP/);
  assert.match(render(portfolio.items[0]), /Indefinida/);
  assert.match(render(portfolio.items[0]), /Confirmar pago/);
  assert.match(render(portfolio.items[1]), /Renovar/);
  assert.match(render(portfolio.items[1]), /No continúa/);
  const future = { ...portfolio.items[0], latestPeriod: { ...current, startsOn: "2026-10-12", endsBefore: "2026-11-12" } };
  assert.match(render(future), /Corregir período futuro/);
  const initial = { ...portfolio.items[0], status: "needs_agreement" as const, version: null, latestPeriod: null };
  const initialMarkup = render(initial);
  assert.match(initialMarkup, /Configurar acuerdo inicial/);
  for (const label of ["Diaria", "Semanal", "Mensual", "Trimestral", "Semestral", "Anual"]) {
    assert.match(initialMarkup, new RegExp(`<option[^>]*>${label}</option>`));
  }
  const historical = { ...expired, episodeId: "accepted", id: "historical" };
  const markup = render(portfolio.items[0], [current, historical]);
  assert.match(markup, /Períodos anteriores/);
  assert.match(markup, /Pago confirmado/);
  assert.doesNotMatch(markup, /Corregir período futuro/);
  const css = readFileSync("src/features/coach-dashboard/commercial/components/coach-commercial-student.module.css", "utf8");
  assert.match(css, /min-height: 44px/);
  assert.match(css, /:focus-visible/);
});

test("an uncertain request offers the same-request retry only after reconciliation found no receipt", () => {
  const noop = () => undefined;
  const render = (retryAllowed: boolean) => renderToStaticMarkup(createElement(CoachCommercialStudent, {
    item: portfolio.items[1], periods: [expired], today: portfolio.serverToday,
    busy: false, uncertain: true, retryAllowed, needsRefresh: false, issue: null,
    onSubmit: noop, onReconcile: noop, onRetry: noop, onReload: noop,
  }));
  assert.match(render(false), /Revisar estado de la operación/);
  assert.doesNotMatch(render(false), /Reintentar solicitud/);
  assert.match(render(true), /Reintentar solicitud/);
  assert.doesNotMatch(render(true), /<form/);
});
