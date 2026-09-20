import type { CoachFeePreset } from "./coach-dashboard-sheet-view";

/** Fixed, approved picker choices, not financial data or calculated estimates. */
export const COACH_FEE_PRESETS: readonly { readonly id: CoachFeePreset; readonly label: string }[] = [
  { id: "25000", label: "$25.000" },
  { id: "35000", label: "$35.000" },
  { id: "50000", label: "$50.000" },
];
