import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";
import type { LegacyCycleHistorySnapshot } from "@/lib/training/cycle-history/cycle-history-legacy-adapter";
import { normalizeTrainingPlanInput } from "@/lib/training/training-plan-normalization";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

export interface LegacyCycleHistoryIdentityPort {
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface LegacyCycleHistoryStoragePort {
  load(scope: BrowserStorageScope): unknown[];
  save(history: readonly LegacyCycleHistorySnapshot[], scope: BrowserStorageScope): boolean;
}

export interface AppendCompletedCycleInput {
  plan: TrainingPlan;
  exercises: readonly ExerciseTemplate[];
  entries: readonly ExerciseEntry[];
}

export interface LegacyCycleHistoryControllerSnapshot {
  readonly cycleHistory: readonly LegacyCycleHistorySnapshot[];
  readonly legacyCycleHistoryCount: number;
  readonly nextLegacyCycleNumber: number;
}

export interface LegacyCycleHistoryController {
  getSnapshot(): LegacyCycleHistoryControllerSnapshot;
  subscribe(listener: (snapshot: LegacyCycleHistoryControllerSnapshot) => void): () => void;
  appendCompletedCycle(input: AppendCompletedCycleInput): LegacyCycleHistorySnapshot | null;
  replaceIdentityScope(scope: BrowserStorageScope | null): void;
  dispose(): void;
}

export function createLegacyCycleHistoryController(input: {
  identity: LegacyCycleHistoryIdentityPort;
  storage: LegacyCycleHistoryStoragePort;
  now?: () => string;
  createId?: () => string;
}): LegacyCycleHistoryController {
  const listeners = new Set<(snapshot: LegacyCycleHistoryControllerSnapshot) => void>();
  const now = input.now ?? (() => new Date().toISOString());
  const createId = input.createId ?? createCycleId;
  let activeScope: BrowserStorageScope | null = null;
  let cycleHistory: readonly LegacyCycleHistorySnapshot[] = [];
  let disposed = false;

  function getSnapshot(): LegacyCycleHistoryControllerSnapshot {
    return {
      cycleHistory,
      legacyCycleHistoryCount: cycleHistory.length,
      nextLegacyCycleNumber: cycleHistory.length + 1,
    };
  }

  function publish(nextHistory: readonly LegacyCycleHistorySnapshot[]) {
    if (disposed) return;
    cycleHistory = nextHistory;
    const snapshot = getSnapshot();
    for (const listener of listeners) listener(snapshot);
  }

  function isOwnerCurrent(token: SessionDataRequestToken, scope: BrowserStorageScope) {
    return !disposed &&
      activeScope === scope &&
      token.scope === scope &&
      input.identity.isRequestTokenCurrent(token);
  }

  const controller: LegacyCycleHistoryController = {
    getSnapshot,

    subscribe(listener) {
      disposed = false;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    appendCompletedCycle(completedCycle) {
      const token = input.identity.captureRequestToken();
      const scope = activeScope;
      if (!scope || !isOwnerCurrent(token, scope)) return null;
      const endedAt = now();
      const projected = projectLegacyCycleHistorySnapshot({
        id: createId(),
        name: `Ciclo ${cycleHistory.length + 1}`,
        createdAt: completedCycle.entries[0]?.date ?? endedAt,
        endedAt,
        plan: completedCycle.plan,
        exercises: completedCycle.exercises,
        entries: completedCycle.entries,
      });
      if (!projected || !isOwnerCurrent(token, scope)) return null;
      const nextHistory = [...cycleHistory, projected];
      input.storage.save(nextHistory.map(serializeLegacyCycleHistorySnapshot), scope);
      if (!isOwnerCurrent(token, scope)) return null;
      publish(nextHistory);
      return projected;
    },

    replaceIdentityScope(scope) {
      if (scope === activeScope) return;
      activeScope = scope;
      const loaded = scope
        ? input.storage.load(scope)
          .map(projectLegacyCycleHistorySnapshot)
          .filter((record): record is LegacyCycleHistorySnapshot => record !== null)
        : [];
      publish(loaded);
    },

    dispose() {
      if (disposed) return;
      activeScope = null;
      publish([]);
      disposed = true;
      listeners.clear();
    },
  };

  return controller;
}

export function projectLegacyCycleHistorySnapshot(value: unknown): LegacyCycleHistorySnapshot | null {
  const record = readRecord(value);
  if (!record) return null;
  const id = readRequiredString(record.id);
  const name = readRequiredString(record.name);
  const createdAt = readRequiredString(record.createdAt);
  const endedAt = readRequiredString(record.endedAt);
  const rawPlan = readRecord(record.plan);
  if (!id || !name || !createdAt || !endedAt || !rawPlan) return null;

  return {
    id,
    name,
    createdAt,
    endedAt,
    plan: normalizeTrainingPlanInput(rawPlan).plan,
    exercises: Array.isArray(record.exercises)
      ? record.exercises.map(projectExercise).filter((item): item is ExerciseTemplate => item !== null)
      : [],
    entries: Array.isArray(record.entries)
      ? record.entries.map(projectEntry).filter((item): item is ExerciseEntry => item !== null)
      : [],
  };
}

export function serializeLegacyCycleHistorySnapshot(
  snapshot: LegacyCycleHistorySnapshot,
): LegacyCycleHistorySnapshot {
  const projected = projectLegacyCycleHistorySnapshot({
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    endedAt: snapshot.endedAt,
    plan: {
      cycleType: snapshot.plan.cycleType,
      macroObjective: snapshot.plan.macroObjective,
      macroDurationMonths: snapshot.plan.macroDurationMonths,
      mesoObjective: snapshot.plan.mesoObjective,
      mesoDurationWeeks: snapshot.plan.mesoDurationWeeks,
      microDurationWeeks: snapshot.plan.microDurationWeeks,
      sessionDurationDays: snapshot.plan.sessionDurationDays,
      trainingDays: [...snapshot.plan.trainingDays],
      microFocus: snapshot.plan.microFocus,
      sessionFocus: snapshot.plan.sessionFocus,
    },
    exercises: snapshot.exercises.map(projectExerciseForSerialization),
    entries: snapshot.entries.map(projectEntryForSerialization),
  });
  if (!projected) throw new Error("El snapshot legacy no es serializable.");
  return projected;
}

function projectExercise(value: unknown): ExerciseTemplate | null {
  const record = readRecord(value);
  if (!record) return null;
  const id = readRequiredString(record.id);
  const routine = readRequiredString(record.routine);
  const name = readRequiredString(record.name);
  const targetSets = readFiniteNumber(record.targetSets);
  const targetReps = readFiniteNumber(record.targetReps);
  const baseWeight = readFiniteNumber(record.baseWeight);
  if (!id || !routine || !name || targetSets === null || targetReps === null || baseWeight === null) return null;

  const projected: ExerciseTemplate = { id, routine, name, targetSets, targetReps, baseWeight };
  assignOptionalString(projected, "cycleId", record.cycleId);
  assignOptionalString(projected, "cycleDayId", record.cycleDayId);
  assignOptionalString(projected, "trainingCycleExerciseId", record.trainingCycleExerciseId);
  assignOptionalNullableString(projected, "exerciseLineageId", record.exerciseLineageId);
  assignOptionalNullableString(projected, "sourceLegacyExerciseId", record.sourceLegacyExerciseId);
  assignOptionalString(projected, "day", record.day);
  assignOptionalNumber(projected, "sideWeight", record.sideWeight);
  assignOptionalString(projected, "notes", record.notes);
  return projected;
}

function projectEntry(value: unknown): ExerciseEntry | null {
  const record = readRecord(value);
  if (!record || !Array.isArray(record.reps)) return null;
  const id = readRequiredString(record.id);
  const exerciseId = readRequiredString(record.exerciseId);
  const exerciseName = readRequiredString(record.exerciseName);
  const routine = readRequiredString(record.routine);
  const date = readRequiredString(record.date);
  const week = readFiniteNumber(record.week);
  const targetSets = readFiniteNumber(record.targetSets);
  const targetReps = readFiniteNumber(record.targetReps);
  const weight = readFiniteNumber(record.weight);
  const previousWeight = readFiniteNumber(record.previousWeight);
  const reps = record.reps.map(readFiniteNumber);
  if (
    !id || !exerciseId || !exerciseName || !routine || !date ||
    week === null || targetSets === null || targetReps === null ||
    weight === null || previousWeight === null || reps.some((item) => item === null)
  ) return null;

  const projected: ExerciseEntry = {
    id,
    exerciseId,
    exerciseName,
    routine,
    week,
    date,
    targetSets,
    targetReps,
    weight,
    previousWeight,
    reps: reps.filter((item): item is number => item !== null),
  };
  assignOptionalString(projected, "sessionId", record.sessionId);
  assignOptionalString(projected, "cycleId", record.cycleId);
  assignOptionalNullableString(projected, "cycleDayId", record.cycleDayId);
  assignOptionalString(projected, "trainingCycleExerciseId", record.trainingCycleExerciseId);
  assignOptionalNullableString(projected, "exerciseLineageId", record.exerciseLineageId);
  assignOptionalString(projected, "notes", record.notes);
  assignOptionalString(projected, "observation", record.observation);
  assignOptionalString(projected, "rir", record.rir);
  return projected;
}

function projectExerciseForSerialization(exercise: ExerciseTemplate) {
  return {
    id: exercise.id,
    cycleId: exercise.cycleId,
    cycleDayId: exercise.cycleDayId,
    trainingCycleExerciseId: exercise.trainingCycleExerciseId,
    exerciseLineageId: exercise.exerciseLineageId,
    sourceLegacyExerciseId: exercise.sourceLegacyExerciseId,
    routine: exercise.routine,
    day: exercise.day,
    name: exercise.name,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    baseWeight: exercise.baseWeight,
    sideWeight: exercise.sideWeight,
    notes: exercise.notes,
  };
}

function projectEntryForSerialization(entry: ExerciseEntry) {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    cycleId: entry.cycleId,
    cycleDayId: entry.cycleDayId,
    trainingCycleExerciseId: entry.trainingCycleExerciseId,
    exerciseLineageId: entry.exerciseLineageId,
    exerciseId: entry.exerciseId,
    exerciseName: entry.exerciseName,
    routine: entry.routine,
    week: entry.week,
    date: entry.date,
    targetSets: entry.targetSets,
    targetReps: entry.targetReps,
    weight: entry.weight,
    previousWeight: entry.previousWeight,
    reps: [...entry.reps],
    notes: entry.notes,
    observation: entry.observation,
    rir: entry.rir,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRequiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assignOptionalString<T extends object, K extends keyof T>(target: T, key: K, value: unknown) {
  if (typeof value === "string") target[key] = value as T[K];
}

function assignOptionalNullableString<T extends object, K extends keyof T>(target: T, key: K, value: unknown) {
  if (value === null || typeof value === "string") target[key] = value as T[K];
}

function assignOptionalNumber<T extends object, K extends keyof T>(target: T, key: K, value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) target[key] = value as T[K];
}

function createCycleId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
