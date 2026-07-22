import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import { downloadCycleHistoryPdf } from "@/lib/training/cycle-history/cycle-history-pdf-download";
import type { CycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import { renderCycleHistoryPdf } from "@/lib/training/cycle-history/cycle-history-pdf-renderer";

export const CYCLE_HISTORY_PDF_PUBLIC_ERROR = "No pudimos generar el PDF. Inténtalo nuevamente.";

export interface CycleHistoryPdfActionState {
  isBusy: boolean;
  cycleId: string | null;
  error: string | null;
}

export interface CycleHistoryPdfActionController {
  getState(): CycleHistoryPdfActionState;
  subscribe(listener: (state: CycleHistoryPdfActionState) => void): () => void;
  generate(
    cycleId: string,
    detailState: CycleHistoryLoadState,
    isStillCurrent: (cycleId: string, detailState: CycleHistoryLoadState) => boolean,
  ): Promise<boolean>;
  invalidate(): void;
}

export interface CreateCycleHistoryPdfActionControllerOptions {
  renderPdf?: (model: CycleHistoryPdfModel) => Promise<Blob>;
  downloadPdf?: (blob: Blob, filename: string) => void;
}

const INITIAL_STATE: CycleHistoryPdfActionState = {
  isBusy: false,
  cycleId: null,
  error: null,
};

export function resolveCycleHistoryPdfModel(
  cycleId: string,
  detailState: CycleHistoryLoadState,
): CycleHistoryPdfModel | null {
  if (detailState.status !== "ready" && detailState.status !== "empty") return null;
  if (detailState.cycleId !== cycleId) return null;
  if (detailState.data.metadata.cycleId !== cycleId) return null;
  if (detailState.data.pdfModel.cycle.cycleId !== cycleId) return null;
  return detailState.data.pdfModel;
}

export function createCycleHistoryPdfActionController(
  options: CreateCycleHistoryPdfActionControllerOptions = {},
): CycleHistoryPdfActionController {
  const renderPdf = options.renderPdf ?? renderCycleHistoryPdf;
  const downloadPdf = options.downloadPdf ?? downloadCycleHistoryPdf;
  const listeners = new Set<(state: CycleHistoryPdfActionState) => void>();
  let state = INITIAL_STATE;
  let lifecycleVersion = 0;
  let generationLockVersion: number | null = null;

  function publish(nextState: CycleHistoryPdfActionState) {
    state = nextState;
    for (const listener of listeners) listener(state);
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async generate(cycleId, detailState, isStillCurrent) {
      const pdfModel = resolveCycleHistoryPdfModel(cycleId, detailState);
      if (generationLockVersion !== null || !pdfModel) return false;

      const requestVersion = ++lifecycleVersion;
      generationLockVersion = requestVersion;
      let publicError: string | null = null;
      let downloaded = false;
      publish({ isBusy: true, cycleId, error: null });

      try {
        const blob = await renderPdf(pdfModel);
        if (
          requestVersion !== lifecycleVersion ||
          !isStillCurrent(cycleId, detailState)
        ) {
          return false;
        }
        downloadPdf(blob, pdfModel.filename);
        downloaded = true;
        return true;
      } catch {
        if (requestVersion === lifecycleVersion && isStillCurrent(cycleId, detailState)) {
          publicError = CYCLE_HISTORY_PDF_PUBLIC_ERROR;
        }
        return false;
      } finally {
        if (generationLockVersion === requestVersion) {
          generationLockVersion = null;
        }
        if (requestVersion === lifecycleVersion) {
          publish({ isBusy: false, cycleId, error: downloaded ? null : publicError });
        }
      }
    },

    invalidate() {
      lifecycleVersion += 1;
      generationLockVersion = null;
      publish(INITIAL_STATE);
    },
  };
}
