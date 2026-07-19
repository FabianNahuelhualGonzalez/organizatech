import assert from "node:assert/strict";

import {
  getActiveFlow,
  isActiveFlow,
  isAppScreen,
  screenLabel,
  type ActiveFlow,
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
