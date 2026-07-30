import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import { parseDecimalWeightInput } from "@/lib/progress/weight-format";
import type { RoutineBuilderState } from "./routine-builder-state";
import { normalizeRoutineBuilderDraftInput } from "./routine-builder-draft-normalization";
import type { SetupExerciseRow } from "@/lib/training/training-routine-draft";

/**
 * Decisión pura de recuperación de drafts de Routine Builder. Normaliza un input desconocido y
 * retorna restauración completa, restauración parcial o descarte. `loadRoutineDraft` conecta este
 * resolver mediante su callback genérico, aplica scope/version/expiración y limpia los descartes;
 * el root consume la metadata para presentar el mensaje correspondiente.
 *
 * Este módulo no lee ni escribe storage, no normaliza `trainingPlan`, no realiza mapping/dedupe de
 * ejercicios y no genera IDs.
 *
 * Contenido significativo significa `routineName` no vacío o una fila con nombre, series,
 * repeticiones o peso numérico mayor a cero. El parser decimal canónico evita considerar `"0"`,
 * `"0,0"` o `"0.0"` como avance real.
 *
 * `fallbackApplied` siempre descarta. Si quedan datos significativos y hubo filas descartadas, el
 * resultado es `partial`; si no queda contenido, `all_recoverable_rows_discarded` tiene precedencia
 * sobre `placeholder_only_content`. Todos los descartes solicitan cleanup y nunca contienen un
 * estado parcial.
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
