import type { TrainingPlan } from "@/lib/training/training-plan-model";

export type DraftTrainingPlan = TrainingPlan;
export type PersistedTrainingPlan = TrainingPlan;
export type DisplayTrainingPlan = TrainingPlan;

export interface TrainingPlanSources {
  readonly draftPlan: DraftTrainingPlan;
  readonly persistedPlan: PersistedTrainingPlan | null;
  readonly displayTrainingPlan: DisplayTrainingPlan;
}

export interface TrainingPlanPersistedSource {
  readonly plan: TrainingPlan;
  readonly activeCycle: unknown | null;
}

/** Deriva las tres vistas sin almacenar un tercer canon. */
export function selectTrainingPlanSources(
  draftPlan: DraftTrainingPlan,
  trainingDataView: TrainingPlanPersistedSource,
): TrainingPlanSources {
  const persistedPlan = trainingDataView.activeCycle ? trainingDataView.plan : null;
  return {
    draftPlan,
    persistedPlan,
    displayTrainingPlan: persistedPlan ?? draftPlan,
  };
}
