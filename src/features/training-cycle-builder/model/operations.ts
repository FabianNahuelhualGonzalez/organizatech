import {
  cloneExercise,
  cloneSet,
  createEmptyTrainingDay,
  incrementDraftRevision,
  sortWeekdays,
} from "./draft";
import { normalizeDisplayName } from "./catalog";
import { roundDecimal } from "./numbers";
import {
  DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
  type DropDraft,
  type ExerciseDraft,
  type SetDraft,
  type TrainingCycleBuilderLimits,
  type TrainingCycleDraft,
  type TrainingDayDraft,
  type Weekday,
} from "./types";

export type DraftOperationReason =
  | "draft_not_editable"
  | "day_not_found"
  | "exercise_not_found"
  | "set_not_found"
  | "drop_not_found"
  | "minimum_one_set"
  | "limit_exceeded"
  | "invalid_value"
  | "id_collision"
  | "same_source_and_target"
  | "boundary_reached";

export interface DraftOperationResult {
  readonly draft: TrainingCycleDraft;
  readonly changed: boolean;
  readonly reason: DraftOperationReason | null;
}

export type DayCopyMode = "replace_day" | "append_exercises";

export interface QuickSetConfiguration {
  readonly setCount: number;
  readonly targetReps: number;
  readonly targetKg: number;
  /** Requerido sólo si `setCount` agrega series. */
  readonly newSetIdNamespace?: string;
}

export function setSelectedTrainingDays(
  draft: TrainingCycleDraft,
  days: readonly Weekday[],
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const selectedDays = sortWeekdays(days);
  if (sameArray(selectedDays, draft.selectedDays)) return unchanged(draft);
  const routines = { ...draft.routines };
  for (const day of selectedDays) routines[day] ??= createEmptyTrainingDay(day);
  return changed(draft, { selectedDays, routines });
}

export function toggleSelectedTrainingDay(
  draft: TrainingCycleDraft,
  day: Weekday,
): DraftOperationResult {
  return setSelectedTrainingDays(
    draft,
    draft.selectedDays.includes(day)
      ? draft.selectedDays.filter((candidate) => candidate !== day)
      : [...draft.selectedDays, day],
  );
}

export function renameTrainingDay(
  draft: TrainingCycleDraft,
  day: Weekday,
  name: string,
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const routine = draft.routines[day];
  if (!routine) return unchanged(draft, "day_not_found");
  const normalized = normalizeDisplayName(name);
  if (routine.name === normalized) return unchanged(draft);
  return replaceRoutine(draft, day, { ...routine, name: normalized });
}

export function copyTrainingDay(
  draft: TrainingCycleDraft,
  sourceDay: Weekday,
  targetDay: Weekday,
  mode: DayCopyMode,
  idNamespace: string,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  if (sourceDay === targetDay) return unchanged(draft, "same_source_and_target");
  const source = draft.routines[sourceDay];
  const target = draft.routines[targetDay];
  if (!source || !target) return unchanged(draft, "day_not_found");
  if (!idNamespace.trim()) return unchanged(draft, "invalid_value");
  const targetCount = mode === "replace_day"
    ? source.exercises.length
    : target.exercises.length + source.exercises.length;
  if (targetCount > limits.maxExercisesPerDay) return unchanged(draft, "limit_exceeded");

  const copies = source.exercises.map((exercise, index) => cloneExerciseWithDerivedIds(
    exercise,
    `${idNamespace.trim()}:exercise:${index + 1}`,
  ));
  if (hasAnyIdCollision(draft, copies.flatMap(collectExerciseIds))) {
    return unchanged(draft, "id_collision");
  }
  const exercises = mode === "replace_day"
    ? reindexExercises(copies)
    : reindexExercises([...target.exercises, ...copies]);
  return replaceRoutine(draft, targetDay, {
    day: targetDay,
    name: mode === "replace_day" ? source.name : target.name,
    exercises,
  });
}

export function addExerciseToDay(
  draft: TrainingCycleDraft,
  day: Weekday,
  exercise: ExerciseDraft,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const routine = draft.routines[day];
  if (!routine) return unchanged(draft, "day_not_found");
  if (routine.exercises.length >= limits.maxExercisesPerDay) {
    return unchanged(draft, "limit_exceeded");
  }
  if (hasAnyIdCollision(draft, collectExerciseIds(exercise))) {
    return unchanged(draft, "id_collision");
  }
  const nextExercise = { ...cloneExercise(exercise), order: routine.exercises.length + 1 };
  return replaceRoutine(draft, day, {
    ...routine,
    exercises: [...routine.exercises, nextExercise],
  });
}

export function removeExerciseFromDay(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const routine = draft.routines[day];
  if (!routine) return unchanged(draft, "day_not_found");
  if (!routine.exercises.some((exercise) => exercise.id === exerciseId)) {
    return unchanged(draft, "exercise_not_found");
  }
  return replaceRoutine(draft, day, {
    ...routine,
    exercises: reindexExercises(routine.exercises.filter((exercise) => exercise.id !== exerciseId)),
  });
}

export function moveExercise(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  direction: "up" | "down",
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const routine = draft.routines[day];
  if (!routine) return unchanged(draft, "day_not_found");
  const index = routine.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (index < 0) return unchanged(draft, "exercise_not_found");
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= routine.exercises.length) {
    return unchanged(draft, "boundary_reached");
  }
  const exercises = [...routine.exercises];
  [exercises[index], exercises[targetIndex]] = [exercises[targetIndex], exercises[index]];
  return replaceRoutine(draft, day, { ...routine, exercises: reindexExercises(exercises) });
}

export function duplicateExercise(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  idNamespace: string,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const routine = draft.routines[day];
  if (!routine) return unchanged(draft, "day_not_found");
  if (routine.exercises.length >= limits.maxExercisesPerDay) {
    return unchanged(draft, "limit_exceeded");
  }
  const index = routine.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (index < 0) return unchanged(draft, "exercise_not_found");
  if (!idNamespace.trim()) return unchanged(draft, "invalid_value");
  const copy = cloneExerciseWithDerivedIds(routine.exercises[index], `${idNamespace.trim()}:exercise`);
  if (hasAnyIdCollision(draft, collectExerciseIds(copy))) return unchanged(draft, "id_collision");
  const exercises = [...routine.exercises];
  exercises.splice(index + 1, 0, copy);
  return replaceRoutine(draft, day, { ...routine, exercises: reindexExercises(exercises) });
}

export function configureExerciseSetsQuickly(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  config: QuickSetConfiguration,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  if (
    !Number.isSafeInteger(config.setCount)
    || config.setCount < 1
    || config.setCount > limits.maxSetsPerExercise
    || !Number.isSafeInteger(config.targetReps)
    || config.targetReps < 1
    || config.targetReps > limits.maxTargetReps
    || !Number.isFinite(config.targetKg)
    || config.targetKg < 0
    || config.targetKg > limits.maxTargetKg
  ) return unchanged(draft, "invalid_value");

  return updateExercise(draft, day, exerciseId, (exercise) => {
    const sets = exercise.sets.slice(0, config.setCount).map((set, index) => ({
      ...cloneSet(set),
      order: index + 1,
      targetReps: config.targetReps,
      targetKg: roundDecimal(config.targetKg, 3),
    }));
    if (sets.length < config.setCount) {
      const namespace = config.newSetIdNamespace?.trim();
      if (!namespace) return { ok: false, reason: "invalid_value" } as const;
      for (let index = sets.length; index < config.setCount; index += 1) {
        sets.push({
          id: `${namespace}:set:${index + 1}`,
          sourceSetId: null,
          order: index + 1,
          targetReps: config.targetReps,
          targetKg: roundDecimal(config.targetKg, 3),
          toFailure: false,
          drops: [],
        });
      }
    }
    const newIds = sets.slice(exercise.sets.length).flatMap(collectSetIds);
    if (hasAnyIdCollision(draft, newIds)) return { ok: false, reason: "id_collision" } as const;
    return { ok: true, exercise: { ...exercise, sets } } as const;
  });
}

export function addSetToExercise(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  newSetId: string,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    if (exercise.sets.length >= limits.maxSetsPerExercise) {
      return { ok: false, reason: "limit_exceeded" } as const;
    }
    if (!newSetId.trim() || hasAnyIdCollision(draft, [newSetId])) {
      return { ok: false, reason: !newSetId.trim() ? "invalid_value" : "id_collision" } as const;
    }
    const previous = exercise.sets.at(-1);
    if (!previous) return { ok: false, reason: "minimum_one_set" } as const;
    const set: SetDraft = {
      id: newSetId.trim(),
      sourceSetId: null,
      order: exercise.sets.length + 1,
      targetReps: previous.targetReps,
      targetKg: previous.targetKg,
      toFailure: false,
      drops: [],
    };
    return { ok: true, exercise: { ...exercise, sets: [...exercise.sets, set] } } as const;
  });
}

export function removeSetFromExercise(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index < 0) return { ok: false, reason: "set_not_found" } as const;
    if (exercise.sets.length === 1) return { ok: false, reason: "minimum_one_set" } as const;
    return {
      ok: true,
      exercise: {
        ...exercise,
        sets: reindexSets(exercise.sets.filter((set) => set.id !== setId)),
      },
    } as const;
  });
}

export function duplicateSet(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
  idNamespace: string,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    if (exercise.sets.length >= limits.maxSetsPerExercise) {
      return { ok: false, reason: "limit_exceeded" } as const;
    }
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index < 0) return { ok: false, reason: "set_not_found" } as const;
    const namespace = idNamespace.trim();
    if (!namespace) return { ok: false, reason: "invalid_value" } as const;
    const copy = cloneSetWithDerivedIds(exercise.sets[index], `${namespace}:set`);
    if (hasAnyIdCollision(draft, collectSetIds(copy))) {
      return { ok: false, reason: "id_collision" } as const;
    }
    const sets = [...exercise.sets];
    sets.splice(index + 1, 0, copy);
    return { ok: true, exercise: { ...exercise, sets: reindexSets(sets) } } as const;
  });
}

export function moveSet(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
  direction: "up" | "down",
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index < 0) return { ok: false, reason: "set_not_found" } as const;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= exercise.sets.length) {
      return { ok: false, reason: "boundary_reached" } as const;
    }
    const sets = [...exercise.sets];
    [sets[index], sets[target]] = [sets[target], sets[index]];
    return { ok: true, exercise: { ...exercise, sets: reindexSets(sets) } } as const;
  });
}

export function updateSetTargets(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
  targets: { readonly targetReps: number; readonly targetKg: number },
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  if (
    !Number.isSafeInteger(targets.targetReps)
    || targets.targetReps < 1
    || targets.targetReps > limits.maxTargetReps
    || !Number.isFinite(targets.targetKg)
    || targets.targetKg < 0
    || targets.targetKg > limits.maxTargetKg
  ) return unchanged(draft, "invalid_value");
  return updateExercise(draft, day, exerciseId, (exercise) => {
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index < 0) return { ok: false, reason: "set_not_found" } as const;
    const current = exercise.sets[index];
    const targetKg = roundDecimal(targets.targetKg, 3);
    if (current.targetReps === targets.targetReps && current.targetKg === targetKg) {
      return { ok: true, exercise } as const;
    }
    const sets = exercise.sets.map((set, setIndex) => setIndex === index
      ? { ...set, targetReps: targets.targetReps, targetKg }
      : set);
    return { ok: true, exercise: { ...exercise, sets } } as const;
  });
}

export function toggleSetFailure(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    const index = exercise.sets.findIndex((set) => set.id === setId);
    if (index < 0) return { ok: false, reason: "set_not_found" } as const;
    const sets = exercise.sets.map((set, setIndex) => setIndex === index
      ? { ...set, toFailure: !set.toFailure }
      : set);
    return { ok: true, exercise: { ...exercise, sets } } as const;
  });
}

export function addDropToSet(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
  drop: Omit<DropDraft, "order" | "sourceDropId">,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    if (exercise.technique !== "drop_set") return { ok: false, reason: "invalid_value" } as const;
    const setIndex = exercise.sets.findIndex((set) => set.id === setId);
    if (setIndex < 0) return { ok: false, reason: "set_not_found" } as const;
    const set = exercise.sets[setIndex];
    if (set.drops.length >= limits.maxDropsPerSet) return { ok: false, reason: "limit_exceeded" } as const;
    if (!drop.id.trim()) return { ok: false, reason: "invalid_value" } as const;
    if (hasAnyIdCollision(draft, [drop.id])) return { ok: false, reason: "id_collision" } as const;
    if (
      !Number.isSafeInteger(drop.reps)
      || drop.reps < 1
      || drop.reps > limits.maxTargetReps
      || !Number.isFinite(drop.kg)
      || drop.kg < 0
      || drop.kg > limits.maxTargetKg
    ) return { ok: false, reason: "invalid_value" } as const;
    const nextDrop: DropDraft = {
      id: drop.id.trim(),
      sourceDropId: null,
      order: set.drops.length + 1,
      kg: roundDecimal(drop.kg, 3),
      reps: drop.reps,
    };
    const sets = exercise.sets.map((candidate, index) => index === setIndex
      ? { ...candidate, drops: [...candidate.drops, nextDrop] }
      : candidate);
    return { ok: true, exercise: { ...exercise, sets } } as const;
  });
}

export function removeDropFromSet(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  setId: string,
  dropId: string,
): DraftOperationResult {
  return updateExercise(draft, day, exerciseId, (exercise) => {
    const setIndex = exercise.sets.findIndex((set) => set.id === setId);
    if (setIndex < 0) return { ok: false, reason: "set_not_found" } as const;
    const set = exercise.sets[setIndex];
    if (!set.drops.some((drop) => drop.id === dropId)) {
      return { ok: false, reason: "drop_not_found" } as const;
    }
    const sets = exercise.sets.map((candidate, index) => index === setIndex
      ? {
        ...candidate,
        drops: candidate.drops
          .filter((drop) => drop.id !== dropId)
          .map((drop, dropIndex) => ({ ...drop, order: dropIndex + 1 })),
      }
      : candidate);
    return { ok: true, exercise: { ...exercise, sets } } as const;
  });
}

type ExerciseUpdate =
  | { readonly ok: true; readonly exercise: ExerciseDraft }
  | { readonly ok: false; readonly reason: DraftOperationReason };

function updateExercise(
  draft: TrainingCycleDraft,
  day: Weekday,
  exerciseId: string,
  updater: (exercise: ExerciseDraft) => ExerciseUpdate,
): DraftOperationResult {
  const guard = editableGuard(draft);
  if (guard) return guard;
  const routine = draft.routines[day];
  if (!routine) return unchanged(draft, "day_not_found");
  const index = routine.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (index < 0) return unchanged(draft, "exercise_not_found");
  const update = updater(routine.exercises[index]);
  if (!update.ok) return unchanged(draft, update.reason);
  if (update.exercise === routine.exercises[index]) return unchanged(draft);
  const exercises = routine.exercises.map((exercise, exerciseIndex) => (
    exerciseIndex === index ? update.exercise : exercise
  ));
  return replaceRoutine(draft, day, { ...routine, exercises });
}

function replaceRoutine(
  draft: TrainingCycleDraft,
  day: Weekday,
  routine: TrainingDayDraft,
): DraftOperationResult {
  return changed(draft, { routines: { ...draft.routines, [day]: routine } });
}

function changed(
  draft: TrainingCycleDraft,
  changes: Parameters<typeof incrementDraftRevision>[1],
): DraftOperationResult {
  return { draft: incrementDraftRevision(draft, changes), changed: true, reason: null };
}

function unchanged(
  draft: TrainingCycleDraft,
  reason: DraftOperationReason | null = null,
): DraftOperationResult {
  return { draft, changed: false, reason };
}

function editableGuard(draft: TrainingCycleDraft): DraftOperationResult | null {
  return draft.status === "draft" ? null : unchanged(draft, "draft_not_editable");
}

function reindexExercises(exercises: readonly ExerciseDraft[]): ExerciseDraft[] {
  return exercises.map((exercise, index) => ({ ...exercise, order: index + 1 }));
}

function reindexSets(sets: readonly SetDraft[]): SetDraft[] {
  return sets.map((set, index) => ({ ...set, order: index + 1 }));
}

function cloneExerciseWithDerivedIds(exercise: ExerciseDraft, namespace: string): ExerciseDraft {
  return {
    ...cloneExercise(exercise),
    id: namespace,
    sourceExerciseId: exercise.sourceExerciseId ?? exercise.id,
    sets: exercise.sets.map((set, index) => cloneSetWithDerivedIds(
      set,
      `${namespace}:set:${index + 1}`,
    )),
  };
}

function cloneSetWithDerivedIds(set: SetDraft, namespace: string): SetDraft {
  return {
    ...cloneSet(set),
    id: namespace,
    sourceSetId: set.sourceSetId ?? set.id,
    drops: set.drops.map((drop, index) => ({
      ...drop,
      id: `${namespace}:drop:${index + 1}`,
      sourceDropId: drop.sourceDropId ?? drop.id,
      order: index + 1,
    })),
  };
}

function collectExerciseIds(exercise: ExerciseDraft): string[] {
  return [exercise.id, ...exercise.sets.flatMap(collectSetIds)];
}

function collectSetIds(set: SetDraft): string[] {
  return [set.id, ...set.drops.map((drop) => drop.id)];
}

function collectAllEntityIds(draft: TrainingCycleDraft): Set<string> {
  const ids = new Set<string>();
  for (const routine of Object.values(draft.routines)) {
    for (const exercise of routine?.exercises ?? []) {
      for (const id of collectExerciseIds(exercise)) ids.add(id);
    }
  }
  return ids;
}

function hasAnyIdCollision(draft: TrainingCycleDraft, candidateIds: readonly string[]): boolean {
  const existing = collectAllEntityIds(draft);
  const candidate = new Set<string>();
  for (const id of candidateIds) {
    if (!id.trim() || existing.has(id) || candidate.has(id)) return true;
    candidate.add(id);
  }
  return false;
}

function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
