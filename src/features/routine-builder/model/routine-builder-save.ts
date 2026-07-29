import { parseDecimalWeightInput } from "@/lib/progress/weight-format";
import { dedupeExerciseRowsByName } from "@/lib/training/training-exercise-selection";
import type { SetupExerciseRow } from "@/lib/training/training-routine-draft";

export type RoutineBuilderSaveConfirmation =
  | "unconfirmed"
  | "confirmed_routine_update";

export type RoutineBuilderSavePersistenceMode = "legacy" | "cycle_scoped";

export interface ResolveRoutineBuilderSavePreparationInput {
  readonly rows: readonly SetupExerciseRow[];
  readonly persistenceMode: RoutineBuilderSavePersistenceMode;
  readonly allowEmptyRows: boolean;
  readonly requiresRoutineUpdateConfirmation: boolean;
  readonly confirmation: RoutineBuilderSaveConfirmation;
}

export type RoutineBuilderSavePreparationResult =
  | {
    readonly kind: "invalid_weight";
    readonly exerciseName: string;
  }
  | {
    readonly kind: "no_exercises";
  }
  | {
    readonly kind: "confirmation_required";
  }
  | {
    readonly kind: "ready";
    readonly rows: SetupExerciseRow[];
  };

/**
 * Prepara las filas para guardado sin ejecutar efectos. Valida pesos antes del
 * dedupe legacy, conserva todas las filas cycle-scoped y solo reconoce una
 * confirmacion mediante el literal explicito `confirmed_routine_update`.
 */
export function resolveRoutineBuilderSavePreparation({
  rows,
  persistenceMode,
  allowEmptyRows,
  requiresRoutineUpdateConfirmation,
  confirmation,
}: ResolveRoutineBuilderSavePreparationInput): RoutineBuilderSavePreparationResult {
  const nonEmptyRows = rows.filter((row) => row.name.trim().length > 0);
  const invalidWeightRow = nonEmptyRows.find((row) => (
    row.weight.trim() !== "" && parseDecimalWeightInput(row.weight) === null
  ));
  if (invalidWeightRow) {
    return {
      kind: "invalid_weight",
      exerciseName: invalidWeightRow.name.trim(),
    };
  }

  const validRows = persistenceMode === "legacy"
    ? dedupeExerciseRowsByName([...nonEmptyRows])
    : nonEmptyRows;

  if (validRows.length === 0 && !allowEmptyRows) {
    return { kind: "no_exercises" };
  }

  if (
    requiresRoutineUpdateConfirmation &&
    confirmation !== "confirmed_routine_update"
  ) {
    return { kind: "confirmation_required" };
  }

  return {
    kind: "ready",
    rows: validRows.map((row) => ({ ...row })),
  };
}
