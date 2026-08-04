import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración (P3-07A + P3-07B). No renderiza React, no ejecuta el
 * componente. Sucesor del contrato de preparación (P3-06) y de su versión parcial (P3-07A).
 * Con P3-07B, P3-06 puede considerarse COMPLETAMENTE integrada:
 *
 * INTEGRADO desde P3-07A:
 *   - app-screen-resolver.ts: las 5 funciones (dashboard/comparación/routine-builder/active-workout/
 *     training-summary), reemplazando las 11 condiciones JSX equivalentes que existían en el root.
 *   - app-navigation-intent.ts: resolveMenuScreens, canGoBackFromScreen, resolveDayStateReset,
 *     resolveNotificationScrollTarget.
 *   - app-auth-screen-resolver.ts: solo resolveInitialAuthState (para screen/statusMessage/
 *     isAuthLoading iniciales). getInitialAuthScreen() fue eliminado del root por redundante.
 *
 * COMPLETADO en P3-07B:
 *   - El antiguo resolveWorkoutCompletionScreen (que devolvía "training-summary"
 *     incondicionalmente y no podía modelar el reintento de link pendiente que termina en
 *     dashboard) fue ELIMINADO de app-navigation-intent.ts y reemplazado por
 *     resolveWorkoutCompletionTransition en app-navigation-transition.ts, que modela los tres
 *     flujos reales. finishCompletedWorkout() quedó como limpieza pura sin navegación.
 *   - Los 31 setScreen directos fueron centralizados en el adaptador applyScreenTransition
 *     (ver app-navigation-controller-contract.test.ts para los conteos exactos de setters).
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontró el inicio: ${startMarker}`);
  assert.ok(end > start, `No se encontró el final: ${endMarker}`);
  return source.slice(start, end);
}

const appSource = readSource("src/components/organizatech-app.tsx");

const modules = {
  screenResolver: readSource("src/lib/navigation/app-screen-resolver.ts"),
  navigationIntent: readSource("src/lib/navigation/app-navigation-intent.ts"),
  authScreenResolver: readSource("src/lib/navigation/app-auth-screen-resolver.ts"),
  navigationTransition: readSource("src/lib/navigation/app-navigation-transition.ts"),
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
assert.match(modules.navigationIntent, /export function resolveNotificationScrollTarget\(/);
assert.doesNotMatch(
  modules.navigationIntent,
  /export function resolveWorkoutCompletionScreen\(/,
  "resolveWorkoutCompletionScreen fue reemplazado en P3-07B por resolveWorkoutCompletionTransition (app-navigation-transition.ts)",
);
assert.match(modules.navigationTransition, /export function resolveWorkoutCompletionTransition\(/);
assert.match(modules.navigationTransition, /export function createAuthNavigationReset\(/);
assert.match(modules.navigationTransition, /export function createFlowScreenTransition\(/);
assert.match(modules.navigationTransition, /export function resolvePasswordRecoveryRouteTransition\(/);

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

// 6. app-navigation-intent: las 4 funciones integradas; la finalización de entrenamiento
//    pasa por resolveWorkoutCompletionTransition (P3-07B).
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
assert.doesNotMatch(appSource, /resolveWorkoutCompletionScreen/, "el resolver extinto no debe reaparecer en el root");
assert.match(appSource, /resolveWorkoutCompletionTransition\(\{ hasCompletionSummary: true \}\)/, "los dos guardados con summary deben decidir su destino via el resolver de transicion");
assert.match(appSource, /resolveWorkoutCompletionTransition\(\{ hasCompletionSummary: false \}\)/, "el reintento de link pendiente (sin summary) debe decidir su destino via el resolver de transicion");
assert.equal(
  (appSource.match(/resolveWorkoutCompletionTransition\(/g) ?? []).length,
  3,
  "exactamente los tres flujos de finalizacion pasan por el resolver de transicion",
);
assert.doesNotMatch(
  appSource,
  /function finishCompletedWorkout\(\) \{[\s\S]{0,400}?setScreen\(/,
  "finishCompletedWorkout es limpieza pura: la navegacion la decide el resolver y la aplica el adaptador (elimina la doble escritura dashboard→training-summary)",
);
assert.doesNotMatch(appSource, /setScreen\("training-summary"\)/, "no quedan setters directos hacia training-summary (P3-07B)");

// 7. app-auth-screen-resolver: una sola lectura impura alimenta screen/status/loading. La lectura
//    puede purgar records inválidos, por lo que repetirla produciría snapshots incoherentes.
const initialAuthSource = sourceSection(
  appSource,
  "export function OrganizatechApp",
  "  const [sessionName, setSessionName]",
);
assert.equal(
  (initialAuthSource.match(/getPasswordRecoveryRouteState\(\)/g) ?? []).length,
  1,
  "el estado inicial de recovery debe resolverse exactamente una vez",
);
assert.equal(
  (initialAuthSource.match(/resolveInitialAuthState\(/g) ?? []).length,
  1,
  "el snapshot único debe derivarse exactamente una vez",
);
assert.match(appSource, /useAppNavigationController\(initialAuthState\.screen,/);
assert.match(appSource, /useState\(initialAuthState\.statusMessage\)/);
assert.match(appSource, /useState\(initialAuthState\.isAuthLoading\)/);
assert.doesNotMatch(appSource, /function getInitialAuthScreen\(\): Screen \{/, "getInitialAuthScreen quedo redundante tras integrar resolveInitialAuthState y fue eliminado");
assert.match(appSource, /function getPasswordRecoveryRouteState\(\): "none" \| "active" \| "expired" \{/, "getPasswordRecoveryRouteState (impura) permanece en el root");
assert.doesNotMatch(appSource, /if \(recoveryState === "expired"\) return "recovery-expired";/, "la derivacion inline duplicada debe haberse eliminado del root");
assert.doesNotMatch(appSource, /return "Validando sesión\.\.\.";/, "la derivacion inline duplicada de statusMessage debe haberse eliminado del root");

// 8. Ningún módulo afirma ya estar "pendiente de integrar": con P3-07B la integración de
//    P3-06 está completa y los docstrings deben reflejarlo.
Object.entries(modules).forEach(([label, source]) => {
  assert.doesNotMatch(source, /No integrado todavía|pendiente de integrar/, `${label} no debe afirmar que sigue pendiente de integracion`);
});

console.log("app-navigation integration contract (P3-06 completa via P3-07A+P3-07B) tests passed");
