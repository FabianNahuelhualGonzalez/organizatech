import { CoachInvitationsError, type CoachInvitationOperation } from "../data/coach-invitations-contract";
import { normalizeRecipientEmail, uuid } from "../data/coach-invitations-validation";
import { snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "../data/coach-public-rpc-runtime";
import { createSupabaseCoachInvitationsRepository } from "../data/supabase-coach-invitations-repository";
import { createCoachInvitationCreationController } from "../hooks/coach-invitation-creation-controller";
import type { CoachInvitationCreationController, CoachInvitationCreationOperation,
  CoachInvitationCreationSource } from "../hooks/coach-invitation-creation-contract";

export interface CoachInvitationCreationRuntimeInput {
  readonly connection: CoachPublicRpcRuntimeInput;
  readonly createRequestId: () => string;
}

/** Reservation only: no UI, email dispatch, provider receipt, code or profile access.
 * The screen owner must dispose on exit/account/generation/portal changes. */
export function createCoachInvitationCreationRuntime(input: CoachInvitationCreationRuntimeInput): CoachInvitationCreationController {
  const configuration = snapshotCoachPublicRpcRuntime(input.connection);
  const { principal, isCurrent: identityIsCurrent, fetch: request, timeoutMilliseconds } = input.connection;
  const { createRequestId } = input;
  let invalidated = false;
  const isCurrent = () => {
    if (invalidated) return false;
    try { if (identityIsCurrent(configuration.identity) !== true) invalidated = true; }
    catch { invalidated = true; }
    return !invalidated;
  };
  const repository = createSupabaseCoachInvitationsRepository({
    configuration: { url: configuration.url, publicKey: configuration.publicKey },
    expectedIdentity: configuration.identity, principal, isCurrent,
    fetch: request, timeoutMilliseconds,
  });
  const operation = (value: CoachInvitationOperation): CoachInvitationCreationOperation => {
    // A request id belonging to resend/cancel/revoke is not a creation receipt.
    if (value.action !== "create") throw new CoachInvitationsError("invalid_response");
    return Object.freeze({ requestId: value.requestId, action: value.action, state: value.state,
      invitationId: value.invitationId, generation: value.generation, reservedAt: value.reservedAt });
  };
  const source: CoachInvitationCreationSource = {
    async create(command, options) {
      const result = await repository.createInvitation({ recipientEmail: command.recipientEmail,
        requestId: command.requestId }, options);
      return result.status === "rate_limited"
        ? Object.freeze({ status: result.status, serverNow: result.serverNow, retryAt: result.retryAt })
        : Object.freeze({ status: result.status, serverNow: result.serverNow, operation: operation(result.operation) });
    },
    async readOperation(requestId, options) {
      const result = await repository.readOwnOperation(requestId, options);
      return result === null ? null : operation(result);
    },
    async readInvitation(invitationId, options) {
      const detail = await repository.readInvitation(invitationId, options);
      // Drop even an authorized pending code: this consumer does not need it.
      return Object.freeze({ id: detail.id, recipientEmail: detail.recipientEmail,
        generation: detail.generation, state: detail.state });
    },
  };
  return createCoachInvitationCreationController({ source, isCurrent,
    createRequestId: () => uuid(createRequestId(), "invalid_input"),
    prepareRecipientEmail: normalizeRecipientEmail });
}
