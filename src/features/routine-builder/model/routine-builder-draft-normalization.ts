import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import { parseDecimalWeightInput, formatDecimalEs } from "@/lib/progress/weight-format";
import type { RoutineBuilderState } from "./routine-builder-state";

/**
 * Normalización pura de drafts legacy/desconocidos de Routine Builder (P3-22): convierte un
 * `unknown` — el resultado crudo de leer un draft persistido, potencialmente de una versión
 * anterior de la app — en un `RoutineBuilderState` típado y siempre válido.
 *
 * Modela la MISMA responsabilidad que hoy cumplen, juntas, `normalizeSetupByDay`
 * (organizatech-app.tsx, ~líneas 4718-4742) y la validación de `setupDay` que hoy vive en
 * `loadRoutineDraft` (`src/lib/storage/app-flow-storage.ts`, líneas ~168-170) — reconstruidas
 * aquí a partir de evidencia exacta (quotes literales de ambas), no de inferencia.
 *
 * ALCANCE — explícitamente EXCLUIDO de este módulo (fases posteriores):
 * - generación de IDs (`createId`/`crypto.randomUUID`) — nunca se invoca aquí; ver DECISIÓN
 *   "sin generación de IDs" más abajo.
 * - mapping, dedupe y lineage contra `ExerciseTemplate[]` reales (`createSetupByDayFromExercises`,
 *   `dedupeExercisesByDayAndRoutine`, resolución real de `exerciseLineageId`) — P3-23.
 * - lectura/escritura de storage (`loadRoutineDraft`/`saveRoutineDraft`/`clearRoutineDraft`) —
 *   este módulo sólo recibe un `unknown` ya extraído y devuelve un valor; nunca toca
 *   localStorage/sessionStorage.
 * - integración en el root, wiring con `useReducer`/componentes visuales — P3-26.
 *
 * DECISIÓN P3-22 — sin generación de IDs: a diferencia de `normalizeSetupByDay` (que invoca
 * `createId()` para toda fila cuyo `id` no sea un string, línea 4727), este normalizador NUNCA
 * fabrica un id. Una fila cuyo `id` no sea un string no-vacío se DESCARTA por completo (no se
 * incluye en el resultado) — preservarla con un id vacío violaría el invariante que
 * `createRoutineBuilderRow` ya impone en el modelo puro (rechaza id vacío), y fabricar un id
 * violaría el requisito explícito de esta fase. El total de filas descartadas por esta razón, o
 * por no ser un objeto normalizable (ver próxima decisión), se reporta en `discardedRowCount`.
 *
 * DECISIÓN P3-22 — filas malformadas (no-objeto) se descartan, no explotan: hoy, una entrada
 * `null`/`undefined`/no-objeto dentro de `rows` hace que `normalizeSetupByDay` lance una
 * excepción no capturada (`row.id` sobre `null`/`undefined`), que sólo el `try/catch` externo de
 * `loadRoutineDraft` contiene — y al contenerla, descarta el DRAFT COMPLETO (los 7 días), no sólo
 * la fila afectada. Una función cuyo propósito es precisamente absorber datos corruptos no debe
 * poder lanzar por esta causa: aquí, una entrada de fila que no sea un objeto plano se descarta
 * individualmente (cuenta en `discardedRowCount`) sin afectar el resto del día ni de los demás
 * días.
 *
 * DECISIÓN P3-22 — `weight` con tipo inesperado (booleano/objeto/array) no explota: por la misma
 * razón anterior — hoy `row.weight` booleano/objeto/array hace que `parseDecimalWeightInput`
 * (vía `readRequiredWeight`) llame `.trim()` sobre un valor sin ese método y lance, con el mismo
 * efecto de "descarta el draft completo" vía el catch externo. Aquí, cualquier `weight` que no
 * sea `string` ni `number` se trata como ausente (mismo resultado final que produce hoy un
 * `weight` ausente: `"0"`), sin lanzar.
 *
 * DECISIÓN P3-22 — `sets`/`reps` exigen ser finitos y no-negativos: `normalizeSetupByDay` aplica
 * `Number(row.sets) || 0` sin ninguna otra validación — un valor negativo, no-finito, o
 * proveniente de un booleano/array (`Number(true) = 1`, `Number([5]) = 5`) pasa sin corrección.
 * Este normalizador exige que el valor original sea `string` o `number` (cualquier otro tipo se
 * trata como ausente → `0`) y que el resultado de `Number(...)` sea finito y `>= 0` (de lo
 * contrario → `0`) — simétrico con la guarda que `weight` ya tiene hoy vía
 * `parseDecimalWeightInput` (`Number.isFinite(value) && value >= 0`). No se redondea ni se fuerza
 * a entero: un `sets`/`reps` fraccionario válido (p. ej. `2.5`) se preserva, igual que hoy.
 *
 * DECISIÓN P3-22 — días/claves desconocidas se ignoran, arrays de nivel superior se rechazan:
 * `normalizeSetupByDay` sólo itera `TRAINING_DAY_LABELS` (cualquier clave ajena en el input nunca
 * se lee); ese comportamiento se preserva igual aquí. Pero un `setupByDay` cuyo valor de nivel
 * superior sea un ARRAY hoy "funciona por casualidad" (accede a `arr[dia]`, que es siempre
 * `undefined`, degradando silenciosamente al fallback) sin ningún guard explícito — aquí se
 * rechaza explícitamente vía `isPlainObject` (que excluye arrays), con el mismo resultado final
 * (fallback por día), pero sin depender de una coincidencia de acceso a propiedades.
 *
 * DECISIÓN P3-22 — sin relleno a 4 filas en blanco: `normalizeSetupByDay` reemplaza incluso un
 * `rows: []` legítimo por `createSetupRows()` (4 filas vacías nuevas, con ids generados). Esa es
 * una decisión de UX/presentación (mostrar 4 filas editables por defecto), no de parsing puro, y
 * requeriría generar IDs — prohibido en esta fase. Aquí, un día sin filas válidas normaliza a
 * `rows: []`; si una fase futura (P3-26) decide rellenar con filas placeholder, lo hará
 * despachando `add_row` explícitamente (P3-21), con IDs provistos por su llamador.
 *
 * DECISIÓN P3-22 — `activeDay`/`setupDay`: el input legacy real (`RoutineDraftStorageRecord`,
 * `src/lib/storage/app-flow-storage.ts`) persiste el día activo bajo la clave `setupDay`; el
 * modelo puro ya existente (`RoutineBuilderState`, `routine-builder-state.ts`) lo llama
 * `activeDay`. Este normalizador LEE `setupDay` del input (fidelidad al dato legacy real) y
 * ESCRIBE `activeDay` en el resultado (fidelidad al contrato típado ya existente), validando
 * contra `TRAINING_DAY_LABELS` con fallback a `TRAINING_DAY_LABELS[0]` — misma regla que ya usa
 * `loadRoutineDraft` (líneas ~168-170) hoy, fuera de `normalizeSetupByDay`.
 *
 * `fallbackApplied` es `true` únicamente cuando el input de nivel superior no era un objeto plano
 * en absoluto (incluye arrays, `null`, `undefined`, primitivos) — en ese caso el resultado es el
 * estado por defecto completo, sin ningún dato del input. `discardedRowCount` cuenta filas
 * individuales descartadas por falta de id válido o por no ser un objeto normalizable; es un
 * conteo, no un catálogo de códigos de reparación inventados.
 *
 * Puro: sin React, sin hooks, sin componentes, sin Supabase, sin repositories, sin storage, sin
 * navegación, sin window/document, sin timers, sin Date.now/Math.random, sin generación de IDs.
 */

export interface RoutineBuilderDraftNormalizationResult {
  state: RoutineBuilderState;
  fallbackApplied: boolean;
  discardedRowCount: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function normalizeActiveDay(value: unknown): string {
  return typeof value === "string" && (TRAINING_DAY_LABELS as readonly string[]).includes(value)
    ? value
    : TRAINING_DAY_LABELS[0];
}

function normalizeCount(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeWeight(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return formatDecimalEs(0);
  return formatDecimalEs(parseDecimalWeightInput(value) ?? 0);
}

function normalizeRow(value: unknown): SetupExerciseRow | null {
  if (!isPlainObject(value)) return null;
  if (!isNonEmptyString(value.id)) return null;
  return {
    id: value.id,
    sourceExerciseId: typeof value.sourceExerciseId === "string" ? value.sourceExerciseId : undefined,
    exerciseLineageId: typeof value.exerciseLineageId === "string" ? value.exerciseLineageId : null,
    name: typeof value.name === "string" ? value.name : "",
    sets: normalizeCount(value.sets),
    reps: normalizeCount(value.reps),
    weight: normalizeWeight(value.weight),
  };
}

function normalizeDayState(value: unknown): { dayState: SetupDayState; discardedRowCount: number } {
  if (!isPlainObject(value)) return { dayState: { routineName: "", rows: [] }, discardedRowCount: 0 };

  const routineName = typeof value.routineName === "string" ? value.routineName : "";
  if (!Array.isArray(value.rows)) return { dayState: { routineName, rows: [] }, discardedRowCount: 0 };

  const rows: SetupExerciseRow[] = [];
  let discardedRowCount = 0;
  for (const entry of value.rows) {
    const row = normalizeRow(entry);
    if (row) {
      rows.push(row);
    } else {
      discardedRowCount += 1;
    }
  }
  return { dayState: { routineName, rows }, discardedRowCount };
}

export function normalizeRoutineBuilderDraftInput(input: unknown): RoutineBuilderDraftNormalizationResult {
  const fallbackApplied = !isPlainObject(input);
  const parsed: Record<string, unknown> = isPlainObject(input) ? input : {};

  const activeDay = normalizeActiveDay(parsed.setupDay);

  const setupByDayInput = parsed.setupByDay;
  const setupByDay: Record<string, SetupDayState> = {};
  let discardedRowCount = 0;
  for (const day of TRAINING_DAY_LABELS) {
    const dayInput = isPlainObject(setupByDayInput) ? setupByDayInput[day] : undefined;
    const normalized = normalizeDayState(dayInput);
    setupByDay[day] = normalized.dayState;
    discardedRowCount += normalized.discardedRowCount;
  }

  return {
    state: { activeDay, setupByDay },
    fallbackApplied,
    discardedRowCount,
  };
}
