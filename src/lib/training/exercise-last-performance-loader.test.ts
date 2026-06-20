import assert from "node:assert/strict";

import {
  createStableWorkoutStartedAt,
  createLatestExercisePerformanceRequest,
  getLatestExercisePerformanceIdleState,
  getLatestExercisePerformanceLoadingState,
  isStableWorkoutStartedAt,
  loadLatestExercisePerformanceForRequest,
  resolveStableWorkoutStartedAt,
  type LatestExercisePerformanceFetcher,
} from "@/lib/training/exercise-last-performance-loader";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";

const LINEAGE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LINEAGE_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const BEFORE_TIMESTAMP = "2026-06-18T12:00:00.000Z";

function createPerformance(overrides: Partial<LatestExercisePerformance> = {}): LatestExercisePerformance {
  return {
    sessionId: "44444444-4444-4444-8444-444444444444",
    exerciseLineageId: LINEAGE_ID,
    trainedDate: "2026-06-17",
    trainedAt: "2026-06-17T12:00:00.000Z",
    completedAt: "2026-06-17T13:00:00.000Z",
    createdAt: "2026-06-17T12:00:00.000Z",
    series: [
      {
        entryId: "55555555-5555-4555-8555-555555555555",
        order: 1,
        weight: 80,
        previousWeight: 75,
        reps: 10,
        rir: null,
        notes: null,
        createdAt: "2026-06-17T12:05:00.000Z",
      },
    ],
    ...overrides,
  };
}

async function run() {
  {
    const timestamp = createStableWorkoutStartedAt(new Date(BEFORE_TIMESTAMP));
    assert.equal(timestamp, BEFORE_TIMESTAMP);
    assert.equal(isStableWorkoutStartedAt(timestamp), true);
    assert.equal(isStableWorkoutStartedAt("2026-06-18"), false);
    assert.equal(isStableWorkoutStartedAt(""), false);
  }

  {
    const restored = resolveStableWorkoutStartedAt(BEFORE_TIMESTAMP, () => "2026-06-19T12:00:00.000Z");
    assert.deepEqual(restored, {
      value: BEFORE_TIMESTAMP,
      wasGenerated: false,
    });
  }

  {
    let generated = 0;
    const legacy = resolveStableWorkoutStartedAt(undefined, () => {
      generated += 1;
      return BEFORE_TIMESTAMP;
    });
    const restored = resolveStableWorkoutStartedAt(legacy.value, () => {
      generated += 1;
      return "2026-06-19T12:00:00.000Z";
    });

    assert.equal(generated, 1);
    assert.deepEqual(legacy, {
      value: BEFORE_TIMESTAMP,
      wasGenerated: true,
    });
    assert.deepEqual(restored, {
      value: BEFORE_TIMESTAMP,
      wasGenerated: false,
    });
  }

  {
    const normalized = resolveStableWorkoutStartedAt("not-a-date", () => BEFORE_TIMESTAMP);
    assert.deepEqual(normalized, {
      value: BEFORE_TIMESTAMP,
      wasGenerated: true,
    });
  }

  {
    const requestBeforeReload = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const requestAfterReload = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: resolveStableWorkoutStartedAt(BEFORE_TIMESTAMP).value,
    });

    assert.equal(requestBeforeReload?.params.beforeTimestamp, BEFORE_TIMESTAMP);
    assert.equal(requestAfterReload?.params.beforeTimestamp, BEFORE_TIMESTAMP);
    assert.equal(requestBeforeReload?.key, requestAfterReload?.key);
  }

  {
    let calls = 0;
    const result = await loadLatestExercisePerformanceForRequest({
      request: createLatestExercisePerformanceRequest({
        exerciseLineageId: null,
        currentSessionId: SESSION_ID,
        beforeTimestamp: BEFORE_TIMESTAMP,
      }),
      fetcher: async () => {
        calls += 1;
        return createPerformance();
      },
    });

    assert.equal(calls, 0);
    assert.equal(result.didQuery, false);
    assert.equal(result.performance, null);
    assert.equal(result.error, "");
  }

  {
    assert.deepEqual(getLatestExercisePerformanceIdleState(), {
      performance: null,
      loading: false,
      error: "",
    });
    assert.deepEqual(getLatestExercisePerformanceLoadingState(), {
      performance: null,
      loading: true,
      error: "",
    });
  }

  {
    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.ok(request);
    assert.deepEqual(request.params, {
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
  }

  {
    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: "Remo T",
      currentSessionId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.equal(request, null);
  }

  {
    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const result = await loadLatestExercisePerformanceForRequest({
      request,
      fetcher: async () => null,
    });

    assert.equal(result.didQuery, true);
    assert.equal(result.stale, false);
    assert.equal(result.performance, null);
    assert.equal(result.error, "");
  }

  {
    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const result = await loadLatestExercisePerformanceForRequest({
      request,
      fetcher: async () => {
        throw new Error("Supabase unavailable");
      },
    });

    assert.equal(result.didQuery, true);
    assert.equal(result.stale, false);
    assert.equal(result.performance, null);
    assert.equal(result.error, "No pudimos cargar el historial anterior del ejercicio.");
  }

  {
    const firstRequest = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const secondRequest = createLatestExercisePerformanceRequest({
      exerciseLineageId: OTHER_LINEAGE_ID,
      currentSessionId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.ok(firstRequest);
    assert.ok(secondRequest);

    let currentKey = secondRequest.key;
    const result = await loadLatestExercisePerformanceForRequest({
      request: firstRequest,
      getCurrentRequestKey: () => currentKey,
      fetcher: async () => createPerformance(),
    });

    assert.equal(result.stale, true);
    assert.equal(result.performance, null);
    assert.equal(result.loading, false);
    assert.equal(result.error, "");
    currentKey = firstRequest.key;
  }

  {
    const calls: Array<Parameters<LatestExercisePerformanceFetcher>[0]> = [];
    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: new Date(BEFORE_TIMESTAMP),
    });

    const result = await loadLatestExercisePerformanceForRequest({
      request,
      fetcher: async (params) => {
        calls.push(params);
        return createPerformance();
      },
    });

    assert.equal(result.performance?.sessionId, "44444444-4444-4444-8444-444444444444");
    assert.deepEqual(calls, [
      {
        exerciseLineageId: LINEAGE_ID,
        currentSessionId: SESSION_ID,
        beforeTimestamp: BEFORE_TIMESTAMP,
      },
    ]);
  }
}

void run();
