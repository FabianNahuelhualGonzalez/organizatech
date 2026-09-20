"use client";

import { useId } from "react";
import type { CoachRenewalsView } from "./coach-dashboard-view";
import { coachChartRatio } from "./coach-chart-geometry";
import { CoachRenewalRow } from "./coach-renewal-row";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-renewals-card.module.css";

export function CoachRenewalsCard({ view, onSelect }: {
  readonly view: CoachRenewalsView;
  readonly onSelect?: (id: string) => void;
}) {
  const titleId = useId();
  const visibleSegments = view.stack?.segments.flatMap((segment) => {
    const ratio = coachChartRatio(segment.ratio);
    return ratio !== null && ratio > 0 ? [{ state: segment.state, ratio }] : [];
  }) ?? [];
  return (
    <section className={common.card} aria-labelledby={titleId}>
      <div className={common.padding}>
        <h3 className={common.heading} id={titleId}>{view.title}</h3>
        <p className={common.description}>{view.description}</p>
        <div className={styles.figure}>
          <span className={`${styles.amount} ${common.number}`} data-known={view.atStake.value !== null}>{view.atStake.label}</span>
          {view.atStake.value !== null ? <span className={styles.unit}>en juego</span> : null}
        </div>
        {view.stack !== null ? (
          <>
            {visibleSegments.length > 0 ? (
              <div className={styles.stack} role="img" aria-label={view.stack.ariaLabel}>
                {visibleSegments.map((segment) => (
                  <span key={segment.state} className={styles.segment} data-state={segment.state}
                    aria-hidden="true" style={{ flexGrow: segment.ratio }} />
                ))}
              </div>
            ) : null}
            <ul className={styles.legend}>
              {view.stack.segments.map((segment) => segment.state === "declined" && segment.ratio === 0 ? null : (
                <li key={segment.state}>
                  <span className={`${common.dot} ${styles.state}`} data-state={segment.state} aria-hidden="true" />
                  <span>{segment.label}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      {view.rows.length === 0 && view.emptyLabel !== null ? <p className={common.empty}>{view.emptyLabel}</p> : null}
      <ul className={styles.list}>
        {view.rows.map((row) => <li key={row.id}><CoachRenewalRow row={row} onSelect={onSelect} /></li>)}
      </ul>
      {view.retentionLabel !== null ? <p className={styles.footer}>{view.retentionLabel}</p> : null}
    </section>
  );
}
