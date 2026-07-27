import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de preparación (P3-06). No renderiza React, no ejecuta el componente. Verifica:
 * 1. Futura fuente canónica: los tres módulos nuevos existen y exportan lo esperado.
 * 2. Ausencia de imports prohibidos (organizatech-app.tsx, Supabase, repositories, storage productivo).
 * 3. Ausencia de React en los módulos puros.
 * 4. Paridad temporal con el root: los fragmentos que se espejaron siguen existiendo, literalmente,
 *    en organizatech-app.tsx — si alguien cambia la lógica original sin actualizar el espejo, este
 *    test falla y expone la divergencia.
 * 5. El root permanece sin modificaciones en esta rama: no importa (todavía) ninguno de los 3 módulos.
 * 6. La duplicación temporal está documentada como tal, con instrucción explícita de eliminarse en
 *    integración.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

// Quita comentarios de bloque y de línea antes de verificar ausencia de APIs prohibidas en código
// real — los docstrings de estos módulos legítimamente citan `window.setTimeout`/
// `document.querySelector` en prosa para explicar qué NO hacen (esa ejecución permanece en
// organizatech-app.tsx), y no deben confundirse con un uso real.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const appSource = readSource("src/components/organizatech-app.tsx");

const modules = {
  screenResolver: readSource("src/lib/navigation/app-screen-resolver.ts"),
  navigationIntent: readSource("src/lib/navigation/app-navigation-intent.ts"),
  authScreenResolver: readSource("src/lib/navigation/app-auth-screen-resolver.ts"),
};

// 1. Futura fuente canónica: exports esperados presentes en cada módulo.
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

// 2-3. Ausencia de imports prohibidos y de React, en los tres módulos.
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
  // Nota: no se verifica ausencia de JSX por regex — los tres módulos son .ts (no .tsx), y JSX
  // real ahí ni siquiera compilaría (ya lo prueba `tsc --noEmit`, ejecutado como gate aparte).
  // Los docstrings SÍ citan JSX original entre backticks como referencia de procedencia
  // (p.ej. `<CycleScopedPlanBlocker/>`), lo cual es legítimo y no debe marcarse como error.
}
Object.entries(modules).forEach(([label, source]) => assertPureModule(source, label));

// 4. Paridad temporal con el root — los fragmentos espejados siguen existiendo literalmente.

// app-screen-resolver.ts espeja las condiciones JSX de cada variante de pantalla.
assert.match(appSource, /screen === "registro-entrenamiento" && isCycleScopedPlanBlocked && !isEditingRoutinePlan/);
assert.match(appSource, /screen === "registro-entrenamiento" && !isCycleScopedPlanBlocked && \(!hasRoutinePlan \|\| isEditingRoutinePlan\)/);
assert.match(appSource, /screen === "registro-entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan/);
assert.match(appSource, /screen === "entrenamiento" && isCycleScopedPlanBlocked/);
assert.match(appSource, /screen === "entrenamiento" && !isCycleScopedPlanBlocked && !hasRoutinePlan/);
assert.match(appSource, /screen === "entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && !hasStartedTraining/);
assert.match(appSource, /hasStartedTraining && !readiness/);
assert.match(appSource, /hasStartedTraining && readiness/);
assert.match(appSource, /screen === "training-summary" && !trainingCompletionSummary/);

// app-navigation-intent.ts espeja menuScreens, la fila "Volver", el reseteo de día y el destino final.
assert.match(appSource, /const menuScreens = hasTrainingEntries/);
assert.match(appSource, /item === "historial-ciclos" && visibleCycleHistoryCount > 0/);
assert.match(appSource, /screen !== "dashboard" && screen !== "training-summary"/);
assert.equal(
  (appSource.match(/setActiveRoutineDay\("Lunes"\);\s*\n\s*setDashboardDayOverride\(""\);\s*\n\s*setComparisonDay\("Lunes"\);/g) ?? []).length,
  4,
  "el paquete de reseteo de dia debe seguir apareciendo 4 veces de forma identica en el root",
);
assert.match(appSource, /function finishCompletedWorkout\(\) \{[\s\S]*?setScreen\("dashboard"\);\s*\n\s*\}/);
assert.match(appSource, /setScreen\("training-summary"\);/);
assert.match(appSource, /\[data-section="\$\{section\}"\]/);

// app-auth-screen-resolver.ts espeja getInitialAuthScreen y los inicializadores lazy.
assert.match(appSource, /function getInitialAuthScreen\(\): Screen \{/);
assert.match(appSource, /if \(recoveryState === "expired"\) return "recovery-expired";/);
assert.match(appSource, /if \(recoveryState === "active"\) return "nueva-password";/);
assert.match(appSource, /El enlace de recuperación expiró o ya fue utilizado\./);
assert.match(appSource, /Crea una nueva contraseña para continuar\./);
assert.match(appSource, /Validando sesión\.\.\./);
assert.match(appSource, /const \[isAuthLoading, setIsAuthLoading\] = useState\(\(\) => getPasswordRecoveryRouteState\(\) === "none"\);/);

// 5. El root permanece sin modificaciones en esta rama: no importa (todavia) ninguno de los 3 módulos.
assert.doesNotMatch(appSource, /from ["']@\/lib\/navigation\/app-screen-resolver["']/);
assert.doesNotMatch(appSource, /from ["']@\/lib\/navigation\/app-navigation-intent["']/);
assert.doesNotMatch(appSource, /from ["']@\/lib\/navigation\/app-auth-screen-resolver["']/);

// 6. La duplicación temporal está documentada como tal en cada módulo nuevo.
Object.entries(modules).forEach(([label, source]) => {
  assert.match(source, /No integrado todavía/, `${label} debe documentar explicitamente que aun no esta integrado`);
});

console.log("app-navigation preparation contract tests passed");
