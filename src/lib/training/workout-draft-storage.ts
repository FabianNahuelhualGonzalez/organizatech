import type { DataMode } from "@/lib/supabase/session";
import { resolveStableWorkoutStartedAt } from "@/lib/training/exercise-last-performance-loader";

export const WORKOUT_DRAFT_KEY_PREFIX = "organizatech:workout-draft";

export interface WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts> {
  version: number;
  updatedAt: number;
  dataMode: DataMode;
  userKey: string;
  activeRoutineDay: string;
  activeExerciseIndex: number;
  activeWorkoutStartedAt: string;
  hasStartedTraining: boolean;
  readiness: TReadiness;
  exerciseDrafts: TExerciseDrafts;
}

export interface WorkoutDraftStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadWorkoutDraftOptions<TReadiness, TExerciseDrafts> {
  mode: DataMode;
  userId?: string;
  version: number;
  maxAgeMs: number;
  setupDays: readonly string[];
  normalizeReadiness: (value: unknown) => TReadiness;
  normalizeExerciseDrafts: (value: unknown) => TExerciseDrafts;
  now?: () => number;
  createStartedAt?: () => string;
  storage?: WorkoutDraftStorageLike | null;
}

export function getDraftUserKey(mode: DataMode, userId?: string) {
  return mode === "supabase" ? `supabase:${userId ?? "anonymous"}` : "demo:local";
}

export function getWorkoutDraftKey(mode: DataMode, userId?: string) {
  return `${WORKOUT_DRAFT_KEY_PREFIX}:${getDraftUserKey(mode, userId)}`;
}

export function saveWorkoutDraft<TReadiness, TExerciseDrafts>(
  draft: WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts>,
  storage = getWorkoutDraftStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(`${WORKOUT_DRAFT_KEY_PREFIX}:${draft.userKey}`, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function loadWorkoutDraft<TReadiness, TExerciseDrafts>(
  options: LoadWorkoutDraftOptions<TReadiness, TExerciseDrafts>,
): WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts> | null {
  const storage = options.storage ?? getWorkoutDraftStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(getWorkoutDraftKey(options.mode, options.userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<WorkoutDraftStorageRecord<unknown, unknown>>;
    if (!isPlainObject(parsed)) return null;

    const userKey = getDraftUserKey(options.mode, options.userId);
    if (parsed.userKey !== userKey) return null;

    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    const now = options.now?.() ?? Date.now();
    const isExpired = updatedAt === 0 || now - updatedAt > options.maxAgeMs;
    if (parsed.version !== options.version || parsed.dataMode !== options.mode || isExpired) {
      clearWorkoutDraft(options.mode, options.userId, storage);
      return null;
    }

    const startedAt = resolveStableWorkoutStartedAt(parsed.activeWorkoutStartedAt, options.createStartedAt);
    const draft = {
      ...parsed,
      version: options.version,
      updatedAt,
      dataMode: options.mode,
      userKey,
      activeRoutineDay: typeof parsed.activeRoutineDay === "string" && options.setupDays.includes(parsed.activeRoutineDay)
        ? parsed.activeRoutineDay
        : "Lunes",
      activeExerciseIndex: Math.max(0, Number(parsed.activeExerciseIndex) || 0),
      activeWorkoutStartedAt: startedAt.value,
      hasStartedTraining: Boolean(parsed.hasStartedTraining),
      readiness: options.normalizeReadiness(parsed.readiness),
      exerciseDrafts: options.normalizeExerciseDrafts(parsed.exerciseDrafts),
    } satisfies WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts>;

    if (startedAt.wasGenerated) {
      saveWorkoutDraft(draft, storage);
    }

    return draft;
  } catch {
    return null;
  }
}

export function clearWorkoutDraft(
  mode: DataMode,
  userId?: string,
  storage = getWorkoutDraftStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(getWorkoutDraftKey(mode, userId));
    return true;
  } catch {
    return false;
  }
}

function getWorkoutDraftStorage(): WorkoutDraftStorageLike | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
