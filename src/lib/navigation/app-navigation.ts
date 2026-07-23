export type Screen =
  | "login"
  | "registro"
  | "recuperar-password"
  | "nueva-password"
  | "recovery-expired"
  | "dashboard"
  | "entrenamiento"
  | "training-summary"
  | "registro-entrenamiento"
  | "comparacion"
  | "historial-ciclos"
  | "perfil";

export type ActiveFlow =
  | "dashboard"
  | "routine_setup"
  | "routine_edit"
  | "training_start"
  | "motivation_form"
  | "active_workout"
  | "comparison"
  | "cycle_history"
  | "profile";

export interface ContextualNavigationState {
  readonly screen: Screen;
  readonly history: readonly Screen[];
}

export interface ContextualNavigationDecision {
  kind: "same-screen" | "navigate";
  navigation: ContextualNavigationState;
  clearTrainingCompletionSummary: boolean;
  prepareRoutineEditor: boolean;
  routineEditorEditingState: boolean | null;
  tryRestoreActiveWorkout: boolean;
  resetTrainingStart: boolean;
  closeMenu: boolean;
}

export type ContextualBackReason =
  | "pause-active-workout"
  | "cancel-training-start"
  | "return-from-routine-editor"
  | "history"
  | "fallback";

export interface ContextualBackDecision {
  reason: ContextualBackReason;
  navigation: ContextualNavigationState;
  navigationChanged: boolean;
  stopTraining: boolean;
  clearReadiness: boolean;
  closeRoutineEditor: boolean;
  clearRoutineEditorReturnScreen: boolean;
  closeMenu: boolean;
}

export type ActiveFlowRestoration =
  | { kind: "routine-draft" }
  | { kind: "workout-draft" }
  | { kind: "screen"; screen: Screen; resetTrainingStart: boolean }
  | { kind: "unsupported" };

const appScreens: readonly Screen[] = [
  "login",
  "registro",
  "recuperar-password",
  "nueva-password",
  "recovery-expired",
  "dashboard",
  "entrenamiento",
  "training-summary",
  "registro-entrenamiento",
  "comparacion",
  "historial-ciclos",
  "perfil",
];

const activeFlows: readonly ActiveFlow[] = [
  "dashboard",
  "routine_setup",
  "routine_edit",
  "training_start",
  "motivation_form",
  "active_workout",
  "comparison",
  "cycle_history",
  "profile",
];

const screenLabels: Record<Screen, string> = {
  login: "Iniciar sesión",
  registro: "Registro",
  "recuperar-password": "Recuperar contraseña",
  "nueva-password": "Nueva contraseña",
  "recovery-expired": "Enlace expirado",
  dashboard: "Panel principal",
  entrenamiento: "Entrenemos",
  "training-summary": "Resumen de entrenamiento",
  "registro-entrenamiento": "Modificar ciclo de entrenamiento",
  "historial-ciclos": "Historial ciclo de entrenamiento",
  comparacion: "Comparación semanal",
  perfil: "Mi perfil",
};

export function getActiveFlow(
  screen: Screen,
  hasRoutinePlan: boolean,
  isEditingRoutinePlan: boolean,
  hasStartedTraining: boolean,
  readiness: { skipped: boolean } | null,
): ActiveFlow {
  if (screen === "registro-entrenamiento" && (!hasRoutinePlan || isEditingRoutinePlan)) {
    return isEditingRoutinePlan && hasRoutinePlan ? "routine_edit" : "routine_setup";
  }
  if (screen === "entrenamiento") {
    if (hasStartedTraining && readiness) return "active_workout";
    if (hasStartedTraining) return "motivation_form";
    return "training_start";
  }
  if (screen === "comparacion") return "comparison";
  if (screen === "historial-ciclos") return "cycle_history";
  if (screen === "perfil") return "profile";
  return "dashboard";
}

export function isActiveFlow(value: unknown): value is ActiveFlow {
  return typeof value === "string" && activeFlows.includes(value as ActiveFlow);
}

export function isAppScreen(value: unknown): value is Screen {
  return typeof value === "string" && appScreens.includes(value as Screen);
}

export function screenLabel(screen: Screen) {
  return screenLabels[screen];
}

export function resetContextualNavigation(screen: Screen): ContextualNavigationState {
  return { screen, history: [] };
}

export function resolveContextualNavigation(input: {
  current: ContextualNavigationState;
  nextScreen: Screen;
  hasRoutinePlan: boolean;
}): ContextualNavigationDecision {
  const { current, nextScreen, hasRoutinePlan } = input;
  if (nextScreen === current.screen) {
    return {
      kind: "same-screen",
      navigation: copyNavigationState(current),
      clearTrainingCompletionSummary: false,
      prepareRoutineEditor: false,
      routineEditorEditingState: null,
      tryRestoreActiveWorkout: false,
      resetTrainingStart: false,
      closeMenu: true,
    };
  }

  const history = current.screen === "login" || current.screen === "registro"
    ? [...current.history]
    : [...current.history, current.screen];

  return {
    kind: "navigate",
    navigation: { screen: nextScreen, history },
    clearTrainingCompletionSummary: nextScreen === "dashboard",
    prepareRoutineEditor: nextScreen === "registro-entrenamiento",
    routineEditorEditingState: nextScreen === "registro-entrenamiento"
      ? !hasRoutinePlan
      : nextScreen === "entrenamiento"
      ? null
      : false,
    tryRestoreActiveWorkout: nextScreen === "entrenamiento",
    resetTrainingStart: nextScreen === "entrenamiento",
    closeMenu: true,
  };
}

export function resolveContextualBackNavigation(input: {
  current: ContextualNavigationState;
  hasStartedTraining: boolean;
  hasReadiness: boolean;
  isEditingRoutinePlan: boolean;
  hasRoutinePlan: boolean;
  routineEditorReturnScreen: Screen | null;
}): ContextualBackDecision {
  const {
    current,
    hasStartedTraining,
    hasReadiness,
    isEditingRoutinePlan,
    hasRoutinePlan,
    routineEditorReturnScreen,
  } = input;

  if (current.screen === "entrenamiento" && hasReadiness) {
    return createBackDecision("pause-active-workout", resetContextualNavigation("dashboard"), {
      navigationChanged: true,
    });
  }

  if (current.screen === "entrenamiento" && hasStartedTraining) {
    return createBackDecision("cancel-training-start", current, {
      stopTraining: true,
    });
  }

  if (current.screen === "registro-entrenamiento" && isEditingRoutinePlan && hasRoutinePlan) {
    const target = routineEditorReturnScreen;
    const canReturn = Boolean(target && target !== "registro-entrenamiento");
    return createBackDecision(
      "return-from-routine-editor",
      canReturn ? { screen: target as Screen, history: [...current.history] } : current,
      {
        navigationChanged: canReturn,
        stopTraining: target === "entrenamiento",
        clearReadiness: target === "entrenamiento",
        closeRoutineEditor: true,
        clearRoutineEditorReturnScreen: true,
      },
    );
  }

  const previous = current.history.at(-1);
  if (previous) {
    return createBackDecision(
      "history",
      { screen: previous, history: current.history.slice(0, -1) },
      {
        navigationChanged: true,
        closeRoutineEditor: previous !== "registro-entrenamiento",
      },
    );
  }

  return createBackDecision("fallback", resetContextualNavigation("dashboard"), {
    navigationChanged: current.screen !== "dashboard" || current.history.length > 0,
    closeMenu: true,
  });
}

export function resolveActiveFlowRestoration(flow: unknown): ActiveFlowRestoration {
  if (!isActiveFlow(flow)) return { kind: "unsupported" };

  if (flow === "routine_setup" || flow === "routine_edit") {
    return { kind: "routine-draft" };
  }

  if (flow === "motivation_form" || flow === "active_workout") {
    return { kind: "workout-draft" };
  }

  if (flow === "training_start") {
    return { kind: "screen", screen: "entrenamiento", resetTrainingStart: true };
  }

  const screenByFlow: Record<"dashboard" | "comparison" | "cycle_history" | "profile", Screen> = {
    dashboard: "dashboard",
    comparison: "comparacion",
    cycle_history: "historial-ciclos",
    profile: "perfil",
  };

  return { kind: "screen", screen: screenByFlow[flow], resetTrainingStart: false };
}

function createBackDecision(
  reason: ContextualBackReason,
  navigation: ContextualNavigationState,
  overrides: Partial<Omit<ContextualBackDecision, "reason" | "navigation">> = {},
): ContextualBackDecision {
  return {
    reason,
    navigation: copyNavigationState(navigation),
    navigationChanged: false,
    stopTraining: false,
    clearReadiness: false,
    closeRoutineEditor: false,
    clearRoutineEditorReturnScreen: false,
    closeMenu: false,
    ...overrides,
  };
}

function copyNavigationState(state: ContextualNavigationState): ContextualNavigationState {
  return { screen: state.screen, history: [...state.history] };
}
