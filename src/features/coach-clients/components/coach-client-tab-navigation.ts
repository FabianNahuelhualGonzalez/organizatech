import type { CoachClientTab } from "./coach-clients-view";

export const COACH_CLIENT_TABS = ["active", "pending", "inactive"] as const;

/** Keyboard focus geometry only; does not update/filter the client portfolio. */
export function coachClientTabTarget(current: CoachClientTab, key: string): CoachClientTab | null {
  const index = COACH_CLIENT_TABS.indexOf(current);
  if (key === "Home") return COACH_CLIENT_TABS[0];
  if (key === "End") return COACH_CLIENT_TABS[COACH_CLIENT_TABS.length - 1];
  if (key === "ArrowRight") return COACH_CLIENT_TABS[(index + 1) % COACH_CLIENT_TABS.length];
  if (key === "ArrowLeft") return COACH_CLIENT_TABS[(index + COACH_CLIENT_TABS.length - 1) % COACH_CLIENT_TABS.length];
  return null;
}
