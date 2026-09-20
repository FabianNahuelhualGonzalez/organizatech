import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CoachClientDetailView, CoachClientCodeView, CoachClientUnlinkConfirmationView } from "./coach-client-detail-view";

const requireComponent = createRequire(import.meta.url);
const previousCssLoader = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [match[1], match[1]]));
};
const { CoachClientDetailSheet } = requireComponent("./coach-client-detail-sheet.tsx") as typeof import("./coach-client-detail-sheet");
const { CoachClientDetailContent } = requireComponent("./coach-client-detail-content.tsx") as typeof import("./coach-client-detail-content");
const { CoachClientCodeCard } = requireComponent("./coach-client-code-card.tsx") as typeof import("./coach-client-code-card");
const { CoachClientCodeButton } = requireComponent("./coach-client-code-button.tsx") as typeof import("./coach-client-code-button");
const { CoachClientUnlinkConfirmation } = requireComponent("./coach-client-unlink-confirmation.tsx") as typeof import("./coach-client-unlink-confirmation");
const { CoachOverlay } = requireComponent("../../../ui/coach-overlays/coach-overlay.tsx") as typeof import("@/ui/coach-overlays/coach-overlay");
if (previousCssLoader) requireComponent.extensions[".css"] = previousCssLoader;
else delete requireComponent.extensions[".css"];

type Props = { children?: ReactNode; footer?: ReactNode; onClick?: (event: { currentTarget: HTMLElement }) => void; [key: string]: unknown };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  if (node.type === CoachClientCodeButton) {
    return elements(capture(CoachClientCodeButton, node.props as unknown as Parameters<typeof CoachClientCodeButton>[0]).tree);
  }
  return [node, ...elements(node.props.children), ...elements(node.props.footer)];
}
function buttons(node: ReactNode) { return elements(node).filter((element) => element.type === "button"); }
function capture<P extends object>(Component: (props: P) => ReactNode, props: P) {
  let tree: ReactNode = null;
  function Harness() { tree = Component(props); return tree; }
  return { markup: renderToStaticMarkup(createElement(Harness)), tree };
}
const focus = { backgroundRef: { current: null }, restoreFocusRef: { current: null } };
const click = { currentTarget: {} as HTMLElement };
function code(): CoachClientCodeView {
  return { code: "AB2-CD3-EF4", isBusy: false, isCopied: false, isResent: false, canCopy: true, canShare: true, canResend: true,
    resendLabel: "Reenviar correo", canRetryDelivery: true, retryDeliveryLabel: "Reintentar entrega pendiente",
    deliveryLabel: "Estado de entrega provisto", expiryLabel: "Vencimiento provisto", hint: "Ayuda aprobada provista", message: null };
}
function active(): Extract<CoachClientDetailView, { state: "active" }> {
  return { id: "client-active", state: "active", isOpen: true, isBusy: false, canClose: true, email: "active@example.test", identity: { name: "Identidad consentida", initials: "IC" },
    statusDescription: null, actionLabel: "Desvincular a Identidad consentida", canAct: true, message: null,
    facts: { linkedOnLabel: "Fecha vínculo provista", lastTrainingLabel: "Último día provisto", sessionsLabel: "Sesiones provistas" }, cycle: null };
}
function pending(): Extract<CoachClientDetailView, { state: "pending" }> {
  return { id: "client-pending", state: "pending", isOpen: true, isBusy: false, canClose: true, email: "pending@example.test", statusDescription: "Solicitud pendiente de aceptación",
    actionLabel: "Cancelar solicitud", canAct: true, message: null, facts: { requestedOnLabel: "Fecha solicitud provista", waitingLabel: "Espera provista" }, code: code() };
}
function inactive(): Extract<CoachClientDetailView, { state: "inactive" }> {
  return { id: "client-inactive", state: "inactive", isOpen: true, isBusy: false, canClose: true, email: "historic@example.test", identity: { name: "Identidad histórica autorizada", initials: "IH" },
    statusDescription: "Ya no entrena contigo", actionLabel: "Volver a vincular", canAct: true, message: null,
    facts: { linkedOnLabel: "Vínculo histórico provisto", unlinkedOnLabel: "Baja provista" }, historyNote: "Nota histórica autorizada" };
}
function confirmation(state: "active" | "pending" = "active"): CoachClientUnlinkConfirmationView {
  const base = { id: `client-${state}`, isOpen: true, isBusy: false, canConfirm: true, message: null };
  return state === "active" ? { ...base, state, subjectLabel: "Nombre consentido" } : { ...base, state };
}

test("closed detail has no orphan confirmation, identity or actionable fragments", () => {
  assert.equal(capture(CoachClientDetailSheet, { ...focus, view: { ...active(), isOpen: false }, confirmation: confirmation(), actions: {} }).markup, "");
  assert.equal(capture(CoachClientUnlinkConfirmation, { ...focus, view: { ...confirmation(), isOpen: false } }).markup, "");
});

test("pending renders email only in heading and accessible markup even if untyped data includes private identity/activity", () => {
  const forbidden = "NEVER_PRIVATE_NAME";
  const view = { ...pending(), name: forbidden, initials: "ZZ_PRIVATE", identity: { name: forbidden, initials: "ZZ_PRIVATE" }, lastTrainingLabel: "PRIVATE_ACTIVITY" } as unknown as CoachClientDetailView;
  const { markup } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: null, actions: {} });
  assert.match(markup, /<h2[^>]*>pending@example\.test<\/h2>/);
  for (const copy of [forbidden, "ZZ_PRIVATE", "PRIVATE_ACTIVITY", "Último entrenamiento", "Sesiones del ciclo", "Ver su ciclo y rutinas"]) assert.ok(!markup.includes(copy));
  for (const copy of ["Solicitud registrada", "Correo", "Espera", "SU CÓDIGO DE VINCULACIÓN", "PENDIENTE"]) assert.ok(markup.includes(copy));
});

test("pending mobile actions stack full-width and detail scroll remains viewport-bound", () => {
  const codeCss = readFileSync("src/features/coach-clients/components/coach-client-code-card.module.css", "utf8");
  const detailCss = readFileSync("src/features/coach-clients/components/coach-client-detail-sheet.module.css", "utf8");
  assert.match(codeCss, /@container \(max-width: 430px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*width: 100%;[\s\S]*white-space: normal/);
  assert.match(detailCss, /\.detailLayer \{[^}]*position: fixed;[^}]*overflow: hidden;/);
  assert.match(detailCss, /\.body \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
});

test("active without a cycle remains active and unavailable cycle destination cannot navigate", () => {
  let opened = 0;
  const { markup, tree } = capture(CoachClientDetailContent, { view: active(), disabled: false, actions: { onOpenCycle: () => { opened++; } } });
  assert.match(markup, /ACTIVO/); assert.doesNotMatch(markup, /PENDIENTE|Entrenando con ciclo vigente|SU CÓDIGO/);
  const cycle = buttons(tree)[0]; assert.equal(cycle.props.disabled, true); assert.equal(cycle.props.onClick, undefined); assert.equal(opened, 0);
  assert.match(markup, /data-known="false">—/);
});

test("active cycle requires both an explicit capability and callback then forwards only the stable client id", () => {
  const calls: string[] = [];
  const view = { ...active(), cycle: { label: "Ciclo autorizado provisto", canOpen: true } };
  const { tree, markup } = capture(CoachClientDetailContent, { view, disabled: false, actions: { onOpenCycle: (id) => calls.push(id) } });
  assert.match(markup, /Ciclo autorizado provisto/); buttons(tree)[0].props.onClick?.(click);
  assert.deepEqual(calls, ["client-active"]);
  const noRoute = capture(CoachClientDetailContent, { view, disabled: false, actions: {} });
  assert.equal(buttons(noRoute.tree)[0].props.disabled, true);
});

test("inactive uses only authorized historical facts and relink emits the exact email, not a mutation", () => {
  const emails: string[] = []; const view = inactive();
  const { tree, markup } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: null, actions: { onRelink: (email) => emails.push(email) } });
  for (const label of ["Identidad histórica autorizada", "Vinculado desde", "Desvinculado el", "Nota histórica autorizada"]) assert.ok(markup.includes(label));
  assert.doesNotMatch(markup, /Ver su ciclo y rutinas|SU CÓDIGO|Último entrenamiento/);
  buttons(tree).find((button) => button.props.children === "Volver a vincular")?.props.onClick?.(click);
  assert.deepEqual(emails, ["historic@example.test"]); assert.equal(view.state, "inactive");
});

test("unknown detail facts and identity remain explicit unknowns without fictitious zero activity", () => {
  const view: CoachClientDetailView = { ...active(), identity: { name: null, initials: null }, facts: { linkedOnLabel: null, lastTrainingLabel: null, sessionsLabel: null } };
  const { markup } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: null, actions: {} });
  assert.match(markup, /<h2[^>]*>active@example\.test<\/h2>/);
  assert.equal((markup.match(/<dd data-known="false">—/g) ?? []).length, 3);
  assert.doesNotMatch(markup, /0 de 0|0 sesiones|\bHoy\b|\bayer\b/);
});

test("opening unlink forwards the detail id and state and never confirms it during render or click", () => {
  const calls: unknown[] = [];
  for (const view of [active(), pending()]) {
    const { tree } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: null, actions: {
      onOpenUnlink: (id, state) => calls.push([id, state]), onConfirmUnlink: () => assert.fail("must not confirm"),
    } });
    buttons(tree).find((button) => button.props.children === view.actionLabel)?.props.onClick?.(click);
  }
  assert.deepEqual(calls, [["client-active", "active"], ["client-pending", "pending"]]);
});

test("confirmation must match both detail id and state; stale or inactive confirmations do not mount", () => {
  for (const [view, modal] of [[active(), confirmation("pending")], [active(), { ...confirmation(), id: "different-client" }],
    [inactive(), { ...confirmation(), id: inactive().id }]] as const) {
    const { markup } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: modal, actions: {} });
    assert.equal((markup.match(/role="dialog"/g) ?? []).length, 1); assert.doesNotMatch(markup, /Sí, desvincular|Sí, cancelar solicitud/);
  }
});

test("valid confirmation stays above the mounted detail with separate background and disables lower actions", () => {
  const { tree, markup } = capture(CoachClientDetailSheet, { ...focus, view: active(), confirmation: confirmation(), actions: { onCancelDetail: () => assert.fail("covered"), onOpenUnlink: () => assert.fail("covered") } });
  assert.equal((markup.match(/role="dialog"/g) ?? []).length, 2);
  const lower = elements(tree).find((element) => element.props["data-client-detail"] === active().id)!;
  const upper = elements(tree).find((element) => element.type === CoachClientUnlinkConfirmation)!;
  assert.equal(upper.props.backgroundRef, lower.props.ref); assert.notEqual(upper.props.backgroundRef, focus.backgroundRef);
  assert.equal(elements(lower).some((element) => element.type === CoachClientUnlinkConfirmation), false);
  for (const button of buttons(lower)) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); }
});

test("busy or missing detail capabilities disable primary and close without adding hidden writes", () => {
  for (const view of [{ ...active(), isBusy: true }, { ...active(), canAct: false }]) {
    const { tree } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: null, actions: { onOpenUnlink: () => assert.fail("blocked") } });
    assert.equal(buttons(tree).find((button) => button.props.children === view.actionLabel)?.props.onClick, undefined);
  }
  const missing = capture(CoachClientDetailSheet, { ...focus, view: pending(), confirmation: null, actions: {} });
  assert.ok(buttons(missing.tree).every((button) => button.props.disabled));
});

test("unresolved operation can recover but cannot close or cancel its invitation", () => {
  let recovered = 0;
  const view = { ...pending(), canClose: false, canAct: false, code: {
    ...code(), canResend: true, resendLabel: "Revisar estado",
  } };
  const { tree } = capture(CoachClientDetailSheet, { ...focus, view, confirmation: null, actions: {
    onCancelDetail: () => assert.fail("must preserve tracking"),
    onOpenUnlink: () => assert.fail("must preserve invitation"),
    onResend: () => { recovered++; },
  } });
  const close = buttons(tree).find((button) => button.props["aria-label"] === "Cerrar")!;
  assert.equal(close.props.disabled, true);
  assert.equal(close.props.onClick, undefined);
  const detailContent = elements(tree).find((element) => element.type === CoachClientDetailContent)!;
  const content = capture(
    CoachClientDetailContent,
    detailContent.props as unknown as Parameters<typeof CoachClientDetailContent>[0],
  );
  const codeCard = elements(content.tree).find((element) => element.type === CoachClientCodeCard)!;
  const card = capture(
    CoachClientCodeCard,
    codeCard.props as unknown as Parameters<typeof CoachClientCodeCard>[0],
  );
  buttons(card.tree).find((button) => (
    Array.isArray(button.props.children)
      ? button.props.children.includes("Revisar estado")
      : button.props.children === "Revisar estado"
  ))?.props.onClick?.(click);
  assert.equal(recovered, 1);
});

test("copy/share/resend/retry dispatch callbacks only; copied and resent never become optimistic successes", () => {
  const calls: string[] = []; const view = code();
  const props = { view, onCopy: () => calls.push("copy"), onShare: () => calls.push("share"),
    onResend: () => calls.push("resend"), onRetryDelivery: () => calls.push("retry") };
  const { tree, markup } = capture(CoachClientCodeCard, props);
  assert.deepEqual(calls, []);
  buttons(tree).forEach((button) => button.props.onClick?.(click));
  assert.deepEqual(calls, ["copy", "share", "resend", "retry"]);
  const after = capture(CoachClientCodeCard, props).markup;
  assert.equal(after, markup); assert.doesNotMatch(after, /Copiado|Correo reenviado|data-done="true"|data-copied="true"/);
});

test("only confirmed copy/resent props show confirmation, while delivery capabilities remain authoritative", () => {
  let calls = 0;
  const view = { ...code(), isCopied: true, isResent: true, resendLabel: "Correo reenviado",
    canResend: true, canRetryDelivery: false };
  const { tree, markup } = capture(CoachClientCodeCard, { view, onResend: () => { calls++; } });
  assert.match(markup, /data-copied="true"/); assert.match(markup, /role="status" aria-live="polite">Copiado/);
  assert.match(markup, /data-done="true"/); assert.match(markup, /Correo reenviado/);
  assert.doesNotMatch(markup, /Reintentar entrega pendiente/);
  const resend = buttons(tree).find((button) => button.props["data-done"] === true)!;
  assert.equal(resend.props.disabled, false); resend.props.onClick?.(click); assert.equal(calls, 1);
  const denied = capture(CoachClientCodeCard, { view: { ...view, canResend: false }, onResend: () => assert.fail("server denied") });
  assert.equal(buttons(denied.tree).find((button) => button.props["data-done"] === true)?.props.onClick, undefined);
});

test("code missing/null cannot be copied or shared and delivery/expiry remain external rather than inferred", () => {
  for (const missing of [null, "", "   "]) {
    const { tree, markup } = capture(CoachClientCodeCard, { view: { ...code(), code: missing, isCopied: true, isResent: null, deliveryLabel: "Reserva creada, entrega no confirmada" },
      onCopy: () => assert.fail("no code"), onShare: () => assert.fail("no code") });
    assert.equal(buttons(tree)[0].props.disabled, true); assert.equal(buttons(tree)[1].props.disabled, true);
    assert.doesNotMatch(markup, /Copiado|Correo reenviado/); assert.match(markup, /Reserva creada, entrega no confirmada/);
    assert.match(markup, /Vencimiento provisto/);
  }
});

test("busy/disabled/missing code callbacks remove actions without DOM clipboard or navigation work", () => {
  for (const props of [{ view: { ...code(), isBusy: true }, onCopy: () => {}, onShare: () => {}, onResend: () => {}, onRetryDelivery: () => {} },
    { view: code(), disabled: true, onCopy: () => {}, onShare: () => {}, onResend: () => {}, onRetryDelivery: () => {} }, { view: code() }]) {
    const { tree } = capture(CoachClientCodeCard, props);
    for (const button of buttons(tree)) { assert.equal(button.props.disabled, true); assert.equal(button.props.onClick, undefined); }
  }
});

test("code, wait and errors render supplied values verbatim and escape markup", () => {
  const { markup } = capture(CoachClientCodeCard, { view: { ...code(), code: "<script>fixture</script>", message: { tone: "error", label: "Límite de servidor provisto" } } });
  assert.match(markup, /&lt;script&gt;fixture&lt;\/script&gt;/); assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /role="alert">Límite de servidor provisto/); assert.match(markup, /Ayuda aprobada provista/);
});

test("active vs pending confirmation has distinct complete copy and never promises future access to history", () => {
  const activeMarkup = capture(CoachClientUnlinkConfirmation, { ...focus, view: confirmation() }).markup;
  const pendingMarkup = capture(CoachClientUnlinkConfirmation, { ...focus, view: { ...confirmation("pending"), subjectLabel: "PRIVATE_SUBJECT" } as unknown as CoachClientUnlinkConfirmationView }).markup;
  for (const copy of ["¿Desvincular a Nombre consentido?", "no podrás ver ni editar sus rutinas", "Su historial de entrenamientos se conserva", "Sí, desvincular", "Mantener vinculado"]) assert.ok(activeMarkup.includes(copy));
  for (const copy of ["¿Cancelar la solicitud?", "Su código deja de servir", "No le avisamos nada por correo", "Sí, cancelar solicitud", "Mantener la solicitud"]) assert.ok(pendingMarkup.includes(copy));
  assert.doesNotMatch(pendingMarkup, /PRIVATE_SUBJECT|rutinas|historial/); assert.doesNotMatch(activeMarkup, /No le avisamos nada|podrás volver a ver/);
});

test("confirmation puts destructive outlined action first and safe blue action last as initial focus", () => {
  const calls: unknown[] = [];
  const { tree } = capture(CoachClientUnlinkConfirmation, { ...focus, view: confirmation("pending"), onConfirm: (id, state) => calls.push([id, state]), onCancel: () => calls.push("cancel") });
  const controls = buttons(tree);
  assert.deepEqual(controls.map((button) => button.props.children), ["Sí, cancelar solicitud", "Mantener la solicitud"]);
  assert.equal(controls[0].props.className, "danger"); assert.equal(controls[1].props.className, "primary");
  assert.equal(controls[1].props["data-modal-initial-focus"], "");
  controls[0].props.onClick?.(click); assert.deepEqual(calls, [["client-pending", "pending"]]);
  controls[1].props.onClick?.(click); assert.deepEqual(calls, [["client-pending", "pending"], "cancel"]);
});

test("confirmation busy, denied capability and missing callbacks never invoke destructive actions", () => {
  for (const view of [{ ...confirmation(), isBusy: true }, { ...confirmation(), canConfirm: false }]) {
    const { tree } = capture(CoachClientUnlinkConfirmation, { ...focus, view, onConfirm: () => assert.fail("blocked") });
    assert.equal(buttons(tree)[0].props.disabled, true); assert.equal(buttons(tree)[0].props.onClick, undefined);
  }
  const missing = capture(CoachClientUnlinkConfirmation, { ...focus, view: confirmation() });
  assert.ok(buttons(missing.tree).every((button) => button.props.disabled));
});

test("shared confirmation scrim only cancels upper layer and never calls its confirm action", () => {
  let cancel = 0;
  const { tree, markup } = capture(CoachOverlay, { ...focus, variant: "client-confirm", titleId: "confirmation", isOpen: true, isBusy: false,
    children: createElement("h2", { id: "confirmation" }, "Confirmación"), footer: null, onCancel: () => { cancel++; } });
  assert.match(markup, /role="dialog"/); assert.doesNotMatch(markup, /class="grip"/);
  const scrim = buttons(tree)[0]; assert.equal(scrim.props["aria-label"], "Cancelar"); scrim.props.onClick?.(click); assert.equal(cancel, 1);
});
