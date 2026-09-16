import { CoachPaidPeriodsError } from "../../coach-clients/data/coach-paid-periods-contract";
import { paidCivilDate, paidUuid } from "../../coach-clients/data/coach-paid-periods-validation";
import { snapshotCoachPublicRpcRuntime, type CoachPublicRpcRuntimeInput } from "../../coach-clients/data/coach-public-rpc-runtime";
import { createSupabaseCoachPaidPeriodsRepository } from "../../coach-clients/data/supabase-coach-paid-periods-repository";
import { createCoachPaidPeriodController } from "../hooks/coach-paid-period-controller";
import type { CoachPaidPeriodController } from "../hooks/coach-paid-period-controller-contract";

export interface CoachPaidPeriodRuntimeInput {
  readonly connection: CoachPublicRpcRuntimeInput;
  /** Explicit authorized mapping; a renewal row id is not an episode id. */
  readonly selection: { readonly renewalId: string; readonly episodeId: string };
  readonly isSelectionCurrent: (selection: CoachPaidPeriodRuntimeInput["selection"]) => boolean;
  readonly createRequestId: () => string;
}

/** Local composition only. Create per identity/generation + selected episode;
 * the screen owner must dispose it when leaving. No screen, Auth or env creation. */
export function createCoachPaidPeriodRuntime(input: CoachPaidPeriodRuntimeInput): CoachPaidPeriodController {
  const captured = (() => {
    try {
      const configuration = snapshotCoachPublicRpcRuntime(input.connection);
      const { renewalId } = input.selection;
      if (typeof renewalId !== "string" || !renewalId.trim() || renewalId !== renewalId.trim()) {
        throw new CoachPaidPeriodsError("invalid_input");
      }
      return { configuration, selection: Object.freeze({ renewalId,
        episodeId: paidUuid(input.selection.episodeId, "invalid_input") }) };
    } catch { throw new CoachPaidPeriodsError("invalid_input"); }
  })();
  const { principal, isCurrent: identityIsCurrent, fetch: request, timeoutMilliseconds } = input.connection;
  const { isSelectionCurrent, createRequestId } = input;
  const { configuration, selection } = captured;
  let invalidated = false;
  // Both the repository (Auth/transport boundaries) and consumer share this latch.
  // A stale selection observed during capture cannot revive before a late response.
  const isCurrent = () => {
    if (invalidated) return false;
    try {
      if (identityIsCurrent(configuration.identity) !== true || isSelectionCurrent(selection) !== true) invalidated = true;
    } catch { invalidated = true; }
    return !invalidated;
  };
  const source = createSupabaseCoachPaidPeriodsRepository({
    configuration: { url: configuration.url, publicKey: configuration.publicKey },
    expectedIdentity: configuration.identity, principal, isCurrent,
    fetch: request, timeoutMilliseconds,
  });
  return createCoachPaidPeriodController({ selection, isCurrent, source,
    createRequestId: () => paidUuid(createRequestId(), "invalid_input"),
    validation: { isValidDateKey: (value) => {
      try { paidCivilDate(value, "invalid_input"); return true; } catch { return false; }
    } },
  });
}
