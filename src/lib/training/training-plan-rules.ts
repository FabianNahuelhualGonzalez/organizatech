import {
  isTrainingCycleId,
  type TrainingCycleId,
} from "@/lib/training/training-cycle-id";
import {
  sortTrainingDaysByWeekOrder,
  TRAINING_DAY_LABELS,
} from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

export const TRAINING_PLAN_OBJECTIVES_BY_CYCLE = {
  macro: ["Fuerza", "Hipertrofia", "Recomposición", "Definición", "Rendimiento", "Salud"],
  meso: ["Fuerza", "Hipertrofia", "Potencia", "Resistencia", "Descarga", "Definición"],
  micro: ["Progresión", "Mantenimiento", "Descarga", "Técnica"],
  session: ["Técnica", "Volumen", "Intensidad", "Control/RIR"],
} as const satisfies Record<TrainingCycleId, readonly string[]>;

export const TRAINING_PLAN_DURATIONS_BY_CYCLE = {
  macro: [6, 7, 8, 9, 10, 11],
  meso: [3, 4, 5, 6],
  micro: [1],
  session: [1],
} as const satisfies Record<TrainingCycleId, readonly number[]>;

export type TrainingPlanObjectiveField =
  | "macroObjective"
  | "mesoObjective"
  | "microFocus"
  | "sessionFocus";

export type TrainingPlanDurationField =
  | "macroDurationMonths"
  | "mesoDurationWeeks"
  | "microDurationWeeks"
  | "sessionDurationDays";

export type TrainingDayLabel = (typeof TRAINING_DAY_LABELS)[number];

export type TrainingPlanValidationIssue =
  | { code: "invalid_plan"; field: "plan" }
  | { code: "invalid_cycle_type"; field: "cycleType" }
  | { code: "invalid_objective"; field: TrainingPlanObjectiveField }
  | { code: "invalid_duration"; field: TrainingPlanDurationField }
  | { code: "training_days_not_array"; field: "trainingDays" }
  | { code: "training_days_empty"; field: "trainingDays" }
  | { code: "invalid_training_day"; field: "trainingDays"; index: number }
  | { code: "duplicate_training_day"; field: "trainingDays"; day: TrainingDayLabel; index: number }
  | { code: "training_days_out_of_order"; field: "trainingDays" };

export interface TrainingPlanValidationResult {
  valid: boolean;
  issues: TrainingPlanValidationIssue[];
}

export type TrainingPlanSetupValidationIssue =
  | TrainingPlanValidationIssue
  | { code: "invalid_active_day"; field: "activeDay" }
  | { code: "active_day_not_planned"; field: "activeDay"; day: TrainingDayLabel }
  | { code: "planned_day_not_configured"; field: "configuredDays"; day: TrainingDayLabel };

export interface TrainingPlanSetupValidationInput {
  plan: unknown;
  activeDay: string;
  configuredDays: readonly string[];
}

export interface TrainingPlanSetupValidationResult {
  valid: boolean;
  complete: boolean;
  canContinue: boolean;
  canSave: boolean;
  issues: TrainingPlanSetupValidationIssue[];
  incompleteDays: TrainingDayLabel[];
  nextIncompleteDay: TrainingDayLabel | null;
}

const objectiveFieldByCycle = {
  macro: "macroObjective",
  meso: "mesoObjective",
  micro: "microFocus",
  session: "sessionFocus",
} as const satisfies Record<TrainingCycleId, TrainingPlanObjectiveField>;

const durationFieldByCycle = {
  macro: "macroDurationMonths",
  meso: "mesoDurationWeeks",
  micro: "microDurationWeeks",
  session: "sessionDurationDays",
} as const satisfies Record<TrainingCycleId, TrainingPlanDurationField>;

export function createDefaultTrainingPlan(): TrainingPlan {
  return {
    cycleType: "meso",
    macroObjective: "Hipertrofia",
    macroDurationMonths: 6,
    mesoObjective: "Hipertrofia",
    mesoDurationWeeks: 4,
    microDurationWeeks: 1,
    sessionDurationDays: 1,
    trainingDays: ["Lunes"],
    microFocus: "Progresión",
    sessionFocus: "Técnica",
  };
}

export function getTrainingPlanObjectiveOptions(cycleType: TrainingCycleId): readonly string[] {
  return TRAINING_PLAN_OBJECTIVES_BY_CYCLE[cycleType];
}

export function getTrainingPlanDurationOptions(cycleType: TrainingCycleId): readonly number[] {
  return TRAINING_PLAN_DURATIONS_BY_CYCLE[cycleType];
}

export function validateTrainingPlan(value: unknown): TrainingPlanValidationResult {
  const plan = readRecord(value);
  if (!plan) {
    return {
      valid: false,
      issues: [{ code: "invalid_plan", field: "plan" }],
    };
  }

  const issues: TrainingPlanValidationIssue[] = [];
  const cycleType = plan.cycleType;
  if (!isTrainingCycleId(cycleType)) {
    issues.push({ code: "invalid_cycle_type", field: "cycleType" });
  } else {
    const objectiveField = objectiveFieldByCycle[cycleType];
    const objectiveOptions: readonly string[] = TRAINING_PLAN_OBJECTIVES_BY_CYCLE[cycleType];
    if (
      typeof plan[objectiveField] !== "string" ||
      !objectiveOptions.includes(plan[objectiveField])
    ) {
      issues.push({ code: "invalid_objective", field: objectiveField });
    }

    const durationField = durationFieldByCycle[cycleType];
    const durationOptions: readonly number[] = TRAINING_PLAN_DURATIONS_BY_CYCLE[cycleType];
    if (
      typeof plan[durationField] !== "number" ||
      !Number.isFinite(plan[durationField]) ||
      !durationOptions.includes(plan[durationField])
    ) {
      issues.push({ code: "invalid_duration", field: durationField });
    }
  }

  validateTrainingDays(plan.trainingDays, issues);

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function validateTrainingPlanSetup(
  input: TrainingPlanSetupValidationInput,
): TrainingPlanSetupValidationResult {
  // These flags cover Training Plan invariants only; exercise and persistence
  // gates remain the responsibility of Routine Builder and its controller.
  const planValidation = validateTrainingPlan(input.plan);
  const issues: TrainingPlanSetupValidationIssue[] = [...planValidation.issues];
  const plannedDays = planValidation.valid ? readValidatedTrainingDays(input.plan) : [];
  const configuredDays = new Set(input.configuredDays.filter(isTrainingDayLabel));
  const activeDay = isTrainingDayLabel(input.activeDay) ? input.activeDay : null;
  const activeDayIsPlanned = activeDay !== null && plannedDays.includes(activeDay);
  const incompleteDays = planValidation.valid
    ? plannedDays.filter((day) => !configuredDays.has(day))
    : [];
  const complete = planValidation.valid && incompleteDays.length === 0;

  if (!complete) {
    if (activeDay === null) {
      issues.push({ code: "invalid_active_day", field: "activeDay" });
    } else if (planValidation.valid && !activeDayIsPlanned) {
      issues.push({ code: "active_day_not_planned", field: "activeDay", day: activeDay });
    }
  }

  for (const day of incompleteDays) {
    issues.push({ code: "planned_day_not_configured", field: "configuredDays", day });
  }

  const nextIncompleteDay = activeDay !== null
    ? incompleteDays.find((day) => day !== activeDay) ?? null
    : incompleteDays[0] ?? null;
  const activeDayIsConfigured = activeDay !== null && configuredDays.has(activeDay);
  const canContinue = (
    planValidation.valid &&
    !complete &&
    activeDayIsPlanned &&
    activeDayIsConfigured &&
    nextIncompleteDay !== null
  );

  return {
    valid: complete || canContinue,
    complete,
    canContinue,
    canSave: complete,
    issues,
    incompleteDays,
    nextIncompleteDay,
  };
}

function validateTrainingDays(
  value: unknown,
  issues: TrainingPlanValidationIssue[],
) {
  if (!Array.isArray(value)) {
    issues.push({ code: "training_days_not_array", field: "trainingDays" });
    return;
  }
  if (value.length === 0) {
    issues.push({ code: "training_days_empty", field: "trainingDays" });
    return;
  }

  const seenDays = new Set<TrainingDayLabel>();
  const validDays: TrainingDayLabel[] = [];
  let hasInvalidOrDuplicateDay = false;
  value.forEach((day, index) => {
    if (!isTrainingDayLabel(day)) {
      issues.push({ code: "invalid_training_day", field: "trainingDays", index });
      hasInvalidOrDuplicateDay = true;
      return;
    }
    if (seenDays.has(day)) {
      issues.push({ code: "duplicate_training_day", field: "trainingDays", day, index });
      hasInvalidOrDuplicateDay = true;
      return;
    }
    seenDays.add(day);
    validDays.push(day);
  });

  if (
    !hasInvalidOrDuplicateDay &&
    !sameOrderedDays(validDays, sortTrainingDaysByWeekOrder(validDays))
  ) {
    issues.push({ code: "training_days_out_of_order", field: "trainingDays" });
  }
}

function readValidatedTrainingDays(value: unknown): TrainingDayLabel[] {
  const plan = readRecord(value);
  if (!plan || !Array.isArray(plan.trainingDays)) return [];
  return plan.trainingDays.filter(isTrainingDayLabel);
}

function isTrainingDayLabel(value: unknown): value is TrainingDayLabel {
  return typeof value === "string" && TRAINING_DAY_LABELS.some((day) => day === value);
}

function sameOrderedDays(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
