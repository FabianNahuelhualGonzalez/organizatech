import type { DataMode } from "@/lib/supabase/session";
import {
  clearWorkoutDraft,
  getDraftUserKey,
  loadWorkoutDraft,
  saveWorkoutDraft,
  type LoadedWorkoutDraftStorageRecord,
  type PendingWorkoutReadinessLink,
  type WorkoutDraftStorageLike,
  type WorkoutDraftStorageRecord,
} from "@/lib/training/workout-draft-storage";
import {
  normalizeExerciseDrafts,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";
import {
  normalizeTrainingReadiness,
  type TrainingReadiness,
} from "@/lib/training/training-readiness-draft";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";

export const ACTIVE_WORKOUT_DRAFT_VERSION = 1;
export const ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ActiveWorkoutDraftContext = {
  workoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
  cycleId: string | null;
  cycleDayId: string | null;
  plannedDay: string | null;
  plannedDate: string | null;
};

export type ActiveWorkoutDraft = Omit<
  WorkoutDraftStorageRecord<TrainingReadiness | null, Record<string, ExerciseDraft>>,
  keyof ActiveWorkoutDraftContext
> & ActiveWorkoutDraftContext;

export type LoadedActiveWorkoutDraft = LoadedWorkoutDraftStorageRecord<
  TrainingReadiness | null,
  Record<string, ExerciseDraft>
>;

export type ActiveWorkoutDraftSnapshotInput = Omit<
  ActiveWorkoutDraft,
  "version" | "userKey"
> & {
  userId?: string;
};

export function buildActiveWorkoutDraftSnapshot(
  input: ActiveWorkoutDraftSnapshotInput,
): ActiveWorkoutDraft | null {
  const userKey = getDraftUserKey(input.dataMode, input.userId);
  if (!userKey) return null;

  return {
    version: ACTIVE_WORKOUT_DRAFT_VERSION,
    updatedAt: input.updatedAt,
    dataMode: input.dataMode,
    userKey,
    activeRoutineDay: input.activeRoutineDay,
    activeExerciseIndex: input.activeExerciseIndex,
    activeWorkoutStartedAt: input.activeWorkoutStartedAt,
    hasStartedTraining: input.hasStartedTraining,
    readiness: input.readiness ? { ...input.readiness } : null,
    exerciseDrafts: cloneExerciseDrafts(input.exerciseDrafts),
    workoutAttemptId: input.workoutAttemptId,
    pendingReadinessLink: input.pendingReadinessLink
      ? { ...input.pendingReadinessLink }
      : null,
    cycleId: input.cycleId,
    cycleDayId: input.cycleDayId,
    plannedDay: input.plannedDay,
    plannedDate: input.plannedDate,
  };
}

export function saveActiveWorkoutDraft(
  input: ActiveWorkoutDraftSnapshotInput,
  storage?: WorkoutDraftStorageLike | null,
): boolean {
  const draft = buildActiveWorkoutDraftSnapshot(input);
  if (!draft) return false;
  return saveWorkoutDraft(draft, storage);
}

export function loadActiveWorkoutDraft(
  mode: DataMode,
  userId?: string,
  options: {
    now?: () => number;
    createStartedAt?: () => string;
    storage?: WorkoutDraftStorageLike | null;
  } = {},
): LoadedActiveWorkoutDraft | null {
  return loadWorkoutDraft({
    mode,
    userId,
    version: ACTIVE_WORKOUT_DRAFT_VERSION,
    maxAgeMs: ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS,
    setupDays: TRAINING_DAY_LABELS,
    normalizeReadiness: normalizeTrainingReadiness,
    normalizeExerciseDrafts,
    now: options.now,
    createStartedAt: options.createStartedAt,
    storage: options.storage,
  });
}

export function clearActiveWorkoutDraft(
  mode: DataMode,
  userId?: string,
  storage?: WorkoutDraftStorageLike | null,
): boolean {
  return clearWorkoutDraft(mode, userId, storage);
}

function cloneExerciseDrafts(
  drafts: Record<string, ExerciseDraft>,
): Record<string, ExerciseDraft> {
  return Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [
    id,
    { ...draft, reps: [...draft.reps] },
  ]));
}
