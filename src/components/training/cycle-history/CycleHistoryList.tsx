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
  pdfActionError?: string | null;
}

/**
 * Diseño aprobado H1-C.2: cada ciclo se renderiza en su posición original de la
 * lista (orden recibido, ya provisto por H1-B: más nuevo primero). Expandir un
 * ciclo no lo mueve de lugar — solo cambia su presentación de barra compacta a
 * barra seleccionada + detalle, en el mismo puesto que ya ocupaba. Nunca hay más
 * de un ciclo expandido: `resolveNextExpandedCycleId` (H1-D) sigue siendo la única
 * fuente de verdad de la regla de expansión única.
 */
export function CycleHistoryList({
  cycles,
  expandedCycleId,
  detailState,
  onToggleCycle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy = false,
  pdfActionError = null,
}: CycleHistoryListProps) {
  return (
    <ul className={styles.historyLayout}>
      {cycles.map((cycle) => {
        const isSelected = cycle.cycleId === expandedCycleId;
        return (
          <li key={cycle.cycleId} className={styles.historyListItem}>
            {isSelected ? (
              <CycleHistorySelectedCycle
                cycle={cycle}
                detailState={detailState}
                onToggle={() => onToggleCycle(cycle.cycleId)}
                onRetry={() => onRetry(cycle.cycleId)}
                onDownloadPdf={() => onDownloadPdf(cycle.cycleId)}
                isPdfActionBusy={isPdfActionBusy}
                pdfActionError={pdfActionError}
              />
            ) : (
              <CycleHistoryCompactCycle cycle={cycle} onToggle={() => onToggleCycle(cycle.cycleId)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
