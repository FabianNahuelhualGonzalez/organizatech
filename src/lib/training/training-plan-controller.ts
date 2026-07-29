import { isTrainingCycleId } from "@/lib/training/training-cycle-id";
import { sortTrainingDaysByWeekOrder } from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import {
  createDefaultTrainingPlan,
  getTrainingPlanDurationField,
  getTrainingPlanDurationOptions,
  getTrainingPlanObjectiveField,
  getTrainingPlanObjectiveOptions,
  validateTrainingPlan,
  validateTrainingPlanSetup,
  type TrainingDayLabel,
  type TrainingPlanDurationField,
  type TrainingPlanObjectiveField,
  type TrainingPlanSetupValidationResult,
  type TrainingPlanValidationResult,
} from "@/lib/training/training-plan-rules";

export interface TrainingPlanControllerState {
  plan: TrainingPlan;
  activeDay: string;
}

export type TrainingPlanEdit =
  | { type: "cycle_type"; value: string }
  | { type: "objective"; value: string }
  | { type: "duration"; value: string | number }
  | { type: "training_days"; value: readonly string[] }
  | { type: "toggle_training_day"; value: string };

export type TrainingPlanTransitionAdjustment =
  | { code: "active_objective_defaulted"; field: TrainingPlanObjectiveField }
  | { code: "active_duration_defaulted"; field: TrainingPlanDurationField };

export type TrainingPlanEditResult =
  | {
    kind: "updated" | "no_change";
    state: TrainingPlanControllerState;
    validation: TrainingPlanValidationResult;
    adjustments: readonly TrainingPlanTransitionAdjustment[];
  }
  | {
    kind: "blocked";
    reason: "invalid_edit";
    state: TrainingPlanControllerState;
    validation: TrainingPlanValidationResult;
  };

export interface TrainingPlanSetupTransitionInput {
  plan: TrainingPlan;
  activeDay: string;
  configuredDays: readonly string[];
  activeDayAccepted: boolean;
  requiresRoutineUpdateConfirmation: boolean;
  routineUpdateConfirmed: boolean;
}

export type TrainingPlanSetupTransition =
  | {
    kind: "blocked";
    reason: "active_day_not_ready" | "invalid_setup";
    validation: TrainingPlanSetupValidationResult;
  }
  | {
    kind: "confirm_update";
    validation: TrainingPlanSetupValidationResult;
  }
  | {
    kind: "continue_setup";
    nextDay: TrainingDayLabel;
    validation: TrainingPlanSetupValidationResult;
  }
  | {
    kind: "finish_setup";
    validation: TrainingPlanSetupValidationResult;
  };

export type NextTrainingPlanStrategy = "default" | "controlled_cycle_scoped";

export function applyTrainingPlanEdit(
  state: TrainingPlanControllerState,
  edit: TrainingPlanEdit,
): TrainingPlanEditResult {
  const currentState = cloneControllerState(state);

  if (edit.type === "cycle_type") {
    if (!isTrainingCycleId(edit.value)) {
      return blockInvalidEdit(currentState, {
        ...currentState.plan,
        cycleType: edit.value,
      });
    }

    const candidate = cloneControllerState(currentState);
    const adjustments: TrainingPlanTransitionAdjustment[] = [];
    const defaults = createDefaultTrainingPlan();
    candidate.plan.cycleType = edit.value;

    const objectiveField = getTrainingPlanObjectiveField(edit.value);
    if (!getTrainingPlanObjectiveOptions(edit.value).includes(candidate.plan[objectiveField])) {
      candidate.plan[objectiveField] = defaults[objectiveField];
      adjustments.push({ code: "active_objective_defaulted", field: objectiveField });
    }

    const durationField = getTrainingPlanDurationField(edit.value);
    if (!getTrainingPlanDurationOptions(edit.value).includes(candidate.plan[durationField])) {
      candidate.plan[durationField] = defaults[durationField];
      adjustments.push({ code: "active_duration_defaulted", field: durationField });
    }

    return completeEdit(currentState, candidate, adjustments);
  }

  if (edit.type === "objective") {
    const candidate = cloneControllerState(currentState);
    const field = getTrainingPlanObjectiveField(candidate.plan.cycleType);
    candidate.plan[field] = edit.value;
    return completeEdit(currentState, candidate);
  }

  if (edit.type === "duration") {
    const candidate = cloneControllerState(currentState);
    const field = getTrainingPlanDurationField(candidate.plan.cycleType);
    candidate.plan[field] = Number(edit.value);
    return completeEdit(currentState, candidate);
  }

  if (edit.type === "training_days") {
    const candidate = cloneControllerState(currentState);
    candidate.plan.trainingDays = sortTrainingDaysByWeekOrder(
      edit.value.length > 0 ? edit.value : [candidate.activeDay],
    );
    if (!candidate.plan.trainingDays.includes(candidate.activeDay)) {
      candidate.activeDay = candidate.plan.trainingDays[0] ?? candidate.activeDay;
    }
    return completeEdit(currentState, candidate);
  }

  const candidate = cloneControllerState(currentState);
  const plannedDays = sortTrainingDaysByWeekOrder(
    candidate.plan.trainingDays.length > 0
      ? candidate.plan.trainingDays
      : [candidate.activeDay],
  );
  const isSelected = plannedDays.includes(edit.value);
  const nextDays = isSelected && plannedDays.length > 1
    ? plannedDays.filter((day) => day !== edit.value)
    : isSelected
      ? plannedDays
      : [...plannedDays, edit.value];
  const sortedDays = sortTrainingDaysByWeekOrder(nextDays);
  candidate.plan.trainingDays = sortedDays;
  candidate.activeDay = sortedDays.includes(edit.value)
    ? edit.value
    : sortedDays[0] ?? candidate.activeDay;
  return completeEdit(currentState, candidate);
}

export function resolveTrainingPlanSetupTransition(
  input: TrainingPlanSetupTransitionInput,
): TrainingPlanSetupTransition {
  const validation = validateTrainingPlanSetup({
    plan: input.plan,
    activeDay: input.activeDay,
    configuredDays: input.configuredDays,
  });

  if (!input.activeDayAccepted) {
    return { kind: "blocked", reason: "active_day_not_ready", validation };
  }

  if (!validation.valid) {
    return { kind: "blocked", reason: "invalid_setup", validation };
  }

  if (input.requiresRoutineUpdateConfirmation && !input.routineUpdateConfirmed) {
    return { kind: "confirm_update", validation };
  }

  if (validation.canContinue && validation.nextIncompleteDay) {
    return {
      kind: "continue_setup",
      nextDay: validation.nextIncompleteDay,
      validation,
    };
  }

  if (validation.canSave) {
    return { kind: "finish_setup", validation };
  }

  return { kind: "blocked", reason: "invalid_setup", validation };
}

export function createNextTrainingPlan(
  strategy: NextTrainingPlanStrategy,
): TrainingPlan {
  const plan = createDefaultTrainingPlan();
  if (strategy === "controlled_cycle_scoped") {
    plan.cycleType = "micro";
    plan.microFocus = "Descarga";
    plan.microDurationWeeks = 1;
  }
  return plan;
}

function blockInvalidEdit(
  currentState: TrainingPlanControllerState,
  invalidCandidate: unknown,
): TrainingPlanEditResult {
  return {
    kind: "blocked",
    reason: "invalid_edit",
    state: cloneControllerState(currentState),
    validation: validateTrainingPlan(invalidCandidate),
  };
}

function completeEdit(
  currentState: TrainingPlanControllerState,
  candidate: TrainingPlanControllerState,
  adjustments: readonly TrainingPlanTransitionAdjustment[] = [],
): TrainingPlanEditResult {
  const validation = validateTrainingPlan(candidate.plan);
  if (!validation.valid) {
    return {
      kind: "blocked",
      reason: "invalid_edit",
      state: cloneControllerState(currentState),
      validation,
    };
  }

  return {
    kind: sameControllerState(currentState, candidate) ? "no_change" : "updated",
    state: cloneControllerState(candidate),
    validation,
    adjustments: adjustments.map((adjustment) => ({ ...adjustment })),
  };
}

function cloneControllerState(
  state: TrainingPlanControllerState,
): TrainingPlanControllerState {
  return {
    plan: {
      ...state.plan,
      trainingDays: [...state.plan.trainingDays],
    },
    activeDay: state.activeDay,
  };
}

function sameControllerState(
  left: TrainingPlanControllerState,
  right: TrainingPlanControllerState,
) {
  return (
    left.activeDay === right.activeDay &&
    left.plan.cycleType === right.plan.cycleType &&
    left.plan.macroObjective === right.plan.macroObjective &&
    left.plan.macroDurationMonths === right.plan.macroDurationMonths &&
    left.plan.mesoObjective === right.plan.mesoObjective &&
    left.plan.mesoDurationWeeks === right.plan.mesoDurationWeeks &&
    left.plan.microDurationWeeks === right.plan.microDurationWeeks &&
    left.plan.sessionDurationDays === right.plan.sessionDurationDays &&
    left.plan.microFocus === right.plan.microFocus &&
    left.plan.sessionFocus === right.plan.sessionFocus &&
    sameOrderedValues(left.plan.trainingDays, right.plan.trainingDays)
  );
}

function sameOrderedValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
