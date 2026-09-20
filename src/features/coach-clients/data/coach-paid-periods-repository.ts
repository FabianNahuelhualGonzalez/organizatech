import { CoachInvitationsError } from "./coach-invitations-contract";
import { withCoachInvitationsDeadline } from "./coach-invitations-deadline";
import {
  CoachPaidPeriodsError,
  type CapturedCoachPaidPeriodsOperation, type CoachPaidPeriodCallOptions,
  type CoachPaidPeriodConfirmInput, type CoachPaidPeriodCorrectInput,
  type CoachPaidPeriodsErrorCode, type CoachPaidPeriodsPinnedClient, type CoachPaidPeriodsRpcName,
  type CoachPaidPeriodsSupabaseRpcPort,
} from "./coach-paid-periods-contract";
import {
  mapCoachPaidPeriodRead, mapCoachPaidPeriodReceipt, mapCoachPaidPeriodWrite,
  paidDates, paidRecord, paidRpcEnvelope, paidUuid,
} from "./coach-paid-periods-validation";

const rpcParameters: Readonly<Record<CoachPaidPeriodsRpcName, readonly string[]>> = {
  confirm_own_coach_paid_period: ["p_episode_id", "p_start", "p_end", "p_expected_version", "p_request_id"],
  correct_own_coach_paid_period: ["p_episode_id", "p_period_id", "p_start", "p_end", "p_expected_version", "p_request_id"],
  read_own_coach_paid_period: ["p_episode_id"],
  read_own_coach_paid_period_operation: ["p_request_id"],
};

function rpcFailure(error: unknown): CoachPaidPeriodsError {
  try {
    const code = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
    const message = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined;
    switch (code) {
      case "42501": return new CoachPaidPeriodsError("forbidden");
      case "P0002": return new CoachPaidPeriodsError("not_found");
      case "55000": return new CoachPaidPeriodsError("inactive_relationship");
      case "22023": return new CoachPaidPeriodsError(message === "coach_paid_period_request_conflict" ? "request_conflict" : "invalid_input");
      case "40001": return new CoachPaidPeriodsError(message === "coach_paid_period_version_conflict" ? "version_conflict" : "conflict");
    }
  } catch { /* Never inspect hostile getters or expose arbitrary error details. */ }
  return new CoachPaidPeriodsError("unavailable");
}
function sanitizeFailure(error: unknown): CoachPaidPeriodsError {
  try {
    if (error instanceof CoachPaidPeriodsError || error instanceof CoachInvitationsError) {
      // Reconstruct messages, including errors from the imported shared deadline.
      return new CoachPaidPeriodsError(Object.getOwnPropertyDescriptor(error, "code")?.value as CoachPaidPeriodsErrorCode);
    }
  } catch { return new CoachPaidPeriodsError("unavailable"); }
  return rpcFailure(error);
}

/** Four-RPC adapter around a supplied pinned port. No SDK/Auth construction. */
export function createCoachPaidPeriodsRpcAdapter(client: CoachPaidPeriodsSupabaseRpcPort): CoachPaidPeriodsPinnedClient {
  return {
    async rpc(name, args, signal) {
      try {
        if (signal.aborted) throw new CoachPaidPeriodsError("aborted");
        if (!Object.hasOwn(rpcParameters, name)) throw new CoachPaidPeriodsError("invalid_input");
        const row = paidRecord(args, rpcParameters[name], "invalid_input");
        const dates = Object.hasOwn(row, "p_start") ? paidDates(row.p_start, row.p_end, "invalid_input") : null;
        const params = Object.freeze(Object.fromEntries(rpcParameters[name].map((key) => [key,
          key === "p_start" ? dates!.start : key === "p_end" ? dates!.end : paidUuid(row[key], "invalid_input")])));
        if (signal.aborted) throw new CoachPaidPeriodsError("aborted");
        return await client.rpc(name, params, { get: false, head: false }).abortSignal(signal);
      } catch (error) { throw sanitizeFailure(error); }
    },
  };
}

export function createCoachPaidPeriodsRepository(input: {
  readonly captureOperation: (signal: AbortSignal) => PromiseLike<CapturedCoachPaidPeriodsOperation>;
  readonly timeoutMilliseconds?: number;
}) {
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 8_000;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 30_000) {
    throw new CoachPaidPeriodsError("invalid_input");
  }

  async function call<T>(name: CoachPaidPeriodsRpcName, args: Readonly<Record<string, string>>,
    map: (value: unknown) => T, options?: CoachPaidPeriodCallOptions): Promise<T> {
    try {
      return await withCoachInvitationsDeadline(async (signal, assertActive) => {
        const captured = await input.captureOperation(signal);
        assertActive();
        const row = paidRecord(captured, ["identity", "client", "isCurrent"]);
        const capturedIdentity = paidRecord(row.identity, ["userId", "generation"]);
        const userId = paidUuid(capturedIdentity.userId);
        const generation = capturedIdentity.generation;
        if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 0
          || typeof row.isCurrent !== "function" || !row.client || typeof row.client !== "object") {
          throw new CoachPaidPeriodsError("invalid_response");
        }
        const identity = Object.freeze({ userId, generation });
        const client = row.client as CoachPaidPeriodsPinnedClient;
        const rpc = client.rpc;
        const isCurrent = row.isCurrent;
        if (typeof rpc !== "function") throw new CoachPaidPeriodsError("invalid_response");
        const assertCurrent = () => {
          assertActive();
          if (isCurrent.call(captured, identity) !== true) throw new CoachPaidPeriodsError("operation_stale");
        };
        assertCurrent();
        try {
          const response = await rpc.call(client, name, Object.freeze({ ...args }), signal);
          assertCurrent();
          const result = paidRpcEnvelope(response);
          if (result.error !== null) throw rpcFailure(result.error);
          const mapped = map(result.data);
          assertCurrent();
          return mapped;
        } catch (error) {
          // Rejections and malformed responses must also fail closed after a switch.
          assertCurrent();
          throw error;
        }
      }, timeoutMilliseconds, options?.signal);
    } catch (error) { throw sanitizeFailure(error); }
  }

  function commandInput(value: unknown, correction: boolean) {
    const row = paidRecord(value, correction ? ["episodeId", "periodId", "start", "end", "expectedVersion", "requestId"]
      : ["episodeId", "start", "end", "expectedVersion", "requestId"], "invalid_input");
    return Object.freeze({ episodeId: paidUuid(row.episodeId, "invalid_input"),
      periodId: correction ? paidUuid(row.periodId, "invalid_input") : undefined,
      ...paidDates(row.start, row.end, "invalid_input"), expectedVersion: paidUuid(row.expectedVersion, "invalid_input"),
      requestId: paidUuid(row.requestId, "invalid_input") });
  }
  return {
    async confirmPeriod(value: CoachPaidPeriodConfirmInput, options?: CoachPaidPeriodCallOptions) {
      const expected = commandInput(value, false);
      return call("confirm_own_coach_paid_period", { p_episode_id: expected.episodeId, p_start: expected.start,
        p_end: expected.end, p_expected_version: expected.expectedVersion, p_request_id: expected.requestId },
      (response) => mapCoachPaidPeriodWrite(response, { ...expected, action: "confirm" }), options);
    },
    async correctPeriod(value: CoachPaidPeriodCorrectInput, options?: CoachPaidPeriodCallOptions) {
      const expected = commandInput(value, true);
      return call("correct_own_coach_paid_period", { p_episode_id: expected.episodeId, p_period_id: expected.periodId!,
        p_start: expected.start, p_end: expected.end, p_expected_version: expected.expectedVersion, p_request_id: expected.requestId },
      (response) => mapCoachPaidPeriodWrite(response, { ...expected, action: "correct" }), options);
    },
    async readPeriod(value: string, options?: CoachPaidPeriodCallOptions) {
      const episodeId = paidUuid(value, "invalid_input");
      return call("read_own_coach_paid_period", { p_episode_id: episodeId },
        (response) => mapCoachPaidPeriodRead(response, episodeId), options);
    },
    async readOwnOperation(value: string, options?: CoachPaidPeriodCallOptions) {
      const requestId = paidUuid(value, "invalid_input");
      return call("read_own_coach_paid_period_operation", { p_request_id: requestId },
        (response) => response === null ? null : mapCoachPaidPeriodReceipt(response, { requestId }), options);
    },
  };
}
export type CoachPaidPeriodsRepository = ReturnType<typeof createCoachPaidPeriodsRepository>;
