import type { DataMode } from "@/lib/supabase/session";
import {
  BROWSER_STORAGE_PREFIXES,
  getBrowserStorageScope,
  getBrowserLocalStorage,
  getScopedBrowserStorageKey,
  isBrowserStorageScope,
  migrateLegacyBrowserStorageToDemo,
  readScopedJson,
  removeBrowserStorageItem,
  writeScopedJson,
  type BrowserStorageLike,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";
import { resolveStableWorkoutStartedAt } from "@/lib/training/exercise-last-performance-loader";

export const WORKOUT_DRAFT_KEY_PREFIX = BROWSER_STORAGE_PREFIXES.workoutDraft;

export interface PendingWorkoutReadinessLink {
  workoutAttemptId: string;
  trainingSessionId: string;
}

export interface WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts> {
  version: number;
  updatedAt: number;
  dataMode: DataMode;
  userKey: BrowserStorageScope;
  activeRoutineDay: string;
  activeExerciseIndex: number;
  activeWorkoutStartedAt: string;
  hasStartedTraining: boolean;
  readiness: TReadiness;
  exerciseDrafts: TExerciseDrafts;
  workoutAttemptId?: string | null;
  pendingReadinessLink?: PendingWorkoutReadinessLink | null;
  cycleId?: string | null;
  cycleDayId?: string | null;
  plannedDay?: string | null;
  plannedDate?: string | null;
}

export type LoadedWorkoutDraftStorageRecord<
  TReadiness,
  TExerciseDrafts,
> = Omit<
  WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts>,
  "workoutAttemptId" | "pendingReadinessLink" | "cycleId" | "cycleDayId" | "plannedDay" | "plannedDate"
> & {
  workoutAttemptId: string | null;
  pendingReadinessLink: PendingWorkoutReadinessLink | null;
  cycleId: string | null;
  cycleDayId: string | null;
  plannedDay: string | null;
  plannedDate: string | null;
};

export type WorkoutDraftStorageLike = BrowserStorageLike;

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
  return getBrowserStorageScope(mode, userId);
}

export function getWorkoutDraftKey(mode: DataMode, userId?: string) {
  const scope = getDraftUserKey(mode, userId);
  return scope ? getScopedBrowserStorageKey(WORKOUT_DRAFT_KEY_PREFIX, scope) : null;
}

export function saveWorkoutDraft<TReadiness, TExerciseDrafts>(
  draft: WorkoutDraftStorageRecord<TReadiness, TExerciseDrafts>,
  storage = getBrowserLocalStorage(),
): boolean {
  if (!storage || !isBrowserStorageScope(draft.userKey)) return false;
  return writeScopedJson(storage, getScopedBrowserStorageKey(WORKOUT_DRAFT_KEY_PREFIX, draft.userKey), draft);
}

export function loadWorkoutDraft<TReadiness, TExerciseDrafts>(
  options: LoadWorkoutDraftOptions<TReadiness, TExerciseDrafts>,
): LoadedWorkoutDraftStorageRecord<TReadiness, TExerciseDrafts> | null {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return null;
  migrateLegacyBrowserStorageToDemo(storage);
  const key = getWorkoutDraftKey(options.mode, options.userId);
  const userKey = getDraftUserKey(options.mode, options.userId);
  if (!key || !userKey) return null;

  try {
    const parsed = readScopedJson(storage, key, isPlainObject) as Partial<WorkoutDraftStorageRecord<unknown, unknown>> | null;
    if (!parsed) return null;

    if (parsed.userKey !== userKey) {
      removeBrowserStorageItem(storage, key);
      return null;
    }

    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    const now = options.now?.() ?? Date.now();
    const isExpired = updatedAt === 0 || now - updatedAt > options.maxAgeMs;
    if (parsed.version !== options.version || parsed.dataMode !== options.mode || isExpired) {
      clearWorkoutDraft(options.mode, options.userId, storage);
      return null;
    }

    const workoutAttemptId = normalizeWorkoutAttemptId(parsed);
    if (workoutAttemptId === false) {
      removeBrowserStorageItem(storage, key);
      return null;
    }

    const pendingReadinessLink = normalizePendingReadinessLink(parsed, workoutAttemptId);
    if (pendingReadinessLink === false) {
      removeBrowserStorageItem(storage, key);
      return null;
    }
    const cycleId = normalizeOptionalString(parsed.cycleId);
    const cycleDayId = normalizeOptionalString(parsed.cycleDayId);
    const plannedDay = normalizeOptionalString(parsed.plannedDay);
    const plannedDate = normalizeOptionalString(parsed.plannedDate);
    if (cycleId === false || cycleDayId === false || plannedDay === false || plannedDate === false) {
      removeBrowserStorageItem(storage, key);
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
      workoutAttemptId,
      pendingReadinessLink,
      cycleId,
      cycleDayId,
      plannedDay,
      plannedDate,
    } satisfies LoadedWorkoutDraftStorageRecord<TReadiness, TExerciseDrafts>;

    if (startedAt.wasGenerated) {
      saveWorkoutDraft(draft, storage);
    }

    return draft;
  } catch {
    removeBrowserStorageItem(storage, key);
    return null;
  }
}

export function clearWorkoutDraft(
  mode: DataMode,
  userId?: string,
  storage = getBrowserLocalStorage(),
): boolean {
  if (!storage) return false;
  const key = getWorkoutDraftKey(mode, userId);
  if (!key) return false;
  return removeBrowserStorageItem(storage, key);
}


function normalizeOptionalString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim().length > 0) return value;
  return false;
}

function normalizeWorkoutAttemptId(parsed: Partial<WorkoutDraftStorageRecord<unknown, unknown>>) {
  if (!("workoutAttemptId" in parsed) || parsed.workoutAttemptId === null || parsed.workoutAttemptId === undefined) {
    return null;
  }
  if (typeof parsed.workoutAttemptId === "string" && parsed.workoutAttemptId.trim().length > 0) {
    return parsed.workoutAttemptId;
  }
  return false;
}

function normalizePendingReadinessLink(
  parsed: Partial<WorkoutDraftStorageRecord<unknown, unknown>>,
  workoutAttemptId: string | null,
): PendingWorkoutReadinessLink | null | false {
  if (!("pendingReadinessLink" in parsed) || parsed.pendingReadinessLink === null || parsed.pendingReadinessLink === undefined) {
    return null;
  }

  const link = parsed.pendingReadinessLink;
  if (!isPlainObject(link) || !workoutAttemptId) return false;
  if (typeof link.workoutAttemptId !== "string" || link.workoutAttemptId.trim().length === 0) return false;
  if (typeof link.trainingSessionId !== "string" || link.trainingSessionId.trim().length === 0) return false;
  if (link.workoutAttemptId !== workoutAttemptId) return false;

  return {
    workoutAttemptId: link.workoutAttemptId,
    trainingSessionId: link.trainingSessionId,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
