import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createRoutineBuilderRow,
  createRoutineBuilderState,
  routineBuilderReducer,
  type RoutineBuilderAction,
  type RoutineBuilderState,
} from "@/features/routine-builder/model/routine-builder-state";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";

/**
 * Pruebas de caracterización del modelo puro de estado de Routine Builder (P3-20, corregido en
 * P3-20B tras auditoría; extendido en P3-21 con operaciones de fila; corregido en P3-21B para
 * contractualizar `allowEmptyRows` como campo obligatorio de `remove_row`). Sin React, sin DOM,
 * sin storage. Cubren exactamente el shape final `{ activeDay, setupByDay }` — sin
 * message/isBusy — con clonado defensivo verificado por mutación externa posterior, sin
 * reproducir el algoritmo del reducer.
 */

function createRow(overrides: Partial<SetupExerciseRow> = {}): SetupExerciseRow {
  return { id: "row-1", name: "Sentadilla", sets: 4, reps: 10, weight: "60", ...overrides };
}

function createPreparedSetupByDay(): Record<string, SetupDayState> {
  return { Lunes: { routineName: "Empuje", rows: [createRow()] } };
}

// CASO — initializer requiere setupByDay (obligatorio en el tipo; TypeScript rechaza omitirlo
// en tiempo de compilación — RoutineBuilderStateInit.setupByDay no es opcional y la función no
// tiene un valor por defecto `= {}`). Aquí se confirma el comportamiento cuando SÍ se entrega.
const preparedSetupByDay = createPreparedSetupByDay();
const initial = createRoutineBuilderState({ setupByDay: preparedSetupByDay });
assert.equal(initial.activeDay, TRAINING_DAY_LABELS[0], "el dia por defecto es el primero del catalogo canonico (hoy 'Lunes')");
assert.deepEqual(initial.setupByDay, preparedSetupByDay, "el contenido recibido se conserva");
assert.ok(!("message" in initial), "message ya no forma parte del estado");
assert.ok(!("isBusy" in initial), "isBusy ya no forma parte del estado");
assert.deepEqual(Object.keys(initial).sort(), ["activeDay", "setupByDay"], "el shape final es exactamente activeDay + setupByDay");

// CASO — el initializer clona el mapa entregado: mutar el original después de construir el
// estado no debe alterarlo (mapa, cada día, su array rows y cada fila).
{
  const external = createPreparedSetupByDay();
  const state = createRoutineBuilderState({ setupByDay: external });
  assert.notEqual(state.setupByDay, external, "el mapa clonado no es la misma referencia");
  assert.notEqual(state.setupByDay.Lunes, external.Lunes, "el SetupDayState clonado no es la misma referencia");
  assert.notEqual(state.setupByDay.Lunes?.rows, external.Lunes.rows, "el array rows clonado no es la misma referencia");
  assert.notEqual(state.setupByDay.Lunes?.rows[0], external.Lunes.rows[0], "cada fila clonada no es la misma referencia");

  external.Martes = { routineName: "Nuevo dia externo", rows: [createRow({ id: "intruso" })] };
  external.Lunes.routineName = "Mutado externamente";
  external.Lunes.rows.push(createRow({ id: "fila-agregada-externa" }));
  external.Lunes.rows[0].name = "Nombre mutado externamente";

  assert.equal(state.setupByDay.Martes, undefined, "un dia agregado externamente despues no debe aparecer en el estado");
  assert.equal(state.setupByDay.Lunes?.routineName, "Empuje", "el nombre no debe cambiar por mutacion externa posterior");
  assert.equal(state.setupByDay.Lunes?.rows.length, 1, "las filas agregadas externamente despues no deben aparecer");
  assert.equal(state.setupByDay.Lunes?.rows[0]?.name, "Sentadilla", "el contenido de una fila no debe cambiar por mutacion externa posterior");
}

// CASO — nueva referencia por cada inicialización (no comparte objetos entre llamadas), mismo
// contenido.
{
  const a = createRoutineBuilderState({ setupByDay: createPreparedSetupByDay() });
  const b = createRoutineBuilderState({ setupByDay: createPreparedSetupByDay() });
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
}

// CASO — select_day: cambia el dia activo.
{
  const state = createRoutineBuilderState({ setupByDay: createPreparedSetupByDay(), activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "select_day", day: "Martes" });
  assert.equal(next.activeDay, "Martes");
  assert.notEqual(next, state, "cambiar de dia produce una referencia nueva");
}

// CASO — select_day al mismo dia: preserva la referencia (no-op).
{
  const state = createRoutineBuilderState({ setupByDay: createPreparedSetupByDay(), activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "select_day", day: "Lunes" });
  assert.equal(next, state, "seleccionar el mismo dia no debe producir una referencia nueva");
}

// CASO — set_routine_name: escribe el nombre del dia activo, preserva las filas existentes.
{
  const rows = [createRow()];
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "", rows } }, activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "set_routine_name", routineName: "Empuje" });
  assert.equal(next.setupByDay.Lunes?.routineName, "Empuje");
  assert.equal(next.setupByDay.Lunes?.rows, state.setupByDay.Lunes?.rows, "las filas existentes se preservan por referencia, no se tocan");
  assert.notEqual(next, state);
}

// CASO — set_routine_name con el mismo nombre: preserva la referencia (no-op).
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Piernas", rows: [] } }, activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "set_routine_name", routineName: "Piernas" });
  assert.equal(next, state, "el mismo nombre no debe producir una referencia nueva");
}

// CASO — set_routine_name solo modifica el dia activo, no otros dias del mapa.
{
  const state = createRoutineBuilderState({
    setupByDay: { Lunes: { routineName: "Empuje", rows: [] }, Martes: { routineName: "Piernas", rows: [] } },
    activeDay: "Lunes",
  });
  const next = routineBuilderReducer(state, { type: "set_routine_name", routineName: "Tirón" });
  assert.equal(next.setupByDay.Lunes?.routineName, "Tirón");
  assert.equal(next.setupByDay.Martes, state.setupByDay.Martes, "otro dia no debe tocarse ni siquiera por referencia");
}

// CASO — dia ausente: crea routineName y un array rows nuevo e independiente (sin generar
// filas en blanco — la construcción de filas vive en add_row/createRoutineBuilderRow, P3-21).
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Miércoles" });
  const next = routineBuilderReducer(state, { type: "set_routine_name", routineName: "Piernas" });
  assert.equal(next.setupByDay["Miércoles"]?.routineName, "Piernas");
  assert.deepEqual(next.setupByDay["Miércoles"]?.rows, [], "el dia recien creado no genera filas en blanco");
}

// CASO — dos días ausentes creados vía set_routine_name no comparten el mismo array rows
// (sin singleton EMPTY_DAY_STATE): mutar el array de uno no debe afectar al otro.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Lunes" });
  const afterLunes = routineBuilderReducer(state, { type: "set_routine_name", routineName: "Empuje" });
  const onMartes = routineBuilderReducer(afterLunes, { type: "select_day", day: "Martes" });
  const afterMartes = routineBuilderReducer(onMartes, { type: "set_routine_name", routineName: "Piernas" });

  const lunesRows = afterMartes.setupByDay.Lunes?.rows;
  const martesRows = afterMartes.setupByDay.Martes?.rows;
  assert.ok(lunesRows && martesRows, "ambos dias deben tener un array rows");
  assert.notEqual(lunesRows, martesRows, "los arrays rows de dos dias nuevos no deben ser la misma referencia");

  lunesRows.push(createRow({ id: "intruso-lunes" }));
  assert.equal(martesRows.length, 0, "mutar el array rows de un dia no debe afectar al del otro dia");
}

// CASO — replace_rows: reemplaza el arreglo completo de filas del dia activo, clonando el
// input; preserva routineName.
{
  const originalRows = [createRow({ id: "a" })];
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: originalRows } }, activeDay: "Lunes" });
  const incomingRows = [createRow({ id: "b" }), createRow({ id: "c", name: "Press banca" })];
  const next = routineBuilderReducer(state, { type: "replace_rows", rows: incomingRows });

  assert.deepEqual(next.setupByDay.Lunes?.rows, incomingRows, "el contenido coincide con el input");
  assert.notEqual(next.setupByDay.Lunes?.rows, incomingRows, "el array resultante no es la misma referencia que action.rows");
  assert.notEqual(next.setupByDay.Lunes?.rows[0], incomingRows[0], "cada fila resultante no comparte referencia con la fila de action.rows");
  assert.equal(next.setupByDay.Lunes?.routineName, "Empuje", "replace_rows no toca el nombre de la rutina");
  assert.deepEqual(state.setupByDay.Lunes?.rows, [createRow({ id: "a" })], "el estado anterior no fue mutado");
}

// CASO — replace_rows: mutación externa POSTERIOR al despacho (del array original y de una de
// sus filas) no debe alterar el resultado ya producido.
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [] } }, activeDay: "Lunes" });
  const incomingRows = [createRow({ id: "x", name: "Original" })];
  const next = routineBuilderReducer(state, { type: "replace_rows", rows: incomingRows });

  incomingRows.push(createRow({ id: "y", name: "Agregada despues" }));
  incomingRows[0].name = "Mutada despues";

  assert.equal(next.setupByDay.Lunes?.rows.length, 1, "una fila agregada al array original despues del despacho no debe aparecer");
  assert.equal(next.setupByDay.Lunes?.rows[0]?.name, "Original", "una fila del array original mutada despues del despacho no debe alterar el resultado");
}

// ==========================================================================================
// P3-21 — operaciones puras de fila: createRoutineBuilderRow, add_row, remove_row,
// update_row_field.
// ==========================================================================================

// CASO — createRoutineBuilderRow: fila vacía con ID explícito, defaults exactos de
// createSetupRow() en el root (name/sets/reps/weight), sin generar el id.
{
  const row = createRoutineBuilderRow("row-abc");
  assert.deepEqual(row, { id: "row-abc", name: "", sets: 0, reps: 0, weight: "" });
}

// CASO — createRoutineBuilderRow: cada llamada retorna una referencia independiente.
{
  const rowA = createRoutineBuilderRow("row-a");
  const rowB = createRoutineBuilderRow("row-a");
  assert.notEqual(rowA, rowB, "misma entrada produce objetos distintos, no compartidos");
  assert.deepEqual(rowA, rowB);
}

// CASO — createRoutineBuilderRow: rechaza un id vacío (SetupExerciseRow.id exige un
// identificador real); no genera uno automáticamente.
{
  assert.throws(() => createRoutineBuilderRow(""), "un id vacio debe ser rechazado, no generado");
}

// CASO — add_row: agrega al final de las filas existentes del día activo, preservando
// routineName y las filas previas; clona la fila entrante (no comparte referencia).
{
  const existingRows = [createRow({ id: "existente" })];
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: existingRows } }, activeDay: "Lunes" });
  const incomingRow = createRoutineBuilderRow("nueva");
  const next = routineBuilderReducer(state, { type: "add_row", row: incomingRow });

  assert.equal(next.setupByDay.Lunes?.rows.length, 2, "la fila se agrega, no reemplaza");
  assert.equal(next.setupByDay.Lunes?.rows[0], state.setupByDay.Lunes?.rows[0], "la fila existente se preserva por referencia");
  assert.deepEqual(next.setupByDay.Lunes?.rows[1], incomingRow, "la fila nueva queda al final (orden append)");
  assert.notEqual(next.setupByDay.Lunes?.rows[1], incomingRow, "la fila resultante no comparte referencia con action.row");
  assert.equal(next.setupByDay.Lunes?.routineName, "Empuje", "add_row no toca el nombre de la rutina");
  assert.equal(state.setupByDay.Lunes?.rows.length, 1, "el estado anterior no fue mutado");
}

// CASO — add_row sobre un día AÚN NO presente en setupByDay: crea el día con ÚNICAMENTE la
// fila solicitada (cero filas en blanco adicionales) — diverge deliberadamente de
// addSetupRow() en el root, que hoy produce 5 filas por un acoplamiento incidental con
// updateSetupDay (ver DECISIÓN P3-21 en el módulo).
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Viernes" });
  const next = routineBuilderReducer(state, { type: "add_row", row: createRoutineBuilderRow("primera") });
  assert.equal(next.setupByDay.Viernes?.rows.length, 1, "solo la fila solicitada, sin 4 filas en blanco adicionales");
  assert.equal(next.setupByDay.Viernes?.routineName, "");
}

// CASO — add_row: mutación externa posterior sobre action.row no debe alterar el resultado.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Lunes" });
  const incomingRow = createRoutineBuilderRow("x");
  const next = routineBuilderReducer(state, { type: "add_row", row: incomingRow });
  incomingRow.name = "Mutado despues";
  incomingRow.sets = 99;
  assert.equal(next.setupByDay.Lunes?.rows[0]?.name, "", "el contenido de la fila no debe cambiar por mutacion externa posterior");
  assert.equal(next.setupByDay.Lunes?.rows[0]?.sets, 0);
}

// CASO — remove_row: con dos filas y allowEmptyRows: false, elimina la indicada
// (independientemente de la política, porque queda al menos una fila).
{
  const state = createRoutineBuilderState({
    setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a" }), createRow({ id: "b", name: "Press banca" })] } },
    activeDay: "Lunes",
  });
  const next = routineBuilderReducer(state, { type: "remove_row", rowId: "a", allowEmptyRows: false });
  assert.equal(next.setupByDay.Lunes?.rows.length, 1);
  assert.equal(next.setupByDay.Lunes?.rows[0]?.id, "b");
  assert.equal(next.setupByDay.Lunes?.routineName, "Empuje");
}

// CASO — remove_row: con dos filas y allowEmptyRows: true, también elimina la indicada
// (la política solo importa cuando eliminar dejaría el día sin filas).
{
  const state = createRoutineBuilderState({
    setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a" }), createRow({ id: "b", name: "Press banca" })] } },
    activeDay: "Lunes",
  });
  const next = routineBuilderReducer(state, { type: "remove_row", rowId: "a", allowEmptyRows: true });
  assert.equal(next.setupByDay.Lunes?.rows.length, 1);
  assert.equal(next.setupByDay.Lunes?.rows[0]?.id, "b");
}

// CASO — remove_row: eliminar la ÚNICA fila con allowEmptyRows: false es no-op — misma
// referencia de estado, la fila se conserva intacta, ningún nivel se muta (política legacy).
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "unica" })] } }, activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "remove_row", rowId: "unica", allowEmptyRows: false });
  assert.equal(next, state, "allowEmptyRows: false sobre la ultima fila no debe producir una referencia nueva");
  assert.equal(next.setupByDay.Lunes?.rows.length, 1, "la fila se conserva");
  assert.equal(next.setupByDay.Lunes?.rows[0]?.id, "unica");
}

// CASO — remove_row: eliminar la ÚNICA fila con allowEmptyRows: true SÍ elimina y produce
// rows: [] (política cycle-scoped, ya resuelta por el caller antes de despachar).
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "unica" })] } }, activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "remove_row", rowId: "unica", allowEmptyRows: true });
  assert.notEqual(next, state, "allowEmptyRows: true sobre la ultima fila si debe producir una referencia nueva");
  assert.deepEqual(next.setupByDay.Lunes?.rows, [], "allowEmptyRows: true permite dejar rows: []");
}

// CASO — remove_row con un id inexistente: misma referencia de estado, no crea el día
// ausente, sin importar allowEmptyRows (no se consulta para producir efectos).
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a" })] } }, activeDay: "Lunes" });
  const nextFalse = routineBuilderReducer(state, { type: "remove_row", rowId: "no-existe", allowEmptyRows: false });
  const nextTrue = routineBuilderReducer(state, { type: "remove_row", rowId: "no-existe", allowEmptyRows: true });
  assert.equal(nextFalse, state, "un id inexistente no debe producir una referencia nueva (allowEmptyRows: false)");
  assert.equal(nextTrue, state, "un id inexistente no debe producir una referencia nueva (allowEmptyRows: true)");
}

// CASO — remove_row sobre un día AUSENTE del mapa: id inexistente por definición (el día no
// tiene filas) => no-op, y el día ausente NO se crea en el estado resultante.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Miércoles" });
  const next = routineBuilderReducer(state, { type: "remove_row", rowId: "cualquiera", allowEmptyRows: false });
  assert.equal(next, state, "un dia ausente no debe producir una referencia nueva");
  assert.equal(next.setupByDay["Miércoles"], undefined, "el dia ausente no debe crearse");
}

// CASO — allowEmptyRows es obligatorio en el tipo (sin campo opcional, sin default implícito):
// TypeScript rechaza en tiempo de compilación un remove_row sin allowEmptyRows — el propio
// archivo de test no compilaría si algún despacho lo omitiera. No hay aserción runtime posible
// para "obligatoriedad de tipo"; esto se demuestra por la existencia misma de este archivo
// compilando con `field: "allowEmptyRows"` presente en TODOS los despachos de remove_row.

// CASO — cierre de LOW L2: add_row conserva otro día mediante la misma referencia.
{
  const otherDayState: SetupDayState = { routineName: "Piernas", rows: [createRow({ id: "otro-dia-fila" })] };
  const state = createRoutineBuilderState({
    setupByDay: { Lunes: { routineName: "Empuje", rows: [] }, Martes: otherDayState },
    activeDay: "Lunes",
  });
  const next = routineBuilderReducer(state, { type: "add_row", row: createRoutineBuilderRow("nueva") });
  assert.equal(next.setupByDay.Martes, state.setupByDay.Martes, "otro dia no debe tocarse ni siquiera por referencia tras add_row");
}

// CASO — cierre de LOW L2: remove_row conserva otro día mediante la misma referencia.
{
  const otherDayState: SetupDayState = { routineName: "Piernas", rows: [createRow({ id: "otro-dia-fila" })] };
  const state = createRoutineBuilderState({
    setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a" }), createRow({ id: "b" })] }, Martes: otherDayState },
    activeDay: "Lunes",
  });
  const next = routineBuilderReducer(state, { type: "remove_row", rowId: "a", allowEmptyRows: false });
  assert.equal(next.setupByDay.Martes, state.setupByDay.Martes, "otro dia no debe tocarse ni siquiera por referencia tras remove_row");
}

// CASO — update_row_field: actualiza name/sets/reps/weight de la fila cuyo id coincide,
// preservando id/sourceExerciseId/exerciseLineageId y los campos no editados.
{
  const targetRow = createRow({ id: "target", sourceExerciseId: "src-1", exerciseLineageId: "lin-1" });
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [targetRow] } }, activeDay: "Lunes" });

  const afterName = routineBuilderReducer(state, { type: "update_row_field", rowId: "target", update: { field: "name", value: "Peso muerto" } });
  assert.equal(afterName.setupByDay.Lunes?.rows[0]?.name, "Peso muerto");
  assert.equal(afterName.setupByDay.Lunes?.rows[0]?.sourceExerciseId, "src-1", "sourceExerciseId se preserva");
  assert.equal(afterName.setupByDay.Lunes?.rows[0]?.exerciseLineageId, "lin-1", "exerciseLineageId se preserva");
  assert.equal(afterName.setupByDay.Lunes?.rows[0]?.id, "target", "id se preserva");
  assert.equal(afterName.setupByDay.Lunes?.rows[0]?.sets, targetRow.sets, "campos no editados se preservan");

  const afterSets = routineBuilderReducer(state, { type: "update_row_field", rowId: "target", update: { field: "sets", value: 5 } });
  assert.equal(afterSets.setupByDay.Lunes?.rows[0]?.sets, 5);

  const afterReps = routineBuilderReducer(state, { type: "update_row_field", rowId: "target", update: { field: "reps", value: 12 } });
  assert.equal(afterReps.setupByDay.Lunes?.rows[0]?.reps, 12);

  const afterWeight = routineBuilderReducer(state, { type: "update_row_field", rowId: "target", update: { field: "weight", value: "82.5" } });
  assert.equal(afterWeight.setupByDay.Lunes?.rows[0]?.weight, "82.5");
}

// CASO — update_row_field con un id inexistente: no-op, misma referencia de estado.
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a" })] } }, activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "update_row_field", rowId: "no-existe", update: { field: "name", value: "x" } });
  assert.equal(next, state, "un id inexistente no debe producir una referencia nueva");
}

// CASO — update_row_field con exactamente el mismo valor: no-op, misma referencia de estado.
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a", name: "Sentadilla" })] } }, activeDay: "Lunes" });
  const next = routineBuilderReducer(state, { type: "update_row_field", rowId: "a", update: { field: "name", value: "Sentadilla" } });
  assert.equal(next, state, "el mismo valor no debe producir una referencia nueva");
}

// CASO — update_row_field: preserva el resto de filas del día (por referencia) y otros días
// intactos.
{
  const otherRow = createRow({ id: "otra", name: "Press banca" });
  const state = createRoutineBuilderState({
    setupByDay: {
      Lunes: { routineName: "Empuje", rows: [createRow({ id: "target" }), otherRow] },
      Martes: { routineName: "Piernas", rows: [] },
    },
    activeDay: "Lunes",
  });
  const next = routineBuilderReducer(state, { type: "update_row_field", rowId: "target", update: { field: "sets", value: 8 } });
  assert.equal(next.setupByDay.Lunes?.rows[1], state.setupByDay.Lunes?.rows[1], "la fila no editada se preserva por referencia");
  assert.equal(next.setupByDay.Martes, state.setupByDay.Martes, "otro dia no debe tocarse ni siquiera por referencia");
}

// CASO — operaciones de fila: el estado anterior nunca se muta.
{
  const rows = [createRow({ id: "a" })];
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows } }, activeDay: "Lunes" });
  const snapshotBefore = JSON.parse(JSON.stringify(state));
  routineBuilderReducer(state, { type: "add_row", row: createRoutineBuilderRow("b") });
  routineBuilderReducer(state, { type: "remove_row", rowId: "a", allowEmptyRows: true });
  routineBuilderReducer(state, { type: "update_row_field", rowId: "a", update: { field: "name", value: "Otro" } });
  assert.deepEqual(state, snapshotBefore, "el estado original no debe mutar tras ninguna operacion de fila");
}

// CASO — determinismo de las operaciones de fila: misma entrada produce el mismo contenido,
// cada invocación retorna su propia referencia.
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow({ id: "a" })] } }, activeDay: "Lunes" });
  const action: RoutineBuilderAction = { type: "update_row_field", rowId: "a", update: { field: "sets", value: 6 } };
  const resultA = routineBuilderReducer(state, action);
  const resultB = routineBuilderReducer(state, action);
  assert.deepEqual(resultA, resultB);
  assert.notEqual(resultA, resultB);
}

// CASO — acción exhaustiva: add_row/remove_row/update_row_field SÍ son reconocidas ahora
// (no lanzan), a diferencia de set_message/set_busy (eliminadas, ver arriba).
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Lunes" });
  assert.doesNotThrow(() => routineBuilderReducer(state, { type: "add_row", row: createRoutineBuilderRow("z") }));
  assert.doesNotThrow(() => routineBuilderReducer(state, { type: "remove_row", rowId: "no-existe", allowEmptyRows: false }));
  assert.doesNotThrow(() => routineBuilderReducer(state, { type: "update_row_field", rowId: "no-existe", update: { field: "name", value: "x" } }));
}

// CASO — reset_state: espeja el reset "en blanco" del root (startNewTrainingCycle /
// deleteCurrentTrainingCycle), requiere setupByDay preparado, clonándolo; NO toca mensajes ni
// busy globales (ya no forman parte de este estado); no corresponde a cancelRoutineUpdate (esa
// reconstrucción desde ejercicios reales permanece en P3-23/P3-26).
{
  const dirtyState: RoutineBuilderState = {
    activeDay: "Viernes",
    setupByDay: { Viernes: { routineName: "Sucio", rows: [createRow()] } },
  };
  const freshSetupByDay: Record<string, SetupDayState> = { Lunes: { routineName: "", rows: [] } };
  const next = routineBuilderReducer(dirtyState, { type: "reset_state", setupByDay: freshSetupByDay });
  assert.equal(next.activeDay, TRAINING_DAY_LABELS[0]);
  assert.deepEqual(next.setupByDay, freshSetupByDay);
  assert.notEqual(next.setupByDay, freshSetupByDay, "reset_state clona el setupByDay entregado");
  assert.deepEqual(Object.keys(next).sort(), ["activeDay", "setupByDay"], "reset_state no reintroduce message/isBusy");
}

// CASO — reset_state acepta un activeDay explícito en lugar del default canónico.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Viernes" });
  const next = routineBuilderReducer(state, { type: "reset_state", setupByDay: {}, activeDay: "Martes" });
  assert.equal(next.activeDay, "Martes");
}

// CASO — reset_state: mutación externa posterior al setupByDay entregado no altera el estado ya
// producido.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Lunes" });
  const freshSetupByDay: Record<string, SetupDayState> = { Lunes: { routineName: "", rows: [] } };
  const next = routineBuilderReducer(state, { type: "reset_state", setupByDay: freshSetupByDay });
  freshSetupByDay.Lunes.routineName = "Mutado despues del reset";
  freshSetupByDay.Martes = { routineName: "Intruso", rows: [] };
  assert.equal(next.setupByDay.Lunes?.routineName, "", "el reset no debe verse afectado por mutacion externa posterior");
  assert.equal(next.setupByDay.Martes, undefined);
}

// CASO — replace_state: reemplaza el estado completo, clonando profundamente setupByDay (cada
// día y sus filas) — no actúa como normalizador, no lee storage.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Lunes" });
  const externalState: RoutineBuilderState = {
    activeDay: "Jueves",
    setupByDay: { Jueves: { routineName: "Pull", rows: [createRow()] } },
  };
  const next = routineBuilderReducer(state, { type: "replace_state", state: externalState });

  assert.deepEqual(next, externalState, "el contenido coincide con el estado externo");
  assert.notEqual(next, externalState, "el objeto de estado resultante no es la misma referencia");
  assert.notEqual(next.setupByDay, externalState.setupByDay, "setupByDay clonado, no compartido");
  assert.notEqual(next.setupByDay.Jueves, externalState.setupByDay.Jueves, "cada SetupDayState clonado, no compartido");
  assert.notEqual(next.setupByDay.Jueves?.rows, externalState.setupByDay.Jueves.rows, "rows clonado, no compartido");
  assert.notEqual(next.setupByDay.Jueves?.rows[0], externalState.setupByDay.Jueves.rows[0], "cada fila clonada, no compartida");
}

// CASO — replace_state: mutación externa posterior sobre action.state.setupByDay, un
// SetupDayState, sus rows y una fila no debe alterar el estado ya producido.
{
  const state = createRoutineBuilderState({ setupByDay: {}, activeDay: "Lunes" });
  const externalState: RoutineBuilderState = {
    activeDay: "Jueves",
    setupByDay: { Jueves: { routineName: "Pull", rows: [createRow({ id: "solo" })] } },
  };
  const next = routineBuilderReducer(state, { type: "replace_state", state: externalState });

  externalState.setupByDay.Viernes = { routineName: "Intruso", rows: [] };
  externalState.setupByDay.Jueves.routineName = "Mutado despues";
  externalState.setupByDay.Jueves.rows.push(createRow({ id: "agregada-despues" }));
  externalState.setupByDay.Jueves.rows[0].name = "Nombre mutado despues";

  assert.equal(next.setupByDay.Viernes, undefined, "un dia agregado externamente despues no debe aparecer");
  assert.equal(next.setupByDay.Jueves?.routineName, "Pull", "el nombre no debe cambiar por mutacion externa posterior");
  assert.equal(next.setupByDay.Jueves?.rows.length, 1, "una fila agregada despues no debe aparecer");
  assert.equal(next.setupByDay.Jueves?.rows[0]?.name, "Sentadilla", "el contenido de una fila no debe cambiar por mutacion externa posterior");
}

// CASO — acción exhaustiva: una acción con `type` desconocido lanza, no se ignora en silencio.
// Incluye explícitamente las acciones eliminadas (set_message/set_busy), que ahora son
// desconocidas para el reducer.
{
  const state = createRoutineBuilderState({ setupByDay: {} });
  assert.throws(() => {
    routineBuilderReducer(state, { type: "unknown_action" } as unknown as RoutineBuilderAction);
  });
  assert.throws(() => {
    routineBuilderReducer(state, { type: "set_message", message: "x" } as unknown as RoutineBuilderAction);
  }, "set_message ya no es una accion reconocida");
  assert.throws(() => {
    routineBuilderReducer(state, { type: "set_busy", isBusy: true } as unknown as RoutineBuilderAction);
  }, "set_busy ya no es una accion reconocida");
}

// CASO — el estado anterior nunca se muta, sin importar la acción (incluye rows).
{
  const rows = [createRow()];
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows } }, activeDay: "Lunes" });
  const snapshotBefore = JSON.parse(JSON.stringify(state));
  routineBuilderReducer(state, { type: "select_day", day: "Martes" });
  routineBuilderReducer(state, { type: "set_routine_name", routineName: "Otro" });
  routineBuilderReducer(state, { type: "replace_rows", rows: [createRow({ id: "z" })] });
  routineBuilderReducer(state, { type: "reset_state", setupByDay: {} });
  routineBuilderReducer(state, { type: "replace_state", state: createRoutineBuilderState({ setupByDay: {} }) });
  assert.deepEqual(state, snapshotBefore, "el estado original no debe mutar tras ninguna accion");
}

// CASO — determinismo: misma entrada produce siempre el mismo contenido, y cada invocación
// retorna su propia referencia nueva (outputs independientes, sin cache).
{
  const state = createRoutineBuilderState({ setupByDay: { Lunes: { routineName: "Empuje", rows: [createRow()] } }, activeDay: "Lunes" });
  const action: RoutineBuilderAction = { type: "set_routine_name", routineName: "Piernas" };
  const resultA = routineBuilderReducer(state, action);
  const resultB = routineBuilderReducer(state, action);
  assert.deepEqual(resultA, resultB);
  assert.notEqual(resultA, resultB, "cada invocacion produce su propia referencia nueva de estado (no cachea)");
  assert.notEqual(resultA.setupByDay, resultB.setupByDay, "cada invocacion produce su propio setupByDay nuevo (no cachea)");
}

// CASO — pureza de imports: sin React, hooks, componentes, infraestructura ni dominio de fases
// posteriores. SetupExerciseRow/SetupDayState se importan como type desde su fuente canonica,
// sin redefinirse. Sin JSON.stringify/parse ni structuredClone como mecanismo de clonado.
{
  const modelSource = readFileSync("src/features/routine-builder/model/routine-builder-state.ts", "utf8");
  const code = modelSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(modelSource, /import type \{ SetupDayState, SetupExerciseRow \} from "@\/lib\/training\/training-routine-draft";/);
  assert.doesNotMatch(code, /interface SetupExerciseRow\b|interface SetupDayState\b/, "no debe redefinir los tipos canonicos");
  for (const forbidden of [
    /from ["']react["']/, /\buseState\b/, /\buseEffect\b/, /\buseReducer\b/, /\buseMemo\b/, /\buseCallback\b/,
    /from ["']@\/components\/organizatech-app["']/,
    /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
    /\bsetScreen\b/, /\bsetScreenHistory\b/,
    /training-plan-rules/, /training-plan-normalization/,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
    /\bsetTimeout\b/, /\bsetInterval\b/,
    /-repository["']/,
    /\bfeatureFlags?\b/i,
    /JSON\.parse\(\s*JSON\.stringify/, // clonado via serializacion (round-trip), no confundir con JSON.stringify de un mensaje de error
    /\bstructuredClone\b/,
  ]) {
    assert.doesNotMatch(code, forbidden, `el modulo no debe contener ${forbidden}`);
  }
  // Ausencia de generación no determinista: ni Date.now ni Math.random en el modelo puro.
  assert.doesNotMatch(code, /Date\.now\(\)|Math\.random\(\)/, "el modelo no debe generar tiempo ni aleatoriedad");
}

// CASO — el shape final del estado no declara message/isBusy en su interfaz.
{
  const modelSource = readFileSync("src/features/routine-builder/model/routine-builder-state.ts", "utf8");
  const stateInterface = modelSource.slice(
    modelSource.indexOf("export interface RoutineBuilderState {"),
    modelSource.indexOf("}", modelSource.indexOf("export interface RoutineBuilderState {")),
  );
  assert.doesNotMatch(stateInterface, /\bmessage\b/, "RoutineBuilderState no debe declarar message");
  assert.doesNotMatch(stateInterface, /\bisBusy\b/, "RoutineBuilderState no debe declarar isBusy");
  assert.match(stateInterface, /activeDay: string;/);
  assert.match(stateInterface, /setupByDay: Record<string, SetupDayState>;/);
}

// CASO — fronteras P3-22 a P3-26: el módulo YA implementa add/remove/update de fila (P3-21),
// pero sigue sin generar IDs (createId/crypto.randomUUID permanecen en el root), sin
// normalización legacy, sin mapping/dedupe/lineage, sin draft recovery, sin guardado, y sin
// reintroducir las acciones eliminadas set_message/set_busy. Tampoco reproduce el guard de
// minimo-de-filas ni el window.confirm de removeSetupRow (ver DECISIÓN P3-21 en el módulo).
{
  const modelSource = readFileSync("src/features/routine-builder/model/routine-builder-state.ts", "utf8");
  const code = modelSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const outOfScope of [
    /\badd_exercise\b/, /\bremove_exercise\b/, /\bupdate_exercise\b/, /\breorder_row\b/, /\bduplicate_row\b/,
    /\bconfigure_day\b/, /\bcomplete_day\b/, /\bvalidate_row\b/, /\bsave_day\b/,
    /\bcreateId\b/, /\bcrypto\.randomUUID\b/,
    /\bnormalizeSetupByDay\b/, /\bcreateSetupByDayFromExercises\b/,
    /\bdedupeExercisesByDayAndRoutine\b/, /\bexerciseLineageId\b.*resolve/i,
    /\bloadRoutineDraft\b/, /\bsaveRoutineDraft\b/, /\bclearRoutineDraft\b/,
    /\bsaveInitialRoutine\b/, /\bSyntheticEvent\b/,
    /\bwindow\.confirm\b/, /\bisCycleScopedEdit\b/, /\bisCycleScopedTrainingCycle\b/, /\bpersistedActiveCycle\b/,
    /"set_message"/, /"set_busy"/,
  ]) {
    assert.doesNotMatch(code, outOfScope, `el modulo no debe absorber responsabilidad de fases posteriores: ${outOfScope}`);
  }
}

console.log("routine-builder-state tests passed");
