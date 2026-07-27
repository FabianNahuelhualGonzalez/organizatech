import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración parcial (P3-07A). No renderiza React, no ejecuta el componente.
 * Sucesor del contrato de preparación (P3-06): aquel verificaba que los 3 módulos existieran sin
 * estar cableados en el root. Este verifica el estado de integración PARCIAL alcanzado en P3-07A:
 *
 * INTEGRADO en esta rama:
 *   - app-screen-resolver.ts: las 5 funciones (dashboard/comparación/routine-builder/active-workout/
 *     training-summary), reemplazando las 11 condiciones JSX equivalentes que existían en el root.
 *   - app-navigation-intent.ts: resolveMenuScreens, canGoBackFromScreen, resolveDayStateReset,
 *     resolveNotificationScrollTarget.
 *   - app-auth-screen-resolver.ts: solo resolveInitialAuthState (para screen/statusMessage/
 *     isAuthLoading iniciales). getInitialAuthScreen() fue eliminado del root por redundante.
 *
 * TODAVÍA PENDIENTE (reservado explícitamente para P3-07B, NO se afirma completo aquí):
 *   - resolveWorkoutCompletionScreen: NO integrado. finishCompletedWorkout() conserva su propio
 *     setScreen("dashboard") en un call site que no pasa por "training-summary" — mezclar ambos
 *     casos requiere resolver esa tercera rama primero (fuera de alcance de P3-07A).
 *   - Los 31 call sites directos de setScreen(...) en el root permanecen sin centralizar.
 *
 * Este contrato NO afirma que P3-06 esté "completamente terminado": dos piezas (un resolver
 * completo y toda la migración de setScreen) siguen pendientes, documentadas como tales.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const appSource = readSource("src/components/organizatech-app.tsx");

const modules = {
  screenResolver: readSource("src/lib/navigation/app-screen-resolver.ts"),
  navigationIntent: readSource("src/lib/navigation/app-navigation-intent.ts"),
  authScreenResolver: readSource("src/lib/navigation/app-auth-screen-resolver.ts"),
};

// 1. Fuente canónica: exports esperados presentes en cada módulo (sin cambios respecto a P3-06).
assert.match(modules.screenResolver, /export function resolveDashboardScreenVariant\(/);
assert.match(modules.screenResolver, /export function resolveComparisonScreenVariant\(/);
assert.match(modules.screenResolver, /export function resolveRoutineBuilderVariant\(/);
assert.match(modules.screenResolver, /export function resolveActiveWorkoutVariant\(/);
assert.match(modules.screenResolver, /export function isTrainingSummaryScreenValid\(/);

assert.match(modules.navigationIntent, /export function resolveMenuScreens\(/);
assert.match(modules.navigationIntent, /export function canGoBackFromScreen\(/);
assert.match(modules.navigationIntent, /export function resolveDayStateReset\(/);
assert.match(modules.navigationIntent, /export function resolveWorkoutCompletionScreen\(/);
assert.match(modules.navigationIntent, /export function resolveNotificationScrollTarget\(/);

assert.match(modules.authScreenResolver, /export function resolveInitialAuthScreen\(/);
assert.match(modules.authScreenResolver, /export function resolveInitialAuthStatusMessage\(/);
assert.match(modules.authScreenResolver, /export function resolveInitialAuthLoading\(/);
assert.match(modules.authScreenResolver, /export function resolveInitialAuthState\(/);

// 2-3. Ausencia de imports prohibidos y de React/DOM en los tres módulos puros (sin cambios).
function assertPureModule(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: import prohibido de organizatech-app.tsx (${path})`);
    assert.doesNotMatch(path, /^react$/, `${label}: no debe importar React (${path})`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: import prohibido de storage productivo (${path})`);
    assert.doesNotMatch(path, /supabase/i, `${label}: import prohibido de Supabase (${path})`);
    assert.doesNotMatch(path, /-repository$/, `${label}: import prohibido de repositories (${path})`);
  });
  assert.doesNotMatch(stripComments(source), /\bwindow\.\w|\bdocument\.\w/, `${label} no debe acceder a window ni document`);
}
Object.entries(modules).forEach(([label, source]) => assertPureModule(source, label));

// 4. El root SÍ importa los 3 módulos (a diferencia de la preparación P3-06).
assert.match(appSource, /from ["']@\/lib\/navigation\/app-screen-resolver["']/);
assert.match(appSource, /from ["']@\/lib\/navigation\/app-navigation-intent["']/);
assert.match(appSource, /from ["']@\/lib\/navigation\/app-auth-screen-resolver["']/);

// 5. app-screen-resolver: las 5 funciones se usan en el root; las condiciones JSX equivalentes
//    ya no existen literalmente (fueron reemplazadas por comparaciones de variante).
assert.match(appSource, /resolveDashboardScreenVariant\(isCycleScopedPlanBlocked\)/);
assert.match(appSource, /resolveComparisonScreenVariant\(isCycleScopedPlanBlocked\)/);
assert.match(appSource, /resolveRoutineBuilderVariant\(\{/);
assert.match(appSource, /resolveActiveWorkoutVariant\(\{/);
assert.match(appSource, /isTrainingSummaryScreenValid\(Boolean\(trainingCompletionSummary\)\)/);
assert.match(appSource, /hasRoutinePlan,\s*\n\s*isEditingRoutinePlan,/, "el resolver debe alimentarse de hasRoutinePlan, no de hasRoutinePlanForDraft");
assert.doesNotMatch(
  appSource,
  /screen === "registro-entrenamiento" && isCycleScopedPlanBlocked && !isEditingRoutinePlan/,
  "la condicion JSX original del routine-builder bloqueado debe haberse eliminado",
);
assert.doesNotMatch(
  appSource,
  /screen === "entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && !hasStartedTraining/,
  "la condicion JSX original de active-workout 'start' debe haberse eliminado",
);
assert.doesNotMatch(
  appSource,
  /screen === "entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && hasStartedTraining && !readiness/,
  "la condicion JSX original de active-workout 'readiness' debe haberse eliminado",
);

// 6. app-navigation-intent: 4 de 5 funciones integradas; resolveWorkoutCompletionScreen pendiente.
assert.match(appSource, /const menuScreens = resolveMenuScreens\(primaryScreens, hasTrainingEntries, visibleCycleHistoryCount\);/);
assert.doesNotMatch(appSource, /item === "historial-ciclos" && visibleCycleHistoryCount > 0/, "el filtro inline de menuScreens debe haberse eliminado del root");
assert.match(appSource, /canGoBackFromScreen\(screen\)/);
assert.doesNotMatch(appSource, /screen !== "dashboard" && screen !== "training-summary"/, "la condicion inline de la fila Volver debe haberse eliminado del root");
assert.equal((appSource.match(/resolveDayStateReset\(\)/g) ?? []).length, 4, "los 4 sitios de reseteo de dia deben usar resolveDayStateReset()");
assert.doesNotMatch(
  appSource,
  /setActiveRoutineDay\("Lunes"\);\s*\n\s*setDashboardDayOverride\(""\);\s*\n\s*setComparisonDay\("Lunes"\);/,
  "el paquete de reseteo de dia inline ya no debe existir literalmente en el root",
);
assert.match(appSource, /resolveNotificationScrollTarget\(section \?\? null\)/);
assert.doesNotMatch(appSource, /document\.querySelector<HTMLElement>\(`\[data-section="\$\{section\}"\]`\)/, "el selector inline debe haberse eliminado del root");
assert.doesNotMatch(appSource, /resolveWorkoutCompletionScreen/, "resolveWorkoutCompletionScreen sigue pendiente de integrar (reservado para P3-07B)");
assert.match(appSource, /function finishCompletedWorkout\(\) \{[\s\S]*?setScreen\("dashboard"\);\s*\n\s*\}/, "finishCompletedWorkout conserva su propio setScreen sin pasar por el resolver (P3-07B)");
assert.match(appSource, /setScreen\("training-summary"\);/, "los setScreen(\"training-summary\") directos siguen sin centralizar (P3-07B)");

// 7. app-auth-screen-resolver: solo resolveInitialAuthState se integra; getPasswordRecoveryRouteState
//    sigue siendo la unica fuente de datos, sin moverse ni modificarse.
assert.equal(
  (appSource.match(/resolveInitialAuthState\(getPasswordRecoveryRouteState\(\)\)/g) ?? []).length,
  3,
  "screen/statusMessage/isAuthLoading deben derivar los tres de resolveInitialAuthState, cada uno con su propia lectura de ruta (preserva el conteo de llamadas de hoy)",
);
assert.doesNotMatch(appSource, /function getInitialAuthScreen\(\): Screen \{/, "getInitialAuthScreen quedo redundante tras integrar resolveInitialAuthState y fue eliminado");
assert.match(appSource, /function getPasswordRecoveryRouteState\(\): "none" \| "active" \| "expired" \{/, "getPasswordRecoveryRouteState (impura) permanece intacta en el root");
assert.doesNotMatch(appSource, /if \(recoveryState === "expired"\) return "recovery-expired";/, "la derivacion inline duplicada debe haberse eliminado del root");
assert.doesNotMatch(appSource, /return "Validando sesión\.\.\.";/, "la derivacion inline duplicada de statusMessage debe haberse eliminado del root");

// 8. Ninguno de los 3 módulos afirma ya "No integrado todavía" como si nada hubiese cambiado —
//    ese texto describía la preparación P3-06 y ya no aplica a las piezas integradas en P3-07A.
//    (Los módulos en sí no se modifican en esta rama; esta aserción documenta el contrato, no el
//    contenido de los .ts, que siguen prestando servicio también a resolveWorkoutCompletionScreen,
//    todavía sin consumidor.)

console.log("app-navigation integration contract (P3-07A, parcial) tests passed");
