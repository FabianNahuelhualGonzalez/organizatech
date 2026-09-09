export const TRAINING_CYCLE_BUILDER_SCHEMA_VERSION = 1 as const;

export const TRAINING_GOALS = [
  "strength",
  "volume",
  "definition",
  "deload",
] as const;

export type TrainingGoal = (typeof TRAINING_GOALS)[number];

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const MUSCLE_GROUPS = [
  "chest",
  "shoulders",
  "triceps",
  "back",
  "biceps",
  "trapezius",
  "quadriceps",
  "hamstrings",
  "glutes",
  "calves",
  "full_leg",
  "core",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const TRAINING_TECHNIQUES = [
  "linear",
  "ascending",
  "descending",
  "drop_set",
  "failure",
] as const;

export type TrainingTechnique = (typeof TRAINING_TECHNIQUES)[number];

export const DRAFT_STATUSES = ["draft", "activated", "discarded"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const CYCLE_PUBLIC_STATUSES = ["active", "expiring", "closed"] as const;
export type CyclePublicStatus = (typeof CYCLE_PUBLIC_STATUSES)[number];

export type LoadBasis = "external" | "bodyweight";

export type ExerciseSource =
  | { readonly kind: "catalog"; readonly catalogExerciseId: string }
  | { readonly kind: "custom"; readonly customExerciseId: string };

export interface DropDraft {
  readonly id: string;
  readonly sourceDropId: string | null;
  readonly order: number;
  readonly kg: number;
  readonly reps: number;
}

export interface SetDraft {
  readonly id: string;
  readonly sourceSetId: string | null;
  readonly order: number;
  readonly targetReps: number;
  readonly targetKg: number;
  readonly toFailure: boolean;
  readonly drops: readonly DropDraft[];
}

export interface ExerciseDraft {
  readonly id: string;
  readonly sourceExerciseId: string | null;
  readonly source: ExerciseSource;
  readonly name: string;
  readonly primaryMuscleGroup: MuscleGroup;
  readonly loadBasis: LoadBasis;
  readonly order: number;
  readonly technique: TrainingTechnique;
  readonly videoUrl: string | null;
  readonly sets: readonly SetDraft[];
}

export interface TrainingDayDraft {
  readonly day: Weekday;
  readonly name: string;
  readonly exercises: readonly ExerciseDraft[];
}

export type RoutineDraftsByWeekday = Readonly<Partial<Record<Weekday, TrainingDayDraft>>>;

export interface TrainingCyclePlanContent {
  readonly goal: TrainingGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly selectedDays: readonly Weekday[];
  /**
   * Puede conservar días deseleccionados para no destruir trabajo del usuario. Las proyecciones,
   * métricas y validaciones funcionales sólo consideran `selectedDays`.
   */
  readonly routines: RoutineDraftsByWeekday;
}

export type DraftOrigin = "manual" | "suggested" | "duplicated";

export interface TrainingCycleDraft extends TrainingCyclePlanContent {
  readonly schemaVersion: typeof TRAINING_CYCLE_BUILDER_SCHEMA_VERSION;
  readonly draftId: string;
  readonly status: DraftStatus;
  readonly revision: number;
  readonly origin: DraftOrigin;
  readonly sourceSnapshotId: string | null;
}

export type SnapshotReason = "activation" | "edit" | "extension" | "closure";

export interface CyclePlanSnapshot {
  readonly schemaVersion: typeof TRAINING_CYCLE_BUILDER_SCHEMA_VERSION;
  readonly snapshotId: string;
  readonly cycleId: string;
  readonly version: number;
  readonly capturedAt: string;
  readonly reason: SnapshotReason;
  readonly previousSnapshotId: string | null;
  readonly content: TrainingCyclePlanContent;
}

export interface VersionedTrainingCycle {
  readonly cycleId: string;
  readonly currentSnapshotId: string;
  readonly snapshots: readonly CyclePlanSnapshot[];
}

export interface PersistedDropPlan {
  readonly order: number;
  readonly kg: number;
  readonly reps: number;
}

export interface PersistedSetPlan {
  readonly order: number;
  readonly targetReps: number;
  readonly targetKg: number;
  readonly toFailure: boolean;
  readonly drops: readonly PersistedDropPlan[];
}

export type PersistedExercisePlan = {
  readonly order: number;
  readonly technique: TrainingTechnique;
  readonly videoUrl: string | null;
  readonly sets: readonly PersistedSetPlan[];
} & (
  | { readonly catalogExerciseId: string; readonly customExerciseId?: never }
  | { readonly catalogExerciseId?: never; readonly customExerciseId: string }
);

export interface PersistedTrainingDayPlan {
  readonly day: Weekday;
  readonly name: string;
  readonly order: number;
  readonly exercises: readonly PersistedExercisePlan[];
}

export interface PersistedTrainingCyclePlan {
  readonly days: readonly PersistedTrainingDayPlan[];
}

export interface TrainingCycleBuilderLimits {
  readonly maxCycleSpanDays: number;
  readonly maxRoutineNameLength: number;
  readonly maxExerciseNameLength: number;
  readonly maxExercisesPerDay: number;
  readonly maxSetsPerExercise: number;
  readonly maxDropsPerSet: number;
  readonly maxTargetReps: number;
  readonly maxTargetKg: number;
  readonly maxAliasesPerExercise: number;
}

/** Límites de seguridad del modelo; no pretenden definir una prescripción deportiva. */
export const DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS: TrainingCycleBuilderLimits = Object.freeze({
  maxCycleSpanDays: 730,
  maxRoutineNameLength: 120,
  maxExerciseNameLength: 120,
  maxExercisesPerDay: 50,
  maxSetsPerExercise: 20,
  maxDropsPerSet: 8,
  maxTargetReps: 1_000,
  maxTargetKg: 99_999.99,
  maxAliasesPerExercise: 20,
});

export function isTrainingGoal(value: unknown): value is TrainingGoal {
  return typeof value === "string" && (TRAINING_GOALS as readonly string[]).includes(value);
}

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === "string" && (WEEKDAYS as readonly string[]).includes(value);
}

export function isMuscleGroup(value: unknown): value is MuscleGroup {
  return typeof value === "string" && (MUSCLE_GROUPS as readonly string[]).includes(value);
}

export function isTrainingTechnique(value: unknown): value is TrainingTechnique {
  return typeof value === "string" && (TRAINING_TECHNIQUES as readonly string[]).includes(value);
}
