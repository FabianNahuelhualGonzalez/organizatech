"use client";

import { useMemo, useReducer } from "react";

import {
  activeWorkoutControllerReducer,
  createInitialActiveWorkoutControllerState,
  resolveActiveExerciseIndexChange,
  resolveActiveWorkoutCompletionTransition,
  resolveActiveWorkoutExerciseDraftUpdate,
  type ActiveWorkoutControllerState,
  type ActiveWorkoutRecoveryTransition,
  type ActiveWorkoutStartTransition,
} from "@/features/active-workout/model/active-workout-controller-state";

type ControllerExerciseDraft = ActiveWorkoutControllerState["exerciseDrafts"][string];
type ControllerReadiness = NonNullable<ActiveWorkoutControllerState["readiness"]>;
type ControllerPendingLink = NonNullable<ActiveWorkoutControllerState["pendingReadinessLink"]>;

export interface ActiveWorkoutControllerActions {
  selectExercise: (index: number, exerciseCount: number) => boolean;
  replaceExerciseDrafts: (
    drafts: Readonly<Record<string, ControllerExerciseDraft>>,
  ) => void;
  updateExerciseDraft: (exerciseId: string, draft: ControllerExerciseDraft) => boolean;
  publishReadiness: (readiness: ControllerReadiness) => void;
  clearReadiness: () => void;
  beginDailyReadinessCheck: () => void;
  completeDailyReadinessCheck: () => void;
  failDailyReadinessCheck: (error: string) => void;
  beginDailyReadinessSave: () => void;
  completeDailyReadinessSave: () => void;
  failDailyReadinessSave: (error: string) => void;
  publishDailyReadinessError: (error: string) => void;
  clearDailyReadinessError: () => void;
  markTrainingStopped: () => void;
  clearTrainingStart: () => void;
  recordWorkoutStartedAt: (startedAt: string) => void;
  publishPendingReadinessLink: (pendingLink: ControllerPendingLink) => void;
  clearPendingReadinessLink: () => void;
  clearTrainingCompletionSummary: () => void;
  commitWorkoutStart: (transition: ActiveWorkoutStartTransition) => void;
  recoverWorkout: (transition: ActiveWorkoutRecoveryTransition) => void;
  markWorkoutStartRecoverable: () => void;
  clearRecoverableWorkoutStart: () => void;
  abortWorkoutStart: () => void;
  finishWorkout: () => void;
  discardWorkout: () => void;
  publishWorkoutCompletion: (
    summary: NonNullable<ActiveWorkoutControllerState["trainingCompletionSummary"]>,
    completedExerciseIds: readonly string[],
  ) => boolean;
  resetActiveWorkout: () => void;
}

export interface UseActiveWorkoutControllerResult {
  state: Readonly<ActiveWorkoutControllerState>;
  actions: Readonly<ActiveWorkoutControllerActions>;
}

/**
 * Adaptador React mínimo para el modelo puro. No carga, guarda, navega ni posee owners; P3-35
 * conectará estas acciones con las fronteras productivas existentes.
 */
export function useActiveWorkoutController(): UseActiveWorkoutControllerResult {
  const [state, dispatch] = useReducer(
    activeWorkoutControllerReducer,
    undefined,
    createInitialActiveWorkoutControllerState,
  );

  const actions = useMemo<ActiveWorkoutControllerActions>(() => ({
    selectExercise: (index, exerciseCount) => {
      const selection = resolveActiveExerciseIndexChange({ index, exerciseCount });
      if (selection.kind === "rejected") return false;
      dispatch({ type: "active_exercise_index_changed", index: selection.value });
      return true;
    },
    replaceExerciseDrafts: (drafts) => {
      dispatch({ type: "exercise_drafts_replaced", drafts });
    },
    updateExerciseDraft: (exerciseId, draft) => {
      const update = resolveActiveWorkoutExerciseDraftUpdate({ exerciseId, draft });
      if (update.kind === "rejected") return false;
      dispatch({ type: "exercise_draft_updated", ...update.value });
      return true;
    },
    publishReadiness: (readiness) => {
      dispatch({ type: "readiness_changed", readiness });
    },
    clearReadiness: () => {
      dispatch({ type: "readiness_cleared" });
    },
    beginDailyReadinessCheck: () => {
      dispatch({ type: "readiness_check_started" });
    },
    completeDailyReadinessCheck: () => {
      dispatch({ type: "readiness_check_finished" });
    },
    failDailyReadinessCheck: (error) => {
      dispatch({ type: "readiness_check_failed", error });
    },
    beginDailyReadinessSave: () => {
      dispatch({ type: "readiness_save_started" });
    },
    completeDailyReadinessSave: () => {
      dispatch({ type: "readiness_save_finished" });
    },
    failDailyReadinessSave: (error) => {
      dispatch({ type: "readiness_save_failed", error });
    },
    publishDailyReadinessError: (error) => {
      dispatch({ type: "readiness_error_published", error });
    },
    clearDailyReadinessError: () => {
      dispatch({ type: "readiness_error_cleared" });
    },
    markTrainingStopped: () => {
      dispatch({ type: "training_stopped" });
    },
    clearTrainingStart: () => {
      dispatch({ type: "training_start_cleared" });
    },
    recordWorkoutStartedAt: (startedAt) => {
      dispatch({ type: "workout_started_at_set", startedAt });
    },
    publishPendingReadinessLink: (pendingLink) => {
      dispatch({ type: "pending_readiness_link_set", pendingLink });
    },
    clearPendingReadinessLink: () => {
      dispatch({ type: "pending_readiness_link_cleared" });
    },
    clearTrainingCompletionSummary: () => {
      dispatch({ type: "completion_summary_cleared" });
    },
    commitWorkoutStart: (transition) => {
      dispatch({ type: "workout_start_committed", transition });
    },
    recoverWorkout: (transition) => {
      dispatch({ type: "workout_recovered", transition });
    },
    markWorkoutStartRecoverable: () => {
      dispatch({ type: "workout_start_marked_recoverable" });
    },
    clearRecoverableWorkoutStart: () => {
      dispatch({ type: "workout_recovery_availability_changed", available: false });
    },
    abortWorkoutStart: () => {
      dispatch({ type: "workout_start_aborted" });
    },
    finishWorkout: () => {
      dispatch({ type: "workout_finished" });
    },
    discardWorkout: () => {
      dispatch({ type: "workout_discarded" });
    },
    publishWorkoutCompletion: (summary, completedExerciseIds) => {
      const completion = resolveActiveWorkoutCompletionTransition({
        summary,
        completedExerciseIds,
      });
      if (completion.kind === "rejected") return false;
      dispatch({ type: "workout_completion_published", transition: completion.value });
      return true;
    },
    resetActiveWorkout: () => {
      dispatch({ type: "active_workout_reset" });
    },
  }), [dispatch]);

  return useMemo(() => ({ state, actions }), [actions, state]);
}
