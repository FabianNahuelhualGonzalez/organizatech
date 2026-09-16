import { createSupabaseCoachPreferencesRepository } from "../data/supabase-coach-preferences-repository";
import { createCoachPreferencesController } from "../hooks/coach-preferences-controller";
import type { CoachPreferencesController } from "../hooks/coach-preferences-controller-contract";
import { parseCoachMonthlyFeeInput } from "../model/coach-dashboard-money";

/** Local composition only. The screen owner must create one per identity generation and dispose it. */
export function createCoachPreferencesRuntime(
  input: Parameters<typeof createSupabaseCoachPreferencesRepository>[0],
): CoachPreferencesController {
  const { isCurrent } = input;
  const source = createSupabaseCoachPreferencesRepository(input);
  return createCoachPreferencesController({ source, isCurrent, parseFee: parseCoachMonthlyFeeInput });
}
