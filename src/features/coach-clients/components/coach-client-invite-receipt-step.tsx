"use client";

import { Check, MessageCircle } from "lucide-react";
import type { CoachClientInvitationReceiptView } from "./coach-add-client-view";
import { CoachClientInvitationSteps } from "./coach-client-invitation-steps";
import { CoachClientCodeButton } from "./coach-client-code-button";
import styles from "./coach-client-invite-receipt-step.module.css";

export function CoachClientInviteReceiptStep({ view, isBusy, onCopy, onShare }: {
  readonly view: CoachClientInvitationReceiptView;
  readonly isBusy: boolean;
  readonly onCopy?: (invitationId: string) => void;
  readonly onShare?: (invitationId: string) => void;
}) {
  const canShare = !isBusy && view.canShare && Boolean(onShare);
  return <>
    <div className={styles.receipt} data-delivery={view.delivery} role="status" aria-live="polite">
      <span className={styles.icon}><Check size={15} aria-hidden="true" /></span>
      <div className={styles.receiptCopy}><p className={styles.delivery}>{view.deliveryLabel}</p><p className={styles.email}>{view.email}</p></div>
    </div>
    <section className={styles.codeBlock} aria-label="Código de vinculación">
      <h3>CÓDIGO DE VINCULACIÓN</h3>
      <CoachClientCodeButton size="receipt" code={view.code} isCopied={view.isCopied} isBusy={isBusy} canCopy={view.canCopy}
        onCopy={onCopy ? () => onCopy(view.id) : undefined} />
      <p className={styles.hint}>{view.copyHint}</p>
    </section>
    <button className={styles.share} type="button" disabled={!canShare} onClick={canShare ? () => onShare?.(view.id) : undefined}>
      <MessageCircle size={16} aria-hidden="true" />Enviar el código por WhatsApp
    </button>
    <CoachClientInvitationSteps variant="after" steps={view.steps} />
  </>;
}
