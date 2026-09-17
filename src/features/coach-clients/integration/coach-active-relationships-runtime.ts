import { snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "../data/coach-public-rpc-runtime";
import { createSupabaseCoachActiveRelationshipsRepository } from "../data/supabase-coach-active-relationships-repository";
import { createCoachActiveRelationshipsController } from "../hooks/coach-active-relationships-controller";
import type { CoachActiveRelationshipsController } from "../hooks/coach-active-relationships-controller-contract";

export interface CoachActiveRelationshipsRuntimeInput {
  readonly connection: CoachPublicRpcRuntimeInput;
  /** Technical page size, never a limit on the Coach's portfolio. */
  readonly pageSize?: number;
}

/** Read-only composition; no screen, global store, Auth listener or environment access.
 * The screen owner must dispose/invalidate on exit, context or membership changes. */
export function createCoachActiveRelationshipsRuntime(input: CoachActiveRelationshipsRuntimeInput): CoachActiveRelationshipsController {
  const configuration = snapshotCoachPublicRpcRuntime(input.connection);
  const { principal, isCurrent: identityIsCurrent, fetch: request, timeoutMilliseconds } = input.connection;
  let invalidated = false;
  // An observed account/generation change cannot revive this controller or source.
  const isCurrent = () => {
    if (invalidated) return false;
    try { if (identityIsCurrent(configuration.identity) !== true) invalidated = true; }
    catch { invalidated = true; }
    return !invalidated;
  };
  const repository = createSupabaseCoachActiveRelationshipsRepository({
    configuration: { url: configuration.url, publicKey: configuration.publicKey },
    expectedIdentity: configuration.identity, principal, isCurrent,
    fetch: request, timeoutMilliseconds,
  });
  return createCoachActiveRelationshipsController({
    pageSize: input.pageSize, isCurrent,
    // The repository validates and freezes the minimal DTO before this port.
    source: { list: (query, options) => repository.listActiveRelationships(query, options) },
  });
}
