import type { CoachInvitationActionsAttempt, CoachInvitationActionsIssue, CoachInvitationActionsOperation,
  CoachInvitationActionsRead, CoachInvitationActionsResult } from "./coach-invitation-actions-contract";

const MAX_GENERATION = 2_147_483_647;
function fail(code: CoachInvitationActionsIssue = "invalid_response"): never { throw Object.freeze({ code }); }
export function actionField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !("value" in field)) return fail();
  return field.value;
}
export function actionOpaque(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function text(value: unknown): string { return actionOpaque(value) ? value : fail(); }
function generation(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_GENERATION ? value : fail();
}
/** Source errors are not a transport for private messages, causes or accessor side effects. */
export function actionIssue(error: unknown): CoachInvitationActionsIssue {
  try {
    switch (actionField(error, "code")) {
      case "invalid_selection": return "invalid_selection";
      case "invalid_request_id": return "invalid_request_id";
      case "invalid_input": return "invalid_input";
      case "invalid_response": return "invalid_response";
      case "forbidden": return "forbidden";
      case "not_found": return "not_found";
      case "state_conflict": return "state_conflict";
      case "request_conflict": return "request_conflict";
      case "retry_required": return "retry_required";
      case "operation_stale": return "operation_stale";
      case "aborted": return "aborted";
      case "timeout": return "timeout";
      case "unavailable": return "unavailable";
    }
  } catch { /* An unreadable error is unknown, never evidence of no write. */ }
  return "unavailable";
}
export function copyActionRead(value: unknown, invitationId: string): CoachInvitationActionsRead {
  try {
    const id = text(actionField(value, "id"));
    if (id !== invitationId) return fail("request_conflict");
    const currentGeneration = generation(actionField(value, "generation"));
    const state = actionField(value, "state");
    if (state !== "pending" && state !== "expired" && state !== "cancelled" && state !== "accepted") return fail();
    return Object.freeze({ id, generation: currentGeneration, state });
  } catch (error) { return fail(actionIssue(error) === "request_conflict" ? "request_conflict" : "invalid_response"); }
}
export function copyActionOperation(value: unknown, attempt: CoachInvitationActionsAttempt): CoachInvitationActionsOperation {
  try {
    const requestId = text(actionField(value, "requestId"));
    const action = actionField(value, "action");
    if (action !== "resend" && action !== "regenerate") return fail("request_conflict");
    const invitationId = text(actionField(value, "invitationId"));
    const expectedGeneration = generation(actionField(value, "expectedGeneration"));
    const currentGeneration = generation(actionField(value, "generation"));
    if (requestId !== attempt.requestId || action !== attempt.action || invitationId !== attempt.invitationId
      || expectedGeneration !== attempt.expectedGeneration
      || currentGeneration !== expectedGeneration + (action === "regenerate" ? 1 : 0)) return fail("request_conflict");
    const state = actionField(value, "state");
    if (state !== "reserved" && state !== "cancelled") return fail();
    if (attempt.operation?.state === "cancelled" && state !== "cancelled") return fail();
    const reservedAt = text(actionField(value, "reservedAt"));
    return Object.freeze({ requestId, action, state, invitationId, expectedGeneration, generation: currentGeneration, reservedAt });
  } catch (error) { return fail(actionIssue(error) === "request_conflict" ? "request_conflict" : "invalid_response"); }
}
export function copyActionResult(value: unknown, attempt: CoachInvitationActionsAttempt): CoachInvitationActionsResult {
  try {
    const status = actionField(value, "status");
    const serverNow = text(actionField(value, "serverNow"));
    if (status === "rate_limited") return Object.freeze({ status, serverNow, retryAt: text(actionField(value, "retryAt")) });
    if (status !== "recorded") return fail();
    return Object.freeze({ status, serverNow, operation: copyActionOperation(actionField(value, "operation"), attempt) });
  } catch (error) { return fail(actionIssue(error) === "request_conflict" ? "request_conflict" : "invalid_response"); }
}
/** Repository validates timestamps; server state, not a client clock, authorizes expiration. */
export function resolveActionRead(value: unknown, operation: CoachInvitationActionsOperation): Readonly<{
  confirmed: CoachInvitationActionsRead | null; resolution: "reserved" | "inactive";
}> {
  const read = copyActionRead(value, operation.invitationId);
  if (read.generation < operation.generation) return fail();
  if (read.generation > operation.generation) return Object.freeze({ confirmed: null, resolution: "inactive" });
  if (operation.state === "cancelled" && read.state === "pending") return fail();
  return Object.freeze({ confirmed: read, resolution: read.state === "pending" ? "reserved" : "inactive" });
}
