import {
  CoachInvitationsError,
  type CapturedCoachInvitationsOperation,
  type CoachInvitationCallOptions,
  type CoachInvitationCommandInput,
  type CoachInvitationCreateInput,
  type CoachInvitationGenerationCommandInput,
  type CoachInvitationsRpcArgs,
  type CoachInvitationsRpcName,
  type CoachInvitationsPinnedClient,
  type CoachInvitationsSupabaseRpcPort,
  type CoachRelationshipRevokeInput,
} from "./coach-invitations-contract";
import { withCoachInvitationsDeadline } from "./coach-invitations-deadline";
import {
  invitationGeneration, mapCoachInvitationGenerationMutation, mapCoachInvitationGenerationOperation,
} from "./coach-invitation-generation-validation";
import {
  exactRecord, mapCoachInvitationDetail, mapCoachInvitationMutation, mapCoachInvitationOperation,
  mapCoachRelationshipDetail, normalizeRecipientEmail, uuid,
} from "./coach-invitations-validation";

const rpcParameters: Readonly<Record<CoachInvitationsRpcName, readonly string[]>> = {
  create_own_coach_invitation: ["p_recipient_email", "p_request_id"],
  resend_own_coach_invitation: ["p_invitation_id", "p_request_id"],
  regenerate_own_coach_invitation: ["p_invitation_id", "p_request_id"],
  cancel_own_coach_invitation: ["p_invitation_id", "p_request_id"],
  revoke_own_coach_relationship: ["p_episode_id", "p_request_id"],
  read_own_coach_invitation: ["p_invitation_id"],
  read_own_coach_invitation_operation: ["p_request_id"],
  read_own_coach_relationship: ["p_episode_id"],
  resend_own_coach_invitation_for_generation: ["p_invitation_id", "p_expected_generation", "p_request_id"],
  regenerate_own_coach_invitation_for_generation: ["p_invitation_id", "p_expected_generation", "p_request_id"],
  read_own_coach_invitation_generation_operation: ["p_request_id"],
};

/** Adapts an existing pinned RPC-only client. Does not construct SDK/Auth clients.
 * Capture and total deadline still belong to the repository below. */
export function createCoachInvitationsRpcAdapter(client: CoachInvitationsSupabaseRpcPort): CoachInvitationsPinnedClient {
  return {
    async rpc(name, args, signal) {
      if (signal.aborted) throw new CoachInvitationsError("aborted");
      if (!Object.hasOwn(rpcParameters, name)) throw new CoachInvitationsError("invalid_input");
      const row = exactRecord(args, rpcParameters[name], "invalid_input");
      const params = Object.freeze(Object.fromEntries(rpcParameters[name].map((key) => [key,
        key === "p_expected_generation" ? invitationGeneration(row[key], "invalid_input")
          : key === "p_recipient_email" ? normalizeRecipientEmail(row[key]) : uuid(row[key], "invalid_input")])));
      if (signal.aborted) throw new CoachInvitationsError("aborted");
      return client.rpc(name, params, { get: false, head: false }).abortSignal(signal);
    },
  };
}

function rpcError(error: unknown): CoachInvitationsError {
  const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
  switch (code) {
    case "42501": return new CoachInvitationsError("forbidden");
    case "22023": return new CoachInvitationsError("invalid_input");
    case "P0002": return new CoachInvitationsError("not_found");
    case "55000": return new CoachInvitationsError("state_conflict");
    // Invitations use this for a technical retry, not preference CAS/version state.
    case "40001": return new CoachInvitationsError("retry_required");
    default: return new CoachInvitationsError("unavailable");
  }
}

function sanitizeFailure(error: unknown): CoachInvitationsError {
  try {
    if (error instanceof CoachInvitationsError) {
      const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
      return new CoachInvitationsError(code);
    }
  } catch { /* Ignore hostile exception accessors/proxies. */ }
  return new CoachInvitationsError("unavailable");
}

export function createCoachInvitationsRepository(input: {
  readonly captureOperation: (signal: AbortSignal) => PromiseLike<CapturedCoachInvitationsOperation>;
  readonly timeoutMilliseconds?: number;
}) {
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 8_000;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 30_000) {
    throw new CoachInvitationsError("invalid_input");
  }

  async function call<T>(
    name: CoachInvitationsRpcName,
    args: CoachInvitationsRpcArgs,
    map: (value: unknown) => T,
    options?: CoachInvitationCallOptions,
  ): Promise<T> {
    try {
      return await withCoachInvitationsDeadline(async (signal, assertActive) => {
        const captured = await input.captureOperation(signal);
        assertActive();
        const identity = Object.freeze({ userId: uuid(captured.identity.userId), generation: captured.identity.generation });
        if (!Number.isSafeInteger(identity.generation) || identity.generation < 0) throw new CoachInvitationsError("invalid_response");
        const assertCurrent = () => {
          assertActive();
          if (!captured.isCurrent(identity)) throw new CoachInvitationsError("operation_stale");
        };
        assertCurrent();
        try {
          // Snapshot primitives before yielding. No raw form objects/ownership get forwarded.
          const result = await captured.client.rpc(name, Object.freeze({ ...args }), signal);
          assertCurrent();
          if (!result || typeof result !== "object" || !Object.hasOwn(result, "data") || !Object.hasOwn(result, "error")) {
            throw new CoachInvitationsError("invalid_response");
          }
          const dataField = Object.getOwnPropertyDescriptor(result, "data");
          const errorField = Object.getOwnPropertyDescriptor(result, "error");
          if (!dataField || !errorField || !("value" in dataField) || !("value" in errorField)) {
            throw new CoachInvitationsError("invalid_response");
          }
          if (errorField.value !== null) throw rpcError(errorField.value);
          const mapped = map(dataField.value);
          assertCurrent();
          return mapped;
        } catch (error) {
          // A rejected transport/invalid response is also stale after session change.
          assertCurrent();
          throw error;
        }
      }, timeoutMilliseconds, options?.signal);
    } catch (error) {
      // Reconstruct even known errors: never forward mutated message/cause/details.
      throw sanitizeFailure(error);
    }
  }

  const invitationCommand = async (
    action: "resend" | "regenerate" | "cancel", value: CoachInvitationCommandInput, options?: CoachInvitationCallOptions,
  ) => {
    const row = exactRecord(value, ["invitationId", "requestId"], "invalid_input");
    const invitationId = uuid(row.invitationId, "invalid_input");
    const requestId = uuid(row.requestId, "invalid_input");
    return call(`${action}_own_coach_invitation`, { p_invitation_id: invitationId, p_request_id: requestId },
      (response) => mapCoachInvitationMutation(response, { action, requestId, invitationId }), options);
  };

  const generationCommand = async (
    action: "resend" | "regenerate", value: CoachInvitationGenerationCommandInput, options?: CoachInvitationCallOptions,
  ) => {
    const row = exactRecord(value, ["invitationId", "expectedGeneration", "requestId"], "invalid_input");
    const invitationId = uuid(row.invitationId, "invalid_input");
    const expectedGeneration = invitationGeneration(row.expectedGeneration, "invalid_input");
    const requestId = uuid(row.requestId, "invalid_input");
    return call(`${action}_own_coach_invitation_for_generation`,
      { p_invitation_id: invitationId, p_expected_generation: expectedGeneration, p_request_id: requestId },
      (response) => mapCoachInvitationGenerationMutation(response, { action, requestId, invitationId, expectedGeneration }), options);
  };

  return {
    async createInvitation(value: CoachInvitationCreateInput, options?: CoachInvitationCallOptions) {
      const row = exactRecord(value, ["recipientEmail", "requestId"], "invalid_input");
      const recipientEmail = normalizeRecipientEmail(row.recipientEmail);
      const requestId = uuid(row.requestId, "invalid_input");
      return call("create_own_coach_invitation", { p_recipient_email: recipientEmail, p_request_id: requestId },
        (response) => mapCoachInvitationMutation(response, { action: "create", requestId }), options);
    },
    resendInvitation: (value: CoachInvitationCommandInput, options?: CoachInvitationCallOptions) => invitationCommand("resend", value, options),
    regenerateInvitation: (value: CoachInvitationCommandInput, options?: CoachInvitationCallOptions) => invitationCommand("regenerate", value, options),
    cancelInvitation: (value: CoachInvitationCommandInput, options?: CoachInvitationCallOptions) => invitationCommand("cancel", value, options),
    resendInvitationForGeneration: (value: CoachInvitationGenerationCommandInput, options?: CoachInvitationCallOptions) => generationCommand("resend", value, options),
    regenerateInvitationForGeneration: (value: CoachInvitationGenerationCommandInput, options?: CoachInvitationCallOptions) => generationCommand("regenerate", value, options),
    async revokeRelationship(value: CoachRelationshipRevokeInput, options?: CoachInvitationCallOptions) {
      const row = exactRecord(value, ["episodeId", "requestId"], "invalid_input");
      const episodeId = uuid(row.episodeId, "invalid_input");
      const requestId = uuid(row.requestId, "invalid_input");
      return call("revoke_own_coach_relationship", { p_episode_id: episodeId, p_request_id: requestId },
        (response) => mapCoachInvitationMutation(response, { action: "revoke", requestId, episodeId }), options);
    },
    async readInvitation(value: string, options?: CoachInvitationCallOptions) {
      const invitationId = uuid(value, "invalid_input");
      return call("read_own_coach_invitation", { p_invitation_id: invitationId },
        (response) => mapCoachInvitationDetail(response, invitationId), options);
    },
    async readOwnOperation(value: string, options?: CoachInvitationCallOptions) {
      const requestId = uuid(value, "invalid_input");
      return call("read_own_coach_invitation_operation", { p_request_id: requestId },
        (response) => response === null ? null : mapCoachInvitationOperation(response, { requestId }), options);
    },
    async readRelationship(value: string, options?: CoachInvitationCallOptions) {
      const episodeId = uuid(value, "invalid_input");
      return call("read_own_coach_relationship", { p_episode_id: episodeId },
        (response) => mapCoachRelationshipDetail(response, episodeId), options);
    },
    async readOwnGenerationOperation(value: string, options?: CoachInvitationCallOptions) {
      const requestId = uuid(value, "invalid_input");
      return call("read_own_coach_invitation_generation_operation", { p_request_id: requestId },
        (response) => response === null ? null : mapCoachInvitationGenerationOperation(response, { requestId }), options);
    },
  };
}

export type CoachInvitationsRepository = ReturnType<typeof createCoachInvitationsRepository>;
