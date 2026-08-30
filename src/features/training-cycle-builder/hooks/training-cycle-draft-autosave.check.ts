import assert from "node:assert/strict";
import test from "node:test";

import type {
  TrainingCycleSaveDraftInput,
  TrainingCycleSaveDraftResult,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import {
  TrainingCycleDraftAutosaveOwner,
  type TrainingCycleDraftAutosaveEvent,
} from "@/features/training-cycle-builder/hooks/training-cycle-draft-autosave";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function input(endDate: string, draftId = "draft-1"): TrainingCycleSaveDraftInput {
  return {
    draftId,
    origin: "manual",
    goal: "strength",
    startDate: "2026-08-01",
    endDate,
    days: [],
  };
}

test("autosave es single-flight, coalesce y deja persistido el último snapshot", async () => {
  const first = deferred<TrainingCycleSaveDraftResult>();
  const latest = deferred<TrainingCycleSaveDraftResult>();
  const gates = [first, latest];
  const writes: string[] = [];
  const persisted: string[] = [];
  const events: TrainingCycleDraftAutosaveEvent[] = [];
  let concurrency = 0;
  let maxConcurrency = 0;

  const owner = new TrainingCycleDraftAutosaveOwner({
    async write(payload) {
      const gate = gates[writes.length];
      writes.push(payload.endDate);
      concurrency += 1;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      try {
        const result = await gate.promise;
        persisted.push(payload.endDate);
        return result;
      } finally {
        concurrency -= 1;
      }
    },
    onEvent(event) {
      events.push(event);
    },
  });

  owner.resume("draft-1");
  const firstRequest = owner.request(input("2026-09-01"));
  const replacedRequest = owner.request(input("2026-10-01"));
  const latestRequest = owner.request(input("2026-11-01"));

  assert.deepEqual(writes, ["2026-09-01"]);
  assert.deepEqual(await replacedRequest, { status: "superseded" });

  first.resolve({ status: "saved", savedAtLabel: "primero" });
  assert.deepEqual(await firstRequest, { status: "superseded" });
  assert.deepEqual(writes, ["2026-09-01", "2026-11-01"]);

  latest.resolve({ status: "saved", savedAtLabel: "último" });
  assert.deepEqual(await latestRequest, { status: "saved", savedAtLabel: "último" });
  await owner.whenIdle();

  assert.equal(maxConcurrency, 1);
  assert.deepEqual(persisted, ["2026-09-01", "2026-11-01"]);
  assert.equal(persisted.at(-1), "2026-11-01");
  assert.deepEqual(events, [{ status: "saved", savedAtLabel: "último" }]);
});

test("un claim de debounce invalida saved anterior antes de encolar el snapshot nuevo", async () => {
  const stale = deferred<TrainingCycleSaveDraftResult>();
  const current = deferred<TrainingCycleSaveDraftResult>();
  const events: TrainingCycleDraftAutosaveEvent[] = [];
  const writes: string[] = [];

  const owner = new TrainingCycleDraftAutosaveOwner({
    async write(payload) {
      writes.push(payload.endDate);
      return writes.length === 1 ? stale.promise : current.promise;
    },
    onEvent(event) {
      events.push(event);
    },
  });

  owner.resume("draft-1");
  const staleRequest = owner.request(input("2026-09-01"));
  const latestClaim = owner.claim("draft-1");
  assert.ok(latestClaim);

  stale.resolve({ status: "saved", savedAtLabel: "obsoleto" });
  assert.deepEqual(await staleRequest, { status: "superseded" });
  assert.deepEqual(events, []);

  const latestRequest = owner.request(input("2026-10-01"), latestClaim);
  current.resolve({ status: "saved", savedAtLabel: "vigente" });
  assert.deepEqual(await latestRequest, { status: "saved", savedAtLabel: "vigente" });
  assert.deepEqual(writes, ["2026-09-01", "2026-10-01"]);
  assert.deepEqual(events, [{ status: "saved", savedAtLabel: "vigente" }]);
});

test("pause invalida callbacks de unmount y una generación nueva espera al write físico", async () => {
  const stale = deferred<TrainingCycleSaveDraftResult>();
  const current = deferred<TrainingCycleSaveDraftResult>();
  const gates = [stale, current];
  const writes: string[] = [];
  const events: TrainingCycleDraftAutosaveEvent[] = [];
  let concurrency = 0;
  let maxConcurrency = 0;

  const owner = new TrainingCycleDraftAutosaveOwner({
    async write(payload) {
      const gate = gates[writes.length];
      writes.push(payload.draftId);
      concurrency += 1;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      try {
        return await gate.promise;
      } finally {
        concurrency -= 1;
      }
    },
    onEvent(event) {
      events.push(event);
    },
  });

  owner.resume("draft-old");
  const staleRequest = owner.request(input("2026-09-01", "draft-old"));
  owner.pause();
  owner.resume("draft-new");
  const currentRequest = owner.request(input("2026-10-01", "draft-new"));
  assert.deepEqual(writes, ["draft-old"]);

  stale.resolve({ status: "saved", savedAtLabel: "obsoleto" });
  assert.deepEqual(await staleRequest, { status: "superseded" });
  assert.deepEqual(writes, ["draft-old", "draft-new"]);

  owner.pause();
  current.resolve({ status: "saved", savedAtLabel: "desmontado" });
  assert.deepEqual(await currentRequest, { status: "superseded" });
  await owner.whenIdle();

  assert.equal(maxConcurrency, 1);
  assert.deepEqual(events, []);
});

test("un error publicable permite reintentar el último payload sin solapamiento", async () => {
  const failed = deferred<TrainingCycleSaveDraftResult>();
  const retried = deferred<TrainingCycleSaveDraftResult>();
  const gates = [failed, retried];
  const events: TrainingCycleDraftAutosaveEvent[] = [];
  let calls = 0;
  let concurrency = 0;
  let maxConcurrency = 0;

  const owner = new TrainingCycleDraftAutosaveOwner({
    async write() {
      const gate = gates[calls];
      calls += 1;
      concurrency += 1;
      maxConcurrency = Math.max(maxConcurrency, concurrency);
      try {
        return await gate.promise;
      } finally {
        concurrency -= 1;
      }
    },
    onEvent(event) {
      events.push(event);
    },
  });

  owner.resume("draft-1");
  const failedRequest = owner.request(input("2026-09-01"));
  failed.reject(new Error("network"));
  assert.equal((await failedRequest).status, "error");

  const retryRequest = owner.request(input("2026-09-01"));
  retried.resolve({ status: "saved", savedAtLabel: "reintento" });
  assert.deepEqual(await retryRequest, { status: "saved", savedAtLabel: "reintento" });
  await owner.whenIdle();

  assert.equal(maxConcurrency, 1);
  assert.deepEqual(events.map((event) => event.status), ["error", "saved"]);
});
