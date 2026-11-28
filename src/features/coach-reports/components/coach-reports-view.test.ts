import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachReportsState } from "../hooks/use-coach-reports";
import type { CoachReportItem } from "../data/coach-reports-repository";

const localRequire = createRequire(import.meta.url);
const previous = localRequire.extensions[".css"];
localRequire.extensions[".css"] = (module, file) => {
  const names = [...readFileSync(file, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)];
  module.exports = Object.fromEntries(names.map((m) => [m[1], m[1]]));
};
const { CoachReportsView } = localRequire("./coach-reports-view.tsx") as typeof import("./coach-reports-view");
if (previous) localRequire.extensions[".css"] = previous;
else delete localRequire.extensions[".css"];

const id = "10000000-0000-4000-8000-000000000001";
const episodeId = "10000000-0000-4000-8000-000000000002";
const studentUserId = "10000000-0000-4000-8000-000000000003";
function state(detail = false): CoachReportsState {
  return { phase: "ready", detailPhase: "ready", issue: null, saving: false, previous: null,
    pendingCount: 1, reviewedCount: 0, hasMore: false, loadingMore: false, nextOffset: 1,
    reports: [{ id, episodeId, studentUserId, studentName: "Fabian Nahuelhual prueba",
      kind: "photos", sentAt: "2026-10-08T12:00:00.000Z", reviewedAt: null, itemCount: 0 }],
    detail: detail ? { id, episodeId, studentName: "Fabian Nahuelhual prueba", kind: "photos",
      sentAt: "2026-10-08T12:00:00.000Z", reviewedAt: null, message: null, items: [] } : null,
  };
}
const props = { onBack: () => {}, onCloseDetail: () => {}, onRetry: () => {}, onOpen: () => {},
  onReview: async () => true, onFilter: () => {}, onLoadMore: () => {}, onStudentRecord: () => {},
  onDownload: async (_item: CoachReportItem) => new Blob([]) };
test("la bandeja separa nombre y tipo y presenta filtros y ausencia de adjuntos", () => {
  const html = renderToStaticMarkup(createElement(CoachReportsView, { ...props, state: state() }));
  assert.match(html, /Pendientes/);
  assert.match(html, /Buscar alumno/);
  assert.match(html, /Fabian Nahuelhual prueba<\/span>/);
  assert.match(html, /Fotos de progreso · <span class="zero">Sin archivos/);
  assert.doesNotMatch(html, /pruebaFotos de progreso/);
});
test("el detalle requiere revisión explícita y conserva el mensaje vacío", () => {
  const html = renderToStaticMarkup(createElement(CoachReportsView, { ...props, state: state(true) }));
  assert.match(html, /No dejó mensaje/);
  assert.match(html, /Marcar como revisado/);
  assert.match(html, /Ver ficha del alumno/);
  assert.match(html, /sin archivos adjuntos/);
});
