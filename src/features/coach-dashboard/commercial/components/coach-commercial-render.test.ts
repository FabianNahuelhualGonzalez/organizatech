import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachCommercialPortfolio } from "../../model/coach-commercial-portfolio";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)]
    .map((match) => [match[1], match[1]]));
};
const { CoachCommercialDashboard } = requireComponent("./coach-commercial-dashboard.tsx") as typeof import("./coach-commercial-dashboard");
const { CoachCommercialStudent } = requireComponent("./coach-commercial-student.tsx") as typeof import("./coach-commercial-student");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

const noop = () => undefined;
const item: CoachCommercialPortfolio["items"][number] = {
  episodeId: "episode", studentName: "Alumno real", linkedAt: "2026-10-01T12:00:00Z", unlinkedAt: null,
  agreementStart: "2026-10-05", agreementEnd: null, status: "active", version: "version",
  latestPeriod: { id: "current", episodeId: "episode", startsOn: "2026-10-05", endsBefore: "2026-11-05",
    amountClp: 45000, frequency: "monthly", paidAt: null },
};
const portfolio: CoachCommercialPortfolio = {
  serverToday: "2026-10-05", currentMonth: "2026-10", activeCount: 1, unlinkedCount: 0,
  items: [item], periods: [item.latestPeriod!],
  months: [{ month: "2026-10", estimatedClp: 45000, confirmedPaymentsClp: 0,
    periodCount: 1, students: 1, joined: 1, left: 0 }],
};

function dashboard(data: CoachCommercialPortfolio | null, phase: "loading" | "ready" | "error" = "ready") {
  return renderToStaticMarkup(createElement(CoachCommercialDashboard, {
    coachName: "Coach", portfolio: data, phase, issue: null, busy: false, uncertain: false,
    onReload: noop, onSubmit: noop, onReconcile: noop, onLink: noop, onClients: noop,
    onCalendar: noop, onChat: noop, pendingInvitations: 1,
  }));
}

test("dashboard uses only commercial facts and keeps invitations separate", () => {
  const markup = dashboard(portfolio);
  assert.match(markup, /Ingreso estimado/);
  assert.match(markup, /45\.000 CLP/);
  assert.match(markup, /Pagos confirmados/);
  assert.match(markup, /0 CLP/);
  assert.match(markup, /45\.000 CLP · Mensual/);
  assert.match(markup, /1 vínculos activos/);
  assert.match(markup, /1 invitaciones pendientes/);
  assert.doesNotMatch(markup, /activos × tarifa|Ingresos estimados, no pagos cobrados/);
});

test("empty and failed reads do not invent amounts, alerts, renewals or months", () => {
  const empty = dashboard({ ...portfolio, activeCount: 0, items: [], periods: [], months: [] });
  assert.match(empty, /Sin períodos comerciales iniciados este mes/);
  assert.match(empty, /No hay alertas comerciales registradas/);
  assert.match(empty, /Aún no hay meses históricos/);
  assert.match(empty, /Aún no hay renovaciones registradas/);
  const error = dashboard(null, "error");
  assert.match(error, /No pudimos cargar la información comercial/);
  assert.doesNotMatch(error, /0 CLP|45\.000 CLP/);
});

test("calendar-year comparison appears only with real commercial facts in two years", () => {
  const oneYear = dashboard(portfolio);
  assert.doesNotMatch(oneYear, /Comparación 2026 vs/);
  const twoYears = dashboard({ ...portfolio, months: [
    ...portfolio.months,
    { month: "2025-12", estimatedClp: 20000, confirmedPaymentsClp: 15000,
      periodCount: 1, students: 1, joined: 0, left: 0 },
  ] });
  assert.match(twoYears, /Comparación 2026 vs 2025/);
  assert.match(twoYears, /25\.000 CLP/);
  assert.match(twoYears, /pagos confirmados -15\.000 CLP/);
});

test("student shows CLP, indefinite agreement, payment and read-only history", () => {
  const previous = { ...item.latestPeriod!, id: "old", startsOn: "2026-09-05", endsBefore: "2026-10-05", paidAt: "2026-09-05T13:00:00Z" };
  const markup = renderToStaticMarkup(createElement(CoachCommercialStudent, {
    item, periods: [item.latestPeriod!, previous], today: portfolio.serverToday, busy: false,
    uncertain: false, issue: null, onSubmit: noop, onReconcile: noop,
  }));
  assert.match(markup, /Monto/); assert.match(markup, /45\.000 CLP/);
  assert.match(markup, /Indefinida/); assert.match(markup, /Confirmar pago/);
  assert.match(markup, /Períodos anteriores/); assert.match(markup, /Pago confirmado/);
  assert.doesNotMatch(markup, /Corregir período futuro/);
});

test("only an unpaid future latest period exposes correction; paid and started periods stay immutable", () => {
  const future = { ...item, latestPeriod: { ...item.latestPeriod!, startsOn: "2026-10-12", endsBefore: "2026-11-12" } };
  const render = (candidate: typeof item) => renderToStaticMarkup(createElement(CoachCommercialStudent, {
    item: candidate, periods: candidate.latestPeriod ? [candidate.latestPeriod] : [], today: portfolio.serverToday,
    busy: false, uncertain: false, issue: null, onSubmit: noop, onReconcile: noop,
  }));
  assert.match(render(future), /Corregir período futuro/);
  assert.doesNotMatch(render({ ...future, latestPeriod: { ...future.latestPeriod, paidAt: "2026-10-05T13:00:00Z" } }), /Corregir período futuro/);
  assert.doesNotMatch(render(item), /Corregir período futuro/);
  assert.match(render({ ...item, status: "needs_agreement", latestPeriod: null, version: null }), /Configurar acuerdo inicial/);
  const expired = { ...item, status: "pending_renewal" as const,
    latestPeriod: { ...item.latestPeriod!, endsBefore: "2026-10-01" } };
  assert.match(render(expired), /Renovar/);
  assert.match(render(expired), /type="date" min="2026-10-05" required="" value="2026-10-05"/);
});

test("commercial controls meet touch and focus requirements and use product canvas", () => {
  const css = readFileSync("src/features/coach-dashboard/commercial/components/coach-commercial.module.css", "utf8");
  assert.match(css, /background: var\(--background\)/);
  assert.match(css, /\.action, \.buttons button \{[^}]*min-height: 44px/);
  assert.match(css, /\.months button \{[^}]*min-height: 44px/);
  assert.match(css, /:focus-visible/);
});
