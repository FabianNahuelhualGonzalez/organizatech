import assert from "node:assert/strict";

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

  console.log("training-workout-readiness flow tests passed");
}

void run();
