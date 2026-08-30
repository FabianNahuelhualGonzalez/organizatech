import {
  addCalendarDays,
  calculateCycleDuration,
  compareISOCalendarDates,
  differenceInCalendarDays,
  isISOCalendarDate,
} from "./dates";
import { validateTrainingCycleDraft } from "./validation";
import {
  DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
  type CyclePublicStatus,
  type TrainingCycleDraft,
  type TrainingCyclePlanContent,
} from "./types";

export const EXPIRY_NOTICE_DAYS = [3, 2, 1, 0] as const;
export type ExpiryNoticeDay = (typeof EXPIRY_NOTICE_DAYS)[number];

export type CycleLifecyclePhase =
  | "upcoming"
  | "active"
  | "expiring"
  | "closure_due"
  | "closure_deferred"
  | "closed";

export interface CycleLifecycleInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly today: string;
  readonly workoutInProgress: boolean;
  readonly closedAtDate?: string | null;
}

export type CycleLifecycleResult =
  | {
    readonly valid: false;
    readonly reason: "invalid_date" | "invalid_range" | "invalid_closed_at";
  }
  | {
    readonly valid: true;
    readonly status: CyclePublicStatus;
    readonly phase: CycleLifecyclePhase;
    readonly daysUntilEnd: number;
    readonly expiryNoticeDay: ExpiryNoticeDay | null;
    readonly endDateIsUsableToday: boolean;
    readonly closureRequired: boolean;
    readonly closureDeferredByWorkout: boolean;
  };

/** El término es inclusivo; el cierre sólo vence a partir del día siguiente. */
export function deriveCycleLifecycle(input: CycleLifecycleInput): CycleLifecycleResult {
  if (
    !isISOCalendarDate(input.startDate)
    || !isISOCalendarDate(input.endDate)
    || !isISOCalendarDate(input.today)
  ) return { valid: false, reason: "invalid_date" };
  if (!calculateCycleDuration(input.startDate, input.endDate).valid) {
    return { valid: false, reason: "invalid_range" };
  }
  if (
    input.closedAtDate != null
    && (!isISOCalendarDate(input.closedAtDate)
      || compareISOCalendarDates(input.closedAtDate, input.endDate) <= 0)
  ) return { valid: false, reason: "invalid_closed_at" };

  const daysUntilEnd = differenceInCalendarDays(input.today, input.endDate);
  if (input.closedAtDate != null && compareISOCalendarDates(input.today, input.closedAtDate) >= 0) {
    return lifecycle("closed", "closed", daysUntilEnd, null, false, false, false);
  }
  if (compareISOCalendarDates(input.today, input.startDate) < 0) {
    return lifecycle("active", "upcoming", daysUntilEnd, null, false, false, false);
  }
  if (daysUntilEnd >= 0) {
    const notice = isExpiryNoticeDay(daysUntilEnd) ? daysUntilEnd : null;
    return lifecycle(
      notice === null ? "active" : "expiring",
      notice === null ? "active" : "expiring",
      daysUntilEnd,
      notice,
      true,
      false,
      false,
    );
  }
  if (input.workoutInProgress) {
    return lifecycle("expiring", "closure_deferred", daysUntilEnd, null, false, false, true);
  }
  return lifecycle("closed", "closure_due", daysUntilEnd, null, false, true, false);
}

export type CycleOverlapPolicy = "reject" | "allow";

export function evaluateCycleActivation(input: Readonly<{
  draft: TrainingCycleDraft;
  existingCycleStatuses: readonly CyclePublicStatus[];
  overlapPolicy: CycleOverlapPolicy;
}>): Readonly<{
  allowed: boolean;
  reason: "draft_invalid" | "active_cycle_exists" | null;
}> {
  const validation = validateTrainingCycleDraft(input.draft);
  if (!validation.canActivate) return { allowed: false, reason: "draft_invalid" };
  if (
    input.overlapPolicy === "reject"
    && input.existingCycleStatuses.some((status) => status === "active" || status === "expiring")
  ) return { allowed: false, reason: "active_cycle_exists" };
  return { allowed: true, reason: null };
}

export type ActivationGate =
  | { readonly phase: "idle" }
  | { readonly phase: "activating"; readonly requestKey: string }
  | { readonly phase: "activated"; readonly requestKey: string; readonly cycleId: string };

export type BeginActivationResult =
  | { readonly accepted: true; readonly state: Extract<ActivationGate, { phase: "activating" }> }
  | {
    readonly accepted: false;
    readonly state: ActivationGate;
    readonly reason: "invalid_request_key" | "already_in_progress" | "activation_in_progress" | "already_activated";
    readonly existingCycleId: string | null;
  };

export function createActivationGate(): ActivationGate {
  return { phase: "idle" };
}

export function beginCycleActivation(state: ActivationGate, requestKey: string): BeginActivationResult {
  const normalizedKey = requestKey.trim();
  if (!normalizedKey) {
    return { accepted: false, state, reason: "invalid_request_key", existingCycleId: null };
  }
  if (state.phase === "idle") {
    return { accepted: true, state: { phase: "activating", requestKey: normalizedKey } };
  }
  if (state.phase === "activating") {
    return {
      accepted: false,
      state,
      reason: state.requestKey === normalizedKey ? "already_in_progress" : "activation_in_progress",
      existingCycleId: null,
    };
  }
  return {
    accepted: false,
    state,
    reason: "already_activated",
    existingCycleId: state.cycleId,
  };
}

export function completeCycleActivation(
  state: ActivationGate,
  requestKey: string,
  cycleId: string,
): ActivationGate {
  if (
    state.phase !== "activating"
    || state.requestKey !== requestKey.trim()
    || !cycleId.trim()
  ) return state;
  return { phase: "activated", requestKey: state.requestKey, cycleId: cycleId.trim() };
}

export function failCycleActivation(state: ActivationGate, requestKey: string): ActivationGate {
  return state.phase === "activating" && state.requestKey === requestKey.trim()
    ? { phase: "idle" }
    : state;
}

export interface CycleExtensionPolicy {
  /** `null` hace explícito que producto aún no definió un máximo de extensiones acumuladas. */
  readonly maxAddedDays: number | null;
  readonly maxTotalSpanDays: number;
}

export const DEFAULT_CYCLE_EXTENSION_POLICY: CycleExtensionPolicy = Object.freeze({
  maxAddedDays: null,
  maxTotalSpanDays: DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxCycleSpanDays,
});

export type CycleExtensionResult =
  | {
    readonly valid: true;
    readonly addedDays: number;
    readonly newElapsedDays: number;
  }
  | {
    readonly valid: false;
    readonly reason:
      | "invalid_date"
      | "invalid_policy"
      | "invalid_current_range"
      | "not_after_today"
      | "not_after_current_end"
      | "added_days_exceed_policy"
      | "total_span_exceeds_limit";
  };

export function validateCycleExtension(input: Readonly<{
  startDate: string;
  currentEndDate: string;
  proposedEndDate: string;
  today: string;
  policy?: CycleExtensionPolicy;
}>): CycleExtensionResult {
  const policy = input.policy ?? DEFAULT_CYCLE_EXTENSION_POLICY;
  if (
    !Number.isSafeInteger(policy.maxTotalSpanDays)
    || policy.maxTotalSpanDays < 1
    || (policy.maxAddedDays !== null
      && (!Number.isSafeInteger(policy.maxAddedDays) || policy.maxAddedDays < 1))
  ) return { valid: false, reason: "invalid_policy" };
  if (
    !isISOCalendarDate(input.startDate)
    || !isISOCalendarDate(input.currentEndDate)
    || !isISOCalendarDate(input.proposedEndDate)
    || !isISOCalendarDate(input.today)
  ) return { valid: false, reason: "invalid_date" };
  if (!calculateCycleDuration(input.startDate, input.currentEndDate, policy.maxTotalSpanDays).valid) {
    return { valid: false, reason: "invalid_current_range" };
  }
  if (compareISOCalendarDates(input.proposedEndDate, input.today) <= 0) {
    return { valid: false, reason: "not_after_today" };
  }
  if (compareISOCalendarDates(input.proposedEndDate, input.currentEndDate) <= 0) {
    return { valid: false, reason: "not_after_current_end" };
  }
  const addedDays = differenceInCalendarDays(input.currentEndDate, input.proposedEndDate);
  if (policy.maxAddedDays !== null && addedDays > policy.maxAddedDays) {
    return { valid: false, reason: "added_days_exceed_policy" };
  }
  const newDuration = calculateCycleDuration(
    input.startDate,
    input.proposedEndDate,
    policy.maxTotalSpanDays,
  );
  if (!newDuration.valid) return { valid: false, reason: "total_span_exceeds_limit" };
  return { valid: true, addedDays, newElapsedDays: newDuration.elapsedDays };
}

export function extensionShortcutDate(
  currentEndDate: string,
  weeks: 1 | 2 | 4,
): string {
  return addCalendarDays(currentEndDate, weeks * 7);
}

export type ActiveCycleEditResult =
  | { readonly allowed: true; readonly extension: CycleExtensionResult | null }
  | {
    readonly allowed: false;
    readonly reason: "start_date_locked" | "end_date_cannot_move_back" | "invalid_extension";
  };

/** Objetivo, días y rutinas pueden cambiar; inicio queda bloqueado y término sólo avanza. */
export function validateActiveCycleEdit(input: Readonly<{
  current: TrainingCyclePlanContent;
  proposed: TrainingCyclePlanContent;
  today: string;
  extensionPolicy?: CycleExtensionPolicy;
}>): ActiveCycleEditResult {
  if (input.proposed.startDate !== input.current.startDate) {
    return { allowed: false, reason: "start_date_locked" };
  }
  if (
    !isISOCalendarDate(input.current.startDate)
    || !isISOCalendarDate(input.current.endDate)
    || !isISOCalendarDate(input.proposed.endDate)
    || !isISOCalendarDate(input.today)
  ) return { allowed: false, reason: "invalid_extension" };
  const endComparison = compareISOCalendarDates(input.proposed.endDate, input.current.endDate);
  if (endComparison < 0) return { allowed: false, reason: "end_date_cannot_move_back" };
  if (endComparison === 0) return { allowed: true, extension: null };
  const extension = validateCycleExtension({
    startDate: input.current.startDate,
    currentEndDate: input.current.endDate,
    proposedEndDate: input.proposed.endDate,
    today: input.today,
    policy: input.extensionPolicy,
  });
  return extension.valid
    ? { allowed: true, extension }
    : { allowed: false, reason: "invalid_extension" };
}

function isExpiryNoticeDay(value: number): value is ExpiryNoticeDay {
  return (EXPIRY_NOTICE_DAYS as readonly number[]).includes(value);
}

function lifecycle(
  status: CyclePublicStatus,
  phase: CycleLifecyclePhase,
  daysUntilEnd: number,
  expiryNoticeDay: ExpiryNoticeDay | null,
  endDateIsUsableToday: boolean,
  closureRequired: boolean,
  closureDeferredByWorkout: boolean,
): Extract<CycleLifecycleResult, { valid: true }> {
  return {
    valid: true,
    status,
    phase,
    daysUntilEnd,
    expiryNoticeDay,
    endDateIsUsableToday,
    closureRequired,
    closureDeferredByWorkout,
  };
}
