import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachFeeSheetView, CoachChatComingSoonView } from "./coach-dashboard-sheet-view";
import { COACH_FEE_PRESETS } from "./coach-fee-presets";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]));
};
const { CoachFeeSheet } = requireComponent("./coach-fee-sheet.tsx") as typeof import("./coach-fee-sheet");
const { CoachChatComingSoonSheet } = requireComponent("./coach-chat-coming-soon-sheet.tsx") as typeof import("./coach-chat-coming-soon-sheet");
const { CoachDashboardSheet } = requireComponent("./coach-dashboard-sheet.tsx") as typeof import("./coach-dashboard-sheet");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

type Props = { children?: ReactNode; footer?: ReactNode; onClick?: () => void;
  onChange?: (event: { currentTarget: { value: string } }) => void; [key: string]: unknown };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children), ...elements(node.props.footer)];
}
function buttons(node: ReactNode) { return elements(node).filter((element) => element.type === "button"); }
function capture<P extends object>(Component: (props: P) => ReactNode, props: P) {
  let tree: ReactNode = null;
  function Harness() { tree = Component(props); return tree; }
  return { markup: renderToStaticMarkup(createElement(Harness)), tree };
}
const backgroundRef = { current: null };
const restoreFocusRef = { current: null };
const focus = { backgroundRef, restoreFocusRef };
const unknown = { value: null, label: "Sin información" };
function fee(): CoachFeeSheetView {
  return { isOpen: true, isBusy: false, feeRaw: "35000", selectedPreset: "35000", canSave: true, isInvalid: false, message: null,
    preview: [
      { label: "Alumnos activos de prueba", amount: { value: 123, label: "$123 provistos" } },
      { label: "En riesgo de prueba", amount: unknown },
      { label: "Potencial de prueba", amount: { value: 0, label: "$0" } },
    ] };
}
function chat(): CoachChatComingSoonView { return { isOpen: true, isBusy: false, isRegistered: false, message: null }; }

test("closed sheets render no dialog, controls or hidden actionable fragments", () => {
  assert.equal(capture(CoachFeeSheet, { ...focus, view: { ...fee(), isOpen: false } }).markup, "");
  assert.equal(capture(CoachChatComingSoonSheet, { ...focus, view: { ...chat(), isOpen: false } }).markup, "");
});

test("fee matches approved private-Coach copy, exact presets and three supplied scenarios", () => {
  const { markup } = capture(CoachFeeSheet, { ...focus, view: fee() });
  for (const copy of ["Tu tarifa mensual", "Sólo la ves tú", "Cobro por alumno al mes", "CLP / mes", "ASÍ QUEDA TU MES", "Guardar tarifa"]) assert.ok(markup.includes(copy));
  assert.deepEqual(COACH_FEE_PRESETS, [{ id: "25000", label: "$25.000" }, { id: "35000", label: "$35.000" }, { id: "50000", label: "$50.000" }]);
  assert.equal((markup.match(/data-scenario=/g) ?? []).length, 3);
  assert.match(markup, /\$123 provistos/); assert.match(markup, /data-known="false">Sin información</);
  assert.match(markup, /data-known="true">\$0</);
});

test("raw input is forwarded unchanged; presets are events not local recalculations", () => {
  const raw: string[] = []; const presets: string[] = [];
  const { tree } = capture(CoachFeeSheet, { ...focus, view: fee(), onRawChange: (value) => raw.push(value), onPreset: (value) => presets.push(value) });
  const input = elements(tree).find((element) => element.type === "input")!;
  input.props.onChange?.({ currentTarget: { value: " 35.000 abc " } });
  assert.deepEqual(raw, [" 35.000 abc "]); assert.equal(input.props.value, "35000");
  for (const button of buttons(tree).filter((button) => button.props["data-fee"])) button.props.onClick?.();
  assert.deepEqual(presets, ["25000", "35000", "50000"]);
  assert.equal(input.props.inputMode, "numeric");
});

test("empty/null raw fee cannot save zero even if a mistaken capability is supplied", () => {
  for (const feeRaw of [null, "", "   "]) {
    let calls = 0;
    const { tree } = capture(CoachFeeSheet, { ...focus, view: { ...fee(), feeRaw }, onSave: () => { calls++; } });
    const save = buttons(tree).find((button) => button.props.children === "Guardar tarifa")!;
    assert.equal(save.props.disabled, true); assert.equal(save.props.onClick, undefined); assert.equal(calls, 0);
  }
});

test("saving and cancellation are distinct explicit capabilities; clicking save never cancels", () => {
  const calls: string[] = [];
  const { tree } = capture(CoachFeeSheet, { ...focus, view: fee(), onSave: () => calls.push("save"), onCancel: () => calls.push("cancel") });
  assert.equal(calls.length, 0);
  buttons(tree).find((button) => button.props.children === "Guardar tarifa")?.props.onClick?.();
  assert.deepEqual(calls, ["save"]);
  buttons(tree).find((button) => button.props["aria-label"] === "Cerrar")?.props.onClick?.();
  assert.deepEqual(calls, ["save", "cancel"]);
  const blocked = capture(CoachFeeSheet, { ...focus, view: { ...fee(), canSave: false }, onSave: () => calls.push("unexpected") });
  assert.equal(buttons(blocked.tree).find((button) => button.props.children === "Guardar tarifa")?.props.disabled, true);
});

test("busy fee disables input/presets/save/cancel and installs no action handlers", () => {
  let calls = 0;
  const { tree, markup } = capture(CoachFeeSheet, { ...focus, view: { ...fee(), isBusy: true },
    onSave: () => { calls++; }, onCancel: () => { calls++; }, onPreset: () => { calls++; }, onRawChange: () => { calls++; } });
  for (const button of buttons(tree)) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); }
  const input = elements(tree).find((element) => element.type === "input")!;
  assert.equal(input.props.disabled, true); assert.equal(input.props.onChange, undefined);
  assert.match(markup, /aria-busy="true"/); assert.equal(calls, 0);
});

test("missing callbacks disable every fee action, not fake successful transitions", () => {
  const { tree } = capture(CoachFeeSheet, { ...focus, view: fee() });
  for (const button of buttons(tree)) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); }
});

test("fee controller errors stay visible with raw draft and without fabricated success", () => {
  const { markup } = capture(CoachFeeSheet, { ...focus, view: { ...fee(), message: { tone: "error", label: "Mensaje existente de fallo" } } });
  assert.match(markup, /role="alert">Mensaje existente de fallo/);
  assert.match(markup, /value="35000"/); assert.doesNotMatch(markup, /aria-invalid="true"/);
});

test("field validation is controlled separately from server errors and blocks saving invalid input", () => {
  const { markup, tree } = capture(CoachFeeSheet, { ...focus, onSave: () => { throw new Error("invalid"); },
    view: { ...fee(), isInvalid: true, message: { tone: "error", label: "Validación existente" } } });
  assert.match(markup, /aria-invalid="true"/);
  const input = elements(tree).find((element) => element.type === "input")!;
  assert.match(input.props["aria-describedby"] as string, /-message$/);
  assert.equal(buttons(tree).find((button) => button.props.children === "Guardar tarifa")?.props.onClick, undefined);
});

test("sheet scrim only cancels when closable; child content does not trigger cancellation", () => {
  let calls = 0;
  const props = { ...focus, isOpen: true, isBusy: false, titleId: "title", variant: "fee" as const,
    children: createElement("h2", { id: "title" }, "Título"), footer: null, onCancel: () => { calls++; } };
  const { tree, markup } = capture(CoachDashboardSheet, props);
  assert.match(markup, /role="dialog" aria-modal="true" aria-labelledby="title"/);
  const scrim = buttons(tree)[0]; assert.equal(scrim.props.tabIndex, -1);
  assert.equal(elements(tree).find((element) => element.props.role === "dialog")?.props.onClick, undefined);
  scrim.props.onClick?.(); assert.equal(calls, 1);
  const busy = buttons(capture(CoachDashboardSheet, { ...props, isBusy: true }).tree)[0];
  assert.equal(busy.props.disabled, true); assert.equal(busy.props.onClick, undefined);
});

test("chat conversation is decorative and handoff copy does not expose an active conversation or composer", () => {
  const { markup, tree } = capture(CoachChatComingSoonSheet, { ...focus, view: chat() });
  const demo = elements(tree).find((element) => element.props.className === "demo")!;
  assert.equal(demo.props["aria-hidden"], "true");
  for (const copy of ["Coach, ¿subo el peso en sentadilla?", "MUY PRONTO", "Vas a poder responderles sin salir de Organizatech", "Avísame cuando esté listo", "Ahora no"]) assert.ok(markup.includes(copy));
  assert.doesNotMatch(markup, /<input|<textarea|<form|Te avisamos apenas esté/);
});

test("register-interest click dispatches only and does not optimistically mark confirmation", () => {
  let registered = 0; let canceled = 0;
  const props = { ...focus, view: chat(), onRegister: () => { registered++; }, onCancel: () => { canceled++; } };
  const { tree } = capture(CoachChatComingSoonSheet, props);
  buttons(tree).find((button) => button.props.children === "Avísame cuando esté listo")?.props.onClick?.();
  assert.equal(registered, 1); assert.equal(canceled, 0);
  assert.doesNotMatch(capture(CoachChatComingSoonSheet, props).markup, /Te avisamos apenas esté/);
  buttons(tree).find((button) => button.props.children === "Ahora no")?.props.onClick?.();
  assert.equal(canceled, 1);
});

test("only server-confirmed interest renders success and blocks registration", () => {
  const { tree, markup } = capture(CoachChatComingSoonSheet, { ...focus, view: { ...chat(), isRegistered: true }, onRegister: () => { throw new Error("must not register again"); } });
  const registered = buttons(tree).find((button) => button.props["data-registered"] === true)!;
  assert.equal(registered.props.disabled, true); assert.equal(registered.props.onClick, undefined);
  assert.match(markup, /Te avisamos apenas esté/); assert.match(markup, /role="status" aria-live="polite"/);
});

test("unknown interest, busy and missing callback never pretend registration is available", () => {
  for (const view of [{ ...chat(), isRegistered: null }, { ...chat(), isBusy: true }]) {
    const { tree, markup } = capture(CoachChatComingSoonSheet, { ...focus, view, onRegister: () => { throw new Error("blocked"); } });
    const register = buttons(tree).find((button) => button.props.children === "Avísame cuando esté listo")!;
    assert.equal(register.props.disabled, true); assert.equal(register.props.onClick, undefined);
    assert.doesNotMatch(markup, /Te avisamos apenas esté/);
  }
  const missing = capture(CoachChatComingSoonSheet, { ...focus, view: chat() });
  assert.ok(buttons(missing.tree).every((button) => button.props.disabled));
});
