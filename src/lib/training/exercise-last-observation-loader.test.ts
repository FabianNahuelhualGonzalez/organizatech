import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createLatestExerciseObservationRequest,
  getLatestExerciseObservationIdleState,
  getLatestExerciseObservationLoadingState,
  loadLatestExerciseObservationForRequest,
  type LatestExerciseObservationFetcher,
} from "@/lib/training/exercise-last-observation-loader";
import type { LatestExerciseObservation } from "@/lib/training/exercise-last-observation-repository";

const loaderSource = readFileSync("src/lib/training/exercise-last-observation-loader.ts", "utf8");

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const LINEAGE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LINEAGE_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const BEFORE_TIMESTAMP = "2026-06-18T12:00:00.000Z";

function createObservation(overrides: Partial<LatestExerciseObservation> = {}): LatestExerciseObservation {
  return {
    observation: "Molestia leve en el hombro",
    sessionId: "44444444-4444-4444-8444-444444444444",
    trainedDate: "2026-06-11",
    completedAt: "2026-06-11T13:00:00.000Z",
    ...overrides,
  };
}

async function run() {
  // 1. Primera carga valida.
  {
    const request = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => createObservation(),
    });

    assert.equal(result.didQuery, true);
    assert.equal(result.stale, false);
    assert.equal(result.observation?.observation, "Molestia leve en el hombro");
    assert.equal(result.error, "");
  }

  // 2. Sin userId no consulta.
  {
    let calls = 0;
    const request = createLatestExerciseObservationRequest({
      userId: null,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.equal(request, null);

    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => {
        calls += 1;
        return createObservation();
      },
    });

    assert.equal(calls, 0);
    assert.equal(result.didQuery, false);
    assert.equal(result.observation, null);
    assert.equal(result.error, "");
  }

  // 3. Sin lineage no consulta.
  {
    let calls = 0;
    const request = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: null,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.equal(request, null);

    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => {
        calls += 1;
        return createObservation();
      },
    });

    assert.equal(calls, 0);
    assert.equal(result.didQuery, false);
  }

  // 4. Respuesta de un ejercicio anterior (A) se ignora tras seleccionar otro (B).
  {
    const requestForExerciseA = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const requestForExerciseB = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: OTHER_LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.ok(requestForExerciseA);
    assert.ok(requestForExerciseB);

    let currentKey = requestForExerciseB.key;
    const result = await loadLatestExerciseObservationForRequest({
      request: requestForExerciseA,
      getCurrentRequestKey: () => currentKey,
      fetcher: async () => createObservation(),
    });

    assert.equal(result.stale, true);
    assert.equal(result.observation, null);
    assert.equal(result.loading, false);
    assert.equal(result.error, "");
    currentKey = requestForExerciseA.key;
  }

  // 5. Respuesta previa ignorada tras una nueva solicitud del mismo ejercicio.
  {
    const firstRequest = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const secondRequest = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: "2026-06-19T12:00:00.000Z",
    });
    assert.ok(firstRequest);
    assert.ok(secondRequest);
    assert.notEqual(firstRequest.key, secondRequest.key);

    let currentKey = secondRequest.key;
    const result = await loadLatestExerciseObservationForRequest({
      request: firstRequest,
      getCurrentRequestKey: () => currentKey,
      fetcher: async () => createObservation(),
    });

    assert.equal(result.stale, true);
    assert.equal(result.observation, null);
    currentKey = secondRequest.key;
  }

  // 6. Cambio de usuario invalida la respuesta previa.
  {
    const requestForFirstUser = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const requestForOtherUser = createLatestExerciseObservationRequest({
      userId: OTHER_USER_ID,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.ok(requestForFirstUser);
    assert.ok(requestForOtherUser);
    assert.notEqual(requestForFirstUser.key, requestForOtherUser.key);

    let currentKey = requestForOtherUser.key;
    const result = await loadLatestExerciseObservationForRequest({
      request: requestForFirstUser,
      getCurrentRequestKey: () => currentKey,
      fetcher: async () => createObservation(),
    });

    assert.equal(result.stale, true);
    assert.equal(result.observation, null);
    currentKey = requestForFirstUser.key;
  }

  // 7. Logout: sin userId, no hay solicitud y el estado vuelve a idle.
  {
    const request = createLatestExerciseObservationRequest({
      userId: "",
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    assert.equal(request, null);

    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => createObservation(),
    });

    assert.deepEqual(
      { observation: result.observation, loading: result.loading, error: result.error },
      getLatestExerciseObservationIdleState(),
    );
  }

  // 8. Error del repository entrega mensaje neutral, sin exponer detalles internos.
  {
    const request = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => {
        throw new Error("relation exercise_entries: permission denied for role authenticated");
      },
    });

    assert.equal(result.didQuery, true);
    assert.equal(result.stale, false);
    assert.equal(result.observation, null);
    assert.equal(result.error, "No pudimos cargar la observación anterior del ejercicio.");
    assert.doesNotMatch(result.error, /permission denied|role authenticated|relation/);
  }

  // 9. Resultado null (sin observacion valida) no es un error.
  {
    const request = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => null,
    });

    assert.equal(result.didQuery, true);
    assert.equal(result.observation, null);
    assert.equal(result.error, "");
  }

  // 10. Resultado valido se propaga tal cual.
  {
    const request = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      beforeTimestamp: BEFORE_TIMESTAMP,
    });
    const result = await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async () => createObservation({ observation: "Buena ejecucion" }),
    });

    assert.equal(result.observation?.observation, "Buena ejecucion");
  }

  // 11 y 12. currentSessionId y beforeTimestamp se propagan correctamente al repository.
  {
    const calls: Array<Parameters<LatestExerciseObservationFetcher>[0]> = [];
    const request = createLatestExerciseObservationRequest({
      userId: USER_ID,
      exerciseLineageId: LINEAGE_ID,
      currentSessionId: SESSION_ID,
      beforeTimestamp: new Date(BEFORE_TIMESTAMP),
    });

    await loadLatestExerciseObservationForRequest({
      request,
      fetcher: async (params) => {
        calls.push(params);
        return createObservation();
      },
    });

    assert.deepEqual(calls, [
      {
        exerciseLineageId: LINEAGE_ID,
        currentSessionId: SESSION_ID,
        beforeTimestamp: BEFORE_TIMESTAMP,
      },
    ]);
  }

  {
    assert.deepEqual(getLatestExerciseObservationIdleState(), {
      observation: null,
      loading: false,
      error: "",
    });
    assert.deepEqual(getLatestExerciseObservationLoadingState(), {
      observation: null,
      loading: true,
      error: "",
    });
  }

  // No duplica logica SQL/filtros propios: no hay fallback por nombre ni por exercise_id en el loader.
  {
    assert.doesNotMatch(loaderSource, /exerciseName|normalizedName|getExerciseHistory/);
    assert.doesNotMatch(loaderSource, /\.eq\("exercise_id"/);
    assert.match(loaderSource, /normalizeExerciseLineageId/);
  }

  console.log("exercise-last-observation-loader tests passed");
}

void run();
