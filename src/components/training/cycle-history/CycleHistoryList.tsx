"use client";

import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import type { CycleHistoryCardViewModel } from "@/lib/training/cycle-history/cycle-history-view-model";

import { CycleHistoryCompactCycle } from "./CycleHistoryCompactCycle";
import { CycleHistorySelectedCycle } from "./CycleHistorySelectedCycle";
import styles from "./cycle-history.module.css";

export interface CycleHistoryListProps {
  cycles: CycleHistoryCardViewModel[];
  expandedCycleId: string | null;
  detailState: CycleHistoryLoadState;
  onToggleCycle: (cycleId: string) => void;
  onRetry: (cycleId: string) => void;
  onDownloadPdf: (cycleId: string) => void;
  isPdfActionBusy?: boolean;
}

/**
 * Diseño aprobado H1-C.2: el ciclo seleccionado se muestra fijo arriba (barra + fecha
 * + PDF + métricas), y el resto de los ciclos aparece debajo como barras compactas,
 * sin repetir el seleccionado. Nunca hay más de un ciclo expandido: `resolveNextExpandedCycleId`
 * (H1-D) sigue siendo la única fuente de verdad de la regla de expansión única.
 */
export function CycleHistoryList({
  cycles,
  expandedCycleId,
  detailState,
  onToggleCycle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy = false,
}: CycleHistoryListProps) {
  const selectedCycle = cycles.find((cycle) => cycle.cycleId === expandedCycleId) ?? null;
  const otherCycles = selectedCycle ? cycles.filter((cycle) => cycle.cycleId !== selectedCycle.cycleId) : cycles;

  return (
    <div className={styles.historyLayout}>
      {selectedCycle ? (
        <CycleHistorySelectedCycle
          cycle={selectedCycle}
          detailState={detailState}
          onToggle={() => onToggleCycle(selectedCycle.cycleId)}
          onRetry={() => onRetry(selectedCycle.cycleId)}
          onDownloadPdf={() => onDownloadPdf(selectedCycle.cycleId)}
          isPdfActionBusy={isPdfActionBusy}
        />
      ) : null}

      {otherCycles.length > 0 ? (
        <ul className={styles.compactList}>
          {otherCycles.map((cycle) => (
            <li key={cycle.cycleId} className={styles.compactListItem}>
              <CycleHistoryCompactCycle cycle={cycle} onToggle={() => onToggleCycle(cycle.cycleId)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
