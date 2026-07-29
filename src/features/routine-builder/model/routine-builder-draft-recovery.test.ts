import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveRoutineBuilderDraftRecovery,
  type RoutineBuilderDraftDiscardReason,
} from "@/features/routine-builder/model/routine-builder-draft-recovery";

/**
 * Pruebas de caracterización de la decisión pura de recuperación de drafts de Routine Builder
 * (P3-24A, corregida en P3-24A.1 tras auditoría — MEDIUM M1: una fila placeholder cuyo unico
 * valor normalizado es `weight: "0"` ya no se clasifica como avance recuperable). Sin React, sin
 * DOM, sin storage. Cubren el `unknown` de entrada tal como lo consume
 * `normalizeRoutineBuilderDraftInput` (P3-22), y el resultado discriminado `restore`/`discard`
 * que produce — sin reproducir el algoritmo de normalización ni el chequeo de contenido
 * significativo dentro de estas pruebas.
 */

function validRow(overrides: Record<string, unknown> = {}) {
  return { id: "row-1", name: "Sentadilla", sets: 4, reps: 10, weight: "60", ...overrides };
}

function placeholderRow(id: string, overrides: Record<string, unknown> = {}) {
  return { id, name: "", sets: 0, reps: 0, weight: "", ...overrides };
}

// CASO 12 — input completamente ausente/no-objeto: undefined, null, string, number, boolean, array.
for (const garbage of [undefined, null, "not an object", 42, true, [1, 2, 3]]) {
  const result = resolveRoutineBuilderDraftRecovery(garbage);
  assert.equal(result.kind, "discard", `debe descartar para ${JSON.stringify(garbage)}`);
  if (result.kind === "discard") {
    assert.equal(result.reason, "invalid_top_level_input");
    assert.equal(result.shouldClearStoredDraft, true);
  }
}

// CASO 11 — objeto vacio: input valido a nivel de objeto, pero sin ninguna fila ni routineName.
{
  const result = resolveRoutineBuilderDraftRecovery({});
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") {
    assert.equal(result.reason, "no_recoverable_content", "un objeto vacio no tiene filas sobrevivientes ni descartadas");
    assert.equal(result.shouldClearStoredDraft, true);
  }
}

// CASO 1/2 — una fila placeholder (name "", sets 0, reps 0, weight "" -> normaliza a "0"):
// discard / placeholder_only_content, NO recuperacion completa. Este es exactamente el hallazgo
// MEDIUM M1 de la auditoria: antes de la correccion, esta fila se clasificaba como "full" porque
// el string "0" es truthy.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1")] } },
  });
  assert.equal(result.kind, "discard", "una fila unicamente placeholder no debe restaurarse como avance real");
  if (result.kind === "discard") {
    assert.equal(result.reason, "placeholder_only_content");
    assert.equal(result.shouldClearStoredDraft, true);
  }
}

// CASO 3 — weight "0,0" (coma decimal) tras normalizacion tambien es cero: mismo resultado.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1", { weight: "0,0" })] } },
  });
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") assert.equal(result.reason, "placeholder_only_content");
}

// CASO 4 — weight "0.0" (punto decimal) tambien es cero: mismo resultado.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1", { weight: "0.0" })] } },
  });
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") assert.equal(result.reason, "placeholder_only_content");
}

// CASO 5 — weight positivo sin name: contenido recuperable (se interpreta el valor numerico del
// peso con el parser decimal canonico, no la longitud del string).
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1", { weight: "12,5" })] } },
  });
  assert.equal(result.kind, "restore");
  if (result.kind === "restore") assert.equal(result.recovery.kind, "full");
}

// CASO 6 — name no vacio con weight "0": contenido recuperable via name, independiente del peso.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1", { name: "Sentadilla" })] } },
  });
  assert.equal(result.kind, "restore");
  if (result.kind === "restore") assert.equal(result.recovery.kind, "full");
}

// CASO 7 — sets o reps positivos con weight "0": contenido recuperable via sets/reps.
{
  const bySets = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1", { sets: 3 })] } },
  });
  assert.equal(bySets.kind, "restore");
  if (bySets.kind === "restore") assert.equal(bySets.recovery.kind, "full");

  const byReps = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [placeholderRow("r1", { reps: 5 })] } },
  });
  assert.equal(byReps.kind, "restore");
  if (byReps.kind === "restore") assert.equal(byReps.recovery.kind, "full");
}

// CASO 8 — routineName no vacio sin filas: contenido recuperable por si solo.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { routineName: "Piernas", rows: [] } },
  });
  assert.equal(result.kind, "restore");
  if (result.kind === "restore") assert.equal(result.recovery.kind, "full", "routineName por si solo constituye contenido recuperable");
}

// CASO 9 — una fila invalida descartada (sin id) + un placeholder sobreviviente (sin contenido
// significativo): discard / all_recoverable_rows_discarded — tiene precedencia sobre
// placeholder_only_content porque hubo filas efectivamente descartadas por corrupcion.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [{ name: "Sin id, se descarta" }, placeholderRow("r1")] } },
  });
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") {
    assert.equal(result.reason, "all_recoverable_rows_discarded", "hubo un descarte real; tiene precedencia sobre placeholder_only_content");
    assert.equal(result.shouldClearStoredDraft, true);
  }
}

// CASO 10 — una fila invalida descartada + una fila significativa: recuperacion parcial con
// contador exacto.
{
  const input = {
    setupByDay: {
      Lunes: {
        routineName: "Empuje",
        rows: [{ name: "Sin id, se descarta" }, validRow({ id: "r-valida" })],
      },
    },
  };
  const result = resolveRoutineBuilderDraftRecovery(input);
  assert.equal(result.kind, "restore");
  if (result.kind === "restore") {
    assert.equal(result.recovery.kind, "partial", "hubo una fila descartada, nunca debe clasificarse full");
    if (result.recovery.kind === "partial") {
      assert.equal(result.recovery.code, "routine_draft_partially_recovered");
      assert.equal(result.recovery.discardedRowCount, 1, "discardedRowCount es obligatorio y refleja exactamente lo descartado");
    }
    assert.equal(result.state.setupByDay.Lunes.rows.length, 1);
    assert.equal(result.state.setupByDay.Lunes.rows[0].id, "r-valida");
  }
}

// CASO 13 — partial nunca se clasifica full, incluso con multiples dias y filas descartadas.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: {
      Lunes: { rows: [{ name: "invalida-1" }, validRow({ id: "r1" })] },
      Martes: { rows: [{ name: "invalida-2" }, validRow({ id: "r2" })] },
    },
  });
  assert.equal(result.kind, "restore");
  if (result.kind === "restore") {
    assert.notEqual(result.recovery.kind, "full");
    assert.equal(result.recovery.kind, "partial");
    if (result.recovery.kind === "partial") assert.equal(result.recovery.discardedRowCount, 2);
  }
}

// CASO 14 — placeholder-only nunca se restaura, ni siquiera con multiples dias/filas placeholder.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: {
      Lunes: { rows: [placeholderRow("r1"), placeholderRow("r2", { weight: "0,00" })] },
      Martes: { routineName: "", rows: [placeholderRow("r3")] },
    },
  });
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") assert.equal(result.reason, "placeholder_only_content");
}

// CASO — todas las filas recuperables fueron descartadas (ninguna sobrevive) y no queda ningun
// otro contenido: discard / all_recoverable_rows_discarded, distinto de no_recoverable_content.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { rows: [{ name: "sin id 1" }, { name: "sin id 2" }, null, 42] } },
  });
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") {
    assert.equal(result.reason, "all_recoverable_rows_discarded");
    assert.equal(result.shouldClearStoredDraft, true);
  }
}

// CASO — estado bien formado pero sin ninguna fila (ni descartada ni sobreviviente) y sin
// routineName: discard / no_recoverable_content, distinto del caso anterior y del placeholder.
{
  const result = resolveRoutineBuilderDraftRecovery({
    setupByDay: { Lunes: { routineName: "", rows: [] }, Martes: { rows: "no es un array" } },
  });
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") {
    assert.equal(result.reason, "no_recoverable_content", "ningun dia tiene filas ni routineName, y nada se descarto");
  }
}

// CASO — fallbackApplied (input no es un objeto plano) siempre descarta con invalid_top_level_input.
{
  const result = resolveRoutineBuilderDraftRecovery(["Lunes", { routineName: "Empuje" }]);
  assert.equal(result.kind, "discard");
  if (result.kind === "discard") assert.equal(result.reason, "invalid_top_level_input");
}

// CASO — input no mutado / state independiente del input.
{
  const input = {
    setupDay: "Lunes",
    setupByDay: { Lunes: { routineName: "Empuje", rows: [validRow()] } },
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const result = resolveRoutineBuilderDraftRecovery(input);
  assert.deepEqual(input, snapshot, "el input no debe mutarse");

  if (result.kind === "restore") {
    result.state.setupByDay.Lunes.routineName = "Mutado";
    assert.equal(input.setupByDay.Lunes.routineName, "Empuje", "mutar el resultado no debe afectar el input original");
  }

  const second = resolveRoutineBuilderDraftRecovery(input);
  if (second.kind === "restore" && result.kind === "restore") {
    assert.notEqual(second.state.setupByDay.Lunes, result.state.setupByDay.Lunes, "cada llamada produce objetos nuevos");
    assert.equal(second.state.setupByDay.Lunes.routineName, "Empuje", "una segunda llamada es independiente de mutaciones sobre el resultado anterior");
  }
}

// CASO — determinismo: la misma entrada produce siempre el mismo resultado (por valor).
{
  const input = {
    setupDay: "Miércoles",
    setupByDay: { Miércoles: { routineName: "Piernas", rows: [{ name: "sin id" }, validRow({ id: "r1" })] } },
  };
  const first = resolveRoutineBuilderDraftRecovery(input);
  const secondCall = resolveRoutineBuilderDraftRecovery(input);
  assert.deepEqual(first, secondCall);
}

// CASO — resultado discriminado exhaustivo: los unicos kinds de nivel superior son
// "restore"/"discard", y dentro de restore, "full"/"partial".
{
  function describe(result: ReturnType<typeof resolveRoutineBuilderDraftRecovery>): string {
    switch (result.kind) {
      case "discard":
        return `discard:${result.reason}`;
      case "restore":
        switch (result.recovery.kind) {
          case "full":
            return "restore:full";
          case "partial":
            return `restore:partial:${result.recovery.discardedRowCount}`;
          default: {
            const exhaustiveCheck: never = result.recovery;
            throw new Error(`recovery no reconocida: ${JSON.stringify(exhaustiveCheck)}`);
          }
        }
      default: {
        const exhaustiveCheck: never = result;
        throw new Error(`resultado no reconocido: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
  assert.equal(describe(resolveRoutineBuilderDraftRecovery(undefined)), "discard:invalid_top_level_input");
  assert.equal(describe(resolveRoutineBuilderDraftRecovery({})), "discard:no_recoverable_content");
  assert.equal(
    describe(resolveRoutineBuilderDraftRecovery({ setupByDay: { Lunes: { rows: [placeholderRow("r1")] } } })),
    "discard:placeholder_only_content",
  );
  assert.equal(
    describe(resolveRoutineBuilderDraftRecovery({ setupByDay: { Lunes: { rows: [validRow()] } } })),
    "restore:full",
  );
  assert.equal(
    describe(resolveRoutineBuilderDraftRecovery({ setupByDay: { Lunes: { rows: [{ name: "x" }, validRow({ id: "r1" })] } } })),
    "restore:partial:1",
  );
}

// CASO — el tipo de razones de descarte es exhaustivo: un switch sobre `reason` debe manejar las
// 4 variantes explicitamente (incluyendo la nueva `placeholder_only_content` agregada en esta
// correccion), forzado por el compilador via el chequeo `never` en el `default`.
{
  function describeDiscardReason(reason: RoutineBuilderDraftDiscardReason): string {
    switch (reason) {
      case "invalid_top_level_input":
        return "invalid_top_level_input";
      case "placeholder_only_content":
        return "placeholder_only_content";
      case "no_recoverable_content":
        return "no_recoverable_content";
      case "all_recoverable_rows_discarded":
        return "all_recoverable_rows_discarded";
      default: {
        const exhaustiveCheck: never = reason;
        throw new Error(`razon de descarte no reconocida: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }
  for (const reason of [
    "invalid_top_level_input",
    "placeholder_only_content",
    "no_recoverable_content",
    "all_recoverable_rows_discarded",
  ] as const) {
    assert.equal(describeDiscardReason(reason), reason);
  }
}

console.log("routine-builder-draft-recovery tests passed");

// CASO — el modulo nunca genera IDs: ni createId ni crypto.randomUUID aparecen en su fuente.
{
  const source = readFileSync("src/features/routine-builder/model/routine-builder-draft-recovery.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bcreateId\b/);
  assert.doesNotMatch(code, /\bcrypto\.randomUUID\b/);
  assert.doesNotMatch(code, /Date\.now\(\)|Math\.random\(\)/, "el modulo no debe generar tiempo ni aleatoriedad");
}

// CASO — no se duplica el parser decimal: el modulo reutiliza parseDecimalWeightInput en vez de
// aplicar Number(...) directamente sobre el string de weight.
{
  const source = readFileSync("src/features/routine-builder/model/routine-builder-draft-recovery.ts", "utf8");
  assert.match(source, /import \{ parseDecimalWeightInput \} from "@\/lib\/progress\/weight-format";/);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /Number\(\s*row\.weight/, "no debe coaccionar weight con Number(...) directo, rompe con formatos de coma");
}

// CASO — pureza y fronteras P3-24B/P3-25/P3-26: sin React, sin storage, sin mensajes de UI, sin
// mapping/dedupe/lineage real, sin integracion en el root, sin clonado via serializacion.
{
  const source = readFileSync("src/features/routine-builder/model/routine-builder-draft-recovery.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const outOfScope of [
    /from ["']react["']/, /\buseState\b/, /\buseEffect\b/, /\buseReducer\b/,
    /from ["']@\/components\/organizatech-app["']/,
    /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
    /\bsetTimeout\b/, /\bsetInterval\b/,
    /\bloadRoutineDraft\b/, /\bsaveRoutineDraft\b/, /\bclearRoutineDraft\b/,
    /\bnormalizeTrainingPlan\b/,
    /\bcreateSetupByDayFromExercises\b/, /\bdedupeExercisesByDayAndRoutine\b/,
    /\bexerciseLineageId\b.*resolve/i,
    /\bnormalizeSetupByDay\b/,
    /\bsaveInitialRoutine\b/, /\bSyntheticEvent\b/,
    /\bwindow\.confirm\b/, /\bisCycleScopedEdit\b/, /\bisCycleScopedTrainingCycle\b/, /\bpersistedActiveCycle\b/,
    /\bsetStatusMessage\b/, /\bResumen\b/, /\bRecuperamos\b/,
    /\bROUTINE_DRAFT_MAX_AGE_MS\b/, /\bROUTINE_DRAFT_VERSION\b/, /\bupdatedAt\b/, /\bisExpired\b/,
    /JSON\.parse\(\s*JSON\.stringify/,
    /\bstructuredClone\b/,
  ]) {
    assert.doesNotMatch(code, outOfScope, `el modulo no debe absorber responsabilidad de fases posteriores: ${outOfScope}`);
  }
}

console.log("routine-builder-draft-recovery boundary tests passed");
