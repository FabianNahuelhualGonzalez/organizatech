import { CoachInvitationsError, type CoachInvitationCallOptions } from "./coach-invitations-contract";
import { withCoachInvitationsDeadline } from "./coach-invitations-deadline";
import { uuid } from "./coach-invitations-validation";
import type { CapturedCoachActiveRelationshipsOperation, CoachActiveRelationshipsQuery } from "./coach-active-relationships-contract";
import { mapCoachActiveRelationshipsPage, activeRelationshipsParameters, snapshotCoachActiveRelationshipsQuery } from "./coach-active-relationships-validation";

function safeFailure(error: unknown): CoachInvitationsError {
  try {
    if (error instanceof CoachInvitationsError) return new CoachInvitationsError(Object.getOwnPropertyDescriptor(error, "code")?.value);
  } catch { /* Never return source error messages/causes or invoke accessors. */ }
  return new CoachInvitationsError("unavailable");
}

/** One read per call. No page cache, automatic retries, account discovery or writes. */
export function createCoachActiveRelationshipsRepository(input: {
  readonly captureOperation: (signal: AbortSignal) => PromiseLike<CapturedCoachActiveRelationshipsOperation>;
  readonly timeoutMilliseconds?: number;
}) {
  const timeout = input.timeoutMilliseconds ?? 8_000;
  const captureOperation = input.captureOperation;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new CoachInvitationsError("invalid_input");
  return {
    async listActiveRelationships(value: CoachActiveRelationshipsQuery, options?: CoachInvitationCallOptions) {
      const query = snapshotCoachActiveRelationshipsQuery(value);
      const args = activeRelationshipsParameters(query);
      try {
        return await withCoachInvitationsDeadline(async (signal, assertActive) => {
          const captured = await captureOperation(signal);
          assertActive();
          const identity = Object.freeze({ userId: uuid(captured.identity.userId), generation: captured.identity.generation });
          if (!Number.isSafeInteger(identity.generation) || identity.generation < 0) throw new CoachInvitationsError("invalid_response");
          const assertCurrent = () => {
            assertActive();
            if (!captured.isCurrent(identity)) throw new CoachInvitationsError("operation_stale");
          };
          assertCurrent();
          try {
            const result = await captured.client.rpc("list_own_active_coach_relationships", args, signal);
            assertCurrent();
            const data = result && Object.getOwnPropertyDescriptor(result, "data");
            const error = result && Object.getOwnPropertyDescriptor(result, "error");
            if (!data || !error || !("value" in data) || !("value" in error)) throw new CoachInvitationsError("invalid_response");
            if (error.value !== null) {
              const code = error.value && Object.getOwnPropertyDescriptor(error.value, "code")?.value;
              throw new CoachInvitationsError(code === "42501" ? "forbidden" : code === "22023" ? "invalid_input" : "unavailable");
            }
            const page = mapCoachActiveRelationshipsPage(data.value, query);
            assertCurrent();
            return page;
          } catch (error) { assertCurrent(); throw error; }
        }, timeout, options?.signal);
      } catch (error) { throw safeFailure(error); }
    },
  };
}
