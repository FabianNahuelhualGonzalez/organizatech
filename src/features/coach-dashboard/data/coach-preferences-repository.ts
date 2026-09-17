import {
  CoachPreferencesError,
  type CoachDashboardFee,
  type CoachDashboardPreferences,
  type CoachPreferencesOperation,
  type CoachPreferencesRpcName,
} from "./coach-preferences-contract";
import { withCoachPreferencesDeadline } from "./coach-preferences-deadline";

function recordWithKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoachPreferencesError("invalid_response");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new CoachPreferencesError("invalid_response");
  }
  return record;
}

function safeUnsignedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function mapFee(value: unknown): CoachDashboardFee {
  const row = recordWithKeys(value, ["monthlyFeeClp", "version"]);
  if (!safeUnsignedInteger(row.monthlyFeeClp) || !safeUnsignedInteger(row.version) || row.version === 0) {
    throw new CoachPreferencesError("invalid_response");
  }
  return { monthlyFeeClp: row.monthlyFeeClp, version: row.version };
}

function mapPreferences(value: unknown): CoachDashboardPreferences {
  const row = recordWithKeys(value, ["monthlyFeeClp", "version", "chatInterestRegistered"]);
  if (!safeUnsignedInteger(row.version) || typeof row.chatInterestRegistered !== "boolean"
    || (row.monthlyFeeClp !== null && !safeUnsignedInteger(row.monthlyFeeClp))
    || (row.monthlyFeeClp === null) !== (row.version === 0)) {
    throw new CoachPreferencesError("invalid_response");
  }
  return {
    monthlyFeeClp: row.monthlyFeeClp as number | null,
    version: row.version,
    chatInterestRegistered: row.chatInterestRegistered,
  };
}

export function createCoachPreferencesRepository(input: {
  readonly captureOperation: (signal: AbortSignal) => Promise<CoachPreferencesOperation>;
  readonly timeoutMilliseconds?: number;
}) {
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 8_000;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new CoachPreferencesError("invalid_input");
  }

  async function call<T>(
    name: CoachPreferencesRpcName,
    args: Readonly<Record<string, number>>,
    map: (value: unknown) => T,
  ): Promise<T> {
    const operation = async (signal: AbortSignal) => {
      const captured = await input.captureOperation(signal);
      if (signal.aborted) throw new CoachPreferencesError("timeout");
      if (!captured.isCurrent()) throw new CoachPreferencesError("operation_stale");
      const result = await captured.client.rpc(name, args, signal);
      if (!captured.isCurrent()) throw new CoachPreferencesError("operation_stale");
      if (result.error) {
        const code = result.error.code;
        throw new CoachPreferencesError(code === "40001" ? "version_conflict"
          : code === "42501" ? "forbidden" : code === "22023" ? "invalid_input" : "unavailable");
      }
      return map(result.data);
    };
    try {
      return await withCoachPreferencesDeadline(operation, timeoutMilliseconds);
    } catch (error) {
      if (error instanceof CoachPreferencesError) throw error;
      throw new CoachPreferencesError("unavailable");
    }
  }

  return {
    read: () => call("read_own_coach_dashboard_preferences", {}, mapPreferences),
    saveFee: (value: { readonly monthlyFeeClp: number; readonly expectedVersion: number }) => {
      // Explicit allowlist: reject extra keys instead of silently accepting form objects.
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== 2
        || !Object.hasOwn(value, "monthlyFeeClp") || !Object.hasOwn(value, "expectedVersion")
        || !safeUnsignedInteger(value.monthlyFeeClp) || !safeUnsignedInteger(value.expectedVersion)
        || value.expectedVersion === Number.MAX_SAFE_INTEGER) {
        return Promise.reject(new CoachPreferencesError("invalid_input"));
      }
      return call("save_own_coach_dashboard_fee", {
        p_monthly_fee_clp: value.monthlyFeeClp,
        p_expected_version: value.expectedVersion,
      }, (response) => {
        const fee = mapFee(response);
        if (fee.monthlyFeeClp !== value.monthlyFeeClp || fee.version !== value.expectedVersion + 1) {
          throw new CoachPreferencesError("invalid_response");
        }
        return fee;
      });
    },
    registerChatInterest: () => call("register_own_coach_chat_interest", {}, (value) => {
      const row = recordWithKeys(value, ["chatInterestRegistered"]);
      if (row.chatInterestRegistered !== true) throw new CoachPreferencesError("invalid_response");
      return { chatInterestRegistered: true as const };
    }),
  };
}
