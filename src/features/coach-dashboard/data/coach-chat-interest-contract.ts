export interface CoachChatInterest {
  readonly chatInterestRegistered: boolean;
}

export type CoachChatInterestRpcName =
  | "read_own_coach_chat_interest"
  | "register_own_coach_chat_interest";

export interface CoachChatInterestPinnedClient {
  rpc(name: CoachChatInterestRpcName, args: Readonly<Record<string, never>>, signal: AbortSignal):
    PromiseLike<{ readonly data: unknown; readonly error: { readonly code?: string } | null }>;
}

export interface CoachChatInterestOperation {
  readonly client: CoachChatInterestPinnedClient;
  readonly isCurrent: () => boolean;
}

export type CoachChatInterestIssue = "invalid_input" | "invalid_response" | "forbidden"
  | "operation_stale" | "timeout" | "unavailable";

export class CoachChatInterestError extends Error {
  constructor(readonly code: CoachChatInterestIssue) {
    super(`coach-chat-interest-${code}`);
    this.name = "CoachChatInterestError";
  }
}
