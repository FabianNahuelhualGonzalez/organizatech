"use client";

import { Check, Mail } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientInviteDraftView } from "./coach-add-client-view";
import { CoachClientInvitationSteps } from "./coach-client-invitation-steps";
import styles from "./coach-client-invite-email-step.module.css";

export function CoachClientInviteEmailStep({ view, formId, inputId, hintId, isBusy, canSubmit, onChange, onSubmit }: {
  readonly view: CoachClientInviteDraftView;
  readonly formId: string;
  readonly inputId: string;
  readonly hintId: string;
  readonly isBusy: boolean;
  readonly canSubmit: boolean;
  readonly onChange?: (raw: string) => void;
  readonly onSubmit?: () => void;
}) {
  const editable = view.action === "submit" && !isBusy && Boolean(onChange);
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
    <CoachClientInvitationSteps variant="before" steps={view.steps} />
  </form>;
}
