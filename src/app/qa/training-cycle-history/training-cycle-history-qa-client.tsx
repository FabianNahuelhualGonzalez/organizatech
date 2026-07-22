"use client";

import { useEffect, useRef, useState } from "react";

import { CycleHistoryScreen } from "@/components/training/cycle-history/CycleHistoryScreen";
import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import {
  resolveNextExpandedCycleId,
  type CycleHistoryListPresentationState,
} from "@/lib/training/cycle-history/cycle-history-view-model";

import {
  QA_CYCLES,
  QA_SIMULATED_ERROR,
  getQaDetailForCycle,
} from "./training-cycle-history-qa-fixtures";
import styles from "./training-cycle-history-qa.module.css";

type QaListScenario = "idle" | "disabled" | "loading" | "empty" | "error" | "ready";

const QA_LIST_SCENARIOS: Array<{ id: QaListScenario; label: string }> = [
  { id: "idle", label: "Idle" },
  { id: "disabled", label: "Disabled" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
  { id: "ready", label: "Ready" },
];

type TimerRef = { current: number | null };

/** Cancela un timer pendiente registrado en `ref`, si existe. */
function clearScheduledTimer(ref: TimerRef) {
  if (ref.current !== null) {
    window.clearTimeout(ref.current);
    ref.current = null;
  }
}

/**
 * Reemplaza cualquier timer previo guardado en `ref` (evita timers residuales al
 * repetir/cambiar rápidamente de simulación) y registra el nuevo id en el mismo ref
 * para poder cancelarlo desde un cleanup de useEffect.
 */
function scheduleTimer(ref: TimerRef, delay: number, callback: () => void) {
  clearScheduledTimer(ref);
  ref.current = window.setTimeout(() => {
    ref.current = null;
    callback();
  }, delay);
}

function buildListState(scenario: QaListScenario): CycleHistoryListPresentationState {
  switch (scenario) {
    case "idle":
      return { status: "idle" };
    case "disabled":
      return { status: "disabled" };
    case "loading":
      return { status: "loading" };
    case "empty":
      return { status: "empty", cycles: [] };
    case "error":
      return { status: "error", error: QA_SIMULATED_ERROR };
    case "ready":
      return { status: "ready", cycles: QA_CYCLES };
  }
}

/**
 * Cliente QA aislado para probar visualmente CycleHistoryScreen con fixtures
 * estáticos. No consulta Supabase, no importa repositorios ni el data source o
 * el coordinator reales de H1-B: toda la carga de detalle es simulada localmente.
 */
export function TrainingCycleHistoryQaClient() {
  const [listScenario, setListScenario] = useState<QaListScenario>("ready");
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<CycleHistoryLoadState>({ status: "idle" });
  const [simulateDetailError, setSimulateDetailError] = useState(false);
  const [isPdfActionBusy, setIsPdfActionBusy] = useState(false);
  const [lastPdfCallback, setLastPdfCallback] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const detailTimerRef = useRef<number | null>(null);
  const pdfTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearScheduledTimer(detailTimerRef);
      clearScheduledTimer(pdfTimerRef);
    };
  }, []);

  function loadDetail(cycleId: string) {
    setDetailState({ status: "loading", cycleId });
    scheduleTimer(detailTimerRef, 400, () => {
      if (!isMountedRef.current) return;

      if (simulateDetailError) {
        setDetailState({ status: "error", cycleId, error: QA_SIMULATED_ERROR });
        return;
      }

      const detail = getQaDetailForCycle(cycleId);
      if (!detail) {
        setDetailState({
          status: "error",
          cycleId,
          error: { code: "cycle_not_found", message: "No encontramos el ciclo seleccionado." },
        });
        return;
      }

      setDetailState(
        detail.breakdown.weeksWithData.length === 0
          ? { status: "empty", cycleId, data: detail }
          : { status: "ready", cycleId, data: detail },
      );
    });
  }

  function handleToggleCycle(cycleId: string) {
    const nextExpandedCycleId = resolveNextExpandedCycleId(expandedCycleId, cycleId);
    setExpandedCycleId(nextExpandedCycleId);

    if (nextExpandedCycleId === null) {
      setDetailState({ status: "idle" });
      return;
    }

    loadDetail(nextExpandedCycleId);
  }

  function handleRetry(cycleId: string) {
    loadDetail(cycleId);
  }

  function handleDownloadPdf(cycleId: string) {
    setIsPdfActionBusy(true);
    setLastPdfCallback(cycleId);
    scheduleTimer(pdfTimerRef, 600, () => {
      if (!isMountedRef.current) return;
      setIsPdfActionBusy(false);
    });
  }

  return (
    <main className={styles.shell}>
      <section className={styles.controls}>
        <p className={styles.eyebrow}>Herramienta QA temporal · Historial de ciclos (H1-C)</p>
        <h2 className={styles.heading}>Escenarios del listado</h2>
        <div className={styles.buttons}>
          {QA_LIST_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              className={styles.button}
              aria-pressed={listScenario === scenario.id}
              onClick={() => setListScenario(scenario.id)}
            >
              {scenario.label}
            </button>
          ))}
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={simulateDetailError}
            onChange={(event) => setSimulateDetailError(event.target.checked)}
          />
          Simular error al cargar el detalle
        </label>
        {lastPdfCallback ? (
          <p className={styles.log}>
            onDownloadPdf invocado para: <strong>{lastPdfCallback}</strong>
          </p>
        ) : null}
      </section>

      <CycleHistoryScreen
        listState={buildListState(listScenario)}
        expandedCycleId={expandedCycleId}
        detailState={detailState}
        onToggleCycle={handleToggleCycle}
        onRetry={handleRetry}
        onDownloadPdf={handleDownloadPdf}
        isPdfActionBusy={isPdfActionBusy}
      />
    </main>
  );
}
