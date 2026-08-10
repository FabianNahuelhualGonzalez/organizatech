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
  getCycleScopedTrainingDataValue,
  getTrainingDataResourceValue,
  type CycleScopedTrainingDataSnapshot,
  type LegacyTrainingDataSnapshot,
  type PersistedTrainingCyclesSnapshot,
  type TrainingDataState,
} from "./training-data-state";

const EMPTY_CYCLE_MESSAGE = "El ciclo activo no tiene rutina, dia y ejercicio cycle-scoped cargados. No se mostraran datos legacy.";

export type TrainingDataCriticalResource =
  | "legacy-snapshot"
  | "active-cycle"
  | "cycle-snapshot";

export type TrainingDataRefreshResult =
  | { kind: "success"; state: TrainingDataState; appData?: LegacyTrainingDataSnapshot }
  | { kind: "stale"; state: TrainingDataState }
  | {
      kind: "error";
      state: TrainingDataState;
      resource: TrainingDataCriticalResource;
      error: unknown;
    };

export type TrainingDataBackgroundLane = "cycle-history" | "profile-prerequisite";

export type TrainingDataBackgroundLaneResult =
  | { kind: "success"; resource: TrainingDataBackgroundLane }
  | { kind: "stale"; resource: TrainingDataBackgroundLane }
  | { kind: "error"; resource: TrainingDataBackgroundLane; error: unknown };

export interface TrainingDataBackgroundSettlement {
  kind: "success" | "error" | "stale";
  state: TrainingDataState;
  results: readonly TrainingDataBackgroundLaneResult[];
}

export interface TrainingDataLoadMilestones {
  /** Identity + active cycle + selected complete canonical snapshot. */
  dashboardReady: Promise<TrainingDataRefreshResult>;
  /** Deferred history/profile provisioning; never gates dashboardReady. */
  backgroundSettled: Promise<TrainingDataBackgroundSettlement>;
}

export interface TrainingDataController {
  getState(): TrainingDataState;
  subscribe(listener: (state: TrainingDataState) => void): () => void;
  reset(input: { cyclesEnabled: boolean }): void;
  invalidateAll(): void;
  startRefreshForIdentity(input: {
    mode: RepositoryMode;
    cyclesEnabled: boolean;
  }): TrainingDataLoadMilestones;
  refreshForIdentity(input: {
    mode: RepositoryMode;
    cyclesEnabled: boolean;
  }): Promise<TrainingDataRefreshResult>;
  refreshAppData(mode: RepositoryMode): Promise<TrainingDataRefreshResult>;
  refreshCycles(): Promise<TrainingDataRefreshResult>;
  refreshCycleHistory(): Promise<TrainingDataBackgroundLaneResult>;
  reloadCycleSnapshot(cycleId: string): Promise<TrainingDataRefreshResult>;
  reloadCycleSessions(
    cycleId: string,
    options?: { errorMessage?: string },
  ): Promise<TrainingDataRefreshResult>;
  appendLegacySession(session: TrainingSession, token: SessionDataRequestToken): boolean;
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

  function getCycleHistorySnapshot(): readonly import("@/lib/training/training-cycles-repository").TrainingCycle[] {
    if (state.cycleHistory.status === "disabled") return [];
    return getTrainingDataResourceValue(state.cycleHistory) ?? [];
  }

  async function loadCycleSnapshot(cycleId: string): Promise<TrainingDataRefreshResult> {
    if (!cycleId.trim()) return { kind: "stale", state };
    owners.selectCycle(cycleId);
    const owner = owners.begin("cycle-snapshot", cycleId);
    const previous = getCycleScopedTrainingDataValue(state.cycleScoped);
    const previousForCycle = previous?.cycleId === cycleId ? previous : undefined;
    publish({
      ...state,
      cycleScoped: previousForCycle
        ? { status: "loading", cycleId, previous: previousForCycle }
        : { status: "loading", cycleId },
    });

    try {
      const isExpectedRequestCurrent = () => owners.isCurrent(owner);
      const [plan, rawSessionData] = await Promise.all([
        source.loadCyclePlan(
          cycleId,
          owner.requestToken.userId ?? undefined,
          isExpectedRequestCurrent,
        ),
        source.loadCycleSessionRows(
          cycleId,
          owner.requestToken.userId ?? undefined,
          isExpectedRequestCurrent,
        ),
      ]);
      if (!owners.isCurrent(owner)) return { kind: "stale", state };
      const sessionData = source.assembleCycleSessions(cycleId, plan, rawSessionData);
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
        cycleScoped: previousForCycle
          ? { status: "error", cycleId, message: translateCycleError(error), previous: previousForCycle }
          : { status: "error", cycleId, message: translateCycleError(error) },
      });
      return { kind: "error", state, resource: "cycle-snapshot", error };
    }
  }

  async function refreshProfilePrerequisite(
    mode: RepositoryMode,
  ): Promise<TrainingDataBackgroundLaneResult> {
    if (mode !== "supabase") {
      owners.invalidate("profile-prerequisite");
      publish({ ...state, profilePrerequisite: { status: "disabled" } });
      return { kind: "success", resource: "profile-prerequisite" };
    }
    const owner = owners.begin("profile-prerequisite");
    const previous = state.profilePrerequisite.status === "disabled"
      ? null
      : getTrainingDataResourceValue(state.profilePrerequisite);
    publish({
      ...state,
      profilePrerequisite: previous
        ? { status: "loading", previous }
        : { status: "loading" },
    });
    try {
      await source.ensureProfile(mode, owner.requestToken.userId);
      if (!owners.isCurrent(owner)) return { kind: "stale", resource: "profile-prerequisite" };
      publish({ ...state, profilePrerequisite: { status: "ready", data: true } });
      return { kind: "success", resource: "profile-prerequisite" };
    } catch (error) {
      if (!owners.isCurrent(owner)) return { kind: "stale", resource: "profile-prerequisite" };
      publish({
        ...state,
        profilePrerequisite: previous
          ? { status: "error", message: "No pudimos preparar tu perfil.", previous }
          : { status: "error", message: "No pudimos preparar tu perfil." },
      });
      return { kind: "error", resource: "profile-prerequisite", error };
    }
  }

  async function refreshActiveCycle(): Promise<TrainingDataRefreshResult> {
    const owner = owners.begin("active-cycle");
    const previous = getCyclesSnapshot() ?? undefined;
    publish({
      ...state,
      cycles: previous ? { status: "loading", previous } : { status: "loading" },
    });
    try {
      const active = await source.loadActiveCycle(
        owner.requestToken.userId ?? undefined,
        () => owners.isCurrent(owner),
      );
      if (!owners.isCurrent(owner)) return { kind: "stale", state };
      const cycles: PersistedTrainingCyclesSnapshot = { active };
      publish({ ...state, cycles: { status: "ready", data: cycles } });
      if (active && isCycleScopedTrainingCycle(active)) {
        return loadCycleSnapshot(active.id);
      }
      owners.selectCycle(null);
      publish({ ...state, cycleScoped: { status: "disabled" } });
      return { kind: "success", state };
    } catch (error) {
      if (!owners.isCurrent(owner)) return { kind: "stale", state };
      publish({
        ...state,
        cycles: previous
          ? { status: "error", message: translateCycleError(error), previous }
          : { status: "error", message: translateCycleError(error) },
      });
      return { kind: "error", state, resource: "active-cycle", error };
    }
  }

  async function refreshDashboardCanon(
    mode: RepositoryMode,
    cyclesEnabled: boolean,
  ): Promise<TrainingDataRefreshResult> {
    if (!cyclesEnabled) return controller.refreshAppData(mode);

    const cyclesResult = await refreshActiveCycle();
    if (cyclesResult.kind !== "success") return cyclesResult;
    const activeCycle = getCyclesSnapshot()?.active ?? null;
    if (activeCycle && isCycleScopedTrainingCycle(activeCycle)) return cyclesResult;
    return controller.refreshAppData(mode);
  }

  function settleBackground(
    results: readonly TrainingDataBackgroundLaneResult[],
  ): TrainingDataBackgroundSettlement {
    const kind = results.some((result) => result.kind === "error")
      ? "error"
      : results.every((result) => result.kind === "stale")
        ? "stale"
        : "success";
    return { kind, state, results };
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
      owners.invalidateAll();
      publish(createInitialTrainingDataState(cyclesEnabled));
    },

    invalidateAll() {
      owners.invalidateAll();
      listeners.clear();
    },

    startRefreshForIdentity({ mode, cyclesEnabled }) {
      if (!cyclesEnabled && state.cycles.status !== "disabled") {
        owners.selectCycle(null);
        owners.invalidate("active-cycle");
        owners.invalidate("cycle-history");
        publish({
          ...state,
          cycles: { status: "disabled" },
          cycleHistory: { status: "disabled" },
          cycleScoped: { status: "disabled" },
        });
      }
      const dashboardReady = refreshDashboardCanon(mode, cyclesEnabled);
      return {
        dashboardReady,
        backgroundSettled: dashboardReady.then((dashboardResult) => {
          if (dashboardResult.kind === "stale") {
            return settleBackground([
              { kind: "stale", resource: "cycle-history" },
              { kind: "stale", resource: "profile-prerequisite" },
            ]);
          }
          const historySettled = cyclesEnabled
            ? controller.refreshCycleHistory()
            : Promise.resolve<TrainingDataBackgroundLaneResult>({
                kind: "success",
                resource: "cycle-history",
              });
          const profileSettled = refreshProfilePrerequisite(mode);
          return Promise.all([historySettled, profileSettled]).then(settleBackground);
        }),
      };
    },

    refreshForIdentity(input) {
      return controller.startRefreshForIdentity(input).dashboardReady;
    },

    async refreshAppData(mode) {
      const owner = owners.begin("legacy-snapshot");
      const previous = getTrainingDataResourceValue(state.appData) ?? undefined;
      publish({
        ...state,
        appData: previous ? { status: "loading", previous } : { status: "loading" },
      });
      try {
        const appData = toLegacySnapshot(
          await source.loadLegacySnapshot(mode, owner.requestToken.userId),
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
        return { kind: "error", state, resource: "legacy-snapshot", error };
      }
    },

    async refreshCycles() {
      void controller.refreshCycleHistory();
      return refreshActiveCycle();
    },

    async refreshCycleHistory() {
      if (state.cycleHistory.status === "disabled") {
        publish({ ...state, cycleHistory: { status: "idle" } });
      }
      const owner = owners.begin("cycle-history");
      const previous = state.cycleHistory.status === "disabled"
        ? null
        : getTrainingDataResourceValue(state.cycleHistory);
      publish({
        ...state,
        cycleHistory: previous
          ? { status: "loading", previous }
          : { status: "loading" },
      });
      try {
        const history = await source.loadCycleHistory();
        if (!owners.isCurrent(owner)) return { kind: "stale", resource: "cycle-history" };
        publish({ ...state, cycleHistory: { status: "ready", data: [...history] } });
        return { kind: "success", resource: "cycle-history" };
      } catch (error) {
        if (!owners.isCurrent(owner)) return { kind: "stale", resource: "cycle-history" };
        publish({
          ...state,
          cycleHistory: previous
            ? { status: "error", message: translateCycleError(error), previous }
            : { status: "error", message: translateCycleError(error) },
        });
        return { kind: "error", resource: "cycle-history", error };
      }
    },

    reloadCycleSnapshot(cycleId) {
      return loadCycleSnapshot(cycleId);
    },

    async reloadCycleSessions(cycleId, options = {}) {
      if (getCyclesSnapshot()?.active?.id !== cycleId) return { kind: "stale", state };
      const currentSnapshot = getCycleScopedTrainingDataValue(state.cycleScoped);
      if (!currentSnapshot || currentSnapshot.cycleId !== cycleId) {
        return loadCycleSnapshot(cycleId);
      }

      owners.selectCycle(cycleId);
      const owner = owners.begin("cycle-snapshot", cycleId);
      publish({
        ...state,
        cycleScoped: { status: "loading", cycleId, previous: currentSnapshot },
      });
      try {
        const isExpectedRequestCurrent = () => owners.isCurrent(owner);
        const rawSessionData = await source.loadCycleSessionRows(
          cycleId,
          owner.requestToken.userId ?? undefined,
          isExpectedRequestCurrent,
        );
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        const sessionData = source.assembleCycleSessions(
          cycleId,
          currentSnapshot.plan,
          rawSessionData,
        );
        if (!owners.isCurrent(owner)) return { kind: "stale", state };
        const snapshot: CycleScopedTrainingDataSnapshot = {
          cycleId,
          plan: currentSnapshot.plan,
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
            previous: currentSnapshot,
          },
        });
        return { kind: "error", state, resource: "cycle-snapshot", error };
      }
    },

    appendLegacySession(session, token) {
      if (!identity.isRequestTokenCurrent(token)) return false;
      const current = getTrainingDataResourceValue(state.appData);
      if (!current) return false;
      owners.invalidate("legacy-snapshot");
      const alreadyExists = current.sessions.some((item) => item.id === session.id);
      const nextSessions = alreadyExists ? [...current.sessions] : [...current.sessions, session];
      const knownEntryIds = new Set(current.entries.map((entry) => entry.id));
      const nextEntries = alreadyExists
        ? [...current.entries]
        : [...current.entries, ...session.entries.filter((entry) => !knownEntryIds.has(entry.id))];
      publish({
        ...state,
        appData: {
          status: "ready",
          data: { ...current, sessions: nextSessions, entries: nextEntries },
        },
      });
      return true;
    },

    clearForCycleSetup(token) {
      if (!identity.isRequestTokenCurrent(token)) return false;
      const currentAppData = getTrainingDataResourceValue(state.appData);
      const history = [...getCycleHistorySnapshot()];
      owners.invalidate("legacy-snapshot");
      owners.invalidate("active-cycle");
      owners.invalidate("cycle-history");
      owners.selectCycle(null);
      publish({
        ...state,
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
          : { status: "ready", data: { active: null } },
        cycleHistory: state.cycleHistory.status === "disabled"
          ? { status: "disabled" }
          : { status: "ready", data: history },
        cycleScoped: { status: "disabled" },
      });
      return true;
    },
  };

  return controller;
}
