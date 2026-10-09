import { createSupabaseCoachChatInterestRepository,
  type CoachChatInterestRuntimeInput } from "../data/supabase-coach-chat-interest-repository";
import { createCoachChatInterestController } from "../hooks/coach-chat-interest-controller";

export function createCoachChatInterestRuntime(input: CoachChatInterestRuntimeInput) {
  return createCoachChatInterestController({
    source: createSupabaseCoachChatInterestRepository(input),
    isCurrent: input.isCurrent,
  });
}
