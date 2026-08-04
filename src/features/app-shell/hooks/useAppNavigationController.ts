"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AppNavigationBackPorts,
  AppNavigationController,
  AppNavigationNavigatePorts,
  AppNavigationPersistenceContext,
  AppNavigationReentryPorts,
  AppNavigationRestorePorts,
} from "@/features/app-shell/model/app-navigation-controller-state";
import {
  applyActiveWorkoutReentry,
  applyContextualBackDecision,
  resolveNavigationTransition,
} from "@/features/app-shell/model/app-navigation-controller-state";
import {
  getActiveFlow,
  resetContextualNavigation,
  resolveActiveFlowRestoration,
  resolveContextualBackNavigation,
  resolveContextualNavigation,
  type ContextualNavigationState,
  type Screen,
} from "@/lib/navigation/app-navigation";
import type { ScreenTransition } from "@/lib/navigation/app-navigation-transition";
import { getBrowserStorageScope } from "@/lib/storage/browser-storage";
import {
  ACTIVE_FLOW_VERSION,
  loadActiveFlow,
  saveActiveFlow,
} from "@/lib/storage/app-flow-storage";

export function useAppNavigationController(
  initialScreen: Screen,
  persistence: AppNavigationPersistenceContext,
): AppNavigationController {
  const [state, setState] = useState<ContextualNavigationState>(() => (
    resetContextualNavigation(initialScreen)
  ));
  const stateRef = useRef(state);
  stateRef.current = state;

  const applyNavigation = useCallback((navigation: ContextualNavigationState) => {
    const next = { screen: navigation.screen, history: [...navigation.history] };
    stateRef.current = next;
    setState(next);
  }, []);

  const reset = useCallback((screen: Screen) => {
    applyNavigation(resetContextualNavigation(screen));
  }, [applyNavigation]);

  const transition = useCallback((nextTransition: ScreenTransition) => {
    applyNavigation(resolveNavigationTransition(stateRef.current, nextTransition));
  }, [applyNavigation]);

  const reenterActiveWorkout = useCallback((ports: AppNavigationReentryPorts) => (
    applyActiveWorkoutReentry(ports.tryRestoreActiveWorkout(), {
      resetToWorkout: () => reset("entrenamiento"),
      closeMenu: ports.closeMenu,
    })
  ), [reset]);

  const navigate = useCallback((
    nextScreen: Screen,
    ports: AppNavigationNavigatePorts,
  ) => {
    const decision = resolveContextualNavigation({
      current: stateRef.current,
      nextScreen,
      hasRoutinePlan: ports.hasRoutinePlan,
    });

    if (decision.kind === "same-screen") {
      if (decision.closeMenu) ports.closeMenu();
      return decision;
    }
    if (decision.prepareRoutineEditor && !ports.prepareRoutineEditor()) return decision;
    if (decision.clearTrainingCompletionSummary) ports.clearTrainingCompletionSummary();
    if (!decision.prepareRoutineEditor && decision.tryRestoreActiveWorkout) {
      if (reenterActiveWorkout(ports)) return decision;
      if (decision.resetTrainingStart) ports.clearTrainingStart();
    }
    if (decision.routineEditorEditingState !== null) {
      ports.setRoutineEditorEditing(decision.routineEditorEditingState);
    }
    applyNavigation(decision.navigation);
    if (decision.closeMenu) ports.closeMenu();
    return decision;
  }, [applyNavigation, reenterActiveWorkout]);

  const back = useCallback((ports: AppNavigationBackPorts) => {
    const decision = resolveContextualBackNavigation({
      current: stateRef.current,
      hasStartedTraining: ports.hasStartedTraining,
      hasReadiness: ports.hasReadiness,
      isEditingRoutinePlan: ports.isEditingRoutinePlan,
      hasRoutinePlan: ports.hasRoutinePlan,
      routineEditorReturnScreen: ports.routineEditorReturnScreen,
    });

    applyContextualBackDecision(decision, ports, applyNavigation);
    return decision;
  }, [applyNavigation]);

  const restoreActiveFlow = useCallback((
    mode: AppNavigationPersistenceContext["dataMode"],
    userId: string | undefined,
    ports: AppNavigationRestorePorts,
  ) => {
    const recoveryScope = getBrowserStorageScope(mode, userId);
    const activeFlow = loadActiveFlow(mode, userId);
    ports.beforeRestoreAttempt(recoveryScope);
    if (!activeFlow) return false;
    const restoration = resolveActiveFlowRestoration(activeFlow.flow);

    if (restoration.kind === "routine-draft") {
      const restored = ports.restoreRoutineDraft(mode, userId);
      if (restored) {
        reset("registro-entrenamiento");
        ports.closeMenu();
      }
      return restored;
    }
    if (restoration.kind === "workout-draft") {
      const restored = ports.restoreWorkoutDraft(mode, userId);
      if (restored) {
        reset("entrenamiento");
        ports.closeMenu();
      }
      return restored;
    }
    if (restoration.kind !== "screen") return false;
    if (restoration.resetTrainingStart) ports.clearTrainingStart();
    reset(restoration.screen);
    ports.closeMenu();
    return true;
  }, [reset]);

  useEffect(() => {
    const activeFlow = resolvePersistedActiveFlow({
      screen: state.screen,
      hasRoutinePlan: persistence.hasRoutinePlan,
      isEditingRoutinePlan: persistence.isEditingRoutinePlan,
      hasStartedTraining: persistence.hasStartedTraining,
      readiness: persistence.readiness,
    });
    if (!activeFlow) return;
    const userKey = getBrowserStorageScope(persistence.dataMode, persistence.userId);
    if (!userKey || persistence.activeStorageScope !== userKey) return;
    const dataMode = persistence.dataMode;
    const flowToPersist = activeFlow;
    const userKeyToPersist = userKey;

    function persistFlow() {
      saveActiveFlow({
        version: ACTIVE_FLOW_VERSION,
        updatedAt: Date.now(),
        dataMode,
        userKey: userKeyToPersist,
        flow: flowToPersist,
      });
    }

    persistFlow();
    window.addEventListener("pagehide", persistFlow);
    document.addEventListener("visibilitychange", persistFlow);
    return () => {
      window.removeEventListener("pagehide", persistFlow);
      document.removeEventListener("visibilitychange", persistFlow);
    };
  }, [
    persistence.activeStorageScope,
    persistence.dataMode,
    persistence.hasRoutinePlan,
    persistence.hasStartedTraining,
    persistence.isEditingRoutinePlan,
    persistence.readiness,
    persistence.userId,
    state.screen,
  ]);

  return {
    state,
    screen: state.screen,
    history: state.history,
    applyNavigation,
    transition,
    reset,
    navigate,
    back,
    reenterActiveWorkout,
    restoreActiveFlow,
  };
}

export function resolvePersistedActiveFlow(input: {
  screen: Screen;
  hasRoutinePlan: boolean;
  isEditingRoutinePlan: boolean;
  hasStartedTraining: boolean;
  readiness: { skipped: boolean } | null;
}) {
  if (
    input.screen === "login" ||
    input.screen === "registro" ||
    input.screen === "recuperar-password" ||
    input.screen === "nueva-password" ||
    input.screen === "recovery-expired"
  ) return null;
  return getActiveFlow(
    input.screen,
    input.hasRoutinePlan,
    input.isEditingRoutinePlan,
    input.hasStartedTraining,
    input.readiness,
  );
}
