"use client";

import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import type { CycleHistoryCardViewModel } from "@/lib/training/cycle-history/cycle-history-view-model";

import { CycleHistoryCard } from "./CycleHistoryCard";
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

const IDLE_DETAIL_STATE: CycleHistoryLoadState = { status: "idle" };

export function CycleHistoryList({
  cycles,
  expandedCycleId,
  detailState,
  onToggleCycle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy = false,
}: CycleHistoryListProps) {
  return (
    <ul className={styles.list}>
      {cycles.map((cycle) => {
        const isExpanded = expandedCycleId === cycle.cycleId;
        return (
          <li key={cycle.cycleId} className={styles.listItem}>
            <CycleHistoryCard
              cycle={cycle}
              isExpanded={isExpanded}
              detailState={isExpanded ? detailState : IDLE_DETAIL_STATE}
              onToggle={() => onToggleCycle(cycle.cycleId)}
              onRetry={() => onRetry(cycle.cycleId)}
              onDownloadPdf={() => onDownloadPdf(cycle.cycleId)}
              isPdfActionBusy={isPdfActionBusy}
            />
          </li>
        );
      })}
    </ul>
  );
}
