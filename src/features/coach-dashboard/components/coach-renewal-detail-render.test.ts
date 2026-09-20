import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachRenewalDetailView, CoachRenewalDatesView } from "./coach-renewal-detail-view";
import { COACH_RENEWAL_OPTIONS, coachRenewalRadioTarget } from "./coach-renewal-state-options";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]));
};
const { CoachRenewalDetailSheet } = requireComponent("./coach-renewal-detail-sheet.tsx") as typeof import("./coach-renewal-detail-sheet");
const { CoachRenewalDetailContent } = requireComponent("./coach-renewal-detail-content.tsx") as typeof import("./coach-renewal-detail-content");
const { CoachRenewalDatesModal } = requireComponent("./coach-renewal-dates-modal.tsx") as typeof import("./coach-renewal-dates-modal");
const { CoachRenewalStateChoices } = requireComponent("./coach-renewal-state-choices.tsx") as typeof import("./coach-renewal-state-choices");
const { CoachDashboardSheet } = requireComponent("./coach-dashboard-sheet.tsx") as typeof import("./coach-dashboard-sheet");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

type Props = { children?: ReactNode; footer?: ReactNode; onClick?: (event: { currentTarget: HTMLElement }) => void;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  onKeyDown?: (event: { key: string; currentTarget: HTMLElement; preventDefault(): void }) => void;
  ref?: ((node: HTMLButtonElement | null) => void) | { current: HTMLElement | null }; [key: string]: unknown };
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
const focus = { backgroundRef: { current: null }, restoreFocusRef: { current: null } };
function detail(): CoachRenewalDetailView {
  return { isOpen: true, isBusy: false, id: "consented-client-fixture", clientName: "Nombre consentido de prueba", initials: "NP",
    metaLabel: "Metadata del mapper", state: "pending", stateLabel: "Pago pendiente de confirmar", stateCaption: "Detalle provisto",
    sourceLabel: "Fuente confirmada provista", facts: { endsOnLabel: "Fecha de término provista", lastTrainingLabel: "Último día provisto",
      consistencyLabel: "Constancia provista", monthlyFee: { value: 123, label: "$123 provistos" } },
    paidPeriodDates: null, canSave: true, saveLabel: "Listo", message: null };
}
function dates(): CoachRenewalDatesView {
  return { isOpen: true, isBusy: false, subjectLabel: "Nombre de prueba", startRaw: "2026-09-09", endRaw: "2026-10-20",
    startMin: "2026-09-08", endMin: "2026-09-10", startInvalid: false, endInvalid: false,
    validation: { kind: "ok", label: "Rango válido provisto por el controlador" }, pauseLabel: null, canAccept: true,
    acceptLabel: "Confirmar fechas", message: null };
}
const clickEvent = { currentTarget: {} as HTMLElement };

test("detail closed never leaves a dates dialog or actionable orphan", () => {
  assert.equal(capture(CoachRenewalDetailSheet, { ...focus, view: { ...detail(), isOpen: false }, dates: dates(), actions: {} }).markup, "");
  assert.equal(capture(CoachRenewalDatesModal, { ...focus, view: { ...dates(), isOpen: false }, actions: {} }).markup, "");
});

test("dates open as a sibling layer with a separate background ref while the detail remains mounted", () => {
  const { markup, tree } = capture(CoachRenewalDetailSheet, { ...focus, view: detail(), dates: dates(), actions: {} });
  assert.equal((markup.match(/role="dialog"/g) ?? []).length, 2);
  assert.match(markup, /Nombre consentido de prueba/); assert.match(markup, /¿Qué período cubre el pago\?/);
  const lower = elements(tree).find((element) => element.props["data-renewal-detail"] === detail().id)!;
  const upper = elements(tree).find((element) => element.type === CoachRenewalDatesModal)!;
  const lowerSheet = elements(lower).find((element) => element.type === CoachDashboardSheet)!;
  assert.equal(upper.props.backgroundRef, lower.props.ref);
  assert.notEqual(upper.props.backgroundRef, focus.backgroundRef);
  assert.equal(lowerSheet.props.backgroundRef, focus.backgroundRef);
  assert.equal(lowerSheet.props.isObscured, true);
  assert.equal(elements(lower).some((element) => element.type === CoachRenewalDatesModal), false);
});

test("detail displays only supplied provenance and facts, escapes text and never infers missing attendance or dates", () => {
  const view = detail();
  const { markup } = capture(CoachRenewalDetailContent, { view, disabled: false, actions: {}, triggerRef: { current: null } });
  for (const label of [view.sourceLabel!, view.facts.endsOnLabel!, view.facts.lastTrainingLabel!, view.facts.consistencyLabel!, view.facts.monthlyFee.label]) assert.ok(markup.includes(label));
  const absent = capture(CoachRenewalDetailContent, { disabled: false, actions: {}, triggerRef: { current: null }, view: { ...view,
    sourceLabel: null, stateLabel: null, stateCaption: null, facts: { endsOnLabel: null, lastTrainingLabel: null, consistencyLabel: null,
      monthlyFee: { value: null, label: "No disponible" } } } }).markup;
  assert.equal((absent.match(/data-known="false"/g) ?? []).length, 5);
  assert.doesNotMatch(absent, /0%|0 días|\$0|Fuente confirmada provista|Detalle provisto/);
  const escaped = capture(CoachRenewalDetailSheet, { ...focus, view: { ...view, clientName: "<img onerror=alert(1)>" }, dates: { ...dates(), isOpen: false }, actions: {} }).markup;
  assert.match(escaped, /&lt;img onerror=alert\(1\)&gt;/); assert.doesNotMatch(escaped, /<img/);
});

test("payment options match approved commercial decisions, remain controlled and forward the actual trigger without local persistence", () => {
  assert.deepEqual(COACH_RENEWAL_OPTIONS.map(({ state, label }) => ({ state, label })), [
    { state: "renewed", label: "Pagado" }, { state: "pending", label: "Pago pendiente de confirmar" }, { state: "declined", label: "No sigue" },
  ]);
  const selected: string[] = []; const triggerRef = { current: null as HTMLElement | null };
  const { tree, markup } = capture(CoachRenewalStateChoices, { state: "pending", disabled: false, triggerRef, onSelectState: (state) => selected.push(state) });
  assert.match(markup, /role="radiogroup" aria-label="Estado del pago"/);
  assert.doesNotMatch(markup, /Estado de renovación/);
  const options = buttons(tree);
  assert.deepEqual(options.map((button) => button.props["aria-checked"]), [false, true, false]);
  assert.deepEqual(options.map((button) => button.props.tabIndex), [-1, 0, -1]);
  options[0].props.onClick?.(clickEvent);
  assert.deepEqual(selected, ["renewed"]); assert.equal(triggerRef.current, clickEvent.currentTarget);
  assert.equal(options[1].props["aria-checked"], true);
});

test("radio keyboard wraps, focuses and selects only from the three controlled states", () => {
  for (const [state, key, expected] of [["renewed", "ArrowUp", "declined"], ["declined", "ArrowRight", "renewed"],
    ["pending", "Home", "renewed"], ["pending", "End", "declined"], ["pending", "Escape", null]] as const) {
    assert.equal(coachRenewalRadioTarget(state, key), expected);
  }
  const selected: string[] = []; const focused: string[] = []; const triggerRef = { current: null as HTMLElement | null };
  const { tree } = capture(CoachRenewalStateChoices, { state: "pending", disabled: false, triggerRef, onSelectState: (state) => selected.push(state) });
  const radios = buttons(tree);
  for (const radio of radios) {
    const state = radio.props["data-state"] as string;
    if (typeof radio.props.ref === "function") radio.props.ref({ focus: () => { focused.push(state); } } as unknown as HTMLButtonElement);
  }
  let prevented = 0;
  radios[1].props.onKeyDown?.({ ...clickEvent, key: "ArrowDown", preventDefault: () => { prevented++; } });
  assert.deepEqual(selected, ["declined"]); assert.deepEqual(focused, ["declined"]); assert.equal(prevented, 1);
  radios[1].props.onKeyDown?.({ ...clickEvent, key: "Escape", preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1); assert.equal(selected.length, 1);
});

test("disabled or unavailable state choices install no click or keyboard handlers", () => {
  for (const props of [{ disabled: true, onSelectState: () => {} }, { disabled: false }]) {
    const { tree } = capture(CoachRenewalStateChoices, { ...props, state: "pending", triggerRef: { current: null } });
    for (const button of buttons(tree)) {
      assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); assert.equal(button.props.onKeyDown, undefined);
    }
  }
});

test("Listo saves only explicitly; X only cancels and neither dispatches during rendering", () => {
  const calls: string[] = [];
  const { tree } = capture(CoachRenewalDetailSheet, { ...focus, view: detail(), dates: { ...dates(), isOpen: false },
    actions: { onSave: () => calls.push("save"), onCancelDetail: () => calls.push("cancel") } });
  assert.deepEqual(calls, []);
  buttons(tree).find((button) => button.props.children === "Listo")?.props.onClick?.(clickEvent);
  assert.deepEqual(calls, ["save"]);
  buttons(tree).find((button) => button.props["aria-label"] === "Cerrar")?.props.onClick?.(clickEvent);
  assert.deepEqual(calls, ["save", "cancel"]);
});

test("detail saving requires coherent capability, label, complete renewal dates and unobscured non-busy state", () => {
  const base = detail();
  const cases: CoachRenewalDetailView[] = [
    { ...base, canSave: false }, { ...base, isBusy: true }, { ...base, saveLabel: "Corrige las fechas" },
    { ...base, saveLabel: "Completa las fechas" }, { ...base, state: "renewed", paidPeriodDates: null },
    { ...base, state: "renewed", paidPeriodDates: { label: null, isIncomplete: true } },
  ];
  for (const view of cases) {
    const { tree } = capture(CoachRenewalDetailSheet, { ...focus, view, dates: { ...dates(), isOpen: false }, actions: { onSave: () => assert.fail("blocked") } });
    const save = buttons(tree).find((button) => button.props.children === view.saveLabel)!;
    assert.equal(save.props.disabled, true); assert.equal(save.props.onClick, undefined);
  }
  const covered = capture(CoachRenewalDetailSheet, { ...focus, view: base, dates: dates(), actions: { onSave: () => assert.fail("covered"), onCancelDetail: () => assert.fail("covered") } });
  for (const button of buttons(covered.tree)) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); }
  const valid = capture(CoachRenewalDetailSheet, { ...focus, view: { ...base, state: "renewed", paidPeriodDates: { label: "Rango provisto", isIncomplete: false } },
    dates: { ...dates(), isOpen: false }, actions: { onSave: () => {} } });
  assert.equal(buttons(valid.tree).find((button) => button.props.children === "Listo")?.props.disabled, false);
});

test("changing dates stores only an opener reference and emits the controlled open callback", () => {
  let opened = 0; const triggerRef = { current: null as HTMLElement | null };
  const view: CoachRenewalDetailView = { ...detail(), state: "renewed", paidPeriodDates: { label: "Fechas calculadas externamente", isIncomplete: false } };
  const { tree, markup } = capture(CoachRenewalDetailContent, { view, disabled: false, actions: { onOpenDates: () => { opened++; } }, triggerRef });
  assert.match(markup, /Fechas calculadas externamente/);
  buttons(tree)[0].props.onClick?.(clickEvent);
  assert.equal(opened, 1); assert.equal(triggerRef.current, clickEvent.currentTarget);
  assert.equal(view.paidPeriodDates?.label, "Fechas calculadas externamente");
});

test("date inputs forward raw values, provided minimums and explicit fields with no arithmetic", () => {
  const changes: [string, string][] = [];
  const { tree } = capture(CoachRenewalDatesModal, { ...focus, view: dates(), actions: { onChangeDates: (field, value) => changes.push([field, value]) } });
  const inputs = elements(tree).filter((element) => element.type === "input");
  assert.deepEqual(inputs.map((input) => [input.props["data-field"], input.props.value, input.props.min]),
    [["start", "2026-09-09", "2026-09-08"], ["end", "2026-10-20", "2026-09-10"]]);
  inputs[0].props.onChange?.({ currentTarget: { value: "" } });
  inputs[1].props.onChange?.({ currentTarget: { value: "2027-02-03" } });
  assert.deepEqual(changes, [["start", ""], ["end", "2027-02-03"]]);
  assert.equal(inputs[1].props.value, "2026-10-20");
});

test("paid-period dates never offer training-week presets or manufacture a cycle", () => {
  const changes: [string, string][] = [];
  const { tree, markup } = capture(CoachRenewalDatesModal, { ...focus, view: dates(),
    actions: { onChangeDates: (field, value) => changes.push([field, value]) } });
  assert.equal(buttons(tree).some((button) => button.props["data-weeks"] !== undefined), false);
  assert.doesNotMatch(markup, /semanas|nuevo ciclo/);
  assert.match(markup, /¿Qué período cubre el pago\?/);
  assert.match(markup, /No cambian su ciclo de entrenamiento/);
  assert.equal(elements(tree).filter((element) => element.type === "input").length, 2);
  assert.deepEqual(changes, []);
});

test("paid confirmation requires a separate paid period and never promises automatic renewal from a cycle", () => {
  const view: CoachRenewalDetailView = { ...detail(), state: "renewed",
    paidPeriodDates: { label: "Período pagado provisto", isIncomplete: false } };
  const { markup } = capture(CoachRenewalDetailContent, { view, disabled: false, actions: {}, triggerRef: { current: null } });
  assert.match(markup, /Período pagado hasta/);
  assert.match(markup, /FECHAS DEL PERÍODO PAGADO/);
  assert.match(markup, /Período pagado provisto/);
  assert.match(markup, /El ciclo de entrenamiento es independiente/);
  assert.match(markup, /Avance del ciclo/);
  assert.doesNotMatch(markup, /Su ciclo termina|FECHAS DEL NUEVO CICLO|se marca solo/);
});

test("accept requires valid explicit fields, validation and capability even for inconsistent VMs", () => {
  const base = dates();
  const cases: CoachRenewalDatesView[] = [{ ...base, canAccept: false }, { ...base, startInvalid: true }, { ...base, endInvalid: true },
    { ...base, validation: null }, { ...base, validation: { kind: "warn", label: "Fechas incompletas" } },
    { ...base, validation: { kind: "err", label: "Rango inválido" } }, { ...base, startRaw: null }, { ...base, endRaw: "" },
    { ...base, startRaw: "   " }, { ...base, acceptLabel: "Corrige las fechas" }, { ...base, acceptLabel: "Completa las fechas" }];
  for (const view of cases) {
    const { tree } = capture(CoachRenewalDatesModal, { ...focus, view, actions: { onAcceptDates: () => assert.fail("blocked") } });
    const accept = buttons(tree).find((button) => button.props.children === view.acceptLabel)!;
    assert.equal(accept.props.disabled, true); assert.equal(accept.props.onClick, undefined);
  }
});

test("accepting dates does not cancel the modal or save the enclosing detail", () => {
  const calls: string[] = [];
  const { tree } = capture(CoachRenewalDatesModal, { ...focus, view: dates(), actions: {
    onAcceptDates: () => calls.push("accept"), onCancelDates: () => calls.push("cancel-dates"),
  } });
  buttons(tree).find((button) => button.props.children === "Confirmar fechas")?.props.onClick?.(clickEvent);
  assert.deepEqual(calls, ["accept"]);
  buttons(tree).find((button) => button.props["aria-label"] === "Cancelar")?.props.onClick?.(clickEvent);
  assert.deepEqual(calls, ["accept", "cancel-dates"]);
});

test("date scrim cancels only the upper modal and obscured detail cannot cancel through its scrim", () => {
  const calls: string[] = [];
  const props = { ...focus, isOpen: true, isBusy: false, titleId: "title", children: null, footer: null };
  const upper = capture(CoachDashboardSheet, { ...props, variant: "dates", onCancel: () => calls.push("dates") });
  const lower = capture(CoachDashboardSheet, { ...props, variant: "detail", isObscured: true, onCancel: () => calls.push("detail") });
  const scrim = buttons(upper.tree)[0]; assert.equal(scrim.props["aria-label"], "Cancelar");
  scrim.props.onClick?.(clickEvent); assert.deepEqual(calls, ["dates"]);
  assert.equal(buttons(lower.tree)[0].props.disabled, true); assert.equal(buttons(lower.tree)[0].props.onClick, undefined);
});

test("date busy or unavailable callbacks disable all controls and remove action handlers", () => {
  for (const props of [{ view: { ...dates(), isBusy: true }, actions: { onChangeDates: () => {}, onCancelDates: () => {}, onAcceptDates: () => {} } },
    { view: dates(), actions: {} }]) {
    const { tree } = capture(CoachRenewalDatesModal, { ...focus, ...props });
    for (const element of elements(tree).filter((element) => element.type === "button" || element.type === "input")) {
      assert.equal(element.props.disabled, true); assert.equal(element.props.onClick, undefined); assert.equal(element.props.onChange, undefined);
    }
  }
});

test("local date validation stays polite for err, warn and ok while preserving its visual kind", () => {
  for (const kind of ["err", "warn", "ok"] as const) {
    const { markup } = capture(CoachRenewalDatesModal, { ...focus, view: { ...dates(),
      validation: { kind, label: `Validación local ${kind}` } }, actions: {} });
    const validation = markup.match(/<p\b[^>]*id="[^"]+-validation"[^>]*>[\s\S]*?<\/p>/)?.[0];
    assert.ok(validation, `validation region exists for ${kind}`);
    assert.match(validation, /role="status" aria-live="polite"/, kind);
    assert.doesNotMatch(validation, /role="alert"|aria-live="assertive"/, kind);
    assert.match(markup, new RegExp(`data-kind="${kind}"`));
    assert.ok(validation.includes(`Validación local ${kind}`));
  }
});

test("field validity, pause explanation and server errors are controlled separately and preserve the raw draft", () => {
  const { tree, markup } = capture(CoachRenewalDatesModal, { ...focus, view: { ...dates(), startInvalid: true,
    validation: { kind: "err", label: "Validación del controlador" }, pauseLabel: "Pausa calculada por dominio",
    message: { tone: "error", label: "Error persistencia provisto" } }, actions: {} });
  assert.match(markup, /role="status" aria-live="polite">Validación del controlador/); assert.match(markup, /Pausa calculada por dominio/);
  assert.match(markup, /role="alert">Error persistencia provisto/); assert.match(markup, /value="2026-09-09"/);
  const inputs = elements(tree).filter((element) => element.type === "input");
  assert.equal(inputs[0].props["aria-invalid"], true); assert.equal(inputs[1].props["aria-invalid"], undefined);
  assert.match(inputs[0].props["aria-describedby"] as string, /-validation$/);
  assert.doesNotMatch(capture(CoachRenewalDatesModal, { ...focus, view: dates(), actions: {} }).markup, /class="pause"/);
});

test("opening/closing presentation does not clear the controller baseline or dispatch writes", () => {
  const view = Object.freeze(detail()); const datesView = Object.freeze(dates()); const calls: string[] = [];
  const actions = { onSave: () => calls.push("save"), onAcceptDates: () => calls.push("accept"), onCancelDetail: () => calls.push("cancel") };
  capture(CoachRenewalDetailSheet, { ...focus, view, dates: datesView, actions });
  capture(CoachRenewalDetailSheet, { ...focus, view, dates: { ...datesView, isOpen: false }, actions });
  const reopened = capture(CoachRenewalDetailSheet, { ...focus, view, dates: datesView, actions }).markup;
  assert.match(reopened, /Fuente confirmada provista/); assert.match(reopened, /value="2026-09-09"/);
  assert.deepEqual(calls, []); assert.equal(view.state, "pending"); assert.equal(datesView.startRaw, "2026-09-09"); assert.equal(datesView.endRaw, "2026-10-20");
});
