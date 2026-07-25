import assert from "node:assert/strict";

import { resolveDashboardDotIndex } from "@/lib/dashboard/dashboard-carousel-state";

const WEEK_DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

// CASO 7 — Identidad estable: el día (string) es la identidad de la tarjeta; el índice derivado
// de ese día es el mismo en llamadas repetidas.
function testDotIndexIsStableAcrossCalls() {
  assert.equal(resolveDashboardDotIndex(WEEK_DAYS, "Miércoles"), 2);
  assert.equal(resolveDashboardDotIndex(WEEK_DAYS, "Miércoles"), 2);
}

// CASO 8 — Índice inicial: el día activo determina el índice del punto de paginación.
function testInitialIndexMatchesActiveDay() {
  assert.equal(resolveDashboardDotIndex(WEEK_DAYS, "Lunes"), 0);
  assert.equal(resolveDashboardDotIndex(WEEK_DAYS, "Viernes"), 4);
}

// CASO 9 — Índice fuera de rango: un día ausente de la lista cae al primer punto (0),
// igual que `Math.max(0, weekDays.indexOf(day))` en producción (indexOf === -1 → 0).
function testOutOfRangeDayClampsToFirstDot() {
  assert.equal(resolveDashboardDotIndex(WEEK_DAYS, "Sábado"), 0);
  assert.equal(resolveDashboardDotIndex([], "Lunes"), 0, "lista vacía: siempre 0, igual que producción");
}

// CASO 12 (parcial) — Cambio en la cantidad de tarjetas: el índice se recalcula contra la
// lista vigente, sin memoria de una lista anterior.
function testChangingCardCountRecomputesIndexAgainstCurrentList() {
  const shorterDays = ["Lunes", "Martes"];
  assert.equal(resolveDashboardDotIndex(shorterDays, "Miércoles"), 0, "un día que ya no está en la lista cae a 0");
  assert.equal(resolveDashboardDotIndex(shorterDays, "Martes"), 1);
}

// CASO 14 — Inmutabilidad: no debe mutarse el arreglo de días recibido.
function testDoesNotMutateInputDaysArray() {
  const days = ["Lunes", "Martes", "Miércoles"];
  const snapshot = [...days];
  resolveDashboardDotIndex(days, "Martes");
  assert.deepEqual(days, snapshot);
}

// CASO 15 — Misma entrada produce misma salida.
function testSameInputProducesSameOutput() {
  assert.equal(resolveDashboardDotIndex(WEEK_DAYS, "Jueves"), resolveDashboardDotIndex([...WEEK_DAYS], "Jueves"));
}

testDotIndexIsStableAcrossCalls();
testInitialIndexMatchesActiveDay();
testOutOfRangeDayClampsToFirstDot();
testChangingCardCountRecomputesIndexAgainstCurrentList();
testDoesNotMutateInputDaysArray();
testSameInputProducesSameOutput();

console.log("dashboard-carousel-state tests passed");
