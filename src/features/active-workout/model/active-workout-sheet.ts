import type { ExerciseTemplate } from "@/lib/progress/types";
import { formatDecimalEs, parseDecimalWeightInput, roundDecimal } from "@/lib/progress/weight-format";
import {
  normalizeExerciseDraft,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";

const minimumTargetSets = 1;
const maximumSeriesColumns = 5;

export interface ActiveWorkoutSeriesLayout {
  targetSets: number;
  columns: number;
  rows: number;
  distribution: readonly number[];
}

export function getActiveWorkoutSeriesLayout(targetSets: number): ActiveWorkoutSeriesLayout {
  assertValidTargetSets(targetSets);

  const columns = targetSets <= maximumSeriesColumns
    ? targetSets
    : Math.min(maximumSeriesColumns, Math.ceil(targetSets / 2));
  const rows = Math.ceil(targetSets / columns);
  const distribution = Array.from({ length: rows }, (_, rowIndex) =>
    Math.min(columns, targetSets - rowIndex * columns),
  );

  return {
    targetSets,
    columns,
    rows,
    distribution,
  };
}

export function getActiveWorkoutSeriesColumns(targetSets: number) {
  return getActiveWorkoutSeriesLayout(targetSets).columns;
}

export function getActiveWorkoutSeriesRows(targetSets: number) {
  return getActiveWorkoutSeriesLayout(targetSets).rows;
}

export type ActiveWorkoutSheetPanel = "history" | "comment";

export interface ActiveWorkoutSheetState {
  openExerciseId: string | null;
  openerExerciseId: string | null;
  openScopeKey: string | null;
  expandedPanel: ActiveWorkoutSheetPanel | null;
}

export function createActiveWorkoutSheetState(): ActiveWorkoutSheetState {
  return {
    openExerciseId: null,
    openerExerciseId: null,
    openScopeKey: null,
    expandedPanel: null,
  };
}

export function openActiveWorkoutSheet(
  state: Readonly<ActiveWorkoutSheetState>,
  exerciseId: string,
  scopeKey: string,
): ActiveWorkoutSheetState {
  if (exerciseId.length === 0) {
    throw new TypeError("exerciseId no puede estar vacío.");
  }
  if (scopeKey.length === 0) {
    throw new TypeError("scopeKey no puede estar vacío.");
  }

  return {
    ...state,
    openExerciseId: exerciseId,
    openerExerciseId: exerciseId,
    openScopeKey: scopeKey,
    expandedPanel: null,
  };
}

export function closeActiveWorkoutSheet(
  state: Readonly<ActiveWorkoutSheetState>,
): ActiveWorkoutSheetState {
  return {
    ...state,
    openExerciseId: null,
    openScopeKey: null,
    expandedPanel: null,
  };
}

export interface ActiveWorkoutSheetReconciliation {
  state: ActiveWorkoutSheetState;
  focusExerciseId: string | null;
  didClose: boolean;
}

/**
 * Cierra una hoja que ya no pertenece a la colección/selección montada. El caller puede restaurar
 * foco únicamente cuando el opener sigue existiendo; nunca queda un fondo inert sin diálogo.
 */
export function reconcileActiveWorkoutSheet(
  state: Readonly<ActiveWorkoutSheetState>,
  input: {
    scopeKey: string;
    exerciseIds: readonly string[];
    selectedExerciseId: string | null;
  },
): ActiveWorkoutSheetReconciliation {
  if (state.openExerciseId === null) {
    return { state: { ...state }, focusExerciseId: null, didClose: false };
  }

  const exerciseIds = new Set(input.exerciseIds);
  const canMount = state.openScopeKey === input.scopeKey &&
    exerciseIds.has(state.openExerciseId) &&
    input.selectedExerciseId === state.openExerciseId;
  if (canMount) {
    return { state: { ...state }, focusExerciseId: null, didClose: false };
  }

  return {
    state: closeActiveWorkoutSheet(state),
    focusExerciseId: state.openerExerciseId && exerciseIds.has(state.openerExerciseId)
      ? state.openerExerciseId
      : null,
    didClose: true,
  };
}

export function createActiveWorkoutSheetScopeKey(input: {
  day: string;
  routine: string;
  exercises: readonly ExerciseTemplate[];
}) {
  return JSON.stringify([
    input.day,
    input.routine,
    input.exercises.map((exercise) => [
      exercise.id,
      exercise.cycleId ?? null,
      exercise.cycleDayId ?? null,
      exercise.trainingCycleExerciseId ?? null,
      exercise.exerciseLineageId ?? null,
    ]),
  ]);
}

export function resolveActiveWorkoutRovingExerciseId(input: {
  key: string;
  currentExerciseId: string | null;
  exerciseIds: readonly string[];
}): string | null {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(input.key)) return null;
  if (input.exerciseIds.length === 0) return null;

  const currentIndex = Math.max(0, input.exerciseIds.indexOf(input.currentExerciseId ?? ""));
  if (input.key === "Home") return input.exerciseIds[0] ?? null;
  if (input.key === "End") return input.exerciseIds.at(-1) ?? null;
  if (input.key === "ArrowDown") {
    return input.exerciseIds[Math.min(input.exerciseIds.length - 1, currentIndex + 1)] ?? null;
  }
  return input.exerciseIds[Math.max(0, currentIndex - 1)] ?? null;
}

export function toggleActiveWorkoutSheetPanel(
  state: Readonly<ActiveWorkoutSheetState>,
  panel: ActiveWorkoutSheetPanel,
): ActiveWorkoutSheetState {
  if (state.openExerciseId === null) return { ...state, expandedPanel: null };

  return {
    ...state,
    expandedPanel: state.expandedPanel === panel ? null : panel,
  };
}

export type ActiveWorkoutGoalTone = "pending" | "fulfilled";

export interface ActiveWorkoutGoalStatus {
  complete: boolean;
  tone: ActiveWorkoutGoalTone;
  valueText: string;
  statusText: string;
}

export interface ActiveWorkoutRepetitionsGoal {
  completed: number;
  target: number;
  percentage: number;
  complete: boolean;
  tone: ActiveWorkoutGoalTone;
  message: string;
}

export interface ActiveWorkoutRegistrationValidation {
  canRegister: boolean;
  weightError: "missing" | "invalid" | null;
  missingRequiredSetIndexes: readonly number[];
}

export interface ActiveWorkoutGoalsPresentation {
  repetitions: ActiveWorkoutRepetitionsGoal;
  weight: ActiveWorkoutGoalStatus;
  sets: ActiveWorkoutGoalStatus;
  registration: ActiveWorkoutRegistrationValidation;
}

export interface ActiveWorkoutSheetGoals {
  filledSets: number;
  totalReps: number;
  targetTotalReps: number;
  progressPercent: number;
  repsComplete: boolean;
  repsMessage: string;
  weightError: ActiveWorkoutRegistrationValidation["weightError"];
  weight: {
    value: string;
    status: string;
    complete: boolean;
  };
  sets: {
    value: string;
    status: string;
    complete: boolean;
  };
  canRegister: boolean;
}

export type ActiveWorkoutRegistrationMode = "register" | "update";

export interface ActiveWorkoutRegistrationCommit {
  type: "commit_registration";
  exerciseId: string;
  mode: ActiveWorkoutRegistrationMode;
}

export function createActiveWorkoutRegistrationCommit(
  exercise: ExerciseTemplate,
  draft?: ExerciseDraft,
): ActiveWorkoutRegistrationCommit | null {
  if (!isActiveWorkoutDraftReadyToRegister(exercise, draft)) return null;
  return {
    type: "commit_registration",
    exerciseId: exercise.id,
    mode: draft?.registered ? "update" : "register",
  };
}

export function buildActiveWorkoutGoalsPresentation(
  exercise: ExerciseTemplate,
  sourceDraft?: ExerciseDraft,
): ActiveWorkoutGoalsPresentation {
  assertValidTargetSets(exercise.targetSets);

  const draft = normalizeExerciseDraft(exercise, sourceDraft);
  const requiredReps = draft.reps.slice(0, exercise.targetSets);
  const filledSetCount = requiredReps.filter((value) => value !== "").length;
  const completedRepetitions = requiredReps.reduce<number>(
    (total, value) => total + (Number(value) || 0),
    0,
  );
  const targetRepetitions = exercise.targetSets * exercise.targetReps;
  const repetitionsPercentage = targetRepetitions > 0
    ? Math.min(100, Math.max(0, Math.round((completedRepetitions / targetRepetitions) * 100)))
    : 0;
  const repetitionsComplete = completedRepetitions >= targetRepetitions;
  const repetitionsDifference = completedRepetitions - targetRepetitions;

  const parsedWeight = parseDecimalWeightInput(draft.weight);
  const hasRecordedWeight = parsedWeight !== null && parsedWeight > 0;
  const presentedWeight = parsedWeight ?? 0;
  const weightComplete = hasRecordedWeight && parsedWeight >= exercise.baseWeight;
  const weightDifference = roundDecimal(presentedWeight - exercise.baseWeight);

  const setsComplete = filledSetCount >= exercise.targetSets;
  const missingSets = exercise.targetSets - filledSetCount;

  return {
    repetitions: {
      completed: completedRepetitions,
      target: targetRepetitions,
      percentage: repetitionsPercentage,
      complete: repetitionsComplete,
      tone: toneFor(repetitionsComplete),
      message: buildRepetitionsMessage(repetitionsDifference),
    },
    weight: {
      complete: weightComplete,
      tone: toneFor(weightComplete),
      valueText: `${formatDecimalEs(presentedWeight)} de ${formatDecimalEs(exercise.baseWeight)} kg`,
      statusText: buildWeightStatus({
        hasWeight: hasRecordedWeight,
        complete: weightComplete,
        difference: weightDifference,
      }),
    },
    sets: {
      complete: setsComplete,
      tone: toneFor(setsComplete),
      valueText: `${filledSetCount} de ${exercise.targetSets} ${exercise.targetSets === 1 ? "serie" : "series"}`,
      statusText: setsComplete
        ? exercise.targetSets === 1 ? "Serie completada" : "Todas completadas"
        : missingSets === 1 ? "Falta 1 serie" : `Faltan ${missingSets} series`,
    },
    registration: validateActiveWorkoutExerciseDraft(exercise, draft),
  };
}

export function buildActiveWorkoutSheetGoals(
  exercise: ExerciseTemplate,
  draft?: ExerciseDraft,
): ActiveWorkoutSheetGoals {
  const presentation = buildActiveWorkoutGoalsPresentation(exercise, draft);

  return {
    filledSets: presentation.sets.complete
      ? exercise.targetSets
      : exercise.targetSets - presentation.registration.missingRequiredSetIndexes.length,
    totalReps: presentation.repetitions.completed,
    targetTotalReps: presentation.repetitions.target,
    progressPercent: presentation.repetitions.percentage,
    repsComplete: presentation.repetitions.complete,
    repsMessage: presentation.repetitions.message,
    weightError: presentation.registration.weightError,
    weight: {
      value: presentation.weight.valueText,
      status: presentation.weight.statusText,
      complete: presentation.weight.complete,
    },
    sets: {
      value: presentation.sets.valueText,
      status: presentation.sets.statusText,
      complete: presentation.sets.complete,
    },
    canRegister: presentation.registration.canRegister,
  };
}

/**
 * Replica la condición de validez de `resolveCurrentExerciseRegistration`: peso no vacío,
 * aceptado por el parser decimal canónico y todas las series requeridas con un valor.
 */
export function validateActiveWorkoutExerciseDraft(
  exercise: ExerciseTemplate,
  sourceDraft?: ExerciseDraft,
): ActiveWorkoutRegistrationValidation {
  assertValidTargetSets(exercise.targetSets);

  const draft = normalizeExerciseDraft(exercise, sourceDraft);
  const requiredReps = draft.reps.slice(0, exercise.targetSets);
  const weightIsMissing = draft.weight.trim() === "";
  const weightIsInvalid = !weightIsMissing && parseDecimalWeightInput(draft.weight) === null;
  const missingRequiredSetIndexes = requiredReps.flatMap((value, index) =>
    value === "" ? [index] : [],
  );

  return {
    canRegister: !weightIsMissing && !weightIsInvalid && missingRequiredSetIndexes.length === 0,
    weightError: weightIsMissing ? "missing" : weightIsInvalid ? "invalid" : null,
    missingRequiredSetIndexes,
  };
}

export function isActiveWorkoutDraftReadyToRegister(
  exercise: ExerciseTemplate,
  draft?: ExerciseDraft,
) {
  return validateActiveWorkoutExerciseDraft(exercise, draft).canRegister;
}

export function isActiveWorkoutRegistrationComplete(
  exercise: ExerciseTemplate,
  draft?: ExerciseDraft,
) {
  return Boolean(draft?.registered) && isActiveWorkoutDraftReadyToRegister(exercise, draft);
}

export function canSaveActiveWorkoutDrafts(
  exercises: readonly ExerciseTemplate[],
  drafts: Readonly<Record<string, ExerciseDraft | undefined>>,
) {
  return exercises.length > 0 && exercises.every((exercise) =>
    isActiveWorkoutRegistrationComplete(exercise, drafts[exercise.id])
  );
}

export function invokeActiveWorkoutHistoryRetry(retryExerciseHistory?: () => void) {
  if (!retryExerciseHistory) return false;
  retryExerciseHistory();
  return true;
}

function assertValidTargetSets(targetSets: number) {
  if (
    !Number.isInteger(targetSets) ||
    targetSets < minimumTargetSets
  ) {
    throw new RangeError(`targetSets debe ser un entero igual o mayor que ${minimumTargetSets}.`);
  }
}

function toneFor(complete: boolean): ActiveWorkoutGoalTone {
  return complete ? "fulfilled" : "pending";
}

function buildRepetitionsMessage(difference: number) {
  if (difference === 0) return "Completaste el objetivo de hoy.";
  if (difference > 0) {
    return `Superaste el objetivo por ${difference} ${difference === 1 ? "repetición" : "repeticiones"}.`;
  }

  const missing = Math.abs(difference);
  return missing === 1
    ? "Te falta 1 repetición para completar el objetivo de hoy."
    : `Te faltan ${missing} repeticiones para completar el objetivo de hoy.`;
}

function buildWeightStatus(input: {
  hasWeight: boolean;
  complete: boolean;
  difference: number;
}) {
  if (!input.hasWeight) return "Sin registrar";
  if (input.complete) {
    return input.difference > 0
      ? `+${formatDecimalEs(input.difference)} kg sobre el objetivo`
      : "Objetivo cumplido";
  }

  return `Faltan ${formatDecimalEs(Math.abs(input.difference))} kg`;
}
