import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato de integración del CONTROLADOR de navegación (P3-07B). Verifica los invariantes de
 * comportamiento y dependencia de la centralización — no fija cuerpos completos por texto:
 *
 * 1. Conteo EXACTO de setters autorizados: 2 escrituras de pantalla (una en
 *    applyContextualNavigation, una en applyScreenTransition) y 1 escritura de historial
 *    (en applyContextualNavigation). Allowlist de excepciones: VACÍA.
 * 2. Sin setters ocultos mediante aliases: el número total de ocurrencias del identificador
 *    coincide con declaración + usos autorizados — cualquier alias (`const x = setScreen`)
 *    aumentaría el conteo y rompería este contrato.
 * 3. Todos los call sites de transición usan el controlador (25 llamadas a
 *    applyScreenTransition + la navegación contextual vía applyContextualNavigation).
 * 4. La finalización de entrenamiento separa persistencia (finishCompletedWorkout, limpieza
 *    pura), decisión (resolveWorkoutCompletionTransition) y aplicación (applyScreenTransition)
 *    — sin doble escritura implícita dashboard→training-summary.
 * 5. La política de historial vive en el modelo puro: "reset" delega en
 *    applyContextualNavigation(resetContextualNavigation(...)), "preserve" no toca historial.
 * 6. Los flujos protegidos (logout/epoch, reentrada de workout, notificaciones) conservan su
 *    orden funcional a través del controlador.
 */

const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const transitionSource = readFileSync("src/lib/navigation/app-navigation-transition.ts", "utf8");

// Quita comentarios antes de las verificaciones de pureza: los docstrings citan legítimamente
// los setters en prosa para explicar qué NO hacen (mismo patrón que el contrato de navegación).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontro el inicio del contrato: ${startMarker}`);
  assert.ok(end > start, `No se encontro el final del contrato: ${endMarker}`);
  return source.slice(start, end);
}

// 1. Conteo exacto de setters autorizados en el root.
assert.equal(
  (appSource.match(/setScreen\(/g) ?? []).length,
  2,
  "exactamente 2 escrituras de pantalla: applyContextualNavigation y applyScreenTransition",
);
assert.equal(
  (appSource.match(/setScreenHistory\(/g) ?? []).length,
  1,
  "exactamente 1 escritura de historial: applyContextualNavigation",
);

// 2. Sin aliases ocultos: total de ocurrencias del identificador = declaración useState (1) +
//    usos autorizados. Un alias o un nuevo uso directo elevaría el conteo.
assert.equal(
  (appSource.match(/\bsetScreen\b/g) ?? []).length,
  3,
  "setScreen aparece solo en su declaracion useState y en los 2 escritores autorizados",
);
assert.equal(
  (appSource.match(/\bsetScreenHistory\b/g) ?? []).length,
  2,
  "setScreenHistory aparece solo en su declaracion useState y en applyContextualNavigation",
);

// Ubicación autorizada: ambos setters de applyContextualNavigation en su cuerpo; el del
// adaptador dentro de applyScreenTransition, que delega el reset en applyContextualNavigation.
const contextualNavigationSource = sourceSection(
  appSource,
  "  function applyContextualNavigation",
  "  function applyScreenTransition",
);
assert.match(contextualNavigationSource, /setScreenHistory\(\[\.\.\.navigation\.history\]\);\s*\n\s*setScreen\(navigation\.screen\);/);
const screenTransitionSource = sourceSection(
  appSource,
  "  function applyScreenTransition",
  "  function restoreActiveFlowForSession",
);
assert.match(screenTransitionSource, /historyPolicy === "reset"/);
assert.match(screenTransitionSource, /applyContextualNavigation\(resetContextualNavigation\(transition\.screen\)\);/);
assert.match(screenTransitionSource, /setScreen\(transition\.screen\);/);
assert.doesNotMatch(screenTransitionSource, /setScreenHistory\(/, "la politica preserve no debe tocar el historial");

// 3. Todos los call sites usan el controlador: 1 definición + 25 sitios. El cierre exitoso de
//    password recovery delega en clearUserSessionState, la fuente canónica del logout.
assert.equal(
  (appSource.match(/applyScreenTransition\(/g) ?? []).length,
  26,
  "1 definicion + 25 call sites de transicion canonica",
);
// La navegación contextual (navigateTo/goBack/restauraciones/logout) sigue en su fuente única.
assert.equal(
  (appSource.match(/applyContextualNavigation\(/g) ?? []).length,
  9,
  "1 definicion + 8 llamadas: logout, 4 restauraciones, navigateTo, goBack y el reset del adaptador",
);
assert.equal(
  (appSource.match(/applyContextualNavigation\(resetContextualNavigation\("login"\)\)/g) ?? []).length,
  1,
  "logout conserva su unica transicion coherente hacia login",
);

// 4. Finalización: limpieza pura + decisión por resolver + aplicación por adaptador.
const finishSource = sourceSection(
  appSource,
  "  function finishCompletedWorkout",
  "  async function buildCompletedTrainingSummarySnapshot",
);
assert.doesNotMatch(finishSource, /setScreen\(|applyScreenTransition\(|applyContextualNavigation\(/, "finishCompletedWorkout no navega");
["clearWorkoutDraft", "activeWorkoutAttemptIdRef.current = null", "pendingReadinessLinkRef.current = null", "activeWorkoutReadinessContextRef.current = null", "activeWorkoutActions.finishWorkout()"].forEach((marker) => {
  assert.ok(finishSource.includes(marker), `finishCompletedWorkout conserva la limpieza: ${marker}`);
});
assert.equal(
  (appSource.match(/finishCompletedWorkout\(\);\s*\n\s*applyScreenTransition\(resolveWorkoutCompletionTransition\(/g) ?? []).length,
  3,
  "los 3 call sites de finalizacion aplican su transicion inmediatamente despues de la limpieza",
);
assert.doesNotMatch(appSource, /setScreen\("training-summary"\)|setScreen\("dashboard"\)/, "no quedan destinos literales fuera del controlador");

// 5. La política de historial vive en el modelo puro (sin React ni setters).
assert.match(transitionSource, /historyPolicy: "reset"/);
assert.match(transitionSource, /historyPolicy: "preserve"/);
assert.doesNotMatch(stripComments(transitionSource), /setScreen|setScreenHistory|from "react"/, "el modelo puro no conoce setters ni React");
assert.match(transitionSource, /hasCompletionSummary \? "training-summary" : "dashboard"/, "el resolver de finalizacion modela los tres flujos reales");

// 6. Flujos protegidos a través del controlador.
// 6a. Logout/epoch: el avance forzado del epoch precede a todo reset, y la navegación es la
//     última operación de dominio (cubierto en detalle por session-data-epoch.test.ts y
//     app-navigation.test.ts; aquí solo la invariante de fuente única, ya verificada arriba).
// 6b. Reentrada de workout: las restauraciones navegan por applyContextualNavigation con reset.
assert.equal(
  (appSource.match(/applyContextualNavigation\(resetContextualNavigation\("entrenamiento"\)\)/g) ?? []).length,
  2,
  "resume-memory y restore-draft conservan su reset de historial hacia entrenamiento",
);
// 6c. Notificaciones: la apertura sigue delegando en navigateTo (fuente contextual), nunca en
//     el adaptador de transiciones ni en setters.
const openTargetSource = sourceSection(appSource, "  function openNotificationTarget", "  function scrollToNotificationSection");
assert.match(openTargetSource, /navigateTo\(intent\.target\);/);
assert.doesNotMatch(openTargetSource, /applyScreenTransition\(|setScreen\(/, "la apertura de notificaciones no debe crear navegacion paralela");
// 6d. El saneamiento de training-summary sin snapshot conserva el rebote a dashboard con
//     historial preservado (politica de flujo, no de auth).
assert.match(appSource, /screen === "training-summary" && !trainingCompletionSummary[\s\S]{0,200}?createFlowScreenTransition\("dashboard", "summary-state-sanitized"\)/);

console.log("app-navigation-controller contract tests passed");
