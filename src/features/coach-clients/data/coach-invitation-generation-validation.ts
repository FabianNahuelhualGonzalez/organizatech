import {
  CoachInvitationsError,
  type CoachInvitationGenerationMutationResult,
  type CoachInvitationGenerationOperation,
  type CoachInvitationsErrorCode,
} from "./coach-invitations-contract";
import { exactRecord, mapCoachInvitationMutation, mapCoachInvitationOperation, timestampMicros } from "./coach-invitations-validation";

export function invitationGeneration(value: unknown, code: CoachInvitationsErrorCode = "invalid_response"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new CoachInvitationsError(code);
  }
  return value;
}

interface GenerationExpectation {
  readonly requestId: string;
  readonly action?: "resend" | "regenerate";
  readonly invitationId?: string;
  readonly expectedGeneration?: number;
}

export function mapCoachInvitationGenerationOperation(value: unknown, expected: GenerationExpectation): CoachInvitationGenerationOperation {
  const row = exactRecord(value, ["requestId", "action", "state", "invitationId", "expectedGeneration", "generation", "reservedAt"]);
  if (row.action !== "resend" && row.action !== "regenerate") throw new CoachInvitationsError("invalid_response");
  const expectedGeneration = invitationGeneration(row.expectedGeneration);
  // Reuse the audited primitive/state validators through an explicit allowlist.
  // These actions cannot carry a relationship episode. Never expose that field in the new DTO.
  const operation = mapCoachInvitationOperation({ requestId: row.requestId, action: row.action,
    state: row.state, invitationId: row.invitationId, episodeId: null, generation: row.generation,
    reservedAt: row.reservedAt }, expected);
  if ((operation.action !== "resend" && operation.action !== "regenerate")
    || (expected.expectedGeneration !== undefined && expectedGeneration !== expected.expectedGeneration)
    || operation.generation !== expectedGeneration + (operation.action === "regenerate" ? 1 : 0)) {
    throw new CoachInvitationsError("invalid_response");
  }
  return Object.freeze({ requestId: operation.requestId, action: operation.action, state: operation.state,
    invitationId: operation.invitationId, expectedGeneration, generation: operation.generation,
    reservedAt: operation.reservedAt });
}

export function mapCoachInvitationGenerationMutation(
  value: unknown,
  expected: Required<GenerationExpectation>,
): CoachInvitationGenerationMutationResult {
  let status: unknown;
  try { status = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status")?.value : undefined; }
  catch { throw new CoachInvitationsError("invalid_response"); }
  if (status === "rate_limited") {
    const result = mapCoachInvitationMutation(value, expected);
    if (result.status !== "rate_limited") throw new CoachInvitationsError("invalid_response");
    return result;
  }
  if (status !== "recorded") throw new CoachInvitationsError("invalid_response");
  const row = exactRecord(value, ["status", "serverNow", "operation"]);
  const operation = mapCoachInvitationGenerationOperation(row.operation, expected);
  if (timestampMicros(operation.reservedAt) > timestampMicros(row.serverNow)) throw new CoachInvitationsError("invalid_response");
  return Object.freeze({ status, serverNow: row.serverNow as string, operation });
}
