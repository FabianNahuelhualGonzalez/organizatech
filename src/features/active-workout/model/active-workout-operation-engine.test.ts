import assert from "node:assert/strict";
import test from "node:test";

import type { ActiveWorkoutControllerActions } from "@/features/active-workout/hooks/useActiveWorkoutController";
import type { ActiveWorkoutIdentityPort } from "@/features/active-workout/model/active-workout-boundary-contract";
import {
  createActiveWorkoutOperationLocks,
  getActiveWorkoutOperationOwner,
  runActiveWorkoutOperation,
} from "@/features/active-workout/model/active-workout-operation-engine";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  type SessionDataEpoch,
} from "@/lib/session/session-data-epoch";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const actions = {} as ActiveWorkoutControllerActions;
const runtime = { attemptId: null, pendingReadinessLink: null, readinessContext: null };
const identityA = { userId: "user-a", scope: "supabase:user-a" };
const identityB = { userId: "user-b", scope: "supabase:user-b" };

function createIdentityPort(getEpoch: () => SessionDataEpoch): ActiveWorkoutIdentityPort {
  return {
    dataMode: "supabase",
    captureRequestToken: () => captureSessionDataRequestToken(getEpoch()),
    isRequestTokenCurrent: (token) => isSessionDataRequestTokenCurrent(getEpoch(), token),
  };
}

test("completion doble submit ejecuta una operación y libera sólo su owner", async () => {
  const epoch = createSessionDataEpoch(identityA);
  const locks = createActiveWorkoutOperationLocks();
  const deferred = createDeferred<string>();
  let executions = 0;
  const input = {
    operation: "completion" as const,
    locks,
    identity: createIdentityPort(() => epoch),
    actions,
    getRuntimeSnapshot: () => runtime,
    replaceRuntimeSnapshot: () => undefined,
    command: async () => {
      executions += 1;
      await deferred.promise;
      return "success" as const;
    },
  };

  const first = runActiveWorkoutOperation(input);
  const owner = getActiveWorkoutOperationOwner(locks, "completion");
  assert.ok(owner);
  const second = await runActiveWorkoutOperation(input);
  assert.equal(second, "ignored");
  assert.equal(executions, 1);
  assert.equal(getActiveWorkoutOperationOwner(locks, "completion"), owner);

  deferred.resolve("saved");
  assert.equal(await first, "success");
  assert.equal(getActiveWorkoutOperationOwner(locks, "completion"), null);
  assert.equal(epoch.userId, "user-a");
});

for (const lateResult of ["success", "error"] as const) {
  test(`A→SIGNED_OUT→B descarta ${lateResult}/finally tardío de A y conserva B`, async () => {
    let epoch = createSessionDataEpoch(identityA);
    const locks = createActiveWorkoutOperationLocks();
    const deferredA = createDeferred<string>();
    const deferredB = createDeferred<string>();
    const state = { value: "a", error: "", busy: "a", notice: "a" };
    const port = createIdentityPort(() => epoch);

    const pendingA = runActiveWorkoutOperation({
      operation: "completion",
      locks,
      identity: port,
      actions,
      getRuntimeSnapshot: () => runtime,
      replaceRuntimeSnapshot: () => undefined,
      command: async (context) => {
        const result = await context.settle(deferredA.promise);
        if (result.kind === "success") state.value = result.value;
        if (result.kind === "error") state.error = "error-a";
        if (context.isCurrent()) {
          state.busy = "";
          state.notice = "";
        }
        return result.kind;
      },
    });

    epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null }, { force: true });
    for (const lock of Object.values(locks)) lock.current = null;
    epoch = advanceSessionDataEpoch(epoch, identityB);
    state.value = "b";
    state.error = "error-b";
    state.busy = "busy-b";
    state.notice = "notice-b";

    const pendingB = runActiveWorkoutOperation({
      operation: "completion",
      locks,
      identity: port,
      actions,
      getRuntimeSnapshot: () => runtime,
      replaceRuntimeSnapshot: () => undefined,
      command: async () => {
        await deferredB.promise;
        return "success";
      },
    });
    const ownerB = getActiveWorkoutOperationOwner(locks, "completion");
    assert.ok(ownerB);

    if (lateResult === "success") deferredA.resolve("late-a");
    else deferredA.reject(new Error("late-a"));
    assert.equal(await pendingA, "stale");
    assert.deepEqual(state, {
      value: "b",
      error: "error-b",
      busy: "busy-b",
      notice: "notice-b",
    });
    assert.equal(getActiveWorkoutOperationOwner(locks, "completion"), ownerB);

    deferredB.resolve("saved-b");
    assert.equal(await pendingB, "success");
    assert.equal(getActiveWorkoutOperationOwner(locks, "completion"), null);
  });
}
