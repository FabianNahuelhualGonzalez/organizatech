import {
  getLatestExerciseObservationByLineage,
  normalizeExerciseLineageId,
  normalizeHistoricalTimestamp,
  type GetLatestExerciseObservationByLineageInput,
  type LatestExerciseObservation,
} from "@/lib/training/exercise-last-observation-repository";

export interface LatestExerciseObservationLoadContext {
  userId?: string | null;
  exerciseLineageId?: string | null;
  currentSessionId?: string | null;
  beforeTimestamp?: string | Date | null;
}

export interface LatestExerciseObservationLoadRequest {
  key: string;
  params: GetLatestExerciseObservationByLineageInput & {
    exerciseLineageId: string;
    currentSessionId: string | null;
    beforeTimestamp: string | null;
  };
}

export interface LatestExerciseObservationLoadState {
  observation: LatestExerciseObservation | null;
  loading: boolean;
  error: string;
}

export interface LatestExerciseObservationLoadResult extends LatestExerciseObservationLoadState {
  didQuery: boolean;
  stale: boolean;
  requestKey: string | null;
}

export type LatestExerciseObservationFetcher = (
  input: LatestExerciseObservationLoadRequest["params"],
) => Promise<LatestExerciseObservation | null>;

export function createLatestExerciseObservationRequest(
  context: LatestExerciseObservationLoadContext,
): LatestExerciseObservationLoadRequest | null {
  const userId = normalizeOptionalId(context.userId);
  if (!userId) return null;

  const exerciseLineageId = normalizeExerciseLineageId(context.exerciseLineageId);
  if (!exerciseLineageId) return null;

  const beforeTimestamp = normalizeHistoricalTimestamp(context.beforeTimestamp);
  const currentSessionId = normalizeOptionalId(context.currentSessionId);
  const key = [userId, exerciseLineageId, currentSessionId ?? "", beforeTimestamp ?? ""].join("|");

  return {
    key,
    params: {
      exerciseLineageId,
      currentSessionId,
      beforeTimestamp,
    },
  };
}

export function getLatestExerciseObservationIdleState(): LatestExerciseObservationLoadState {
  return {
    observation: null,
    loading: false,
    error: "",
  };
}

export function getLatestExerciseObservationLoadingState(): LatestExerciseObservationLoadState {
  return {
    observation: null,
    loading: true,
    error: "",
  };
}

export async function loadLatestExerciseObservationForRequest(input: {
  request: LatestExerciseObservationLoadRequest | null;
  fetcher: LatestExerciseObservationFetcher;
  getCurrentRequestKey?: () => string | null;
}): Promise<LatestExerciseObservationLoadResult> {
  const { request, fetcher, getCurrentRequestKey } = input;
  if (!request) {
    return {
      ...getLatestExerciseObservationIdleState(),
      didQuery: false,
      stale: false,
      requestKey: null,
    };
  }

  try {
    const observation = await fetcher(request.params);
    if (isStaleRequest(request.key, getCurrentRequestKey)) {
      return createStaleResult(request.key);
    }

    return {
      observation,
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
      observation: null,
      loading: false,
      error: "No pudimos cargar la observación anterior del ejercicio.",
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

function createStaleResult(requestKey: string): LatestExerciseObservationLoadResult {
  return {
    observation: null,
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

export { getLatestExerciseObservationByLineage };
