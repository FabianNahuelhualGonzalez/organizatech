import { captureCoachInvitationsOperation } from "./coach-invitations-operation";
import { createCoachInvitationsRepository, createCoachInvitationsRpcAdapter } from "./coach-invitations-repository";
import { createPinnedCoachRpcPort, snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "./coach-public-rpc-runtime";

/** Isolated real SDK composition. The screen owner provides an existing principal,
 * public configuration and a live account/portal/generation guard. No UI or env I/O. */
export function createSupabaseCoachInvitationsRepository(input: CoachPublicRpcRuntimeInput) {
  const configuration = snapshotCoachPublicRpcRuntime(input);
  const { principal, isCurrent, fetch: request } = input;
  return createCoachInvitationsRepository({
    timeoutMilliseconds: input.timeoutMilliseconds,
    captureOperation: (signal) => captureCoachInvitationsOperation({
      principal, identity: configuration.identity, isCurrent, signal,
      createPinnedClient: (accessToken) => createCoachInvitationsRpcAdapter(
        createPinnedCoachRpcPort(configuration, accessToken, request)),
    }),
  });
}
