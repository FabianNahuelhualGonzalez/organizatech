import { incrementDraftRevision } from "./draft";
import { clampNumber, roundToIncrement } from "./numbers";
import type { DraftOperationReason, DraftOperationResult } from "./operations";
import {
  DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
  type ExerciseDraft,
  type SetDraft,
  type TrainingCycleBuilderLimits,
  type TrainingCycleDraft,
  type TrainingTechnique,
  type Weekday,
} from "./types";

export interface TechniquePresetPolicy {
  readonly loadIncrementKg: number;
  readonly pyramidLoadStepRatio: number;
  readonly pyramidRepsStep: number;
  readonly dropLoadRatio: number;
  readonly defaultDropReps: number;
}

export const DEFAULT_TECHNIQUE_PRESET_POLICY: TechniquePresetPolicy = Object.freeze({
  loadIncrementKg: 0.5,
  pyramidLoadStepRatio: 0.1,
  pyramidRepsStep: 2,
  dropLoadRatio: 0.8,
  defaultDropReps: 8,
});

export interface ApplyTechniqueOptions {
  /** Necesario al entrar a drop set si aún no existe un descenso. */
  readonly dropIdNamespace?: string;
  readonly policy?: TechniquePresetPolicy;
  readonly limits?: TrainingCycleBuilderLimits;
}

type PyramidTechnique = Extract<TrainingTechnique, "ascending" | "descending">;

export interface PyramidSetTargets {
  readonly targetKg: number;
  readonly targetReps: number;
}

/** Fuente única para las sugerencias piramidales del dominio y del reducer visible. */
export function suggestPyramidSetTargets(
  referenceKg: number,
  referenceReps: number,
  index: number,
  technique: PyramidTechnique,
  policy: TechniquePresetPolicy = DEFAULT_TECHNIQUE_PRESET_POLICY,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): PyramidSetTargets {
  const normalizedIndex = Math.max(0, Math.trunc(index));
  const baseKg = clampNumber(referenceKg, 0, limits.maxTargetKg);
  const baseReps = Math.trunc(clampNumber(referenceReps, 1, limits.maxTargetReps));
  if (normalizedIndex === 0) return { targetKg: baseKg, targetReps: baseReps };

  const multiplier = technique === "ascending"
    ? 1 + policy.pyramidLoadStepRatio * normalizedIndex
    : 1 - policy.pyramidLoadStepRatio * normalizedIndex;
  const targetKg = clampNumber(
    roundToIncrement(
      clampNumber(baseKg * multiplier, 0, limits.maxTargetKg),
      policy.loadIncrementKg,
    ),
    0,
    limits.maxTargetKg,
  );
  const targetReps = technique === "ascending"
    ? Math.max(1, baseReps - policy.pyramidRepsStep * normalizedIndex)
    : Math.min(limits.maxTargetReps, baseReps + policy.pyramidRepsStep * normalizedIndex);
  return { targetKg, targetReps };
}

/** Un descenso siempre parte de la carga de su misma serie o del descenso anterior. */
export function suggestDropTargetKg(
  referenceKg: number,
  policy: TechniquePresetPolicy = DEFAULT_TECHNIQUE_PRESET_POLICY,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): number {
  return clampNumber(
    roundToIncrement(
      clampNumber(referenceKg * policy.dropLoadRatio, 0, limits.maxTargetKg),
      policy.loadIncrementKg,
      "down",
    ),
    0,
    limits.maxTargetKg,
  );
}

export function applyTechniqueToExercise(
  exercise: ExerciseDraft,
  technique: TrainingTechnique,
  options: ApplyTechniqueOptions = {},
): { readonly ok: true; readonly exercise: ExerciseDraft } | {
  readonly ok: false;
  readonly reason: "exercise_without_sets" | "missing_drop_id_namespace" | "invalid_drop_reference" | "invalid_policy";
} {
  if (exercise.sets.length === 0) return { ok: false, reason: "exercise_without_sets" };
  const policy = options.policy ?? DEFAULT_TECHNIQUE_PRESET_POLICY;
  const limits = options.limits ?? DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS;
  if (!isValidPolicy(policy)) return { ok: false, reason: "invalid_policy" };

  const baseSet = exercise.sets[0];
  const baseKg = clampNumber(baseSet.targetKg, 0, limits.maxTargetKg);
  const baseReps = Math.trunc(clampNumber(baseSet.targetReps, 1, limits.maxTargetReps));
  let sets: readonly SetDraft[];

  switch (technique) {
    case "linear":
      sets = exercise.sets.map((set, index) => ({
        ...set,
        order: index + 1,
        targetKg: baseKg,
        targetReps: baseReps,
        toFailure: false,
        drops: [],
      }));
      break;
    case "ascending":
      sets = exercise.sets.map((set, index) => {
        const targets = suggestPyramidSetTargets(baseKg, baseReps, index, technique, policy, limits);
        return {
          ...set,
          order: index + 1,
          ...targets,
          toFailure: false,
          drops: [],
        };
      });
      break;
    case "descending": {
      sets = exercise.sets.map((set, index) => {
        const targets = suggestPyramidSetTargets(baseKg, baseReps, index, technique, policy, limits);
        return {
          ...set,
          order: index + 1,
          ...targets,
          toFailure: false,
          drops: [],
        };
      });
      break;
    }
    case "drop_set": {
      const hasAnyDrop = exercise.sets.some((set) => set.drops.length > 0);
      const namespace = options.dropIdNamespace?.trim();
      if (!hasAnyDrop && !namespace) return { ok: false, reason: "missing_drop_id_namespace" };
      const finalIndex = exercise.sets.length - 1;
      if (!hasAnyDrop && exercise.sets[finalIndex].targetKg <= 0) {
        return { ok: false, reason: "invalid_drop_reference" };
      }
      sets = exercise.sets.map((set, index) => {
        if (hasAnyDrop) {
          return { ...set, order: index + 1, toFailure: set.drops.length > 0 };
        }
        if (index !== finalIndex) return { ...set, order: index + 1, toFailure: false };
        return {
          ...set,
          order: index + 1,
          toFailure: true,
          drops: [{
            id: `${namespace}:drop:1`,
            sourceDropId: null,
            order: 1,
            kg: suggestDropTargetKg(set.targetKg, policy, limits),
            reps: Math.min(limits.maxTargetReps, policy.defaultDropReps),
          }],
        };
      });
      break;
    }
    case "failure":
      sets = exercise.sets.map((set, index) => ({
        ...set,
        order: index + 1,
        targetKg: baseKg,
        toFailure: true,
        drops: [],
      }));
      break;
    default: {
      const exhaustiveCheck: never = technique;
      throw new Error(`Tecnica no reconocida: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }

  return { ok: true, exercise: { ...exercise, technique, sets } };
}

export function applyTechniqueToDraft(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  technique: TrainingTechnique,
  options: ApplyTechniqueOptions = {},
): DraftOperationResult {
  if (draft.status !== "draft") return noChange(draft, "draft_not_editable");
  const routine = draft.routines[day];
  if (!routine) return noChange(draft, "day_not_found");
  const exerciseIndex = routine.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (exerciseIndex < 0) return noChange(draft, "exercise_not_found");
  const result = applyTechniqueToExercise(routine.exercises[exerciseIndex], technique, options);
  if (!result.ok) return noChange(draft, "invalid_value");

  const existingIds = collectIds(draft);
  const oldIds = new Set(collectExerciseIds(routine.exercises[exerciseIndex]));
  const introducedIds = collectExerciseIds(result.exercise).filter((id) => !oldIds.has(id));
  if (introducedIds.some((id) => existingIds.has(id))) return noChange(draft, "id_collision");
  const uniqueIntroduced = new Set(introducedIds);
  if (uniqueIntroduced.size !== introducedIds.length) return noChange(draft, "id_collision");

  const exercises = routine.exercises.map((exercise, index) => (
    index === exerciseIndex ? result.exercise : exercise
  ));
  return {
    draft: incrementDraftRevision(draft, {
      routines: { ...draft.routines, [day]: { ...routine, exercises } },
    }),
    changed: true,
    reason: null,
  };
}

function isValidPolicy(policy: TechniquePresetPolicy): boolean {
  return Number.isFinite(policy.loadIncrementKg)
    && policy.loadIncrementKg > 0
    && Number.isFinite(policy.pyramidLoadStepRatio)
    && policy.pyramidLoadStepRatio > 0
    && Number.isSafeInteger(policy.pyramidRepsStep)
    && policy.pyramidRepsStep > 0
    && Number.isFinite(policy.dropLoadRatio)
    && policy.dropLoadRatio > 0
    && policy.dropLoadRatio < 1
    && Number.isSafeInteger(policy.defaultDropReps)
    && policy.defaultDropReps > 0;
}

function noChange(
  draft: TrainingCycleDraft,
  reason: DraftOperationReason,
): DraftOperationResult {
  return { draft, changed: false, reason };
}

function collectIds(draft: TrainingCycleDraft): Set<string> {
  const result = new Set<string>();
  for (const routine of Object.values(draft.routines)) {
    for (const exercise of routine?.exercises ?? []) {
      for (const id of collectExerciseIds(exercise)) result.add(id);
    }
  }
  return result;
}

function collectExerciseIds(exercise: ExerciseDraft): string[] {
  return [
    exercise.id,
    ...exercise.sets.flatMap((set) => [set.id, ...set.drops.map((drop) => drop.id)]),
  ];
}
