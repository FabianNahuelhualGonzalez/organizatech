import type { CoachPaidPeriod } from "../model/coach-payment-period";
import { validateCoachRenewalDates, type CoachRenewalBaseline, type CoachRenewalCivilDateValidation,
  type CoachRenewalPeriodTarget } from "../model/coach-renewal-draft";
import type { CoachPaidPeriodAttempt, CoachPaidPeriodOperationReceipt, CoachPaidPeriodRead } from "./coach-paid-period-controller-contract";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function paidOpaqueId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function periodCopy(value: unknown, episodeId: string, validation: CoachRenewalCivilDateValidation): CoachPaidPeriod | null {
  if (!record(value) || !paidOpaqueId(value.id) || value.linkEpisodeId !== episodeId
    || typeof value.start !== "string" || typeof value.end !== "string") return null;
  // Validate read-fact dates only; there is no prior-period boundary in this DTO.
  if (!validateCoachRenewalDates(null, { start: value.start, end: value.end }, validation).valid) return null;
  return Object.freeze({ id: value.id, linkEpisodeId: episodeId, start: value.start, end: value.end });
}

/** A failed read is null here, never a synthesized initial version or empty period. */
export function copyCoachPaidPeriodRead(
  value: unknown, episodeId: string, validation: CoachRenewalCivilDateValidation,
): CoachPaidPeriodRead | null {
  if (!record(value) || value.linkEpisodeId !== episodeId || !paidOpaqueId(value.version)) return null;
  const period = value.period === null ? null : periodCopy(value.period, episodeId, validation);
  if (value.period !== null && period === null) return null;
  return Object.freeze({ linkEpisodeId: episodeId, version: value.version, period });
}

/** Local consistency only. Source/server remain responsible for consent and ownership. */
export function matchesCoachPaidPeriodBaseline(
  renewalId: string, baseline: CoachRenewalBaseline, target: CoachRenewalPeriodTarget, read: CoachPaidPeriodRead,
): boolean {
  if (baseline.id !== renewalId || baseline.version !== read.version
    || baseline.currentPaidPeriodEndsOn !== (read.period?.end ?? null)
    || !["pending", "renewed", "declined"].includes(baseline.state) || typeof baseline.source !== "string") return false;
  if (baseline.dates !== null && (!read.period || baseline.dates.start !== read.period.start || baseline.dates.end !== read.period.end)) return false;
  return target.action === "confirm" || (target.action === "correct" && read.period !== null
    && target.periodId === read.period.id && baseline.dates !== null);
}

/** Match the exact sent intent, not a newer editor or a receipt's presumed freshness. */
export function copyMatchingCoachPaidPeriodReceipt(
  value: unknown, attempt: CoachPaidPeriodAttempt, validation: CoachRenewalCivilDateValidation,
): CoachPaidPeriodOperationReceipt | null {
  if (!record(value) || value.requestId !== attempt.requestId || value.action !== attempt.command.action
    || !paidOpaqueId(value.version) || value.version === attempt.command.expectedVersion || !paidOpaqueId(value.recordedAt)) return null;
  const period = periodCopy(value.period, attempt.episodeId, validation);
  if (!period || period.start !== attempt.command.dates.start || period.end !== attempt.command.dates.end) return null;
  if (attempt.command.action === "correct" ? period.id !== attempt.command.periodId : period.id === attempt.previousPeriodId) return null;
  if (attempt.receipt !== null && (period.id !== attempt.receipt.period.id
    || value.version !== attempt.receipt.version || value.recordedAt !== attempt.receipt.recordedAt)) return null;
  return Object.freeze({ requestId: attempt.requestId, action: attempt.command.action, period,
    version: value.version, recordedAt: value.recordedAt });
}
