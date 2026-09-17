import { captureCoachInvitationsOperation } from "./coach-invitations-operation";
import { CoachPaidPeriodsError } from "./coach-paid-periods-contract";
import { createCoachPaidPeriodsRepository, createCoachPaidPeriodsRpcAdapter } from "./coach-paid-periods-repository";
import { createPinnedCoachRpcPort, snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "./coach-public-rpc-runtime";

/** Existing verified principal + four paid-period RPCs. No Auth construction,
 * mutable credentials, automatic writes/retries, UI or environment reads. */
export function createSupabaseCoachPaidPeriodsRepository(input: CoachPublicRpcRuntimeInput) {
  const configuration = (() => {
    try { return snapshotCoachPublicRpcRuntime(input); }
    catch { throw new CoachPaidPeriodsError("invalid_input"); }
  })();
  const { principal, isCurrent, fetch: request } = input;
  return createCoachPaidPeriodsRepository({
    timeoutMilliseconds: input.timeoutMilliseconds,
    captureOperation: (signal) => captureCoachInvitationsOperation({
      principal, identity: configuration.identity, isCurrent, signal,
      createPinnedClient: (accessToken) => createCoachPaidPeriodsRpcAdapter(
        createPinnedCoachRpcPort(configuration, accessToken, request)),
    }),
  });
}
