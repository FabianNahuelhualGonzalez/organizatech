import type { ExerciseTemplate } from "@/lib/progress/types";

export function dedupeExercisesByDayAndRoutine(exercises: ExerciseTemplate[]) {
  const seen = new Set<string>();

  return exercises.filter((exercise) => {
    const key = createExercisePlacementKey(exercise);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getExercisesForTrainingDay(exercises: ExerciseTemplate[], day: string) {
  return dedupeExercisesByDayAndRoutine(
    exercises.filter((exercise) => (exercise.day ?? day) === day),
  );
}

export function dedupeExerciseRowsByName<T extends { name: string }>(rows: T[]) {
  const seen = new Set<string>();

  return rows.filter((row) => {
    const key = normalizeExerciseValue(row.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getRemovedExerciseIds(
  exercises: ExerciseTemplate[],
  day: string,
  retainedIds: Set<string>,
) {
  return exercises
    .filter((exercise) => (exercise.day ?? "Lunes") === day)
    .filter((exercise) => !retainedIds.has(exercise.id))
    .map((exercise) => exercise.id);
}

function createExercisePlacementKey(exercise: ExerciseTemplate) {
  return [
    exercise.cycleDayId
      ? `cycle-day:${exercise.cycleDayId}`
      : `legacy-day:${normalizeExerciseValue(exercise.day ?? "Lunes")}`,
    normalizeExerciseValue(exercise.routine),
    normalizeExerciseValue(exercise.name),
  ].join(":");
}

function normalizeExerciseValue(value: string) {
  return value.trim().toLocaleLowerCase("es");
}
