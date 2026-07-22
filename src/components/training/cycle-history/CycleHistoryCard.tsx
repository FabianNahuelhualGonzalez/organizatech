"use client";

import { ChevronDown, Download } from "lucide-react";

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
import { CycleHistoryRoutineBreakdown } from "./CycleHistoryRoutineBreakdown";
import { CycleHistorySummary } from "./CycleHistorySummary";
import styles from "./cycle-history.module.css";

export interface CycleHistoryCardProps {
  cycle: CycleHistoryCardViewModel;
  isExpanded: boolean;
  detailState: CycleHistoryLoadState;
  onToggle: () => void;
  onRetry: () => void;
  onDownloadPdf: () => void;
  isPdfActionBusy?: boolean;
}

export function CycleHistoryCard({
  cycle,
  isExpanded,
  detailState,
  onToggle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy = false,
}: CycleHistoryCardProps) {
  const detailId = buildCycleHistoryDetailDomId(cycle.cycleId);
  const headingId = buildCycleHistoryHeadingDomId(cycle.cycleId);

  return (
    <article className={`${styles.card} ${isExpanded ? styles.cardExpanded : ""}`}>
      <button
        type="button"
        className={styles.cardTrigger}
        aria-expanded={isExpanded}
        aria-controls={detailId}
        id={headingId}
        onClick={onToggle}
      >
        <span className={styles.cardTriggerMain}>
          <span className={styles.cardEyebrow}>{cycle.eyebrowLabel}</span>
          <span className={styles.cardTitle}>{cycle.title}</span>
          {cycle.cycleTypeLabel ? <span className={styles.cardChip}>{cycle.cycleTypeLabel}</span> : null}
        </span>
        <span className={styles.cardMeta}>
          <span className={styles.cardStatus}>{cycle.statusLabel}</span>
          <span className={styles.cardDate}>{cycle.dateRangeLabel}</span>
          <span className={styles.cardDuration}>{cycle.durationLabel}</span>
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={`${styles.cardChevron} ${isExpanded ? styles.cardChevronOpen : ""}`}
        />
      </button>

      {isExpanded ? (
        <div id={detailId} role="region" aria-labelledby={headingId} className={styles.cardDetail}>
          <CycleHistoryCardDetail
            detailState={detailState}
            onRetry={onRetry}
            onDownloadPdf={onDownloadPdf}
            isPdfActionBusy={isPdfActionBusy}
          />
        </div>
      ) : null}
    </article>
  );
}

function CycleHistoryCardDetail({
  detailState,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy,
}: {
  detailState: CycleHistoryLoadState;
  onRetry: () => void;
  onDownloadPdf: () => void;
  isPdfActionBusy: boolean;
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
      return (
        <>
          <CycleHistorySummary detail={detailViewModel} />
          <CycleHistoryRoutineBreakdown detail={detailViewModel} />
          <div className={styles.cardActions}>
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
        </>
      );
    }
  }
}
