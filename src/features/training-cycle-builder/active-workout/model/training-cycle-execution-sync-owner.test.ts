import assert from "node:assert/strict";
import test from "node:test";

import type { RecordOwnTrainingCycleExecutionPayload } from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import {
  TrainingCycleExecutionSyncOwner,
  type TrainingCycleExecutionSyncState,
} from "@/features/training-cycle-builder/active-workout/model/training-cycle-execution-sync-owner";

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

const payload: RecordOwnTrainingCycleExecutionPayload = {
  cycleId: uuid(1),
  expectedVersion: 2,
  performedAt: "2026-08-29T15:00:00.000-04:00",
  execution: {
    dayId: uuid(2),
    exercises: [{
      planExerciseId: uuid(3),
      order: 1,
      sets: [{
        planSetId: uuid(4),
        order: 1,
        completed: false,
        reps: null,
        kg: null,
        reachedFailure: false,
        drops: [],
      }],
    }],
  },
};

test("reintenta sólo el write avanzado con el mismo payload después del PASS legacy", async () => {
  const states: TrainingCycleExecutionSyncState[] = [];
  const writes: RecordOwnTrainingCycleExecutionPayload[] = [];
  const owner = new TrainingCycleExecutionSyncOwner(async (next) => {
    writes.push(next);
    if (writes.length === 1) throw new Error("offline");
  }, (state) => states.push(state));
  owner.replaceScope("user:cycle:attempt");

  assert.equal(await owner.syncAfterLegacyCompletion(payload), false);
  assert.deepEqual(owner.getState(), { status: "error" });
  assert.equal(await owner.retry(), true);
  assert.deepEqual(owner.getState(), { status: "synced" });
  assert.deepEqual(writes, [payload, payload]);
  assert.deepEqual(states.map((state) => state.status), ["idle", "syncing", "error", "syncing", "synced"]);
});

test("single-flight evita writes avanzados duplicados", async () => {
  let resolveWrite!: () => void;
  let writeCount = 0;
  const write = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  const owner = new TrainingCycleExecutionSyncOwner(async () => {
    writeCount += 1;
    await write;
  }, () => undefined);
  owner.replaceScope("user:cycle:attempt");

  const first = owner.syncAfterLegacyCompletion(payload);
  const second = owner.syncAfterLegacyCompletion(payload);
  assert.equal(first, second);
  assert.equal(writeCount, 1);
  resolveWrite();
  assert.equal(await first, true);
  assert.equal(writeCount, 1);
});

test("un resultado de un scope anterior no publica estado en la identidad nueva", async () => {
  let resolveWrite!: () => void;
  const write = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  const states: TrainingCycleExecutionSyncState[] = [];
  const owner = new TrainingCycleExecutionSyncOwner(async () => write, (state) => states.push(state));
  owner.replaceScope("scope-a");
  const pending = owner.syncAfterLegacyCompletion(payload);
  owner.replaceScope("scope-b");
  resolveWrite();

  assert.equal(await pending, false);
  assert.deepEqual(owner.getState(), { status: "idle" });
  assert.equal(states.at(-1)?.status, "idle");
});

test("sin scope o sin error retry no inicia ningún write", async () => {
  let writeCount = 0;
  const owner = new TrainingCycleExecutionSyncOwner(async () => {
    writeCount += 1;
  }, () => undefined);

  assert.equal(await owner.syncAfterLegacyCompletion(payload), false);
  owner.replaceScope("scope-a");
  assert.equal(await owner.retry(), false);
  assert.equal(writeCount, 0);
});
