import type {
  CycleHistoryDetail,
  CycleHistoryDetailResult,
  CycleHistoryPublicError,
} from "@/lib/training/cycle-history/cycle-history-service";

export type CycleHistoryLoadState =
  | { status: "idle" }
  | { status: "disabled" }
  | { status: "loading"; cycleId: string }
  | { status: "empty"; cycleId: string; data: CycleHistoryDetail }
  | { status: "ready"; cycleId: string; data: CycleHistoryDetail }
  | { status: "error"; cycleId: string; error: CycleHistoryPublicError };

export interface CycleHistoryDetailLoader {
  loadCycleDetail(selectedCycleId: string): Promise<CycleHistoryDetailResult>;
}

export interface CycleHistoryLoadCoordinator {
  getState(): CycleHistoryLoadState;
  load(selectedCycleId: string): Promise<CycleHistoryLoadState>;
  invalidateCycle(cycleId: string): void;
  invalidateAll(): void;
}

type CacheableDetailResult = Extract<CycleHistoryDetailResult, { status: "ready" | "empty" }>;

interface InFlightRequest {
  promise: Promise<CycleHistoryDetailResult>;
  cycleVersion: number;
  sessionVersion: number;
}

/**
 * Coordinador por instancia. H1-C debe conservarlo solo durante la sesión actual
 * y llamar invalidateAll al cerrar sesión o cambiar de identidad.
 */
export function createCycleHistoryLoadCoordinator(
  loader: CycleHistoryDetailLoader,
): CycleHistoryLoadCoordinator {
  const cache = new Map<string, CacheableDetailResult>();
  const inFlight = new Map<string, InFlightRequest>();
  const cycleVersions = new Map<string, number>();
  let sessionVersion = 0;
  let latestRequestId = 0;
  let state: CycleHistoryLoadState = { status: "idle" };

  function getCycleVersion(cycleId: string) {
    return cycleVersions.get(cycleId) ?? 0;
  }

  function isRequestCurrent(
    requestId: number,
    cycleId: string,
    requestCycleVersion: number,
    requestSessionVersion: number,
  ) {
    return (
      requestId === latestRequestId &&
      requestCycleVersion === getCycleVersion(cycleId) &&
      requestSessionVersion === sessionVersion
    );
  }

  function getOrCreateRequest(cycleId: string): InFlightRequest {
    const current = inFlight.get(cycleId);
    if (current) return current;

    const cycleVersion = getCycleVersion(cycleId);
    const requestSessionVersion = sessionVersion;
    const promise: Promise<CycleHistoryDetailResult> = Promise.resolve()
      .then(() => loader.loadCycleDetail(cycleId))
      .catch((): CycleHistoryDetailResult => ({
        status: "error",
        cycleId,
        error: {
          code: "unexpected",
          message: "No pudimos cargar el detalle de este ciclo.",
        },
      }))
      .then((result) => {
        if (
          (result.status === "ready" || result.status === "empty") &&
          cycleVersion === getCycleVersion(cycleId) &&
          requestSessionVersion === sessionVersion
        ) {
          cache.set(cycleId, result);
        }
        return result;
      })
      .finally(() => {
        if (inFlight.get(cycleId)?.promise === promise) {
          inFlight.delete(cycleId);
        }
      });
    const request: InFlightRequest = {
      cycleVersion,
      sessionVersion: requestSessionVersion,
      promise,
    };
    inFlight.set(cycleId, request);
    return request;
  }

  return {
    getState() {
      return state;
    },

    async load(selectedCycleId) {
      const requestId = ++latestRequestId;
      const cached = cache.get(selectedCycleId);
      if (cached) {
        state = toLoadState(cached);
        return state;
      }

      state = { status: "loading", cycleId: selectedCycleId };
      const request = getOrCreateRequest(selectedCycleId);
      const result = await request.promise;

      if (
        !isRequestCurrent(
          requestId,
          selectedCycleId,
          request.cycleVersion,
          request.sessionVersion,
        )
      ) {
        return state;
      }

      state = toLoadState(result);
      return state;
    },

    invalidateCycle(cycleId) {
      cycleVersions.set(cycleId, getCycleVersion(cycleId) + 1);
      cache.delete(cycleId);
      inFlight.delete(cycleId);
      if ("cycleId" in state && state.cycleId === cycleId) {
        latestRequestId += 1;
        state = { status: "idle" };
      }
    },

    invalidateAll() {
      sessionVersion += 1;
      latestRequestId += 1;
      cache.clear();
      inFlight.clear();
      cycleVersions.clear();
      state = { status: "idle" };
    },
  };
}

function toLoadState(result: CycleHistoryDetailResult): CycleHistoryLoadState {
  switch (result.status) {
    case "ready":
      return { status: "ready", cycleId: result.cycleId, data: result.data };
    case "empty":
      return { status: "empty", cycleId: result.cycleId, data: result.data };
    case "error":
      return { status: "error", cycleId: result.cycleId, error: result.error };
    case "disabled":
      return { status: "disabled" };
  }
}
