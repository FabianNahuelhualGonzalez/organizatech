import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachDashboardViewModel, CoachMetricView, CoachMonthView } from "./coach-dashboard-view";

// Only CSS module loading is substituted. Components, React rendering, closures,
// escaping, useId and all event props below are the actual production modules.
const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  const names = [...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)];
  module.exports = Object.fromEntries(names.map((match) => [match[1], match[1]]));
};
const { CoachDashboardView } = requireComponent("./coach-dashboard.tsx") as typeof import("./coach-dashboard");
const { CoachWelcome } = requireComponent("./coach-welcome.tsx") as typeof import("./coach-welcome");
const { CoachIncomeCard } = requireComponent("./coach-income-card.tsx") as typeof import("./coach-income-card");
const { CoachPortfolioGrid } = requireComponent("./coach-portfolio-grid.tsx") as typeof import("./coach-portfolio-grid");
const { CoachAlertsCard } = requireComponent("./coach-alerts-card.tsx") as typeof import("./coach-alerts-card");
const { CoachQuickActions } = requireComponent("./coach-quick-actions.tsx") as typeof import("./coach-quick-actions");
const { CoachMonthlyChart } = requireComponent("./coach-monthly-chart.tsx") as typeof import("./coach-monthly-chart");
const { CoachMonthDetail } = requireComponent("./coach-month-detail.tsx") as typeof import("./coach-month-detail");
const { CoachRenewalsCard } = requireComponent("./coach-renewals-card.tsx") as typeof import("./coach-renewals-card");
const { CoachRenewalRow } = requireComponent("./coach-renewal-row.tsx") as typeof import("./coach-renewal-row");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

const metric = (value: number | null, label: string): CoachMetricView => ({ value, label });
const unknown = metric(null, "Sin información");

// Synthetic values are confined to this test; no production default data exists.
function month(id: string, overrides: Partial<CoachMonthView> = {}): CoachMonthView {
  return {
    id, shortLabel: id.toUpperCase(), fullLabel: `Mes de prueba ${id}`,
    ariaLabel: `${id}, diez alumnos de prueba`, students: metric(10, "10"),
    joined: metric(2, "+2"), left: metric(0, "0"), leftTone: "neutral",
    estimatedIncome: metric(250000, "$250.000"), readingLabel: "CRECISTE",
    readingTone: "accent", isBest: false, barRatio: .5, ...overrides,
  };
}

function dashboard(): CoachDashboardViewModel {
  return {
    welcome: { coachName: "Coach de prueba", todayLabel: "Fecha civil ya resuelta" },
    income: {
      amount: metric(250000, "$250.000"), comparisonLabel: "+$50.000 vs. mes anterior",
      comparisonTone: "ok", formulaLabel: "10 alumnos activos × $25.000 al mes",
      atRisk: metric(50000, "−$50.000"), atRiskNote: "2 clientes en alerta",
      potential: metric(300000, "$300.000"), potentialLabel: "SI RENUEVAN TODOS",
      potentialNote: "activos + pendientes",
    },
    portfolio: { totalLabel: "13 en total", active: metric(10, "10"), alert: metric(2, "2"),
      pending: metric(2, "2"), inactive: metric(1, "1"), activeNote: "Vínculos aceptados" },
    alerts: {
      description: "Ciclos por vencer y ausencias largas.", footerLabel: "Ver clientes en alerta",
      emptyLabel: "Sin alertas", rows: [{ id: "alert-one", clientName: "Cliente de prueba",
        initials: "CP", reason: "Su ciclo termina mañana", whenLabel: "1 día",
        dateLabel: "9 sep", tone: "pending" }],
    },
    chart: { months: [month("uno"), month("dos", { isBest: true, barRatio: 1 })],
      selectedMonthId: "uno", emptyLabel: "Aún no hay histórico", noSelectionLabel: "Selecciona un mes" },
    renewals: {
      title: "Renovaciones del mes de prueba", description: "Ciclos que terminan este mes.",
      atStake: metric(25000, "$25.000"), retentionLabel: "Retención provista por el selector",
      emptyLabel: "Sin renovaciones en este período",
      stack: { ariaLabel: "Una renovación, ninguna pendiente ni baja", segments: [
        { state: "renewed", ratio: 1, label: "1 renovó" },
        { state: "pending", ratio: 0, label: "0 sin confirmar" },
        { state: "declined", ratio: 0, label: "0 no siguen" },
      ] },
      rows: [{ id: "renew-one", clientName: "Cliente de prueba", state: "renewed", stateLabel: "Renovado",
        subtitle: "Nuevo ciclo 9 sep – 20 oct", subtitleTone: "neutral", endDateLabel: "8 sep",
        remainingLabel: "hoy", ariaLabel: "Cliente de prueba, renovado, nuevo ciclo 9 sep – 20 oct" }],
    },
  };
}

type InspectedProps = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  [attribute: string]: unknown;
};

function elements(node: ReactNode): ReactElement<InspectedProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<InspectedProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function buttons(node: ReactNode) {
  return elements(node).filter((element) => element.type === "button");
}

function capture<P extends object>(Component: (props: P) => ReactNode, props: P) {
  let tree: ReactNode = null;
  function RenderHarness() {
    // The real component executes during React render so its useId is real.
    tree = Component(props);
    return tree;
  }
  const markup = renderToStaticMarkup(createElement(RenderHarness));
  return { tree, markup };
}

test("dashboard composes approved sections in handoff order without topbar, dialog or forms", () => {
  const { tree, markup } = capture(CoachDashboardView, { view: dashboard(), actions: {} });
  const order = ["Bienvenido", "INGRESO DE ESTE MES", "Tus alumnos", "Requieren tu atención",
    "Accesos rápidos Coach", "Tus asesorías mes a mes", "Renovaciones del mes de prueba"];
  let previousIndex = -1;
  for (const label of order) {
    const index = markup.indexOf(label);
    assert.ok(index > previousIndex, `${label} follows the previous section`);
    previousIndex = index;
  }
  assert.equal(elements(tree).filter((element) => element.type === CoachMonthlyChart).length, 1);
  assert.doesNotMatch(markup, /<main|role="dialog"|<input|Abrir menú|Ver notificaciones|<h1/);
});

test("welcome displays supplied civil-date label unchanged and safely escapes identity", () => {
  const { markup } = capture(CoachWelcome, { view: { coachName: "<script>bad</script>", todayLabel: "Martes 1 de septiembre" } });
  assert.match(markup, /Martes 1 de septiembre/);
  assert.match(markup, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.doesNotMatch(capture(CoachWelcome, { view: { coachName: "Coach", todayLabel: null } }).markup, /class="today"/);
});

test("income preserves mapper labels, distinguishes estimates and does not turn unknown into zero", () => {
  const view = { ...dashboard().income, amount: unknown, comparisonLabel: null, formulaLabel: null,
    atRisk: unknown, potential: unknown, atRiskNote: null, potentialNote: null };
  const { markup } = capture(CoachIncomeCard, { view });
  assert.equal((markup.match(/Sin información/g) ?? []).length, 3);
  assert.equal((markup.match(/data-known="false"/g) ?? []).length, 3);
  assert.match(markup, /Ingresos estimados, no pagos cobrados/);
  assert.doesNotMatch(markup, /\$0|NaN|vs\./);
});

test("income edit callback runs only on the supplied event, never during render", () => {
  let calls = 0;
  const { tree } = capture(CoachIncomeCard, { view: dashboard().income, onEditFee: () => { calls += 1; } });
  assert.equal(calls, 0);
  buttons(tree)[0].props.onClick?.();
  assert.equal(calls, 1);
  const unavailable = buttons(capture(CoachIncomeCard, { view: dashboard().income }).tree)[0];
  assert.equal(unavailable.props.disabled, true);
  assert.equal(unavailable.props.onClick, undefined);
});

test("portfolio renders four distinct filters and forwards each without altering supplied counts", () => {
  const calls: string[] = [];
  const view = { ...dashboard().portfolio, active: metric(0, "0"), alert: unknown };
  const { tree, markup } = capture(CoachPortfolioGrid, { view, onSelect: {
    active: () => calls.push("active"), alert: () => calls.push("alert"),
    pending: () => calls.push("pending"), inactive: () => calls.push("inactive"),
  } });
  assert.match(markup, /data-known="true">0</);
  assert.match(markup, /data-known="false">Sin información</);
  for (const button of buttons(tree)) button.props.onClick?.();
  assert.deepEqual(calls, ["active", "alert", "pending", "inactive"]);
  assert.match(markup, /Vínculos aceptados/);
});

test("alert rows carry stable identities, actual reasons and independent navigation callbacks", () => {
  const calls: string[] = [];
  const { tree, markup } = capture(CoachAlertsCard, {
    view: dashboard().alerts, onAdd: () => calls.push("add"),
    onAlert: (id) => calls.push(id), onViewAlerts: () => calls.push("all"),
  });
  assert.match(markup, /Su ciclo termina mañana/);
  assert.match(markup, /data-alert-id="alert-one"/);
  for (const button of buttons(tree)) button.props.onClick?.();
  assert.deepEqual(calls, ["add", "alert-one", "all"]);
});

test("empty alerts render supplied empty content, not example people or payment claims", () => {
  const { markup } = capture(CoachAlertsCard, { view: { description: "Estado informado", rows: [], emptyLabel: "No hay alertas", footerLabel: null } });
  assert.match(markup, /No hay alertas/);
  assert.doesNotMatch(markup, /Cliente de prueba|Pago pendiente|data-alert-id/);
});

test("quick actions without a handler do not pretend to navigate or open a chat", () => {
  const { tree, markup } = capture(CoachQuickActions, {});
  assert.equal(buttons(tree).length, 3);
  for (const button of buttons(tree)) {
    assert.equal(button.props.disabled, true);
    assert.equal(button.props.onClick, undefined);
  }
  assert.match(markup, /PRONTO/);
  const calls: string[] = [];
  const live = capture(CoachQuickActions, { onCalendar: () => calls.push("calendar"), onLink: () => calls.push("link"), onChat: () => calls.push("coming-soon") });
  for (const button of buttons(live.tree)) button.props.onClick?.();
  assert.deepEqual(calls, ["calendar", "link", "coming-soon"]);
});

test("chart selection is controlled and clicking preserves identity without mutating the month", () => {
  const ids: string[] = [];
  const view = dashboard().chart;
  const { tree, markup } = capture(CoachMonthlyChart, { view, onSelectMonth: (id) => ids.push(id) });
  const controls = buttons(tree);
  assert.deepEqual(controls.map((control) => control.props["aria-pressed"]), [true, false]);
  assert.equal(ids.length, 0);
  controls[1].props.onClick?.();
  assert.deepEqual(ids, ["dos"]);
  assert.equal(view.selectedMonthId, "uno");
  assert.match(markup, /aria-live="polite"/);
  const selected = capture(CoachMonthlyChart, { view: { ...view, selectedMonthId: "dos" } }).markup;
  assert.match(selected, /data-month-id="dos"[^>]+aria-pressed="true"/);
  assert.match(selected, /<h4>Mes de prueba dos<\/h4>/);
});

test("unknown months keep a selectable label but no bar, fictitious zero or automatic default", () => {
  const view = { ...dashboard().chart, selectedMonthId: "missing", months: [month("unknown", { students: unknown, barRatio: 1 })] };
  const { markup } = capture(CoachMonthlyChart, { view });
  assert.match(markup, /Sin información/);
  assert.match(markup, /Selecciona un mes/);
  assert.doesNotMatch(markup, /class="bar"|<h4>|aria-pressed="true"/);
});

test("empty historical data uses provided unavailable text without made-up history", () => {
  const { markup } = capture(CoachMonthlyChart, { view: { months: [], selectedMonthId: null, emptyLabel: "Histórico no disponible", noSelectionLabel: null } });
  assert.match(markup, /Histórico no disponible/);
  assert.doesNotMatch(markup, /data-month-id|<h4>|\$0/);
});

test("month details preserve zero losses without prefixing a negative sign", () => {
  const { markup } = capture(CoachMonthDetail, { month: month("one", { left: metric(0, "0") }) });
  assert.match(markup, />0<\/dd>/);
  assert.doesNotMatch(markup, /−0|-0/);
  assert.match(markup, /Ingreso estimado del mes/);
});

test("renewal amounts and dates are not recomputed from supplied row count or current clock", () => {
  const view = { ...dashboard().renewals, atStake: metric(777, "$777 provistos"), retentionLabel: null };
  const { markup } = capture(CoachRenewalsCard, { view });
  assert.match(markup, /\$777 provistos/);
  assert.match(markup, /Nuevo ciclo 9 sep – 20 oct/);
  assert.match(markup, /1 renovó/);
  assert.doesNotMatch(markup, /0 no siguen|Retención|promedio|\$25.000/);
});

test("renewal callbacks use stable row IDs and unavailable actions are inert", () => {
  const ids: string[] = [];
  const row = dashboard().renewals.rows[0];
  const { tree, markup } = capture(CoachRenewalRow, { row, onSelect: (id) => ids.push(id) });
  assert.match(markup, /data-renewal-id="renew-one"/);
  assert.match(markup, /aria-label="Cliente de prueba, renovado/);
  buttons(tree)[0].props.onClick?.();
  assert.deepEqual(ids, ["renew-one"]);
  assert.equal(buttons(capture(CoachRenewalRow, { row }).tree)[0].props.disabled, true);
});

test("unknown renewal distribution draws no invented segments and retains unavailable money", () => {
  const { markup } = capture(CoachRenewalsCard, { view: {
    ...dashboard().renewals, atStake: unknown, stack: null, rows: [], retentionLabel: null,
  } });
  assert.match(markup, /Sin información/);
  assert.match(markup, /Sin renovaciones en este período/);
  assert.doesNotMatch(markup, /role="img"|class="segment"|\$0/);
});

test("the composed alert footer forwards only the explicit alert portfolio intent", () => {
  const calls: string[] = [];
  const { tree } = capture(CoachDashboardView, { view: dashboard(), actions: { onPortfolio: { alert: () => calls.push("alert") } } });
  const alert = elements(tree).find((element) => element.type === CoachAlertsCard);
  assert.ok(alert);
  (alert.props.onViewAlerts as () => void)();
  assert.deepEqual(calls, ["alert"]);
});

test("each portfolio destination is enabled independently, without inferring alert navigation", () => {
  const calls: string[] = [];
  const onPortfolio = { active: () => calls.push("active"), pending: () => calls.push("pending"), inactive: () => calls.push("inactive") };
  const { tree, markup } = capture(CoachPortfolioGrid, { view: { ...dashboard().portfolio, alert: unknown }, onSelect: onPortfolio });
  const controls = buttons(tree);
  assert.deepEqual(controls.map((control) => control.props.disabled), [false, true, false, false]);
  assert.equal(controls[1].props.onClick, undefined);
  assert.match(markup, /data-known="false">Sin información</);
  for (const button of controls) button.props.onClick?.();
  assert.deepEqual(calls, ["active", "pending", "inactive"]);
  const composed = capture(CoachDashboardView, { view: dashboard(), actions: { onPortfolio } });
  assert.equal(elements(composed.tree).find((element) => element.type === CoachAlertsCard)?.props.onViewAlerts, undefined);
});

test("zero-only renewal distribution has no image or invented segments while keeping informative legend", () => {
  const { markup } = capture(CoachRenewalsCard, { view: { ...dashboard().renewals, stack: {
    ariaLabel: "Sin renovaciones", segments: [
      { state: "renewed", ratio: 0, label: "0 renovaron" },
      { state: "pending", ratio: 0, label: "0 pendientes" },
      { state: "declined", ratio: 0, label: "0 no siguen" },
    ],
  } } });
  assert.doesNotMatch(markup, /role="img"|class="segment"|flex-grow/);
  assert.match(markup, /0 renovaron/); assert.match(markup, /0 pendientes/);
});

test("mixed renewal distribution draws only positive ratios with their actual supplied geometry", () => {
  const { markup } = capture(CoachRenewalsCard, { view: { ...dashboard().renewals, stack: {
    ariaLabel: "Distribución provista", segments: [
      { state: "renewed", ratio: .75, label: "3 renovaron" },
      { state: "pending", ratio: 0, label: "0 pendientes" },
      { state: "declined", ratio: .25, label: "1 no sigue" },
    ],
  } } });
  assert.equal((markup.match(/class="segment"/g) ?? []).length, 2);
  assert.match(markup, /flex-grow:0\.75/); assert.match(markup, /flex-grow:0\.25/);
  assert.doesNotMatch(markup, /class="segment" data-state="pending"|flex-grow:0\.001/);
});

test("null renewal ratios do not imply zero or create a chart; null plus positive draws only the positive", () => {
  const stack = { ariaLabel: "Distribución desconocida", segments: [{ state: "renewed" as const, ratio: null, label: "Sin información" }] };
  const allUnknown = capture(CoachRenewalsCard, { view: { ...dashboard().renewals, stack } }).markup;
  assert.match(allUnknown, /Sin información/); assert.doesNotMatch(allUnknown, /role="img"|class="segment"/);
  const mixed = capture(CoachRenewalsCard, { view: { ...dashboard().renewals, stack: { ...stack,
    segments: [...stack.segments, { state: "pending", ratio: 1, label: "Pendientes conocidos" }],
  } } }).markup;
  assert.equal((mixed.match(/class="segment"/g) ?? []).length, 1);
  assert.match(mixed, /class="segment" data-state="pending"/);
});

test("independent cards use distinct title IDs in a composed dashboard", () => {
  const markup = renderToStaticMarkup(createElement(CoachDashboardView, { view: dashboard(), actions: {} }));
  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of markup.matchAll(/aria-labelledby="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
});
