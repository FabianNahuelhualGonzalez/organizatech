import {
  isTrainingCycleId,
  type TrainingCycleId,
} from "@/lib/training/training-cycle-id";
import {
  sortTrainingDaysByWeekOrder,
  TRAINING_DAY_LABELS,
} from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import {
  createDefaultTrainingPlan,
  getTrainingPlanDurationOptions,
  getTrainingPlanObjectiveOptions,
  type TrainingDayLabel,
  type TrainingPlanDurationField,
  type TrainingPlanObjectiveField,
} from "@/lib/training/training-plan-rules";

export type TrainingPlanNormalizationRepair =
  | { code: "default_plan_applied"; field: "plan" }
  | { code: "invalid_cycle_type_replaced"; field: "cycleType" }
  | { code: "invalid_objective_replaced"; field: TrainingPlanObjectiveField }
  | { code: "numeric_duration_coerced"; field: TrainingPlanDurationField }
  | { code: "invalid_duration_replaced"; field: TrainingPlanDurationField }
  | { code: "training_days_replaced"; field: "trainingDays" }
  | { code: "invalid_training_day_removed"; field: "trainingDays"; index: number }
  | {
    code: "training_days_deduplicated";
    field: "trainingDays";
    day: TrainingDayLabel;
    index: number;
  }
  | { code: "training_days_reordered"; field: "trainingDays" };

export interface TrainingPlanNormalizationResult {
  plan: TrainingPlan;
  repaired: boolean;
  fallbackApplied: boolean;
  repairs: readonly TrainingPlanNormalizationRepair[];
}

const decimalNumberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function normalizeTrainingPlanInput(
  input: unknown,
): TrainingPlanNormalizationResult {
  const fallback = createDefaultTrainingPlan();
  const record = readRecord(input);
  if (!record) {
    return {
      plan: fallback,
      repaired: true,
      fallbackApplied: true,
      repairs: [{ code: "default_plan_applied", field: "plan" }],
    };
  }

  const repairs: TrainingPlanNormalizationRepair[] = [];
  const cycleType = normalizeCycleType(record.cycleType, fallback.cycleType, repairs);
  const plan: TrainingPlan = {
    cycleType,
    macroObjective: normalizeObjective(
      record,
      "macroObjective",
      "macro",
      cycleType,
      fallback,
      repairs,
    ),
    macroDurationMonths: normalizeDuration(
      record,
      "macroDurationMonths",
      "macro",
      fallback,
      repairs,
    ),
    mesoObjective: normalizeObjective(
      record,
      "mesoObjective",
      "meso",
      cycleType,
      fallback,
      repairs,
    ),
    mesoDurationWeeks: normalizeDuration(
      record,
      "mesoDurationWeeks",
      "meso",
      fallback,
      repairs,
    ),
    microDurationWeeks: normalizeDuration(
      record,
      "microDurationWeeks",
      "micro",
      fallback,
      repairs,
    ),
    sessionDurationDays: normalizeDuration(
      record,
      "sessionDurationDays",
      "session",
      fallback,
      repairs,
    ),
    trainingDays: normalizeTrainingDays(record.trainingDays, fallback.trainingDays, repairs),
    microFocus: normalizeObjective(
      record,
      "microFocus",
      "micro",
      cycleType,
      fallback,
      repairs,
    ),
    sessionFocus: normalizeObjective(
      record,
      "sessionFocus",
      "session",
      cycleType,
      fallback,
      repairs,
    ),
  };

  return {
    plan,
    repaired: repairs.length > 0,
    fallbackApplied: false,
    repairs,
  };
}

function normalizeCycleType(
  value: unknown,
  fallback: TrainingCycleId,
  repairs: TrainingPlanNormalizationRepair[],
) {
  if (isTrainingCycleId(value)) return value;
  repairs.push({ code: "invalid_cycle_type_replaced", field: "cycleType" });
  return fallback;
}

function normalizeObjective(
  record: Record<string, unknown>,
  field: TrainingPlanObjectiveField,
  fieldCycleType: TrainingCycleId,
  activeCycleType: TrainingCycleId,
  fallback: TrainingPlan,
  repairs: TrainingPlanNormalizationRepair[],
) {
  const value = record[field];
  if (typeof value === "string" && value.length > 0) {
    // Preserve legacy strings for inactive cycles. Non-string values are
    // replaced below so the normalized result always honors TrainingPlan.
    if (
      fieldCycleType !== activeCycleType ||
      getTrainingPlanObjectiveOptions(fieldCycleType).includes(value)
    ) {
      return value;
    }
  }

  repairs.push({ code: "invalid_objective_replaced", field });
  return fallback[field];
}

function normalizeDuration(
  record: Record<string, unknown>,
  field: TrainingPlanDurationField,
  cycleType: TrainingCycleId,
  fallback: TrainingPlan,
  repairs: TrainingPlanNormalizationRepair[],
) {
  const normalized = readAllowedDuration(
    record[field],
    getTrainingPlanDurationOptions(cycleType),
  );
  if (normalized) {
    if (normalized.coerced) {
      repairs.push({ code: "numeric_duration_coerced", field });
    }
    return normalized.value;
  }

  repairs.push({ code: "invalid_duration_replaced", field });
  return fallback[field];
}

function readAllowedDuration(
  value: unknown,
  allowedValues: readonly number[],
): { value: number; coerced: boolean } | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && allowedValues.includes(value)
      ? { value, coerced: false }
      : null;
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !decimalNumberPattern.test(trimmed)) return null;
  const numericValue = Number(trimmed);
  return Number.isFinite(numericValue) && allowedValues.includes(numericValue)
    ? { value: numericValue, coerced: true }
    : null;
}

function normalizeTrainingDays(
  value: unknown,
  fallback: readonly string[],
  repairs: TrainingPlanNormalizationRepair[],
) {
  if (!Array.isArray(value) || value.length === 0) {
    repairs.push({ code: "training_days_replaced", field: "trainingDays" });
    return [...fallback];
  }

  const seenDays = new Set<TrainingDayLabel>();
  const validDays: TrainingDayLabel[] = [];
  value.forEach((day, index) => {
    if (!isTrainingDayLabel(day)) {
      repairs.push({ code: "invalid_training_day_removed", field: "trainingDays", index });
      return;
    }
    if (seenDays.has(day)) {
      repairs.push({
        code: "training_days_deduplicated",
        field: "trainingDays",
        day,
        index,
      });
      return;
    }
    seenDays.add(day);
    validDays.push(day);
  });

  if (validDays.length === 0) {
    repairs.push({ code: "training_days_replaced", field: "trainingDays" });
    return [...fallback];
  }

  const sortedDays = sortTrainingDaysByWeekOrder(validDays);
  if (!sameOrderedDays(validDays, sortedDays)) {
    repairs.push({ code: "training_days_reordered", field: "trainingDays" });
  }
  return sortedDays;
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
