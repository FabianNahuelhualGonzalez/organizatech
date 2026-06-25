import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createWorkoutAttemptId,
  releaseWorkoutStartLock,
  resolveWorkoutAttemptId,
  tryAcquireWorkoutStartLock,
} from "@/lib/training/training-workout-attempt-lifecycle";

function createCountingGenerator(value: string) {
  let calls = 0;
  return {
    generate: () => {
      calls += 1;
      return value;
    },
    get calls() {
      return calls;
    },
  };
}

async function run() {
  {
    const generator = createCountingGenerator("attempt-1");
    assert.equal(resolveWorkoutAttemptId({
      enabled: true,
      cycleId: "cycle-1",
      cycleDayId: "day-1",
      existingWorkoutAttemptId: null,
    }, generator.generate), "attempt-1");
    assert.equal(generator.calls, 1);
  }

  {
    const generator = createCountingGenerator("attempt-new");
    assert.equal(resolveWorkoutAttemptId({
      enabled: true,
      cycleId: "cycle-1",
      cycleDayId: "day-1",
      existingWorkoutAttemptId: "attempt-existing",
    }, generator.generate), "attempt-existing");
    assert.equal(generator.calls, 0);
  }

  for (const input of [
    { enabled: false, cycleId: "cycle-1", cycleDayId: "day-1", existingWorkoutAttemptId: null },
    { enabled: true, cycleId: null, cycleDayId: "day-1", existingWorkoutAttemptId: null },
    { enabled: true, cycleId: "cycle-1", cycleDayId: null, existingWorkoutAttemptId: null },
  ]) {
    const generator = createCountingGenerator("attempt-1");
    assert.equal(resolveWorkoutAttemptId(input, generator.generate), null);
    assert.equal(generator.calls, 0);
  }

  {
    const generator = createCountingGenerator("");
    assert.throws(() => resolveWorkoutAttemptId({
      enabled: true,
      cycleId: "cycle-1",
      cycleDayId: "day-1",
      existingWorkoutAttemptId: null,
    }, generator.generate), /identidad del entrenamiento/);
    assert.equal(generator.calls, 1);
  }

  {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "attempt-uuid" },
    });
    assert.equal(createWorkoutAttemptId(), "attempt-uuid");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  }

  {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
    assert.throws(() => createWorkoutAttemptId(), /randomUUID/);
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  }


  {
    const lock = { current: false };
    assert.equal(tryAcquireWorkoutStartLock(lock), true);
    assert.equal(lock.current, true);
    assert.equal(tryAcquireWorkoutStartLock(lock), false);
    assert.equal(lock.current, true);
    releaseWorkoutStartLock(lock);
    assert.equal(lock.current, false);
    assert.equal(tryAcquireWorkoutStartLock(lock), true);
    assert.equal(lock.current, true);
    releaseWorkoutStartLock(lock);
  }

  {
    const lock = { current: false };
    const generator = createCountingGenerator("attempt-1");
    function simulatedStart() {
      if (!tryAcquireWorkoutStartLock(lock)) return null;
      try {
        return resolveWorkoutAttemptId({
          enabled: true,
          cycleId: "cycle-1",
          cycleDayId: "day-1",
          existingWorkoutAttemptId: null,
        }, generator.generate);
      } finally {
        releaseWorkoutStartLock(lock);
      }
    }
    assert.equal(simulatedStart(), "attempt-1");
    assert.equal(simulatedStart(), "attempt-1");
    assert.equal(generator.calls, 2);
  }

  {
    const lock = { current: false };
    const generator = createCountingGenerator("attempt-1");
    assert.equal(tryAcquireWorkoutStartLock(lock), true);
    const secondStart = tryAcquireWorkoutStartLock(lock)
      ? resolveWorkoutAttemptId({ enabled: true, cycleId: "cycle-1", cycleDayId: "day-1", existingWorkoutAttemptId: null }, generator.generate)
      : null;
    assert.equal(secondStart, null);
    assert.equal(generator.calls, 0);
    releaseWorkoutStartLock(lock);
  }

  {
    const ref = { current: "attempt-ref" as string | null };
    const generator = createCountingGenerator("attempt-new");
    assert.equal(resolveWorkoutAttemptId({
      enabled: true,
      cycleId: "cycle-1",
      cycleDayId: "day-1",
      existingWorkoutAttemptId: ref.current,
    }, generator.generate), "attempt-ref");
    assert.equal(generator.calls, 0);
  }

  {
    const lock = { current: false };
    assert.equal(tryAcquireWorkoutStartLock(lock), true);
    assert.throws(() => {
      try {
        throw new Error("network");
      } finally {
        releaseWorkoutStartLock(lock);
      }
    }, /network/);
    assert.equal(lock.current, false);
  }
  const source = readFileSync("src/lib/training/training-workout-attempt-lifecycle.ts", "utf8");
  assert.doesNotMatch(source, /Math\.random/);
  assert.match(source, /globalThis\.crypto\?\.randomUUID/);

  console.log("training-workout-attempt lifecycle tests passed");
}

void run();
