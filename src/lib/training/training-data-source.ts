import {
  loadAppData,
  type AppData,
  type RepositoryMode,
} from "@/lib/data/repository";
import {
  getCycleScopedTrainingPlan,
  getCycleScopedTrainingSessionData,
  type CycleScopedTrainingPlan,
  type CycleScopedTrainingSessionData,
} from "@/lib/training/cycle-scoped-training-repository";
import {
  getActiveTrainingCycle,
  getTrainingCycleHistory,
  type TrainingCycle,
} from "@/lib/training/training-cycles-repository";

export interface TrainingDataCyclesResult {
  active: TrainingCycle | null;
  history: TrainingCycle[];
}

/**
 * Read adapter only. Authentication and row ownership stay inside the existing
 * repositories; the caller supplies an expected user only to the legacy app
 * loader, whose existing identity assertion already supports it.
 */
export interface TrainingDataSource {
  loadAppData(mode: RepositoryMode, expectedUserId?: string | null): Promise<AppData>;
  loadCycles(): Promise<TrainingDataCyclesResult>;
  loadCyclePlan(cycleId: string): Promise<CycleScopedTrainingPlan>;
  loadCycleSessions(
    cycleId: string,
    plan: CycleScopedTrainingPlan,
  ): Promise<CycleScopedTrainingSessionData>;
}

export interface TrainingDataRepositoryDependencies {
  loadAppData: typeof loadAppData;
  getActiveCycle: typeof getActiveTrainingCycle;
  getCycleHistory: typeof getTrainingCycleHistory;
  getCyclePlan: typeof getCycleScopedTrainingPlan;
  getCycleSessions: typeof getCycleScopedTrainingSessionData;
}

const repositoryDependencies: TrainingDataRepositoryDependencies = {
  loadAppData,
  getActiveCycle: getActiveTrainingCycle,
  getCycleHistory: getTrainingCycleHistory,
  getCyclePlan: getCycleScopedTrainingPlan,
  getCycleSessions: getCycleScopedTrainingSessionData,
};

export function createRepositoryTrainingDataSource(
  dependencies: TrainingDataRepositoryDependencies = repositoryDependencies,
): TrainingDataSource {
  return {
    loadAppData: dependencies.loadAppData,
    async loadCycles() {
      const [active, history] = await Promise.all([
        dependencies.getActiveCycle(),
        dependencies.getCycleHistory(),
      ]);
      return { active, history };
    },
    loadCyclePlan: dependencies.getCyclePlan,
    loadCycleSessions: dependencies.getCycleSessions,
  };
}
