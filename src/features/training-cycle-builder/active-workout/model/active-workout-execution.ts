import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  formatDecimalEs,
  isDecimalWeightDraftInput,
  parseDecimalWeightInput,
} from "@/lib/progress/weight-format";
import {
  isBrowserStorageScope,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";
import { isBackendCompatibleYoutubeUrl, mapUiExecutionToRpc } from "@/features/training-cycle-builder/data/training-cycle-rpc-mappers";
import { isUuid, parseCycleSnapshot } from "@/features/training-cycle-builder/data/training-cycle-rpc-parsers";
import type {
  TrainingCycleRpcTechnique,
  TrainingCycleRpcSnapshot,
  TrainingCycleUiExecution,
} from "@/features/training-cycle-builder/data/training-cycle-rpc-types";

export const TRAINING_CYCLE_EXECUTION_DRAFT_VERSION = 1 as const;
export const TRAINING_CYCLE_EXECUTION_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const CONTROL = /[\u0000-\u001f\u007f]/;

export interface AdvancedWorkoutExecutionContext {
  readonly storageScope: BrowserStorageScope;
  readonly snapshot: TrainingCycleRpcSnapshot;
  readonly workoutAttemptId: string;
  readonly performedAt: string;
  readonly onPayloadReady: (payload: RecordOwnTrainingCycleExecutionPayload) => void;
}

export interface CanonicalTrainingCycleExecutionDropPlan {
  readonly snapshotId: string;
  readonly order: number;
  readonly targetKg: number;
  readonly targetReps: number;
}

export interface CanonicalTrainingCycleExecutionSetPlan {
  readonly snapshotId: string;
  readonly order: number;
  readonly targetReps: number;
  readonly targetKg: number;
  readonly toFailure: boolean;
  readonly drops: readonly CanonicalTrainingCycleExecutionDropPlan[];
}

export interface CanonicalTrainingCycleExecutionExercisePlan {
  readonly snapshotId: string;
  readonly legacyCycleExerciseId: string;
  readonly exerciseLineageId: string;
  readonly order: number;
  readonly technique: TrainingCycleRpcTechnique;
  readonly safeVideoUrl: string | null;
  readonly sets: readonly CanonicalTrainingCycleExecutionSetPlan[];
}

export interface ResolvedAdvancedWorkoutExercise {
  readonly legacyExercise: ExerciseTemplate;
  readonly plan: CanonicalTrainingCycleExecutionExercisePlan;
}

export interface ResolvedAdvancedWorkoutPlan {
  readonly storageScope: BrowserStorageScope;
  readonly cycleId: string;
  readonly expectedVersion: number;
  readonly planSnapshotId: string;
  readonly daySnapshotId: string;
  readonly legacyCycleDayId: string;
  readonly workoutAttemptId: string;
  readonly performedAt: string;
  readonly exercises: readonly ResolvedAdvancedWorkoutExercise[];
}

export type AdvancedWorkoutPlanResolution =
  | { readonly kind: "advanced"; readonly plan: ResolvedAdvancedWorkoutPlan }
  | { readonly kind: "legacy" };

export interface TrainingCycleExecutionDropDraft {
  readonly planDropId: string;
  readonly order: number;
  readonly completed: boolean;
  readonly reps: string;
  readonly kg: string;
}

export interface TrainingCycleExecutionSetDraft {
  readonly planSetId: string;
  readonly order: number;
  readonly completed: boolean;
  readonly reps: string;
  readonly kg: string;
  readonly reachedFailure: boolean;
  readonly drops: readonly TrainingCycleExecutionDropDraft[];
}

export interface TrainingCycleExecutionExerciseDraft {
  readonly planExerciseId: string;
  readonly legacyCycleExerciseId: string;
  readonly exerciseLineageId: string;
  readonly order: number;
  readonly sets: readonly TrainingCycleExecutionSetDraft[];
}

export interface TrainingCycleExecutionDraft {
  readonly version: typeof TRAINING_CYCLE_EXECUTION_DRAFT_VERSION;
  readonly storageScope: BrowserStorageScope;
  readonly cycleId: string;
  readonly expectedVersion: number;
  readonly planSnapshotId: string;
  readonly daySnapshotId: string;
  readonly legacyCycleDayId: string;
  readonly workoutAttemptId: string;
  readonly performedAt: string;
  readonly updatedAt: number;
  readonly exercises: readonly TrainingCycleExecutionExerciseDraft[];
}

export interface RecordOwnTrainingCycleExecutionPayload {
  readonly cycleId: string;
  readonly expectedVersion: number;
  readonly performedAt: string;
  /** Input 1-based del gateway; `mapUiExecutionToRpc` lo proyecta al orden RPC 0-based. */
  readonly execution: TrainingCycleUiExecution;
}

export class TrainingCycleExecutionPayloadError extends Error {
  constructor() {
    super("El borrador de ejecución no coincide con el snapshot activo.");
    this.name = "TrainingCycleExecutionPayloadError";
  }
}

export type TrainingCycleExecutionSetPatch = Readonly<Partial<Pick<
  TrainingCycleExecutionSetDraft,
  "completed" | "reps" | "kg" | "reachedFailure"
>>>;

export type TrainingCycleExecutionDropPatch = Readonly<Partial<Pick<
  TrainingCycleExecutionDropDraft,
  "completed" | "reps" | "kg"
>>>;

export interface LegacyExerciseDraftProjection {
  readonly weight: string;
  readonly reps: readonly (number | "")[];
}

function invalidPayload(): never {
  throw new TrainingCycleExecutionPayloadError();
}

function isValidInstant(value: string) {
  return value.length >= 20
    && value.length <= 40
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isValidAttemptId(value: string) {
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 128 && !CONTROL.test(normalized);
}

function byCanonicalOrder<T extends { readonly order: number; readonly snapshotId: string }>(
  left: T,
  right: T,
) {
  return left.order - right.order || left.snapshotId.localeCompare(right.snapshotId);
}

function canonicalExercisePlan(
  exercise: TrainingCycleRpcSnapshot["plan"]["days"][number]["exercises"][number],
): CanonicalTrainingCycleExecutionExercisePlan | null {
  if (!exercise.legacyCycleExerciseId) return null;
  return {
    snapshotId: exercise.snapshotId,
    legacyCycleExerciseId: exercise.legacyCycleExerciseId,
    exerciseLineageId: exercise.exerciseLineageId,
    order: exercise.order,
    technique: exercise.technique,
    safeVideoUrl: isBackendCompatibleYoutubeUrl(exercise.videoUrl) ? exercise.videoUrl : null,
    sets: [...exercise.sets]
      .sort(byCanonicalOrder)
      .map((set) => ({
        snapshotId: set.snapshotId,
        order: set.order,
        targetReps: set.targetReps,
        targetKg: set.targetKg,
        toFailure: set.toFailure,
        drops: [...set.drops]
          .sort(byCanonicalOrder)
          .map((drop) => ({
            snapshotId: drop.snapshotId,
            order: drop.order,
            targetKg: drop.kg,
            targetReps: drop.reps,
          })),
      })),
  };
}

/** Revalida el snapshot ya parseado por el gateway sin aceptar campos adicionales del caller. */
function reparseTypedCycleSnapshot(snapshot: TrainingCycleRpcSnapshot) {
  return parseCycleSnapshot({
    cycleId: snapshot.cycleId,
    portalScope: snapshot.portalScope,
    cycleNumber: snapshot.cycleNumber,
    goal: snapshot.goal,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    status: snapshot.status,
    daysUntilEnd: snapshot.daysUntilEnd,
    version: snapshot.version,
    snapshotId: snapshot.snapshotId,
    extensionCount: snapshot.extensionCount,
    sourceDraftId: snapshot.sourceDraftId,
    sourceCycleId: snapshot.sourceCycleId,
    closedAt: snapshot.closedAt,
    closedReason: snapshot.closedReason,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    plan: {
      days: snapshot.plan.days.map((day) => ({
        snapshotId: day.snapshotId,
        day: day.day,
        name: day.name,
        order: day.order,
        legacyCycleDayId: day.legacyCycleDayId,
        exercises: day.exercises.map((exercise) => ({
          snapshotId: exercise.snapshotId,
          catalogExerciseId: exercise.source.kind === "catalog" ? exercise.source.id : null,
          customExerciseId: exercise.source.kind === "custom" ? exercise.source.id : null,
          exerciseLineageId: exercise.exerciseLineageId,
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          order: exercise.order,
          technique: exercise.technique,
          videoUrl: exercise.videoUrl,
          legacyCycleExerciseId: exercise.legacyCycleExerciseId,
          sets: exercise.sets.map((set) => ({
            snapshotId: set.snapshotId,
            order: set.order,
            targetReps: set.targetReps,
            targetKg: set.targetKg,
            toFailure: set.toFailure,
            drops: set.drops.map((drop) => ({
              snapshotId: drop.snapshotId,
              order: drop.order,
              kg: drop.kg,
              reps: drop.reps,
            })),
          })),
        })),
      })),
    },
  });
}

/**
 * Activa el modo avanzado únicamente cuando el snapshot completo coincide por IDs legacy,
 * linaje, ciclo y día. Los nombres no participan en la resolución.
 */
export function resolveAdvancedWorkoutPlan(input: {
  readonly context: AdvancedWorkoutExecutionContext | undefined;
  readonly exercises: readonly ExerciseTemplate[];
}): AdvancedWorkoutPlanResolution {
  if (!input.context || input.exercises.length === 0) return { kind: "legacy" };
  if (
    !isBrowserStorageScope(input.context.storageScope)
    || input.context.storageScope === "demo"
    || !isValidAttemptId(input.context.workoutAttemptId)
    || !isValidInstant(input.context.performedAt)
    || typeof input.context.onPayloadReady !== "function"
  ) return { kind: "legacy" };

  let snapshot: TrainingCycleRpcSnapshot;
  try {
    snapshot = reparseTypedCycleSnapshot(input.context.snapshot);
  } catch {
    return { kind: "legacy" };
  }
  if (snapshot.portalScope !== "usuario") return { kind: "legacy" };

  const legacyDayIds = new Set(input.exercises.map((exercise) => exercise.cycleDayId));
  if (legacyDayIds.size !== 1) return { kind: "legacy" };
  const legacyCycleDayId = [...legacyDayIds][0];
  if (!legacyCycleDayId || !isUuid(legacyCycleDayId)) return { kind: "legacy" };

  const matchingDays = snapshot.plan.days.filter((day) => day.legacyCycleDayId === legacyCycleDayId);
  if (matchingDays.length !== 1) return { kind: "legacy" };
  const day = matchingDays[0];
  if (!day || day.exercises.length !== input.exercises.length) return { kind: "legacy" };

  const currentByLegacyId = new Map<string, ExerciseTemplate>();
  for (const exercise of input.exercises) {
    if (currentByLegacyId.has(exercise.id)) return { kind: "legacy" };
    currentByLegacyId.set(exercise.id, exercise);
  }

  const seenLegacyIds = new Set<string>();
  const resolved: ResolvedAdvancedWorkoutExercise[] = [];
  for (const snapshotExercise of [...day.exercises].sort(byCanonicalOrder)) {
    const plan = canonicalExercisePlan(snapshotExercise);
    if (!plan || seenLegacyIds.has(plan.legacyCycleExerciseId)) return { kind: "legacy" };
    seenLegacyIds.add(plan.legacyCycleExerciseId);

    const legacyExercise = currentByLegacyId.get(plan.legacyCycleExerciseId);
    if (
      !legacyExercise
      || legacyExercise.cycleId !== snapshot.cycleId
      || legacyExercise.cycleDayId !== legacyCycleDayId
      || legacyExercise.trainingCycleExerciseId !== plan.legacyCycleExerciseId
      || legacyExercise.exerciseLineageId !== plan.exerciseLineageId
      || legacyExercise.targetSets !== plan.sets.length
    ) return { kind: "legacy" };
    resolved.push({ legacyExercise, plan });
  }

  if (resolved.length !== currentByLegacyId.size) return { kind: "legacy" };
  return {
    kind: "advanced",
    plan: {
      storageScope: input.context.storageScope,
      cycleId: snapshot.cycleId,
      expectedVersion: snapshot.version,
      planSnapshotId: snapshot.snapshotId,
      daySnapshotId: day.snapshotId,
      legacyCycleDayId,
      workoutAttemptId: input.context.workoutAttemptId.trim(),
      performedAt: input.context.performedAt,
      exercises: resolved,
    },
  };
}

export function createTrainingCycleExecutionDraft(
  plan: ResolvedAdvancedWorkoutPlan,
  updatedAt: number,
): TrainingCycleExecutionDraft {
  if (!Number.isFinite(updatedAt) || updatedAt < 0) invalidPayload();
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
    updatedAt,
    exercises: plan.exercises.map(({ plan: exercise }) => ({
      planExerciseId: exercise.snapshotId,
      legacyCycleExerciseId: exercise.legacyCycleExerciseId,
      exerciseLineageId: exercise.exerciseLineageId,
      order: exercise.order,
      sets: exercise.sets.map((set) => ({
        planSetId: set.snapshotId,
        order: set.order,
        completed: false,
        reps: "",
        kg: "",
        reachedFailure: false,
        drops: set.drops.map((drop) => ({
          planDropId: drop.snapshotId,
          order: drop.order,
          completed: false,
          reps: "",
          kg: "",
        })),
      })),
    })),
  };
}

/** Recuperación one-way del draft legacy: no inventa sets/drops ni cambia IDs del snapshot. */
export function seedTrainingCycleExecutionDraftFromLegacy(
  draft: TrainingCycleExecutionDraft,
  legacyDrafts: Readonly<Record<string, ExerciseDraft | undefined>>,
): TrainingCycleExecutionDraft {
  return {
    ...draft,
    exercises: draft.exercises.map((exercise) => {
      const legacy = legacyDrafts[exercise.legacyCycleExerciseId];
      if (!legacy) return exercise;
      const parsedWeight = parseCompletedKg(legacy.weight);
      return {
        ...exercise,
        sets: exercise.sets.map((set, index) => {
          const legacyReps = legacy.reps[index];
          const parsedReps = legacyReps === "" ? null : Number(legacyReps);
          const completed = parsedWeight !== null
            && Number.isSafeInteger(parsedReps)
            && (parsedReps ?? 0) >= 1
            && (parsedReps ?? 0) <= 1_000;
          return {
            ...set,
            completed,
            reps: legacyReps === "" ? "" : String(legacyReps),
            kg: legacy.weight,
            reachedFailure: false,
          };
        }),
      };
    }),
  };
}

function normalizeRepsInput(value: string) {
  if (!/^\d{0,4}$/.test(value)) return null;
  if (value === "") return "";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000 ? value : null;
}

function normalizeKgInput(value: string) {
  if (!isDecimalWeightDraftInput(value)) return null;
  if (value === "") return "";
  const parsed = parseDecimalWeightInput(value);
  return parsed !== null && parsed >= 0 && parsed <= 99_999.99 ? value : null;
}

function applySetPatch(
  current: TrainingCycleExecutionSetDraft,
  patch: TrainingCycleExecutionSetPatch,
): TrainingCycleExecutionSetDraft {
  const reps = patch.reps === undefined ? current.reps : normalizeRepsInput(patch.reps);
  const kg = patch.kg === undefined ? current.kg : normalizeKgInput(patch.kg);
  if (reps === null || kg === null) return current;
  const completed = patch.completed ?? current.completed;
  return {
    ...current,
    completed,
    reps,
    kg,
    reachedFailure: completed ? patch.reachedFailure ?? current.reachedFailure : false,
    drops: completed
      ? current.drops
      : current.drops.map((drop) => ({ ...drop, completed: false })),
  };
}

function applyDropPatch(
  parentCompleted: boolean,
  current: TrainingCycleExecutionDropDraft,
  patch: TrainingCycleExecutionDropPatch,
): TrainingCycleExecutionDropDraft {
  const reps = patch.reps === undefined ? current.reps : normalizeRepsInput(patch.reps);
  const kg = patch.kg === undefined ? current.kg : normalizeKgInput(patch.kg);
  if (reps === null || kg === null) return current;
  return {
    ...current,
    completed: parentCompleted ? patch.completed ?? current.completed : false,
    reps,
    kg,
  };
}

export function updateTrainingCycleExecutionSet(
  draft: TrainingCycleExecutionDraft,
  input: {
    readonly planExerciseId: string;
    readonly planSetId: string;
    readonly patch: TrainingCycleExecutionSetPatch;
    readonly updatedAt: number;
  },
): TrainingCycleExecutionDraft {
  let didUpdate = false;
  const exercises = draft.exercises.map((exercise) => {
    if (exercise.planExerciseId !== input.planExerciseId) return exercise;
    const sets = exercise.sets.map((set) => {
      if (set.planSetId !== input.planSetId) return set;
      const next = applySetPatch(set, input.patch);
      didUpdate = next !== set;
      return next;
    });
    return didUpdate ? { ...exercise, sets } : exercise;
  });
  return didUpdate ? { ...draft, updatedAt: input.updatedAt, exercises } : draft;
}

export function updateTrainingCycleExecutionDrop(
  draft: TrainingCycleExecutionDraft,
  input: {
    readonly planExerciseId: string;
    readonly planSetId: string;
    readonly planDropId: string;
    readonly patch: TrainingCycleExecutionDropPatch;
    readonly updatedAt: number;
  },
): TrainingCycleExecutionDraft {
  let didUpdate = false;
  const exercises = draft.exercises.map((exercise) => {
    if (exercise.planExerciseId !== input.planExerciseId) return exercise;
    const sets = exercise.sets.map((set) => {
      if (set.planSetId !== input.planSetId) return set;
      const drops = set.drops.map((drop) => {
        if (drop.planDropId !== input.planDropId) return drop;
        const next = applyDropPatch(set.completed, drop, input.patch);
        didUpdate = next !== drop;
        return next;
      });
      return didUpdate ? { ...set, drops } : set;
    });
    return didUpdate ? { ...exercise, sets } : exercise;
  });
  return didUpdate ? { ...draft, updatedAt: input.updatedAt, exercises } : draft;
}

function parseCompletedReps(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000 ? parsed : null;
}

function parseCompletedKg(value: string): number | null {
  const parsed = parseDecimalWeightInput(value);
  return parsed !== null && parsed >= 0 && parsed <= 99_999.99 ? parsed : null;
}

function isCompletedResultValid(value: { readonly reps: string; readonly kg: string }) {
  return parseCompletedReps(value.reps) !== null && parseCompletedKg(value.kg) !== null;
}

export function isTrainingCycleExecutionExerciseReady(
  exercise: TrainingCycleExecutionExerciseDraft | null | undefined,
) {
  if (!exercise || exercise.sets.length === 0) return false;
  return exercise.sets.every((set) => (
    (!set.completed || isCompletedResultValid(set))
    && (!set.reachedFailure || set.completed)
    && set.drops.every((drop) => (
      (!drop.completed || (set.completed && isCompletedResultValid(drop)))
    ))
  ));
}

export function isTrainingCycleExecutionDraftReady(draft: TrainingCycleExecutionDraft) {
  return draft.exercises.length > 0 && draft.exercises.every(isTrainingCycleExecutionExerciseReady);
}

export function projectTrainingCycleExecutionToLegacyDraft(
  exercise: TrainingCycleExecutionExerciseDraft,
): LegacyExerciseDraftProjection {
  const firstCompletedSet = exercise.sets.find((set) => set.completed);
  const parsedWeight = firstCompletedSet ? parseCompletedKg(firstCompletedSet.kg) : 0;
  return {
    weight: parsedWeight === null ? "" : formatDecimalEs(parsedWeight),
    reps: exercise.sets.map((set) => {
      if (!set.completed) return 0;
      return parseCompletedReps(set.reps) ?? "";
    }),
  };
}

function requireSameDraftIdentity(
  plan: ResolvedAdvancedWorkoutPlan,
  draft: TrainingCycleExecutionDraft,
) {
  if (
    draft.version !== TRAINING_CYCLE_EXECUTION_DRAFT_VERSION
    || draft.storageScope !== plan.storageScope
    || draft.cycleId !== plan.cycleId
    || draft.expectedVersion !== plan.expectedVersion
    || draft.planSnapshotId !== plan.planSnapshotId
    || draft.daySnapshotId !== plan.daySnapshotId
    || draft.legacyCycleDayId !== plan.legacyCycleDayId
    || draft.workoutAttemptId !== plan.workoutAttemptId
    || draft.performedAt !== plan.performedAt
  ) invalidPayload();
}

/**
 * Construye exclusivamente el input allowlisted de `TrainingCycleRpcGateway.recordExecution`.
 * No genera request IDs ni ownership; el gateway conserva el request ID estable para retries.
 */
export function buildRecordOwnTrainingCycleExecutionPayload(input: {
  readonly plan: ResolvedAdvancedWorkoutPlan;
  readonly draft: TrainingCycleExecutionDraft;
}): RecordOwnTrainingCycleExecutionPayload {
  requireSameDraftIdentity(input.plan, input.draft);
  if (!isTrainingCycleExecutionDraftReady(input.draft)) invalidPayload();
  if (input.draft.exercises.length !== input.plan.exercises.length) invalidPayload();

  const draftByExerciseId = new Map(input.draft.exercises.map((exercise) => [exercise.planExerciseId, exercise]));
  if (draftByExerciseId.size !== input.draft.exercises.length) invalidPayload();
  const exercises = input.plan.exercises.map(({ plan: exercisePlan }) => {
    const exercise = draftByExerciseId.get(exercisePlan.snapshotId);
    if (
      !exercise
      || exercise.legacyCycleExerciseId !== exercisePlan.legacyCycleExerciseId
      || exercise.exerciseLineageId !== exercisePlan.exerciseLineageId
      || exercise.order !== exercisePlan.order
      || exercise.sets.length !== exercisePlan.sets.length
    ) invalidPayload();

    const draftBySetId = new Map(exercise.sets.map((set) => [set.planSetId, set]));
    if (draftBySetId.size !== exercise.sets.length) invalidPayload();
    const sets = exercisePlan.sets.map((setPlan) => {
      const set = draftBySetId.get(setPlan.snapshotId);
      if (!set || set.order !== setPlan.order || set.drops.length !== setPlan.drops.length) invalidPayload();
      const draftByDropId = new Map(set.drops.map((drop) => [drop.planDropId, drop]));
      if (draftByDropId.size !== set.drops.length) invalidPayload();
      const drops = setPlan.drops.map((dropPlan) => {
        const drop = draftByDropId.get(dropPlan.snapshotId);
        if (!drop || drop.order !== dropPlan.order) invalidPayload();
        return {
          planDropId: drop.planDropId,
          order: drop.order + 1,
          completed: drop.completed,
          reps: drop.completed ? parseCompletedReps(drop.reps) ?? invalidPayload() : null,
          kg: drop.completed ? parseCompletedKg(drop.kg) ?? invalidPayload() : null,
        };
      });
      return {
        planSetId: set.planSetId,
        order: set.order + 1,
        completed: set.completed,
        reps: set.completed ? parseCompletedReps(set.reps) ?? invalidPayload() : null,
        kg: set.completed ? parseCompletedKg(set.kg) ?? invalidPayload() : null,
        reachedFailure: set.completed && set.reachedFailure,
        drops,
      };
    });
    return {
      planExerciseId: exercise.planExerciseId,
      order: exercise.order + 1,
      sets,
    };
  });

  const payload: RecordOwnTrainingCycleExecutionPayload = {
    cycleId: input.plan.cycleId,
    expectedVersion: input.plan.expectedVersion,
    performedAt: input.plan.performedAt,
    execution: {
      dayId: input.plan.daySnapshotId,
      exercises,
    },
  };
  // Valida ahora el JSON 0-based exacto que recibirá la función, antes del write legacy.
  mapUiExecutionToRpc(payload.execution);
  return deepFreeze(payload);
}

export function getTrainingCycleExecutionExerciseDraft(
  draft: TrainingCycleExecutionDraft | null,
  planExerciseId: string,
) {
  return draft?.exercises.find((exercise) => exercise.planExerciseId === planExerciseId) ?? null;
}

export function getResolvedAdvancedWorkoutExercise(
  plan: ResolvedAdvancedWorkoutPlan | null,
  legacyCycleExerciseId: string,
) {
  return plan?.exercises.find((exercise) => (
    exercise.plan.legacyCycleExerciseId === legacyCycleExerciseId
  )) ?? null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
