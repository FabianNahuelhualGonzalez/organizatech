import { calculateCycleDuration } from "./dates";
import { isSupportedYouTubeUrl, normalizeCatalogTerm } from "./catalog";
import {
  DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
  TRAINING_CYCLE_BUILDER_SCHEMA_VERSION,
  WEEKDAYS,
  isMuscleGroup,
  isTrainingGoal,
  isTrainingTechnique,
  isWeekday,
  type TrainingCycleBuilderLimits,
  type TrainingCycleDraft,
  type Weekday,
} from "./types";
import { sortWeekdays } from "./draft";

export type DraftValidationSeverity = "blocking" | "warning";

export type DraftValidationCode =
  | "invalid_schema_version"
  | "invalid_draft_id"
  | "draft_not_editable"
  | "invalid_revision"
  | "invalid_goal"
  | "invalid_start_date"
  | "invalid_end_date"
  | "end_not_after_start"
  | "cycle_span_exceeds_limit"
  | "training_days_empty"
  | "invalid_training_day"
  | "duplicate_training_day"
  | "training_days_out_of_order"
  | "missing_routine"
  | "routine_day_mismatch"
  | "routine_name_too_long"
  | "empty_day"
  | "too_many_exercises"
  | "invalid_exercise_id"
  | "duplicate_entity_id"
  | "invalid_exercise_order"
  | "exercise_name_required"
  | "exercise_name_too_long"
  | "invalid_muscle_group"
  | "invalid_load_basis"
  | "invalid_exercise_source"
  | "invalid_technique"
  | "invalid_video_url"
  | "exercise_without_sets"
  | "too_many_sets"
  | "invalid_set_order"
  | "invalid_target_reps"
  | "invalid_target_kg"
  | "drops_require_drop_set"
  | "too_many_drops"
  | "invalid_drop_order"
  | "invalid_drop_reps"
  | "invalid_drop_kg"
  | "invalid_drop_sequence"
  | "duplicate_exercise_in_day"
  | "muscle_group_single_exercise";

export interface DraftValidationIssue {
  readonly code: DraftValidationCode;
  readonly severity: DraftValidationSeverity;
  readonly path: string;
  readonly detail?: string;
}

export interface DraftValidationResult {
  readonly valid: boolean;
  readonly canActivate: boolean;
  readonly issues: readonly DraftValidationIssue[];
  readonly blockingIssues: readonly DraftValidationIssue[];
  readonly warnings: readonly DraftValidationIssue[];
}

export function validateTrainingCycleDraft(
  draft: TrainingCycleDraft,
  limits: TrainingCycleBuilderLimits = DEFAULT_TRAINING_CYCLE_BUILDER_LIMITS,
): DraftValidationResult {
  const issues: DraftValidationIssue[] = [];
  const add = (
    code: DraftValidationCode,
    severity: DraftValidationSeverity,
    path: string,
    detail?: string,
  ) => issues.push(detail ? { code, severity, path, detail } : { code, severity, path });

  if (draft.schemaVersion !== TRAINING_CYCLE_BUILDER_SCHEMA_VERSION) {
    add("invalid_schema_version", "blocking", "schemaVersion");
  }
  if (!draft.draftId.trim()) add("invalid_draft_id", "blocking", "draftId");
  if (draft.status !== "draft") add("draft_not_editable", "blocking", "status");
  if (!Number.isSafeInteger(draft.revision) || draft.revision < 1) {
    add("invalid_revision", "blocking", "revision");
  }
  if (!isTrainingGoal(draft.goal)) add("invalid_goal", "blocking", "goal");

  const duration = calculateCycleDuration(draft.startDate, draft.endDate, limits.maxCycleSpanDays);
  if (!duration.valid) {
    const codeByReason = {
      invalid_start_date: "invalid_start_date",
      invalid_end_date: "invalid_end_date",
      end_not_after_start: "end_not_after_start",
      span_exceeds_limit: "cycle_span_exceeds_limit",
    } as const;
    add(codeByReason[duration.reason], "blocking", "endDate");
  }

  if (draft.selectedDays.length === 0) add("training_days_empty", "blocking", "selectedDays");
  const validSelectedDays: Weekday[] = [];
  const seenDays = new Set<Weekday>();
  draft.selectedDays.forEach((day, index) => {
    if (!isWeekday(day)) {
      add("invalid_training_day", "blocking", `selectedDays.${index}`);
      return;
    }
    if (seenDays.has(day)) {
      add("duplicate_training_day", "blocking", `selectedDays.${index}`, day);
      return;
    }
    seenDays.add(day);
    validSelectedDays.push(day);
  });
  if (
    validSelectedDays.length === draft.selectedDays.length
    && !sameDays(validSelectedDays, sortWeekdays(validSelectedDays))
  ) {
    add("training_days_out_of_order", "blocking", "selectedDays");
  }

  const entityIds = new Set<string>();
  const weeklyMuscles = new Map<string, number>();
  for (const day of validSelectedDays) {
    const routine = draft.routines[day];
    const routinePath = `routines.${day}`;
    if (!routine) {
      add("missing_routine", "blocking", routinePath);
      continue;
    }
    if (routine.day !== day) add("routine_day_mismatch", "blocking", `${routinePath}.day`);
    if (routine.name.length > limits.maxRoutineNameLength) {
      add("routine_name_too_long", "blocking", `${routinePath}.name`);
    }
    if (routine.exercises.length === 0) add("empty_day", "warning", `${routinePath}.exercises`);
    if (routine.exercises.length > limits.maxExercisesPerDay) {
      add("too_many_exercises", "blocking", `${routinePath}.exercises`);
    }

    const dayNames = new Map<string, number>();
    routine.exercises.forEach((exercise, exerciseIndex) => {
      const exercisePath = `${routinePath}.exercises.${exerciseIndex}`;
      validateEntityId(exercise.id, `${exercisePath}.id`, entityIds, add, "invalid_exercise_id");
      if (exercise.order !== exerciseIndex + 1) {
        add("invalid_exercise_order", "blocking", `${exercisePath}.order`);
      }
      if (!exercise.name.trim()) add("exercise_name_required", "blocking", `${exercisePath}.name`);
      if (exercise.name.length > limits.maxExerciseNameLength) {
        add("exercise_name_too_long", "blocking", `${exercisePath}.name`);
      }
      if (!isMuscleGroup(exercise.primaryMuscleGroup)) {
        add("invalid_muscle_group", "blocking", `${exercisePath}.primaryMuscleGroup`);
      } else {
        weeklyMuscles.set(
          exercise.primaryMuscleGroup,
          (weeklyMuscles.get(exercise.primaryMuscleGroup) ?? 0) + 1,
        );
      }
      if (exercise.loadBasis !== "external" && exercise.loadBasis !== "bodyweight") {
        add("invalid_load_basis", "blocking", `${exercisePath}.loadBasis`);
      }
      if (!hasValidSource(exercise.source)) {
        add("invalid_exercise_source", "blocking", `${exercisePath}.source`);
      }
      if (!isTrainingTechnique(exercise.technique)) {
        add("invalid_technique", "blocking", `${exercisePath}.technique`);
      }
      if (exercise.videoUrl !== null && !isSupportedYouTubeUrl(exercise.videoUrl)) {
        add("invalid_video_url", "blocking", `${exercisePath}.videoUrl`);
      }
      if (exercise.sets.length === 0) add("exercise_without_sets", "blocking", `${exercisePath}.sets`);
      if (exercise.sets.length > limits.maxSetsPerExercise) {
        add("too_many_sets", "blocking", `${exercisePath}.sets`);
      }

      const normalizedName = normalizeCatalogTerm(exercise.name);
      if (normalizedName) dayNames.set(normalizedName, (dayNames.get(normalizedName) ?? 0) + 1);
      exercise.sets.forEach((set, setIndex) => {
        const setPath = `${exercisePath}.sets.${setIndex}`;
        validateEntityId(set.id, `${setPath}.id`, entityIds, add, "duplicate_entity_id");
        if (set.order !== setIndex + 1) add("invalid_set_order", "blocking", `${setPath}.order`);
        if (!isBoundedInteger(set.targetReps, 1, limits.maxTargetReps)) {
          add("invalid_target_reps", "blocking", `${setPath}.targetReps`);
        }
        if (!isBoundedNumber(set.targetKg, 0, limits.maxTargetKg)) {
          add("invalid_target_kg", "blocking", `${setPath}.targetKg`);
        }
        if (set.drops.length > 0 && exercise.technique !== "drop_set") {
          add("drops_require_drop_set", "blocking", `${setPath}.drops`);
        }
        if (set.drops.length > limits.maxDropsPerSet) {
          add("too_many_drops", "blocking", `${setPath}.drops`);
        }
        set.drops.forEach((drop, dropIndex) => {
          const dropPath = `${setPath}.drops.${dropIndex}`;
          validateEntityId(drop.id, `${dropPath}.id`, entityIds, add, "duplicate_entity_id");
          if (drop.order !== dropIndex + 1) add("invalid_drop_order", "blocking", `${dropPath}.order`);
          if (!isBoundedInteger(drop.reps, 1, limits.maxTargetReps)) {
            add("invalid_drop_reps", "blocking", `${dropPath}.reps`);
          }
          if (!isBoundedNumber(drop.kg, 0, limits.maxTargetKg)) {
            add("invalid_drop_kg", "blocking", `${dropPath}.kg`);
          }
          const previousKg = dropIndex === 0 ? set.targetKg : set.drops[dropIndex - 1].kg;
          if (Number.isFinite(drop.kg) && Number.isFinite(previousKg) && drop.kg >= previousKg) {
            add("invalid_drop_sequence", "blocking", `${dropPath}.kg`);
          }
        });
      });
    });

    for (const [name, count] of dayNames) {
      if (count > 1) add("duplicate_exercise_in_day", "warning", `${routinePath}.exercises`, name);
    }
  }

  for (const [muscle, count] of weeklyMuscles) {
    if (count === 1) add("muscle_group_single_exercise", "warning", "routines", muscle);
  }

  const blockingIssues = issues.filter((issue) => issue.severity === "blocking");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    valid: blockingIssues.length === 0,
    canActivate: blockingIssues.length === 0 && draft.status === "draft",
    issues,
    blockingIssues,
    warnings,
  };
}

type AddIssue = (
  code: DraftValidationCode,
  severity: DraftValidationSeverity,
  path: string,
  detail?: string,
) => void;

function validateEntityId(
  id: string,
  path: string,
  seen: Set<string>,
  add: AddIssue,
  emptyCode: DraftValidationCode,
) {
  if (!id.trim()) {
    add(emptyCode, "blocking", path);
    return;
  }
  if (seen.has(id)) add("duplicate_entity_id", "blocking", path, id);
  else seen.add(id);
}

function hasValidSource(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (source.kind === "catalog") {
    return typeof source.catalogExerciseId === "string"
      && source.catalogExerciseId.trim().length > 0
      && source.customExerciseId === undefined;
  }
  if (source.kind === "custom") {
    return typeof source.customExerciseId === "string"
      && source.customExerciseId.trim().length > 0
      && source.catalogExerciseId === undefined;
  }
  return false;
}

function isBoundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isBoundedNumber(value: number, minimum: number, maximum: number): boolean {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function sameDays(left: readonly Weekday[], right: readonly Weekday[]): boolean {
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

export function getUnselectedRetainedDays(draft: TrainingCycleDraft): readonly Weekday[] {
  const selected = new Set(draft.selectedDays);
  return WEEKDAYS.filter((day) => !selected.has(day) && Boolean(draft.routines[day]));
}
