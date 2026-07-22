"use client";

import { useEffect, useMemo, useState } from "react";

import { createCycleHistoryAppController } from "@/lib/training/cycle-history/cycle-history-app-controller";
import { createCycleHistoryLoadCoordinator } from "@/lib/training/cycle-history/cycle-history-coordinator";
import { createRepositoryCycleHistoryDataSource } from "@/lib/training/cycle-history/cycle-history-data-source";
import { createCycleHistoryService } from "@/lib/training/cycle-history/cycle-history-service";

import { CycleHistoryScreen } from "./CycleHistoryScreen";

export interface CycleHistoryProductiveContainerProps {
  enabled: boolean;
  identityKey: string | null;
  onDownloadPdf?: (cycleId: string) => void;
}

function preservePdfCallbackContract(cycleId: string) {
  // La generación/descarga real pertenece a una fase posterior.
  void cycleId;
}

/**
 * Capa productiva por identidad. Los repositorios obtienen el usuario desde la
 * sesión Supabase; identityKey solo delimita el ciclo de vida de caché/estado.
 */
export function CycleHistoryProductiveContainer({
  enabled,
  identityKey,
  onDownloadPdf = preservePdfCallbackContract,
}: CycleHistoryProductiveContainerProps) {
  const controller = useMemo(() => {
    const accessEnabled = enabled && Boolean(identityKey);
    const service = createCycleHistoryService({
      trainingCyclesRepositoryEnabled: accessEnabled,
      dataSource: createRepositoryCycleHistoryDataSource(),
    });
    const coordinator = createCycleHistoryLoadCoordinator(service);
    return createCycleHistoryAppController({
      enabled: accessEnabled,
      service,
      coordinator,
    });
  }, [enabled, identityKey]);
  const [snapshot, setSnapshot] = useState(() => ({
    controller,
    state: controller.getState(),
  }));
  const state = snapshot.controller === controller ? snapshot.state : controller.getState();

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

  return (
    <CycleHistoryScreen
      listState={state.listState}
      expandedCycleId={state.expandedCycleId}
      detailState={state.detailState}
      onRetryList={() => void controller.retryList()}
      onToggleCycle={(cycleId) => void controller.toggleCycle(cycleId)}
      onRetry={(cycleId) => void controller.retryCycle(cycleId)}
      onDownloadPdf={onDownloadPdf}
      isPdfActionBusy={false}
    />
  );
}
