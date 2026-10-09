import {
  CoachChatInterestError,
  type CoachChatInterest,
  type CoachChatInterestOperation,
  type CoachChatInterestRpcName,
} from "./coach-chat-interest-contract";

function mapInterest(value: unknown): CoachChatInterest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoachChatInterestError("invalid_response");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !Object.hasOwn(row, "chatInterestRegistered")
    || typeof row.chatInterestRegistered !== "boolean") {
    throw new CoachChatInterestError("invalid_response");
  }
  return Object.freeze({ chatInterestRegistered: row.chatInterestRegistered });
}

export function createCoachChatInterestRepository(input: {
  readonly captureOperation: (signal: AbortSignal) => Promise<CoachChatInterestOperation>;
  readonly timeoutMilliseconds?: number;
}) {
  const timeoutMilliseconds = input.timeoutMilliseconds ?? 8_000;
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new CoachChatInterestError("invalid_input");
  }

  async function call(name: CoachChatInterestRpcName): Promise<CoachChatInterest> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CoachChatInterestError("timeout"));
        abort.abort();
      }, timeoutMilliseconds);
    });
    const request = async () => {
      const captured = await input.captureOperation(abort.signal);
      if (abort.signal.aborted) throw new CoachChatInterestError("timeout");
      if (!captured.isCurrent()) throw new CoachChatInterestError("operation_stale");
      const result = await captured.client.rpc(name, {}, abort.signal);
      if (!captured.isCurrent()) throw new CoachChatInterestError("operation_stale");
      if (result.error) {
        throw new CoachChatInterestError(result.error.code === "42501" ? "forbidden" : "unavailable");
      }
      const interest = mapInterest(result.data);
      if (name === "register_own_coach_chat_interest" && !interest.chatInterestRegistered) {
        throw new CoachChatInterestError("invalid_response");
      }
      return interest;
    };
    try {
      return await Promise.race([request(), deadline]);
    } catch (error) {
      if (error instanceof CoachChatInterestError) throw error;
      throw new CoachChatInterestError("unavailable");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return Object.freeze({
    read: () => call("read_own_coach_chat_interest"),
    register: () => call("register_own_coach_chat_interest"),
  });
}
