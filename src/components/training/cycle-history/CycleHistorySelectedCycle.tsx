"use client";

import { Download } from "lucide-react";

import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import {
  buildCycleHistoryDetailDomId,
  buildCycleHistoryDetailViewModel,
  buildCycleHistoryErrorViewModel,
  buildCycleHistoryHeadingDomId,
  isCycleHistoryPdfActionDisabled,
  type CycleHistoryCardViewModel,
} from "@/lib/training/cycle-history/cycle-history-view-model";

import { CycleHistoryEmptyState, CycleHistoryErrorState, CycleHistoryLoadingState } from "./CycleHistoryStates";
import { CycleHistorySummary } from "./CycleHistorySummary";
import styles from "./cycle-history.module.css";

export interface CycleHistorySelectedCycleProps {
  cycle: CycleHistoryCardViewModel;
  detailState: CycleHistoryLoadState;
  onToggle: () => void;
  onRetry: () => void;
  onDownloadPdf: () => void;
  isPdfActionBusy?: boolean;
}

// El ciclo seleccionado se expande inline y conserva su posición original en la lista.
export function CycleHistorySelectedCycle({
  cycle,
  detailState,
  onToggle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy = false,
}: CycleHistorySelectedCycleProps) {
  const detailId = buildCycleHistoryDetailDomId(cycle.cycleId);
  const headingId = buildCycleHistoryHeadingDomId(cycle.cycleId);

  return (
    <div className={styles.selectedSection}>
      <button
        type="button"
        id={headingId}
        aria-expanded={true}
        aria-controls={detailId}
        className={styles.selectedBar}
        onClick={onToggle}
      >
        {cycle.barLabel}
      </button>

      <div id={detailId} role="region" aria-labelledby={headingId} className={styles.selectedDetail}>
        <div className={styles.dateAndPdfRow}>
          <p className={styles.dateLabel}>Fecha: {cycle.dateRowLabel}</p>
          <button
            type="button"
            className={styles.pdfButton}
            onClick={onDownloadPdf}
            disabled={isCycleHistoryPdfActionDisabled(detailState.status, isPdfActionBusy)}
          >
            <Download size={16} aria-hidden="true" />
            {isPdfActionBusy ? "Generando PDF…" : "Descargar PDF"}
          </button>
        </div>

        <CycleHistorySelectedCycleBody detailState={detailState} onRetry={onRetry} />
      </div>
    </div>
  );
}

function CycleHistorySelectedCycleBody({
  detailState,
  onRetry,
}: {
  detailState: CycleHistoryLoadState;
  onRetry: () => void;
}) {
  switch (detailState.status) {
    case "idle":
    case "disabled":
      return null;
    case "loading":
      return <CycleHistoryLoadingState label="Cargando el detalle de este ciclo…" />;
    case "error":
      return (
        <CycleHistoryErrorState
          message={buildCycleHistoryErrorViewModel(detailState.error).message}
          onRetry={onRetry}
        />
      );
    case "empty":
      return <CycleHistoryEmptyState message="Este ciclo todavía no tiene semanas registradas." />;
    case "ready": {
      const detailViewModel = buildCycleHistoryDetailViewModel(detailState.data);
      return <CycleHistorySummary detail={detailViewModel} />;
    }
  }
}
