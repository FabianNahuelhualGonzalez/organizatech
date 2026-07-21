import { isPublicError } from "@/lib/errors/public-error";
import {
  adaptAndSortCycleHistoryList,
  adaptCycleHistoryData,
  adaptCycleHistoryMetadata,
} from "@/lib/training/cycle-history/cycle-history-adapter";
import { buildCycleHistoryBreakdown } from "@/lib/training/cycle-history/cycle-history-breakdown";
import type { CycleHistoryDataSource } from "@/lib/training/cycle-history/cycle-history-data-source";
import { buildCycleHistoryMetricsSummary } from "@/lib/training/cycle-history/cycle-history-metrics";
import {
  buildCycleHistoryPdfModel,
  type CycleHistoryPdfModel,
} from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type {
  CycleHistoryBreakdown,
  CycleHistoryCycleMetadata,
  CycleHistoryMetricsSummary,
  CycleHistoryPlan,
} from "@/lib/training/cycle-history/cycle-history-types";

export interface CycleHistoryPublicError {
  code: string;
  message: string;
}

export type CycleHistoryListResult =
  | { status: "disabled" }
  | { status: "empty"; cycles: [] }
  | { status: "ready"; cycles: CycleHistoryCycleMetadata[] }
  | { status: "error"; error: CycleHistoryPublicError };

export interface CycleHistoryDetail {
  metadata: CycleHistoryCycleMetadata;
  plan: CycleHistoryPlan;
  breakdown: CycleHistoryBreakdown;
  metrics: CycleHistoryMetricsSummary;
  pdfModel: CycleHistoryPdfModel;
  sessionCount: number;
  entryCount: number;
}

export type CycleHistoryDetailResult =
  | { status: "disabled" }
  | { status: "empty"; cycleId: string; data: CycleHistoryDetail }
  | { status: "ready"; cycleId: string; data: CycleHistoryDetail }
  | { status: "error"; cycleId: string; error: CycleHistoryPublicError };

export interface CycleHistoryService {
  listCycles(): Promise<CycleHistoryListResult>;
  loadCycleDetail(selectedCycleId: string): Promise<CycleHistoryDetailResult>;
}

export interface CreateCycleHistoryServiceOptions {
  trainingCyclesRepositoryEnabled: boolean;
  dataSource: CycleHistoryDataSource;
  now?: () => string;
}

const LIST_ERROR_MESSAGE = "No pudimos cargar el historial de ciclos.";
const DETAIL_ERROR_MESSAGE = "No pudimos cargar el detalle de este ciclo.";

export function createCycleHistoryService(
  options: CreateCycleHistoryServiceOptions,
): CycleHistoryService {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async listCycles() {
      if (!options.trainingCyclesRepositoryEnabled) return { status: "disabled" };

      try {
        const cycles = adaptAndSortCycleHistoryList(await options.dataSource.listCycles());
        return cycles.length === 0
          ? { status: "empty", cycles: [] }
          : { status: "ready", cycles };
      } catch (error) {
        return { status: "error", error: toPublicError(error, LIST_ERROR_MESSAGE) };
      }
    },

    async loadCycleDetail(selectedCycleId) {
      if (!options.trainingCyclesRepositoryEnabled) return { status: "disabled" };
      if (!selectedCycleId.trim()) {
        return {
          status: "error",
          cycleId: selectedCycleId,
          error: { code: "cycle_required", message: "Selecciona un ciclo para revisar su historial." },
        };
      }

      try {
        const sourceCycle = await options.dataSource.loadCycle(selectedCycleId);
        if (!sourceCycle) {
          return {
            status: "error",
            cycleId: selectedCycleId,
            error: { code: "cycle_not_found", message: "No encontramos el ciclo seleccionado." },
          };
        }

        const metadata = adaptCycleHistoryMetadata(sourceCycle, selectedCycleId);
        const sourceData = await options.dataSource.loadCycleData(selectedCycleId);
        const { plan, sessions, entries } = adaptCycleHistoryData(selectedCycleId, sourceData);
        const breakdown = buildCycleHistoryBreakdown({
          selectedCycleId,
          plan,
          sessions,
          entries,
          plannedStartDate: metadata.plannedStartDate,
        });
        const metrics = buildCycleHistoryMetricsSummary(breakdown);
        const personalData = await options.dataSource.loadPersonalData();
        const detail: CycleHistoryDetail = {
          metadata,
          plan,
          breakdown,
          metrics,
          pdfModel: buildCycleHistoryPdfModel({
            cycle: metadata,
            breakdown,
            personalData,
            generatedAt: now(),
          }),
          sessionCount: sessions.length,
          entryCount: entries.length,
        };

        return breakdown.weeksWithData.length === 0
          ? { status: "empty", cycleId: selectedCycleId, data: detail }
          : { status: "ready", cycleId: selectedCycleId, data: detail };
      } catch (error) {
        return {
          status: "error",
          cycleId: selectedCycleId,
          error: toPublicError(error, DETAIL_ERROR_MESSAGE),
        };
      }
    },
  };
}

function toPublicError(error: unknown, fallbackMessage: string): CycleHistoryPublicError {
  return isPublicError(error)
    ? { code: error.code, message: error.message }
    : { code: "unexpected", message: fallbackMessage };
}
