export type CoachCommercialRenewalState = "renewed" | "pending" | "declined";

export interface CoachRenewalDates {
  readonly start: string;
  readonly end: string;
}

export interface CoachRenewalBaseline {
  readonly id: string;
  /** Opaque: the integrator must bind this unchanged to the future RPC contract. */
  readonly version: string;
  readonly state: CoachCommercialRenewalState;
  /** Opaque server provenance, never reinterpreted as a new coach action. */
  readonly source: string;
  /** Last manually confirmed paid period, never the training cycle's end. */
  readonly currentPaidPeriodEndsOn: string | null;
  readonly dates: CoachRenewalDates | null;
}

export interface CoachRenewalOverride {
  readonly state: CoachCommercialRenewalState;
  /** Editing buffer retained across state choices; used only when renewed. */
  readonly dates: CoachRenewalDates | null;
}

/** Technical target supplied by the caller, never inferred from dates or a row id. */
export type CoachRenewalPeriodTarget =
  | { readonly action: "confirm"; readonly periodId?: never }
  | { readonly action: "correct"; readonly periodId: string };

export type CoachRenewalPeriodContext = CoachRenewalPeriodTarget & {
  readonly renewalId: string;
  readonly expectedVersion: string;
};

export interface CoachRenewalDraft {
  readonly baseline: CoachRenewalBaseline;
  readonly detailOpen: boolean;
  /** null means untouched, not a manual choice of pending. */
  readonly override: CoachRenewalOverride | null;
  readonly datesUndo: { readonly override: CoachRenewalOverride | null } | null;
  /** Absent only for legacy confirmation. Explicit context is pinned at opening. */
  readonly periodContext?: CoachRenewalPeriodContext;
}

export interface CoachRenewalCivilDateValidation {
  /**
   * Required strict shared parser: validate actual Gregorian dates/year bounds.
   * No permissive default or cross-feature runtime dependency lives in this model.
   */
  readonly isValidDateKey: (value: string) => boolean;
}

export type CoachRenewalDateProblem =
  | "invalid-current-end"
  | "missing-dates"
  | "invalid-start"
  | "invalid-end"
  | "end-not-after-start"
  | "start-not-after-current-end";

export type CoachRenewalDateCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: CoachRenewalDateProblem };

export interface ResolvedCoachRenewalDraft {
  readonly state: CoachCommercialRenewalState;
  readonly dates: CoachRenewalDates | null;
  readonly source:
    | { readonly kind: "baseline"; readonly value: string }
    | { readonly kind: "coachDraft"; readonly state: CoachCommercialRenewalState; readonly dates: CoachRenewalDates | null };
}

/** A commercial intent only. No training creation, closing, or ownership fields. */
export type CoachRenewalSaveIntent = {
  readonly renewalId: string;
  readonly expectedVersion: string;
} & (
  | { readonly state: "renewed"; readonly dates: CoachRenewalDates }
  | { readonly state: "pending" | "declined"; readonly dates: null }
);

export type CoachRenewalSavePreparation =
  | { readonly kind: "unchanged" }
  | { readonly kind: "blocked"; readonly reason: "detail-closed" | "dates-modal-open" | "period-command-required" | CoachRenewalPeriodContextProblem | CoachRenewalDateProblem }
  | { readonly kind: "ready"; readonly intent: CoachRenewalSaveIntent };

export type CoachRenewalPeriodContextProblem = "invalid-period-context" | "invalid-period-binding";

/** A paid-period command only; pending/declined are not payment or revocation. */
export type CoachRenewalPeriodCommand = CoachRenewalPeriodContext & {
  readonly dates: CoachRenewalDates;
};

export type CoachRenewalPeriodCommandPreparation =
  | Exclude<CoachRenewalSavePreparation, { readonly kind: "ready" }>
  | { readonly kind: "blocked"; readonly reason: "unsupported-commercial-state" }
  | { readonly kind: "ready"; readonly command: CoachRenewalPeriodCommand };

function copyDates(dates: CoachRenewalDates): CoachRenewalDates;
function copyDates(dates: CoachRenewalDates | null): CoachRenewalDates | null;
function copyDates(dates: CoachRenewalDates | null): CoachRenewalDates | null {
  return dates === null ? null : Object.freeze({ start: dates.start, end: dates.end });
}

function overrideWith(state: CoachCommercialRenewalState, dates: CoachRenewalDates | null): CoachRenewalOverride {
  return Object.freeze({ state, dates: copyDates(dates) });
}

export function openCoachRenewalDraft(baseline: CoachRenewalBaseline): CoachRenewalDraft {
  return Object.freeze({
    baseline: Object.freeze({
      id: baseline.id,
      version: baseline.version,
      state: baseline.state,
      source: baseline.source,
      currentPaidPeriodEndsOn: baseline.currentPaidPeriodEndsOn,
      dates: copyDates(baseline.dates),
    }),
    detailOpen: true,
    override: null,
    datesUndo: null,
  });
}

function validOpaqueBinding(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPeriodTarget(value: unknown): value is CoachRenewalPeriodTarget {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (!("action" in value)) return false;
  if (value.action === "confirm") return !("periodId" in value);
  return value.action === "correct" && "periodId" in value && validOpaqueBinding(value.periodId);
}

/** null rejects malformed explicit targets/bindings; it never falls back to confirm. */
export function openCoachRenewalPeriodDraft(
  baseline: CoachRenewalBaseline,
  target: CoachRenewalPeriodTarget,
): CoachRenewalDraft | null {
  if (!validPeriodTarget(target) || !validOpaqueBinding(baseline.id) || !validOpaqueBinding(baseline.version)) return null;
  const draft = openCoachRenewalDraft(baseline);
  const binding = { renewalId: draft.baseline.id, expectedVersion: draft.baseline.version };
  const periodContext: CoachRenewalPeriodContext = target.action === "correct"
    ? Object.freeze({ ...binding, action: "correct", periodId: target.periodId })
    : Object.freeze({ ...binding, action: "confirm" });
  return Object.freeze({ ...draft, periodContext });
}

function periodContextProblem(draft: CoachRenewalDraft): CoachRenewalPeriodContextProblem | null {
  if (!("periodContext" in draft)) return null;
  const context = draft.periodContext;
  if (!validPeriodTarget(context)) return "invalid-period-context";
  if (!validOpaqueBinding(context.renewalId) || !validOpaqueBinding(context.expectedVersion)
    || context.renewalId !== draft.baseline.id || context.expectedVersion !== draft.baseline.version) {
    return "invalid-period-binding";
  }
  return null;
}

/** State and provenance are resolved together; no recorded fact is invented. */
export function resolveCoachRenewalDraft(draft: CoachRenewalDraft): ResolvedCoachRenewalDraft {
  const state = draft.override?.state ?? draft.baseline.state;
  const dates = state === "renewed" ? draft.override?.dates ?? draft.baseline.dates : null;
  return Object.freeze({
    state,
    dates,
    source: draft.override === null
      ? Object.freeze({ kind: "baseline" as const, value: draft.baseline.source })
      : Object.freeze({ kind: "coachDraft" as const, state, dates }),
  });
}

export function selectCoachRenewalDraftState(
  draft: CoachRenewalDraft,
  state: "pending" | "declined",
): CoachRenewalDraft {
  if (!draft.detailOpen || draft.datesUndo !== null) return draft;
  return Object.freeze({
    ...draft,
    override: overrideWith(state, draft.override?.dates ?? draft.baseline.dates),
  });
}

/** Renewed always opens the nested dates decision. No default duration is chosen. */
export function openCoachRenewalDraftDates(
  draft: CoachRenewalDraft,
  proposedDates: CoachRenewalDates,
): CoachRenewalDraft {
  if (!draft.detailOpen || draft.datesUndo !== null) return draft;
  return Object.freeze({
    ...draft,
    override: overrideWith("renewed", draft.override?.dates ?? draft.baseline.dates ?? proposedDates),
    datesUndo: Object.freeze({ override: draft.override }),
  });
}

export function editCoachRenewalDraftDates(
  draft: CoachRenewalDraft,
  dates: CoachRenewalDates,
): CoachRenewalDraft {
  if (!draft.detailOpen || draft.datesUndo === null) return draft;
  return Object.freeze({ ...draft, override: overrideWith("renewed", dates) });
}

/** X, scrim, and Escape of the dates layer use this exact raw undo operation. */
export function cancelCoachRenewalDraftDates(draft: CoachRenewalDraft): CoachRenewalDraft {
  if (!draft.detailOpen || draft.datesUndo === null) return draft;
  return Object.freeze({ ...draft, override: draft.datesUndo.override, datesUndo: null });
}

function validCivilDate(value: string, validation: CoachRenewalCivilDateValidation): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return validation.isValidDateKey(value) === true;
  } catch {
    return false;
  }
}

function validatePeriodDates(
  dates: CoachRenewalDates | null,
  validation: CoachRenewalCivilDateValidation,
): CoachRenewalDateCheck {
  if (dates === null || dates.start === "" || dates.end === "") return { valid: false, reason: "missing-dates" };
  if (!validCivilDate(dates.start, validation)) return { valid: false, reason: "invalid-start" };
  if (!validCivilDate(dates.end, validation)) return { valid: false, reason: "invalid-end" };
  if (dates.end <= dates.start) return { valid: false, reason: "end-not-after-start" };
  return { valid: true };
}

export function validateCoachRenewalDates(
  currentPaidPeriodEndsOn: string | null,
  dates: CoachRenewalDates | null,
  validation: CoachRenewalCivilDateValidation,
): CoachRenewalDateCheck {
  if (currentPaidPeriodEndsOn !== null && !validCivilDate(currentPaidPeriodEndsOn, validation)) {
    return { valid: false, reason: "invalid-current-end" };
  }
  const check = validatePeriodDates(dates, validation);
  if (!check.valid) return check;
  if (currentPaidPeriodEndsOn !== null && dates !== null && dates.start <= currentPaidPeriodEndsOn) {
    return { valid: false, reason: "start-not-after-current-end" };
  }
  return { valid: true };
}

function validateDraftDates(draft: CoachRenewalDraft, validation: CoachRenewalCivilDateValidation): CoachRenewalDateCheck {
  const dates = resolveCoachRenewalDraft(draft).dates;
  // Correcting an existing period is not appending after its own end. The server
  // checks neighboring periods; this model neither fabricates nor edits that end.
  return draft.periodContext?.action === "correct"
    ? validatePeriodDates(dates, validation)
    : validateCoachRenewalDates(draft.baseline.currentPaidPeriodEndsOn, dates, validation);
}

export function acceptCoachRenewalDraftDates(
  draft: CoachRenewalDraft,
  validation: CoachRenewalCivilDateValidation,
): { readonly kind: "accepted"; readonly draft: CoachRenewalDraft }
  | { readonly kind: "blocked"; readonly reason: "dates-modal-closed" | CoachRenewalPeriodContextProblem | CoachRenewalDateProblem; readonly draft: CoachRenewalDraft } {
  if (!draft.detailOpen || draft.datesUndo === null) return { kind: "blocked", reason: "dates-modal-closed", draft };
  const contextProblem = periodContextProblem(draft);
  if (contextProblem !== null) return { kind: "blocked", reason: contextProblem, draft };
  const check = validateDraftDates(draft, validation);
  if (!check.valid) return { kind: "blocked", reason: check.reason, draft };
  return { kind: "accepted", draft: Object.freeze({ ...draft, datesUndo: null }) };
}

/** Cancel the detail entirely, including any nested edit; never prepare a write. */
export function cancelCoachRenewalDraft(draft: CoachRenewalDraft): CoachRenewalDraft {
  return Object.freeze({ ...draft, detailOpen: false, override: null, datesUndo: null });
}

/**
 * Invoke only for Listo. This creates an allowlisted intention, not a write.
 * The integrator/server must enforce identity, authorization, optimistic version
 * checks and civil dates again. A ready result does not close or mark data saved.
 */
export function prepareCoachRenewalDraftSave(
  draft: CoachRenewalDraft,
  validation: CoachRenewalCivilDateValidation,
): CoachRenewalSavePreparation {
  const preparation = prepareDraftSave(draft, validation);
  if (preparation.kind !== "blocked" && draft.periodContext?.action === "correct") {
    return { kind: "blocked", reason: "period-command-required" };
  }
  return preparation;
}

function prepareDraftSave(draft: CoachRenewalDraft, validation: CoachRenewalCivilDateValidation): CoachRenewalSavePreparation {
  if (!draft.detailOpen) return { kind: "blocked", reason: "detail-closed" };
  if (draft.datesUndo !== null) return { kind: "blocked", reason: "dates-modal-open" };
  const contextProblem = periodContextProblem(draft);
  if (contextProblem !== null) return { kind: "blocked", reason: contextProblem };
  const resolved = resolveCoachRenewalDraft(draft);
  if (resolved.state === "renewed") {
    const check = validateDraftDates(draft, validation);
    if (!check.valid) return { kind: "blocked", reason: check.reason };
  }
  if (draft.override === null) return { kind: "unchanged" };
  const identity = { renewalId: draft.baseline.id, expectedVersion: draft.baseline.version };
  if (resolved.state === "renewed" && resolved.dates !== null) {
    return { kind: "ready", intent: Object.freeze({ ...identity, state: "renewed", dates: copyDates(resolved.dates) }) };
  }
  if (resolved.state !== "renewed") {
    return { kind: "ready", intent: Object.freeze({ ...identity, state: resolved.state, dates: null }) };
  }
  return { kind: "blocked", reason: "missing-dates" };
}

/** Invoke for Listo in a paid-period caller. No identifier is authorization. */
export function prepareCoachRenewalPeriodCommand(
  draft: CoachRenewalDraft,
  validation: CoachRenewalCivilDateValidation,
): CoachRenewalPeriodCommandPreparation {
  const preparation = prepareDraftSave(draft, validation);
  if (preparation.kind !== "ready") return preparation;
  const { intent } = preparation;
  if (intent.state !== "renewed") return { kind: "blocked", reason: "unsupported-commercial-state" };
  if (!validOpaqueBinding(intent.renewalId) || !validOpaqueBinding(intent.expectedVersion)) {
    return { kind: "blocked", reason: "invalid-period-binding" };
  }
  const binding = { renewalId: intent.renewalId, expectedVersion: intent.expectedVersion, dates: intent.dates };
  const command: CoachRenewalPeriodCommand = draft.periodContext?.action === "correct"
    ? Object.freeze({ ...binding, action: "correct", periodId: draft.periodContext.periodId })
    : Object.freeze({ ...binding, action: "confirm" });
  return Object.freeze({ kind: "ready", command });
}
