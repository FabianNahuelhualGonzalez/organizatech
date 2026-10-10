export const COACH_COMMERCIAL_FREQUENCIES = [
  "daily", "weekly", "monthly", "quarterly", "semiannual", "annual",
] as const;
export type CoachCommercialFrequency = typeof COACH_COMMERCIAL_FREQUENCIES[number];
