import { CoachInvitationsError } from "../data/coach-invitations-contract";
import { exactRecord, uuid } from "../data/coach-invitations-validation";
import { snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "../data/coach-public-rpc-runtime";
import { createSupabaseCoachInvitationsRepository } from "../data/supabase-coach-invitations-repository";
import { createCoachInvitationActionsController } from "../hooks/coach-invitation-actions-controller";
import type {
  CoachInvitationActionsController,
  CoachInvitationActionsOperation,
  CoachInvitationActionsSelection,
  CoachInvitationActionsSource,
} from "../hooks/coach-invitation-actions-contract";

export interface CoachInvitationActionsRuntimeInput {
  readonly connection: CoachPublicRpcRuntimeInput;
  readonly selection: CoachInvitationActionsSelection;
  readonly isSelectionCurrent: (selection: CoachInvitationActionsSelection) => boolean;
  readonly createRequestId: () => string;
}

/**
 * Generation-bound invitation actions only. The runtime cannot call the legacy
 * resend/regenerate RPCs and never forwards ownership or recipient data.
 */
export function createCoachInvitationActionsRuntime(
  input: CoachInvitationActionsRuntimeInput,
): CoachInvitationActionsController {
  const configuration = snapshotCoachPublicRpcRuntime(input.connection);
  const selectionRecord = exactRecord(input.selection, ["invitationId"], "invalid_input");
  const selection = Object.freeze({
    invitationId: uuid(selectionRecord.invitationId, "invalid_input"),
  });
  const {
    principal,
    isCurrent: identityIsCurrent,
    fetch: request,
    timeoutMilliseconds,
  } = input.connection;
  const { isSelectionCurrent, createRequestId } = input;
  let invalidated = false;

  const isCurrent = () => {
    if (invalidated) return false;
    try {
      if (
        identityIsCurrent(configuration.identity) !== true
        || isSelectionCurrent(selection) !== true
      ) {
        invalidated = true;
      }
    } catch {
      invalidated = true;
    }
    return !invalidated;
  };

  const repository = createSupabaseCoachInvitationsRepository({
    configuration: {
      url: configuration.url,
      publicKey: configuration.publicKey,
    },
    expectedIdentity: configuration.identity,
    principal,
    isCurrent,
    fetch: request,
    timeoutMilliseconds,
  });

  const assertInvitation = (invitationId: string) => {
    if (invitationId !== selection.invitationId) {
      throw new CoachInvitationsError("invalid_input");
    }
  };

  const copyOperation = (
    operation: Awaited<ReturnType<typeof repository.readOwnGenerationOperation>>,
  ): CoachInvitationActionsOperation | null => {
    if (operation === null) return null;
    return Object.freeze({
      requestId: operation.requestId,
      action: operation.action,
      state: operation.state,
      invitationId: operation.invitationId,
      expectedGeneration: operation.expectedGeneration,
      generation: operation.generation,
      reservedAt: operation.reservedAt,
    });
  };

  const source: CoachInvitationActionsSource = {
    async resend(command, options) {
      assertInvitation(command.invitationId);
      return repository.resendInvitationForGeneration(command, options);
    },
    async regenerate(command, options) {
      assertInvitation(command.invitationId);
      return repository.regenerateInvitationForGeneration(command, options);
    },
    async readInvitation(invitationId, options) {
      assertInvitation(invitationId);
      const detail = await repository.readInvitation(invitationId, options);
      return Object.freeze({
        id: detail.id,
        generation: detail.generation,
        state: detail.state,
        expiresAt: detail.expiresAt,
        code: detail.code,
      });
    },
    async readOwnOperation(requestId, options) {
      return copyOperation(await repository.readOwnGenerationOperation(requestId, options));
    },
  };

  return createCoachInvitationActionsController({
    selection,
    source,
    isCurrent,
    createRequestId: () => uuid(createRequestId(), "invalid_input"),
  });
}
