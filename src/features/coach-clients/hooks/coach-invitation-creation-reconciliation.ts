import type { CoachInvitationCreationAttempt, CoachInvitationCreationIssue, CoachInvitationCreationOperation,
  CoachInvitationCreationRead, CoachInvitationCreationResult } from "./coach-invitation-creation-contract";

function fail(code: CoachInvitationCreationIssue = "invalid_response"): never { throw Object.freeze({ code }); }
function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return fail();
  return descriptor.value;
}
export function creationOpaque(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function text(value: unknown): string { return creationOpaque(value) ? value : fail(); }
function generation(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : fail();
}

/** Safe enums only; never inspect or propagate message, cause or accessors. */
export function creationIssue(error: unknown): CoachInvitationCreationIssue {
  try {
    const code = field(error, "code");
    switch (code) {
      case "invalid_input": case "invalid_request_id": case "draft_changed": case "invalid_response":
      case "forbidden": case "not_found": case "state_conflict": case "request_conflict":
      case "retry_required": case "operation_stale": case "aborted": case "timeout": case "unavailable": return code;
    }
  } catch { /* Malformed exceptions are unavailable, not proof of a rejected reservation. */ }
  return "unavailable";
}

/** Full timestamp/UUID DTO validation belongs to the repository; bind its minimal projection to our intent. */
export function copyCreationOperation(value: unknown, attempt: CoachInvitationCreationAttempt): CoachInvitationCreationOperation {
  try {
    const requestId = text(field(value, "requestId"));
    const action = field(value, "action");
    if (requestId !== attempt.requestId || action !== "create") return fail("request_conflict");
    const state = field(value, "state");
    if (state !== "reserved" && state !== "cancelled") return fail();
    const invitationId = text(field(value, "invitationId"));
    const currentGeneration = generation(field(value, "generation"));
    const reservedAt = text(field(value, "reservedAt"));
    const previous = attempt.operation;
    if (previous && (previous.invitationId !== invitationId || previous.generation !== currentGeneration)) return fail("request_conflict");
    if (previous?.state === "cancelled" && state !== "cancelled") return fail();
    return Object.freeze({ requestId, action, state, invitationId, generation: currentGeneration, reservedAt });
  } catch (error) {
    return fail(creationIssue(error) === "request_conflict" ? "request_conflict" : "invalid_response");
  }
}

export function copyCreationResult(value: unknown, attempt: CoachInvitationCreationAttempt): CoachInvitationCreationResult {
  try {
    const status = field(value, "status");
    const serverNow = text(field(value, "serverNow"));
    if (status === "rate_limited") return Object.freeze({ status, serverNow, retryAt: text(field(value, "retryAt")) });
    if (status !== "recorded") return fail();
    return Object.freeze({ status, serverNow, operation: copyCreationOperation(field(value, "operation"), attempt) });
  } catch (error) {
    return fail(creationIssue(error) === "request_conflict" ? "request_conflict" : "invalid_response");
  }
}

export function resolveCreationRead(value: unknown, attempt: CoachInvitationCreationAttempt,
  operation: CoachInvitationCreationOperation): Readonly<{
    confirmed: CoachInvitationCreationRead | null;
    resolution: "reserved" | "inactive";
  }> {
  try {
    const id = text(field(value, "id"));
    const recipientEmail = text(field(value, "recipientEmail"));
    if (id !== operation.invitationId || recipientEmail !== attempt.recipientEmail) return fail("request_conflict");
    const currentGeneration = generation(field(value, "generation"));
    const state = field(value, "state");
    if (state !== "pending" && state !== "expired" && state !== "cancelled" && state !== "accepted") return fail();
    const issuedAt = text(field(value, "issuedAt"));
    const expiresAt = text(field(value, "expiresAt"));
    const rawCode = field(value, "code");
    const code = rawCode === null ? null : text(rawCode);
    if ((state === "pending") !== (code !== null)) return fail();
    if (currentGeneration < operation.generation) return fail();
    // Another generation is not this reservation. Do not adopt its identity snapshot or material.
    if (currentGeneration > operation.generation) return Object.freeze({ confirmed: null, resolution: "inactive" });
    if (operation.state === "cancelled" && state === "pending") return fail();
    const confirmed = Object.freeze({ id, recipientEmail, generation: currentGeneration, state,
      issuedAt, expiresAt, code });
    return Object.freeze({ confirmed, resolution: state === "pending" ? "reserved" : "inactive" });
  } catch (error) {
    return fail(creationIssue(error) === "request_conflict" ? "request_conflict" : "invalid_response");
  }
}
