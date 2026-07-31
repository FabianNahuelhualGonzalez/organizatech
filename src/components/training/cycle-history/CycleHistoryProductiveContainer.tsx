"use client";

import { useEffect, useMemo, useState } from "react";

import { createCycleHistoryAppController } from "@/lib/training/cycle-history/cycle-history-app-controller";
import { createCycleHistoryLoadCoordinator } from "@/lib/training/cycle-history/cycle-history-coordinator";
import { createRepositoryCycleHistoryDataSource } from "@/lib/training/cycle-history/cycle-history-data-source";
import {
  createLegacyCycleHistoryServiceAdapter,
  type LegacyCycleHistorySnapshot,
} from "@/lib/training/cycle-history/cycle-history-legacy-adapter";
import { createCycleHistoryPdfActionController } from "@/lib/training/cycle-history/cycle-history-pdf-action";
import { createCycleHistoryService } from "@/lib/training/cycle-history/cycle-history-service";

import { CycleHistoryScreen } from "./CycleHistoryScreen";

export interface CycleHistoryProductiveContainerProps {
  enabled: boolean;
  identityKey: string | null;
  legacySnapshots: readonly LegacyCycleHistorySnapshot[];
}

/**
 * Capa productiva por identidad. Los repositorios obtienen el usuario desde la
 * sesión Supabase; identityKey solo delimita el ciclo de vida de caché/estado.
 * Cuando esa ruta no está habilitada, el adaptador local conserva el fallback
 * demo sin consultar repositories ni convertir snapshots en datos Supabase.
 */
export function CycleHistoryProductiveContainer({
  enabled,
  identityKey,
  legacySnapshots,
}: CycleHistoryProductiveContainerProps) {
  const lifecycle = useMemo(() => {
    const repositoryAccessEnabled = enabled && Boolean(identityKey);
    const legacyModeEnabled = !enabled;
    const service = legacyModeEnabled
      ? createLegacyCycleHistoryServiceAdapter({ snapshots: legacySnapshots })
      : createCycleHistoryService({
          trainingCyclesRepositoryEnabled: repositoryAccessEnabled,
          dataSource: createRepositoryCycleHistoryDataSource(),
        });
    const coordinator = createCycleHistoryLoadCoordinator(service);
    return {
      controller: createCycleHistoryAppController({
        enabled: repositoryAccessEnabled || legacyModeEnabled,
        service,
        coordinator,
      }),
      pdfActionController: createCycleHistoryPdfActionController(),
    };
  }, [enabled, identityKey, legacySnapshots]);
  const { controller, pdfActionController } = lifecycle;
  const [snapshot, setSnapshot] = useState(() => ({
    controller,
    state: controller.getState(),
  }));
  const [pdfSnapshot, setPdfSnapshot] = useState(() => ({
    controller: pdfActionController,
    state: pdfActionController.getState(),
  }));
  const state = snapshot.controller === controller ? snapshot.state : controller.getState();
  const pdfState = pdfSnapshot.controller === pdfActionController
    ? pdfSnapshot.state
    : pdfActionController.getState();

  useEffect(() => {
    const updateState = (nextState: ReturnType<typeof controller.getState>) => {
      setSnapshot({ controller, state: nextState });
    };
    setSnapshot({ controller, state: controller.getState() });
    const unsubscribe = controller.subscribe(updateState);
    void controller.loadList();

    return () => {
      unsubscribe();
      controller.invalidateAll();
    };
  }, [controller]);

  useEffect(() => {
    const updatePdfState = (nextState: ReturnType<typeof pdfActionController.getState>) => {
      setPdfSnapshot({ controller: pdfActionController, state: nextState });
    };
    setPdfSnapshot({ controller: pdfActionController, state: pdfActionController.getState() });
    const unsubscribe = pdfActionController.subscribe(updatePdfState);

    return () => {
      unsubscribe();
      pdfActionController.invalidate();
    };
  }, [pdfActionController]);

  function handleDownloadPdf(cycleId: string) {
    const requestedDetailState = controller.getState().detailState;
    void pdfActionController.generate(
      cycleId,
      requestedDetailState,
      (requestedCycleId, capturedDetailState) => {
        const currentState = controller.getState();
        return currentState.expandedCycleId === requestedCycleId &&
          currentState.detailState === capturedDetailState;
      },
    );
  }

  return (
    <CycleHistoryScreen
      listState={state.listState}
      expandedCycleId={state.expandedCycleId}
      detailState={state.detailState}
      onRetryList={() => void controller.retryList()}
      onToggleCycle={(cycleId) => void controller.toggleCycle(cycleId)}
      onRetry={(cycleId) => void controller.retryCycle(cycleId)}
      onDownloadPdf={handleDownloadPdf}
      isPdfActionBusy={pdfState.isBusy}
      pdfActionError={
        pdfState.cycleId === state.expandedCycleId ? pdfState.error : null
      }
    />
  );
}
