import type { DataSource } from "@/lib/data/repository";
import type {
  ExerciseEntry,
  ExerciseTemplate,
  TrainingSession,
} from "@/lib/progress/types";
import type { CycleScopedTrainingPlan } from "@/lib/training/cycle-scoped-training-repository";
import type { TrainingCycle } from "@/lib/training/training-cycles-repository";

export interface LegacyTrainingDataSnapshot {
  exercises: readonly ExerciseTemplate[];
  entries: readonly ExerciseEntry[];
  sessions: readonly TrainingSession[];
  source: DataSource;
}

export interface PersistedTrainingCyclesSnapshot {
  active: TrainingCycle | null;
}

/**
 * The plan is the only canonical source for cycle-scoped exercise templates.
 * Consumers derive templates from it instead of storing a second exercises array.
 */
export interface CycleScopedTrainingDataSnapshot {
  cycleId: string;
  plan: CycleScopedTrainingPlan;
  entries: readonly ExerciseEntry[];
  sessions: readonly TrainingSession[];
}

export type TrainingDataResourceState<T> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "ready"; data: T }
  | { status: "error"; message: string; previous?: T };

export type PersistedTrainingCyclesState =
  | { status: "disabled" }
  | TrainingDataResourceState<PersistedTrainingCyclesSnapshot>;

export type TrainingCycleHistoryState =
  | { status: "disabled" }
  | TrainingDataResourceState<readonly TrainingCycle[]>;

export type TrainingDataProfilePrerequisiteState =
  | { status: "disabled" }
  | TrainingDataResourceState<true>;

export type CycleScopedTrainingDataState =
  | { status: "disabled" }
  | { status: "loading"; cycleId: string; previous?: CycleScopedTrainingDataSnapshot }
  | { status: "ready"; cycleId: string; snapshot: CycleScopedTrainingDataSnapshot }
  | { status: "empty"; cycleId: string; snapshot: CycleScopedTrainingDataSnapshot; message: string }
  | { status: "error"; cycleId: string; message: string; previous?: CycleScopedTrainingDataSnapshot };

export interface TrainingDataState {
  appData: TrainingDataResourceState<LegacyTrainingDataSnapshot>;
  cycles: PersistedTrainingCyclesState;
  cycleHistory: TrainingCycleHistoryState;
  cycleScoped: CycleScopedTrainingDataState;
  profilePrerequisite: TrainingDataProfilePrerequisiteState;
}

export function createInitialTrainingDataState(
  cyclesEnabled = false,
): TrainingDataState {
  return {
    appData: { status: "idle" },
    cycles: cyclesEnabled ? { status: "loading" } : { status: "disabled" },
    cycleHistory: cyclesEnabled ? { status: "idle" } : { status: "disabled" },
    cycleScoped: { status: "disabled" },
    profilePrerequisite: { status: "disabled" },
  };
}

export function getTrainingDataResourceValue<T>(
  resource: TrainingDataResourceState<T>,
): T | null {
  if (resource.status === "ready") return resource.data;
  if (resource.status === "loading" || resource.status === "error") {
    return resource.previous ?? null;
  }
  return null;
}

export function getCycleScopedTrainingDataValue(
  resource: CycleScopedTrainingDataState,
): CycleScopedTrainingDataSnapshot | null {
  if (resource.status === "ready" || resource.status === "empty") return resource.snapshot;
  if (resource.status === "loading" || resource.status === "error") {
    return resource.previous ?? null;
  }
  return null;
}
