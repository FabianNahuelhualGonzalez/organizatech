export const MAX_TRAINING_EXERCISES_PER_DAY = 20;
export const MAX_TRAINING_SERIES_PER_EXERCISE = 64;

export function exceedsTrainingExerciseLimit(count: number) {
  return !Number.isSafeInteger(count) || count < 0 || count > MAX_TRAINING_EXERCISES_PER_DAY;
}

export function exceedsTrainingSeriesLimit(count: number) {
  return !Number.isSafeInteger(count) || count < 0 || count > MAX_TRAINING_SERIES_PER_EXERCISE;
}
