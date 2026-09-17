"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachRenewalDatesModalProps } from "./coach-renewal-detail-view";
import { CoachDashboardSheet } from "./coach-dashboard-sheet";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-renewal-dates-modal.module.css";

export function CoachRenewalDatesModal({ view, actions, backgroundRef, restoreFocusRef }: CoachRenewalDatesModalProps) {
  const id = useId();
  const canEdit = view.isOpen && !view.isBusy;
  const canAccept = canEdit && view.canAccept && view.acceptLabel === "Confirmar fechas" && !view.startInvalid && !view.endInvalid
    && view.validation?.kind === "ok" && Boolean(view.startRaw?.trim()) && Boolean(view.endRaw?.trim()) && Boolean(actions.onAcceptDates);
  const fields = [
    { field: "start", label: "Inicio", raw: view.startRaw, min: view.startMin, invalid: view.startInvalid },
    { field: "end", label: "Término", raw: view.endRaw, min: view.endMin, invalid: view.endInvalid },
  ] as const;
  return (
    <CoachDashboardSheet isOpen={view.isOpen} isBusy={view.isBusy} titleId={`${id}-title`} variant="dates"
      backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef} onCancel={actions.onCancelDates}
      footer={<button className={shared.primary} type="button" disabled={!canAccept} aria-busy={view.isBusy}
        onClick={canAccept ? actions.onAcceptDates : undefined}>{view.acceptLabel}</button>}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>PAGADO</p>
          <h2 id={`${id}-title`}>¿Qué período cubre el pago?</h2>
          <p className={styles.description}>Indica las fechas pagadas de {view.subjectLabel ?? "—"}. No cambian su ciclo de entrenamiento.</p>
        </div>
        <button className={styles.close} type="button" aria-label="Cancelar" disabled={!canEdit || !actions.onCancelDates}
          onClick={canEdit ? actions.onCancelDates : undefined}><span><X size={13} aria-hidden="true" /></span></button>
      </div>
      <div className={styles.body}>
        <div className={styles.fields}>
          {fields.map((field) => <div key={field.field}>
            <label htmlFor={`${id}-${field.field}`}>{field.label}</label>
            <input id={`${id}-${field.field}`} type="date" value={field.raw ?? ""} min={field.min ?? undefined}
              data-field={field.field} disabled={!canEdit || !actions.onChangeDates} aria-invalid={field.invalid ? true : undefined}
              aria-describedby={view.validation ? `${id}-validation` : undefined}
              data-modal-initial-focus={field.field === "start" && canEdit && actions.onChangeDates ? "" : undefined}
              onChange={canEdit && actions.onChangeDates ? (event) => actions.onChangeDates?.(field.field, event.currentTarget.value) : undefined} />
          </div>)}
        </div>
        {view.validation ? <div className={styles.note} data-kind={view.validation.kind}>
          <span aria-hidden="true" /><StatusMessage id={`${id}-validation`} tone="polite">{view.validation.label}</StatusMessage>
        </div> : null}
        {view.pauseLabel !== null ? <p className={styles.pause}>{view.pauseLabel}</p> : null}
        {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
      </div>
    </CoachDashboardSheet>
  );
}
