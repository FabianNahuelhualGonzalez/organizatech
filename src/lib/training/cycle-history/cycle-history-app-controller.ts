import type {
  CycleHistoryLoadCoordinator,
  CycleHistoryLoadState,
} from "@/lib/training/cycle-history/cycle-history-coordinator";
import type { CycleHistoryService } from "@/lib/training/cycle-history/cycle-history-service";
import {
  resolveNextExpandedCycleId,
  type CycleHistoryListPresentationState,
} from "@/lib/training/cycle-history/cycle-history-view-model";

export interface CycleHistoryAppState {
  listState: CycleHistoryListPresentationState;
  expandedCycleId: string | null;
  detailState: CycleHistoryLoadState;
}

export interface CycleHistoryAppController {
  getState(): CycleHistoryAppState;
  subscribe(listener: (state: CycleHistoryAppState) => void): () => void;
  loadList(): Promise<CycleHistoryAppState>;
  retryList(): Promise<CycleHistoryAppState>;
  toggleCycle(cycleId: string): Promise<CycleHistoryAppState>;
  retryCycle(cycleId: string): Promise<CycleHistoryAppState>;
  invalidateAll(): void;
}

export interface CreateCycleHistoryAppControllerOptions {
  enabled: boolean;
  service: CycleHistoryService;
  coordinator: CycleHistoryLoadCoordinator;
}

function createInitialState(enabled: boolean): CycleHistoryAppState {
  return {
    listState: enabled ? { status: "idle" } : { status: "disabled" },
    expandedCycleId: null,
    detailState: enabled ? { status: "idle" } : { status: "disabled" },
  };
}

/**
 * Controlador por instancia e identidad. No conoce React ni userId y no comparte
 * caché global: el caller crea una instancia nueva para cada sesión autenticada.
 */
export function createCycleHistoryAppController({
  enabled,
  service,
  coordinator,
}: CreateCycleHistoryAppControllerOptions): CycleHistoryAppController {
  const listeners = new Set<(state: CycleHistoryAppState) => void>();
  let state = createInitialState(enabled);
  let lifecycleVersion = 0;
  let listRequestId = 0;
  let detailRequestId = 0;

  function publish(nextState: CycleHistoryAppState) {
    state = nextState;
    for (const listener of listeners) listener(state);
  }

  function clearVisibleState(listState: CycleHistoryListPresentationState) {
    detailRequestId += 1;
    publish({
      listState,
      expandedCycleId: null,
      detailState: listState.status === "disabled" ? { status: "disabled" } : { status: "idle" },
    });
  }

  function hasCycle(cycleId: string) {
    return state.listState.status === "ready" &&
      state.listState.cycles.some((cycle) => cycle.cycleId === cycleId);
  }

  async function loadDetail(cycleId: string): Promise<CycleHistoryAppState> {
    if (!enabled || !hasCycle(cycleId) || state.expandedCycleId !== cycleId) return state;

    const requestLifecycleVersion = lifecycleVersion;
    const requestId = ++detailRequestId;
    publish({ ...state, detailState: { status: "loading", cycleId } });

    const result = await coordinator.load(cycleId);
    if (
      requestLifecycleVersion !== lifecycleVersion ||
      requestId !== detailRequestId ||
      state.expandedCycleId !== cycleId
    ) {
      return state;
    }

    if (result.status === "disabled") {
      publish({ ...state, detailState: result });
      return state;
    }

    if ("cycleId" in result && result.cycleId === cycleId) {
      publish({ ...state, detailState: result });
    }
    return state;
  }

  async function loadList(): Promise<CycleHistoryAppState> {
    if (!enabled) {
      coordinator.invalidateAll();
      clearVisibleState({ status: "disabled" });
      return state;
    }

    const requestLifecycleVersion = lifecycleVersion;
    const requestId = ++listRequestId;
    publish({ ...state, listState: { status: "loading" } });

    const result = await service.listCycles();
    if (requestLifecycleVersion !== lifecycleVersion || requestId !== listRequestId) return state;

    if (result.status === "ready") {
      const cycleIds = new Set(result.cycles.map((cycle) => cycle.cycleId));
      const nextExpandedCycleId = state.expandedCycleId && cycleIds.has(state.expandedCycleId)
        ? state.expandedCycleId
        : result.cycles[0]?.cycleId ?? null;
      const canKeepDetail = nextExpandedCycleId !== null &&
        state.expandedCycleId === nextExpandedCycleId &&
        "cycleId" in state.detailState &&
        state.detailState.cycleId === nextExpandedCycleId;

      publish({
        listState: result,
        expandedCycleId: nextExpandedCycleId,
        detailState: canKeepDetail ? state.detailState : { status: "idle" },
      });

      if (nextExpandedCycleId && !canKeepDetail) {
        await loadDetail(nextExpandedCycleId);
      }
      return state;
    }

    if (result.status === "empty") {
      clearVisibleState(result);
      return state;
    }

    if (result.status === "disabled") {
      coordinator.invalidateAll();
      clearVisibleState(result);
      return state;
    }

    clearVisibleState(result);
    return state;
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    loadList,

    retryList() {
      return loadList();
    },

    async toggleCycle(cycleId) {
      if (!hasCycle(cycleId)) return state;

      const nextExpandedCycleId = resolveNextExpandedCycleId(state.expandedCycleId, cycleId);
      detailRequestId += 1;
      publish({
        ...state,
        expandedCycleId: nextExpandedCycleId,
        detailState: { status: "idle" },
      });

      return nextExpandedCycleId ? loadDetail(nextExpandedCycleId) : state;
    },

    retryCycle(cycleId) {
      if (!hasCycle(cycleId) || state.expandedCycleId !== cycleId) {
        return Promise.resolve(state);
      }
      coordinator.invalidateCycle(cycleId);
      return loadDetail(cycleId);
    },

    invalidateAll() {
      lifecycleVersion += 1;
      listRequestId += 1;
      detailRequestId += 1;
      coordinator.invalidateAll();
      publish(createInitialState(enabled));
    },
  };
}
