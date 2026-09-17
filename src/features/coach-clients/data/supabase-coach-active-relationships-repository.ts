import { CoachInvitationsError } from "./coach-invitations-contract";
import { captureCoachInvitationsOperation } from "./coach-invitations-operation";
import { exactRecord } from "./coach-invitations-validation";
import { createPinnedCoachRpcPort, snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "./coach-public-rpc-runtime";
import { createCoachActiveRelationshipsRepository } from "./coach-active-relationships-repository";
import { activeRelationshipsParameters } from "./coach-active-relationships-validation";
import type { CoachActiveRelationshipsPinnedClient } from "./coach-active-relationships-contract";

/** Explicit read-only SDK composition; principal and public config come from owner. */
export function createSupabaseCoachActiveRelationshipsRepository(input: CoachPublicRpcRuntimeInput) {
  const configuration = snapshotCoachPublicRpcRuntime(input);
  const { principal, isCurrent, fetch: request } = input;
  return createCoachActiveRelationshipsRepository({
    timeoutMilliseconds: input.timeoutMilliseconds,
    captureOperation: (signal) => captureCoachInvitationsOperation<CoachActiveRelationshipsPinnedClient>({
      principal, identity: configuration.identity, isCurrent, signal,
      createPinnedClient: (accessToken) => {
        const port = createPinnedCoachRpcPort(configuration, accessToken, request);
        return {
          async rpc(name, args, signal) {
            if (signal.aborted) throw new CoachInvitationsError("aborted");
            if (name !== "list_own_active_coach_relationships") throw new CoachInvitationsError("invalid_input");
            const row = exactRecord(args, ["p_query", "p_limit", "p_cursor_linked_at", "p_cursor_id"], "invalid_input");
            if ((row.p_cursor_linked_at === null) !== (row.p_cursor_id === null)) throw new CoachInvitationsError("invalid_input");
            const params = activeRelationshipsParameters({ query: row.p_query as string, limit: row.p_limit as number,
              cursor: row.p_cursor_id === null ? null : { id: row.p_cursor_id as string, linkedAt: row.p_cursor_linked_at as string } });
            if (signal.aborted) throw new CoachInvitationsError("aborted");
            return port.rpc(name, { p_query: params.p_query, p_limit: params.p_limit,
              p_cursor_linked_at: params.p_cursor_linked_at, p_cursor_id: params.p_cursor_id }, { get: false, head: false }).abortSignal(signal);
          },
        };
      },
    }),
  });
}
