import {
  normalizeExerciseLineageId,
  normalizeHistoricalTimestamp,
  type GetLatestExercisePerformanceByLineageInput,
  type LatestExercisePerformance,
} from "@/lib/training/exercise-last-performance-repository";

export interface LatestExercisePerformanceLoadContext {
  exerciseLineageId?: string | null;
  currentSessionId?: string | null;
  beforeTimestamp?: string | Date | null;
}

export interface LatestExercisePerformanceLoadRequest {
  key: string;
  params: GetLatestExercisePerformanceByLineageInput & {
    exerciseLineageId: string;
    currentSessionId: string | null;
    beforeTimestamp: string | null;
  };
}

export interface LatestExercisePerformanceLoadState {
  performance: LatestExercisePerformance | null;
  loading: boolean;
  error: string;
}

export interface LatestExercisePerformanceLoadResult extends LatestExercisePerformanceLoadState {
  didQuery: boolean;
  stale: boolean;
  requestKey: string | null;
}

export type LatestExercisePerformanceFetcher = (
  input: LatestExercisePerformanceLoadRequest["params"],
) => Promise<LatestExercisePerformance | null>;

export function createStableWorkoutStartedAt(now: Date = new Date()): string {
  return now.toISOString();
}

export function isStableWorkoutStartedAt(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function resolveStableWorkoutStartedAt(
  value: unknown,
  createTimestamp: () => string = createStableWorkoutStartedAt,
): { value: string; wasGenerated: boolean } {
  if (isStableWorkoutStartedAt(value)) {
    return { value, wasGenerated: false };
  }
  return { value: createTimestamp(), wasGenerated: true };
}

export function createLatestExercisePerformanceRequest(
  context: LatestExercisePerformanceLoadContext,
): LatestExercisePerformanceLoadRequest | null {
  const exerciseLineageId = normalizeExerciseLineageId(context.exerciseLineageId);
  if (!exerciseLineageId) return null;

  const beforeTimestamp = normalizeHistoricalTimestamp(context.beforeTimestamp);
  const currentSessionId = normalizeOptionalId(context.currentSessionId);
  const key = [exerciseLineageId, currentSessionId ?? "", beforeTimestamp ?? ""].join("|");

  return {
    key,
    params: {
      exerciseLineageId,
      currentSessionId,
      beforeTimestamp,
    },
  };
}

export function getLatestExercisePerformanceIdleState(): LatestExercisePerformanceLoadState {
  return {
    performance: null,
    loading: false,
    error: "",
  };
}

export function getLatestExercisePerformanceLoadingState(): LatestExercisePerformanceLoadState {
  return {
    performance: null,
    loading: true,
    error: "",
  };
}

export async function loadLatestExercisePerformanceForRequest(input: {
  request: LatestExercisePerformanceLoadRequest | null;
  fetcher: LatestExercisePerformanceFetcher;
  getCurrentRequestKey?: () => string | null;
}): Promise<LatestExercisePerformanceLoadResult> {
  const { request, fetcher, getCurrentRequestKey } = input;
  if (!request) {
    return {
      ...getLatestExercisePerformanceIdleState(),
      didQuery: false,
      stale: false,
      requestKey: null,
    };
  }

  try {
    const performance = await fetcher(request.params);
    if (isStaleRequest(request.key, getCurrentRequestKey)) {
      return createStaleResult(request.key);
    }

    return {
      performance,
      loading: false,
      error: "",
      didQuery: true,
      stale: false,
      requestKey: request.key,
    };
  } catch {
    if (isStaleRequest(request.key, getCurrentRequestKey)) {
      return createStaleResult(request.key);
    }

    return {
      performance: null,
      loading: false,
      error: "No pudimos cargar el historial anterior del ejercicio.",
      didQuery: true,
      stale: false,
      requestKey: request.key,
    };
  }
}

function isStaleRequest(
  requestKey: string,
  getCurrentRequestKey: (() => string | null) | undefined,
) {
  return Boolean(getCurrentRequestKey && getCurrentRequestKey() !== requestKey);
}

function createStaleResult(requestKey: string): LatestExercisePerformanceLoadResult {
  return {
    performance: null,
    loading: false,
    error: "",
    didQuery: true,
    stale: true,
    requestKey,
  };
}

function normalizeOptionalId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
