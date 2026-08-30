import { normalizeCatalogTerm } from "./catalog";
import {
  MUSCLE_GROUPS,
  type MuscleGroup,
  type TrainingCycleDraft,
  type Weekday,
} from "./types";

export interface MuscleDistributionEntry {
  readonly muscleGroup: MuscleGroup;
  readonly exerciseCount: number;
}

export interface DayMuscleDistribution {
  readonly day: Weekday;
  readonly exerciseCount: number;
  readonly groups: readonly MuscleDistributionEntry[];
}

export type MuscleDistributionWarning =
  | { readonly code: "empty_day"; readonly day: Weekday }
  | { readonly code: "duplicate_exercise_in_day"; readonly day: Weekday; readonly exerciseName: string; readonly count: number }
  | { readonly code: "muscle_group_single_exercise"; readonly muscleGroup: MuscleGroup };

export interface MuscleDistribution {
  readonly days: readonly DayMuscleDistribution[];
  readonly week: readonly MuscleDistributionEntry[];
  readonly warnings: readonly MuscleDistributionWarning[];
  readonly balancedUnderCurrentRules: boolean;
}

/** Cada ejercicio suma exactamente una vez, sólo a su grupo muscular principal. */
export function calculateMuscleDistribution(draft: TrainingCycleDraft): MuscleDistribution {
  const weeklyCounts = emptyMuscleCounts();
  const warnings: MuscleDistributionWarning[] = [];
  const days = draft.selectedDays.map((day) => {
    const routine = draft.routines[day];
    const counts = emptyMuscleCounts();
    const exercises = routine?.exercises ?? [];
    if (exercises.length === 0) warnings.push({ code: "empty_day", day });

    const names = new Map<string, { display: string; count: number }>();
    for (const exercise of exercises) {
      counts[exercise.primaryMuscleGroup] += 1;
      weeklyCounts[exercise.primaryMuscleGroup] += 1;
      const normalizedName = normalizeCatalogTerm(exercise.name);
      if (normalizedName) {
        const current = names.get(normalizedName);
        names.set(normalizedName, {
          display: current?.display ?? exercise.name,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
    for (const { display, count } of names.values()) {
      if (count > 1) {
        warnings.push({ code: "duplicate_exercise_in_day", day, exerciseName: display, count });
      }
    }
    return {
      day,
      exerciseCount: exercises.length,
      groups: toEntries(counts),
    };
  });

  for (const muscleGroup of MUSCLE_GROUPS) {
    if (weeklyCounts[muscleGroup] === 1) {
      warnings.push({ code: "muscle_group_single_exercise", muscleGroup });
    }
  }
  return {
    days,
    week: toEntries(weeklyCounts),
    warnings,
    balancedUnderCurrentRules: warnings.length === 0,
  };
}

function emptyMuscleCounts(): Record<MuscleGroup, number> {
  return Object.fromEntries(MUSCLE_GROUPS.map((group) => [group, 0])) as Record<MuscleGroup, number>;
}

function toEntries(counts: Record<MuscleGroup, number>): MuscleDistributionEntry[] {
  const order = new Map(MUSCLE_GROUPS.map((group, index) => [group, index]));
  return MUSCLE_GROUPS
    .filter((muscleGroup) => counts[muscleGroup] > 0)
    .map((muscleGroup) => ({ muscleGroup, exerciseCount: counts[muscleGroup] }))
    .sort((left, right) => (
      right.exerciseCount - left.exerciseCount
      || (order.get(left.muscleGroup) ?? 0) - (order.get(right.muscleGroup) ?? 0)
    ));
}
