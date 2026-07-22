import type {
  CycleHistoryDetailViewModel,
  CycleHistoryToneKind,
} from "@/lib/training/cycle-history/cycle-history-view-model";

import styles from "./cycle-history.module.css";

const TONE_CLASS_NAME: Record<CycleHistoryToneKind, string> = {
  positive: styles.tonePositive,
  negative: styles.toneNegative,
  neutral: styles.toneNeutral,
};

export function CycleHistorySummary({ detail }: { detail: CycleHistoryDetailViewModel }) {
  return (
    <section className={styles.summary} aria-label="Resumen del ciclo">
      <div className={styles.metricGrid}>
        {detail.metricCards.map((metric) => (
          <div className={styles.metricCard} key={metric.label}>
            <p className={styles.metricLabel}>{metric.label}</p>
            <strong className={styles.metricValue}>{metric.value}</strong>
            <p className={styles.metricCaption}>{metric.caption}</p>
          </div>
        ))}
      </div>
      <p className={`${styles.progressBanner} ${TONE_CLASS_NAME[detail.volumeProgress.tone]}`}>
        {detail.volumeProgress.text}
      </p>
      <p className={styles.summaryMeta}>
        {detail.weeksWithDataLabel} · {detail.sessionCountLabel}
      </p>
    </section>
  );
}
