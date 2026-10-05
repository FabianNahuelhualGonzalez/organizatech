"use client";

import { useId, useRef } from "react";
import { Mail, UserRound, X } from "lucide-react";
import { CoachOverlay } from "@/ui/coach-overlays/coach-overlay";
import type { CoachClientDetailSheetProps } from "./coach-client-detail-view";
import { CoachClientDetailContent } from "./coach-client-detail-content";
import { CoachClientUnlinkConfirmation } from "./coach-client-unlink-confirmation";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-client-detail-sheet.module.css";

export function CoachClientDetailSheet({ view, confirmation, actions, backgroundRef, restoreFocusRef }: CoachClientDetailSheetProps) {
  const id = useId();
  const detailBackgroundRef = useRef<HTMLDivElement>(null);
  const unlinkTriggerRef = useRef<HTMLElement>(null);
  if (!view.isOpen) return null;
  const confirmationMatches = confirmation?.isOpen === true && confirmation.id === view.id && confirmation.state === view.state;
  const disabled = view.isBusy || confirmationMatches;
  const canAct = !disabled && view.canAct && (view.state === "inactive" ? Boolean(actions.onRelink) : Boolean(actions.onOpenUnlink));
  const name = view.state === "pending" ? view.email : view.identity.name ?? view.email;
  return <>
    <div className={styles.detailLayer} ref={detailBackgroundRef} data-client-detail={view.id}>
      <CoachOverlay variant="client-detail" isOpen={view.isOpen} isBusy={view.isBusy} isObscured={confirmationMatches}
        titleId={`${id}-title`} backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef}
        onCancel={view.canClose ? actions.onCancelDetail : undefined}
        footer={<button className={view.state === "inactive" ? shared.primary : styles.danger} type="button"
          disabled={!canAct} onClick={canAct ? (event) => {
            if (view.state === "inactive") { actions.onRelink?.(view.email); return; }
            unlinkTriggerRef.current = event.currentTarget;
            actions.onOpenUnlink?.(view.id, view.state);
          } : undefined}>{view.actionLabel}</button>}>
        <div className={styles.header}>
          <span className={styles.avatar} data-state={view.state} aria-hidden="true">{view.state === "pending" ? <Mail size={19} /> : view.identity.initials ?? <UserRound size={20} />}</span>
          <div className={styles.heading}><h2 id={`${id}-title`}>{name}</h2>
            {view.state !== "pending" ? <p>{view.email}</p> : null}</div>
          <button className={styles.close} type="button" aria-label="Cerrar" disabled={disabled || !view.canClose || !actions.onCancelDetail}
            onClick={!disabled && view.canClose ? actions.onCancelDetail : undefined}><span><X size={13} aria-hidden="true" /></span></button>
        </div>
        <CoachClientDetailContent view={view} disabled={disabled} actions={actions} />
      </CoachOverlay>
    </div>
    {confirmationMatches && confirmation ? <CoachClientUnlinkConfirmation view={{ ...confirmation, isBusy: view.isBusy || confirmation.isBusy }}
      backgroundRef={detailBackgroundRef} restoreFocusRef={unlinkTriggerRef}
      onConfirm={actions.onConfirmUnlink} onCancel={actions.onCancelUnlink} /> : null}
  </>;
}
