import type { TrainingCompletionSummary } from "@/lib/training/training-completion-summary";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import type {
  ActiveWorkoutReadinessContext,
  PendingWorkoutReadinessLink,
} from "@/lib/training/workout-draft-storage";

/**
 * Estado en memoria que pertenece exclusivamente al flujo Active Workout. Infraestructura,
 * navegación, historial del ejercicio, owners de sesión y persistencia permanecen fuera de este
 * modelo y se conectarán en P3-35.
 */
export interface ActiveWorkoutControllerState {
  activeExerciseIndex: number;
  exerciseDrafts: Record<string, ExerciseDraft>;
  readiness: TrainingReadiness | null;
  checkingDailyReadiness: boolean;
  savingDailyReadiness: boolean;
  dailyReadinessError: string;
  hasStartedTraining: boolean;
  activeWorkoutStartedAt: string | null;
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
  hasRecoverableWorkoutStart: boolean;
  trainingCompletionSummary: TrainingCompletionSummary | null;
}

export interface ActiveWorkoutStartTransition {
  activeExerciseIndex: number;
  activeWorkoutStartedAt: string;
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
}

export interface ActiveWorkoutRecoveryTransition extends ActiveWorkoutStartTransition {
  hasStartedTraining: boolean;
  readiness: TrainingReadiness | null;
  exerciseDrafts: Record<string, ExerciseDraft>;
}

export interface ActiveWorkoutCompletionTransition {
  summary: TrainingCompletionSummary;
  completedExerciseIds: string[];
}

export type ActiveWorkoutBoundaryRejectionReason =
  | "invalid_active_exercise_index"
  | "invalid_exercise_count"
  | "invalid_exercise_id"
  | "invalid_workout_started_at"
  | "invalid_workout_attempt_id"
  | "invalid_pending_readiness_link"
  | "pending_readiness_link_attempt_mismatch";

export type ActiveWorkoutBoundaryResult<T> =
  | { kind: "ready"; value: T }
  | { kind: "rejected"; reason: ActiveWorkoutBoundaryRejectionReason };

export type ActiveWorkoutControllerAction =
  | { type: "active_exercise_index_changed"; index: number }
  | { type: "exercise_drafts_replaced"; drafts: Readonly<Record<string, ExerciseDraft>> }
  | { type: "exercise_draft_updated"; exerciseId: string; draft: ExerciseDraft }
  | { type: "completed_exercise_drafts_removed"; exerciseIds: readonly string[] }
  | { type: "readiness_changed"; readiness: TrainingReadiness }
  | { type: "readiness_cleared" }
  | { type: "readiness_check_started" }
  | { type: "readiness_check_finished" }
  | { type: "readiness_check_failed"; error: string }
  | { type: "readiness_save_started" }
  | { type: "readiness_save_finished" }
  | { type: "readiness_save_failed"; error: string }
  | { type: "readiness_error_published"; error: string }
  | { type: "readiness_error_cleared" }
  | { type: "training_started" }
  | { type: "training_stopped" }
  | { type: "training_start_cleared" }
  | { type: "workout_started_at_set"; startedAt: string }
  | { type: "workout_started_at_cleared" }
  | { type: "workout_attempt_id_set"; attemptId: string }
  | { type: "workout_attempt_id_cleared" }
  | { type: "pending_readiness_link_set"; pendingLink: PendingWorkoutReadinessLink }
  | { type: "pending_readiness_link_cleared" }
  | { type: "workout_recovery_availability_changed"; available: boolean }
  | { type: "completion_summary_set"; summary: TrainingCompletionSummary }
  | { type: "completion_summary_cleared" }
  | { type: "workout_start_committed"; transition: ActiveWorkoutStartTransition }
  | { type: "workout_recovered"; transition: ActiveWorkoutRecoveryTransition }
  | { type: "workout_start_marked_recoverable" }
  | { type: "workout_start_aborted" }
  | { type: "workout_attempt_state_cleared" }
  | { type: "workout_finished" }
  | { type: "workout_discarded" }
  | { type: "workout_completion_published"; transition: ActiveWorkoutCompletionTransition }
  | { type: "active_workout_reset" };

/** Cada llamada construye un estado y un mapa de drafts independientes. */
export function createInitialActiveWorkoutControllerState(): ActiveWorkoutControllerState {
  return {
    activeExerciseIndex: 0,
    exerciseDrafts: {},
    readiness: null,
    checkingDailyReadiness: false,
    savingDailyReadiness: false,
    dailyReadinessError: "",
    hasStartedTraining: false,
    activeWorkoutStartedAt: null,
    activeWorkoutAttemptId: null,
    pendingReadinessLink: null,
    hasRecoverableWorkoutStart: false,
    trainingCompletionSummary: null,
  };
}

/**
 * Reducer puro y exhaustivo. Cada boundary que recibe objetos externos los copia por allowlist;
 * ninguna acción puede reemplazar el estado completo ni introducir campos de ownership.
 */
export function activeWorkoutControllerReducer(
  state: ActiveWorkoutControllerState,
  action: ActiveWorkoutControllerAction,
): ActiveWorkoutControllerState {
  switch (action.type) {
    case "active_exercise_index_changed":
      return state.activeExerciseIndex === action.index
        ? state
        : { ...state, activeExerciseIndex: action.index };
    case "exercise_drafts_replaced":
      return { ...state, exerciseDrafts: cloneExerciseDrafts(action.drafts) };
    case "exercise_draft_updated":
      return {
        ...state,
        exerciseDrafts: {
          ...state.exerciseDrafts,
          [action.exerciseId]: cloneExerciseDraft(action.draft),
        },
      };
    case "completed_exercise_drafts_removed": {
      const exerciseIds = new Set(action.exerciseIds);
      const nextEntries = Object.entries(state.exerciseDrafts)
        .filter(([exerciseId]) => !exerciseIds.has(exerciseId));
      if (nextEntries.length === Object.keys(state.exerciseDrafts).length) return state;
      return { ...state, exerciseDrafts: Object.fromEntries(nextEntries) };
    }
    case "readiness_changed":
      return { ...state, readiness: cloneReadiness(action.readiness) };
    case "readiness_cleared":
      return state.readiness === null ? state : { ...state, readiness: null };
    case "readiness_check_started":
      return { ...state, checkingDailyReadiness: true, dailyReadinessError: "" };
    case "readiness_check_finished":
      return state.checkingDailyReadiness
        ? { ...state, checkingDailyReadiness: false }
        : state;
    case "readiness_check_failed":
      return {
        ...state,
        checkingDailyReadiness: false,
        dailyReadinessError: action.error,
      };
    case "readiness_save_started":
      return { ...state, savingDailyReadiness: true, dailyReadinessError: "" };
    case "readiness_save_finished":
      return state.savingDailyReadiness
        ? { ...state, savingDailyReadiness: false }
        : state;
    case "readiness_save_failed":
      return {
        ...state,
        savingDailyReadiness: false,
        dailyReadinessError: action.error,
      };
    case "readiness_error_published":
      return { ...state, dailyReadinessError: action.error };
    case "readiness_error_cleared":
      return state.dailyReadinessError === ""
        ? state
        : { ...state, dailyReadinessError: "" };
    case "training_started":
      return state.hasStartedTraining ? state : { ...state, hasStartedTraining: true };
    case "training_stopped":
      return state.hasStartedTraining ? { ...state, hasStartedTraining: false } : state;
    case "training_start_cleared":
      return {
        ...state,
        readiness: null,
        hasStartedTraining: false,
      };
    case "workout_started_at_set":
      return { ...state, activeWorkoutStartedAt: action.startedAt };
    case "workout_started_at_cleared":
      return state.activeWorkoutStartedAt === null
        ? state
        : { ...state, activeWorkoutStartedAt: null };
    case "workout_attempt_id_set":
      return { ...state, activeWorkoutAttemptId: action.attemptId };
    case "workout_attempt_id_cleared":
      return state.activeWorkoutAttemptId === null
        ? state
        : { ...state, activeWorkoutAttemptId: null };
    case "pending_readiness_link_set":
      return { ...state, pendingReadinessLink: clonePendingReadinessLink(action.pendingLink) };
    case "pending_readiness_link_cleared":
      return state.pendingReadinessLink === null
        ? state
        : { ...state, pendingReadinessLink: null };
    case "workout_recovery_availability_changed":
      return state.hasRecoverableWorkoutStart === action.available
        ? state
        : { ...state, hasRecoverableWorkoutStart: action.available };
    case "completion_summary_set":
      return { ...state, trainingCompletionSummary: cloneTrainingCompletionSummary(action.summary) };
    case "completion_summary_cleared":
      return state.trainingCompletionSummary === null
        ? state
        : { ...state, trainingCompletionSummary: null };
    case "workout_start_committed":
      return {
        ...state,
        activeExerciseIndex: action.transition.activeExerciseIndex,
        activeWorkoutStartedAt: action.transition.activeWorkoutStartedAt,
        activeWorkoutAttemptId: action.transition.activeWorkoutAttemptId,
        pendingReadinessLink: cloneNullablePendingReadinessLink(
          action.transition.pendingReadinessLink,
        ),
        hasRecoverableWorkoutStart: false,
        hasStartedTraining: true,
      };
    case "workout_recovered":
      return {
        ...state,
        activeExerciseIndex: action.transition.activeExerciseIndex,
        activeWorkoutStartedAt: action.transition.activeWorkoutStartedAt,
        activeWorkoutAttemptId: action.transition.activeWorkoutAttemptId,
        pendingReadinessLink: cloneNullablePendingReadinessLink(
          action.transition.pendingReadinessLink,
        ),
        hasStartedTraining: action.transition.hasStartedTraining,
        readiness: action.transition.readiness
          ? cloneReadiness(action.transition.readiness)
          : null,
        exerciseDrafts: cloneExerciseDrafts(action.transition.exerciseDrafts),
      };
    case "workout_start_marked_recoverable":
      return {
        ...state,
        hasStartedTraining: false,
        hasRecoverableWorkoutStart: true,
      };
    case "workout_start_aborted":
      return {
        ...state,
        hasStartedTraining: false,
        activeWorkoutStartedAt: null,
        activeWorkoutAttemptId: null,
        pendingReadinessLink: null,
        hasRecoverableWorkoutStart: false,
      };
    case "workout_attempt_state_cleared":
      return {
        ...state,
        activeWorkoutAttemptId: null,
        pendingReadinessLink: null,
        hasRecoverableWorkoutStart: false,
      };
    case "workout_finished":
      return {
        ...state,
        readiness: null,
        hasStartedTraining: false,
        activeWorkoutStartedAt: null,
        activeWorkoutAttemptId: null,
        pendingReadinessLink: null,
        hasRecoverableWorkoutStart: false,
      };
    case "workout_discarded":
      return {
        ...state,
        exerciseDrafts: {},
        readiness: null,
        hasStartedTraining: false,
        activeWorkoutStartedAt: null,
        activeWorkoutAttemptId: null,
        pendingReadinessLink: null,
        hasRecoverableWorkoutStart: false,
      };
    case "workout_completion_published":
      return {
        ...state,
        exerciseDrafts: removeExerciseDrafts(
          state.exerciseDrafts,
          action.transition.completedExerciseIds,
        ),
        trainingCompletionSummary: cloneTrainingCompletionSummary(
          action.transition.summary,
        ),
      };
    case "active_workout_reset":
      return createInitialActiveWorkoutControllerState();
    default:
      return assertNever(action);
  }
}

export function resolveActiveExerciseIndexChange(input: {
  index: number;
  exerciseCount: number;
}): ActiveWorkoutBoundaryResult<number> {
  if (!Number.isInteger(input.exerciseCount) || input.exerciseCount < 1) {
    return { kind: "rejected", reason: "invalid_exercise_count" };
  }
  if (!isValidActiveExerciseIndex(input.index, input.exerciseCount)) {
    return { kind: "rejected", reason: "invalid_active_exercise_index" };
  }
  return { kind: "ready", value: input.index };
}

export function resolveActiveWorkoutStartTransition(input: {
  activeExerciseIndex: number;
  exerciseCount: number;
  activeWorkoutStartedAt: string;
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
}): ActiveWorkoutBoundaryResult<ActiveWorkoutStartTransition> {
  const index = resolveActiveExerciseIndexChange({
    index: input.activeExerciseIndex,
    exerciseCount: input.exerciseCount,
  });
  if (index.kind === "rejected") return index;
  const identity = resolveWorkoutIdentityBoundary(input);
  if (identity.kind === "rejected") return identity;

  return {
    kind: "ready",
    value: {
      activeExerciseIndex: index.value,
      activeWorkoutStartedAt: input.activeWorkoutStartedAt,
      activeWorkoutAttemptId: identity.value.activeWorkoutAttemptId,
      pendingReadinessLink: identity.value.pendingReadinessLink,
    },
  };
}

/**
 * Recovery receives the canonical output of loadActiveWorkoutDraft. The storage boundary already
 * normalizes the available exercise set, so this boundary validates the persisted index itself;
 * interactive selections use resolveActiveExerciseIndexChange with the current set size.
 */
export function resolveActiveWorkoutRecoveryTransition(input: {
  activeExerciseIndex: number;
  activeWorkoutStartedAt: string;
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
  hasStartedTraining: boolean;
  readiness: TrainingReadiness | null;
  exerciseDrafts: Readonly<Record<string, ExerciseDraft>>;
}): ActiveWorkoutBoundaryResult<ActiveWorkoutRecoveryTransition> {
  if (!Number.isInteger(input.activeExerciseIndex) || input.activeExerciseIndex < 0) {
    return { kind: "rejected", reason: "invalid_active_exercise_index" };
  }
  const identity = resolveWorkoutIdentityBoundary(input);
  if (identity.kind === "rejected") return identity;
  if (Object.keys(input.exerciseDrafts).some((exerciseId) => !isNonEmptyValue(exerciseId))) {
    return { kind: "rejected", reason: "invalid_exercise_id" };
  }

  return {
    kind: "ready",
    value: {
      activeExerciseIndex: input.activeExerciseIndex,
      activeWorkoutStartedAt: input.activeWorkoutStartedAt,
      activeWorkoutAttemptId: identity.value.activeWorkoutAttemptId,
      pendingReadinessLink: identity.value.pendingReadinessLink,
      hasStartedTraining: input.hasStartedTraining,
      readiness: input.readiness ? cloneReadiness(input.readiness) : null,
      exerciseDrafts: cloneExerciseDrafts(input.exerciseDrafts),
    },
  };
}

export function resolveActiveWorkoutExerciseDraftUpdate(input: {
  exerciseId: string;
  draft: ExerciseDraft;
}): ActiveWorkoutBoundaryResult<{ exerciseId: string; draft: ExerciseDraft }> {
  if (!isNonEmptyValue(input.exerciseId)) {
    return { kind: "rejected", reason: "invalid_exercise_id" };
  }
  return {
    kind: "ready",
    value: {
      exerciseId: input.exerciseId,
      draft: cloneExerciseDraft(input.draft),
    },
  };
}

export function createActiveWorkoutReadinessContext(input: {
  workoutAttemptId: string | null;
  cycleId: string | null;
  cycleDayId: string | null;
  workoutStartedAt: string | null;
  plannedDay?: string | null;
  plannedDate?: string | null;
}): ActiveWorkoutReadinessContext | null {
  if (
    !input.workoutAttemptId || !isNonEmptyValue(input.workoutAttemptId) ||
    !input.cycleId || !isNonEmptyValue(input.cycleId) ||
    !input.cycleDayId || !isNonEmptyValue(input.cycleDayId) ||
    !input.workoutStartedAt || !isNonEmptyValue(input.workoutStartedAt)
  ) return null;

  return {
    workoutAttemptId: input.workoutAttemptId,
    cycleId: input.cycleId,
    cycleDayId: input.cycleDayId,
    workoutStartedAt: input.workoutStartedAt,
    plannedDay: input.plannedDay ?? null,
    plannedDate: input.plannedDate ?? null,
  };
}

export function resolvePendingReadinessLinkUpdate(input: {
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
}): ActiveWorkoutBoundaryResult<PendingWorkoutReadinessLink | null> {
  if (input.activeWorkoutAttemptId !== null && !isNonEmptyValue(input.activeWorkoutAttemptId)) {
    return { kind: "rejected", reason: "invalid_workout_attempt_id" };
  }
  if (!input.pendingReadinessLink) return { kind: "ready", value: null };
  if (
    !isNonEmptyValue(input.pendingReadinessLink.workoutAttemptId) ||
    !isNonEmptyValue(input.pendingReadinessLink.trainingSessionId)
  ) {
    return { kind: "rejected", reason: "invalid_pending_readiness_link" };
  }
  if (input.pendingReadinessLink.workoutAttemptId !== input.activeWorkoutAttemptId) {
    return { kind: "rejected", reason: "pending_readiness_link_attempt_mismatch" };
  }
  return {
    kind: "ready",
    value: clonePendingReadinessLink(input.pendingReadinessLink),
  };
}

export function resolveActiveWorkoutCompletionTransition(input: {
  summary: TrainingCompletionSummary;
  completedExerciseIds: readonly string[];
}): ActiveWorkoutBoundaryResult<ActiveWorkoutCompletionTransition> {
  if (input.completedExerciseIds.some((exerciseId) => !isNonEmptyValue(exerciseId))) {
    return { kind: "rejected", reason: "invalid_exercise_id" };
  }
  return {
    kind: "ready",
    value: {
      summary: cloneTrainingCompletionSummary(input.summary),
      completedExerciseIds: [...new Set(input.completedExerciseIds)],
    },
  };
}

function resolveWorkoutIdentityBoundary(input: {
  activeWorkoutStartedAt: string;
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
}): ActiveWorkoutBoundaryResult<{
  activeWorkoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
}> {
  if (!isNonEmptyValue(input.activeWorkoutStartedAt)) {
    return { kind: "rejected", reason: "invalid_workout_started_at" };
  }
  const pendingLink = resolvePendingReadinessLinkUpdate({
    activeWorkoutAttemptId: input.activeWorkoutAttemptId,
    pendingReadinessLink: input.pendingReadinessLink,
  });
  if (pendingLink.kind === "rejected") return pendingLink;
  return {
    kind: "ready",
    value: {
      activeWorkoutAttemptId: input.activeWorkoutAttemptId,
      pendingReadinessLink: pendingLink.value,
    },
  };
}

function isValidActiveExerciseIndex(index: number, exerciseCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < exerciseCount;
}

function isNonEmptyValue(value: string): boolean {
  return value.trim().length > 0;
}

function cloneExerciseDraft(draft: ExerciseDraft): ExerciseDraft {
  return {
    weight: draft.weight,
    rir: draft.rir,
    reps: [...draft.reps],
    registered: draft.registered,
    observation: draft.observation,
  };
}

function cloneExerciseDrafts(
  drafts: Readonly<Record<string, ExerciseDraft>>,
): Record<string, ExerciseDraft> {
  return Object.fromEntries(Object.entries(drafts).map(([exerciseId, draft]) => [
    exerciseId,
    cloneExerciseDraft(draft),
  ]));
}

function cloneReadiness(readiness: TrainingReadiness): TrainingReadiness {
  return {
    motivation: readiness.motivation,
    hydration: readiness.hydration,
    sleep: readiness.sleep,
    energy: readiness.energy,
    skipped: readiness.skipped,
  };
}

function clonePendingReadinessLink(
  pendingLink: PendingWorkoutReadinessLink,
): PendingWorkoutReadinessLink {
  return {
    workoutAttemptId: pendingLink.workoutAttemptId,
    trainingSessionId: pendingLink.trainingSessionId,
  };
}

function cloneNullablePendingReadinessLink(
  pendingLink: PendingWorkoutReadinessLink | null,
): PendingWorkoutReadinessLink | null {
  return pendingLink ? clonePendingReadinessLink(pendingLink) : null;
}

function removeExerciseDrafts(
  drafts: Readonly<Record<string, ExerciseDraft>>,
  exerciseIds: readonly string[],
): Record<string, ExerciseDraft> {
  const completedIds = new Set(exerciseIds);
  return Object.fromEntries(
    Object.entries(drafts).filter(([exerciseId]) => !completedIds.has(exerciseId)),
  );
}

function cloneTrainingCompletionSummary(
  summary: TrainingCompletionSummary,
): TrainingCompletionSummary {
  return {
    sessionId: summary.sessionId,
    dayLabel: summary.dayLabel,
    statusLabel: summary.statusLabel,
    workoutName: summary.workoutName,
    cycleLabel: summary.cycleLabel,
    weekLabel: summary.weekLabel,
    progressLabel: summary.progressLabel,
    durationMinutes: summary.durationMinutes,
    durationLabel: summary.durationLabel,
    exercises: summary.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      exerciseLineageId: exercise.exerciseLineageId,
      exerciseName: exercise.exerciseName,
      currentDate: exercise.currentDate,
      currentDateLabel: exercise.currentDateLabel,
      currentSeriesCount: exercise.currentSeriesCount,
      currentTotalReps: exercise.currentTotalReps,
      currentWeight: exercise.currentWeight,
      currentWeightLabel: exercise.currentWeightLabel,
      previousDate: exercise.previousDate,
      previousDateLabel: exercise.previousDateLabel,
      previousSeriesCount: exercise.previousSeriesCount,
      previousTotalReps: exercise.previousTotalReps,
      previousWeightLabel: exercise.previousWeightLabel,
      repsDifference: exercise.repsDifference,
      weightDifference: exercise.weightDifference,
      comparisonStatus: exercise.comparisonStatus,
      repsTone: exercise.repsTone,
      weightTone: exercise.weightTone,
      resultLines: exercise.resultLines.map((line) => ({
        label: line.label,
        tone: line.tone,
      })),
    })),
  };
}

function assertNever(action: never): never {
  throw new Error(`Accion de Active Workout no reconocida: ${JSON.stringify(action)}`);
}
