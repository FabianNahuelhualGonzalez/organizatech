"use client";

import {
  buildCycleHistoryDetailDomId,
  buildCycleHistoryHeadingDomId,
  type CycleHistoryCardViewModel,
} from "@/lib/training/cycle-history/cycle-history-view-model";

import styles from "./cycle-history.module.css";

export interface CycleHistoryCompactCycleProps {
  cycle: CycleHistoryCardViewModel;
  onToggle: () => void;
}

/** Barra compacta de un ciclo no seleccionado (diseño aprobado H1-C.2). Al pulsarla pasa a ser el ciclo seleccionado. */
export function CycleHistoryCompactCycle({ cycle, onToggle }: CycleHistoryCompactCycleProps) {
  const detailId = buildCycleHistoryDetailDomId(cycle.cycleId);
  const headingId = buildCycleHistoryHeadingDomId(cycle.cycleId);

  return (
    <button
      type="button"
      id={headingId}
      aria-expanded={false}
      aria-controls={detailId}
      className={styles.compactBar}
      onClick={onToggle}
    >
      {cycle.barLabel}
    </button>
  );
}
