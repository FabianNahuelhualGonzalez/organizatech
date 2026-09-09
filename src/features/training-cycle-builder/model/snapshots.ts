import {
  cloneExercise,
  cloneTrainingCyclePlanContent,
  createTrainingCycleDraft,
} from "./draft";
import { isISOInstant } from "./dates";
import {
  TRAINING_CYCLE_BUILDER_SCHEMA_VERSION,
  WEEKDAYS,
  type ExerciseDraft,
  type TrainingCycleDraft,
  type TrainingCyclePlanContent,
  type CyclePlanSnapshot,
  type TrainingDayDraft,
  type VersionedTrainingCycle,
  type Weekday,
  type SnapshotReason,
} from "./types";
import { validateTrainingCycleDraft } from "./validation";

export interface CreateSnapshotInput {
  readonly snapshotId: string;
  readonly cycleId: string;
  readonly version: number;
  readonly capturedAt: string;
  readonly reason: SnapshotReason;
  readonly previousSnapshotId: string | null;
  readonly content: TrainingCyclePlanContent;
}

export type AppendSnapshotResult =
  | { readonly ok: true; readonly cycle: VersionedTrainingCycle }
  | {
    readonly ok: false;
    readonly reason: "cycle_mismatch" | "version_conflict" | "previous_snapshot_mismatch" | "duplicate_snapshot_id";
    readonly cycle: VersionedTrainingCycle;
  };

export interface DuplicateSnapshotInput {
  readonly draftId: string;
  readonly startDate: string;
  readonly endDate: string;
  /** Namespace de IDs editables; por defecto usa `duplicate:<draftId>`. */
  readonly idNamespace?: string;
}

export function createTrainingCycleSnapshot(input: CreateSnapshotInput): CyclePlanSnapshot {
  if (!input.snapshotId.trim()) throw new Error("snapshotId no puede estar vacio");
  if (!input.cycleId.trim()) throw new Error("cycleId no puede estar vacio");
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error("version debe ser un entero positivo");
  }
  if (!isISOInstant(input.capturedAt)) throw new Error("capturedAt debe ser un instante ISO con zona");
  if (input.version === 1 && input.previousSnapshotId !== null) {
    throw new Error("La primera version no puede tener snapshot anterior");
  }
  if (input.version > 1 && !input.previousSnapshotId?.trim()) {
    throw new Error("Una version posterior debe apuntar al snapshot anterior");
  }
  const contentValidation = validateTrainingCycleDraft({
    ...cloneTrainingCyclePlanContent(input.content),
    schemaVersion: TRAINING_CYCLE_BUILDER_SCHEMA_VERSION,
    draftId: `snapshot-validation:${input.snapshotId.trim()}`,
    status: "draft",
    revision: 1,
    origin: "manual",
    sourceSnapshotId: null,
  });
  if (!contentValidation.valid) throw new Error("El contenido del snapshot no cumple los invariantes del ciclo");
  return deepFreeze({
    schemaVersion: TRAINING_CYCLE_BUILDER_SCHEMA_VERSION,
    snapshotId: input.snapshotId.trim(),
    cycleId: input.cycleId.trim(),
    version: input.version,
    capturedAt: input.capturedAt,
    reason: input.reason,
    previousSnapshotId: input.previousSnapshotId,
    content: cloneTrainingCyclePlanContent(input.content),
  });
}

export function createVersionedTrainingCycle(
  initialSnapshot: CyclePlanSnapshot,
): VersionedTrainingCycle {
  if (initialSnapshot.version !== 1 || initialSnapshot.previousSnapshotId !== null) {
    throw new Error("El ciclo versionado debe comenzar en version 1 sin snapshot anterior");
  }
  return deepFreeze({
    cycleId: initialSnapshot.cycleId,
    currentSnapshotId: initialSnapshot.snapshotId,
    snapshots: [initialSnapshot],
  });
}

/** Append-only con versionado optimista; nunca reemplaza ni modifica snapshots existentes. */
export function appendTrainingCycleSnapshot(
  cycle: VersionedTrainingCycle,
  snapshot: CyclePlanSnapshot,
): AppendSnapshotResult {
  if (snapshot.cycleId !== cycle.cycleId) return { ok: false, reason: "cycle_mismatch", cycle };
  if (cycle.snapshots.some((entry) => entry.snapshotId === snapshot.snapshotId)) {
    return { ok: false, reason: "duplicate_snapshot_id", cycle };
  }
  const current = cycle.snapshots.find((entry) => entry.snapshotId === cycle.currentSnapshotId);
  if (!current || snapshot.version !== current.version + 1) {
    return { ok: false, reason: "version_conflict", cycle };
  }
  if (snapshot.previousSnapshotId !== current.snapshotId) {
    return { ok: false, reason: "previous_snapshot_mismatch", cycle };
  }
  return {
    ok: true,
    cycle: deepFreeze({
      cycleId: cycle.cycleId,
      currentSnapshotId: snapshot.snapshotId,
      snapshots: [...cycle.snapshots, snapshot],
    }),
  };
}

export function getTrainingCycleSnapshot(
  cycle: VersionedTrainingCycle,
  snapshotId: string,
): CyclePlanSnapshot | null {
  return cycle.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId) ?? null;
}

/**
 * Duplica contenido y linaje a IDs nuevos deterministas. El snapshot fuente queda congelado y
 * el nuevo borrador es completamente editable sin compartir arrays u objetos con el historial.
 */
export function duplicateTrainingCycleSnapshot(
  snapshot: CyclePlanSnapshot,
  input: DuplicateSnapshotInput,
): TrainingCycleDraft {
  const namespace = (input.idNamespace ?? `duplicate:${input.draftId}`).trim();
  if (!namespace) throw new Error("idNamespace no puede estar vacio");
  const routines: Partial<Record<Weekday, TrainingDayDraft>> = {};
  for (const day of WEEKDAYS) {
    const routine = snapshot.content.routines[day];
    if (!routine) continue;
    routines[day] = {
      day,
      name: routine.name,
      exercises: routine.exercises.map((exercise, exerciseIndex) => cloneSnapshotExercise(
        exercise,
        `${namespace}:day:${day}:exercise:${exerciseIndex + 1}`,
      )),
    };
  }
  return createTrainingCycleDraft({
    draftId: input.draftId,
    origin: "duplicated",
    goal: snapshot.content.goal,
    startDate: input.startDate,
    endDate: input.endDate,
    selectedDays: snapshot.content.selectedDays,
    routines,
    sourceSnapshotId: snapshot.snapshotId,
  });
}

export function transitionDraftStatus(
  draft: TrainingCycleDraft,
  status: "activated" | "discarded",
): TrainingCycleDraft {
  if (draft.status !== "draft") return draft;
  return { ...draft, status, revision: draft.revision + 1 };
}

function cloneSnapshotExercise(exercise: ExerciseDraft, namespace: string): ExerciseDraft {
  return {
    ...cloneExercise(exercise),
    id: namespace,
    sourceExerciseId: exercise.id,
    sets: exercise.sets.map((set, setIndex) => ({
      ...set,
      id: `${namespace}:set:${setIndex + 1}`,
      sourceSetId: set.id,
      drops: set.drops.map((drop, dropIndex) => ({
        ...drop,
        id: `${namespace}:set:${setIndex + 1}:drop:${dropIndex + 1}`,
        sourceDropId: drop.id,
      })),
    })),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
