import { useCallback, useEffect, useRef, useState } from "react";

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
}

export interface UseActiveWorkoutExerciseHistoryResult {
  latestExercisePerformance: LatestExercisePerformance | null;
  latestExercisePerformanceLoading: boolean;
  latestExercisePerformanceError: string;
  latestExerciseObservation: LatestExerciseObservation | null;
  latestExerciseObservationLoading: boolean;
  latestExerciseObservationError: string;
  latestExerciseObservationDidQuery: boolean;
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
  } = input;

  const [latestExercisePerformance, setLatestExercisePerformance] = useState<LatestExercisePerformance | null>(null);
  const [latestExercisePerformanceLoading, setLatestExercisePerformanceLoading] = useState(false);
  const [latestExercisePerformanceError, setLatestExercisePerformanceError] = useState("");
  const latestExercisePerformanceRequestKeyRef = useRef<string | null>(null);
  const [latestExerciseObservation, setLatestExerciseObservation] = useState<LatestExerciseObservation | null>(null);
  const [latestExerciseObservationLoading, setLatestExerciseObservationLoading] = useState(false);
  const [latestExerciseObservationError, setLatestExerciseObservationError] = useState("");
  const [latestExerciseObservationDidQuery, setLatestExerciseObservationDidQuery] = useState(false);
  const latestExerciseObservationRequestKeyRef = useRef<string | null>(null);

  const resetExercisePerformanceHistory = useCallback(() => {
    const idle = getLatestExercisePerformanceIdleState();
    setLatestExercisePerformance(idle.performance);
    setLatestExercisePerformanceLoading(idle.loading);
    setLatestExercisePerformanceError(idle.error);
  }, []);

  const resetExerciseHistory = useCallback(() => {
    latestExercisePerformanceRequestKeyRef.current = null;
    latestExerciseObservationRequestKeyRef.current = null;

    const performanceIdle = getLatestExercisePerformanceIdleState();
    setLatestExercisePerformance(performanceIdle.performance);
    setLatestExercisePerformanceLoading(performanceIdle.loading);
    setLatestExercisePerformanceError(performanceIdle.error);

    const observationIdle = getLatestExerciseObservationIdleState();
    setLatestExerciseObservation(observationIdle.observation);
    setLatestExerciseObservationLoading(observationIdle.loading);
    setLatestExerciseObservationError(observationIdle.error);
    setLatestExerciseObservationDidQuery(false);
  }, []);

  useEffect(() => {
    const requestToken = captureSessionDataRequestToken();

    if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {
      latestExercisePerformanceRequestKeyRef.current = null;
      const idle = getLatestExercisePerformanceIdleState();
      setLatestExercisePerformance(idle.performance);
      setLatestExercisePerformanceLoading(idle.loading);
      setLatestExercisePerformanceError(idle.error);
      return;
    }

    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: activeWorkoutExerciseLineageId,
      currentSessionId: null,
      beforeTimestamp: activeWorkoutStartedAt,
    });

    latestExercisePerformanceRequestKeyRef.current = request?.key ?? null;

    if (!request) {
      const idle = getLatestExercisePerformanceIdleState();
      setLatestExercisePerformance(idle.performance);
      setLatestExercisePerformanceLoading(idle.loading);
      setLatestExercisePerformanceError(idle.error);
      return;
    }

    const loading = getLatestExercisePerformanceLoadingState();
    setLatestExercisePerformance(loading.performance);
    setLatestExercisePerformanceLoading(loading.loading);
    setLatestExercisePerformanceError(loading.error);

    let isMounted = true;
    void runActiveWorkoutHistoryLoad({
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
    });

    return () => {
      isMounted = false;
    };
  }, [activeWorkoutExerciseId, activeWorkoutExerciseLineageId, activeWorkoutStartedAt, captureSessionDataRequestToken, isSessionDataRequestCurrent]);

  useEffect(() => {
    const requestToken = captureSessionDataRequestToken();

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
  }, [activeWorkoutExerciseId, activeWorkoutExerciseLineageId, activeWorkoutStartedAt, captureSessionDataRequestToken, isSessionDataRequestCurrent, observationUserId]);

  return {
    latestExercisePerformance,
    latestExercisePerformanceLoading,
    latestExercisePerformanceError,
    latestExerciseObservation,
    latestExerciseObservationLoading,
    latestExerciseObservationError,
    latestExerciseObservationDidQuery,
    resetExerciseHistory,
    resetExercisePerformanceHistory,
  };
}
