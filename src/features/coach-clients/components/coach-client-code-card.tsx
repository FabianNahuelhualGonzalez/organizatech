"use client";

import { Check } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientCodeView } from "./coach-client-detail-view";
import { CoachClientCodeButton } from "./coach-client-code-button";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-client-code-card.module.css";

export function CoachClientCodeCard({ view, disabled = false, onCopy, onShare, onResend }: {
  readonly view: CoachClientCodeView;
  readonly disabled?: boolean;
  readonly onCopy?: () => void;
  readonly onShare?: () => void;
  readonly onResend?: () => void;
}) {
  const available = !disabled && !view.isBusy;
  const hasCode = Boolean(view.code?.trim());
  const canShare = available && hasCode && view.canShare && Boolean(onShare);
  const canResend = available && view.canResend && Boolean(onResend);
  return <section className={styles.card} aria-label="Su código de vinculación" aria-busy={view.isBusy}>
    <h3>SU CÓDIGO DE VINCULACIÓN</h3>
    <CoachClientCodeButton code={view.code} isCopied={view.isCopied} canCopy={view.canCopy}
      isBusy={disabled || view.isBusy} onCopy={onCopy} />
    {view.hint !== null ? <p className={styles.hint}>{view.hint}</p> : null}
    {view.deliveryLabel !== null ? <p className={styles.hint}>{view.deliveryLabel}</p> : null}
    {view.expiryLabel !== null ? <p className={styles.hint}>{view.expiryLabel}</p> : null}
    <div className={styles.actions}>
      <button className={styles.action} type="button" disabled={!canShare} onClick={canShare ? onShare : undefined}>Enviar por WhatsApp</button>
      <button className={styles.action} type="button" data-done={view.isResent === true} disabled={!canResend}
        onClick={canResend ? onResend : undefined}>{view.isResent === true ? <Check size={13} aria-hidden="true" /> : null}{view.resendLabel}</button>
    </div>
    {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
  </section>;
}
