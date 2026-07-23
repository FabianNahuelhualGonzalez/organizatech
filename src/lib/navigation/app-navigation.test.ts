import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getActiveFlow,
  isActiveFlow,
  isAppScreen,
  resetContextualNavigation,
  resolveActiveFlowRestoration,
  resolveContextualBackNavigation,
  resolveContextualNavigation,
  screenLabel,
  type ActiveFlow,
  type ContextualNavigationState,
  type Screen,
} from "@/lib/navigation/app-navigation";

const screens: Screen[] = [
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

const activeFlows: ActiveFlow[] = [
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

assert.equal(getActiveFlow("registro-entrenamiento", false, false, false, null), "routine_setup");
assert.equal(getActiveFlow("registro-entrenamiento", true, true, false, null), "routine_edit");
assert.equal(getActiveFlow("registro-entrenamiento", true, false, false, null), "dashboard");
assert.equal(getActiveFlow("entrenamiento", true, false, false, null), "training_start");
assert.equal(getActiveFlow("entrenamiento", true, false, true, null), "motivation_form");
assert.equal(getActiveFlow("entrenamiento", true, false, true, { skipped: false }), "active_workout");
assert.equal(getActiveFlow("comparacion", true, false, false, null), "comparison");
assert.equal(getActiveFlow("historial-ciclos", true, false, false, null), "cycle_history");
assert.equal(getActiveFlow("perfil", true, false, false, null), "profile");
assert.equal(getActiveFlow("training-summary", true, false, false, null), "dashboard");

for (const screen of screens) assert.equal(isAppScreen(screen), true);
for (const value of [null, undefined, "", "configuracion", "Dashboard", 1]) {
  assert.equal(isAppScreen(value), false);
}

for (const flow of activeFlows) assert.equal(isActiveFlow(flow), true);
for (const value of [null, undefined, "", "training", "routine", 1]) {
  assert.equal(isActiveFlow(value), false);
}

assert.deepEqual(
  screens.map((screen) => screenLabel(screen)),
  [
    "Iniciar sesión",
    "Registro",
    "Recuperar contraseña",
    "Nueva contraseña",
    "Enlace expirado",
    "Panel principal",
    "Entrenemos",
    "Resumen de entrenamiento",
    "Modificar ciclo de entrenamiento",
    "Comparación semanal",
    "Historial ciclo de entrenamiento",
    "Mi perfil",
  ],
);

function navigation(screen: Screen, history: Screen[] = []): ContextualNavigationState {
  return { screen, history };
}

function navigate(
  current: ContextualNavigationState,
  nextScreen: Screen,
  hasRoutinePlan = true,
) {
  return resolveContextualNavigation({ current, nextScreen, hasRoutinePlan });
}

function back(
  current: ContextualNavigationState,
  options: Partial<{
    hasStartedTraining: boolean;
    hasReadiness: boolean;
    isEditingRoutinePlan: boolean;
    hasRoutinePlan: boolean;
    routineEditorReturnScreen: Screen | null;
  }> = {},
) {
  return resolveContextualBackNavigation({
    current,
    hasStartedTraining: options.hasStartedTraining ?? false,
    hasReadiness: options.hasReadiness ?? false,
    isEditingRoutinePlan: options.isEditingRoutinePlan ?? false,
    hasRoutinePlan: options.hasRoutinePlan ?? true,
    routineEditorReturnScreen: options.routineEditorReturnScreen ?? null,
  });
}

// Caso 1: cada sección principal resuelve una única pantalla y conserva el orden del historial.
for (const target of [
  "entrenamiento",
  "comparacion",
  "historial-ciclos",
  "perfil",
  "registro-entrenamiento",
] satisfies Screen[]) {
  const decision = navigate(navigation("dashboard"), target);
  assert.equal(decision.kind, "navigate");
  assert.equal(decision.navigation.screen, target);
  assert.deepEqual(decision.navigation.history, ["dashboard"]);
}
assert.equal(
  navigate(navigation("dashboard"), "registro-entrenamiento", false).routineEditorEditingState,
  true,
);
assert.equal(
  navigate(navigation("dashboard"), "registro-entrenamiento", true).routineEditorEditingState,
  false,
);

// Navegar a la pantalla actual es estable y no duplica historial.
const sameScreen = navigate(navigation("perfil", ["dashboard"]), "perfil");
assert.equal(sameScreen.kind, "same-screen");
assert.deepEqual(sameScreen.navigation, navigation("perfil", ["dashboard"]));

// Caso 2: volver utiliza el contexto anterior y consume solo la última entrada.
const profileFromComparison = navigate(navigation("comparacion", ["dashboard"]), "perfil").navigation;
const backToComparison = back(profileFromComparison);
assert.equal(backToComparison.reason, "history");
assert.deepEqual(backToComparison.navigation, navigation("comparacion", ["dashboard"]));

// Caso 3: entrenamiento conserva selecciones ajenas al dominio de navegación.
const trainingSelection = { day: "Miercoles", exerciseIndex: 2 };
const trainingSelectionBefore = { ...trainingSelection };
const openTraining = navigate(navigation("dashboard"), "entrenamiento");
assert.equal(openTraining.tryRestoreActiveWorkout, true);
assert.equal(openTraining.resetTrainingStart, true);
const pauseTraining = back(openTraining.navigation, { hasStartedTraining: true, hasReadiness: true });
assert.equal(pauseTraining.reason, "pause-active-workout");
assert.deepEqual(pauseTraining.navigation, resetContextualNavigation("dashboard"));
assert.equal(pauseTraining.stopTraining, false);
assert.equal(pauseTraining.clearReadiness, false);
assert.deepEqual(trainingSelection, trainingSelectionBefore);

const cancelReadiness = back(navigation("entrenamiento", ["dashboard"]), {
  hasStartedTraining: true,
  hasReadiness: false,
});
assert.equal(cancelReadiness.reason, "cancel-training-start");
assert.equal(cancelReadiness.navigationChanged, false);
assert.equal(cancelReadiness.stopTraining, true);

// Caso 4: historial conserva la selección interna del ciclo al cerrar o volver.
const cycleSelection = { cycleId: "cycle-4", page: 2 };
const cycleSelectionBefore = { ...cycleSelection };
const cycleHistoryNavigation = navigate(navigation("dashboard"), "historial-ciclos").navigation;
assert.deepEqual(back(cycleHistoryNavigation).navigation, resetContextualNavigation("dashboard"));
assert.deepEqual(cycleSelection, cycleSelectionBefore);

// Caso 5: perfil no altera contexto de entrenamiento ni otras selecciones.
const unrelatedProfileContext = { activeDay: "Viernes", comparisonDay: "Martes" };
const unrelatedProfileContextBefore = { ...unrelatedProfileContext };
const profileNavigation = navigate(navigation("entrenamiento", ["dashboard"]), "perfil").navigation;
assert.deepEqual(back(profileNavigation).navigation, navigation("entrenamiento", ["dashboard"]));
assert.deepEqual(unrelatedProfileContext, unrelatedProfileContextBefore);

// Caso 6: Coach vive en dashboard; abrirlo y volver mantiene el contexto anterior.
const coachContext = { section: "coach", activeDay: "Miercoles" };
const coachContextBefore = { ...coachContext };
const coachNavigation = navigate(navigation("comparacion", ["dashboard"]), "dashboard");
assert.equal(coachNavigation.clearTrainingCompletionSummary, true);
assert.deepEqual(back(coachNavigation.navigation).navigation, navigation("comparacion", ["dashboard"]));
assert.deepEqual(coachContext, coachContextBefore);

// Caso 7: progreso/comparación no limpia selecciones que pertenecen a otros dominios.
const progressContext = { activeRoutineDay: "Jueves", selectedCycleId: "cycle-2" };
const progressContextBefore = { ...progressContext };
const progressNavigation = navigate(navigation("dashboard"), "comparacion").navigation;
assert.deepEqual(back(progressNavigation).navigation, resetContextualNavigation("dashboard"));
assert.deepEqual(progressContext, progressContextBefore);

// Caso 8: la restauración reconoce flujos válidos y rechaza valores incompatibles.
assert.deepEqual(resolveActiveFlowRestoration("dashboard"), {
  kind: "screen",
  screen: "dashboard",
  resetTrainingStart: false,
});
assert.deepEqual(resolveActiveFlowRestoration("comparison"), {
  kind: "screen",
  screen: "comparacion",
  resetTrainingStart: false,
});
assert.deepEqual(resolveActiveFlowRestoration("cycle_history"), {
  kind: "screen",
  screen: "historial-ciclos",
  resetTrainingStart: false,
});
assert.deepEqual(resolveActiveFlowRestoration("profile"), {
  kind: "screen",
  screen: "perfil",
  resetTrainingStart: false,
});
assert.deepEqual(resolveActiveFlowRestoration("training_start"), {
  kind: "screen",
  screen: "entrenamiento",
  resetTrainingStart: true,
});
assert.deepEqual(resolveActiveFlowRestoration("routine_edit"), { kind: "routine-draft" });
assert.deepEqual(resolveActiveFlowRestoration("active_workout"), { kind: "workout-draft" });
assert.deepEqual(resolveActiveFlowRestoration("unknown-flow"), { kind: "unsupported" });

// Caso 9: logout conserva la transición preexistente como un único reset coherente.
const previousIdentityNavigation = navigation("perfil", ["dashboard", "comparacion"]);
const loggedOutNavigation = resetContextualNavigation("login");
assert.deepEqual(loggedOutNavigation, navigation("login"));
assert.deepEqual(Object.keys(loggedOutNavigation).sort(), ["history", "screen"]);

// Caso 10: applySessionState no decide navegación; la identidad conserva el par
// screen/history hasta que el call-site ejecute la restauración que ya existía.
assert.deepEqual(previousIdentityNavigation, navigation("perfil", ["dashboard", "comparacion"]));

// Caso editor: volver respeta el origen sin fabricar una nueva entrada de historial.
const returnToTraining = back(
  navigation("registro-entrenamiento", ["dashboard"]),
  {
    isEditingRoutinePlan: true,
    hasRoutinePlan: true,
    routineEditorReturnScreen: "entrenamiento",
  },
);
assert.equal(returnToTraining.reason, "return-from-routine-editor");
assert.deepEqual(returnToTraining.navigation, navigation("entrenamiento", ["dashboard"]));
assert.equal(returnToTraining.stopTraining, true);
assert.equal(returnToTraining.clearReadiness, true);
assert.equal(returnToTraining.closeRoutineEditor, true);
assert.equal(returnToTraining.clearRoutineEditorReturnScreen, true);

// El editor también se cierra al navegar a otra sección, como ocurría antes de la extracción.
assert.equal(
  navigate(navigation("registro-entrenamiento", ["dashboard"]), "perfil").routineEditorEditingState,
  false,
);

// Caso 11: transiciones repetidas no acumulan contexto stale.
let repeated = navigation("dashboard");
for (let index = 0; index < 3; index += 1) {
  repeated = navigate(repeated, "perfil").navigation;
  repeated = back(repeated).navigation;
}
assert.deepEqual(repeated, navigation("dashboard"));

// Caso 12: ninguna transición muta el estado recibido.
const immutableHistory = Object.freeze<Screen[]>(["dashboard"]);
const immutableInput = Object.freeze({
  screen: "comparacion" as const,
  history: immutableHistory,
});
assert.doesNotThrow(() => navigate(immutableInput, "perfil"));
assert.doesNotThrow(() => back(immutableInput));
assert.deepEqual(immutableInput, navigation("comparacion", ["dashboard"]));

// Contrato de integración: identidad no hace resets parciales y logout aplica
// exactamente una transición contextual sin competir con setters directos.
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const applySessionStateStart = appSource.indexOf("function applySessionState(");
const clearUserSessionStateStart = appSource.indexOf("function clearUserSessionState(");
const clearBrowserStorageScopeStart = appSource.indexOf("function clearBrowserStorageScope(");
assert.ok(applySessionStateStart >= 0 && clearUserSessionStateStart > applySessionStateStart);
assert.ok(clearBrowserStorageScopeStart > clearUserSessionStateStart);

const applySessionStateBlock = appSource.slice(applySessionStateStart, clearUserSessionStateStart);
assert.doesNotMatch(
  applySessionStateBlock,
  /setScreen(?:History)?\(|applyContextualNavigation\(/,
  "cambiar identidad no altera parcialmente screen o screenHistory",
);
assert.doesNotMatch(
  applySessionStateBlock,
  /setIsEditingRoutinePlan\(|setRoutineEditorReturnScreen\(/,
  "cambiar identidad no introduce un cierre nuevo del editor",
);

const clearUserSessionStateBlock = appSource.slice(clearUserSessionStateStart, clearBrowserStorageScopeStart);
assert.equal(
  (clearUserSessionStateBlock.match(
    /applyContextualNavigation\(resetContextualNavigation\("login"\)\)/g,
  ) ?? []).length,
  1,
  "logout usa una única transición coherente hacia login",
);
assert.doesNotMatch(
  clearUserSessionStateBlock,
  /setScreen(?:History)?\(/,
  "logout no compite con setters directos de navegación",
);
assert.doesNotMatch(
  clearUserSessionStateBlock,
  /setIsEditingRoutinePlan\(|setRoutineEditorReturnScreen\(/,
  "logout no agrega resets del editor ausentes en addb594",
);
