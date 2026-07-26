export const TRAINING_CYCLE_IDS = [
  "macro",
  "meso",
  "micro",
  "session",
] as const;

export type TrainingCycleId =
  (typeof TRAINING_CYCLE_IDS)[number];

export function isTrainingCycleId(
  value: unknown,
): value is TrainingCycleId {
  return typeof value === "string"
    && TRAINING_CYCLE_IDS.some((cycleId) => cycleId === value);
}
