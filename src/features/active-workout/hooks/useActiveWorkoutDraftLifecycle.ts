"use client";

import { useEffect } from "react";

import type { ActiveWorkoutBoundary } from "@/features/active-workout/model/active-workout-boundary-contract";
import type { Screen } from "@/lib/navigation/app-navigation";
import type { DataMode } from "@/lib/supabase/session";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";
import { getBrowserStorageScope } from "@/lib/storage/browser-storage";
import {
  clearActiveWorkoutDraft,
  saveActiveWorkoutDraft,
} from "@/lib/training/active-workout-draft";
import { createStableWorkoutStartedAt } from "@/lib/training/exercise-last-performance-loader";
import { shouldRetainActiveWorkoutAttemptState } from "@/lib/training/active-workout-reentry";

export interface ActiveWorkoutDraftLifecycleInput {
  boundary: ActiveWorkoutBoundary;
  screen: Screen;
  dataMode: DataMode;
  userId?: string;
  activeStorageScope: BrowserStorageScope | null;
  activeRoutineDay: string;
}

export function useActiveWorkoutDraftLifecycle(input: ActiveWorkoutDraftLifecycleInput) {
  const { boundary } = input;
  const { state, controllerActions } = boundary;
  const {
    abortStart,
    getIncomingRecoveryScope,
    getRuntimeSnapshot,
  } = boundary;
  const {
    activeExerciseIndex,
    activeWorkoutAttemptId,
    activeWorkoutStartedAt,
    exerciseDrafts,
    hasRecoverableWorkoutStart,
    hasStartedTraining,
    pendingReadinessLink,
    readiness,
  } = state;

  useEffect(() => {
    const isWorkoutDraftActive = input.screen === "entrenamiento" && hasStartedTraining;
    if (!isWorkoutDraftActive || !activeWorkoutStartedAt) return;
    const stableWorkoutStartedAt = activeWorkoutStartedAt;
    const workoutScope = getBrowserStorageScope(input.dataMode, input.userId);

    function persistWorkoutDraft() {
      if (!workoutScope || input.activeStorageScope !== workoutScope) return;
      const runtime = getRuntimeSnapshot();
      saveActiveWorkoutDraft({
        updatedAt: Date.now(),
        dataMode: input.dataMode,
        userId: input.userId,
        activeRoutineDay: input.activeRoutineDay,
        activeExerciseIndex,
        activeWorkoutStartedAt: stableWorkoutStartedAt,
        hasStartedTraining,
        readiness,
        exerciseDrafts,
        workoutAttemptId: runtime.attemptId ?? activeWorkoutAttemptId,
        pendingReadinessLink: runtime.pendingReadinessLink,
        cycleId: runtime.readinessContext?.cycleId ?? null,
        cycleDayId: runtime.readinessContext?.cycleDayId ?? null,
        plannedDay: runtime.readinessContext?.plannedDay ?? null,
        plannedDate: runtime.readinessContext?.plannedDate ?? null,
      });
    }

    persistWorkoutDraft();
    window.addEventListener("pagehide", persistWorkoutDraft);
    document.addEventListener("visibilitychange", persistWorkoutDraft);
    return () => {
      window.removeEventListener("pagehide", persistWorkoutDraft);
      document.removeEventListener("visibilitychange", persistWorkoutDraft);
    };
  }, [
    activeExerciseIndex,
    activeWorkoutAttemptId,
    activeWorkoutStartedAt,
    exerciseDrafts,
    getRuntimeSnapshot,
    hasStartedTraining,
    input.activeRoutineDay,
    input.activeStorageScope,
    input.dataMode,
    input.screen,
    input.userId,
    pendingReadinessLink,
    readiness,
  ]);

  useEffect(() => {
    if (input.screen !== "entrenamiento" || hasStartedTraining || hasRecoverableWorkoutStart) return;
    const scope = getBrowserStorageScope(input.dataMode, input.userId);
    if (scope && getIncomingRecoveryScope() === scope) return;
    clearActiveWorkoutDraft(input.dataMode, input.userId);
  }, [
    getIncomingRecoveryScope,
    hasRecoverableWorkoutStart,
    hasStartedTraining,
    input.dataMode,
    input.screen,
    input.userId,
  ]);

  useEffect(() => {
    const isActiveWorkout = input.screen === "entrenamiento" && hasStartedTraining;
    const isPausedWorkoutOnDashboard = shouldRetainActiveWorkoutAttemptState({
      screen: input.screen,
      hasStartedTraining,
    });
    if (isActiveWorkout && !activeWorkoutStartedAt) {
      controllerActions.recordWorkoutStartedAt(createStableWorkoutStartedAt());
      return;
    }
    if (
      !isActiveWorkout &&
      !isPausedWorkoutOnDashboard &&
      !hasRecoverableWorkoutStart &&
      (activeWorkoutStartedAt || activeWorkoutAttemptId || pendingReadinessLink)
    ) abortStart();
  }, [
    activeWorkoutAttemptId,
    activeWorkoutStartedAt,
    abortStart,
    controllerActions,
    hasRecoverableWorkoutStart,
    hasStartedTraining,
    input.screen,
    pendingReadinessLink,
  ]);
}
