import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPublicRepositoryError } from "@/lib/errors/public-error";
import {
  linkTrainingWorkoutReadinessSession as linkTrainingWorkoutReadinessSessionWithOwner,
  saveTrainingWorkoutReadiness as saveTrainingWorkoutReadinessWithOwner,
  translateTrainingWorkoutReadinessError,
  TrainingWorkoutReadinessRepositoryError,
  type TrainingWorkoutReadinessPayload,
  type TrainingWorkoutReadinessRepositoryErrorCode,
  type TrainingWorkoutReadinessRpcClient,
} from "@/lib/training/training-workout-readiness-repository";

interface RpcCall {
  functionName: string;
  args: Record<string, unknown>;
}

const normalPayload = {
  motivation: 6,
  hydration: 5,
  sleep: 4,
  energy: 7,
  skipped: false,
} satisfies TrainingWorkoutReadinessPayload;

const skippedPayload = { skipped: true } satisfies TrainingWorkoutReadinessPayload;

const validSkippedPayload: TrainingWorkoutReadinessPayload = skippedPayload;
const validFullPayload: TrainingWorkoutReadinessPayload = normalPayload;
// @ts-expect-error skipped false requires all scores.
const invalidMissingScoresPayload: TrainingWorkoutReadinessPayload = { skipped: false };
// @ts-expect-error skipped true must not carry scores.
const invalidSkippedWithScorePayload: TrainingWorkoutReadinessPayload = { skipped: true, motivation: 5 };
void [validSkippedPayload, validFullPayload, invalidMissingScoresPayload, invalidSkippedWithScorePayload];

const saveInput = {
  workoutAttemptId: "attempt-1",
  cycleId: "cycle-1",
  cycleDayId: "day-1",
  workoutStartedAt: "2026-06-25T10:30:00.000Z",
  payload: normalPayload,
};
const expectedUserId = "user-1";

function saveTrainingWorkoutReadiness(
  input: Parameters<typeof saveTrainingWorkoutReadinessWithOwner>[0],
  options: Parameters<typeof saveTrainingWorkoutReadinessWithOwner>[2] = {},
) {
  return saveTrainingWorkoutReadinessWithOwner(input, expectedUserId, options);
}

function linkTrainingWorkoutReadinessSession(
  input: Parameters<typeof linkTrainingWorkoutReadinessSessionWithOwner>[0],
  options: Parameters<typeof linkTrainingWorkoutReadinessSessionWithOwner>[2] = {},
) {
  return linkTrainingWorkoutReadinessSessionWithOwner(input, expectedUserId, options);
}

function createSaveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "readiness-1",
    user_id: "user-1",
    workout_attempt_id: "attempt-1",
    cycle_id: "cycle-1",
    cycle_day_id: "day-1",
    workout_started_at: "2026-06-25T10:30:00.000Z",
    local_date: "2026-06-25",
    payload: normalPayload,
    training_session_id: null,
    created_at: "2026-06-25T10:31:00.000Z",
    updated_at: "2026-06-25T10:32:00.000Z",
    context_mismatch: false,
    ...overrides,
  };
}

function createLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "readiness-1",
    workout_attempt_id: "attempt-1",
    training_session_id: "session-1",
    linked: true,
    already_linked: false,
    ...overrides,
  };
}

function createRpcClient(
  data: unknown,
  error: unknown = null,
  userIds: readonly string[] = [expectedUserId, expectedUserId],
) {
  const calls: RpcCall[] = [];
  let userIndex = 0;
  const client: TrainingWorkoutReadinessRpcClient = {
    auth: {
      async getUser() {
        const userId = userIds[Math.min(userIndex, userIds.length - 1)];
        userIndex += 1;
        return { data: { user: userId ? { id: userId } : null }, error: null };
      },
    },
    async rpc(functionName, args) {
      calls.push({ functionName, args });
      return { data, error };
    },
  };
  return { client, calls };
}

async function rejectCode(action: () => Promise<unknown>, code: TrainingWorkoutReadinessRepositoryErrorCode) {
  await assert.rejects(
    action,
    (error) => error instanceof TrainingWorkoutReadinessRepositoryError && error.code === code,
  );
}

async function run() {
  {
    const { client, calls } = createRpcClient([createSaveRow()]);
    const result = await saveTrainingWorkoutReadiness(saveInput, { supabase: client });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.functionName, "save_training_workout_readiness_v2");
    assert.deepEqual(calls[0]?.args, {
      p_workout_attempt_id: "attempt-1",
      p_cycle_id: "cycle-1",
      p_cycle_day_id: "day-1",
      p_workout_started_at: "2026-06-25T10:30:00.000Z",
      p_payload: normalPayload,
    });
    assert.equal("user_id" in (calls[0]?.args ?? {}), false);
    assert.equal("local_date" in (calls[0]?.args ?? {}), false);
    assert.equal(result.id, "readiness-1");
    assert.equal(result.userId, "user-1");
    assert.equal(result.workoutAttemptId, "attempt-1");
    assert.equal(result.cycleId, "cycle-1");
    assert.equal(result.cycleDayId, "day-1");
    assert.equal(result.workoutStartedAt, "2026-06-25T10:30:00.000Z");
    assert.equal(result.localDate, "2026-06-25");
    assert.equal(result.trainingSessionId, null);
    assert.equal(result.createdAt, "2026-06-25T10:31:00.000Z");
    assert.equal(result.updatedAt, "2026-06-25T10:32:00.000Z");
    assert.deepEqual(result.payload, normalPayload);
    assert.equal(result.contextMismatch, false);
  }

  {
    const { client, calls } = createRpcClient(createSaveRow({ payload: skippedPayload, context_mismatch: true, training_session_id: "session-1" }));
    const result = await saveTrainingWorkoutReadiness({ ...saveInput, payload: skippedPayload }, { supabase: client });
    assert.equal(calls[0]?.args.p_workout_attempt_id, "attempt-1");
    assert.equal(calls[0]?.args.p_workout_started_at, "2026-06-25T10:30:00.000Z");
    assert.strictEqual(calls[0]?.args.p_payload, skippedPayload);
    assert.deepEqual(result.payload, skippedPayload);
    assert.equal(result.trainingSessionId, "session-1");
    assert.equal(result.contextMismatch, true);
  }

  await rejectCode(() => saveTrainingWorkoutReadiness(saveInput, { supabase: null }), "session_required");
  await rejectCode(() => linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: null }), "session_required");

  {
    const sensitiveError = { message: "secret sql details: select * from auth.users" };
    const { client } = createRpcClient(null, sensitiveError);
    await assert.rejects(
      () => saveTrainingWorkoutReadiness(saveInput, { supabase: client }),
      (error) => {
        assert.ok(error instanceof TrainingWorkoutReadinessRepositoryError);
        assert.equal(error.code, "unexpected");
        assert.equal(error.cause, sensitiveError);
        assert.equal(error.message.includes("secret sql details"), false);
        return true;
      },
    );
  }

  await rejectCode(() => saveTrainingWorkoutReadiness(saveInput, { supabase: createRpcClient(null).client }), "empty_response");
  await rejectCode(() => saveTrainingWorkoutReadiness(saveInput, { supabase: createRpcClient([]).client }), "empty_response");
  await rejectCode(() => saveTrainingWorkoutReadiness(saveInput, { supabase: createRpcClient([createSaveRow(), createSaveRow()]).client }), "multiple_rows");

  for (const invalidData of [
    { ...createSaveRow(), id: null },
    { ...createSaveRow(), payload: { skipped: "yes" } },
    { ...createSaveRow(), payload: { skipped: true, motivation: 5 } },
    { ...createSaveRow(), payload: { skipped: true, hydration: 5 } },
    { ...createSaveRow(), payload: { skipped: true, sleep: 5 } },
    { ...createSaveRow(), payload: { skipped: true, energy: 5 } },
    { ...createSaveRow(), payload: { skipped: false, motivation: 5, hydration: 5, sleep: 5 } },
  ]) {
    await rejectCode(() => saveTrainingWorkoutReadiness(saveInput, { supabase: createRpcClient(invalidData).client }), "invalid_response");
  }

  {
    const { client, calls } = createRpcClient([createLinkRow()]);
    const result = await linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: client });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.functionName, "link_training_workout_readiness_session_v2");
    assert.deepEqual(calls[0]?.args, {
      p_workout_attempt_id: "attempt-1",
      p_training_session_id: "session-1",
    });
    assert.equal(result.id, "readiness-1");
    assert.equal(result.workoutAttemptId, "attempt-1");
    assert.equal(result.trainingSessionId, "session-1");
    assert.equal(result.linked, true);
    assert.equal(result.alreadyLinked, false);
  }

  {
    const { client } = createRpcClient(createLinkRow({ already_linked: true }));
    const result = await linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: client });
    assert.equal(result.linked, true);
    assert.equal(result.alreadyLinked, true);
  }

  await rejectCode(() => linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: createRpcClient(null).client }), "empty_response");
  await rejectCode(() => linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: createRpcClient([]).client }), "empty_response");
  await rejectCode(() => linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: createRpcClient([createLinkRow(), createLinkRow()]).client }), "multiple_rows");

  {
    const { client } = createRpcClient(null, { message: "link failed" });
    await rejectCode(() => linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: client }), "unexpected");
  }

  for (const invalidData of [
    { ...createLinkRow(), linked: "true" },
    { ...createLinkRow(), training_session_id: null },
  ]) {
    await rejectCode(() => linkTrainingWorkoutReadinessSession({ workoutAttemptId: "attempt-1", trainingSessionId: "session-1" }, { supabase: createRpcClient(invalidData).client }), "invalid_response");
  }

  const otherUserId = "user-2-private";
  const frozenWorkoutPayload = Object.freeze({ ...normalPayload });
  const frozenWorkoutInput = Object.freeze({
    ...saveInput,
    payload: frozenWorkoutPayload,
  });
  const frozenWorkoutInputSnapshot = structuredClone(frozenWorkoutInput);
  const frozenLinkInput = Object.freeze({
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
  });
  const frozenLinkInputSnapshot = structuredClone(frozenLinkInput);

  {
    const { client, calls } = createRpcClient(
      [createSaveRow()],
      null,
      [expectedUserId, expectedUserId],
    );
    await saveTrainingWorkoutReadinessWithOwner(
      frozenWorkoutInput,
      expectedUserId,
      { supabase: client },
    );
    assert.equal(calls.length, 1, "workout readiness A estable ejecuta exactamente un RPC");
  }

  {
    const { client, calls } = createRpcClient(
      [createSaveRow()],
      null,
      [expectedUserId, otherUserId],
    );
    await assert.rejects(
      saveTrainingWorkoutReadinessWithOwner(
        frozenWorkoutInput,
        expectedUserId,
        { supabase: client },
      ),
      assertSanitizedOwnerMismatch,
    );
    assert.equal(calls.length, 0, "workout readiness A→B antes del RPC ejecuta cero RPC");
  }

  {
    const { client, calls } = createRpcClient(
      [createLinkRow()],
      null,
      [expectedUserId, expectedUserId],
    );
    await linkTrainingWorkoutReadinessSessionWithOwner(
      frozenLinkInput,
      expectedUserId,
      { supabase: client },
    );
    assert.equal(calls.length, 1, "linking A estable ejecuta exactamente un RPC");
  }

  {
    const { client, calls } = createRpcClient(
      [createLinkRow()],
      null,
      [expectedUserId, otherUserId],
    );
    await assert.rejects(
      linkTrainingWorkoutReadinessSessionWithOwner(
        frozenLinkInput,
        expectedUserId,
        { supabase: client },
      ),
      assertSanitizedOwnerMismatch,
    );
    assert.equal(calls.length, 0, "linking A→B antes del RPC ejecuta cero RPC");
  }

  function assertSanitizedOwnerMismatch(error: unknown) {
    assert.ok(error instanceof TrainingWorkoutReadinessRepositoryError);
    assert.equal(error.code, "session_expired");
    assert.doesNotMatch(
      error.message,
      new RegExp(`${expectedUserId}|${otherUserId}|token|rpc|getUser|session_id`, "i"),
    );
    return true;
  }

  assert.deepEqual(frozenWorkoutInput, frozenWorkoutInputSnapshot, "workout readiness no muta input congelado");
  assert.deepEqual(frozenLinkInput, frozenLinkInputSnapshot, "linking no muta input congelado");

  if (false) {
    // @ts-expect-error expectedUserId es obligatorio en workout readiness.
    void saveTrainingWorkoutReadinessWithOwner(frozenWorkoutInput);
    // @ts-expect-error expectedUserId es obligatorio en linking.
    void linkTrainingWorkoutReadinessSessionWithOwner(frozenLinkInput);
  }

  const repositorySource = readFileSync("src/lib/training/training-workout-readiness-repository.ts", "utf8");
  const legacyRepositorySource = readFileSync("src/lib/training/training-daily-readiness-repository.ts", "utf8");
  const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  const packageTestPath = "src/lib/training/training-workout-readiness-repository.test.ts";
  const testPathOccurrences = packageJson.match(new RegExp(packageTestPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [];

  assert.match(legacyRepositorySource, /save_daily_training_readiness/, "repositorio legacy permanece como referencia legacy");
  assert.doesNotMatch(repositorySource, /save_daily_training_readiness/, "repositorio v2 no referencia la RPC legacy");
  assert.doesNotMatch(repositorySource, /p_user_id|p_local_date/, "repositorio v2 no envia user_id ni local_date como parametros RPC");
  assert.doesNotMatch(repositorySource, /as unknown as/, "repositorio v2 no usa casts dobles para mapear filas RPC");
  assert.match(appSource, /saveTrainingWorkoutReadiness/, "organizatech-app integra save readiness v2");
  assert.match(appSource, /linkTrainingWorkoutReadinessSession/, "organizatech-app integra link readiness v2 desde el repositorio");
  assert.doesNotMatch(appSource, /save_training_workout_readiness_v2|link_training_workout_readiness_session_v2/, "organizatech-app no usa nombres RPC v2 directos");
  assert.equal(testPathOccurrences.length, 1, "package.json incluye el test nuevo exactamente una vez");

  // P2-H.2B: translateTrainingWorkoutReadinessError se movio aqui desde organizatech-app.tsx.
  // Paridad literal por cada codigo, textos y puntuacion exactos.
  assert.equal(
    translateTrainingWorkoutReadinessError(new TrainingWorkoutReadinessRepositoryError("session_required", "x")),
    "Inicia sesion para confirmar tu formulario de entrenamiento.",
  );
  assert.equal(
    translateTrainingWorkoutReadinessError(new TrainingWorkoutReadinessRepositoryError("session_expired", "x")),
    "Tu sesión expiró. Inicia sesión nuevamente.",
  );
  for (const code of ["empty_response", "multiple_rows", "invalid_response"] as const) {
    assert.equal(
      translateTrainingWorkoutReadinessError(new TrainingWorkoutReadinessRepositoryError(code, "x")),
      "La respuesta del formulario de entrenamiento no tiene el formato esperado.",
    );
  }
  assert.equal(
    translateTrainingWorkoutReadinessError(new TrainingWorkoutReadinessRepositoryError("unexpected", "x")),
    "No pudimos confirmar tu formulario de entrenamiento.",
  );
  assert.equal(
    translateTrainingWorkoutReadinessError(createPublicRepositoryError("invalid_input", "Mensaje publico especifico.")),
    "Mensaje publico especifico.",
    "errores publicos ajenos a la clase de readiness usan su propio mensaje via getPublicErrorMessage",
  );
  assert.equal(
    translateTrainingWorkoutReadinessError(new Error("relation training_workout_readiness does not exist")),
    "No pudimos confirmar tu formulario de entrenamiento. Intentalo nuevamente.",
    "errores tecnicos no publicos caen al fallback generico",
  );

  console.log("training-workout-readiness repository tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
