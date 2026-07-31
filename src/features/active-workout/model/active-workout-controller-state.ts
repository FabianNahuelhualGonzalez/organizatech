import type { TrainingCompletionSummary } from "@/lib/training/training-completion-summary";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import type { PendingWorkoutReadinessLink } from "@/lib/training/workout-draft-storage";

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

export type ActiveWorkoutControllerAction =
  | { type: "active_exercise_index_changed"; index: number }
  | { type: "exercise_drafts_recovered"; drafts: Readonly<Record<string, ExerciseDraft>> }
  | { type: "exercise_draft_updated"; exerciseId: string; draft: ExerciseDraft }
  | { type: "completed_exercise_drafts_removed"; exerciseIds: readonly string[] }
  | { type: "readiness_changed"; readiness: TrainingReadiness }
  | { type: "readiness_cleared" }
  | { type: "readiness_check_started" }
  | { type: "readiness_check_succeeded" }
  | { type: "readiness_check_failed"; error: string }
  | { type: "readiness_save_started" }
  | { type: "readiness_save_succeeded" }
  | { type: "readiness_save_failed"; error: string }
  | { type: "readiness_error_published"; error: string }
  | { type: "readiness_error_cleared" }
  | { type: "training_started" }
  | { type: "training_stopped" }
  | { type: "workout_started_at_set"; startedAt: string }
  | { type: "workout_started_at_cleared" }
  | { type: "workout_attempt_id_set"; attemptId: string }
  | { type: "workout_attempt_id_cleared" }
  | { type: "pending_readiness_link_set"; pendingLink: PendingWorkoutReadinessLink }
  | { type: "pending_readiness_link_cleared" }
  | { type: "workout_recovery_availability_changed"; available: boolean }
  | { type: "completion_summary_set"; summary: TrainingCompletionSummary }
  | { type: "completion_summary_cleared" }
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
    case "exercise_drafts_recovered":
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
    case "readiness_check_succeeded":
      return { ...state, checkingDailyReadiness: false, dailyReadinessError: "" };
    case "readiness_check_failed":
      return {
        ...state,
        checkingDailyReadiness: false,
        dailyReadinessError: action.error,
      };
    case "readiness_save_started":
      return { ...state, savingDailyReadiness: true, dailyReadinessError: "" };
    case "readiness_save_succeeded":
      return { ...state, savingDailyReadiness: false, dailyReadinessError: "" };
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
    case "active_workout_reset":
      return createInitialActiveWorkoutControllerState();
    default:
      return assertNever(action);
  }
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
