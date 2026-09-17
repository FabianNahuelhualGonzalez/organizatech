"use client";

import { useId } from "react";
import type { CoachIncomeView } from "./coach-dashboard-view";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-income-card.module.css";

export function CoachIncomeCard({ view, onEditFee }: {
  readonly view: CoachIncomeView;
  readonly onEditFee?: () => void;
}) {
  const titleId = useId();
  return (
    <section className={`${common.card} ${styles.card}`} aria-labelledby={titleId}>
      <div className={styles.main}>
        <div className={styles.head}>
          <h3 id={titleId} className={`${common.eyebrow} ${styles.heading}`}>INGRESO DE ESTE MES</h3>
          <button className={styles.edit} type="button" disabled={!onEditFee} onClick={onEditFee}>
            <span>Editar tarifa</span>
          </button>
        </div>
        <div className={styles.figure}>
          <span className={`${common.number} ${styles.amount}`} data-known={view.amount.value !== null}>{view.amount.label}</span>
          {view.comparisonLabel !== null ? (
            <span className={`${common.tone} ${styles.delta}`} data-tone={view.comparisonTone}>{view.comparisonLabel}</span>
          ) : null}
        </div>
        {view.formulaLabel !== null ? <p className={common.description}>{view.formulaLabel}</p> : null}
        <p className={common.note}>Ingresos estimados, no pagos cobrados.</p>
      </div>
      <div className={styles.split}>
        <div>
          <p className={common.label}>EN RIESGO ESTE MES</p>
          <strong className={`${common.number} ${common.tone}`} data-tone="pending" data-known={view.atRisk.value !== null}>{view.atRisk.label}</strong>
          {view.atRiskNote !== null ? <p className={common.note}>{view.atRiskNote}</p> : null}
        </div>
        <div>
          <p className={common.label}>{view.potentialLabel}</p>
          <strong className={`${common.number} ${common.tone}`} data-tone="ok" data-known={view.potential.value !== null}>{view.potential.label}</strong>
          {view.potentialNote !== null ? <p className={common.note}>{view.potentialNote}</p> : null}
        </div>
      </div>
    </section>
  );
}
