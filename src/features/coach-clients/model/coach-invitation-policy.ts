export const COACH_INVITATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1_000;
export const COACH_INVITATION_RESEND_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const COACH_INVITATION_RESEND_INTERVAL_MS = 60 * 1_000;
export const COACH_INVITATION_MAX_RESENDS_PER_WINDOW = 3;

export type CoachInvitationState = "pending" | "accepted" | "revoked";

export interface AcceptedCoachInvitationResendOperation {
  /** Server reservation of a NEW operation, not provider delivery confirmation. */
  readonly reservedAtMs: number;
}

export interface CoachInvitationResendPolicyInput {
  readonly state: CoachInvitationState;
  /** Server issuance/initial-send reservation time; resends never extend this. */
  readonly issuedAtMs: number;
  /** Authoritative server clock, never Date.now() from a phone. */
  readonly serverNowMs: number;
  /**
   * Server-provided history for this invitation, already deduplicated by logical
   * requestId. A failed/ambiguous provider outcome does not remove a reservation.
   * A retry of that same requestId is not a new entry. Rejections before a server
   * reservation are not entries. History order is irrelevant.
   */
  readonly acceptedResendOperations: readonly AcceptedCoachInvitationResendOperation[];
}

export type CoachInvitationResendEligibility =
  | { readonly allowed: true; readonly reason: null; readonly retryAtMs: null }
  | {
      readonly allowed: false;
      readonly reason: "invalid-input" | "accepted" | "revoked" | "expired";
      readonly retryAtMs: null;
    }
  | {
      readonly allowed: false;
      readonly reason: "cooldown" | "resend-limit";
      /** Null if the invitation will expire before another attempt is eligible. */
      readonly retryAtMs: number | null;
    };

// ECMAScript timestamp range, not a business date or account limit.
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

function isTimestampMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && Math.abs(value) <= MAX_TIMESTAMP_MS;
}

export function getCoachInvitationExpiresAtMs(issuedAtMs: number): number | null {
  if (!isTimestampMs(issuedAtMs)) return null;
  const expiresAtMs = issuedAtMs + COACH_INVITATION_VALIDITY_MS;
  return isTimestampMs(expiresAtMs) ? expiresAtMs : null;
}

/**
 * Pure eligibility calculation, NOT a frontend security control. Before sending,
 * the backend must recheck its current state/clock under an atomic lock, enforce
 * ownership, reserve quota idempotently, and enqueue an outbox operation. Calling
 * this function does not reserve quota, deliver email, generate or validate codes.
 */
export function getCoachInvitationResendEligibility(
  input: CoachInvitationResendPolicyInput,
): CoachInvitationResendEligibility {
  if (input.state === "accepted" || input.state === "revoked") {
    return { allowed: false, reason: input.state, retryAtMs: null };
  }
  if (input.state !== "pending") {
    return { allowed: false, reason: "invalid-input", retryAtMs: null };
  }

  const expiresAtMs = getCoachInvitationExpiresAtMs(input.issuedAtMs);
  if (expiresAtMs === null || !isTimestampMs(input.serverNowMs)
    || input.serverNowMs < input.issuedAtMs
    || !Array.isArray(input.acceptedResendOperations)) {
    return { allowed: false, reason: "invalid-input", retryAtMs: null };
  }
  if (input.serverNowMs >= expiresAtMs) {
    return { allowed: false, reason: "expired", retryAtMs: null };
  }

  const reservations: number[] = [];
  for (const operation of input.acceptedResendOperations) {
    if (!operation || !isTimestampMs(operation.reservedAtMs)
      || operation.reservedAtMs < input.issuedAtMs
      || operation.reservedAtMs > input.serverNowMs) {
      return { allowed: false, reason: "invalid-input", retryAtMs: null };
    }
    reservations.push(operation.reservedAtMs);
  }
  reservations.sort((left, right) => left - right);

  const latestSendAtMs = reservations.at(-1) ?? input.issuedAtMs;
  const cooldownUntilMs = latestSendAtMs + COACH_INVITATION_RESEND_INTERVAL_MS;
  // Rolling interval (now - 24h, now]: a reservation leaves at exactly +24h.
  const windowStartMs = input.serverNowMs - COACH_INVITATION_RESEND_WINDOW_MS;
  const inWindow = reservations.filter((reservedAtMs) => reservedAtMs > windowStartMs);
  const limitRetryAtMs = inWindow.length >= COACH_INVITATION_MAX_RESENDS_PER_WINDOW
    ? inWindow[inWindow.length - COACH_INVITATION_MAX_RESENDS_PER_WINDOW]
      + COACH_INVITATION_RESEND_WINDOW_MS
    : null;

  if (limitRetryAtMs !== null || input.serverNowMs < cooldownUntilMs) {
    const nextEligibleAtMs = Math.max(cooldownUntilMs, limitRetryAtMs ?? cooldownUntilMs);
    return {
      allowed: false,
      reason: limitRetryAtMs !== null && limitRetryAtMs >= cooldownUntilMs
        ? "resend-limit" : "cooldown",
      retryAtMs: nextEligibleAtMs < expiresAtMs ? nextEligibleAtMs : null,
    };
  }
  return { allowed: true, reason: null, retryAtMs: null };
}
