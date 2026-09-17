/** Pure drawing bounds, not a metric calculation. Unknown never draws as zero. */
export function coachChartRatio(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}
