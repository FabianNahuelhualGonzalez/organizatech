import { CoachInvitationsError } from "./coach-invitations-contract";
import { captureCoachInvitationsOperation } from "./coach-invitations-operation";
import {
  snapshotCoachPublicRpcRuntime,
  type CoachPublicRpcRuntimeInput,
} from "./coach-public-rpc-runtime";
import { uuid } from "./coach-invitations-validation";

export type CoachInvitationDeliveryState = "provider-accepted" | "pending";

function deliveryResponse(value: unknown, aggregate: boolean): CoachInvitationDeliveryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoachInvitationsError("invalid_response");
  }
  const row = value as Record<string, unknown>;
  if (Reflect.ownKeys(row).length !== (aggregate ? 5 : 4) || row.accepted !== true
    || !Number.isSafeInteger(row.claimed) || !Number.isSafeInteger(row.sent)
    || !Number.isSafeInteger(row.pending)
    || (aggregate && typeof row.delivered !== "boolean")) throw new CoachInvitationsError("invalid_response");
  const claimed = row.claimed as number;
  const sent = row.sent as number;
  const pending = row.pending as number;
  if (claimed < 0 || claimed > 2 || sent < 0 || pending < 0 || sent + pending !== claimed) {
    throw new CoachInvitationsError("invalid_response");
  }
  return aggregate
    ? row.delivered === true ? "provider-accepted" : "pending"
    : claimed === 2 && sent === 2 ? "provider-accepted" : "pending";
}

export function createCoachInvitationDeliveryRuntime(input: {
  readonly connection: CoachPublicRpcRuntimeInput;
  readonly timeoutMilliseconds?: number;
}) {
  const configuration = snapshotCoachPublicRpcRuntime(input.connection);
  const { principal, isCurrent, fetch: request } = input.connection;
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 7_500;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 250 || timeoutMilliseconds > 10_000) {
    throw new CoachInvitationsError("invalid_input");
  }

  async function dispatchBody(body: Readonly<{ requestId: string } | { recover: true } | { invitationId: string }>) {
    const abort = new AbortController();
    const timeout = globalThis.setTimeout(() => abort.abort(), timeoutMilliseconds);
    try {
        const operation = await captureCoachInvitationsOperation({
          principal,
          identity: configuration.identity,
          isCurrent,
          signal: abort.signal,
          createPinnedClient: (accessToken) => Object.freeze({ accessToken }),
        });
        const fetchImpl = request ?? fetch;
        const result = await fetchImpl(
          new URL("functions/v1/send-coach-link-emails", configuration.url),
          {
            method: "POST",
            headers: {
              accept: "application/json",
              apikey: configuration.publicKey,
              authorization: `Bearer ${operation.client.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: abort.signal,
          },
        );
        if (!operation.isCurrent(configuration.identity)) throw new CoachInvitationsError("operation_stale");
        if (!result.ok) throw new CoachInvitationsError("unavailable");
        return deliveryResponse(await result.json(), "invitationId" in body);
    } catch (error) {
      if (error instanceof CoachInvitationsError) throw error;
      throw new CoachInvitationsError(abort.signal.aborted ? "timeout" : "unavailable");
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  return Object.freeze({
    async dispatch(requestIdInput: string): Promise<CoachInvitationDeliveryState> {
      return dispatchBody({ requestId: uuid(requestIdInput, "invalid_input") });
    },
    async recover(): Promise<CoachInvitationDeliveryState> {
      return dispatchBody({ recover: true });
    },
    async recoverInvitation(invitationIdInput: string): Promise<CoachInvitationDeliveryState> {
      return dispatchBody({ invitationId: uuid(invitationIdInput, "invalid_input") });
    },
  });
}
