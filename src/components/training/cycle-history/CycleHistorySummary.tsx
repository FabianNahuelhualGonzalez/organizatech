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
      <div className={styles.metricsRow}>
        {detail.metricCards.map((metric) => (
          <div className={styles.metricColumn} key={metric.label}>
            <div className={styles.metricBox}>
              <p className={styles.metricLabel}>{metric.label}</p>
              <strong className={styles.metricValue}>{metric.value}</strong>
            </div>
            <p className={styles.metricCaption}>{metric.caption}</p>
          </div>
        ))}
      </div>
      <p className={styles.progressMessage}>
        {detail.volumeProgress.prefix}
        {detail.volumeProgress.highlight ? (
          <strong className={`${styles.progressHighlight} ${TONE_CLASS_NAME[detail.volumeProgress.tone]}`}>
            {detail.volumeProgress.highlight}
          </strong>
        ) : null}
        {detail.volumeProgress.suffix}
      </p>
    </section>
  );
}
