import type { AppData, RepositoryMode } from "@/lib/data/repository";
import type { TrainingSession } from "@/lib/progress/types";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";
import { translateTrainingCycleRepositoryError } from "@/lib/training/training-cycle-error";
import type { TrainingDataSource } from "@/lib/training/training-data-source";

import {
  createTrainingDataRequestOwnerRegistry,
  type TrainingDataIdentityPort,
} from "./training-data-request-owner";
import {
  isCycleScopedSnapshotEmpty,
  isCycleScopedTrainingCycle,
} from "./training-data-selectors";
import {
  createInitialTrainingDataState,
  getTrainingDataResourceValue,
  type CycleScopedTrainingDataSnapshot,
  type LegacyTrainingDataSnapshot,
  type PersistedTrainingCyclesSnapshot,
  type TrainingDataState,
} from "./training-data-state";

const EMPTY_CYCLE_MESSAGE = "El ciclo activo no tiene rutina, dia y ejercicio cycle-scoped cargados. No se mostraran datos legacy.";

export type TrainingDataRefreshResult =
  | { kind: "success"; state: TrainingDataState; appData?: LegacyTrainingDataSnapshot }
  | { kind: "stale"; state: TrainingDataState }
  | {
      kind: "error";
      state: TrainingDataState;
      resource: "app-data" | "cycles" | "cycle-snapshot";
      error: unknown;
    };

export interface TrainingDataController {
  getState(): TrainingDataState;
  subscribe(listener: (state: TrainingDataState) => void): () => void;
  reset(input: { cyclesEnabled: boolean }): void;
  invalidateAll(): void;
  refreshForIdentity(input: {
    mode: RepositoryMode;
    cyclesEnabled: boolean;
  }): Promise<TrainingDataRefreshResult>;
  refreshAppData(mode: RepositoryMode): Promise<TrainingDataRefreshResult>;
  refreshCycles(): Promise<TrainingDataRefreshResult>;
  reloadCycleSnapshot(cycleId: string): Promise<TrainingDataRefreshResult>;
  reloadCycleSessions(
    cycleId: string,
    options?: { errorMessage?: string },
  ): Promise<TrainingDataRefreshResult>;
  appendLegacySession(
    session: TrainingSession,
    token: SessionDataRequestToken,
  ): boolean;
  clearForCycleSetup(token: SessionDataRequestToken): boolean;
}

export interface CreateTrainingDataControllerOptions {
  identity: TrainingDataIdentityPort;
  source: TrainingDataSource;
  translateCycleError?: (error: unknown) => string;
}

export function createTrainingDataController({
  identity,
  source,
  translateCycleError = translateTrainingCycleRepositoryError,
}: CreateTrainingDataControllerOptions): TrainingDataController {
  const listeners = new Set<(state: TrainingDataState) => void>();
  const owners = createTrainingDataRequestOwnerRegistry(identity);
  let state = createInitialTrainingDataState();

  function publish(nextState: TrainingDataState) {
    state = nextState;
    for (const listener of listeners) listener(state);
  }

  function toLegacySnapshot(appData: AppData): LegacyTrainingDataSnapshot {
    return {
      exercises: [...appData.exercises],
      entries: [...appData.entries],
      sessions: [...appData.sessions],
      source: appData.source,
    };
  }

  function getCyclesSnapshot(): PersistedTrainingCyclesSnapshot | null {
    if (state.cycles.status === "disabled") return null;
    return getTrainingDataResourceValue(state.cycles);
  }

  async function loadCycleSnapshot(cycleId: string): Promise<TrainingDataRefreshResult> {
    if (!cycleId.trim()) return { kind: "stale", state };
    owners.selectCycle(cycleId);
    const owner = owners.begin("cycle-snapshot", cycleId);
    publish({
      ...state,
      cycleScoped: { status: "loading", cycleId },
    });

    try {
      const plan = await source.loadCyclePlan(cycleId);
      if (!owners.isCurrent(owner)) return { kind: "stale", state };
      const sessionData = await source.loadCycleSessions(cycleId, plan);
      if (!owners.isCurrent(owner)) return { kind: "stale", state };

      const snapshot: CycleScopedTrainingDataSnapshot = {
        cycleId,
        plan,
        entries: [...sessionData.entries],
        sessions: [...sessionData.sessions],
      };
      publish({
        ...state,
        cycleScoped: isCycleScopedSnapshotEmpty(snapshot)
          ? { status: "empty", cycleId, snapshot, message: EMPTY_CYCLE_MESSAGE }
          : { status: "ready", cycleId, snapshot },
      });
      return { kind: "success", state };
    } catch (error) {
      if (!owners.isCurrent(owner)) return { kind: "stale", state };
      publish({
        ...state,
        cycleScoped: {
          status: "error",
          cycleId,
          message: translateCycleError(error),
        },
      });
      return { kind: "error", state, resource: "cycle-snapshot", error };
    }
  }

  const controller: TrainingDataController = {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    reset({ cyclesEnabled }) {
      // Local lanes are invalidated before visible data is cleared. P3-41 remains
      // the only owner of identity/epoch and is advanced by the caller first.
      owners.invalidateAll();
      publish(createInitialTrainingDataState(cyclesEnabled));
    },

    invalidateAll() {
      owners.invalidateAll();
      listeners.clear();
    },

    async refreshForIdentity({ mode, cyclesEnabled }) {
      if (
        !cyclesEnabled &&
        (state.cycles.status !== "disabled" || state.cycleScoped.status !== "disabled")
      ) {
        owners.selectCycle(null);
        owners.invalidate("cycles");
        publish({ ...state, cycles: { status: "disabled" }, cycleScoped: { status: "disabled" } });
      }
      const [appResult, cyclesResult] = await Promise.all([
        controller.refreshAppData(mode),
        cyclesEnabled
          ? controller.refreshCycles()
          : Promise.resolve<TrainingDataRefreshResult>({ kind: "success", state }),
      ]);
      if (appResult.kind === "stale" || cyclesResult.kind === "stale") {
        return { kind: "stale", state };
      }
      if (appResult.kind === "error") return { ...appResult, state };
      if (cyclesResult.kind === "error") return { ...cyclesResult, state };
      return {
        kind: "success",
        state,
        ...(appResult.kind === "success" && appResult.appData
          ? { appData: appResult.appData }
          : {}),
      };
    },

    async refreshAppData(mode) {
      const owner = owners.begin("app-data");
      const previous = getTrainingDataResourceValue(state.appData) ?? undefined;
      publish({
        ...state,
        appData: previous ? { status: "loading", previous } : { status: "loading" },
      });
      try {
        const appData = toLegacySnapshot(
          await source.loadAppData(mode, owner.requestToken.userId),
        );
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        publish({ ...state, appData: { status: "ready", data: appData } });
        return { kind: "success", state, appData };
      } catch (error) {
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        publish({
          ...state,
          appData: previous
            ? { status: "error", message: "No pudimos actualizar tu progreso.", previous }
            : { status: "error", message: "No pudimos actualizar tu progreso." },
        });
        return { kind: "error", state, resource: "app-data", error };
      }
    },

    async refreshCycles() {
      owners.selectCycle(null);
      owners.invalidate("cycle-snapshot");
      const owner = owners.begin("cycles");
      const previous = getCyclesSnapshot() ?? undefined;
      publish({
        ...state,
        cycles: previous ? { status: "loading", previous } : { status: "loading" },
        cycleScoped: { status: "disabled" },
      });

      try {
        const next = await source.loadCycles();
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        const cycles: PersistedTrainingCyclesSnapshot = {
          active: next.active,
          history: [...next.history],
        };

        if (next.active && isCycleScopedTrainingCycle(next.active)) {
          owners.selectCycle(next.active.id);
          publish({
            ...state,
            cycles: { status: "ready", data: cycles },
            cycleScoped: { status: "loading", cycleId: next.active.id },
          });
          return loadCycleSnapshot(next.active.id);
        }

        owners.selectCycle(null);
        publish({
          ...state,
          cycles: { status: "ready", data: cycles },
          cycleScoped: { status: "disabled" },
        });
        return { kind: "success", state };
      } catch (error) {
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        publish({
          ...state,
          cycles: previous
            ? { status: "error", message: translateCycleError(error), previous }
            : { status: "error", message: translateCycleError(error) },
          cycleScoped: { status: "disabled" },
        });
        return { kind: "error", state, resource: "cycles", error };
      }
    },

    reloadCycleSnapshot(cycleId) {
      return loadCycleSnapshot(cycleId);
    },

    async reloadCycleSessions(cycleId, options = {}) {
      if (getCyclesSnapshot()?.active?.id !== cycleId) {
        return { kind: "stale", state };
      }
      const current = state.cycleScoped;
      if (
        (current.status !== "ready" && current.status !== "empty") ||
        current.cycleId !== cycleId
      ) {
        return loadCycleSnapshot(cycleId);
      }

      owners.selectCycle(cycleId);
      const owner = owners.begin("cycle-snapshot", cycleId);
      const previousSnapshot = current.snapshot;
      publish({ ...state, cycleScoped: { status: "loading", cycleId } });
      try {
        const sessionData = await source.loadCycleSessions(cycleId, previousSnapshot.plan);
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        const snapshot: CycleScopedTrainingDataSnapshot = {
          cycleId,
          plan: previousSnapshot.plan,
          entries: [...sessionData.entries],
          sessions: [...sessionData.sessions],
        };
        publish({
          ...state,
          cycleScoped: isCycleScopedSnapshotEmpty(snapshot)
            ? { status: "empty", cycleId, snapshot, message: EMPTY_CYCLE_MESSAGE }
            : { status: "ready", cycleId, snapshot },
        });
        return { kind: "success", state };
      } catch (error) {
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        publish({
          ...state,
          cycleScoped: {
            status: "error",
            cycleId,
            message: options.errorMessage ?? translateCycleError(error),
          },
        });
        return { kind: "error", state, resource: "cycle-snapshot", error };
      }
    },

    appendLegacySession(session, token) {
      if (!identity.isRequestTokenCurrent(token)) return false;
      const current = getTrainingDataResourceValue(state.appData);
      if (!current) return false;
      owners.invalidate("app-data");
      const alreadyExists = current.sessions.some((item) => item.id === session.id);
      const nextSessions = alreadyExists ? [...current.sessions] : [...current.sessions, session];
      const knownEntryIds = new Set(current.entries.map((entry) => entry.id));
      const nextEntries = alreadyExists
        ? [...current.entries]
        : [
            ...current.entries,
            ...session.entries.filter((entry) => !knownEntryIds.has(entry.id)),
          ];
      publish({
        ...state,
        appData: {
          status: "ready",
          data: {
            ...current,
            sessions: nextSessions,
            entries: nextEntries,
          },
        },
      });
      return true;
    },

    clearForCycleSetup(token) {
      if (!identity.isRequestTokenCurrent(token)) return false;
      const currentAppData = getTrainingDataResourceValue(state.appData);
      const currentCycles = getCyclesSnapshot();
      owners.invalidate("app-data");
      owners.invalidate("cycles");
      owners.selectCycle(null);
      publish({
        appData: {
          status: "ready",
          data: {
            exercises: [],
            entries: [],
            sessions: [],
            source: currentAppData?.source ?? "local",
          },
        },
        cycles: state.cycles.status === "disabled"
          ? { status: "disabled" }
          : {
              status: "ready",
              data: { active: null, history: [...(currentCycles?.history ?? [])] },
            },
        cycleScoped: { status: "disabled" },
      });
      return true;
    },
  };

  return controller;
}
