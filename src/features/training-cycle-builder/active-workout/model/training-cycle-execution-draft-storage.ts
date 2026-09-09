import { isDecimalWeightDraftInput, parseDecimalWeightInput } from "@/lib/progress/weight-format";
import {
  getBrowserLocalStorage,
  getScopedBrowserStorageKey,
  isBrowserStorageScope,
  readScopedJson,
  removeBrowserStorageItem,
  writeScopedJson,
  type BrowserStorageLike,
} from "@/lib/storage/browser-storage";
import {
  TRAINING_CYCLE_EXECUTION_DRAFT_MAX_AGE_MS,
  TRAINING_CYCLE_EXECUTION_DRAFT_VERSION,
  type ResolvedAdvancedWorkoutPlan,
  type TrainingCycleExecutionDraft,
  type TrainingCycleExecutionDropDraft,
  type TrainingCycleExecutionExerciseDraft,
  type TrainingCycleExecutionSetDraft,
} from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";

export const TRAINING_CYCLE_EXECUTION_DRAFT_KEY_PREFIX =
  "organizatech:training-cycle-execution-draft-v1";
export const TRAINING_CYCLE_EXECUTION_DRAFT_MAX_RECORDS_PER_USER = 7;

type EnumerableBrowserStorageLike = BrowserStorageLike & {
  readonly length: number;
  key: (index: number) => string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(record).length === keys.length && keys.every((key) => key in record);
}

function validDraftReps(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{0,4}$/.test(value)) return false;
  return value === "" || Number(value) <= 1_000;
}

function validDraftKg(value: unknown): value is string {
  if (typeof value !== "string" || !isDecimalWeightDraftInput(value)) return false;
  if (value === "") return true;
  const parsed = parseDecimalWeightInput(value);
  return parsed !== null && parsed >= 0 && parsed <= 99_999.99;
}

function parseDrop(
  value: unknown,
  plan: ResolvedAdvancedWorkoutPlan["exercises"][number]["plan"]["sets"][number]["drops"][number],
  parentCompleted: boolean,
): TrainingCycleExecutionDropDraft | null {
  if (!isPlainObject(value) || !exactKeys(value, [
    "planDropId", "order", "completed", "reps", "kg",
  ])) return null;
  if (
    value.planDropId !== plan.snapshotId
    || value.order !== plan.order
    || typeof value.completed !== "boolean"
    || (!parentCompleted && value.completed)
    || !validDraftReps(value.reps)
    || !validDraftKg(value.kg)
  ) return null;
  return {
    planDropId: plan.snapshotId,
    order: plan.order,
    completed: value.completed,
    reps: value.reps,
    kg: value.kg,
  };
}

function parseSet(
  value: unknown,
  plan: ResolvedAdvancedWorkoutPlan["exercises"][number]["plan"]["sets"][number],
): TrainingCycleExecutionSetDraft | null {
  if (!isPlainObject(value) || !exactKeys(value, [
    "planSetId", "order", "completed", "reps", "kg", "reachedFailure", "drops",
  ])) return null;
  if (
    value.planSetId !== plan.snapshotId
    || value.order !== plan.order
    || typeof value.completed !== "boolean"
    || typeof value.reachedFailure !== "boolean"
    || (!value.completed && value.reachedFailure)
    || !validDraftReps(value.reps)
    || !validDraftKg(value.kg)
    || !Array.isArray(value.drops)
    || value.drops.length !== plan.drops.length
  ) return null;
  const completed = value.completed;
  const rawById = new Map<string, unknown>();
  for (const candidate of value.drops) {
    if (!isPlainObject(candidate) || typeof candidate.planDropId !== "string") return null;
    if (rawById.has(candidate.planDropId)) return null;
    rawById.set(candidate.planDropId, candidate);
  }
  const drops = plan.drops.map((dropPlan) => parseDrop(
    rawById.get(dropPlan.snapshotId),
    dropPlan,
    completed,
  ));
  if (drops.some((drop) => drop === null)) return null;
  return {
    planSetId: plan.snapshotId,
    order: plan.order,
    completed,
    reps: value.reps,
    kg: value.kg,
    reachedFailure: value.reachedFailure,
    drops: drops as TrainingCycleExecutionDropDraft[],
  };
}

function parseExercise(
  value: unknown,
  resolved: ResolvedAdvancedWorkoutPlan["exercises"][number],
): TrainingCycleExecutionExerciseDraft | null {
  if (!isPlainObject(value) || !exactKeys(value, [
    "planExerciseId", "legacyCycleExerciseId", "exerciseLineageId", "order", "sets",
  ])) return null;
  const plan = resolved.plan;
  if (
    value.planExerciseId !== plan.snapshotId
    || value.legacyCycleExerciseId !== plan.legacyCycleExerciseId
    || value.exerciseLineageId !== plan.exerciseLineageId
    || value.order !== plan.order
    || !Array.isArray(value.sets)
    || value.sets.length !== plan.sets.length
  ) return null;
  const rawById = new Map<string, unknown>();
  for (const candidate of value.sets) {
    if (!isPlainObject(candidate) || typeof candidate.planSetId !== "string") return null;
    if (rawById.has(candidate.planSetId)) return null;
    rawById.set(candidate.planSetId, candidate);
  }
  const sets = plan.sets.map((setPlan) => parseSet(rawById.get(setPlan.snapshotId), setPlan));
  if (sets.some((set) => set === null)) return null;
  return {
    planExerciseId: plan.snapshotId,
    legacyCycleExerciseId: plan.legacyCycleExerciseId,
    exerciseLineageId: plan.exerciseLineageId,
    order: plan.order,
    sets: sets as TrainingCycleExecutionSetDraft[],
  };
}

function sameIdentity(record: Record<string, unknown>, plan: ResolvedAdvancedWorkoutPlan) {
  return record.storageScope === plan.storageScope
    && record.cycleId === plan.cycleId
    && record.expectedVersion === plan.expectedVersion
    && record.planSnapshotId === plan.planSnapshotId
    && record.daySnapshotId === plan.daySnapshotId
    && record.legacyCycleDayId === plan.legacyCycleDayId
    && record.workoutAttemptId === plan.workoutAttemptId
    && record.performedAt === plan.performedAt;
}

function isEnumerableStorage(
  storage: BrowserStorageLike,
): storage is EnumerableBrowserStorageLike {
  const candidate = storage as Partial<EnumerableBrowserStorageLike>;
  return Number.isSafeInteger(candidate.length) && typeof candidate.key === "function";
}

function pruneTrainingCycleExecutionDrafts(
  storage: BrowserStorageLike,
  plan: ResolvedAdvancedWorkoutPlan,
  now: number,
) {
  if (!isEnumerableStorage(storage)) return;
  const scopedPrefix = `${getScopedBrowserStorageKey(
    TRAINING_CYCLE_EXECUTION_DRAFT_KEY_PREFIX,
    plan.storageScope,
  )}:`;
  const activeKey = getTrainingCycleExecutionDraftStorageKey(plan);
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(scopedPrefix)) keys.push(key);
    }
  } catch {
    return;
  }

  const valid: Array<{ key: string; updatedAt: number }> = [];
  for (const key of keys) {
    const record = readScopedJson(storage, key, isPlainObject);
    const updatedAt = record?.updatedAt;
    if (
      !record
      || record.version !== TRAINING_CYCLE_EXECUTION_DRAFT_VERSION
      || record.storageScope !== plan.storageScope
      || typeof updatedAt !== "number"
      || !Number.isFinite(updatedAt)
      || updatedAt < 0
      || updatedAt > now
      || now - updatedAt > TRAINING_CYCLE_EXECUTION_DRAFT_MAX_AGE_MS
    ) {
      removeBrowserStorageItem(storage, key);
      continue;
    }
    valid.push({ key, updatedAt });
  }

  valid.sort((left, right) => {
    if (left.key === activeKey) return -1;
    if (right.key === activeKey) return 1;
    return right.updatedAt - left.updatedAt || left.key.localeCompare(right.key);
  });
  for (const record of valid.slice(TRAINING_CYCLE_EXECUTION_DRAFT_MAX_RECORDS_PER_USER)) {
    removeBrowserStorageItem(storage, record.key);
  }
}

export function projectStoredTrainingCycleExecutionDraft(
  value: unknown,
  plan: ResolvedAdvancedWorkoutPlan,
  now: number,
): TrainingCycleExecutionDraft | null {
  if (!isPlainObject(value) || !exactKeys(value, [
    "version", "storageScope", "cycleId", "expectedVersion", "planSnapshotId",
    "daySnapshotId", "legacyCycleDayId", "workoutAttemptId", "performedAt", "updatedAt",
    "exercises",
  ])) return null;
  if (
    value.version !== TRAINING_CYCLE_EXECUTION_DRAFT_VERSION
    || !isBrowserStorageScope(value.storageScope)
    || !sameIdentity(value, plan)
    || typeof value.updatedAt !== "number"
    || !Number.isFinite(value.updatedAt)
    || value.updatedAt < 0
    || value.updatedAt > now
    || now - value.updatedAt > TRAINING_CYCLE_EXECUTION_DRAFT_MAX_AGE_MS
    || !Array.isArray(value.exercises)
    || value.exercises.length !== plan.exercises.length
  ) return null;

  const rawById = new Map<string, unknown>();
  for (const candidate of value.exercises) {
    if (!isPlainObject(candidate) || typeof candidate.planExerciseId !== "string") return null;
    if (rawById.has(candidate.planExerciseId)) return null;
    rawById.set(candidate.planExerciseId, candidate);
  }
  const exercises = plan.exercises.map((resolved) => parseExercise(
    rawById.get(resolved.plan.snapshotId),
    resolved,
  ));
  if (exercises.some((exercise) => exercise === null)) return null;
  return {
    version: TRAINING_CYCLE_EXECUTION_DRAFT_VERSION,
    storageScope: plan.storageScope,
    cycleId: plan.cycleId,
    expectedVersion: plan.expectedVersion,
    planSnapshotId: plan.planSnapshotId,
    daySnapshotId: plan.daySnapshotId,
    legacyCycleDayId: plan.legacyCycleDayId,
    workoutAttemptId: plan.workoutAttemptId,
    performedAt: plan.performedAt,
    updatedAt: value.updatedAt,
    exercises: exercises as TrainingCycleExecutionExerciseDraft[],
  };
}

export function getTrainingCycleExecutionDraftStorageKey(plan: ResolvedAdvancedWorkoutPlan) {
  const scoped = getScopedBrowserStorageKey(
    TRAINING_CYCLE_EXECUTION_DRAFT_KEY_PREFIX,
    plan.storageScope,
  );
  return [
    scoped,
    plan.cycleId,
    plan.daySnapshotId,
    plan.legacyCycleDayId,
    encodeURIComponent(plan.workoutAttemptId),
  ].join(":");
}

export function loadTrainingCycleExecutionDraft(
  plan: ResolvedAdvancedWorkoutPlan,
  options: {
    readonly storage?: BrowserStorageLike | null;
    readonly now?: () => number;
  } = {},
) {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return null;
  const now = options.now?.() ?? Date.now();
  pruneTrainingCycleExecutionDrafts(storage, plan, now);
  const key = getTrainingCycleExecutionDraftStorageKey(plan);
  const value = readScopedJson(storage, key, isPlainObject);
  if (!value) return null;
  const draft = projectStoredTrainingCycleExecutionDraft(value, plan, now);
  if (!draft) removeBrowserStorageItem(storage, key);
  return draft;
}

export function saveTrainingCycleExecutionDraft(
  plan: ResolvedAdvancedWorkoutPlan,
  draft: TrainingCycleExecutionDraft,
  options: {
    readonly storage?: BrowserStorageLike | null;
    readonly now?: () => number;
  } = {},
) {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return false;
  const now = options.now?.() ?? Date.now();
  const projected = projectStoredTrainingCycleExecutionDraft(
    draft,
    plan,
    now,
  );
  if (!projected) return false;
  const saved = writeScopedJson(
    storage,
    getTrainingCycleExecutionDraftStorageKey(plan),
    projected,
  );
  if (saved) pruneTrainingCycleExecutionDrafts(storage, plan, now);
  return saved;
}

export function clearTrainingCycleExecutionDraft(
  plan: ResolvedAdvancedWorkoutPlan,
  storage: BrowserStorageLike | null = getBrowserLocalStorage(),
) {
  if (!storage) return false;
  const key = getTrainingCycleExecutionDraftStorageKey(plan);
  const current = readScopedJson(storage, key, isPlainObject);
  if (!current) return false;
  if (!sameIdentity(current, plan)) return false;
  return removeBrowserStorageItem(storage, key);
}
