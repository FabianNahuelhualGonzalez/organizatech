export const TRAINING_CYCLE_PORTAL_SCOPES = ["usuario", "coach"] as const;
export type TrainingCyclePortalScope = (typeof TRAINING_CYCLE_PORTAL_SCOPES)[number];

export const TRAINING_CYCLE_RPC_GOALS = ["strength", "volume", "definition", "deload"] as const;
export type TrainingCycleRpcGoal = (typeof TRAINING_CYCLE_RPC_GOALS)[number];

export const TRAINING_CYCLE_RPC_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type TrainingCycleRpcWeekday = (typeof TRAINING_CYCLE_RPC_WEEKDAYS)[number];

export const TRAINING_CYCLE_UI_MUSCLES = [
  "Pectoral",
  "Hombros",
  "Tríceps",
  "Dorsal",
  "Bíceps",
  "Trapecio",
  "Cuádriceps",
  "Femoral",
  "Glúteos",
  "Pantorrillas",
  "Pierna completa",
  "Abdomen",
] as const;
export type TrainingCycleUiMuscle = (typeof TRAINING_CYCLE_UI_MUSCLES)[number];

export const TRAINING_CYCLE_CANONICAL_MUSCLES = [
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
export type TrainingCycleCanonicalMuscle = (typeof TRAINING_CYCLE_CANONICAL_MUSCLES)[number];

export const TRAINING_CYCLE_RPC_MUSCLES = [
  "pectoral",
  "hombros",
  "triceps",
  "dorsal",
  "biceps",
  "trapecio",
  "cuadriceps",
  "femoral",
  "gluteos",
  "pantorrillas",
  "pierna_completa",
  "abdomen",
] as const;
export type TrainingCycleRpcMuscle = (typeof TRAINING_CYCLE_RPC_MUSCLES)[number];

export const TRAINING_CYCLE_RPC_TECHNIQUES = [
  "linear",
  "ascending",
  "descending",
  "drop_set",
  "failure",
] as const;
export type TrainingCycleRpcTechnique = (typeof TRAINING_CYCLE_RPC_TECHNIQUES)[number];

export const TRAINING_CYCLE_OPERATION_KINDS = [
  "custom_exercise_create",
  "draft_create",
  "draft_save",
  "draft_duplicate",
  "draft_renewal",
  "draft_discard",
  "cycle_activate",
  "cycle_edit",
  "cycle_extend",
  "cycle_execution_record",
  "notifications_mark_read",
] as const;
export type TrainingCycleOperationKind = (typeof TRAINING_CYCLE_OPERATION_KINDS)[number];

export type TrainingCycleExerciseSource =
  | { readonly kind: "catalog"; readonly id: string }
  | { readonly kind: "custom"; readonly id: string };

export interface TrainingCycleRpcDropPlan {
  readonly order: number;
  readonly kg: number;
  readonly reps: number;
}

export interface TrainingCycleRpcSetPlan {
  readonly order: number;
  readonly targetReps: number;
  readonly targetKg: number;
  readonly toFailure: boolean;
  readonly drops: readonly TrainingCycleRpcDropPlan[];
}

export interface TrainingCycleRpcExercisePlan {
  readonly catalogExerciseId?: string;
  readonly customExerciseId?: string;
  readonly order: number;
  readonly technique: TrainingCycleRpcTechnique;
  readonly videoUrl: string | null;
  readonly sets: readonly TrainingCycleRpcSetPlan[];
}

export interface TrainingCycleRpcDayPlan {
  readonly day: TrainingCycleRpcWeekday;
  readonly name: string;
  readonly order: number;
  readonly exercises: readonly TrainingCycleRpcExercisePlan[];
}

export interface TrainingCycleRpcPlan {
  readonly days: readonly TrainingCycleRpcDayPlan[];
}

export interface TrainingCycleAcceptedOperation {
  readonly responseKind: "accepted_operation";
  readonly requestId: string;
  readonly operationKind: TrainingCycleOperationKind;
  readonly aggregateId: string;
  readonly resultVersion: number | null;
}

export interface TrainingCycleCatalogCursor {
  readonly afterSourceKind: "catalog" | "custom";
  readonly afterSortOrder: number;
  readonly afterName: string;
  readonly afterSourceId: string;
}

export interface TrainingCycleCatalogItem {
  readonly source: TrainingCycleExerciseSource;
  readonly name: string;
  readonly muscleGroup: TrainingCycleRpcMuscle;
  readonly videoUrl: string | null;
}

export interface TrainingCycleCatalogPage {
  readonly items: readonly TrainingCycleCatalogItem[];
  readonly nextCursor: TrainingCycleCatalogCursor | null;
}

export type TrainingCycleDraftOrigin = "manual" | "suggested" | "duplicate" | "renewal";
export type TrainingCycleDraftState = "draft" | "activated" | "discarded";

export interface TrainingCycleDraftSnapshot {
  readonly draftId: string;
  readonly origin: TrainingCycleDraftOrigin;
  readonly sourceCycleId: string | null;
  readonly state: TrainingCycleDraftState;
  readonly version: number;
  readonly goal: TrainingCycleRpcGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly plan: TrainingCycleRpcPlan;
  readonly activatedCycleId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrainingCycleSnapshotDrop extends TrainingCycleRpcDropPlan {
  readonly snapshotId: string;
}

export interface TrainingCycleSnapshotSet extends Omit<TrainingCycleRpcSetPlan, "drops"> {
  readonly snapshotId: string;
  readonly drops: readonly TrainingCycleSnapshotDrop[];
}

export interface TrainingCycleSnapshotExercise {
  readonly snapshotId: string;
  readonly source: TrainingCycleExerciseSource;
  readonly exerciseLineageId: string;
  readonly name: string;
  readonly muscleGroup: TrainingCycleRpcMuscle;
  readonly order: number;
  readonly technique: TrainingCycleRpcTechnique;
  readonly videoUrl: string | null;
  readonly legacyCycleExerciseId: string | null;
  readonly sets: readonly TrainingCycleSnapshotSet[];
}

export interface TrainingCycleSnapshotDay {
  readonly snapshotId: string;
  readonly day: TrainingCycleRpcWeekday;
  readonly name: string;
  readonly order: number;
  readonly legacyCycleDayId: string | null;
  readonly exercises: readonly TrainingCycleSnapshotExercise[];
}

export interface TrainingCycleSnapshotPlan {
  readonly days: readonly TrainingCycleSnapshotDay[];
}

export type TrainingCyclePublicStatus = "active" | "expiring" | "closed";

export interface TrainingCycleRpcSnapshot {
  readonly cycleId: string;
  readonly portalScope: TrainingCyclePortalScope;
  readonly cycleNumber: number;
  readonly goal: TrainingCycleRpcGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: TrainingCyclePublicStatus;
  readonly daysUntilEnd: number;
  readonly version: number;
  readonly snapshotId: string;
  readonly extensionCount: number;
  readonly sourceDraftId: string | null;
  readonly sourceCycleId: string | null;
  readonly closedAt: string | null;
  readonly closedReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly plan: TrainingCycleSnapshotPlan;
}

export interface TrainingCycleLifecycleRefresh {
  readonly closedCycleId: string | null;
  readonly refreshedAt: string;
}

export interface TrainingCycleListCursor {
  readonly beforeCreatedAt: string;
  readonly beforeId: string;
}

export interface TrainingCycleListItem {
  readonly cycleId: string;
  readonly cycleNumber: number;
  readonly goal: TrainingCycleRpcGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: TrainingCyclePublicStatus;
  readonly version: number;
  readonly snapshotId: string;
  readonly extensionCount: number;
  readonly closedAt: string | null;
  readonly updatedAt: string;
}

export interface TrainingCycleListPage {
  readonly items: readonly TrainingCycleListItem[];
  readonly nextCursor: TrainingCycleListCursor | null;
}

export interface TrainingCycleVersionCursor {
  readonly beforeVersion: number;
}

export type TrainingCycleChangeKind = "activation" | "edit" | "extension";

export interface TrainingCycleVersionItem {
  readonly snapshotId: string;
  readonly version: number;
  readonly changeKind: TrainingCycleChangeKind;
  readonly goal: TrainingCycleRpcGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly sourceSnapshotId: string | null;
  readonly createdAt: string;
}

export interface TrainingCycleVersionPage {
  readonly items: readonly TrainingCycleVersionItem[];
  readonly nextCursor: TrainingCycleVersionCursor | null;
}

export interface TrainingCycleVersionSnapshot extends TrainingCycleVersionItem {
  readonly cycleId: string;
  readonly plan: TrainingCycleSnapshotPlan;
}

export type TrainingCycleNotificationEvent =
  | "expires_t3"
  | "expires_t2"
  | "expires_t1"
  | "expires_t0"
  | "closed_t1";

export interface TrainingCycleNotificationCursor {
  readonly beforeMaterializedAt: string;
  readonly beforeId: string;
}

export interface TrainingCycleNotificationItem {
  readonly notificationId: string;
  readonly cycleId: string;
  readonly eventKind: TrainingCycleNotificationEvent;
  readonly scheduledOn: string;
  readonly title: string;
  readonly body: string;
  readonly materializedAt: string;
  readonly readAt: string | null;
}

export interface TrainingCycleNotificationPage {
  readonly items: readonly TrainingCycleNotificationItem[];
  readonly nextCursor: TrainingCycleNotificationCursor | null;
}

export interface TrainingCycleUiExecutionDrop {
  readonly planDropId: string;
  readonly order: number;
  readonly completed: boolean;
  readonly reps: number | null;
  readonly kg: number | null;
}

export interface TrainingCycleUiExecutionSet {
  readonly planSetId: string;
  readonly order: number;
  readonly completed: boolean;
  readonly reps: number | null;
  readonly kg: number | null;
  readonly reachedFailure: boolean;
  readonly drops: readonly TrainingCycleUiExecutionDrop[];
}

export interface TrainingCycleUiExecutionExercise {
  readonly planExerciseId: string;
  readonly order: number;
  readonly sets: readonly TrainingCycleUiExecutionSet[];
}

export interface TrainingCycleUiExecution {
  readonly dayId: string;
  readonly exercises: readonly TrainingCycleUiExecutionExercise[];
}

export interface TrainingCycleRpcExecutionDrop extends Omit<TrainingCycleUiExecutionDrop, "order"> {
  readonly order: number;
}

export interface TrainingCycleRpcExecutionSet extends Omit<TrainingCycleUiExecutionSet, "order" | "drops"> {
  readonly order: number;
  readonly drops: readonly TrainingCycleRpcExecutionDrop[];
}

export interface TrainingCycleRpcExecutionExercise
  extends Omit<TrainingCycleUiExecutionExercise, "order" | "sets"> {
  readonly order: number;
  readonly sets: readonly TrainingCycleRpcExecutionSet[];
}

export interface TrainingCycleRpcExecution {
  readonly dayId: string;
  readonly exercises: readonly TrainingCycleRpcExecutionExercise[];
}

export const TRAINING_CYCLE_PUBLIC_ERROR_CODES = [
  "invalid_input",
  "incomplete_plan",
  "session_required",
  "session_mismatch",
  "stale_operation",
  "conflict",
  "forbidden",
  "not_found",
  "quota_reached",
  "invalid_state",
  "not_supported",
  "service_unavailable",
  "invalid_response",
] as const;
export type TrainingCyclePublicErrorCode = (typeof TRAINING_CYCLE_PUBLIC_ERROR_CODES)[number];

export class TrainingCycleTransportError extends Error {
  readonly code: TrainingCyclePublicErrorCode;

  constructor(code: TrainingCyclePublicErrorCode, message: string) {
    super(message);
    this.name = "TrainingCycleTransportError";
    this.code = code;
  }
}
