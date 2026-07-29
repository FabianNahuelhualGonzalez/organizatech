import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import { parseDecimalWeightInput } from "@/lib/progress/weight-format";
import type { RoutineBuilderState } from "./routine-builder-state";
import { normalizeRoutineBuilderDraftInput } from "./routine-builder-draft-normalization";
import type { SetupExerciseRow } from "@/lib/training/training-routine-draft";

/**
 * Decisión pura de recuperación de drafts de Routine Builder (P3-24A, corregida en P3-24A.1 tras
 * auditoría): dado un `unknown` — el mismo tipo de valor crudo que consume
 * `normalizeRoutineBuilderDraftInput` (P3-22) — decide si el draft normalizado debe restaurarse
 * completo, restaurarse parcialmente, o descartarse.
 *
 * Hoy, `loadRoutineDraft` (`src/lib/storage/app-flow-storage.ts`, líneas ~140-199) es un gate
 * binario "todo o nada": version/userKey/dataMode/expiración inválidos, o `hasSetupDraftContent`
 * (organizatech-app.tsx, líneas 4517-4522) devolviendo `false` tras normalizar, producen
 * `null` + `clearRoutineDraft`; cualquier otro caso devuelve el record completo, y
 * `restoreRoutineDraftForSession` (organizatech-app.tsx, líneas 1397-1416) restaura las 6
 * propiedades juntas con un único mensaje fijo (`"Recuperamos tu avance pendiente."`). **No existe
 * hoy ningún concepto de recuperación parcial** — esta distinción es lógica NUEVA que este módulo
 * introduce, apoyada en `discardedRowCount` (P3-22) y en un chequeo de CONTENIDO SIGNIFICATIVO
 * propio de esta decisión (ver corrección P3-24A.1 más abajo — ya NO es una réplica literal de
 * `hasSetupDraftContent`).
 *
 * ALCANCE — explícitamente EXCLUIDO de este módulo (fases posteriores):
 * - lectura/escritura de storage (`loadRoutineDraft`/`saveRoutineDraft`/`clearRoutineDraft`,
 *   expiración, `version`/`userKey`/`dataMode`) — P3-24B integra esta decisión con storage real.
 * - mensajes de UI, textos de aviso — P3-26 define la redacción a partir de `recovery.code`/
 *   `reason`, tipados aquí pero sin contenido de presentación.
 * - `trainingPlan`/`normalizeTrainingPlan` — un árbol de datos independiente de `setupByDay`/
 *   `setupDay`; el normalizador P3-22 no lo toca, y esta decisión tampoco.
 * - mapping, dedupe y lineage real de ejercicios — P3-23.
 * - generación de IDs — nunca se invoca aquí, igual que en P3-22.
 *
 * CORRECCIÓN P3-24A.1 (auditoría, hallazgo MEDIUM M1) — "contenido recuperable" YA NO es una
 * réplica literal de `hasSetupDraftContent`: la versión original de este módulo reutilizaba el
 * mismo chequeo de truthiness que usa hoy `hasSetupDraftContent` (organizatech-app.tsx:4517-4522),
 * incluyendo `row.weight` como STRING truthy. Pero `normalizeRoutineBuilderDraftInput` formatea
 * `weight` con `formatDecimalEs` incluso cuando no hay valor real (produce `"0"`, nunca `""`) —
 * por lo que CUALQUIER fila con un `id` válido, aunque el resto de sus campos estuvieran en
 * blanco/cero, se clasificaba como "contenido" sólo por tener `weight: "0"` (string no-vacío,
 * truthy). Eso permitía que un draft compuesto únicamente por filas placeholder (visualmente
 * vacías) se restaurara como si fuera avance real del usuario.
 *
 * Esta corrección separa DOS conceptos que antes se confundían en uno solo:
 * 1. Paridad histórica con `hasSetupDraftContent` (documentada arriba, como referencia de
 *    producción — ya NO se reimplementa como función viva en este módulo).
 * 2. Contenido SIGNIFICATIVO para efectos de recuperación (`hasSignificantContent`, más abajo):
 *    una fila representa avance real únicamente si tiene `name.trim()` no-vacío, `sets !== 0`,
 *    `reps !== 0`, o un `weight` que, interpretado NUMÉRICAMENTE con el parser decimal canónico
 *    (`parseDecimalWeightInput`, `@/lib/progress/weight-format` — el mismo que ya usa
 *    `normalizeRoutineBuilderDraftInput` para producir el string de `weight`), sea mayor a cero.
 *    Un `weight` normalizado a `"0"`, `"0,0"` o `"0.0"` NO cuenta como contenido — se interpreta su
 *    VALOR numérico, no la longitud del string. `routineName.trim()` no-vacío sigue siendo
 *    contenido recuperable por sí solo, sin cambios.
 *
 * DECISIÓN P3-24A.1 — nueva razón de descarte `placeholder_only_content`: cuando SOBREVIVIERON
 * filas de la normalización (`id` válido) pero NINGUNA aporta contenido significativo y NINGÚN
 * `routineName` está establecido, Y no hubo filas descartadas (`discardedRowCount === 0`), el
 * resultado es `discard`/`placeholder_only_content` — nunca se restaura un editor compuesto
 * únicamente por placeholders.
 *
 * DECISIÓN P3-24A.1 — precedencia entre `placeholder_only_content` y
 * `all_recoverable_rows_discarded`: cuando `discardedRowCount > 0` Y no queda contenido
 * significativo, la razón es SIEMPRE `all_recoverable_rows_discarded`, incluso si además
 * sobrevivieron filas placeholder — la corrupción de datos (filas descartadas) es la causa más
 * relevante a comunicar en ese caso. `placeholder_only_content` queda reservado exclusivamente
 * para `discardedRowCount === 0` (nada se corrompió; el draft simplemente nunca tuvo contenido
 * real más allá de filas vacías). Verificado con test dedicado (caso 9 de la ticket de
 * corrección).
 *
 * DECISIÓN P3-24A — `fallbackApplied` siempre descarta: cuando el input de nivel superior no era
 * un objeto plano en absoluto, `normalizeRoutineBuilderDraftInput` produce el estado por defecto
 * completo (los 7 días en `{ routineName: "", rows: [] }` — ver DECISIÓN P3-22 correspondiente).
 * Restaurar ese fallback sería mostrarle al usuario un editor "recuperado" que en realidad no
 * contiene ningún dato suyo. Por construcción del normalizador, `fallbackApplied: true` implica
 * que `hasSignificantContent` sería `false` de todas formas (el fallback nunca contiene datos) —
 * pero esta rama es explícita e independiente de esa verificación, evaluada primero.
 *
 * DECISIÓN P3-24A — `discardedRowCount > 0` nunca se degrada a `full` ni se ignora: si aún hay
 * contenido significativo, el resultado es SIEMPRE `partial`, y `discardedRowCount` es un campo
 * OBLIGATORIO (no opcional) del variant `partial` — el sistema de tipos obliga a P3-24B/P3-26 a
 * manejar el caso explícitamente, sin poder omitirlo ni tratarlo como `full` por accidente.
 *
 * DECISIÓN P3-24A — razones de descarte mínimas, sólo con evidencia: `invalid_top_level_input`
 * (fallback aplicado), `placeholder_only_content` (filas sobrevivientes, todas vacías, sin
 * descartes), `all_recoverable_rows_discarded` (hubo filas descartadas y no queda contenido
 * significativo), `no_recoverable_content` (no sobrevivió ninguna fila y no hay routineName, sin
 * descartes). No se define una taxonomía más extensa sin evidencia adicional.
 * `shouldClearStoredDraft: true` es literal (no `boolean`) en las cuatro razones: este módulo
 * nunca decide "descartar pero no limpiar" porque no tiene evidencia de un caso real donde eso sea
 * la política correcta; P3-24B es libre de no llamar a esta función cuando no había nada
 * almacenado (evitando así un `removeItem` innecesario, aunque `clearRoutineDraft` ya es
 * idempotente sobre una clave inexistente).
 *
 * No se duplica el parser decimal: se reutiliza `parseDecimalWeightInput` (ya usado por el
 * normalizador P3-22) en vez de aplicar `Number(...)` directamente sobre el string de `weight`,
 * que rompería con formatos que usan coma como separador decimal (p. ej. `"0,0"`).
 *
 * Puro: sin React, sin hooks, sin componentes, sin Supabase, sin repositories, sin storage, sin
 * navegación, sin window/document, sin timers, sin Date.now/Math.random, sin generación de IDs.
 * No muta `input` ni el `state` producido por `normalizeRoutineBuilderDraftInput`.
 */

export type RoutineBuilderDraftDiscardReason =
  | "invalid_top_level_input"
  | "placeholder_only_content"
  | "no_recoverable_content"
  | "all_recoverable_rows_discarded";

export type RoutineBuilderDraftRecovery =
  | { kind: "full"; code: "routine_draft_recovered" }
  | { kind: "partial"; code: "routine_draft_partially_recovered"; discardedRowCount: number };

export type RoutineBuilderDraftRecoveryResult =
  | { kind: "restore"; state: RoutineBuilderState; recovery: RoutineBuilderDraftRecovery }
  | { kind: "discard"; reason: RoutineBuilderDraftDiscardReason; shouldClearStoredDraft: true };

function rowHasSignificantContent(row: SetupExerciseRow): boolean {
  if (row.name.trim() !== "") return true;
  if (row.sets !== 0) return true;
  if (row.reps !== 0) return true;
  const weightValue = parseDecimalWeightInput(row.weight) ?? 0;
  return weightValue > 0;
}

function hasSignificantContent(state: RoutineBuilderState): boolean {
  return TRAINING_DAY_LABELS.some((day) => {
    const dayState = state.setupByDay[day];
    return Boolean(dayState?.routineName.trim()) || Boolean(dayState?.rows.some(rowHasSignificantContent));
  });
}

function hasSurvivingRows(state: RoutineBuilderState): boolean {
  return TRAINING_DAY_LABELS.some((day) => (state.setupByDay[day]?.rows.length ?? 0) > 0);
}

export function resolveRoutineBuilderDraftRecovery(input: unknown): RoutineBuilderDraftRecoveryResult {
  const normalized = normalizeRoutineBuilderDraftInput(input);

  if (normalized.fallbackApplied) {
    return { kind: "discard", reason: "invalid_top_level_input", shouldClearStoredDraft: true };
  }

  if (hasSignificantContent(normalized.state)) {
    return normalized.discardedRowCount > 0
      ? {
          kind: "restore",
          state: normalized.state,
          recovery: {
            kind: "partial",
            code: "routine_draft_partially_recovered",
            discardedRowCount: normalized.discardedRowCount,
          },
        }
      : {
          kind: "restore",
          state: normalized.state,
          recovery: { kind: "full", code: "routine_draft_recovered" },
        };
  }

  if (normalized.discardedRowCount > 0) {
    return { kind: "discard", reason: "all_recoverable_rows_discarded", shouldClearStoredDraft: true };
  }

  if (hasSurvivingRows(normalized.state)) {
    return { kind: "discard", reason: "placeholder_only_content", shouldClearStoredDraft: true };
  }

  return { kind: "discard", reason: "no_recoverable_content", shouldClearStoredDraft: true };
}
