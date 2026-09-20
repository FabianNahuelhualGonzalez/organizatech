"use client";

import { useId } from "react";
import { CoachOverlay } from "@/ui/coach-overlays/coach-overlay";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientUnlinkConfirmationProps } from "./coach-client-detail-view";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-client-unlink-confirmation.module.css";

export function CoachClientUnlinkConfirmation({ view, onConfirm, onCancel, backgroundRef, restoreFocusRef }: CoachClientUnlinkConfirmationProps) {
  const id = useId();
  const pending = view.state === "pending";
  const canConfirm = view.isOpen && !view.isBusy && view.canConfirm && Boolean(onConfirm);
  const canCancel = view.isOpen && !view.isBusy && Boolean(onCancel);
  return <CoachOverlay variant="client-confirm" isOpen={view.isOpen} isBusy={view.isBusy} titleId={`${id}-title`}
    backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef} onCancel={onCancel}
    footer={<>
      <button className={styles.danger} type="button" disabled={!canConfirm} aria-busy={view.isBusy}
        onClick={canConfirm ? () => onConfirm?.(view.id, view.state) : undefined}>{pending ? "Sí, cancelar solicitud" : "Sí, desvincular"}</button>
      <button className={shared.primary} type="button" disabled={!canCancel} data-modal-initial-focus={canCancel ? "" : undefined}
        onClick={canCancel ? onCancel : undefined}>{pending ? "Mantener la solicitud" : "Mantener vinculado"}</button>
    </>}>
    <div className={styles.body}>
      <h2 id={`${id}-title`}>{pending ? "¿Cancelar la solicitud?" : `¿Desvincular a ${view.subjectLabel}?`}</h2>
      <p>{pending ? "Su código deja de servir. Si más adelante quiere entrenar contigo, tendrás que enviarle una solicitud nueva."
        : "Deja de aparecer en tus clientes activos y no podrás ver ni editar sus rutinas."}</p>
      <p>{pending ? "No le avisamos nada por correo."
        : "Su historial de entrenamientos se conserva. Puedes volver a vincularlo con un código nuevo."}</p>
      {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
    </div>
  </CoachOverlay>;
}
