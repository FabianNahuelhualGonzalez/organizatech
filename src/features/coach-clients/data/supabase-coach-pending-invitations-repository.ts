import { CoachInvitationsError } from "./coach-invitations-contract";
import { captureCoachInvitationsOperation } from "./coach-invitations-operation";
import { exactRecord } from "./coach-invitations-validation";
import { createPinnedCoachRpcPort, snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "./coach-public-rpc-runtime";
import { createCoachPendingInvitationsRepository } from "./coach-pending-invitations-repository";
import { pendingInvitationsParameters } from "./coach-pending-invitations-validation";
import type { CoachPendingInvitationsPinnedClient } from "./coach-pending-invitations-contract";

/** Explicit read-only SDK composition; principal and public config come from owner. */
export function createSupabaseCoachPendingInvitationsRepository(input: CoachPublicRpcRuntimeInput) {
  const configuration = snapshotCoachPublicRpcRuntime(input);
  const { principal, isCurrent, fetch: request } = input;
  return createCoachPendingInvitationsRepository({
    timeoutMilliseconds: input.timeoutMilliseconds,
    captureOperation: (signal) => captureCoachInvitationsOperation<CoachPendingInvitationsPinnedClient>({
      principal, identity: configuration.identity, isCurrent, signal,
      createPinnedClient: (accessToken) => {
        const port = createPinnedCoachRpcPort(configuration, accessToken, request);
        return {
          async rpc(name, args, signal) {
            if (signal.aborted) throw new CoachInvitationsError("aborted");
            if (name !== "list_own_pending_coach_invitations") throw new CoachInvitationsError("invalid_input");
            const row = exactRecord(args, ["p_query", "p_limit", "p_cursor_created_at", "p_cursor_id"], "invalid_input");
            if ((row.p_cursor_created_at === null) !== (row.p_cursor_id === null)) throw new CoachInvitationsError("invalid_input");
            const params = pendingInvitationsParameters({ query: row.p_query as string, limit: row.p_limit as number,
              cursor: row.p_cursor_id === null ? null : { id: row.p_cursor_id as string, createdAt: row.p_cursor_created_at as string } });
            if (signal.aborted) throw new CoachInvitationsError("aborted");
            return port.rpc(name, { p_query: params.p_query, p_limit: params.p_limit,
              p_cursor_created_at: params.p_cursor_created_at, p_cursor_id: params.p_cursor_id }, { get: false, head: false }).abortSignal(signal);
          },
        };
      },
    }),
  });
}
