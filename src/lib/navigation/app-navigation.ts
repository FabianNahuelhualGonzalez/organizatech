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
