import assert from "node:assert/strict";

import { releaseWorkoutStartLock, tryAcquireWorkoutStartLock } from "@/lib/training/training-workout-attempt-lifecycle";
import {
  resolveTrainingWorkoutReadinessMode,
  toTrainingWorkoutReadinessPayload,
  TrainingWorkoutReadinessFlowError,
  type TrainingWorkoutReadinessContext,
} from "@/lib/training/training-workout-readiness-flow";

const completeContext: TrainingWorkoutReadinessContext = {
  enabled: true,
  cycleScoped: true,
  workoutAttemptId: "attempt-1",
  cycleId: "cycle-1",
  cycleDayId: "day-1",
  workoutStartedAt: "2026-06-25T10:00:00.000Z",
};

function cloneContext(overrides: Partial<TrainingWorkoutReadinessContext> = {}) {
  return { ...completeContext, ...overrides };
}

async function simulateSubmit(
  lock: { current: boolean },
  value: Parameters<typeof toTrainingWorkoutReadinessPayload>[0],
  save: (payload: ReturnType<typeof toTrainingWorkoutReadinessPayload>) => Promise<void>,
) {
  if (!tryAcquireWorkoutStartLock(lock)) return "locked";
  try {
    const payload = toTrainingWorkoutReadinessPayload(value);
    await save(payload);
    return "saved";
  } finally {
    releaseWorkoutStartLock(lock);
  }
}

async function run() {
  assert.equal(resolveTrainingWorkoutReadinessMode(cloneContext({ enabled: false })), "legacy");
  assert.equal(resolveTrainingWorkoutReadinessMode(cloneContext({ cycleScoped: false })), "legacy");
  assert.equal(resolveTrainingWorkoutReadinessMode(completeContext), "attempt_v2");

  for (const overrides of [
    { workoutAttemptId: null },
    { cycleId: null },
    { cycleDayId: null },
    { workoutStartedAt: null },
    { workoutAttemptId: "" },
    { cycleId: " " },
    { cycleDayId: "" },
    { workoutStartedAt: "" },
  ] satisfies Array<Partial<TrainingWorkoutReadinessContext>>) {
    assert.throws(() => resolveTrainingWorkoutReadinessMode(cloneContext(overrides)), TrainingWorkoutReadinessFlowError);
  }

  const input = cloneContext();
  const before = JSON.stringify(input);
  resolveTrainingWorkoutReadinessMode(input);
  assert.equal(JSON.stringify(input), before);

  assert.deepEqual(toTrainingWorkoutReadinessPayload({ skipped: true, motivation: 7 }), { skipped: true });
  assert.deepEqual(toTrainingWorkoutReadinessPayload({
    skipped: false,
    motivation: 1,
    hydration: 7,
    sleep: 4,
    energy: 5,
  }), {
    skipped: false,
    motivation: 1,
    hydration: 7,
    sleep: 4,
    energy: 5,
  });

  for (const invalid of [
    { skipped: false, hydration: 7, sleep: 4, energy: 5 },
    { skipped: false, motivation: 0, hydration: 7, sleep: 4, energy: 5 },
    { skipped: false, motivation: 8, hydration: 7, sleep: 4, energy: 5 },
    { skipped: false, motivation: 3.5, hydration: 7, sleep: 4, energy: 5 },
    { skipped: false, motivation: Number.NaN, hydration: 7, sleep: 4, energy: 5 },
    { skipped: false, motivation: Number.POSITIVE_INFINITY, hydration: 7, sleep: 4, energy: 5 },
    { skipped: false, motivation: "5", hydration: 7, sleep: 4, energy: 5 },
  ]) {
    assert.throws(() => toTrainingWorkoutReadinessPayload(invalid), TrainingWorkoutReadinessFlowError);
  }

  {
    const value = { skipped: true, motivation: 7 };
    const beforeValue = JSON.stringify(value);
    toTrainingWorkoutReadinessPayload(value);
    assert.equal(JSON.stringify(value), beforeValue);
  }

  for (const [firstPayload, secondPayload] of [
    [{ skipped: false, motivation: 5, hydration: 5, sleep: 5, energy: 5 }, { skipped: true }],
    [{ skipped: true }, { skipped: false, motivation: 5, hydration: 5, sleep: 5, energy: 5 }],
    [{ skipped: false, motivation: 5, hydration: 5, sleep: 5, energy: 5 }, { skipped: false, motivation: 6, hydration: 6, sleep: 6, energy: 6 }],
    [{ skipped: true }, { skipped: true }],
  ] as const) {
    const lock = { current: false };
    const saves: unknown[] = [];
    let releaseSave: () => void = () => { throw new Error("save was not started"); };
    const first = simulateSubmit(lock, firstPayload, (payload) => new Promise<void>((resolve) => {
      saves.push(payload);
      releaseSave = resolve;
    }));
    const second = await simulateSubmit(lock, secondPayload, async (payload) => {
      saves.push(payload);
    });
    assert.equal(second, "locked");
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0], toTrainingWorkoutReadinessPayload(firstPayload));
    releaseSave();
    assert.equal(await first, "saved");
    assert.equal(lock.current, false);
  }

  {
    const lock = { current: false };
    await assert.rejects(
      () => simulateSubmit(lock, { skipped: false, motivation: 0 }, async () => undefined),
      TrainingWorkoutReadinessFlowError,
    );
    assert.equal(lock.current, false);
    assert.equal(await simulateSubmit(lock, { skipped: true }, async () => undefined), "saved");
  }

  {
    const lock = { current: false };
    await assert.rejects(() => simulateSubmit(lock, { skipped: true }, async () => {
      throw new Error("remote");
    }), /remote/);
    assert.equal(lock.current, false);
  }

  console.log("training-workout-readiness flow tests passed");
}

void run();
