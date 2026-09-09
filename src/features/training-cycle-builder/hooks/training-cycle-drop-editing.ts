import type {
  TrainingCycleDropDraft,
  TrainingCycleExerciseDraft,
  TrainingCycleSetDraft,
} from "../components/training-cycle-builder-contracts";
import { DEFAULT_TECHNIQUE_PRESET_POLICY, suggestDropTargetKg } from "../model/techniques";
import { DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS } from "../model/types";

export function parseTrainingCycleDropKg(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
  const kg = Number(text.replace(",", "."));
  return Number.isFinite(kg) && kg <= DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxTargetKg ? kg : null;
}

export function parseTrainingCycleDropReps(value: string): number | null {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return null;
  const reps = Number(text);
  return Number.isSafeInteger(reps) && reps > 0 && reps <= DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS.maxTargetReps ? reps : null;
}

/** Editable load/volume cap, not a fatigue estimate: floor(kg * .8 * min(1, previousReps / reps), .5). */
export function suggestTrainingCycleDropKg(
  previous: Pick<TrainingCycleDropDraft, "targetKg" | "targetReps">,
  targetReps: string,
): number | null {
  const kg = parseTrainingCycleDropKg(previous.targetKg);
  const previousReps = parseTrainingCycleDropReps(previous.targetReps);
  const reps = parseTrainingCycleDropReps(targetReps);
  if (kg === null || kg <= 0 || previousReps === null || reps === null) return null;
  return suggestDropTargetKg(kg * Math.min(1, previousReps / reps));
}

export function createSuggestedTrainingCycleDrop(
  id: string,
  previous: Pick<TrainingCycleDropDraft, "targetKg" | "targetReps">,
): TrainingCycleDropDraft | null {
  const targetReps = String(DEFAULT_TECHNIQUE_PRESET_POLICY.defaultDropReps);
  const targetKg = suggestTrainingCycleDropKg(previous, targetReps);
  if (targetKg === null) return null;
  return {
    id,
    targetKg: String(targetKg),
    targetReps,
    followsPreviousLoad: true,
  };
}

/** Follow only locally generated loads; manual and loaded drops are anchors. */
export function refreshSuggestedTrainingCycleDrops(set: TrainingCycleSetDraft): TrainingCycleSetDraft {
  const drops = [...set.drops];
  let changed = false;
  for (let index = 0; index < drops.length; index += 1) {
    const drop = drops[index];
    if (drop.followsPreviousLoad !== true) continue;
    const suggested = suggestTrainingCycleDropKg(index === 0 ? set : drops[index - 1], drop.targetReps);
    // Unfinished references clear only local suggestions, never a manual anchor.
    const targetKg = suggested === null ? "" : String(suggested);
    if (targetKg === drop.targetKg) continue;
    drops[index] = { ...drop, targetKg };
    changed = true;
  }
  return changed ? { ...set, drops } : set;
}

export function editTrainingCycleDrop(
  exercise: TrainingCycleExerciseDraft,
  edit: { readonly setId: string; readonly dropId: string; readonly field: "targetKg" | "targetReps"; readonly value: string },
): TrainingCycleExerciseDraft {
  const set = exercise.sets.find((candidate) => candidate.id === edit.setId);
  if (!set) return exercise;
  const index = set.drops.findIndex((drop) => drop.id === edit.dropId);
  if (index < 0) return exercise;
  const drop = set.drops[index];
  if (drop[edit.field] === edit.value && (edit.field !== "targetKg" || !drop.followsPreviousLoad)) return exercise;
  // Preserve every typed string. Monotonicity belongs to save validation, not
  // input rejection; manual anchors must not change to accommodate this edit.
  const edited = {
    ...set,
    drops: set.drops.map((candidate) => candidate.id === edit.dropId
      ? { ...candidate, [edit.field]: edit.value, ...(edit.field === "targetKg" ? { followsPreviousLoad: false } : {}) }
      : candidate),
  };
  const refreshed = refreshSuggestedTrainingCycleDrops(edited);
  return {
    ...exercise,
    recommendationDecision: exercise.recommendationDecision === "ignored" ? "ignored" : "modified",
    sets: exercise.sets.map((candidate) => candidate.id === edit.setId ? refreshed : candidate),
  };
}
