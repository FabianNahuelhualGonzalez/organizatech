"use client";

import { useId } from "react";
import type { CoachPortfolioActions, CoachPortfolioView } from "./coach-dashboard-view";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-portfolio-grid.module.css";

const CARDS = [
  { key: "active", label: "ACTIVOS", tone: "ok", note: null },
  { key: "alert", label: "EN ALERTA", tone: "pending", note: "Necesitan que los contactes" },
  { key: "pending", label: "PENDIENTES", tone: "accent", note: "Solicitud registrada, sin aceptar" },
  { key: "inactive", label: "DESVINCULADOS", tone: "neutral", note: "Ya no entrenan contigo" },
] as const;

export function CoachPortfolioGrid({ view, onSelect }: {
  readonly view: CoachPortfolioView;
  readonly onSelect?: CoachPortfolioActions;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.section}>
      <div className={styles.head}>
        <h3 id={titleId}>Tus alumnos</h3>
        {view.totalLabel !== null ? <span className={common.number}>{view.totalLabel}</span> : null}
      </div>
      <div className={styles.grid}>
        {CARDS.map((card) => (
          <button className={styles.card} key={card.key} type="button" data-state={card.key}
            disabled={!onSelect?.[card.key]} onClick={onSelect?.[card.key]}>
            <span className={styles.cardHead}>
              <span className={`${common.dot} ${common.tone}`} data-tone={card.tone} aria-hidden="true" />
              <span className={styles.label}>{card.label}</span>
            </span>
            <span className={`${common.number} ${styles.value}`} data-known={view[card.key].value !== null}>{view[card.key].label}</span>
            <span className={styles.note}>{card.note ?? view.activeNote}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
