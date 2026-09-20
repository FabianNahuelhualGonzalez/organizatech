"use client";

import { useId, type CSSProperties } from "react";
import type { CoachMonthlyChartView } from "./coach-dashboard-view";
import { coachChartRatio } from "./coach-chart-geometry";
import { CoachMonthDetail } from "./coach-month-detail";
import common from "./coach-dashboard-card.module.css";
import styles from "./coach-monthly-chart.module.css";

export function CoachMonthlyChart({ view, onSelectMonth }: {
  readonly view: CoachMonthlyChartView;
  readonly onSelectMonth?: (id: string) => void;
}) {
  const titleId = useId();
  // Resolving the controlled selected row is presentational, never a default month.
  const selected = view.months.find((month) => month.id === view.selectedMonthId);
  return (
    <section className={`${common.card} ${styles.card}`} aria-labelledby={titleId}>
      <div className={common.padding}>
        <h3 className={common.heading} id={titleId}>Tus asesorías mes a mes</h3>
        <p className={common.description}>Toca cualquier mes para ver su detalle.</p>
      </div>
      {view.months.length === 0 && view.emptyLabel !== null ? <p className={common.empty}>{view.emptyLabel}</p> : null}
      {view.months.length > 0 ? (
        <div className={styles.chart}>
          <div className={styles.columns} role="group" aria-label="Alumnos por mes">
            {view.months.map((month) => {
              const ratio = month.students.value === null ? null : coachChartRatio(month.barRatio);
              return (
                <button key={month.id} className={styles.column} type="button" data-month-id={month.id}
                  data-best={month.isBest} aria-label={month.ariaLabel}
                  aria-pressed={month.id === view.selectedMonthId} disabled={!onSelectMonth}
                  onClick={onSelectMonth ? () => onSelectMonth(month.id) : undefined}>
                  <span className={`${styles.count} ${common.number}`} data-known={month.students.value !== null}>{month.students.label}</span>
                  {ratio !== null ? <span className={styles.bar} aria-hidden="true" style={{ "--bar-ratio": ratio } as CSSProperties} /> : null}
                  <span className={styles.monthLabel}>{month.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div aria-live="polite" aria-atomic="true">
        {selected ? <CoachMonthDetail month={selected} /> : view.noSelectionLabel !== null ? <p className={common.empty}>{view.noSelectionLabel}</p> : null}
      </div>
    </section>
  );
}
