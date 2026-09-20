import { CoachInvitationsError, type CoachInvitationOperation } from "../data/coach-invitations-contract";
import { exactRecord, uuid } from "../data/coach-invitations-validation";
import { snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "../data/coach-public-rpc-runtime";
import { createSupabaseCoachInvitationsRepository } from "../data/supabase-coach-invitations-repository";
import { createCoachClientDisconnectionController } from "../hooks/coach-client-disconnection-controller";
import type {
  CoachClientDisconnectionController, CoachClientDisconnectionReceipt,
  CoachClientDisconnectionSelection, CoachClientDisconnectionSource,
} from "../hooks/coach-client-disconnection-contract";

export interface CoachClientDisconnectionRuntimeInput {
  readonly connection: CoachPublicRpcRuntimeInput;
  /** Invitation and relationship ids belong to different resources. Never infer one from the other. */
  readonly selection: CoachClientDisconnectionSelection;
  readonly isSelectionCurrent: (selection: CoachClientDisconnectionSelection) => boolean;
  readonly createRequestId: () => string;
}

/** Isolated composition, not a screen binding. The caller owns disposal on exit.
 * No code, contact identity, email delivery or training data enter this controller. */
export function createCoachClientDisconnectionRuntime(input: CoachClientDisconnectionRuntimeInput): CoachClientDisconnectionController {
  const configuration = snapshotCoachPublicRpcRuntime(input.connection);
  const row = exactRecord(input.selection, ["kind", "id"], "invalid_input");
  if (row.kind !== "invitation" && row.kind !== "relationship") throw new CoachInvitationsError("invalid_input");
  const selection = Object.freeze({ kind: row.kind, id: uuid(row.id, "invalid_input") });
  const { principal, isCurrent: identityIsCurrent, fetch: request, timeoutMilliseconds } = input.connection;
  const { isSelectionCurrent, createRequestId } = input;
  let invalidated = false;
  // Same monotonic latch at controller and Auth/transport boundaries.
  const isCurrent = () => {
    if (invalidated) return false;
    try {
      if (identityIsCurrent(configuration.identity) !== true || isSelectionCurrent(selection) !== true) invalidated = true;
    } catch { invalidated = true; }
    return !invalidated;
  };
  const repository = createSupabaseCoachInvitationsRepository({
    configuration: { url: configuration.url, publicKey: configuration.publicKey },
    expectedIdentity: configuration.identity, principal, isCurrent,
    fetch: request, timeoutMilliseconds,
  });
  const assertSelection = (value: CoachClientDisconnectionSelection) => {
    if (value.kind !== selection.kind || value.id !== selection.id) throw new CoachInvitationsError("invalid_input");
  };
  const receipt = (operation: CoachInvitationOperation): CoachClientDisconnectionReceipt => {
    if (operation.state !== "completed") throw new CoachInvitationsError("invalid_response");
    const matches = selection.kind === "invitation"
      ? operation.action === "cancel" && operation.invitationId === selection.id
      : operation.action === "revoke" && operation.episodeId === selection.id;
    if (!matches) throw new CoachInvitationsError("invalid_response");
    return Object.freeze({ ...selection, requestId: operation.requestId, completed: true });
  };
  const source: CoachClientDisconnectionSource = {
    async readSelection(value, options) {
      assertSelection(value);
      if (selection.kind === "invitation") {
        const detail = await repository.readInvitation(selection.id, options);
        return Object.freeze({ kind: "invitation", id: detail.id, state: detail.state });
      }
      const detail = await repository.readRelationship(selection.id, options);
      return Object.freeze({ kind: "relationship", id: detail.id, endedAt: detail.endedAt });
    },
    async disconnect(value, requestId, options) {
      assertSelection(value);
      const result = selection.kind === "invitation"
        ? await repository.cancelInvitation({ invitationId: selection.id, requestId }, options)
        : await repository.revokeRelationship({ episodeId: selection.id, requestId }, options);
      // The repository already rejects rate limiting for cancel/revoke. Keep the
      // discriminant explicit, never turn a reservation or a limit into success.
      if (result.status !== "recorded") throw new CoachInvitationsError("invalid_response");
      return receipt(result.operation);
    },
    async readOwnOperation(requestId, options) {
      const operation = await repository.readOwnOperation(requestId, options);
      return operation === null ? null : receipt(operation);
    },
  };
  return createCoachClientDisconnectionController({ selection, source, isCurrent,
    createRequestId: () => uuid(createRequestId(), "invalid_input") });
}
