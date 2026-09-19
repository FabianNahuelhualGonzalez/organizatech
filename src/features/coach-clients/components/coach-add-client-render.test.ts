import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isCoachInvitationReceiptReady, type CoachAddClientActions, type CoachAddClientView, type CoachClientInvitationReceiptView, type CoachClientInviteDraftView } from "./coach-add-client-view";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]));
};
const { CoachAddClientSheet } = requireComponent("./coach-add-client-sheet.tsx") as typeof import("./coach-add-client-sheet");
const { CoachClientInviteEmailStep } = requireComponent("./coach-client-invite-email-step.tsx") as typeof import("./coach-client-invite-email-step");
const { CoachClientInviteReceiptStep } = requireComponent("./coach-client-invite-receipt-step.tsx") as typeof import("./coach-client-invite-receipt-step");
const { CoachClientInvitationSteps } = requireComponent("./coach-client-invitation-steps.tsx") as typeof import("./coach-client-invitation-steps");
const { CoachClientCodeButton } = requireComponent("./coach-client-code-button.tsx") as typeof import("./coach-client-code-button");
const { CoachOverlay } = requireComponent("../../../ui/coach-overlays/coach-overlay.tsx") as typeof import("@/ui/coach-overlays/coach-overlay");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

type Props = { children?: ReactNode; footer?: ReactNode; onClick?: () => void;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void; [key: string]: unknown };
function capture<P extends object>(Component: (props: P) => ReactNode, props: P) {
  let tree: ReactNode = null;
  function Harness() { tree = Component(props); return tree; }
  return { markup: renderToStaticMarkup(createElement(Harness)), tree };
}
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  // Expand only our real presentational components through SSR, not a mocked render.
  for (const component of [CoachClientInviteEmailStep, CoachClientInviteReceiptStep, CoachClientInvitationSteps, CoachClientCodeButton]) {
    if (node.type === component) return elements(capture(component as (props: object) => ReactNode, node.props).tree);
  }
  return [node, ...elements(node.props.children), ...elements(node.props.footer)];
}
const controls = (node: ReactNode) => elements(node).filter((element) => element.type === "button");
const focus = { backgroundRef: { current: null }, restoreFocusRef: { current: null } };
function draft(): CoachClientInviteDraftView {
  return { emailRaw: "draft@example.test", canEdit: true, validation: { tone: "ok", errorLabel: null }, canSubmit: true, action: "submit",
    submitLabel: "Enviar solicitud", busyLabel: "Enviando…",
    hint: "Ayuda del envío aprobada", steps: [{ id: "send", label: "Paso de envío aprobado" }, { id: "accept", label: "Paso de aceptación aprobado" }, { id: "manage", label: "Paso posterior aprobado" }] };
}
function receipt(): CoachClientInvitationReceiptView {
  return { source: "server", delivery: "provider-accepted", id: "invitation-verified", email: "confirmed@example.test", code: "TEST-123-CODE",
    headingLabel: "Solicitud enviada", descriptionLabel: "La solicitud queda pendiente de aceptación.", deliveryLabel: "Envío aceptado por el proveedor",
    copyHint: "Ayuda aprobada para copiar", footerHint: "Ayuda aprobada para pendientes", steps: draft().steps,
    isCopied: false, canCopy: true, canShare: true, canOpenPending: true };
}
function emailView(): CoachAddClientView { return { step: "email", isOpen: true, isBusy: false, draft: draft(), message: null }; }
function receiptView(): CoachAddClientView { return { ...emailView(), step: "receipt", receipt: receipt() }; }
function render(view: CoachAddClientView = emailView(), actions: CoachAddClientActions = {}) {
  return capture(CoachAddClientSheet, { ...focus, view, actions });
}
function submit(tree: ReactNode) { return controls(tree).find((element) => element.props.type === "submit")!; }
function form(tree: ReactNode) { return elements(tree).find((element) => element.type === "form")!; }

test("closed add sheet has no dialog, draft or receipt fragments", () => {
  assert.equal(render({ ...emailView(), isOpen: false }).markup, "");
  assert.equal(render({ ...receiptView(), isOpen: false }).markup, "");
});

test("email step preserves approved copy, exactly three colored instructions and matching form/field associations", () => {
  const { markup, tree } = render(emailView(), { onEmailChange: () => {}, onSubmit: () => {} });
  for (const label of ["PASO 1 DE 2", "Agregar un nuevo cliente", "Correo del alumno", "QUÉ VA A PASAR", "Enviar solicitud", "Ayuda del envío aprobada"]) assert.ok(markup.includes(label));
  const input = elements(tree).find((element) => element.type === "input")!;
  const label = elements(tree).find((element) => element.type === "label")!;
  assert.equal(label.props.htmlFor, input.props.id); assert.equal(submit(tree).props.form, form(tree).props.id);
  assert.equal(form(tree).props.noValidate, true); assert.equal(input.props.type, "email"); assert.equal(input.props.inputMode, "email");
  assert.equal(input.props.autoComplete, "off"); assert.equal(input.props.autoCapitalize, "none"); assert.equal(input.props.spellCheck, false);
  assert.equal(input.props["data-modal-initial-focus"], ""); assert.equal(input.props["aria-invalid"], undefined);
  const steps = elements(tree).filter((element) => element.type === "li");
  assert.deepEqual(steps.map((step) => step.props["data-tone"]), ["accent", "pending", "ok"]);
  assert.deepEqual(steps.map((step) => step.key), ["send", "accept", "manage"]); assert.match(markup, /<ol/);
  assert.doesNotMatch(markup, /Mi perfil|TEST-123-CODE|PASO 2 DE 2/);
});

test("raw email changes are delegated exactly and do not mutate the controlled draft or consult identity", () => {
  const calls: string[] = []; const view = emailView();
  const { tree } = render(view, { onEmailChange: (raw) => calls.push(raw) });
  elements(tree).find((element) => element.type === "input")?.props.onChange?.({ currentTarget: { value: "  NEW@Example.test " } });
  assert.deepEqual(calls, ["  NEW@Example.test "]); assert.equal(view.draft.emailRaw, "draft@example.test");
});

test("empty and invalid drafts remain editable for immediate typing and native paste", () => {
  for (const emailRaw of ["", "a"]) {
    const view = { ...emailView(), draft: { ...draft(), emailRaw, action: null,
      validation: { tone: "neutral" as const, errorLabel: null }, canSubmit: false } };
    const { tree } = render(view, { onEmailChange: () => {} });
    const input = elements(tree).find((element) => element.type === "input")!;
    assert.equal(input.props.disabled, false);
    assert.equal(input.props.readOnly, undefined);
    assert.equal(input.props["data-modal-initial-focus"], "");
    assert.equal(typeof input.props.onChange, "function");
  }
});

test("neutral validation does not show a red error at the first letter or run its own email validator", () => {
  const view = { ...emailView(), draft: { ...draft(), emailRaw: "a", validation: { tone: "neutral" as const, errorLabel: "NOT_VISIBLE_YET" } } };
  const { markup, tree } = render(view, { onEmailChange: () => {}, onSubmit: () => assert.fail("not eligible") });
  assert.match(markup, /data-tone="neutral"/); assert.doesNotMatch(markup, /aria-invalid|role="alert"|NOT_VISIBLE_YET/);
  assert.equal(submit(tree).props.disabled, true);
  // Format belongs to the mapper: an explicit validated VM, not local regex, governs the form.
  assert.equal(submit(render({ ...view, draft: { ...view.draft, validation: { tone: "ok", errorLabel: null } } }, { onSubmit: () => {} }).tree).props.disabled, false);
});

test("mapper validation errors are associated with the input; extra pending identity is ignored", () => {
  const pendingDraft = { ...draft(), validation: { tone: "err" as const, errorLabel: "Ya hay una solicitud pendiente para draft@example.test." },
    identity: { name: "PRIVATE_PENDING_NAME", initials: "PRIVATE_INITIALS" }, lastActivity: "PRIVATE_ACTIVITY" };
  const { markup, tree } = render({ ...emailView(), draft: pendingDraft });
  for (const privateValue of ["PRIVATE_PENDING_NAME", "PRIVATE_INITIALS", "PRIVATE_ACTIVITY"]) assert.ok(!markup.includes(privateValue));
  assert.match(markup, /role="alert">Ya hay una solicitud pendiente para draft@example.test\./);
  const input = elements(tree).find((element) => element.type === "input")!;
  assert.equal(input.props["aria-invalid"], true); assert.match(String(input.props["aria-describedby"]), new RegExp(`${String(input.props.id)}-error`));
  const active = render({ ...emailView(), draft: { ...draft(), validation: { tone: "err", errorLabel: "Identidad ya autorizada ya está en tu lista." } } });
  assert.match(active.markup, /Identidad ya autorizada ya está en tu lista\./);
});

test("submit prevents navigation and only emits intent, never switching the view or fabricating a receipt", () => {
  let submits = 0; let prevented = 0; const view = emailView(); const actions = { onSubmit: () => { submits++; } };
  const before = render(view, actions);
  form(before.tree).props.onSubmit?.({ preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1); assert.equal(submits, 1); assert.equal(view.step, "email");
  assert.equal(render(view, actions).markup, before.markup); assert.doesNotMatch(before.markup, /Solicitud enviada|Ir a mi lista|confirmed@example/);
});

test("submit and busy labels are controlled for explicit retry or reconciliation", () => {
  const retry = { ...emailView(), draft: { ...draft(), action: "retry" as const, emailRaw: "frozen@example.test",
    canEdit: false, validation: { tone: "neutral" as const, errorLabel: null }, submitLabel: "Reintentar solicitud" } };
  const retryRendered = render(retry, { onEmailChange: () => assert.fail("frozen"), onSubmit: () => {} });
  assert.match(retryRendered.markup, /Reintentar solicitud/);
  assert.equal(elements(retryRendered.tree).find((element) => element.type === "input")?.props.disabled, true);
  assert.equal(submit(retryRendered.tree).props.disabled, false);
  const reconcile = { ...emailView(), isBusy: true, draft: { ...draft(), action: "reconcile" as const, submitLabel: "Revisar estado", busyLabel: "Revisando…" } };
  const markup = render(reconcile, { onSubmit: () => {} }).markup;
  assert.match(markup, /Revisando…/);
  assert.doesNotMatch(markup, /Enviando…/);
});

test("submit stays disabled for busy, missing callback, empty email, mapper refusal and non-ok validation", () => {
  const cases: CoachAddClientView[] = [{ ...emailView(), isBusy: true }, { ...emailView(), isOpen: false },
    ...["", "   "].map((emailRaw) => ({ ...emailView(), draft: { ...draft(), emailRaw } })),
    { ...emailView(), draft: { ...draft(), canSubmit: false } },
    { ...emailView(), draft: { ...draft(), validation: { tone: "neutral", errorLabel: null } } },
    { ...emailView(), draft: { ...draft(), validation: { tone: "err", errorLabel: "Error provisto" } } }];
  for (const view of cases) {
    const { tree } = render(view, { onSubmit: () => assert.fail("blocked") });
    assert.equal(submit(tree).props.disabled, true); let prevented = 0;
    form(tree).props.onSubmit?.({ preventDefault: () => { prevented++; } }); assert.equal(prevented, 1);
  }
  const missing = render(); assert.equal(submit(missing.tree).props.disabled, true);
});

test("busy form locks email and cancel, and identifies actual sending instead of success", () => {
  const { tree, markup } = render({ ...emailView(), isBusy: true }, {
    onEmailChange: () => assert.fail("busy"), onCancel: () => assert.fail("busy"), onSubmit: () => assert.fail("busy"),
  });
  const input = elements(tree).find((element) => element.type === "input")!;
  assert.equal(input.props.disabled, true); assert.equal(input.props.onChange, undefined);
  assert.match(markup, /Enviando…/); assert.match(markup, /aria-busy="true"/); assert.doesNotMatch(markup, /PASO 2 DE 2/);
  assert.ok(controls(tree).every((button) => button.props.disabled));
  const noChange = render(); assert.equal(elements(noChange.tree).find((element) => element.type === "input")?.props.disabled, true);
});

test("receipt guard requires server provenance and concrete id/email/code even while delivery is pending", () => {
  for (const delivery of ["pending", "provider-accepted", "delivered"] as const) assert.equal(isCoachInvitationReceiptReady({ ...receipt(), delivery }), true);
  const invalid = [null, undefined, { ...receipt(), source: "local" }, ...["queued", "reserved", "failed"].map((delivery) => ({ ...receipt(), delivery })),
    ...["id", "email", "code"].flatMap((key) => ["", "   ", null, 7].map((value) => ({ ...receipt(), [key]: value })))];
  for (const candidate of invalid) assert.equal(isCoachInvitationReceiptReady(candidate as CoachClientInvitationReceiptView | null | undefined), false);
});

test("confirmed provider receipt uses its actual email even if draft changed, without claiming inbox delivery", () => {
  const { tree, markup } = render(receiptView(), { onOpenPendingClients: () => {} });
  for (const label of ["PASO 2 DE 2 · LISTO", "Solicitud enviada", "confirmed@example.test", "Envío aceptado por el proveedor", "CÓDIGO DE VINCULACIÓN", "LO QUE TIENE QUE HACER", "Ir a mi lista"]) assert.ok(markup.includes(label));
  assert.match(markup, /data-delivery="provider-accepted" role="status" aria-live="polite"/);
  assert.doesNotMatch(markup, /draft@example|Correo entregado|Entregado al buzón|Mi perfil|<input|Enviar solicitud|Enviando/);
  assert.equal(controls(tree).find((button) => button.props.children === "Ir a mi lista")?.props["data-modal-initial-focus"], "");
});

test("delivered receipt is distinguished by supplied status rather than inferred from creation", () => {
  const { markup } = render({ ...emailView(), step: "receipt", receipt: { ...receipt(), delivery: "delivered", deliveryLabel: "Entrega confirmada por el proveedor" } });
  assert.match(markup, /data-delivery="delivered"/); assert.match(markup, /Entrega confirmada por el proveedor/);
  assert.doesNotMatch(markup, /Envío aceptado por el proveedor/);
});

test("reservation, queued request and malformed receipt never render success, code or pending navigation", () => {
  for (const candidate of [null, { ...receipt(), delivery: "reserved" }, { ...receipt(), delivery: "queued" }, { ...receipt(), source: "local" },
    { ...receipt(), id: "" }, { ...receipt(), code: " " }, { ...receipt(), email: "" }]) {
    const view = { ...emailView(), step: "receipt", receipt: candidate } as CoachAddClientView;
    const { tree, markup } = render(view, { onSubmit: () => assert.fail("bad receipt"), onOpenPendingClients: () => assert.fail("bad receipt") });
    assert.match(markup, /PASO 1 DE 2/); assert.doesNotMatch(markup, /PASO 2 DE 2|TEST-123-CODE|confirmed@example|Ir a mi lista|Solicitud enviada/);
    assert.equal(submit(tree).props.disabled, true); form(tree).props.onSubmit?.({ preventDefault: () => {} });
  }
});

test("copy/share callbacks carry receipt id only and do not claim copied or delivery optimistically", () => {
  const calls: unknown[] = []; const view = receiptView(); const actions: CoachAddClientActions = {
    onCopyCode: (id) => calls.push(["copy", id]), onShareCode: (id) => calls.push(["share", id]),
  };
  const { tree, markup } = render(view, actions); assert.deepEqual(calls, []);
  controls(tree).find((button) => button.props["aria-label"] === "Copiar código")?.props.onClick?.();
  controls(tree).find((button) => button.props.className === "share")?.props.onClick?.();
  assert.deepEqual(calls, [["copy", "invitation-verified"], ["share", "invitation-verified"]]);
  assert.equal(render(view, actions).markup, markup); assert.doesNotMatch(markup, /Copiado|data-copied="true"|Correo entregado/);
});

test("only externally confirmed copy success appears, including the unknown state", () => {
  for (const isCopied of [false, null]) assert.doesNotMatch(render({ ...emailView(), step: "receipt", receipt: { ...receipt(), isCopied } }).markup, /Copiado/);
  const { markup } = render({ ...emailView(), step: "receipt", receipt: { ...receipt(), isCopied: true } });
  assert.match(markup, /role="status" aria-live="polite">Copiado/); assert.match(markup, /data-size="receipt"/);
});

test("Ir a mi lista explicitly requests the pending tab, with no cancel or submit side effect", () => {
  const calls: string[] = []; const view = receiptView();
  const { tree } = render(view, { onOpenPendingClients: (tab) => calls.push(tab), onCancel: () => assert.fail("not cancel"), onSubmit: () => assert.fail("not submit") });
  controls(tree).find((button) => button.props.children === "Ir a mi lista")?.props.onClick?.();
  assert.deepEqual(calls, ["pending"]); assert.equal(view.step, "receipt");
});

test("receipt capabilities are independent and unavailable actions cannot run", () => {
  for (const key of ["canCopy", "canShare", "canOpenPending"] as const) {
    const { tree } = render({ ...emailView(), step: "receipt", receipt: { ...receipt(), [key]: false } }, {
      onCopyCode: () => {}, onShareCode: () => {}, onOpenPendingClients: () => {},
    });
    const action = controls(tree).find((button) => key === "canCopy" ? button.props["aria-label"] === "Copiar código"
      : key === "canShare" ? button.props.className === "share" : button.props.children === "Ir a mi lista")!;
    assert.equal(action.props.disabled, true); assert.equal(action.props.onClick, undefined);
  }
  assert.ok(controls(render(receiptView()).tree).every((button) => button.props.disabled));
});

test("busy receipt prevents duplicate actions and cancel without downgrading a confirmed receipt", () => {
  const { tree, markup } = render({ ...receiptView(), isBusy: true }, { onCopyCode: () => assert.fail("busy"), onShareCode: () => assert.fail("busy"),
    onOpenPendingClients: () => assert.fail("busy"), onCancel: () => assert.fail("busy") });
  for (const button of controls(tree)) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); }
  assert.match(markup, /PASO 2 DE 2/); assert.doesNotMatch(markup, /Enviando…|<input/);
});

test("X and scrim only emit cancel in either step, never creating or changing an invitation", () => {
  for (const view of [emailView(), receiptView()]) {
    let cancelled = 0; const actions = { onCancel: () => { cancelled++; }, onSubmit: () => assert.fail("not submit") };
    const { tree } = render(view, actions);
    controls(tree).find((button) => button.props["aria-label"] === "Cerrar")?.props.onClick?.(); assert.equal(cancelled, 1);
    const overlay = elements(tree).find((element) => element.type === CoachOverlay)!;
    assert.equal(overlay.props.variant, "client-add");
    assert.equal(overlay.props.backgroundRef, focus.backgroundRef); assert.equal(overlay.props.restoreFocusRef, focus.restoreFocusRef);
    const expanded = capture(CoachOverlay, overlay.props as unknown as Parameters<typeof CoachOverlay>[0]);
    controls(expanded.tree).find((button) => button.props.className === "scrim")?.props.onClick?.(); assert.equal(cancelled, 2);
    assert.equal(view.step, view.receipt ? "receipt" : "email");
  }
});

test("injected send errors preserve draft and never imply delivery or transition to receipt", () => {
  const { markup, tree } = render({ ...emailView(), message: { tone: "error", label: "No se confirmó el envío; mensaje provisto." } });
  assert.match(markup, /role="alert">No se confirmó el envío; mensaje provisto\./);
  assert.equal(elements(tree).find((element) => element.type === "input")?.props.value, "draft@example.test");
  assert.doesNotMatch(markup, /PASO 2 DE 2|Solicitud enviada|Ir a mi lista/);
});

test("mapper text, receipt email and code are escaped, never interpreted as HTML", () => {
  const injected = "<script>fixture</script>";
  const { markup } = render({ ...emailView(), step: "receipt", receipt: { ...receipt(), email: injected, code: injected,
    headingLabel: injected, deliveryLabel: injected, steps: [{ id: "one", label: injected }, { id: "two", label: "Dos" }, { id: "three", label: "Tres" }] } });
  assert.match(markup, /&lt;script&gt;fixture&lt;\/script&gt;/); assert.doesNotMatch(markup, /<script>/);
});
