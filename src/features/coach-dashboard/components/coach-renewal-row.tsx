"use client";

import type { CoachRenewalRowView } from "./coach-dashboard-view";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-renewals-card.module.css";

export function CoachRenewalRow({ row, onSelect }: {
  readonly row: CoachRenewalRowView;
  readonly onSelect?: (id: string) => void;
}) {
  return (
    <button className={common.row} type="button" data-renewal-id={row.id} data-state={row.state}
      aria-label={row.ariaLabel} disabled={!onSelect}
      onClick={onSelect ? () => onSelect(row.id) : undefined}>
      <span className={`${common.dot} ${styles.state}`} data-state={row.state} aria-hidden="true" />
      <span className={common.body}>
        <span className={common.name}>{row.clientName}</span>
        <span className={common.srOnly}>{row.stateLabel}</span>
        <span className={`${common.subtitle} ${common.tone}`} data-tone={row.subtitleTone}>{row.subtitle}</span>
      </span>
      <span className={common.right}>
        {row.endDateLabel !== null ? <span className={`${common.when} ${common.number}`}>{row.endDateLabel}</span> : null}
        {row.remainingLabel !== null ? <span className={common.date}>{row.remainingLabel}</span> : null}
      </span>
    </button>
  );
}
