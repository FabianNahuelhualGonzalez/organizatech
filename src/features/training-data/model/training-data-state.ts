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
  history: readonly TrainingCycle[];
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

export type CycleScopedTrainingDataState =
  | { status: "disabled" }
  | { status: "loading"; cycleId: string }
  | { status: "ready"; cycleId: string; snapshot: CycleScopedTrainingDataSnapshot }
  | { status: "empty"; cycleId: string; snapshot: CycleScopedTrainingDataSnapshot; message: string }
  | { status: "error"; cycleId: string; message: string };

export interface TrainingDataState {
  appData: TrainingDataResourceState<LegacyTrainingDataSnapshot>;
  cycles: PersistedTrainingCyclesState;
  cycleScoped: CycleScopedTrainingDataState;
}

export function createInitialTrainingDataState(
  cyclesEnabled = false,
): TrainingDataState {
  return {
    appData: { status: "idle" },
    cycles: cyclesEnabled ? { status: "loading" } : { status: "disabled" },
    cycleScoped: { status: "disabled" },
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
