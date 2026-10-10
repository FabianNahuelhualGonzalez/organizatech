"use client";

import { Check, Mail } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientInviteDraftView } from "./coach-add-client-view";
import { CoachClientInvitationSteps } from "./coach-client-invitation-steps";
import styles from "./coach-client-invite-email-step.module.css";

const FREQUENCIES = [
  ["daily", "Diaria"], ["weekly", "Semanal"], ["monthly", "Mensual"],
  ["quarterly", "Trimestral"], ["semiannual", "Semestral"], ["annual", "Anual"],
] as const;

export function CoachClientInviteEmailStep({ view, formId, inputId, hintId, isBusy, canSubmit, onChange, onAmountChange, onFrequencyChange, onSubmit }: {
  readonly view: CoachClientInviteDraftView;
  readonly formId: string;
  readonly inputId: string;
  readonly hintId: string;
  readonly isBusy: boolean;
  readonly canSubmit: boolean;
  readonly onChange?: (raw: string) => void;
  readonly onAmountChange?: (raw: string) => void;
  readonly onFrequencyChange?: (value: string) => void;
  readonly onSubmit?: () => void;
}) {
  const editable = view.canEdit && !isBusy && Boolean(onChange);
  const error = view.validation.tone === "err" ? view.validation.errorLabel : null;
  return <form id={formId} className={styles.form} noValidate onSubmit={(event) => {
    event.preventDefault(); if (canSubmit && !isBusy) onSubmit?.();
  }}>
    <div className={styles.fieldGroup}>
      <label htmlFor={inputId}>Correo del alumno</label>
      <div className={styles.field} data-tone={view.validation.tone}>
        <Mail size={15} aria-hidden="true" />
        <input id={inputId} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="nombre@correo.com" value={view.emailRaw} disabled={!editable}
          aria-invalid={view.validation.tone === "err" ? true : undefined}
          aria-describedby={error !== null ? `${inputId}-error ${hintId}` : hintId}
          data-modal-initial-focus={editable ? "" : undefined}
          onChange={editable ? (event) => onChange?.(event.currentTarget.value) : undefined} />
        {view.validation.tone === "ok" ? <Check className={styles.ok} size={15} aria-hidden="true" /> : null}
      </div>
    </div>
    {error !== null ? <div className={styles.error}><span aria-hidden="true" />
      <StatusMessage id={`${inputId}-error`} tone="error">{error}</StatusMessage></div> : null}
    <div className={styles.fieldGroup}>
      <label htmlFor={`${inputId}-amount`}>Monto de asesoría (CLP)</label>
      <div className={styles.field} data-tone={view.amountRaw && !view.amountValid ? "err" : "neutral"}>
        <input id={`${inputId}-amount`} type="number" inputMode="numeric" min="1" max="1000000000000" step="1" required
          value={view.amountRaw} disabled={!editable || !onAmountChange}
          aria-invalid={view.amountRaw && !view.amountValid ? true : undefined}
          onChange={editable ? (event) => onAmountChange?.(event.currentTarget.value) : undefined} />
      </div>
    </div>
    <div className={styles.fieldGroup}>
      <label htmlFor={`${inputId}-frequency`}>Frecuencia de cobro</label>
      <div className={styles.field}>
        <select id={`${inputId}-frequency`} required value={view.frequency} disabled={!editable || !onFrequencyChange}
          onChange={editable ? (event) => onFrequencyChange?.(event.currentTarget.value) : undefined}>
          <option value="">Selecciona una frecuencia</option>
          {FREQUENCIES.map(([frequency, label]) => <option value={frequency} key={frequency}>{label}</option>)}
        </select>
      </div>
    </div>
    <CoachClientInvitationSteps variant="before" steps={view.steps} />
  </form>;
}
