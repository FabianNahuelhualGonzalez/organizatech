import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import { parseDecimalWeightInput, formatDecimalEs } from "@/lib/progress/weight-format";
import type { RoutineBuilderState } from "./routine-builder-state";

/**
 * Fuente canónica y pura para normalizar drafts legacy o desconocidos de Routine Builder a un
 * `RoutineBuilderState` válido. La recuperación productiva entrega juntos `setupDay` y
 * `setupByDay`; este módulo valida ambos sin leer storage.
 *
 * La generación de IDs permanece fuera de este boundary. El mapping, dedupe y lineage viven en
 * `routine-builder-exercise-mapping.ts`, y la integración React usa el reducer canónico.
 *
 * Sin generación de IDs: a diferencia del antiguo normalizador local, este normalizador nunca
 * fabrica un id. Una fila cuyo `id` no sea un string no-vacío se DESCARTA por completo (no se
 * incluye en el resultado) — preservarla con un id vacío violaría el invariante que
 * `createRoutineBuilderRow` ya impone en el modelo puro (rechaza id vacío), y fabricar un id
 * violaría el contrato puro. El total de filas descartadas por esta razón, o
 * por no ser un objeto normalizable (ver próxima decisión), se reporta en `discardedRowCount`.
 *
 * Las filas malformadas se descartan sin lanzar. Una entrada que no sea un objeto plano se
 * descarta individualmente (cuenta en `discardedRowCount`) sin afectar los demás días.
 *
 * Un `weight` con tipo inesperado no lanza: cualquier valor que no sea `string` ni `number` se
 * trata como ausente y normaliza a `"0"`.
 *
 * `sets`/`reps` exigen ser finitos y no-negativos. El valor original debe ser `string` o `number`;
 * cualquier otro tipo se trata como ausente y cualquier resultado no-finito o negativo cae a
 * `0`, simétrico con la guarda que `weight` aplica mediante
 * `parseDecimalWeightInput` (`Number.isFinite(value) && value >= 0`). No se redondea ni se fuerza
 * a entero: un `sets`/`reps` fraccionario válido (p. ej. `2.5`) se preserva, igual que hoy.
 *
 * Los días desconocidos se ignoran y los arrays de nivel superior se rechazan. Sólo se iteran
 * `TRAINING_DAY_LABELS`; cualquier clave ajena nunca se lee.
 *
 * Un día sin filas válidas normaliza a `rows: []`; rellenar filas editables es una decisión de
 * presentación y requiere IDs provistos externamente.
 *
 * `activeDay`/`setupDay`: el input persistido (`RoutineDraftStorageRecord`,
 * `src/lib/storage/app-flow-storage.ts`) persiste el día activo bajo la clave `setupDay`; el
 * modelo puro ya existente (`RoutineBuilderState`, `routine-builder-state.ts`) lo llama
 * `activeDay`. Este normalizador LEE `setupDay` del input (fidelidad al dato legacy real) y
 * ESCRIBE `activeDay` en el resultado (fidelidad al contrato tipado), validando
 * contra `TRAINING_DAY_LABELS` con fallback a `TRAINING_DAY_LABELS[0]`.
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
