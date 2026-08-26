import { useCallback, useEffect, useRef, useState } from "react";

import {
  createActiveWorkoutHistoryViewKey,
  createActiveWorkoutHistoryPrefetchController,
  isActiveWorkoutHistoryPublicationCurrent,
  type ActiveWorkoutHistoryPrefetchController,
  type ActiveWorkoutHistoryPublicationOwner,
  type ActiveWorkoutHistoryPublicationStatus,
  type ActiveWorkoutHistoryScope,
} from "@/features/active-workout/model/active-workout-history-prefetch-controller";
import { runActiveWorkoutHistoryLoad } from "@/lib/training/active-workout-history-load";
import {
  createLatestExerciseObservationRequest,
  getLatestExerciseObservationIdleState,
  getLatestExerciseObservationLoadingState,
  loadLatestExerciseObservationForRequest,
} from "@/lib/training/exercise-last-observation-loader";
import {
  getLatestExerciseObservationByLineage,
  type LatestExerciseObservation,
} from "@/lib/training/exercise-last-observation-repository";
import {
  createLatestExercisePerformanceRequest,
  getLatestExercisePerformanceIdleState,
  getLatestExercisePerformanceLoadingState,
  loadLatestExercisePerformanceForRequest,
} from "@/lib/training/exercise-last-performance-loader";
import {
  getLatestExercisePerformanceByLineage,
  type LatestExercisePerformance,
} from "@/lib/training/exercise-last-performance-repository";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";

/**
 * Coordinador (P3-32) del ciclo de carga del historial del ejercicio activo: última performance y
 * última observación. Antes de esta extracción el root mantenía DOS grupos paralelos e idénticos de
 * estado data/loading/error, request-key refs, effects, construcción de request, estados
 * idle/loading, ejecución asíncrona y guards stale.
 *
 * Este hook es el ÚNICO propietario de esos estados y de las dos request-key refs: no queda ninguna
 * ref de historial fuera del coordinador. No cambia repositories, queries, loaders, presentación ni
 * semántica — reutiliza los mismos loaders y fetchers ya existentes.
 *
 * INDEPENDENCIA: performance y observación se ejecutan en effects separados, con su propia request,
 * su propia ref y su propio estado. No se combinan con `Promise.all` ni comparten canal de error, de
 * modo que un fallo de una jamás cancela ni contamina la otra.
 *
 * SIN CONTAMINACIÓN DEL DRAFT: el hook sólo devuelve el histórico. Nunca escribe en `exerciseDrafts`
 * ni se usa como fallback del input de observación; esa separación vive en el consumidor.
 */

export interface UseActiveWorkoutExerciseHistoryInput {
  /**
   * Se mantiene como dependencia aunque no se lea en el cuerpo: un cambio de ejercicio debe
   * reiniciar ambos flujos incluso si el lineage resultara idéntico (comportamiento previo a P3-32).
   */
  activeWorkoutExerciseId: string | null;
  activeWorkoutExerciseLineageId: string | null;
  activeWorkoutStartedAt: string | null;
  observationUserId: string | null;
  captureSessionDataRequestToken: () => SessionDataRequestToken;
  isSessionDataRequestCurrent: (token: SessionDataRequestToken) => boolean;
  /**
   * API PERF-03 pendiente de wiring en el composition root. Ambos campos son opcionales como
   * transición: si falta cualquiera, performance conserva el flujo current-only previo.
   */
  historyScope?: ActiveWorkoutHistoryScope;
  performancePrefetchLineageIds?: readonly string[];
}

export interface UseActiveWorkoutExerciseHistoryResult {
  latestExercisePerformance: LatestExercisePerformance | null;
  latestExercisePerformanceLoading: boolean;
  latestExercisePerformanceError: string;
  latestExercisePerformanceStatus: ActiveWorkoutHistoryPublicationStatus;
  latestExerciseObservation: LatestExerciseObservation | null;
  latestExerciseObservationLoading: boolean;
  latestExerciseObservationError: string;
  latestExerciseObservationDidQuery: boolean;
  /**
   * Reintenta exclusivamente la performance del ejercicio seleccionado. La identidad de esta
   * callback es estable; el intento usa el mismo request, token y protección stale del flujo
   * productivo vigente, sin recargar observaciones ni cambiar temporalmente de ejercicio.
   */
  retryExerciseHistory: () => void;
  /** Deja ambos flujos en idle y limpia ambas request keys (reset de sesión de Active Workout). */
  resetExerciseHistory: () => void;
  /**
   * Deja SÓLO el flujo de performance en idle, sin tocar la observación: reproduce exactamente lo
   * que el root hacía al cambiar el storage scope, que es una condición independiente del reset de
   * memoria de Active Workout.
   */
  resetExercisePerformanceHistory: () => void;
}

export function useActiveWorkoutExerciseHistory(
  input: UseActiveWorkoutExerciseHistoryInput,
): UseActiveWorkoutExerciseHistoryResult {
  const {
    activeWorkoutExerciseId,
    activeWorkoutExerciseLineageId,
    activeWorkoutStartedAt,
    observationUserId,
    captureSessionDataRequestToken,
    isSessionDataRequestCurrent,
    historyScope,
    performancePrefetchLineageIds,
  } = input;
  const performanceViewKey = createActiveWorkoutHistoryViewKey({
    channel: "performance",
    activeExerciseId: activeWorkoutExerciseId,
    activeExerciseLineageId: activeWorkoutExerciseLineageId,
    workoutStartedAt: activeWorkoutStartedAt,
    historySource: historyScope?.source ?? null,
    cycleId: historyScope?.cycleId ?? null,
    observationUserId: null,
  });
  const observationViewKey = createActiveWorkoutHistoryViewKey({
    channel: "observation",
    activeExerciseId: activeWorkoutExerciseId,
    activeExerciseLineageId: activeWorkoutExerciseLineageId,
    workoutStartedAt: activeWorkoutStartedAt,
    historySource: null,
    cycleId: null,
    observationUserId,
  });

  const [latestExercisePerformance, setLatestExercisePerformance] = useState<LatestExercisePerformance | null>(null);
  const [latestExercisePerformanceLoading, setLatestExercisePerformanceLoading] = useState(false);
  const [latestExercisePerformanceError, setLatestExercisePerformanceError] = useState("");
  const [latestExercisePerformanceStatus, setLatestExercisePerformanceStatus] =
    useState<ActiveWorkoutHistoryPublicationStatus>("idle");
  const [latestExercisePerformancePublicationOwner, setLatestExercisePerformancePublicationOwner] =
    useState<ActiveWorkoutHistoryPublicationOwner | null>(null);
  const latestExercisePerformanceRequestKeyRef = useRef<string | null>(null);
  const [latestExerciseObservation, setLatestExerciseObservation] = useState<LatestExerciseObservation | null>(null);
  const [latestExerciseObservationLoading, setLatestExerciseObservationLoading] = useState(false);
  const [latestExerciseObservationError, setLatestExerciseObservationError] = useState("");
  const [latestExerciseObservationDidQuery, setLatestExerciseObservationDidQuery] = useState(false);
  const [latestExerciseObservationPublicationOwner, setLatestExerciseObservationPublicationOwner] =
    useState<ActiveWorkoutHistoryPublicationOwner | null>(null);
  const latestExerciseObservationRequestKeyRef = useRef<string | null>(null);
  const isSessionDataRequestCurrentRef = useRef(isSessionDataRequestCurrent);
  isSessionDataRequestCurrentRef.current = isSessionDataRequestCurrent;
  const performancePrefetchControllerRef = useRef<ActiveWorkoutHistoryPrefetchController | null>(null);
  const performancePrefetchEnabledRef = useRef(false);
  const retryExercisePerformanceRef = useRef<(() => void) | null>(null);

  const retryExerciseHistory = useCallback(() => {
    retryExercisePerformanceRef.current?.();
  }, []);

  const getPerformancePrefetchController = useCallback(() => {
    if (!performancePrefetchControllerRef.current) {
      performancePrefetchControllerRef.current = createActiveWorkoutHistoryPrefetchController({
        fetchPerformance: getLatestExercisePerformanceByLineage,
        isRequestTokenCurrent: (token) => isSessionDataRequestCurrentRef.current(token),
        publishCurrent: (publication) => {
          latestExercisePerformanceRequestKeyRef.current = publication.requestKey;
          setLatestExercisePerformance(publication.performance);
          setLatestExercisePerformanceLoading(publication.loading);
          setLatestExercisePerformanceError(publication.error);
          setLatestExercisePerformanceStatus(publication.status);
        },
      });
    }
    return performancePrefetchControllerRef.current;
  }, []);

  useEffect(() => {
    const controller = getPerformancePrefetchController();
    return () => {
      controller.dispose();
      if (performancePrefetchControllerRef.current === controller) {
        performancePrefetchControllerRef.current = null;
      }
    };
  }, [getPerformancePrefetchController]);

  const resetExercisePerformanceHistory = useCallback(() => {
    retryExercisePerformanceRef.current = null;
    setLatestExercisePerformancePublicationOwner(null);
    performancePrefetchControllerRef.current?.invalidate();
    const idle = getLatestExercisePerformanceIdleState();
    setLatestExercisePerformance(idle.performance);
    setLatestExercisePerformanceLoading(idle.loading);
    setLatestExercisePerformanceError(idle.error);
    setLatestExercisePerformanceStatus("idle");
  }, []);

  const resetExerciseHistory = useCallback(() => {
    retryExercisePerformanceRef.current = null;
    setLatestExercisePerformancePublicationOwner(null);
    setLatestExerciseObservationPublicationOwner(null);
    performancePrefetchControllerRef.current?.invalidate();
    latestExercisePerformanceRequestKeyRef.current = null;
    latestExerciseObservationRequestKeyRef.current = null;

    const performanceIdle = getLatestExercisePerformanceIdleState();
    setLatestExercisePerformance(performanceIdle.performance);
    setLatestExercisePerformanceLoading(performanceIdle.loading);
    setLatestExercisePerformanceError(performanceIdle.error);
    setLatestExercisePerformanceStatus("idle");

    const observationIdle = getLatestExerciseObservationIdleState();
    setLatestExerciseObservation(observationIdle.observation);
    setLatestExerciseObservationLoading(observationIdle.loading);
    setLatestExerciseObservationError(observationIdle.error);
    setLatestExerciseObservationDidQuery(false);
  }, []);

  useEffect(() => {
    const requestToken = captureSessionDataRequestToken();
    setLatestExercisePerformancePublicationOwner({
      viewKey: performanceViewKey,
      requestToken,
    });

    if (historyScope && performancePrefetchLineageIds) {
      performancePrefetchEnabledRef.current = true;
      const controller = getPerformancePrefetchController();
      controller.synchronize({
        requestToken,
        historyScope,
        activeExerciseLineageId: activeWorkoutExerciseLineageId,
        workoutStartedAt: activeWorkoutStartedAt,
        performancePrefetchLineageIds,
      });
      const retryCurrentPerformance = () => {
        void controller.revalidateCurrent();
      };
      retryExercisePerformanceRef.current = retryCurrentPerformance;
      return () => {
        if (retryExercisePerformanceRef.current === retryCurrentPerformance) {
          retryExercisePerformanceRef.current = null;
        }
      };
    }

    // Fallback compatible mientras el root no entregue la API PERF-03. Hoy no existe una sesión
    // remota in-progress que excluir: `workoutStartedAt` es el cutoff estable y por eso se conserva
    // `currentSessionId: null`, sin inventar una identidad de sesión.
    if (performancePrefetchEnabledRef.current) {
      performancePrefetchControllerRef.current?.invalidate();
      performancePrefetchEnabledRef.current = false;
    }

    if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {
      latestExercisePerformanceRequestKeyRef.current = null;
      retryExercisePerformanceRef.current = null;
      const idle = getLatestExercisePerformanceIdleState();
      setLatestExercisePerformance(idle.performance);
      setLatestExercisePerformanceLoading(idle.loading);
      setLatestExercisePerformanceError(idle.error);
      setLatestExercisePerformanceStatus("idle");
      return;
    }

    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: activeWorkoutExerciseLineageId,
      currentSessionId: null,
      beforeTimestamp: activeWorkoutStartedAt,
    });

    latestExercisePerformanceRequestKeyRef.current = request?.key ?? null;

    if (!request) {
      retryExercisePerformanceRef.current = null;
      const idle = getLatestExercisePerformanceIdleState();
      setLatestExercisePerformance(idle.performance);
      setLatestExercisePerformanceLoading(idle.loading);
      setLatestExercisePerformanceError(idle.error);
      setLatestExercisePerformanceStatus("idle");
      return;
    }

    let isMounted = true;
    let pendingLoad: Promise<void> | null = null;
    const loadCurrentPerformance = (): Promise<void> => {
      if (pendingLoad) return pendingLoad;

      const loading = getLatestExercisePerformanceLoadingState();
      setLatestExercisePerformance(loading.performance);
      setLatestExercisePerformanceLoading(loading.loading);
      setLatestExercisePerformanceError(loading.error);
      setLatestExercisePerformanceStatus("loading");

      const load = runActiveWorkoutHistoryLoad({
        load: () => loadLatestExercisePerformanceForRequest({
          request,
          fetcher: getLatestExercisePerformanceByLineage,
          getCurrentRequestKey: () => latestExercisePerformanceRequestKeyRef.current,
        }),
        isMounted: () => isMounted,
        isRequestTokenCurrent: () => isSessionDataRequestCurrent(requestToken),
      }).then(({ result, decision }) => {
        if (!decision.commit) return;
        setLatestExercisePerformance(result.performance);
        setLatestExercisePerformanceLoading(result.loading);
        setLatestExercisePerformanceError(result.error);
        setLatestExercisePerformanceStatus(
          result.error ? "error" : result.performance ? "ready" : "empty",
        );
      }).finally(() => {
        if (pendingLoad === load) pendingLoad = null;
      });
      pendingLoad = load;
      return load;
    };
    const retryCurrentPerformance = () => {
      void loadCurrentPerformance();
    };
    retryExercisePerformanceRef.current = retryCurrentPerformance;
    void loadCurrentPerformance();

    return () => {
      isMounted = false;
      if (retryExercisePerformanceRef.current === retryCurrentPerformance) {
        retryExercisePerformanceRef.current = null;
      }
    };
  }, [activeWorkoutExerciseId, activeWorkoutExerciseLineageId, activeWorkoutStartedAt, captureSessionDataRequestToken, getPerformancePrefetchController, historyScope, isSessionDataRequestCurrent, performancePrefetchLineageIds, performanceViewKey]);

  useEffect(() => {
    const requestToken = captureSessionDataRequestToken();
    setLatestExerciseObservationPublicationOwner({
      viewKey: observationViewKey,
      requestToken,
    });

    if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {
      latestExerciseObservationRequestKeyRef.current = null;
      const idle = getLatestExerciseObservationIdleState();
      setLatestExerciseObservation(idle.observation);
      setLatestExerciseObservationLoading(idle.loading);
      setLatestExerciseObservationError(idle.error);
      setLatestExerciseObservationDidQuery(false);
      return;
    }

    const request = createLatestExerciseObservationRequest({
      userId: observationUserId,
      exerciseLineageId: activeWorkoutExerciseLineageId,
      currentSessionId: null,
      beforeTimestamp: activeWorkoutStartedAt,
    });

    latestExerciseObservationRequestKeyRef.current = request?.key ?? null;

    if (!request) {
      const idle = getLatestExerciseObservationIdleState();
      setLatestExerciseObservation(idle.observation);
      setLatestExerciseObservationLoading(idle.loading);
      setLatestExerciseObservationError(idle.error);
      setLatestExerciseObservationDidQuery(false);
      return;
    }

    const loading = getLatestExerciseObservationLoadingState();
    setLatestExerciseObservation(loading.observation);
    setLatestExerciseObservationLoading(loading.loading);
    setLatestExerciseObservationError(loading.error);
    setLatestExerciseObservationDidQuery(false);

    let isMounted = true;
    void runActiveWorkoutHistoryLoad({
      load: () => loadLatestExerciseObservationForRequest({
        request,
        fetcher: getLatestExerciseObservationByLineage,
        getCurrentRequestKey: () => latestExerciseObservationRequestKeyRef.current,
      }),
      isMounted: () => isMounted,
      isRequestTokenCurrent: () => isSessionDataRequestCurrent(requestToken),
    }).then(({ result, decision }) => {
      if (!decision.commit) return;
      setLatestExerciseObservation(result.observation);
      setLatestExerciseObservationLoading(result.loading);
      setLatestExerciseObservationError(result.error);
      setLatestExerciseObservationDidQuery(result.didQuery);
    });

    return () => {
      isMounted = false;
    };
  }, [activeWorkoutExerciseId, activeWorkoutExerciseLineageId, activeWorkoutStartedAt, captureSessionDataRequestToken, isSessionDataRequestCurrent, observationUserId, observationViewKey]);

  const isPerformancePublicationCurrent = isActiveWorkoutHistoryPublicationCurrent(
    latestExercisePerformancePublicationOwner,
    performanceViewKey,
    isSessionDataRequestCurrentRef.current,
  );
  const isObservationPublicationCurrent = isActiveWorkoutHistoryPublicationCurrent(
    latestExerciseObservationPublicationOwner,
    observationViewKey,
    isSessionDataRequestCurrentRef.current,
  );

  return {
    latestExercisePerformance: isPerformancePublicationCurrent ? latestExercisePerformance : null,
    latestExercisePerformanceLoading: isPerformancePublicationCurrent
      ? latestExercisePerformanceLoading
      : false,
    latestExercisePerformanceError: isPerformancePublicationCurrent
      ? latestExercisePerformanceError
      : "",
    latestExercisePerformanceStatus: isPerformancePublicationCurrent
      ? latestExercisePerformanceStatus
      : "idle",
    latestExerciseObservation: isObservationPublicationCurrent ? latestExerciseObservation : null,
    latestExerciseObservationLoading: isObservationPublicationCurrent
      ? latestExerciseObservationLoading
      : false,
    latestExerciseObservationError: isObservationPublicationCurrent
      ? latestExerciseObservationError
      : "",
    latestExerciseObservationDidQuery: isObservationPublicationCurrent
      ? latestExerciseObservationDidQuery
      : false,
    retryExerciseHistory,
    resetExerciseHistory,
    resetExercisePerformanceHistory,
  };
}
