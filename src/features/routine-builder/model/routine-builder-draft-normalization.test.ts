import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeRoutineBuilderDraftInput } from "@/features/routine-builder/model/routine-builder-draft-normalization";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";

/**
 * Pruebas de caracterización de la normalización pura de drafts legacy de Routine Builder
 * (P3-22). Sin React, sin DOM, sin storage. Cubren el `unknown` de entrada tal como podría
 * provenir de un draft persistido corrupto o de una versión anterior de la app, y el
 * `RoutineBuilderState` típado y siempre válido que produce — sin reproducir el algoritmo del
 * normalizador dentro de estas pruebas.
 */

function allDaysAreEmptyDefault(setupByDay: Record<string, { routineName: string; rows: unknown[] }>) {
  return TRAINING_DAY_LABELS.every((day) => {
    const state = setupByDay[day];
    return state !== undefined && state.routineName === "" && Array.isArray(state.rows) && state.rows.length === 0;
  });
}

// CASO — input completamente ausente/no-objeto: undefined, null, string, number, boolean.
for (const garbage of [undefined, null, "not an object", 42, true, Number.NaN]) {
  const result = normalizeRoutineBuilderDraftInput(garbage);
  assert.equal(result.fallbackApplied, true, `fallbackApplied debe ser true para ${JSON.stringify(garbage)}`);
  assert.equal(result.state.activeDay, TRAINING_DAY_LABELS[0]);
  assert.ok(allDaysAreEmptyDefault(result.state.setupByDay), "todos los dias deben quedar en el default vacio");
  assert.equal(result.discardedRowCount, 0);
}

// CASO — array de nivel superior: se rechaza explicitamente (no "funciona por casualidad").
{
  const result = normalizeRoutineBuilderDraftInput(["Lunes", { rows: [] }]);
  assert.equal(result.fallbackApplied, true, "un array de nivel superior no es un objeto plano");
  assert.ok(allDaysAreEmptyDefault(result.state.setupByDay));
}

// CASO — objeto vacio: no es "fallback" (es un objeto plano valido), pero produce el mismo
// contenido por defecto porque no trae setupDay ni setupByDay.
{
  const result = normalizeRoutineBuilderDraftInput({});
  assert.equal(result.fallbackApplied, false, "{} es un objeto plano, no se activa el fallback total");
  assert.equal(result.state.activeDay, TRAINING_DAY_LABELS[0]);
  assert.ok(allDaysAreEmptyDefault(result.state.setupByDay));
}

// CASO — draft valido completo: setupDay reconocido + setupByDay con una fila valida.
{
  const input = {
    setupDay: "Martes",
    setupByDay: {
      Martes: {
        routineName: "Empuje",
        rows: [
          { id: "row-1", name: "Press banca", sets: 4, reps: 8, weight: "60" },
        ],
      },
    },
  };
  const result = normalizeRoutineBuilderDraftInput(input);
  assert.equal(result.fallbackApplied, false);
  assert.equal(result.discardedRowCount, 0);
  assert.equal(result.state.activeDay, "Martes");
  assert.deepEqual(result.state.setupByDay.Martes, {
    routineName: "Empuje",
    rows: [{ id: "row-1", sourceExerciseId: undefined, exerciseLineageId: null, name: "Press banca", sets: 4, reps: 8, weight: "60" }],
  });
  assert.deepEqual(result.state.setupByDay.Lunes, { routineName: "", rows: [] }, "los demas dias quedan en su default vacio");
}

// CASO — draft ya "en forma de estado" (activeDay/setupByDay con los nombres del modelo puro):
// setupDay no reconocido en ese caso, por lo que activeDay cae al default; confirma que el
// normalizador lee especificamente la clave legacy `setupDay`, no `activeDay`.
{
  const result = normalizeRoutineBuilderDraftInput({ activeDay: "Martes", setupByDay: {} });
  assert.equal(result.state.activeDay, TRAINING_DAY_LABELS[0], "activeDay en el input no sustituye a setupDay");
}

// CASO — input no mutado / independencia del resultado respecto del input.
{
  const input = {
    setupDay: "Lunes",
    setupByDay: { Lunes: { routineName: "Empuje", rows: [{ id: "row-1", name: "Sentadilla", sets: 4, reps: 10, weight: "60" }] } },
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const result = normalizeRoutineBuilderDraftInput(input);
  assert.deepEqual(input, snapshot, "el input no debe mutarse");

  result.state.setupByDay.Lunes.rows[0].name = "Mutado";
  result.state.setupByDay.Lunes.routineName = "Mutado";
  assert.equal(input.setupByDay.Lunes.routineName, "Empuje", "mutar el resultado no debe afectar el input original");
  assert.equal(input.setupByDay.Lunes.rows[0].name, "Sentadilla");

  const secondCall = normalizeRoutineBuilderDraftInput(input);
  assert.equal(secondCall.state.setupByDay.Lunes.routineName, "Empuje", "una segunda normalizacion produce un resultado independiente del primero");
  assert.notEqual(secondCall.state.setupByDay.Lunes, result.state.setupByDay.Lunes, "cada llamada produce objetos nuevos");
}

// CASO — setupDay/activeDay: valido, invalido, ausente.
{
  assert.equal(normalizeRoutineBuilderDraftInput({ setupDay: "Domingo" }).state.activeDay, "Domingo");
  assert.equal(normalizeRoutineBuilderDraftInput({ setupDay: "Funday" }).state.activeDay, TRAINING_DAY_LABELS[0], "dia desconocido cae al default");
  assert.equal(normalizeRoutineBuilderDraftInput({ setupDay: 123 }).state.activeDay, TRAINING_DAY_LABELS[0], "setupDay no-string cae al default");
  assert.equal(normalizeRoutineBuilderDraftInput({}).state.activeDay, TRAINING_DAY_LABELS[0], "setupDay ausente cae al default");
}

// CASO — setupByDay vacio, y claves de dia desconocidas se ignoran silenciosamente.
{
  const result = normalizeRoutineBuilderDraftInput({ setupByDay: {} });
  assert.ok(allDaysAreEmptyDefault(result.state.setupByDay));

  const withUnknownDay = normalizeRoutineBuilderDraftInput({
    setupByDay: { Funday: { routineName: "Fantasma", rows: [{ id: "x", name: "y", sets: 1, reps: 1, weight: "1" }] } },
  });
  assert.ok(allDaysAreEmptyDefault(withUnknownDay.state.setupByDay), "una clave de dia ajena a TRAINING_DAY_LABELS nunca se lee");
}

// CASO — SetupDayState parcial: dia no-objeto, dia sin rows, rows no-array, routineName invalido.
{
  const notAnObject = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: "no soy un objeto" } });
  assert.deepEqual(notAnObject.state.setupByDay.Lunes, { routineName: "", rows: [] });

  const missingRows = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { routineName: "Solo nombre" } } });
  assert.deepEqual(missingRows.state.setupByDay.Lunes, { routineName: "Solo nombre", rows: [] });

  const rowsNotArray = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { routineName: "x", rows: "no soy array" } } });
  assert.deepEqual(rowsNotArray.state.setupByDay.Lunes, { routineName: "x", rows: [] });

  const invalidRoutineName = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { routineName: 123, rows: [] } } });
  assert.equal(invalidRoutineName.state.setupByDay.Lunes.routineName, "", "routineName no-string cae a cadena vacia");
}

// CASO — filas: null/undefined dentro de rows no explotan, se descartan y se cuentan.
{
  const result = normalizeRoutineBuilderDraftInput({
    setupByDay: {
      Lunes: {
        routineName: "x",
        rows: [null, undefined, "no soy objeto", 42, { id: "valida", name: "Sentadilla", sets: 1, reps: 1, weight: "1" }],
      },
    },
  });
  assert.equal(result.state.setupByDay.Lunes.rows.length, 1, "solo la fila valida sobrevive");
  assert.equal(result.state.setupByDay.Lunes.rows[0].id, "valida");
  assert.equal(result.discardedRowCount, 4, "las 4 entradas no-objeto se descartan y se cuentan");
}

// CASO — fila valida y fila parcial (solo name, sin el resto de los campos).
{
  const result = normalizeRoutineBuilderDraftInput({
    setupByDay: { Lunes: { routineName: "x", rows: [{ id: "row-1", name: "Sentadilla" }] } },
  });
  assert.deepEqual(result.state.setupByDay.Lunes.rows[0], {
    id: "row-1",
    sourceExerciseId: undefined,
    exerciseLineageId: null,
    name: "Sentadilla",
    sets: 0,
    reps: 0,
    weight: "0",
  });
  assert.equal(result.discardedRowCount, 0);
}

// CASO — id ausente o vacio: la fila se descarta por completo (nunca se genera un id nuevo).
{
  const missingId = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ name: "Sin id" }] } } });
  assert.equal(missingId.state.setupByDay.Lunes.rows.length, 0);
  assert.equal(missingId.discardedRowCount, 1);

  const emptyId = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "", name: "Id vacio" }] } } });
  assert.equal(emptyId.state.setupByDay.Lunes.rows.length, 0, "un id vacio tambien se descarta (no se preserva como en normalizeSetupByDay)");
  assert.equal(emptyId.discardedRowCount, 1);

  const nonStringId = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: 123, name: "Id numerico" }] } } });
  assert.equal(nonStringId.state.setupByDay.Lunes.rows.length, 0, "un id no-string se descarta, nunca se fabrica uno nuevo");
  assert.equal(nonStringId.discardedRowCount, 1);
}

// CASO — sourceExerciseId/exerciseLineageId: validos e invalidos, con sus defaults asimetricos
// preservados (undefined para sourceExerciseId, null para exerciseLineageId).
{
  const valid = normalizeRoutineBuilderDraftInput({
    setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sourceExerciseId: "src-1", exerciseLineageId: "lin-1" }] } },
  });
  assert.equal(valid.state.setupByDay.Lunes.rows[0].sourceExerciseId, "src-1");
  assert.equal(valid.state.setupByDay.Lunes.rows[0].exerciseLineageId, "lin-1");

  const invalid = normalizeRoutineBuilderDraftInput({
    setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sourceExerciseId: 123, exerciseLineageId: 456 }] } },
  });
  assert.equal(invalid.state.setupByDay.Lunes.rows[0].sourceExerciseId, undefined);
  assert.equal(invalid.state.setupByDay.Lunes.rows[0].exerciseLineageId, null);

  const explicitNull = normalizeRoutineBuilderDraftInput({
    setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", exerciseLineageId: null }] } },
  });
  assert.equal(explicitNull.state.setupByDay.Lunes.rows[0].exerciseLineageId, null);
}

// CASO — sets/reps: finitos validos, invalidos (no coercibles), no-finitos, negativos, y tipos
// peligrosos (booleano/array/objeto) que en produccion se cuelan via Number() sin guarda.
{
  const finite = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sets: "4", reps: 2.5 }] } } });
  assert.equal(finite.state.setupByDay.Lunes.rows[0].sets, 4, "una cadena numerica valida se coacciona a numero, igual que hoy");
  assert.equal(finite.state.setupByDay.Lunes.rows[0].reps, 2.5, "un valor fraccionario valido se preserva sin redondear");

  const invalidText = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sets: "abc", reps: undefined }] } } });
  assert.equal(invalidText.state.setupByDay.Lunes.rows[0].sets, 0);
  assert.equal(invalidText.state.setupByDay.Lunes.rows[0].reps, 0);

  const nonFinite = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sets: Number.POSITIVE_INFINITY, reps: Number.NaN }] } } });
  assert.equal(nonFinite.state.setupByDay.Lunes.rows[0].sets, 0, "Infinity se rechaza");
  assert.equal(nonFinite.state.setupByDay.Lunes.rows[0].reps, 0, "NaN se rechaza");

  const negative = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sets: -5, reps: -1 }] } } });
  assert.equal(negative.state.setupByDay.Lunes.rows[0].sets, 0, "un valor negativo se rechaza, a diferencia de normalizeSetupByDay hoy");
  assert.equal(negative.state.setupByDay.Lunes.rows[0].reps, 0);

  const dangerousCoercions = normalizeRoutineBuilderDraftInput({
    setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", sets: true, reps: [5] }] } },
  });
  assert.equal(dangerousCoercions.state.setupByDay.Lunes.rows[0].sets, 0, "un booleano no se coacciona via Number(true) === 1");
  assert.equal(dangerousCoercions.state.setupByDay.Lunes.rows[0].reps, 0, "un array no se coacciona via Number([5]) === 5");
}

// CASO — weight: string valida, numero legacy, invalida, y tipos peligrosos que hoy explotan
// (.trim is not a function) y que aqui deben degradar sin lanzar.
{
  const validString = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: "60,5" }] } } });
  assert.equal(validString.state.setupByDay.Lunes.rows[0].weight, "60,5");

  const legacyNumber = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: 40 }] } } });
  assert.equal(legacyNumber.state.setupByDay.Lunes.rows[0].weight, "40");

  const invalid = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: "no es un peso" }] } } });
  assert.equal(invalid.state.setupByDay.Lunes.rows[0].weight, "0");

  const missing = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x" }] } } });
  assert.equal(missing.state.setupByDay.Lunes.rows[0].weight, "0");

  assert.doesNotThrow(() => normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: true }] } } }));
  assert.doesNotThrow(() => normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: {} }] } } }));
  assert.doesNotThrow(() => normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: [1, 2] }] } } }));

  const booleanWeight = normalizeRoutineBuilderDraftInput({ setupByDay: { Lunes: { rows: [{ id: "r1", name: "x", weight: true }] } } });
  assert.equal(booleanWeight.state.setupByDay.Lunes.rows[0].weight, "0", "un weight booleano degrada al mismo valor que un weight ausente");
}

// CASO — determinismo: la misma entrada produce siempre el mismo resultado (por valor).
{
  const input = { setupDay: "Miércoles", setupByDay: { Miércoles: { routineName: "Piernas", rows: [{ id: "r1", name: "Sentadilla", sets: 4, reps: 10, weight: "80" }] } } };
  const first = normalizeRoutineBuilderDraftInput(input);
  const second = normalizeRoutineBuilderDraftInput(input);
  assert.deepEqual(first.state, second.state);
  assert.equal(first.fallbackApplied, second.fallbackApplied);
  assert.equal(first.discardedRowCount, second.discardedRowCount);
}

// CASO — fallbackApplied/discardedRowCount son la unica metadata de reparacion: no se inventan
// codigos de reparacion adicionales en el resultado.
{
  const result = normalizeRoutineBuilderDraftInput({ setupDay: "Lunes", setupByDay: {} });
  assert.deepEqual(Object.keys(result).sort(), ["discardedRowCount", "fallbackApplied", "state"]);
}

// CASO — el modulo nunca genera IDs: ni createId ni crypto.randomUUID aparecen en su fuente.
{
  const source = readFileSync("src/features/routine-builder/model/routine-builder-draft-normalization.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bcreateId\b/);
  assert.doesNotMatch(code, /\bcrypto\.randomUUID\b/);
  assert.doesNotMatch(code, /Date\.now\(\)|Math\.random\(\)/, "el modelo no debe generar tiempo ni aleatoriedad");
}

// CASO — pureza y fronteras P3-23 a P3-26: sin React, sin storage, sin mapping/dedupe/lineage
// real, sin integracion en el root, sin clonado via serializacion.
{
  const source = readFileSync("src/features/routine-builder/model/routine-builder-draft-normalization.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const outOfScope of [
    /from ["']react["']/, /\buseState\b/, /\buseEffect\b/, /\buseReducer\b/,
    /from ["']@\/components\/organizatech-app["']/,
    /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
    /\bsetTimeout\b/, /\bsetInterval\b/,
    /\bloadRoutineDraft\b/, /\bsaveRoutineDraft\b/, /\bclearRoutineDraft\b/,
    /\bcreateSetupByDayFromExercises\b/, /\bdedupeExercisesByDayAndRoutine\b/,
    /\bexerciseLineageId\b.*resolve/i,
    /\bnormalizeSetupByDay\b/, /\bnormalizeTrainingPlan\b/,
    /\bsaveInitialRoutine\b/, /\bSyntheticEvent\b/,
    /\bwindow\.confirm\b/, /\bisCycleScopedEdit\b/, /\bisCycleScopedTrainingCycle\b/, /\bpersistedActiveCycle\b/,
    /JSON\.parse\(\s*JSON\.stringify/,
    /\bstructuredClone\b/,
  ]) {
    assert.doesNotMatch(code, outOfScope, `el modulo no debe absorber responsabilidad de fases posteriores: ${outOfScope}`);
  }
}

console.log("routine-builder-draft-normalization tests passed");
