import {
  ensureAppDataProfile,
  loadAppDataSnapshot,
  type AppData,
  type RepositoryMode,
} from "@/lib/data/repository";
import {
  assembleCycleScopedTrainingSessionData,
  getCycleScopedTrainingPlan,
  getCycleScopedTrainingSessionRawData,
  type CycleScopedTrainingRequestGuard,
  type CycleScopedTrainingPlan,
  type CycleScopedTrainingSessionRawData,
  type CycleScopedTrainingSessionData,
} from "@/lib/training/cycle-scoped-training-repository";
import {
  getActiveTrainingCycle,
  getTrainingCycleHistory,
  type TrainingCycleRequestGuard,
  type TrainingCycle,
} from "@/lib/training/training-cycles-repository";

/**
 * Read adapter only. Authentication and row ownership stay inside the existing
 * repositories; the caller supplies an expected user only to the legacy app
 * loader, whose existing identity assertion already supports it.
 */
export interface TrainingDataSource {
  loadActiveCycle(
    expectedUserId?: string,
    isExpectedRequestCurrent?: TrainingCycleRequestGuard,
  ): Promise<TrainingCycle | null>;
  loadCycleHistory(): Promise<TrainingCycle[]>;
  loadLegacySnapshot(mode: RepositoryMode, expectedUserId?: string | null): Promise<AppData>;
  ensureProfile(mode: RepositoryMode, expectedUserId?: string | null): Promise<void>;
  loadCyclePlan(
    cycleId: string,
    expectedUserId?: string,
    isExpectedRequestCurrent?: CycleScopedTrainingRequestGuard,
  ): Promise<CycleScopedTrainingPlan>;
  loadCycleSessionRows(
    cycleId: string,
    expectedUserId?: string,
    isExpectedRequestCurrent?: CycleScopedTrainingRequestGuard,
  ): Promise<CycleScopedTrainingSessionRawData>;
  assembleCycleSessions(
    cycleId: string,
    plan: CycleScopedTrainingPlan,
    rawData: CycleScopedTrainingSessionRawData,
  ): CycleScopedTrainingSessionData;
}

export interface TrainingDataRepositoryDependencies {
  loadLegacySnapshot: typeof loadAppDataSnapshot;
  ensureProfile: typeof ensureAppDataProfile;
  getActiveCycle: typeof getActiveTrainingCycle;
  getCycleHistory: typeof getTrainingCycleHistory;
  getCyclePlan: typeof getCycleScopedTrainingPlan;
  getCycleSessionRows: typeof getCycleScopedTrainingSessionRawData;
  assembleCycleSessions: typeof assembleCycleScopedTrainingSessionData;
}

const repositoryDependencies: TrainingDataRepositoryDependencies = {
  loadLegacySnapshot: loadAppDataSnapshot,
  ensureProfile: ensureAppDataProfile,
  getActiveCycle: getActiveTrainingCycle,
  getCycleHistory: getTrainingCycleHistory,
  getCyclePlan: getCycleScopedTrainingPlan,
  getCycleSessionRows: getCycleScopedTrainingSessionRawData,
  assembleCycleSessions: assembleCycleScopedTrainingSessionData,
};

export function createRepositoryTrainingDataSource(
  dependencies: TrainingDataRepositoryDependencies = repositoryDependencies,
): TrainingDataSource {
  return {
    loadActiveCycle: dependencies.getActiveCycle,
    loadCycleHistory: dependencies.getCycleHistory,
    loadLegacySnapshot: dependencies.loadLegacySnapshot,
    ensureProfile: dependencies.ensureProfile,
    loadCyclePlan: (cycleId, expectedUserId, isExpectedRequestCurrent) => (
      dependencies.getCyclePlan(
        cycleId,
        expectedUserId,
        undefined,
        isExpectedRequestCurrent,
      )
    ),
    loadCycleSessionRows: (cycleId, expectedUserId, isExpectedRequestCurrent) => (
      dependencies.getCycleSessionRows(
        cycleId,
        expectedUserId,
        undefined,
        isExpectedRequestCurrent,
      )
    ),
    assembleCycleSessions: dependencies.assembleCycleSessions,
  };
}
