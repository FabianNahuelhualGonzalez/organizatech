"use client";

import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import {
  buildCycleHistoryListViewModels,
  type CycleHistoryListPresentationState,
} from "@/lib/training/cycle-history/cycle-history-view-model";

import { CycleHistoryList } from "./CycleHistoryList";
import {
  CycleHistoryDisabledState,
  CycleHistoryEmptyState,
  CycleHistoryErrorState,
  CycleHistoryIdleState,
  CycleHistoryLoadingState,
} from "./CycleHistoryStates";
import styles from "./cycle-history.module.css";

const EMPTY_CYCLES_MESSAGE = "Todavía no tienes ciclos de entrenamiento registrados.";

/**
 * Pantalla controlada del historial de ciclos.
 *
 * No consulta Supabase, no instancia repositorios ni el coordinator real de H1-B:
 * recibe todo por props/callbacks. `expandedCycleId` y `detailState` deben ser
 * gobernados por el caller (H1-D) usando `cycle-history-service.ts` y
 * `cycle-history-coordinator.ts` de H1-B; esta pantalla solo los presenta.
 */
export interface CycleHistoryScreenProps {
  listState: CycleHistoryListPresentationState;
  expandedCycleId: string | null;
  detailState: CycleHistoryLoadState;
  onToggleCycle: (cycleId: string) => void;
  onRetry: (cycleId: string) => void;
  onDownloadPdf: (cycleId: string) => void;
  isPdfActionBusy?: boolean;
}

export function CycleHistoryScreen({
  listState,
  expandedCycleId,
  detailState,
  onToggleCycle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy = false,
}: CycleHistoryScreenProps) {
  return (
    <section className={styles.screen} aria-label="Historial de ciclos de entrenamiento">
      <header className={styles.screenHeader}>
        <h1 className={styles.title}>Revisa tu historial de ciclo de entrenamiento</h1>
        <p className={styles.subtitle}>
          Podrás visualizar y descargar en PDF toda la información de tu ciclo de entrenamiento.
        </p>
        <hr className={styles.headerDivider} />
      </header>

      <CycleHistoryListState
        listState={listState}
        expandedCycleId={expandedCycleId}
        detailState={detailState}
        onToggleCycle={onToggleCycle}
        onRetry={onRetry}
        onDownloadPdf={onDownloadPdf}
        isPdfActionBusy={isPdfActionBusy}
      />
    </section>
  );
}

function CycleHistoryListState({
  listState,
  expandedCycleId,
  detailState,
  onToggleCycle,
  onRetry,
  onDownloadPdf,
  isPdfActionBusy,
}: {
  listState: CycleHistoryListPresentationState;
  expandedCycleId: string | null;
  detailState: CycleHistoryLoadState;
  onToggleCycle: (cycleId: string) => void;
  onRetry: (cycleId: string) => void;
  onDownloadPdf: (cycleId: string) => void;
  isPdfActionBusy: boolean;
}) {
  switch (listState.status) {
    case "idle":
      return <CycleHistoryIdleState />;
    case "disabled":
      return <CycleHistoryDisabledState />;
    case "loading":
      return <CycleHistoryLoadingState label="Cargando historial de ciclos…" />;
    case "error":
      return <CycleHistoryErrorState message={listState.error.message} />;
    case "empty":
      return <CycleHistoryEmptyState message={EMPTY_CYCLES_MESSAGE} />;
    case "ready": {
      const cycles = buildCycleHistoryListViewModels(listState.cycles);
      if (cycles.length === 0) {
        return <CycleHistoryEmptyState message={EMPTY_CYCLES_MESSAGE} />;
      }
      return (
        <CycleHistoryList
          cycles={cycles}
          expandedCycleId={expandedCycleId}
          detailState={detailState}
          onToggleCycle={onToggleCycle}
          onRetry={onRetry}
          onDownloadPdf={onDownloadPdf}
          isPdfActionBusy={isPdfActionBusy}
        />
      );
    }
  }
}
