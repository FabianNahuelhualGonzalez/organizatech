import assert from "node:assert/strict";

import {
  resolveInitialAuthLoading,
  resolveInitialAuthScreen,
  resolveInitialAuthState,
  resolveInitialAuthStatusMessage,
  type PasswordRecoveryRouteState,
} from "@/lib/navigation/app-auth-screen-resolver";

/**
 * Pruebas de caracterización: demuestran paridad con la extinta `getInitialAuthScreen()` y con
 * los inicializadores lazy que antes derivaban `statusMessage` e `isAuthLoading` por separado —
 * para los tres estados posibles de `getPasswordRecoveryRouteState()`. Desde P3-07A el root usa
 * `resolveInitialAuthState` directamente; no se toca ni se caracteriza `getPasswordRecoveryRouteState`
 * en sí (impura, permanece en React) — solo la derivación pura a partir de su resultado.
 */

const routeStates: PasswordRecoveryRouteState[] = ["none", "active", "expired"];

// CASO — pantalla inicial por cada estado de ruta (paridad literal con getInitialAuthScreen).
assert.equal(resolveInitialAuthScreen("expired"), "recovery-expired");
assert.equal(resolveInitialAuthScreen("active"), "nueva-password");
assert.equal(resolveInitialAuthScreen("none"), "login");

// CASO — mensaje de estado inicial por cada estado de ruta (paridad literal, incluye tildes).
assert.equal(resolveInitialAuthStatusMessage("expired"), "El enlace de recuperación expiró o ya fue utilizado.");
assert.equal(resolveInitialAuthStatusMessage("active"), "Crea una nueva contraseña para continuar.");
assert.equal(resolveInitialAuthStatusMessage("none"), "Validando sesión...");

// CASO — isAuthLoading solo es true cuando el estado de ruta es "none".
assert.equal(resolveInitialAuthLoading("none"), true);
assert.equal(resolveInitialAuthLoading("active"), false);
assert.equal(resolveInitialAuthLoading("expired"), false);

// CASO — combinación: resolveInitialAuthState agrupa las tres derivaciones para una sola lectura.
for (const routeState of routeStates) {
  assert.deepEqual(resolveInitialAuthState(routeState), {
    screen: resolveInitialAuthScreen(routeState),
    statusMessage: resolveInitialAuthStatusMessage(routeState),
    isAuthLoading: resolveInitialAuthLoading(routeState),
  });
}

// CASO — determinismo: misma entrada produce siempre la misma salida.
assert.deepEqual(resolveInitialAuthState("active"), resolveInitialAuthState("active"));

console.log("app-auth-screen-resolver tests passed");
