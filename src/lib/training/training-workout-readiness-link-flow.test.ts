import assert from "node:assert/strict";

import { releaseWorkoutStartLock, tryAcquireWorkoutStartLock } from "@/lib/training/training-workout-attempt-lifecycle";
import {
  createWorkoutReadinessPendingLink,
  TrainingWorkoutReadinessLinkFlowError,
} from "@/lib/training/training-workout-readiness-link-flow";
import type { PendingWorkoutReadinessLink } from "@/lib/training/workout-draft-storage";

interface SimulatedCompletionOptions {
  enabled: boolean;
  cycleScoped: boolean;
  workoutAttemptId: string | null;
  pending: PendingWorkoutReadinessLink | null;
  saveSession: () => Promise<string>;
  persistPending: (pending: PendingWorkoutReadinessLink) => void;
  link: (pending: PendingWorkoutReadinessLink) => Promise<{ trainingSessionId: string; linked: boolean; alreadyLinked: boolean }>;
  cleanup: () => void;
  lock: { current: boolean };
}

async function simulateCompletion(options: SimulatedCompletionOptions) {
  if (!tryAcquireWorkoutStartLock(options.lock)) return "locked";
  try {
    if (options.pending) {
      const result = await options.link(options.pending);
      if (result.trainingSessionId !== options.pending.trainingSessionId) throw new TrainingWorkoutReadinessLinkFlowError("session mismatch");
      if (!result.linked && !result.alreadyLinked) throw new TrainingWorkoutReadinessLinkFlowError("link failed");
      options.cleanup();
      return "linked";
    }

    if (options.enabled && options.cycleScoped && !isNonEmptyString(options.workoutAttemptId)) {
      throw new TrainingWorkoutReadinessLinkFlowError("missing attempt");
    }

    const trainingSessionId = options.enabled && options.cycleScoped ? await options.saveSession() : null;
    const pendingLink = createWorkoutReadinessPendingLink({
      enabled: options.enabled,
      cycleScoped: options.cycleScoped,
      workoutAttemptId: options.workoutAttemptId,
      trainingSessionId,
    });

    if (!pendingLink) {
      await options.saveSession();
      options.cleanup();
      return "legacy";
    }

    options.persistPending(pendingLink);
    const result = await options.link(pendingLink);
    if (result.trainingSessionId !== pendingLink.trainingSessionId) throw new TrainingWorkoutReadinessLinkFlowError("session mismatch");
    if (!result.linked && !result.alreadyLinked) throw new TrainingWorkoutReadinessLinkFlowError("link failed");
    options.cleanup();
    return "linked";
  } finally {
    releaseWorkoutStartLock(options.lock);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function run() {
  assert.equal(createWorkoutReadinessPendingLink({
    enabled: false,
    cycleScoped: true,
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
  }), null);

  assert.equal(createWorkoutReadinessPendingLink({
    enabled: true,
    cycleScoped: false,
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
  }), null);

  assert.deepEqual(createWorkoutReadinessPendingLink({
    enabled: true,
    cycleScoped: true,
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
  }), {
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
  });

  for (const invalid of [
    { workoutAttemptId: null, trainingSessionId: "session-1" },
    { workoutAttemptId: undefined, trainingSessionId: "session-1" },
    { workoutAttemptId: "", trainingSessionId: "session-1" },
    { workoutAttemptId: "   ", trainingSessionId: "session-1" },
    { workoutAttemptId: "attempt-1", trainingSessionId: null },
    { workoutAttemptId: "attempt-1", trainingSessionId: undefined },
    { workoutAttemptId: "attempt-1", trainingSessionId: "" },
    { workoutAttemptId: "attempt-1", trainingSessionId: "   " },
  ]) {
    assert.throws(() => createWorkoutReadinessPendingLink({
      enabled: true,
      cycleScoped: true,
      ...invalid,
    }), TrainingWorkoutReadinessLinkFlowError);
  }

  {
    const input = {
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-retry",
      trainingSessionId: "session-retry",
    };
    const before = JSON.stringify(input);
    const first = createWorkoutReadinessPendingLink(input);
    const retry = createWorkoutReadinessPendingLink({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: first?.workoutAttemptId,
      trainingSessionId: first?.trainingSessionId,
    });

    assert.equal(JSON.stringify(input), before, "createWorkoutReadinessPendingLink no muta el input");
    assert.deepEqual(retry, first, "retry conserva exactamente ambos IDs");
  }

  {
    const events: string[] = [];
    let pending: PendingWorkoutReadinessLink | null = null;
    const result = await simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-1",
      pending: null,
      lock: { current: false },
      async saveSession() {
        events.push("save-session");
        return "session-1";
      },
      persistPending(next) {
        events.push(`persist-pending:${next.workoutAttemptId}:${next.trainingSessionId}`);
        pending = next;
      },
      async link(next) {
        events.push(`link:${next.workoutAttemptId}:${next.trainingSessionId}`);
        return { trainingSessionId: next.trainingSessionId, linked: true, alreadyLinked: false };
      },
      cleanup() {
        events.push("cleanup");
        pending = null;
      },
    });

    assert.equal(result, "linked");
    assert.deepEqual(events, ["save-session", "persist-pending:attempt-1:session-1", "link:attempt-1:session-1", "cleanup"]);
    assert.equal(pending, null);
  }

  {
    const events: string[] = [];
    const pending = { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" };
    const result = await simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-1",
      pending,
      lock: { current: false },
      async saveSession() {
        events.push("save-session");
        return "session-new";
      },
      persistPending(next) {
        events.push(`persist:${next.trainingSessionId}`);
      },
      async link(next) {
        events.push(`retry-link:${next.workoutAttemptId}:${next.trainingSessionId}`);
        return { trainingSessionId: next.trainingSessionId, linked: true, alreadyLinked: true };
      },
      cleanup() {
        events.push("cleanup");
      },
    });

    assert.equal(result, "linked");
    assert.deepEqual(events, ["retry-link:attempt-1:session-1", "cleanup"]);
  }

  {
    const events: string[] = [];
    let pending: PendingWorkoutReadinessLink | null = null;
    await assert.rejects(() => simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-1",
      pending: null,
      lock: { current: false },
      async saveSession() {
        events.push("save-session");
        return "session-1";
      },
      persistPending(next) {
        events.push("persist-pending");
        pending = next;
      },
      async link() {
        events.push("link-error");
        throw new Error("network");
      },
      cleanup() {
        events.push("cleanup");
        pending = null;
      },
    }), /network/);

    assert.deepEqual(events, ["save-session", "persist-pending", "link-error"]);
    assert.deepEqual(pending, { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" });
  }

  {
    const events: string[] = [];
    const result = await simulateCompletion({
      enabled: false,
      cycleScoped: true,
      workoutAttemptId: null,
      pending: null,
      lock: { current: false },
      async saveSession() {
        events.push("legacy-save-session");
        return "legacy-session";
      },
      persistPending() {
        events.push("unexpected-pending");
      },
      async link() {
        events.push("unexpected-link");
        return { trainingSessionId: "legacy-session", linked: true, alreadyLinked: false };
      },
      cleanup() {
        events.push("legacy-cleanup");
      },
    });

    assert.equal(result, "legacy");
    assert.deepEqual(events, ["legacy-save-session", "legacy-cleanup"]);
  }

  {
    const events: string[] = [];
    await assert.rejects(() => simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: null,
      pending: null,
      lock: { current: false },
      async saveSession() {
        events.push("unexpected-save-session");
        return "session-1";
      },
      persistPending() {
        events.push("unexpected-pending");
      },
      async link() {
        events.push("unexpected-link");
        return { trainingSessionId: "session-1", linked: true, alreadyLinked: false };
      },
      cleanup() {
        events.push("unexpected-cleanup");
      },
    }), TrainingWorkoutReadinessLinkFlowError);
    assert.deepEqual(events, []);
  }

  {
    const events: string[] = [];
    await assert.rejects(() => simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-1",
      pending: null,
      lock: { current: false },
      async saveSession() {
        events.push("save-session");
        return "session-1";
      },
      persistPending(next) {
        events.push(`persist:${next.trainingSessionId}`);
      },
      async link() {
        events.push("mismatch-link");
        return { trainingSessionId: "other-session", linked: true, alreadyLinked: false };
      },
      cleanup() {
        events.push("cleanup");
      },
    }), TrainingWorkoutReadinessLinkFlowError);

    assert.deepEqual(events, ["save-session", "persist:session-1", "mismatch-link"]);
  }

  {
    const lock = { current: false };
    const events: string[] = [];
    let releaseSave: () => void = () => { throw new Error("save was not started"); };
    const first = simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-1",
      pending: null,
      lock,
      saveSession: () => new Promise((resolve) => {
        events.push("save-session");
        releaseSave = () => resolve("session-1");
      }),
      persistPending(next) {
        events.push(`persist:${next.trainingSessionId}`);
      },
      async link(next) {
        events.push(`link:${next.trainingSessionId}`);
        return { trainingSessionId: next.trainingSessionId, linked: true, alreadyLinked: false };
      },
      cleanup() {
        events.push("cleanup");
      },
    });
    const second = await simulateCompletion({
      enabled: true,
      cycleScoped: true,
      workoutAttemptId: "attempt-1",
      pending: null,
      lock,
      async saveSession() {
        events.push("duplicate-save-session");
        return "session-duplicate";
      },
      persistPending(next) {
        events.push(`duplicate-persist:${next.trainingSessionId}`);
      },
      async link(next) {
        events.push(`duplicate-link:${next.trainingSessionId}`);
        return { trainingSessionId: next.trainingSessionId, linked: true, alreadyLinked: false };
      },
      cleanup() {
        events.push("duplicate-cleanup");
      },
    });

    assert.equal(second, "locked");
    releaseSave();
    assert.equal(await first, "linked");
    assert.deepEqual(events, ["save-session", "persist:session-1", "link:session-1", "cleanup"]);
  }

  console.log("training-workout-readiness link flow tests passed");
}

void run();
