"use client";

import { useId } from "react";
import type { CoachAlertsView } from "./coach-dashboard-view";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-alerts-card.module.css";

export function CoachAlertsCard({ view, onAdd, onAlert, onViewAlerts }: {
  readonly view: CoachAlertsView;
  readonly onAdd?: () => void;
  readonly onAlert?: (id: string) => void;
  readonly onViewAlerts?: () => void;
}) {
  const titleId = useId();
  return (
    <section className={`${common.card} ${styles.card}`} aria-labelledby={titleId}>
      <div className={styles.head}>
        <div className={common.body}>
          <h3 id={titleId} className={common.heading}>Requieren tu atención</h3>
          <p className={common.description}>{view.description}</p>
        </div>
        <button className={styles.add} type="button" disabled={!onAdd} onClick={onAdd}><span>Agregar</span></button>
      </div>
      {view.rows.length === 0 && view.emptyLabel !== null ? <p className={common.empty}>{view.emptyLabel}</p> : null}
      <ul className={styles.list}>
        {view.rows.map((row) => (
          <li key={row.id}>
            <button className={`${common.row} ${styles.row}`} type="button" data-alert-id={row.id}
              disabled={!onAlert} onClick={onAlert ? () => onAlert(row.id) : undefined}>
              <span className={styles.avatar} aria-hidden="true">{row.initials}</span>
              <span className={common.body}>
                <span className={common.name}>{row.clientName}</span>
                <span className={`${common.subtitle} ${common.tone}`} data-tone={row.tone}>{row.reason}</span>
              </span>
              <span className={common.right}>
                {row.whenLabel !== null ? <span className={`${common.when} ${common.tone}`} data-tone={row.tone}>{row.whenLabel}</span> : null}
                {row.dateLabel !== null ? <span className={common.date}>{row.dateLabel}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {view.footerLabel !== null ? (
        <button className={styles.footer} type="button" disabled={!onViewAlerts} onClick={onViewAlerts}>{view.footerLabel}</button>
      ) : null}
    </section>
  );
}
