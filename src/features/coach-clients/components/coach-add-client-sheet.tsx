"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { CoachOverlay } from "@/ui/coach-overlays/coach-overlay";
import { StatusMessage } from "@/ui/feedback/status-message";
import { isCoachInvitationReceiptReady, type CoachAddClientSheetProps } from "./coach-add-client-view";
import { CoachClientInviteEmailStep } from "./coach-client-invite-email-step";
import { CoachClientInviteReceiptStep } from "./coach-client-invite-receipt-step";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-add-client-sheet.module.css";

export function CoachAddClientSheet({ view, actions, backgroundRef, restoreFocusRef }: CoachAddClientSheetProps) {
  const id = useId();
  const receipt = view.step === "receipt" && isCoachInvitationReceiptReady(view.receipt) ? view.receipt : null;
  const canSubmit = view.isOpen && !view.isBusy && view.step === "email" && view.draft.canSubmit
    && view.draft.action !== null
    && (view.draft.action !== "submit"
      || (view.draft.validation.tone === "ok" && Boolean(view.draft.emailRaw.trim())))
    && Boolean(actions.onSubmit);
  const canOpenPending = view.isOpen && !view.isBusy && receipt?.canOpenPending === true && Boolean(actions.onOpenPendingClients);
  const canCancel = view.isOpen && !view.isBusy && Boolean(actions.onCancel);
  return <CoachOverlay variant="client-detail" isOpen={view.isOpen} isBusy={view.isBusy} titleId={`${id}-title`}
    backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef} onCancel={actions.onCancel}
    footer={<>
      {receipt ? <button className={shared.primary} type="button" disabled={!canOpenPending}
        data-modal-initial-focus={canOpenPending ? "" : undefined} onClick={canOpenPending ? () => actions.onOpenPendingClients?.("pending") : undefined}>Ir a mi lista</button>
        : <button className={shared.primary} type="submit" form={`${id}-form`} disabled={!canSubmit} aria-busy={view.isBusy}>
          {view.isBusy ? <><span className={styles.spinner} aria-hidden="true" />{view.draft.busyLabel}</> : view.draft.submitLabel}
        </button>}
      <p className={styles.footerHint} id={`${id}-hint`}>{receipt?.footerHint ?? view.draft.hint}</p>
    </>}>
    <div className={styles.header}>
      <div className={styles.heading}>
        <p className={styles.eyebrow} data-step={receipt ? "receipt" : "email"}>{receipt ? "PASO 2 DE 2 · LISTO" : "PASO 1 DE 2"}</p>
        <h2 id={`${id}-title`}>{receipt?.headingLabel ?? "Agregar un nuevo cliente"}</h2>
        <p className={styles.description}>{receipt?.descriptionLabel ?? "Necesitas el correo con el que el alumno va a usar Organizatech."}</p>
      </div>
      <button className={styles.close} type="button" aria-label="Cerrar" disabled={!canCancel} onClick={canCancel ? actions.onCancel : undefined}>
        <span><X size={13} aria-hidden="true" /></span>
      </button>
    </div>
    <div className={styles.body}>
      {receipt ? <CoachClientInviteReceiptStep view={receipt} isBusy={view.isBusy} onCopy={actions.onCopyCode} onShare={actions.onShareCode} />
        : <CoachClientInviteEmailStep view={view.draft} isBusy={view.isBusy} formId={`${id}-form`} inputId={`${id}-email`} hintId={`${id}-hint`}
          canSubmit={canSubmit} onChange={view.draft.action === "submit" ? actions.onEmailChange : undefined} onSubmit={actions.onSubmit} />}
      {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
    </div>
  </CoachOverlay>;
}
