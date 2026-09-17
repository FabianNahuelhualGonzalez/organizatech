import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachClientRowView, CoachClientsViewModel, CoachClientsEmptyView } from "./coach-clients-view";

// Real React/components; only CSS module file loading is substituted for Node.
const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  const names = [...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)];
  module.exports = Object.fromEntries(names.map((match) => [match[1], match[1]]));
};
const { CoachClientsView } = requireComponent("./coach-clients.tsx") as typeof import("./coach-clients");
const { CoachClientsHeader } = requireComponent("./coach-clients-header.tsx") as typeof import("./coach-clients-header");
const { CoachClientsSearch } = requireComponent("./coach-clients-search.tsx") as typeof import("./coach-clients-search");
const { CoachClientsTabs } = requireComponent("./coach-clients-tabs.tsx") as typeof import("./coach-clients-tabs");
const { CoachClientRow } = requireComponent("./coach-client-row.tsx") as typeof import("./coach-client-row");
const { CoachClientsEmpty } = requireComponent("./coach-clients-empty.tsx") as typeof import("./coach-clients-empty");
const { CoachClientsList } = requireComponent("./coach-clients-list.tsx") as typeof import("./coach-clients-list");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

type EventProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
  ref?: ((node: unknown) => void) | RefObject<unknown>;
  disabled?: boolean;
  [key: string]: unknown;
};
function elements(node: ReactNode): ReactElement<EventProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<EventProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function buttons(node: ReactNode) { return elements(node).filter((element) => element.type === "button"); }
function capture<P extends object>(Component: (props: P) => ReactNode, props: P) {
  let tree: ReactNode = null;
  function Harness() { tree = Component(props); return tree; }
  return { markup: renderToStaticMarkup(createElement(Harness)), tree };
}

// Synthetic fixture data; not exported or present in productive components.
const counts = { active: { value: 2, label: "2" }, pending: { value: null, label: "—" }, inactive: { value: 0, label: "0" } };
const active: CoachClientRowView = { id: "accepted-one", state: "active", name: "Persona de prueba", initials: "PP",
  email: "accepted@example.test", metaLabel: "2/8 sesiones", progressRatio: .25 };
const pending: CoachClientRowView = { id: "invitation-one", state: "pending", email: "invited@example.test", metaLabel: "Enviado hace 1 día" };
const inactive: CoachClientRowView = { id: "former-one", state: "inactive", name: null, initials: null,
  email: "former@example.test", metaLabel: "Hasta fecha civil provista" };
function clients(): CoachClientsViewModel {
  return { selectedTab: "active", query: "", counts, content: {
    kind: "rows", rows: [active], resultLabel: "1 cliente", canLoadMore: false, isLoadingMore: false,
  } };
}

test("list composes only section header, search, tabs and supplied clients in approved order", () => {
  const { markup } = capture(CoachClientsView, { view: clients(), actions: {} });
  const labels = ["Tus clientes", "Buscar cliente", "Estado de clientes", "1 cliente", "Persona de prueba"];
  for (let index = 1; index < labels.length; index++) assert.ok(markup.indexOf(labels[index]) > markup.indexOf(labels[index - 1]));
  assert.match(markup, /data-coach-clients="productive"/);
  assert.doesNotMatch(markup, /role="dialog"|<main|<h1|Abrir menú|Notificaciones|Desvincular|Volver a vincular|<form/);
});

test("header only renders the existing canonical back button when a real destination exists", () => {
  let back = 0; let add = 0;
  const hidden = capture(CoachClientsHeader, { titleId: "test-title" });
  assert.doesNotMatch(hidden.markup, /aria-label="Volver"/);
  assert.equal(buttons(hidden.tree)[0].props.disabled, true);
  const ready = capture(CoachClientsHeader, { titleId: "test-title", onBack: () => { back++; }, onLink: () => { add++; } });
  assert.match(ready.markup, /M5 12h6m3 0h1\.5m3 0h\.5/);
  assert.equal(back, 0); assert.equal(add, 0);
  const backComponent = elements(ready.tree).find((element) => typeof element.props.onBack === "function");
  (backComponent?.props.onBack as (() => void))();
  buttons(ready.tree)[0].props.onClick?.();
  assert.equal(back, 1); assert.equal(add, 1);
});

test("search forwards the exact input value without trimming, filtering or losing focus when cleared", () => {
  const calls: string[] = []; let focused = 0;
  const inputRef = { current: { focus: () => { focused++; } } } as RefObject<HTMLInputElement>;
  const { tree } = capture(CoachClientsSearch, { query: "a", inputRef, onQueryChange: (value) => calls.push(value) });
  const input = elements(tree).find((element) => element.type === "input")!;
  input.props.onChange?.({ currentTarget: { value: "  Nombre@EXAMPLE.test  " } });
  buttons(tree)[0].props.onClick?.();
  assert.deepEqual(calls, ["  Nombre@EXAMPLE.test  ", ""]);
  assert.equal(focused, 1);
  assert.equal(input.props.value, "a", "controlled value changes only through new props");
});

test("unavailable search is read-only and cannot pretend to clear; empty query has no clear button", () => {
  const inputRef = { current: null };
  const unavailable = capture(CoachClientsSearch, { query: "kept", inputRef });
  const input = elements(unavailable.tree).find((element) => element.type === "input")!;
  assert.equal(input.props.readOnly, true); assert.equal(input.props.onChange, undefined);
  assert.equal(buttons(unavailable.tree)[0].props.disabled, true);
  assert.equal(buttons(unavailable.tree)[0].props.onClick, undefined);
  assert.equal(buttons(capture(CoachClientsSearch, { query: "", inputRef }).tree).length, 0);
});

test("tab counts are supplied independently of rows and preserve unknown versus known zero", () => {
  const { markup, tree } = capture(CoachClientsTabs, { selectedTab: "pending", counts, idPrefix: "test-tabs", panelId: "test-panel" });
  assert.match(markup, /data-known="false">—</); assert.match(markup, /data-known="true">0</);
  assert.deepEqual(buttons(tree).map((button) => button.props["aria-selected"]), [false, true, false]);
  assert.deepEqual(buttons(tree).map((button) => button.props.tabIndex), [-1, 0, -1]);
  assert.ok(buttons(tree).every((button) => button.props.disabled && !button.props.onClick && !button.props.onKeyDown));
});

test("tabs forward clicks and arrow/Home/End keyboard events to the controller and restore visual focus", () => {
  const calls: string[] = []; const focus: string[] = []; let prevented = 0;
  const { tree } = capture(CoachClientsTabs, { selectedTab: "active", counts, idPrefix: "tabs", panelId: "panel", onSelectTab: (tab) => calls.push(tab) });
  const controls = buttons(tree);
  for (const control of controls) {
    const ref = control.props.ref;
    if (typeof ref === "function") ref({ focus: () => focus.push(control.props["data-state"] as string) });
  }
  controls[1].props.onClick?.();
  controls[0].props.onKeyDown?.({ key: "ArrowLeft", preventDefault: () => { prevented++; } });
  controls[2].props.onKeyDown?.({ key: "Home", preventDefault: () => { prevented++; } });
  controls[0].props.onKeyDown?.({ key: "Enter", preventDefault: () => { prevented++; } });
  assert.deepEqual(calls, ["pending", "inactive", "active"]);
  assert.deepEqual(focus, ["inactive", "active"]); assert.equal(prevented, 2);
});

test("pending rows use only email identity even when untyped input includes a student's private name", () => {
  const untyped = { ...pending, name: "PRIVATE_NAME", initials: "PRIVATE_INITIALS", progressRatio: .9 } as unknown as CoachClientRowView;
  const { markup } = capture(CoachClientRow, { view: untyped });
  assert.match(markup, /invited@example\.test/); assert.match(markup, /PENDIENTE/);
  assert.match(markup, /data-striped="true"/);
  assert.doesNotMatch(markup, /PRIVATE_NAME|PRIVATE_INITIALS|90%|role="progressbar"|aria-valuenow/);
});

test("active link without a cycle stays active and does not invent session counts or a progress bar", () => {
  const { markup } = capture(CoachClientRow, { view: { ...active, name: null, initials: null, metaLabel: null, progressRatio: null } });
  assert.match(markup, /ACTIVO/); assert.match(markup, /accepted@example\.test/);
  assert.match(markup, /data-known="false"/);
  assert.doesNotMatch(markup, /0\/0|sesiones|style="width:|PENDIENTE|BAJA/);
});

test("active progress is drawing-only; row identity is stable and no callback fires while rendering", () => {
  const ids: string[] = [];
  const { markup, tree } = capture(CoachClientRow, { view: active, onOpen: (id) => ids.push(id) });
  assert.match(markup, /style="width:25%"/); assert.match(markup, /2\/8 sesiones/);
  assert.equal(ids.length, 0); buttons(tree)[0].props.onClick?.();
  assert.deepEqual(ids, ["accepted-one"]);
  assert.equal(buttons(capture(CoachClientRow, { view: active }).tree)[0].props.disabled, true);
});

test("invalid or absent progress never produces NaN or an invented fraction", () => {
  for (const progressRatio of [null, NaN, Infinity]) {
    const { markup } = capture(CoachClientRow, { view: { ...active, progressRatio } });
    assert.doesNotMatch(markup, /style="width:|NaN|Infinity/);
  }
  assert.match(capture(CoachClientRow, { view: { ...active, progressRatio: 0 } }).markup, /width:0%/);
});

test("inactive row displays supplied civil-date label and no cycle or relink mutation button", () => {
  const { markup } = capture(CoachClientRow, { view: inactive });
  assert.match(markup, /Hasta fecha civil provista/); assert.match(markup, /BAJA/);
  assert.doesNotMatch(markup, /width:|Volver a vincular|sesiones/);
});

test("four handoff empty states render distinct copy and route only their explicit callback", () => {
  const variants: CoachClientsEmptyView[] = [{ kind: "active" }, { kind: "pending" }, { kind: "inactive" }, { kind: "search", queryLabel: "<script>" }];
  const titles = ["Todavía no tienes clientes activos", "No hay solicitudes pendientes", "No has desvinculado a nadie", "Sin resultados para «&lt;script&gt;»"];
  const calls: string[] = [];
  variants.forEach((view, index) => {
    const { markup, tree } = capture(CoachClientsEmpty, { view, onLink: () => calls.push("link"), onShowActive: () => calls.push("active"), onClearSearch: () => calls.push("clear") });
    assert.ok(markup.includes(titles[index])); assert.doesNotMatch(markup, /<script>/);
    buttons(tree)[0].props.onClick?.();
    assert.equal(buttons(capture(CoachClientsEmpty, { view }).tree)[0].props.disabled, true);
  });
  assert.deepEqual(calls, ["link", "link", "active", "clear"]);
});

test("controller-supplied loading/error message cannot be mistaken for an empty portfolio", () => {
  for (const tone of ["polite", "error"] as const) {
    const { markup } = capture(CoachClientsList, { content: { kind: "message", tone, label: "Mensaje existente provisto" }, panelId: "panel", tabId: "tab" });
    assert.match(markup, tone === "error" ? /role="alert"/ : /role="status"/);
    assert.doesNotMatch(markup, /Todavía no tienes|No hay solicitudes|data-client=/);
  }
});

test("view passes filtered rows and result labels unchanged and connects tabs to the corresponding panel", () => {
  const view: CoachClientsViewModel = { ...clients(), query: "Not filtered by this view", content: {
    kind: "rows", rows: [active], resultLabel: "Etiqueta resuelta por dominio", canLoadMore: false, isLoadingMore: false,
  } };
  const { markup, tree } = capture(CoachClientsView, { view, actions: {} });
  assert.match(markup, /Persona de prueba/); assert.match(markup, /Etiqueta resuelta por dominio/);
  const tabs = elements(tree).find((element) => element.type === CoachClientsTabs)!;
  const list = elements(tree).find((element) => element.type === CoachClientsList)!;
  assert.equal(tabs.props.panelId, list.props.panelId);
  assert.equal(list.props.tabId, `${tabs.props.idPrefix}-active`);
  assert.equal(elements(tree).find((element) => element.type === CoachClientsSearch)?.props.onQueryChange, undefined);
});

test("paginación controlada sólo carga otra página cuando existe capacidad", () => {
  let loads = 0;
  const view: CoachClientsViewModel = { ...clients(), content: {
    kind: "rows", rows: [active], resultLabel: "1 de 2", canLoadMore: true, isLoadingMore: false,
  } };
  const readyView = capture(CoachClientsView, { view, actions: { onLoadMore: () => { loads++; } } });
  const readyList = elements(readyView.tree).find((element) => element.type === CoachClientsList)!;
  const ready = capture(CoachClientsList, readyList.props as unknown as Parameters<typeof CoachClientsList>[0]);
  const load = buttons(ready.tree).find((button) => button.props.children === "Cargar más")!;
  assert.equal(load.props.disabled, false);
  load.props.onClick?.();
  assert.equal(loads, 1);

  const busyView = capture(CoachClientsView, { view: { ...view, content: { ...view.content, canLoadMore: false, isLoadingMore: true } }, actions: { onLoadMore: () => assert.fail("busy") } });
  const busyList = elements(busyView.tree).find((element) => element.type === CoachClientsList)!;
  const busy = capture(CoachClientsList, busyList.props as unknown as Parameters<typeof CoachClientsList>[0]);
  const loading = buttons(busy.tree).find((button) => button.props.children === "Cargando…")!;
  assert.equal(loading.props.disabled, true);
  assert.equal(loading.props.onClick, undefined);
});

test("empty-search action clears the controller and focuses the existing input ref without accessing storage", () => {
  const calls: string[] = []; let focused = 0;
  const { tree } = capture(CoachClientsView, { view: clients(), actions: { onQueryChange: (query) => calls.push(query) } });
  const search = elements(tree).find((element) => element.type === CoachClientsSearch)!;
  const list = elements(tree).find((element) => element.type === CoachClientsList)!;
  (search.props.inputRef as { current: unknown }).current = { focus: () => { focused++; } };
  (list.props.onClearSearch as () => void)();
  assert.deepEqual(calls, [""]); assert.equal(focused, 1);
});
