import type { CoachMonthView } from "./coach-dashboard-view";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-monthly-chart.module.css";

export function CoachMonthDetail({ month }: { readonly month: CoachMonthView }) {
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <h4>{month.fullLabel}</h4>
        {month.readingLabel !== null ? (
          <span className={`${styles.tag} ${common.tone}`} data-tone={month.readingTone}>{month.readingLabel}</span>
        ) : null}
      </div>
      <dl className={styles.metrics}>
        <div>
          <dt className={common.label}>ALUMNOS</dt>
          <dd className={common.number} data-known={month.students.value !== null}>{month.students.label}</dd>
        </div>
        <div>
          <dt className={common.label}>NUEVOS</dt>
          <dd className={`${common.number} ${common.tone}`} data-tone="ok" data-known={month.joined.value !== null}>{month.joined.label}</dd>
        </div>
        <div>
          <dt className={common.label}>BAJAS</dt>
          <dd className={`${common.number} ${common.tone}`} data-tone={month.leftTone} data-known={month.left.value !== null}>{month.left.label}</dd>
        </div>
      </dl>
      <div className={styles.income}>
        <span>Ingreso estimado del mes</span>
        <strong className={common.number} data-known={month.estimatedIncome.value !== null}>{month.estimatedIncome.label}</strong>
      </div>
    </div>
  );
}
