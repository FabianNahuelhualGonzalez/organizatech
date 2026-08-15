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
 * los inicializadores que derivan `statusMessage` e `isAuthLoading` desde el mismo snapshot —
 * para los tres estados posibles de `getPasswordRecoveryRouteState()`. No se caracteriza aquí la
 * lectura impura; el contrato de integración fija que el root la ejecute una sola vez.
 */

const routeStates: PasswordRecoveryRouteState[] = ["none", "active", "expired"];

// CASO — pantalla inicial por cada estado de ruta (paridad literal con getInitialAuthScreen).
assert.equal(resolveInitialAuthScreen("expired"), "recovery-expired");
assert.equal(resolveInitialAuthScreen("active"), "nueva-password");
assert.equal(resolveInitialAuthScreen("none"), "login");
assert.equal(resolveInitialAuthScreen("none", "registro"), "registro");
assert.equal(resolveInitialAuthScreen("active", "registro"), "nueva-password");
assert.equal(resolveInitialAuthScreen("expired", "registro"), "recovery-expired");

// CASO — mensaje de estado inicial por cada estado de ruta (paridad literal, incluye tildes).
assert.equal(resolveInitialAuthStatusMessage("expired"), "El enlace de recuperación expiró o ya fue utilizado.");
assert.equal(resolveInitialAuthStatusMessage("active"), "Crea una nueva contraseña para continuar.");
assert.equal(resolveInitialAuthStatusMessage("none"), "Validando sesión...");

// CASO — una intención active permanece bajo loading hasta que Supabase confirme la sesión.
assert.equal(resolveInitialAuthLoading("none"), true);
assert.equal(resolveInitialAuthLoading("active"), true);
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
assert.equal(resolveInitialAuthState("none", "registro").screen, "registro");

console.log("app-auth-screen-resolver tests passed");
