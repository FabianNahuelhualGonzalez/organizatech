import {
  exerciseSourceForCatalogEntry,
  normalizeDisplayName,
  type CatalogExercise,
} from "./catalog";
import { roundDecimal } from "./numbers";
import {
  TRAINING_CYCLE_BUILDER_SCHEMA_VERSION,
  WEEKDAYS,
  type DropDraft,
  type ExerciseDraft,
  type PersistedExercisePlan,
  type PersistedTrainingCyclePlan,
  type RoutineDraftsByWeekday,
  type SetDraft,
  type TrainingCycleDraft,
  type TrainingCyclePlanContent,
  type TrainingDayDraft,
  type TrainingGoal,
  type Weekday,
  type DraftOrigin,
} from "./types";

export interface CreateTrainingCycleDraftInput {
  readonly draftId: string;
  readonly origin: DraftOrigin;
  readonly goal: TrainingGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly selectedDays: readonly Weekday[];
  readonly routines?: RoutineDraftsByWeekday;
  readonly sourceSnapshotId?: string | null;
}

export interface CreateExerciseDraftInput {
  readonly exerciseId: string;
  readonly setIds: readonly string[];
  readonly catalogExercise: CatalogExercise;
  readonly targetReps: number;
  readonly targetKg: number;
}

export function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  const selected = new Set(days);
  return WEEKDAYS.filter((day) => selected.has(day));
}

export function createTrainingCycleDraft(input: CreateTrainingCycleDraftInput): TrainingCycleDraft {
  if (!input.draftId.trim()) throw new Error("draftId no puede estar vacio");
  const selectedDays = sortWeekdays(input.selectedDays);
  const routines: Partial<Record<Weekday, TrainingDayDraft>> = {};
  for (const day of WEEKDAYS) {
    const existing = input.routines?.[day];
    if (existing) routines[day] = cloneTrainingDay(existing);
    else if (selectedDays.includes(day)) routines[day] = createEmptyTrainingDay(day);
  }
  return {
    schemaVersion: TRAINING_CYCLE_BUILDER_SCHEMA_VERSION,
    draftId: input.draftId.trim(),
    status: "draft",
    revision: 1,
    origin: input.origin,
    sourceSnapshotId: input.sourceSnapshotId ?? null,
    goal: input.goal,
    startDate: input.startDate,
    endDate: input.endDate,
    selectedDays,
    routines,
  };
}

export function createEmptyTrainingDay(day: Weekday): TrainingDayDraft {
  return { day, name: "", exercises: [] };
}

export function createExerciseDraftFromCatalog(
  input: CreateExerciseDraftInput,
): ExerciseDraft {
  if (!input.exerciseId.trim()) throw new Error("exerciseId no puede estar vacio");
  if (input.setIds.length === 0 || input.setIds.some((id) => !id.trim())) {
    throw new Error("setIds debe contener al menos un id no vacio");
  }
  return {
    id: input.exerciseId.trim(),
    sourceExerciseId: null,
    source: exerciseSourceForCatalogEntry(input.catalogExercise),
    name: normalizeDisplayName(input.catalogExercise.canonicalName),
    primaryMuscleGroup: input.catalogExercise.primaryMuscleGroup,
    loadBasis: input.catalogExercise.loadBasis,
    order: 1,
    technique: "linear",
    videoUrl: input.catalogExercise.videoUrl,
    sets: input.setIds.map((id, index) => createSetDraft(
      id,
      index + 1,
      input.targetReps,
      input.targetKg,
    )),
  };
}

export function createSetDraft(
  id: string,
  order: number,
  targetReps: number,
  targetKg: number,
): SetDraft {
  if (!id.trim()) throw new Error("El id de serie no puede estar vacio");
  return {
    id: id.trim(),
    sourceSetId: null,
    order,
    targetReps,
    targetKg: roundDecimal(targetKg, 3),
    toFailure: false,
    drops: [],
  };
}

export function cloneDrop(drop: DropDraft): DropDraft {
  return { ...drop };
}

export function cloneSet(set: SetDraft): SetDraft {
  return { ...set, drops: set.drops.map(cloneDrop) };
}

export function cloneExercise(exercise: ExerciseDraft): ExerciseDraft {
  return {
    ...exercise,
    source: { ...exercise.source },
    sets: exercise.sets.map(cloneSet),
  };
}

export function cloneTrainingDay(day: TrainingDayDraft): TrainingDayDraft {
  return { ...day, exercises: day.exercises.map(cloneExercise) };
}

export function cloneTrainingCyclePlanContent(
  content: TrainingCyclePlanContent,
): TrainingCyclePlanContent {
  const routines: Partial<Record<Weekday, TrainingDayDraft>> = {};
  for (const day of WEEKDAYS) {
    const routine = content.routines[day];
    if (routine) routines[day] = cloneTrainingDay(routine);
  }
  return {
    goal: content.goal,
    startDate: content.startDate,
    endDate: content.endDate,
    selectedDays: [...content.selectedDays],
    routines,
  };
}

export function cloneTrainingCycleDraft(draft: TrainingCycleDraft): TrainingCycleDraft {
  return {
    ...cloneTrainingCyclePlanContent(draft),
    schemaVersion: draft.schemaVersion,
    draftId: draft.draftId,
    status: draft.status,
    revision: draft.revision,
    origin: draft.origin,
    sourceSnapshotId: draft.sourceSnapshotId,
  };
}

export function incrementDraftRevision(
  draft: TrainingCycleDraft,
  changes: Partial<TrainingCyclePlanContent>,
): TrainingCycleDraft {
  if (draft.status !== "draft") throw new Error("Sólo un borrador editable puede cambiar");
  if (!Number.isSafeInteger(draft.revision) || draft.revision < 1) {
    throw new Error("La revision del borrador es invalida");
  }
  return {
    ...draft,
    ...changes,
    revision: draft.revision + 1,
  };
}

/** Proyección allowlist al shape backend; omite IDs locales, nombres derivados y ownership. */
export function projectDraftToPersistedPlan(draft: TrainingCycleDraft): PersistedTrainingCyclePlan {
  const selectedDays = sortWeekdays(draft.selectedDays);
  return {
    days: selectedDays.map((day, dayIndex) => {
      const routine = draft.routines[day] ?? createEmptyTrainingDay(day);
      return {
        day,
        name: normalizeDisplayName(routine.name),
        order: dayIndex + 1,
        exercises: routine.exercises.map((exercise, exerciseIndex) => projectExercise(
          exercise,
          exerciseIndex + 1,
        )),
      };
    }),
  };
}

function projectExercise(exercise: ExerciseDraft, order: number): PersistedExercisePlan {
  const common = {
    order,
    technique: exercise.technique,
    videoUrl: exercise.videoUrl,
    sets: exercise.sets.map((set, setIndex) => ({
      order: setIndex + 1,
      targetReps: set.targetReps,
      targetKg: roundDecimal(set.targetKg, 3),
      toFailure: set.toFailure,
      drops: set.drops.map((drop, dropIndex) => ({
        order: dropIndex + 1,
        kg: roundDecimal(drop.kg, 3),
        reps: drop.reps,
      })),
    })),
  };
  return exercise.source.kind === "catalog"
    ? { ...common, catalogExerciseId: exercise.source.catalogExerciseId }
    : { ...common, customExerciseId: exercise.source.customExerciseId };
}
