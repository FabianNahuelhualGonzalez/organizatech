"use client";

import { useMemo, useReducer } from "react";

import {
  activeWorkoutControllerReducer,
  createInitialActiveWorkoutControllerState,
  type ActiveWorkoutControllerState,
} from "@/features/active-workout/model/active-workout-controller-state";

type ControllerExerciseDraft = ActiveWorkoutControllerState["exerciseDrafts"][string];
type ControllerReadiness = NonNullable<ActiveWorkoutControllerState["readiness"]>;
type ControllerPendingLink = NonNullable<ActiveWorkoutControllerState["pendingReadinessLink"]>;
type ControllerCompletionSummary = NonNullable<ActiveWorkoutControllerState["trainingCompletionSummary"]>;

export interface ActiveWorkoutControllerActions {
  setActiveExerciseIndex: (index: number) => void;
  replaceExerciseDraftsFromRecovery: (
    drafts: Readonly<Record<string, ControllerExerciseDraft>>,
  ) => void;
  updateExerciseDraft: (exerciseId: string, draft: ControllerExerciseDraft) => void;
  removeCompletedExerciseDrafts: (exerciseIds: readonly string[]) => void;
  setReadiness: (readiness: ControllerReadiness) => void;
  clearReadiness: () => void;
  beginDailyReadinessCheck: () => void;
  completeDailyReadinessCheck: () => void;
  failDailyReadinessCheck: (error: string) => void;
  beginDailyReadinessSave: () => void;
  completeDailyReadinessSave: () => void;
  failDailyReadinessSave: (error: string) => void;
  publishDailyReadinessError: (error: string) => void;
  clearDailyReadinessError: () => void;
  markTrainingStarted: () => void;
  markTrainingStopped: () => void;
  setActiveWorkoutStartedAt: (startedAt: string) => void;
  clearActiveWorkoutStartedAt: () => void;
  setActiveWorkoutAttemptId: (attemptId: string) => void;
  clearActiveWorkoutAttemptId: () => void;
  setPendingReadinessLink: (pendingLink: ControllerPendingLink) => void;
  clearPendingReadinessLink: () => void;
  setRecoverableWorkoutStart: (available: boolean) => void;
  setTrainingCompletionSummary: (summary: ControllerCompletionSummary) => void;
  clearTrainingCompletionSummary: () => void;
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
    setActiveExerciseIndex: (index) => {
      dispatch({ type: "active_exercise_index_changed", index });
    },
    replaceExerciseDraftsFromRecovery: (drafts) => {
      dispatch({ type: "exercise_drafts_recovered", drafts });
    },
    updateExerciseDraft: (exerciseId, draft) => {
      dispatch({ type: "exercise_draft_updated", exerciseId, draft });
    },
    removeCompletedExerciseDrafts: (exerciseIds) => {
      dispatch({ type: "completed_exercise_drafts_removed", exerciseIds });
    },
    setReadiness: (readiness) => {
      dispatch({ type: "readiness_changed", readiness });
    },
    clearReadiness: () => {
      dispatch({ type: "readiness_cleared" });
    },
    beginDailyReadinessCheck: () => {
      dispatch({ type: "readiness_check_started" });
    },
    completeDailyReadinessCheck: () => {
      dispatch({ type: "readiness_check_succeeded" });
    },
    failDailyReadinessCheck: (error) => {
      dispatch({ type: "readiness_check_failed", error });
    },
    beginDailyReadinessSave: () => {
      dispatch({ type: "readiness_save_started" });
    },
    completeDailyReadinessSave: () => {
      dispatch({ type: "readiness_save_succeeded" });
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
    markTrainingStarted: () => {
      dispatch({ type: "training_started" });
    },
    markTrainingStopped: () => {
      dispatch({ type: "training_stopped" });
    },
    setActiveWorkoutStartedAt: (startedAt) => {
      dispatch({ type: "workout_started_at_set", startedAt });
    },
    clearActiveWorkoutStartedAt: () => {
      dispatch({ type: "workout_started_at_cleared" });
    },
    setActiveWorkoutAttemptId: (attemptId) => {
      dispatch({ type: "workout_attempt_id_set", attemptId });
    },
    clearActiveWorkoutAttemptId: () => {
      dispatch({ type: "workout_attempt_id_cleared" });
    },
    setPendingReadinessLink: (pendingLink) => {
      dispatch({ type: "pending_readiness_link_set", pendingLink });
    },
    clearPendingReadinessLink: () => {
      dispatch({ type: "pending_readiness_link_cleared" });
    },
    setRecoverableWorkoutStart: (available) => {
      dispatch({ type: "workout_recovery_availability_changed", available });
    },
    setTrainingCompletionSummary: (summary) => {
      dispatch({ type: "completion_summary_set", summary });
    },
    clearTrainingCompletionSummary: () => {
      dispatch({ type: "completion_summary_cleared" });
    },
    resetActiveWorkout: () => {
      dispatch({ type: "active_workout_reset" });
    },
  }), [dispatch]);

  return useMemo(() => ({ state, actions }), [actions, state]);
}
