"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachFeeSheetProps } from "./coach-dashboard-sheet-view";
import { CoachDashboardSheet } from "./coach-dashboard-sheet";
import { COACH_FEE_PRESETS } from "./coach-fee-presets";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-fee-sheet.module.css";

export function CoachFeeSheet({ view, onRawChange, onPreset, onSave, onCancel, backgroundRef, restoreFocusRef }: CoachFeeSheetProps) {
  const id = useId();
  const canSave = view.isOpen && !view.isBusy && !view.isInvalid && view.canSave && view.feeRaw !== null
    && view.feeRaw.trim() !== "" && Boolean(onSave);
  const canEdit = view.isOpen && !view.isBusy;
  return (
    <CoachDashboardSheet isOpen={view.isOpen} isBusy={view.isBusy} titleId={`${id}-title`} variant="fee"
      backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef} onCancel={onCancel}
      footer={<button className={shared.primary} type="button" disabled={!canSave} aria-busy={view.isBusy}
        onClick={canSave ? onSave : undefined}>Guardar tarifa</button>}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <h2 id={`${id}-title`}>Tu tarifa mensual</h2>
          <p>Con esto calculamos tus ingresos. Sólo la ves tú.</p>
        </div>
        <button className={styles.close} type="button" aria-label="Cerrar" disabled={!canEdit || !onCancel}
          onClick={canEdit ? onCancel : undefined}><span><X size={13} strokeWidth={2.5} aria-hidden="true" /></span></button>
      </div>
      <div className={styles.body}>
        <label className={styles.label} htmlFor={`${id}-input`}>Cobro por alumno al mes</label>
        <div className={styles.field}>
          <span className={styles.currency} aria-hidden="true">$</span>
          <input id={`${id}-input`} type="text" inputMode="numeric" value={view.feeRaw ?? ""}
            disabled={!canEdit || !onRawChange} data-modal-initial-focus={canEdit && onRawChange ? "" : undefined}
            aria-describedby={view.isInvalid && view.message ? `${id}-unit ${id}-message` : `${id}-unit`}
            aria-invalid={view.isInvalid ? true : undefined}
            onChange={canEdit && onRawChange ? (event) => onRawChange(event.currentTarget.value) : undefined} />
          <span className={styles.unit} id={`${id}-unit`}>CLP / mes</span>
        </div>
        <div className={styles.presets}>
          {COACH_FEE_PRESETS.map((preset) => <button key={preset.id} className={styles.preset} type="button"
            data-fee={preset.id} aria-pressed={view.selectedPreset === preset.id} disabled={!canEdit || !onPreset}
            onClick={canEdit && onPreset ? () => onPreset(preset.id) : undefined}>{preset.label}</button>)}
        </div>
        <section className={styles.preview} aria-labelledby={`${id}-preview`}>
          <h3 id={`${id}-preview`}>ASÍ QUEDA TU MES</h3>
          <dl>{view.preview.map((row, index) => <div className={styles.previewRow} key={index} data-scenario={index}>
            <dt>{row.label}</dt><dd data-known={row.amount.value !== null}>{row.amount.label}</dd>
          </div>)}</dl>
        </section>
        {view.message ? <StatusMessage id={`${id}-message`} className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
      </div>
    </CoachDashboardSheet>
  );
}
