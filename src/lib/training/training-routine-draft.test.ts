import assert from "node:assert/strict";

import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";

/**
 * Paridad estructural de `SetupExerciseRow`/`SetupDayState` contra la definición original hoy
 * local a `organizatech-app.tsx`. Nota: node:assert/strict tipa equal/deepEqual como funciones de
 * aserción (`asserts actual is T`), por eso las verificaciones por campo van siempre antes de
 * cualquier deepEqual que reciba el mismo fixture como argumento.
 */

// CASO 1 — Fixture completo de SetupExerciseRow: todos los campos presentes.
const fullRow: SetupExerciseRow = {
  id: "row-1",
  sourceExerciseId: "exercise-1",
  exerciseLineageId: "lineage-1",
  name: "Sentadilla",
  sets: 4,
  reps: 10,
  weight: "80",
};

// CASO 2 — Fixture sin sourceExerciseId: campo ausente por completo (fila nueva, sin origen).
const rowWithoutSourceExerciseId: SetupExerciseRow = {
  id: "row-2",
  exerciseLineageId: null,
  name: "Peso muerto",
  sets: 3,
  reps: 8,
  weight: "100",
};

// CASO 3 — Fixture con exerciseLineageId null explícito (distinto de ausente).
const rowWithNullLineageId: SetupExerciseRow = {
  id: "row-3",
  sourceExerciseId: "exercise-3",
  exerciseLineageId: null,
  name: "Press banca",
  sets: 4,
  reps: 12,
  weight: "60",
};

// Fixture con exerciseLineageId ausente por completo (opcional, distinto de null).
const rowWithoutLineageId: SetupExerciseRow = {
  id: "row-4",
  name: "Remo",
  sets: 4,
  reps: 10,
  weight: "50",
};

// CASO 4 — Fixture completo de SetupDayState.
const fullDayState: SetupDayState = {
  routineName: "Tren superior",
  rows: [fullRow, rowWithoutSourceExerciseId],
};

// CASO 5 — Múltiples rows, orden preservado (rows es un array ordenado, no un set).
const orderedDayState: SetupDayState = {
  routineName: "Full body",
  rows: [rowWithNullLineageId, rowWithoutLineageId, fullRow],
};

// CASO 6 — Aserciones runtime por campo.
assert.equal(fullRow.id, "row-1");
assert.equal(fullRow.sourceExerciseId, "exercise-1");
assert.equal(fullRow.exerciseLineageId, "lineage-1");
assert.equal(fullRow.name, "Sentadilla");
assert.equal(fullRow.sets, 4);
assert.equal(fullRow.reps, 10);
assert.equal(fullRow.weight, "80");
assert.deepEqual(fullRow, {
  id: "row-1",
  sourceExerciseId: "exercise-1",
  exerciseLineageId: "lineage-1",
  name: "Sentadilla",
  sets: 4,
  reps: 10,
  weight: "80",
});

assert.equal(rowWithoutSourceExerciseId.id, "row-2");
assert.equal(rowWithoutSourceExerciseId.sourceExerciseId, undefined);
assert.equal(rowWithoutSourceExerciseId.exerciseLineageId, null);
assert.equal(rowWithoutSourceExerciseId.name, "Peso muerto");
assert.equal(rowWithoutSourceExerciseId.sets, 3);
assert.equal(rowWithoutSourceExerciseId.reps, 8);
assert.equal(rowWithoutSourceExerciseId.weight, "100");
assert.equal("sourceExerciseId" in rowWithoutSourceExerciseId, false, "el campo esta ausente, no solo undefined");

assert.equal(rowWithNullLineageId.exerciseLineageId, null);
assert.equal(rowWithoutLineageId.exerciseLineageId, undefined);
assert.equal("exerciseLineageId" in rowWithoutLineageId, false, "el campo esta ausente por completo");

assert.equal(fullDayState.routineName, "Tren superior");
assert.equal(fullDayState.rows.length, 2);
assert.equal(fullDayState.rows[0], fullRow);
assert.equal(fullDayState.rows[1], rowWithoutSourceExerciseId);
assert.deepEqual(fullDayState.rows.map((row) => row.id), ["row-1", "row-2"]);

assert.equal(orderedDayState.rows.length, 3);
assert.deepEqual(
  orderedDayState.rows.map((row) => row.id),
  ["row-3", "row-4", "row-1"],
  "el orden de rows se preserva tal cual fue construido, sin reordenar",
);

// CASO 12 — Evidencia de que sourceExerciseId es opcional: un SetupExerciseRow valido puede
// omitirlo por completo (ya probado en CASO 2) o incluirlo (CASO 1). Ambas formas son legales.
const minimalRow: SetupExerciseRow = { id: "row-5", name: "", sets: 0, reps: 0, weight: "" };
assert.equal("sourceExerciseId" in minimalRow, false);
assert.equal("exerciseLineageId" in minimalRow, false);

// CASO 13 — Evidencia de que exerciseLineageId acepta string, null o ausencia (las tres formas).
const lineageAsString: SetupExerciseRow["exerciseLineageId"] = "lineage-x";
const lineageAsNull: SetupExerciseRow["exerciseLineageId"] = null;
const lineageAbsent: SetupExerciseRow["exerciseLineageId"] = undefined;
assert.equal(typeof lineageAsString, "string");
assert.equal(lineageAsNull, null);
assert.equal(lineageAbsent, undefined);

// CASO 7 — @ts-expect-error: id es obligatorio, no puede omitirse.
// @ts-expect-error id es obligatorio.
const missingId: SetupExerciseRow = { name: "x", sets: 1, reps: 1, weight: "1" };

// CASO 8 — @ts-expect-error: sets debe ser number, no string.
// @ts-expect-error sets debe ser number, no string.
const wrongSetsType: SetupExerciseRow = { id: "x", name: "x", sets: "4", reps: 1, weight: "1" };

// CASO 9 — @ts-expect-error: reps debe ser number, no string.
// @ts-expect-error reps debe ser number, no string.
const wrongRepsType: SetupExerciseRow = { id: "x", name: "x", sets: 1, reps: "10", weight: "1" };

// CASO 10 — @ts-expect-error: weight debe ser string, no number.
// @ts-expect-error weight debe ser string, no number.
const wrongWeightType: SetupExerciseRow = { id: "x", name: "x", sets: 1, reps: 1, weight: 80 };

// CASO 11 — @ts-expect-error: rows debe ser SetupExerciseRow[], no otra forma.
// @ts-expect-error rows debe ser SetupExerciseRow[], no un arreglo de strings.
const wrongRowsType: SetupDayState = { routineName: "x", rows: ["not-a-row"] };

void [missingId, wrongSetsType, wrongRepsType, wrongWeightType, wrongRowsType];

console.log("training-routine-draft tests passed");
