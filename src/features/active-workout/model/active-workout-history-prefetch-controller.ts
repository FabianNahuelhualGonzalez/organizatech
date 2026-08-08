import {
  createLatestExercisePerformanceRequest,
  loadLatestExercisePerformanceForRequest,
  type LatestExercisePerformanceFetcher,
  type LatestExercisePerformanceLoadRequest,
} from "@/lib/training/exercise-last-performance-loader";
import {
  normalizeExerciseLineageId,
  normalizeHistoricalTimestamp,
  type LatestExercisePerformance,
} from "@/lib/training/exercise-last-performance-repository";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";

const MAX_CONCURRENT_PERFORMANCE_LOADS = 2;
const MAX_FOLLOWING_EXERCISES_TO_PREFETCH = 2;

export interface ActiveWorkoutHistoryScope {
  source: "legacy" | "cycle-scoped";
  cycleId: string | null;
}

export interface ActiveWorkoutHistoryPrefetchInput {
  requestToken: SessionDataRequestToken;
  historyScope: ActiveWorkoutHistoryScope;
  activeExerciseLineageId: string | null;
  workoutStartedAt: string | null;
  /**
   * Lista ordenada del día completo. El controller localiza el ejercicio activo y limita por sí
   * mismo la ventana; el caller no debe recortar la lista para imponer concurrencia.
   */
  performancePrefetchLineageIds: readonly string[];
}

export type ActiveWorkoutHistoryPublicationStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export interface ActiveWorkoutHistoryPublication {
  requestKey: string | null;
  exerciseLineageId: string | null;
  performance: LatestExercisePerformance | null;
  loading: boolean;
  error: string;
  status: ActiveWorkoutHistoryPublicationStatus;
}

export interface ActiveWorkoutHistoryPrefetchControllerDependencies {
  fetchPerformance: LatestExercisePerformanceFetcher;
  isRequestTokenCurrent: (token: SessionDataRequestToken) => boolean;
  publishCurrent: (publication: ActiveWorkoutHistoryPublication) => void;
}

export interface ActiveWorkoutHistorySchedule {
  current: Promise<void> | null;
  prefetch: readonly Promise<void>[];
}

export interface ActiveWorkoutHistoryPrefetchController {
  synchronize: (input: ActiveWorkoutHistoryPrefetchInput) => ActiveWorkoutHistorySchedule;
  revalidateCurrent: () => Promise<void> | null;
  /** Logout, completion/discard y resets explícitos comparten esta invalidación en memoria. */
  invalidate: () => void;
  /** Invalida y vuelve permanente el cierre de esta instancia (cleanup de unmount). */
  dispose: () => void;
}

interface NormalizedContext {
  requestToken: SessionDataRequestToken;
  source: ActiveWorkoutHistoryScope["source"];
  cycleId: string | null;
  workoutStartedAt: string;
  fingerprint: string;
}

interface CacheEntry {
  status: "ready" | "empty";
  performance: LatestExercisePerformance | null;
}

interface PendingRequest {
  key: string;
  request: LatestExercisePerformanceLoadRequest;
  requestToken: SessionDataRequestToken;
  contextFingerprint: string;
  contextVersion: number;
  requestVersion: number;
  priority: number;
  promise: Promise<void>;
  settle: () => void;
  started: boolean;
}

const IDLE_PUBLICATION: ActiveWorkoutHistoryPublication = Object.freeze({
  requestKey: null,
  exerciseLineageId: null,
  performance: null,
  loading: false,
  error: "",
  status: "idle",
});

/**
 * Controller efímero por instancia. No usa storage ni estado global: cache, cola, promises y
 * versiones mueren con `invalidate`/`dispose` y nunca contienen observaciones.
 */
export function createActiveWorkoutHistoryPrefetchController(
  dependencies: ActiveWorkoutHistoryPrefetchControllerDependencies,
): ActiveWorkoutHistoryPrefetchController {
  const cache = new Map<string, CacheEntry>();
  const pendingByKey = new Map<string, PendingRequest>();
  let queue: PendingRequest[] = [];
  let activeLoads = 0;
  let contextVersion = 0;
  let nextRequestVersion = 0;
  let currentContext: NormalizedContext | null = null;
  let currentKey: string | null = null;
  let currentLineageId: string | null = null;
  let currentPublication: ActiveWorkoutHistoryPublication = IDLE_PUBLICATION;
  let disposed = false;

  function publish(publication: ActiveWorkoutHistoryPublication) {
    currentPublication = publication;
    dependencies.publishCurrent(publication);
  }

  function publishIdle() {
    publish(IDLE_PUBLICATION);
  }

  function clearPendingQueue() {
    const queued = queue;
    queue = [];
    for (const task of queued) task.settle();
  }

  function invalidateInternal(permanent: boolean) {
    contextVersion += 1;
    currentContext = null;
    currentKey = null;
    currentLineageId = null;
    cache.clear();
    clearPendingQueue();
    pendingByKey.clear();
    if (permanent) disposed = true;
    publishIdle();
  }

  function isTaskCurrentAfterAwait(task: PendingRequest): boolean {
    const pending = pendingByKey.get(task.key);
    return !disposed &&
      contextVersion === task.contextVersion &&
      currentContext?.fingerprint === task.contextFingerprint &&
      sameRequestToken(currentContext.requestToken, task.requestToken) &&
      dependencies.isRequestTokenCurrent(task.requestToken) &&
      pending?.requestVersion === task.requestVersion &&
      pending.promise === task.promise;
  }

  function publishLoadingForCurrent(key: string, lineageId: string) {
    const preserveVisibleSnapshot = currentPublication.requestKey === key;
    publish({
      requestKey: key,
      exerciseLineageId: lineageId,
      performance: preserveVisibleSnapshot ? currentPublication.performance : null,
      loading: true,
      error: "",
      status: "loading",
    });
  }

  function publishCacheEntry(key: string, lineageId: string, entry: CacheEntry) {
    publish({
      requestKey: key,
      exerciseLineageId: lineageId,
      performance: entry.performance,
      loading: false,
      error: "",
      status: entry.status,
    });
  }

  function drainQueue() {
    if (disposed) return;
    queue.sort((left, right) =>
      left.priority - right.priority || left.requestVersion - right.requestVersion
    );

    while (activeLoads < MAX_CONCURRENT_PERFORMANCE_LOADS && queue.length > 0) {
      const task = queue.shift();
      if (!task || pendingByKey.get(task.key)?.promise !== task.promise) {
        task?.settle();
        continue;
      }
      task.started = true;
      activeLoads += 1;
      void runTask(task);
    }
  }

  async function runTask(task: PendingRequest) {
    try {
      const result = await loadLatestExercisePerformanceForRequest({
        request: task.request,
        fetcher: dependencies.fetchPerformance,
      });

      // PERF-03: todo dato que cruza un await revalida instancia, epoch/identidad, contexto, key,
      // versión de request y la promise exacta antes de entrar a cache o publicación.
      if (!isTaskCurrentAfterAwait(task)) return;

      if (!result.error) {
        const entry: CacheEntry = result.performance
          ? { status: "ready", performance: result.performance }
          : { status: "empty", performance: null };
        cache.set(task.key, entry);
        if (currentKey === task.key) {
          publishCacheEntry(task.key, task.request.params.exerciseLineageId, entry);
        }
        return;
      }

      if (currentKey === task.key) {
        const preserveVisibleSnapshot = currentPublication.requestKey === task.key;
        publish({
          requestKey: task.key,
          exerciseLineageId: task.request.params.exerciseLineageId,
          performance: preserveVisibleSnapshot ? currentPublication.performance : null,
          loading: false,
          error: result.error,
          status: "error",
        });
      }
    } finally {
      activeLoads -= 1;
      // Una respuesta vieja jamás puede borrar una promise nueva creada con la misma key.
      if (pendingByKey.get(task.key)?.promise === task.promise) {
        pendingByKey.delete(task.key);
      }
      task.settle();
      drainQueue();
    }
  }

  function enqueue(
    context: NormalizedContext,
    lineageId: string,
    priority: number,
    options: { force?: boolean } = {},
  ): Promise<void> | null {
    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: lineageId,
      currentSessionId: null,
      beforeTimestamp: context.workoutStartedAt,
    });
    if (!request) return null;

    const key = createActiveWorkoutHistoryPrefetchKey(context, lineageId);
    const existing = pendingByKey.get(key);
    if (existing) {
      if (!existing.started && priority < existing.priority) {
        existing.priority = priority;
        drainQueue();
      }
      return existing.promise;
    }
    if (!options.force && cache.has(key)) return null;

    let settle = () => {};
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const task: PendingRequest = {
      key,
      request,
      requestToken: context.requestToken,
      contextFingerprint: context.fingerprint,
      contextVersion,
      requestVersion: ++nextRequestVersion,
      priority,
      promise,
      settle,
      started: false,
    };
    pendingByKey.set(key, task);
    queue.push(task);
    drainQueue();
    return promise;
  }

  function synchronize(input: ActiveWorkoutHistoryPrefetchInput): ActiveWorkoutHistorySchedule {
    if (disposed) return { current: null, prefetch: [] };

    const context = normalizeContext(input);
    const activeLineageId = normalizeExerciseLineageId(input.activeExerciseLineageId);
    if (!context || !activeLineageId) {
      invalidateInternal(false);
      return { current: null, prefetch: [] };
    }

    if (currentContext?.fingerprint !== context.fingerprint) {
      invalidateInternal(false);
      currentContext = context;
    } else {
      currentContext = context;
    }

    currentLineageId = activeLineageId;
    currentKey = createActiveWorkoutHistoryPrefetchKey(context, activeLineageId);
    const cachedCurrent = cache.get(currentKey);
    if (cachedCurrent) {
      publishCacheEntry(currentKey, activeLineageId, cachedCurrent);
    } else {
      publishLoadingForCurrent(currentKey, activeLineageId);
    }

    // El actual entra primero. La cola conserva esa prioridad aunque el caller entregue todo el día.
    const current = enqueue(context, activeLineageId, 0);
    const followingLineages = selectFollowingLineages(
      activeLineageId,
      input.performancePrefetchLineageIds,
    );
    const prefetch = followingLineages.flatMap((lineageId, index) => {
      const scheduled = enqueue(context, lineageId, index + 1);
      return scheduled ? [scheduled] : [];
    });

    return { current, prefetch };
  }

  function revalidateCurrent(): Promise<void> | null {
    if (disposed || !currentContext || !currentKey || !currentLineageId) return null;
    publishLoadingForCurrent(currentKey, currentLineageId);
    return enqueue(currentContext, currentLineageId, 0, { force: true });
  }

  return {
    synchronize,
    revalidateCurrent,
    invalidate: () => invalidateInternal(false),
    dispose: () => {
      if (!disposed) invalidateInternal(true);
    },
  };
}

export function createActiveWorkoutHistoryPrefetchKey(
  context: Pick<NormalizedContext, "requestToken" | "source" | "cycleId" | "workoutStartedAt">,
  lineageId: string,
): string {
  return JSON.stringify([
    context.requestToken.generation,
    context.requestToken.userId,
    context.requestToken.scope,
    context.source,
    context.cycleId,
    context.workoutStartedAt,
    lineageId,
  ]);
}

function normalizeContext(input: ActiveWorkoutHistoryPrefetchInput): NormalizedContext | null {
  const workoutStartedAt = normalizeHistoricalTimestamp(input.workoutStartedAt);
  const userId = normalizeIdentityPart(input.requestToken.userId);
  if (!workoutStartedAt || !userId) return null;

  const requestToken = Object.freeze({
    generation: input.requestToken.generation,
    userId,
    scope: normalizeIdentityPart(input.requestToken.scope),
  });
  const cycleId = normalizeIdentityPart(input.historyScope.cycleId);
  const fingerprint = JSON.stringify([
    requestToken.generation,
    requestToken.userId,
    requestToken.scope,
    input.historyScope.source,
    cycleId,
    workoutStartedAt,
  ]);
  return {
    requestToken,
    source: input.historyScope.source,
    cycleId,
    workoutStartedAt,
    fingerprint,
  };
}

function selectFollowingLineages(
  activeLineageId: string,
  lineageIds: readonly string[],
): readonly string[] {
  const normalized = [...new Set(lineageIds
    .map((lineageId) => normalizeExerciseLineageId(lineageId))
    .filter((lineageId): lineageId is string => Boolean(lineageId)))];
  const activeIndex = normalized.indexOf(activeLineageId);
  const following = activeIndex >= 0
    ? normalized.slice(activeIndex + 1)
    : normalized.filter((lineageId) => lineageId !== activeLineageId);
  return following.slice(0, MAX_FOLLOWING_EXERCISES_TO_PREFETCH);
}

function normalizeIdentityPart(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sameRequestToken(left: SessionDataRequestToken, right: SessionDataRequestToken): boolean {
  return left.generation === right.generation &&
    left.userId === right.userId &&
    left.scope === right.scope;
}
