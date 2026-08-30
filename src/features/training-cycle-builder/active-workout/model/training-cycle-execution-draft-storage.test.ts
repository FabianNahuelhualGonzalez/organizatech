import assert from "node:assert/strict";
import test from "node:test";

import {
  createTrainingCycleExecutionDraft,
  TRAINING_CYCLE_EXECUTION_DRAFT_MAX_AGE_MS,
  updateTrainingCycleExecutionSet,
  type ResolvedAdvancedWorkoutPlan,
} from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import {
  clearTrainingCycleExecutionDraft,
  getTrainingCycleExecutionDraftStorageKey,
  loadTrainingCycleExecutionDraft,
  saveTrainingCycleExecutionDraft,
  TRAINING_CYCLE_EXECUTION_DRAFT_MAX_RECORDS_PER_USER,
} from "@/features/training-cycle-builder/active-workout/model/training-cycle-execution-draft-storage";
import type { BrowserStorageLike, BrowserStorageScope } from "@/lib/storage/browser-storage";

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

class MemoryStorage implements BrowserStorageLike {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function plan(input: {
  scope?: BrowserStorageScope;
  cycleId?: string;
  dayId?: string;
  attemptId?: string;
} = {}): ResolvedAdvancedWorkoutPlan {
  const cycleId = input.cycleId ?? uuid(2);
  const legacyDayId = uuid(3);
  const legacyExerciseId = uuid(4);
  const lineageId = uuid(5);
  return {
    storageScope: input.scope ?? `supabase:${uuid(1)}`,
    cycleId,
    expectedVersion: 3,
    planSnapshotId: uuid(6),
    daySnapshotId: input.dayId ?? uuid(7),
    legacyCycleDayId: legacyDayId,
    workoutAttemptId: input.attemptId ?? "attempt-1",
    performedAt: "2026-08-29T15:00:00.000-04:00",
    exercises: [{
      legacyExercise: {
        id: legacyExerciseId,
        cycleId,
        cycleDayId: legacyDayId,
        trainingCycleExerciseId: legacyExerciseId,
        exerciseLineageId: lineageId,
        routine: "Día A",
        day: "Lunes",
        name: "Press",
        targetSets: 1,
        targetReps: 10,
        baseWeight: 70,
      },
      plan: {
        snapshotId: uuid(8),
        legacyCycleExerciseId: legacyExerciseId,
        exerciseLineageId: lineageId,
        order: 0,
        technique: "drop_set",
        safeVideoUrl: null,
        sets: [{
          snapshotId: uuid(9),
          order: 0,
          targetReps: 10,
          targetKg: 70,
          toFailure: false,
          drops: [{
            snapshotId: uuid(10),
            order: 0,
            targetReps: 6,
            targetKg: 50,
          }],
        }],
      },
    }],
  };
}

test("persiste un draft versionado y lo recupera sólo para la identidad exacta", () => {
  const storage = new MemoryStorage();
  const activePlan = plan();
  let draft = createTrainingCycleExecutionDraft(activePlan, 1_000);
  draft = updateTrainingCycleExecutionSet(draft, {
    planExerciseId: uuid(8),
    planSetId: uuid(9),
    patch: { completed: true, reps: "9", kg: "72,5", reachedFailure: true },
    updatedAt: 1_100,
  });

  assert.equal(saveTrainingCycleExecutionDraft(activePlan, draft, {
    storage,
    now: () => 1_100,
  }), true);
  assert.deepEqual(loadTrainingCycleExecutionDraft(activePlan, {
    storage,
    now: () => 1_200,
  }), draft);

  const stored = JSON.parse(storage.getItem(getTrainingCycleExecutionDraftStorageKey(activePlan))!);
  assert.equal(stored.version, 1);
  assert.equal(stored.cycleId, activePlan.cycleId);
  assert.equal(stored.daySnapshotId, activePlan.daySnapshotId);
  assert.equal(stored.workoutAttemptId, activePlan.workoutAttemptId);
  assert.equal(stored.exercises[0].planExerciseId, uuid(8));
});

test("scope, ciclo, día e intento ajenos fallan cerrado y nunca exponen el draft", () => {
  const sourcePlan = plan();
  const draft = createTrainingCycleExecutionDraft(sourcePlan, 2_000);

  for (const foreignPlan of [
    plan({ scope: `supabase:${uuid(101)}` }),
    plan({ cycleId: uuid(102) }),
    plan({ dayId: uuid(103) }),
    plan({ attemptId: "attempt-foreign" }),
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(
      getTrainingCycleExecutionDraftStorageKey(foreignPlan),
      JSON.stringify(draft),
    );
    assert.equal(loadTrainingCycleExecutionDraft(foreignPlan, {
      storage,
      now: () => 2_000,
    }), null);
    assert.equal(storage.getItem(getTrainingCycleExecutionDraftStorageKey(foreignPlan)), null);
  }
});

test("el parser elimina drafts vencidos, con campos extra o IDs no pertenecientes al snapshot", () => {
  const activePlan = plan();
  const key = getTrainingCycleExecutionDraftStorageKey(activePlan);
  const valid = createTrainingCycleExecutionDraft(activePlan, 5_000);

  for (const invalid of [
    { ...valid, unexpected: true },
    {
      ...valid,
      exercises: valid.exercises.map((exercise) => ({
        ...exercise,
        planExerciseId: uuid(999),
      })),
    },
    { ...valid, updatedAt: 5_000 - TRAINING_CYCLE_EXECUTION_DRAFT_MAX_AGE_MS - 1 },
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(key, JSON.stringify(invalid));
    assert.equal(loadTrainingCycleExecutionDraft(activePlan, {
      storage,
      now: () => 5_000,
    }), null);
    assert.equal(storage.getItem(key), null);
  }
});

test("clear sólo borra la identidad exacta y no elimina un intento más nuevo", () => {
  const storage = new MemoryStorage();
  const oldPlan = plan({ attemptId: "attempt-old" });
  const newPlan = plan({ attemptId: "attempt-new" });
  const newDraft = createTrainingCycleExecutionDraft(newPlan, 9_000);
  storage.setItem(getTrainingCycleExecutionDraftStorageKey(newPlan), JSON.stringify(newDraft));

  assert.equal(clearTrainingCycleExecutionDraft(oldPlan, storage), false);
  assert.notEqual(storage.getItem(getTrainingCycleExecutionDraftStorageKey(newPlan)), null);
  assert.equal(clearTrainingCycleExecutionDraft(newPlan, storage), true);
  assert.equal(storage.getItem(getTrainingCycleExecutionDraftStorageKey(newPlan)), null);
});

test("conserva días del intento sin superar el máximo acotado por usuario", () => {
  const storage = new MemoryStorage();
  const plans = Array.from(
    { length: TRAINING_CYCLE_EXECUTION_DRAFT_MAX_RECORDS_PER_USER + 1 },
    (_, index) => plan({
      dayId: uuid(200 + index),
      attemptId: `attempt-${index}`,
    }),
  );

  plans.forEach((activePlan, index) => {
    const now = 20_000 + index;
    assert.equal(saveTrainingCycleExecutionDraft(
      activePlan,
      createTrainingCycleExecutionDraft(activePlan, now),
      { storage, now: () => now },
    ), true);
  });

  assert.equal(storage.length, TRAINING_CYCLE_EXECUTION_DRAFT_MAX_RECORDS_PER_USER);
  assert.equal(storage.getItem(getTrainingCycleExecutionDraftStorageKey(plans[0]!)), null);
  for (const activePlan of plans.slice(1)) {
    assert.notEqual(storage.getItem(getTrainingCycleExecutionDraftStorageKey(activePlan)), null);
  }
});
