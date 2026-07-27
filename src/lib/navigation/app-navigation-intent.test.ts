import assert from "node:assert/strict";

import type { Screen } from "@/lib/navigation/app-navigation";
import {
  canGoBackFromScreen,
  resolveDayStateReset,
  resolveMenuScreens,
  resolveNotificationScrollTarget,
} from "@/lib/navigation/app-navigation-intent";
import type { AppNotificationSection } from "@/lib/notifications/notification-types";

/**
 * Pruebas de caracterización: demuestran paridad con las reglas hoy inline en
 * organizatech-app.tsx, sin renderizar React, sin acceder al DOM.
 */

// Igual a `const primaryScreens: Screen[]` (organizatech-app.tsx:306).
const primaryScreens: Screen[] = ["perfil", "dashboard", "entrenamiento", "comparacion", "registro-entrenamiento", "historial-ciclos"];

// Los 12 valores de Screen (paridad con app-navigation.ts).
const allScreens: Screen[] = [
  "login", "registro", "recuperar-password", "nueva-password", "recovery-expired",
  "dashboard", "entrenamiento", "training-summary", "registro-entrenamiento",
  "comparacion", "historial-ciclos", "perfil",
];

// CASO — resolveMenuScreens: con entradas de entrenamiento, muestra todas las primaryScreens.
assert.deepEqual(resolveMenuScreens(primaryScreens, true, 0), primaryScreens);
assert.deepEqual(resolveMenuScreens(primaryScreens, true, 5), primaryScreens);
assert.notEqual(
  resolveMenuScreens(primaryScreens, true, 0),
  primaryScreens,
  "retorna un arreglo nuevo, no la misma referencia (mejora deliberada de pureza)",
);

// CASO — sin entradas y sin ciclos visibles: historial-ciclos se excluye.
assert.deepEqual(
  resolveMenuScreens(primaryScreens, false, 0),
  ["perfil", "dashboard", "entrenamiento", "comparacion", "registro-entrenamiento"],
);

// CASO — sin entradas pero con ciclos visibles: historial-ciclos se conserva.
assert.deepEqual(
  resolveMenuScreens(primaryScreens, false, 3),
  ["perfil", "dashboard", "entrenamiento", "comparacion", "registro-entrenamiento", "historial-ciclos"],
);

// CASO — cada pantalla válida: canGoBackFromScreen para las 12 pantallas conocidas.
assert.equal(canGoBackFromScreen("dashboard"), false);
assert.equal(canGoBackFromScreen("training-summary"), false);
for (const screen of allScreens) {
  if (screen === "dashboard" || screen === "training-summary") continue;
  assert.equal(canGoBackFromScreen(screen), true, `${screen} debe permitir volver`);
}
assert.equal(allScreens.length, 12, "paridad con las 12 pantallas de app-navigation.ts");

// CASO — reseteo de día (ciclo activo / rutina): mismo paquete de valores en toda transición de ciclo.
assert.deepEqual(resolveDayStateReset(), { activeRoutineDay: "Lunes", dashboardDayOverride: "", comparisonDay: "Lunes" });
// Determinismo: misma entrada (sin entrada) produce siempre el mismo resultado.
assert.deepEqual(resolveDayStateReset(), resolveDayStateReset());

// Nota P3-07B: el destino tras completar un entrenamiento se modela ahora en
// app-navigation-transition.ts (resolveWorkoutCompletionTransition), con cobertura propia de
// los tres flujos reales en app-navigation-transition.test.ts.

// CASO — navegación hacia data-section: cada sección conocida produce el selector esperado.
const sections: AppNotificationSection[] = [
  "profile-avatar", "personal-data", "today-training", "training-carousel", "weekly-progress", "coach", "weekly-comparison",
];
for (const section of sections) {
  assert.deepEqual(resolveNotificationScrollTarget(section), { selector: `[data-section="${section}"]` });
}
assert.equal(resolveNotificationScrollTarget(null), null, "fallback: sin seccion, no hay destino de scroll");

console.log("app-navigation-intent tests passed");
