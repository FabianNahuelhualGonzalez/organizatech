"use client";

import { useId, useRef } from "react";
import { UserRound, X } from "lucide-react";
import type { CoachRenewalDetailSheetProps } from "./coach-renewal-detail-view";
import { CoachDashboardSheet } from "./coach-dashboard-sheet";
import { CoachRenewalDetailContent } from "./coach-renewal-detail-content";
import { CoachRenewalDatesModal } from "./coach-renewal-dates-modal";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-renewal-detail-sheet.module.css";

export function CoachRenewalDetailSheet({ view, dates, actions, backgroundRef, restoreFocusRef }: CoachRenewalDetailSheetProps) {
  const id = useId();
  const detailBackgroundRef = useRef<HTMLDivElement>(null);
  const datesTriggerRef = useRef<HTMLElement>(null);
  if (!view.isOpen) return null;
  const disabled = view.isBusy || dates.isOpen;
  const canSave = !disabled && view.canSave && view.saveLabel === "Listo" && Boolean(actions.onSave)
    && (view.state !== "renewed" || (view.paidPeriodDates !== null && !view.paidPeriodDates.isIncomplete));
  return <>
    <div className={styles.detailLayer} ref={detailBackgroundRef} data-renewal-detail={view.id}>
      <CoachDashboardSheet isOpen={view.isOpen} isBusy={view.isBusy} isObscured={dates.isOpen} variant="detail"
        titleId={`${id}-title`} backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef} onCancel={actions.onCancelDetail}
        footer={<button className={shared.primary} type="button" disabled={!canSave} aria-busy={view.isBusy}
          onClick={canSave ? actions.onSave : undefined}>{view.saveLabel}</button>}>
        <div className={styles.header}>
          <span className={styles.avatar} aria-hidden="true">{view.initials ?? <UserRound size={20} />}</span>
          <div className={styles.heading}><h2 id={`${id}-title`}>{view.clientName}</h2>
            {view.metaLabel !== null ? <p>{view.metaLabel}</p> : null}</div>
          <button className={styles.close} type="button" aria-label="Cerrar" disabled={disabled || !actions.onCancelDetail}
            onClick={!disabled ? actions.onCancelDetail : undefined}><span><X size={13} aria-hidden="true" /></span></button>
        </div>
        <CoachRenewalDetailContent view={view} disabled={disabled} actions={actions} triggerRef={datesTriggerRef} />
      </CoachDashboardSheet>
    </div>
    <CoachRenewalDatesModal view={dates} actions={actions} backgroundRef={detailBackgroundRef} restoreFocusRef={datesTriggerRef} />
  </>;
}
