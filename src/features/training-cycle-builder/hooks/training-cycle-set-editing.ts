import type {
  TrainingCycleExerciseDraft,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import { suggestPyramidSetTargets } from "@/features/training-cycle-builder/model/techniques";
import { DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS } from "@/features/training-cycle-builder/model/types";

interface SetEdit {
  readonly setId: string;
  readonly field: "targetKg" | "targetReps";
  readonly value: string;
}

/** Only uniform linear sets can be represented by the compact editor. */
export function hasUniformLinearSets(exercise: TrainingCycleExerciseDraft): boolean {
  const firstSet = exercise.sets[0];
  return exercise.technique === "linear" && Boolean(firstSet) && exercise.sets.every((set) =>
    !set.toFailure && set.drops.length === 0
    && set.targetReps === firstSet.targetReps && set.targetKg === firstSet.targetKg);
}

/** Called only for an explicit linear-mode selection or quick-value application. */
export function applyLinearSetValues(
  exercise: TrainingCycleExerciseDraft,
  targetReps: string,
  targetKg: string,
): TrainingCycleExerciseDraft {
  if (hasUniformLinearSets(exercise)
    && exercise.sets[0].targetReps === targetReps
    && exercise.sets[0].targetKg === targetKg) return exercise;

  return {
    ...exercise,
    technique: "linear",
    recommendationDecision: exercise.recommendationDecision === "ignored" ? "ignored" : "modified",
    sets: exercise.sets.map((set) => ({
      ...set,
      targetReps,
      targetKg,
      toFailure: false,
      drops: [],
    })),
  };
}

/** Edit the draft once; changing the reference load refreshes only load suggestions. */
export function editTrainingCycleSet(
  exercise: TrainingCycleExerciseDraft,
  edit: SetEdit,
): TrainingCycleExerciseDraft {
  const selectedIndex = exercise.sets.findIndex((set) => set.id === edit.setId);
  if (selectedIndex < 0 || exercise.sets[selectedIndex][edit.field] === edit.value) return exercise;

  const text = edit.value.trim();
  const referenceKg = Number(text.replace(",", "."));
  const refreshLoads = selectedIndex === 0
    && edit.field === "targetKg"
    && /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)
    && Number.isFinite(referenceKg)
    && referenceKg <= DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxTargetKg
    // Drops use their own parent set, not the first set of the exercise.
    && exercise.technique !== "drop_set";

  return {
    ...exercise,
    recommendationDecision: exercise.recommendationDecision === "ignored" ? "ignored" : "modified",
    sets: exercise.sets.map((set, index) => {
      if (index === selectedIndex) return { ...set, [edit.field]: edit.value };
      if (!refreshLoads) return set;
      const targetKg = exercise.technique === "ascending" || exercise.technique === "descending"
        // The reps reference is irrelevant here: only targetKg is used.
        ? suggestPyramidSetTargets(referenceKg, 1, index, exercise.technique).targetKg
        : referenceKg;
      return { ...set, targetKg: String(targetKg) };
    }),
  };
}
