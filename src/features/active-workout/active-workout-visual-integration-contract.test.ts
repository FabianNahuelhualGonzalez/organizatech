import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  activeWorkoutControllerReducer,
  createActiveWorkoutReadinessContext,
  createInitialActiveWorkoutControllerState,
  resolveActiveExerciseIndexChange,
  resolveActiveWorkoutCompletionTransition,
  resolveActiveWorkoutExerciseDraftUpdate,
  resolveActiveWorkoutRecoveryTransition,
  resolveActiveWorkoutStartTransition,
  resolvePendingReadinessLinkUpdate,
  type ActiveWorkoutControllerAction,
} from "@/features/active-workout/model/active-workout-controller-state";
import type { TrainingCompletionSummary } from "@/lib/training/training-completion-summary";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import type { PendingWorkoutReadinessLink } from "@/lib/training/workout-draft-storage";

// =============================================================================================
// RUNTIME: importa y ejecuta directamente factory/reducer productivos. Estas pruebas no renderizan
// React; la sección estática de wiring del hook se encuentra después.
// =============================================================================================

function createDraft(input: {
  weight: string;
  reps: Array<number | "">;
  observation: string;
  registered?: boolean;
}): ExerciseDraft {
  return {
    weight: input.weight,
    rir: "2",
    reps: input.reps,
    registered: input.registered ?? false,
    observation: input.observation,
  };
}

function createSummary(): TrainingCompletionSummary & { ownerId: string } {
  return {
    ownerId: "owner-must-not-enter-state",
    sessionId: "session-1",
    dayLabel: "Lunes",
    statusLabel: "Completado",
    workoutName: "Piernas",
    cycleLabel: "Mesociclo",
    weekLabel: "Semana 2",
    progressLabel: "2 de 3 dias",
    durationMinutes: 42,
    durationLabel: "42 min",
    exercises: [{
      exerciseId: "exercise-a",
      exerciseLineageId: "lineage-a",
      exerciseName: "Sentadilla",
      currentDate: "2026-07-31",
      currentDateLabel: "31 jul",
      currentSeriesCount: 2,
      currentTotalReps: 18,
      currentWeight: 60,
      currentWeightLabel: "60 kg",
      previousDate: "2026-07-24",
      previousDateLabel: "24 jul",
      previousSeriesCount: 2,
      previousTotalReps: 16,
      previousWeightLabel: "55 kg",
      repsDifference: 2,
      weightDifference: 5,
      comparisonStatus: "ready",
      repsTone: "positive",
      weightTone: "positive",
      resultLines: [{ label: "+2 reps", tone: "positive" }],
    }],
  };
}

function applyActions(actions: readonly ActiveWorkoutControllerAction[]) {
  return actions.reduce(
    activeWorkoutControllerReducer,
    createInitialActiveWorkoutControllerState(),
  );
}

const expectedInitialControllerState = {
  activeExerciseIndex: 0,
  exerciseDrafts: {},
  readiness: null,
  checkingDailyReadiness: false,
  savingDailyReadiness: false,
  dailyReadinessError: "",
  hasStartedTraining: false,
  activeWorkoutStartedAt: null,
  activeWorkoutAttemptId: null,
  pendingReadinessLink: null,
  hasRecoverableWorkoutStart: false,
  trainingCompletionSummary: null,
};

// Estado inicial completo y referencias frescas.
const initialControllerState = createInitialActiveWorkoutControllerState();
const secondInitialControllerState = createInitialActiveWorkoutControllerState();
assert.deepEqual(initialControllerState, expectedInitialControllerState);
assert.deepEqual(secondInitialControllerState, expectedInitialControllerState);
assert.notEqual(initialControllerState, secondInitialControllerState);
assert.notEqual(initialControllerState.exerciseDrafts, secondInitialControllerState.exerciseDrafts);

// Índice inmutable.
{
  const before = structuredClone(initialControllerState);
  const next = activeWorkoutControllerReducer(initialControllerState, {
    type: "active_exercise_index_changed",
    index: 2,
  });
  assert.equal(next.activeExerciseIndex, 2);
  assert.deepEqual(initialControllerState, before, "cambiar indice no muta el estado anterior");
  assert.equal(activeWorkoutControllerReducer(next, {
    type: "active_exercise_index_changed",
    index: 2,
  }), next, "repetir el indice es no-op");
}

// Recovery clona mapa, drafts y reps; tampoco muta el payload ni retiene cambios posteriores.
const recoveryDrafts = {
  "exercise-a": createDraft({ weight: "60", reps: [10, 8], observation: "A" }),
  "exercise-b": createDraft({ weight: "20", reps: [12], observation: "B" }),
};
const recoveryDraftsBefore = structuredClone(recoveryDrafts);
const recoveredState = activeWorkoutControllerReducer(initialControllerState, {
  type: "exercise_drafts_replaced",
  drafts: recoveryDrafts,
});
assert.deepEqual(recoveryDrafts, recoveryDraftsBefore, "recovery no muta el input");
assert.deepEqual(recoveredState.exerciseDrafts, recoveryDraftsBefore);
assert.notEqual(recoveredState.exerciseDrafts, recoveryDrafts);
assert.notEqual(recoveredState.exerciseDrafts["exercise-a"], recoveryDrafts["exercise-a"]);
assert.notEqual(recoveredState.exerciseDrafts["exercise-a"]?.reps, recoveryDrafts["exercise-a"].reps);
recoveryDrafts["exercise-a"].reps[0] = 99;
assert.equal(recoveredState.exerciseDrafts["exercise-a"]?.reps[0], 10);

// Actualizar A queda aislado por exerciseId, clona reps y no toca B.
{
  const stateBefore = structuredClone(recoveredState);
  const incomingDraft = createDraft({
    weight: "65",
    reps: [9, 9],
    observation: "A actualizada",
    registered: true,
  });
  const incomingBefore = structuredClone(incomingDraft);
  const next = activeWorkoutControllerReducer(recoveredState, {
    type: "exercise_draft_updated",
    exerciseId: "exercise-a",
    draft: incomingDraft,
  });

  assert.deepEqual(next.exerciseDrafts["exercise-a"], incomingBefore);
  assert.notEqual(next.exerciseDrafts["exercise-a"], incomingDraft);
  assert.notEqual(next.exerciseDrafts["exercise-a"]?.reps, incomingDraft.reps);
  assert.equal(next.exerciseDrafts["exercise-b"], recoveredState.exerciseDrafts["exercise-b"]);
  assert.deepEqual(recoveredState, stateBefore, "el estado anterior permanece intacto");
  assert.deepEqual(incomingDraft, incomingBefore, "update no muta su payload");

  incomingDraft.reps[0] = 1;
  assert.equal(next.exerciseDrafts["exercise-a"]?.reps[0], 9);
}

// Eliminación selectiva conserva otros ejercicios y no muta el mapa previo.
{
  const before = structuredClone(recoveredState);
  const next = activeWorkoutControllerReducer(recoveredState, {
    type: "completed_exercise_drafts_removed",
    exerciseIds: ["exercise-a"],
  });
  assert.deepEqual(Object.keys(next.exerciseDrafts), ["exercise-b"]);
  assert.deepEqual(next.exerciseDrafts["exercise-b"], recoveredState.exerciseDrafts["exercise-b"]);
  assert.deepEqual(recoveredState, before);
  assert.equal(activeWorkoutControllerReducer(recoveredState, {
    type: "completed_exercise_drafts_removed",
    exerciseIds: ["missing"],
  }), recoveredState, "eliminar ids ausentes es no-op");
}

// Readiness se clona por allowlist y no acepta ownership adicional.
{
  const readinessPayload: TrainingReadiness & { ownerId: string } = {
    motivation: 6,
    hydration: 5,
    sleep: 4,
    energy: 7,
    skipped: false,
    ownerId: "owner-must-not-enter-state",
  };
  const payloadBefore = structuredClone(readinessPayload);
  const next = activeWorkoutControllerReducer(initialControllerState, {
    type: "readiness_changed",
    readiness: readinessPayload,
  });
  assert.deepEqual(readinessPayload, payloadBefore);
  assert.notEqual(next.readiness, readinessPayload);
  assert.equal(next.readiness?.motivation, 6);
  assert.equal(next.readiness && "ownerId" in next.readiness, false);
  readinessPayload.motivation = 1;
  assert.equal(next.readiness?.motivation, 6);
  assert.equal(activeWorkoutControllerReducer(next, { type: "readiness_cleared" }).readiness, null);
}

// Pending link se clona por allowlist y no admite campos de identidad externos.
{
  const pendingPayload: PendingWorkoutReadinessLink & { userId: string } = {
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
    userId: "user-must-not-enter-state",
  };
  const payloadBefore = structuredClone(pendingPayload);
  const next = activeWorkoutControllerReducer(initialControllerState, {
    type: "pending_readiness_link_set",
    pendingLink: pendingPayload,
  });
  assert.deepEqual(pendingPayload, payloadBefore);
  assert.deepEqual(next.pendingReadinessLink, {
    workoutAttemptId: "attempt-1",
    trainingSessionId: "session-1",
  });
  assert.notEqual(next.pendingReadinessLink, pendingPayload);
  pendingPayload.trainingSessionId = "session-mutated";
  assert.equal(next.pendingReadinessLink?.trainingSessionId, "session-1");
  assert.equal(activeWorkoutControllerReducer(next, {
    type: "pending_readiness_link_cleared",
  }).pendingReadinessLink, null);
}

// Inicio legacy atomico: indice, startedAt, attempt nullable, pending, recovery y started cambian
// en una unica accion productiva.
{
  const input = {
    activeExerciseIndex: 1,
    exerciseCount: 2,
    activeWorkoutStartedAt: "2026-07-31T12:00:00.000Z",
    activeWorkoutAttemptId: null,
    pendingReadinessLink: null,
  };
  const before = structuredClone(input);
  const transition = resolveActiveWorkoutStartTransition(input);
  assert.equal(transition.kind, "ready");
  if (transition.kind !== "ready") throw new Error("legacy start debe ser valido");
  const started = activeWorkoutControllerReducer(initialControllerState, {
    type: "workout_start_committed",
    transition: transition.value,
  });

  assert.equal(started.hasStartedTraining, true);
  assert.equal(started.activeExerciseIndex, 1);
  assert.equal(started.activeWorkoutStartedAt, "2026-07-31T12:00:00.000Z");
  assert.equal(started.activeWorkoutAttemptId, null);
  assert.equal(started.pendingReadinessLink, null);
  assert.equal(started.hasRecoverableWorkoutStart, false);
  assert.deepEqual(input, before);
}

// Inicio V2 atomico conserva attempt y pending normalizados sin retener referencias externas.
{
  const input = {
    activeExerciseIndex: 0,
    exerciseCount: 2,
    activeWorkoutStartedAt: "2026-07-31T13:00:00.000Z",
    activeWorkoutAttemptId: "attempt-v2",
    pendingReadinessLink: {
      workoutAttemptId: "attempt-v2",
      trainingSessionId: "session-pending",
    },
  };
  const before = structuredClone(input);
  const transition = resolveActiveWorkoutStartTransition(input);
  assert.equal(transition.kind, "ready");
  if (transition.kind !== "ready") throw new Error("V2 start debe ser valido");
  const started = activeWorkoutControllerReducer(initialControllerState, {
    type: "workout_start_committed",
    transition: transition.value,
  });

  assert.equal(started.hasStartedTraining, true);
  assert.equal(started.activeWorkoutAttemptId, "attempt-v2");
  assert.deepEqual(started.pendingReadinessLink, before.pendingReadinessLink);
  assert.notEqual(started.pendingReadinessLink, input.pendingReadinessLink);
  assert.deepEqual(input, before);
}

// Recovery canonico publica sus siete campos relacionados en una sola accion y clona payloads.
{
  const input = {
    activeExerciseIndex: 1,
    activeWorkoutStartedAt: "2026-07-31T14:00:00.000Z",
    activeWorkoutAttemptId: "attempt-recovery",
    pendingReadinessLink: {
      workoutAttemptId: "attempt-recovery",
      trainingSessionId: "session-recovery",
    },
    hasStartedTraining: true,
    readiness: { motivation: 6, skipped: false } satisfies TrainingReadiness,
    exerciseDrafts: {
      "exercise-a": createDraft({ weight: "62", reps: [8, 8], observation: "recovery" }),
    },
  };
  const before = structuredClone(input);
  const transition = resolveActiveWorkoutRecoveryTransition(input);
  assert.equal(transition.kind, "ready");
  if (transition.kind !== "ready") throw new Error("recovery debe ser valido");
  const recovered = activeWorkoutControllerReducer(initialControllerState, {
    type: "workout_recovered",
    transition: transition.value,
  });

  assert.equal(recovered.activeExerciseIndex, 1);
  assert.equal(recovered.activeWorkoutStartedAt, input.activeWorkoutStartedAt);
  assert.equal(recovered.activeWorkoutAttemptId, input.activeWorkoutAttemptId);
  assert.equal(recovered.hasStartedTraining, true);
  assert.deepEqual(recovered.readiness, {
    motivation: 6,
    hydration: undefined,
    sleep: undefined,
    energy: undefined,
    skipped: false,
  });
  assert.deepEqual(recovered.exerciseDrafts, input.exerciseDrafts);
  assert.notEqual(recovered.exerciseDrafts, input.exerciseDrafts);
  assert.notEqual(recovered.exerciseDrafts["exercise-a"], input.exerciseDrafts["exercise-a"]);
  assert.deepEqual(input, before);
}

// Checking readiness: inicio, success y error controlan loading/error sin tocar otros campos.
{
  const checking = activeWorkoutControllerReducer(
    activeWorkoutControllerReducer(initialControllerState, {
      type: "readiness_error_published",
      error: "anterior",
    }),
    { type: "readiness_check_started" },
  );
  assert.equal(checking.checkingDailyReadiness, true);
  assert.equal(checking.dailyReadinessError, "");
  const withError = activeWorkoutControllerReducer(checking, {
    type: "readiness_error_published",
    error: "check error",
  });
  const success = activeWorkoutControllerReducer(withError, { type: "readiness_check_finished" });
  assert.equal(success.checkingDailyReadiness, false);
  assert.equal(success.dailyReadinessError, "check error", "finally no borra un error vigente");
  const failed = activeWorkoutControllerReducer(checking, {
    type: "readiness_check_failed",
    error: "check error",
  });
  assert.equal(failed.checkingDailyReadiness, false);
  assert.equal(failed.dailyReadinessError, "check error");
  assert.equal(activeWorkoutControllerReducer(failed, {
    type: "readiness_error_cleared",
  }).dailyReadinessError, "");
}

// Saving readiness: inicio, success y error controlan loading/error de forma independiente.
{
  const saving = activeWorkoutControllerReducer(initialControllerState, {
    type: "readiness_save_started",
  });
  assert.equal(saving.savingDailyReadiness, true);
  assert.equal(saving.checkingDailyReadiness, false);
  const withError = activeWorkoutControllerReducer(saving, {
    type: "readiness_error_published",
    error: "save error",
  });
  const success = activeWorkoutControllerReducer(withError, { type: "readiness_save_finished" });
  assert.equal(success.savingDailyReadiness, false);
  assert.equal(success.dailyReadinessError, "save error", "finally no borra un error vigente");
  const failed = activeWorkoutControllerReducer(saving, {
    type: "readiness_save_failed",
    error: "save error",
  });
  assert.equal(failed.savingDailyReadiness, false);
  assert.equal(failed.dailyReadinessError, "save error");
}

// Summary se clona profundamente por allowlist y puede limpiarse sin mutar el payload.
const summaryPayload = createSummary();
const summaryPayloadBefore = structuredClone(summaryPayload);
const summaryState = activeWorkoutControllerReducer(initialControllerState, {
  type: "completion_summary_set",
  summary: summaryPayload,
});
assert.deepEqual(summaryPayload, summaryPayloadBefore);
assert.notEqual(summaryState.trainingCompletionSummary, summaryPayload);
assert.notEqual(summaryState.trainingCompletionSummary?.exercises, summaryPayload.exercises);
assert.notEqual(
  summaryState.trainingCompletionSummary?.exercises[0]?.resultLines,
  summaryPayload.exercises[0]?.resultLines,
);
assert.equal(summaryState.trainingCompletionSummary && "ownerId" in summaryState.trainingCompletionSummary, false);
summaryPayload.exercises[0].resultLines[0].label = "mutado";
assert.equal(summaryState.trainingCompletionSummary?.exercises[0]?.resultLines[0]?.label, "+2 reps");
assert.equal(activeWorkoutControllerReducer(summaryState, {
  type: "completion_summary_cleared",
}).trainingCompletionSummary, null);

// Completion publica summary y retira exclusivamente los drafts persistidos en una sola accion.
{
  const state = activeWorkoutControllerReducer(initialControllerState, {
    type: "exercise_drafts_replaced",
    drafts: recoveryDraftsBefore,
  });
  const untouchedDraft = state.exerciseDrafts["exercise-b"];
  const summary = createSummary();
  const input = { summary, completedExerciseIds: ["exercise-a", "exercise-a"] };
  const before = structuredClone(input);
  const transition = resolveActiveWorkoutCompletionTransition(input);
  assert.equal(transition.kind, "ready");
  if (transition.kind !== "ready") throw new Error("completion debe ser valida");
  assert.deepEqual(transition.value.completedExerciseIds, ["exercise-a"]);

  const completed = activeWorkoutControllerReducer(state, {
    type: "workout_completion_published",
    transition: transition.value,
  });
  assert.equal(completed.exerciseDrafts["exercise-a"], undefined);
  assert.equal(completed.exerciseDrafts["exercise-b"], untouchedDraft);
  assert.equal(completed.trainingCompletionSummary?.sessionId, "session-1");
  assert.equal(
    completed.trainingCompletionSummary && "ownerId" in completed.trainingCompletionSummary,
    false,
  );
  assert.deepEqual(input, before);
  assert.deepEqual(state.exerciseDrafts, recoveryDraftsBefore, "completion no muta drafts previos");
}

// Los boundaries rechazan indices, IDs y timestamps no confiables antes del dispatch.
{
  assert.deepEqual(resolveActiveExerciseIndexChange({ index: -1, exerciseCount: 2 }), {
    kind: "rejected",
    reason: "invalid_active_exercise_index",
  });
  assert.deepEqual(resolveActiveExerciseIndexChange({ index: 1.5, exerciseCount: 2 }), {
    kind: "rejected",
    reason: "invalid_active_exercise_index",
  });
  assert.deepEqual(resolveActiveExerciseIndexChange({ index: 2, exerciseCount: 2 }), {
    kind: "rejected",
    reason: "invalid_active_exercise_index",
  });
  assert.deepEqual(resolveActiveExerciseIndexChange({ index: 0, exerciseCount: 0 }), {
    kind: "rejected",
    reason: "invalid_exercise_count",
  });
  assert.equal(resolveActiveWorkoutExerciseDraftUpdate({
    exerciseId: " ",
    draft: createDraft({ weight: "20", reps: [8], observation: "" }),
  }).kind, "rejected");
  assert.equal(resolveActiveWorkoutStartTransition({
    activeExerciseIndex: 0,
    exerciseCount: 1,
    activeWorkoutStartedAt: " ",
    activeWorkoutAttemptId: null,
    pendingReadinessLink: null,
  }).kind, "rejected");
  assert.equal(resolveActiveWorkoutStartTransition({
    activeExerciseIndex: 0,
    exerciseCount: 1,
    activeWorkoutStartedAt: "2026-07-31T12:00:00.000Z",
    activeWorkoutAttemptId: " ",
    pendingReadinessLink: null,
  }).kind, "rejected");
  assert.equal(resolvePendingReadinessLinkUpdate({
    activeWorkoutAttemptId: "attempt-a",
    pendingReadinessLink: {
      workoutAttemptId: "attempt-b",
      trainingSessionId: "session-1",
    },
  }).kind, "rejected");
  assert.equal(resolveActiveWorkoutRecoveryTransition({
    activeExerciseIndex: -1,
    activeWorkoutStartedAt: "2026-07-31T12:00:00.000Z",
    activeWorkoutAttemptId: null,
    pendingReadinessLink: null,
    hasStartedTraining: true,
    readiness: null,
    exerciseDrafts: {},
  }).kind, "rejected");
  assert.equal(resolveActiveWorkoutRecoveryTransition({
    activeExerciseIndex: 0,
    activeWorkoutStartedAt: "2026-07-31T12:00:00.000Z",
    activeWorkoutAttemptId: null,
    pendingReadinessLink: null,
    hasStartedTraining: true,
    readiness: null,
    exerciseDrafts: {
      " ": createDraft({ weight: "20", reps: [8], observation: "" }),
    },
  }).kind, "rejected");
  assert.equal(resolveActiveWorkoutCompletionTransition({
    summary: createSummary(),
    completedExerciseIds: [""],
  }).kind, "rejected");
  assert.equal(createActiveWorkoutReadinessContext({
    workoutAttemptId: "attempt-1",
    cycleId: "cycle-1",
    cycleDayId: "day-1",
    workoutStartedAt: " ",
  }), null);
  assert.deepEqual(createActiveWorkoutReadinessContext({
    workoutAttemptId: "attempt-1",
    cycleId: "cycle-1",
    cycleDayId: "day-1",
    workoutStartedAt: "2026-07-31T12:00:00.000Z",
    plannedDay: "lunes",
    plannedDate: "2026-07-31",
  }), {
    workoutAttemptId: "attempt-1",
    cycleId: "cycle-1",
    cycleDayId: "day-1",
    workoutStartedAt: "2026-07-31T12:00:00.000Z",
    plannedDay: "lunes",
    plannedDate: "2026-07-31",
  });
}

// Reset completo devuelve una instancia fresca, sin revivir valores ni mutar el estado previo.
{
  const dirtyState = applyActions([
    { type: "active_exercise_index_changed", index: 4 },
    { type: "exercise_drafts_replaced", drafts: recoveryDraftsBefore },
    { type: "readiness_changed", readiness: { motivation: 6, skipped: false } },
    { type: "readiness_check_started" },
    { type: "readiness_save_started" },
    { type: "training_started" },
    { type: "workout_started_at_set", startedAt: "2026-07-31T12:00:00.000Z" },
    { type: "workout_attempt_id_set", attemptId: "attempt-reset" },
    {
      type: "pending_readiness_link_set",
      pendingLink: { workoutAttemptId: "attempt-reset", trainingSessionId: "session-reset" },
    },
    { type: "workout_recovery_availability_changed", available: true },
    { type: "completion_summary_set", summary: createSummary() },
    { type: "readiness_error_published", error: "error-reset" },
  ]);
  const dirtyBefore = structuredClone(dirtyState);
  const reset = activeWorkoutControllerReducer(dirtyState, { type: "active_workout_reset" });
  const fresh = createInitialActiveWorkoutControllerState();

  assert.deepEqual(reset, expectedInitialControllerState);
  assert.deepEqual(dirtyState, dirtyBefore, "reset no muta el estado previo");
  assert.notEqual(reset, dirtyState);
  assert.notEqual(reset, fresh);
  assert.notEqual(reset.exerciseDrafts, dirtyState.exerciseDrafts);
  assert.notEqual(reset.exerciseDrafts, fresh.exerciseDrafts);
  assert.deepEqual(activeWorkoutControllerReducer(reset, {
    type: "active_exercise_index_changed",
    index: 1,
  }).exerciseDrafts, {}, "una accion posterior no revive drafts previos");
}

// Una acción desconocida no se ignora silenciosamente en runtime; el tipo sigue siendo exhaustivo.
assert.throws(() => activeWorkoutControllerReducer(
  initialControllerState,
  { type: "unknown_action" } as unknown as ActiveWorkoutControllerAction,
));

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula sliders,
 * clicks ni navegador, y no prueba persistencia.
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const packageSource = readSource("package.json");
const controllerModelSource = readSource(
  "src/features/active-workout/model/active-workout-controller-state.ts",
);
const controllerHookSource = readSource(
  "src/features/active-workout/hooks/useActiveWorkoutController.ts",
);
const files = {
  readiness: readSource("src/features/active-workout/components/TrainingReadinessScreen.tsx"),
  start: readSource("src/features/active-workout/components/TrainingStartScreen.tsx"),
  completion: readSource("src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx"),
  performancePanel: readSource("src/features/active-workout/components/ExerciseLastPerformancePanel.tsx"),
  seriesResult: readSource("src/features/active-workout/components/SeriesResult.tsx"),
  guided: readSource("src/features/active-workout/components/GuidedTrainingScreen.tsx"),
};

// =============================================================================================
// ESTÁTICO: wiring productivo del hook. No renderiza React, no ejecuta el hook y no presenta estas
// comprobaciones source-based como cobertura de interacción.
// =============================================================================================

assert.match(controllerHookSource, /import \{ useMemo, useReducer \} from "react";/);
assert.match(controllerHookSource, /activeWorkoutControllerReducer/);
assert.match(controllerHookSource, /createInitialActiveWorkoutControllerState/);
assert.match(controllerHookSource, /useReducer\(\s*activeWorkoutControllerReducer,/);
assert.match(controllerHookSource, /return useMemo\(\(\) => \(\{ state, actions \}\)/);
assert.match(
  appSource,
  /import \{ useActiveWorkoutController \} from "@\/features\/active-workout\/hooks\/useActiveWorkoutController";/,
);
assert.equal(
  (appSource.match(/useActiveWorkoutController\(\)/g) ?? []).length,
  1,
  "el root invoca una sola instancia del controller",
);
assert.doesNotMatch(controllerHookSource, /\buseEffect\b|\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b/);
assert.doesNotMatch(
  controllerHookSource,
  /\buseRef\b|\bSessionOperationOwner\b|\bSessionDataRequestToken\b/,
  "el hook no posee refs, owners ni tokens de sesión",
);
assert.doesNotMatch(
  controllerHookSource,
  /@\/lib\/(?:storage|navigation|supabase|session)|-repository(?:"|')|active-workout-session-boundary/,
  "el hook no depende de storage, navegacion, Supabase, repositories ni session owners",
);
assert.doesNotMatch(controllerHookSource, /^\s*dispatch\s*:/m, "dispatch no forma parte de la API pública");
assert.doesNotMatch(controllerHookSource, /\bsetState\b|\bpatchState\b|\bmergeState\b/);
for (const atomicAction of [
  "commitWorkoutStart",
  "recoverWorkout",
  "publishWorkoutCompletion",
  "resetActiveWorkout",
]) {
  assert.match(controllerHookSource, new RegExp(`${atomicAction}:`));
}

for (const stateName of [
  "activeExerciseIndex",
  "exerciseDrafts",
  "readiness",
  "checkingDailyReadiness",
  "savingDailyReadiness",
  "dailyReadinessError",
  "hasStartedTraining",
  "activeWorkoutStartedAt",
  "activeWorkoutAttemptId",
  "pendingReadinessLink",
  "hasRecoverableWorkoutStart",
  "trainingCompletionSummary",
]) {
  assert.doesNotMatch(
    appSource,
    new RegExp(`const \\[${stateName},`),
    `${stateName} no conserva un useState espejo en el root`,
  );
}
for (const removedSetter of [
  "setActiveExerciseIndex",
  "setExerciseDrafts",
  "setReadiness",
  "setCheckingDailyReadiness",
  "setSavingDailyReadiness",
  "setDailyReadinessError",
  "setHasStartedTraining",
  "setActiveWorkoutStartedAt",
  "setActiveWorkoutAttemptId",
  "setPendingReadinessLink",
  "setHasRecoverableWorkoutStart",
  "setTrainingCompletionSummary",
]) {
  assert.doesNotMatch(appSource, new RegExp(`\\b${removedSetter}\\b`));
}
assert.match(
  appSource,
  /const \{ state: activeWorkoutState, actions: activeWorkoutActions \} = useActiveWorkoutController\(\);/,
);
assert.match(appSource, /resolveActiveWorkoutStartTransition/);
assert.match(appSource, /resolveActiveWorkoutRecoveryTransition/);
assert.match(controllerHookSource, /resolveActiveWorkoutCompletionTransition/);
assert.match(controllerHookSource, /resolveActiveExerciseIndexChange/);
assert.match(controllerHookSource, /resolveActiveWorkoutExerciseDraftUpdate/);
assert.match(appSource, /activeWorkoutActions\.commitWorkoutStart\(start\.value\)/);
assert.match(appSource, /activeWorkoutActions\.recoverWorkout\(recovery\.value\)/);
assert.match(appSource, /activeWorkoutActions\.publishWorkoutCompletion\(/);
assert.match(controllerHookSource, /dispatch\(\{ type: "workout_completion_published", transition: completion\.value \}\)/);

const startBoundarySource = appSource.slice(
  appSource.indexOf("  function prepareWorkoutStartSnapshot"),
  appSource.indexOf("  async function startTrainingWithDailyReadiness"),
);
assert.ok(
  startBoundarySource.indexOf("activeWorkoutAttemptIdRef.current =") <
    startBoundarySource.indexOf("activeWorkoutActions.commitWorkoutStart"),
  "start sincroniza attempt ref antes de publicar la transicion atomica",
);
assert.ok(
  startBoundarySource.indexOf("pendingReadinessLinkRef.current =") <
    startBoundarySource.indexOf("activeWorkoutActions.commitWorkoutStart"),
  "start sincroniza pending ref antes de publicar la transicion atomica",
);
const recoveryBoundarySource = appSource.slice(
  appSource.indexOf("  function restoreWorkoutDraftRecord"),
  appSource.indexOf("  function restoreActiveWorkoutForNavigation"),
);
assert.ok(
  recoveryBoundarySource.indexOf("activeWorkoutAttemptIdRef.current =") <
    recoveryBoundarySource.indexOf("activeWorkoutActions.recoverWorkout"),
);
assert.ok(
  recoveryBoundarySource.indexOf("pendingReadinessLinkRef.current =") <
    recoveryBoundarySource.indexOf("activeWorkoutActions.recoverWorkout"),
);
const resetBoundarySource = appSource.slice(
  appSource.indexOf("  const resetActiveWorkoutSessionState = useCallback"),
  appSource.indexOf("  useEffect(() =>", appSource.indexOf("  const resetActiveWorkoutSessionState = useCallback")),
);
assert.ok(
  resetBoundarySource.indexOf("workoutCompletionInFlightRef.current = null") <
    resetBoundarySource.indexOf("activeWorkoutActions.resetActiveWorkout()"),
  "reset invalida owners y refs antes de publicar memoria limpia",
);

assert.doesNotMatch(controllerModelSource, /from "react"|\buse[A-Z]\w*\b/);
assert.doesNotMatch(controllerModelSource, /\bDate\.now\b|\bMath\.random\b|\bwindow\b|\bdocument\b/);
assert.doesNotMatch(controllerModelSource, /\bfetch\s*\(|\bsetTimeout\b|\bsetInterval\b/);
assert.doesNotMatch(controllerModelSource, /\bany\b/);
assert.doesNotMatch(controllerModelSource, /Partial<ActiveWorkoutControllerState>/);
assert.doesNotMatch(controllerModelSource, /type:\s*"(?:patch|merge|set_state)"/);
assert.match(controllerModelSource, /default:\s*\n\s*return assertNever\(action\);/);
for (const importStatement of controllerModelSource.match(/^import .+;$/gm) ?? []) {
  assert.match(importStatement, /^import type /, "el modelo solo puede tener imports type-only");
}
for (const canonicalType of [
  "ExerciseDraft",
  "TrainingReadiness",
  "PendingWorkoutReadinessLink",
  "TrainingCompletionSummary",
]) {
  assert.match(
    controllerModelSource,
    new RegExp(`import type \\{[\\s\\S]*?\\b${canonicalType}\\b[\\s\\S]*?\\} from`),
    `${canonicalType} debe reutilizar su definición canónica`,
  );
  assert.doesNotMatch(
    controllerModelSource,
    new RegExp(`(?:interface|type) ${canonicalType}\\b`),
    `${canonicalType} no debe duplicarse en el modelo`,
  );
}
for (const forbidden of [
  "repository",
  "Supabase",
  "localStorage",
  "sessionStorage",
  "SessionOperationOwner",
  "SessionDataRequestToken",
  "setScreen",
]) {
  assert.doesNotMatch(controllerModelSource, new RegExp(forbidden, "i"));
}

function assertNoForbiddenImports(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: no debe importar el root`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: no debe importar storage`);
    assert.doesNotMatch(path, /supabase/i, `${label}: no debe importar Supabase`);
    assert.doesNotMatch(path, /-repository$/, `${label}: no debe importar repositories`);
  });
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/);
}

// Cada componente se verifica contra su consumidor REAL: importado alli, renderizado alli, y
// nunca declarado inline en el root. Tras P3-30, ExerciseLastPerformancePanel y SeriesResult ya
// no los consume el root sino GuidedTrainingScreen, que absorbio ese JSX en la extraccion.
const components = [
  ["TrainingReadinessScreen", "@/features/active-workout/components/TrainingReadinessScreen", appSource],
  ["TrainingStartScreen", "@/features/active-workout/components/TrainingStartScreen", appSource],
  ["TrainingCompletionSummaryScreen", "@/features/active-workout/components/TrainingCompletionSummaryScreen", appSource],
  ["GuidedTrainingScreen", "@/features/active-workout/components/GuidedTrainingScreen", appSource],
  ["ExerciseLastPerformancePanel", "@/features/active-workout/components/ExerciseLastPerformancePanel", files.guided],
  ["SeriesResult", "@/features/active-workout/components/SeriesResult", files.guided],
] as const;
for (const [componentName, modulePath, consumerSource] of components) {
  assert.match(consumerSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.match(consumerSource, new RegExp(`<${componentName}\\b`));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

Object.entries(files).forEach(([label, source]) => assertNoForbiddenImports(source, label));
assert.match(files.readiness, /onSubmit: \(value: Omit<TrainingReadiness, "skipped">\)/);
assert.match(files.readiness, /className="readiness-slider"/);
assert.match(files.start, /routineDays: string\[\];/);
assert.match(files.start, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.doesNotMatch(files.start, /^\s*function RoutineMetricGrid\b/m);
assert.match(files.completion, /className="training-completion-table" role="table"/);
assert.match(files.performancePanel, /className="exercise-observation-textarea"/);
assert.match(files.seriesResult, /className={`series-result session-summary \$\{result\.tone\}`}/);

// =============================================================================================
// ESTÁTICO/SOURCE-BASED HOTFIX: el resumen de cierre debe conservar una única presentación. La
// infraestructura de compartir puede permanecer aislada, pero no se monta en esta pantalla.
// No renderiza React/DOM y no sustituye la QA manual en navegador.
// =============================================================================================

for (const forbiddenShareIntegration of [
  /ShareWorkoutCard/,
  /buildWorkoutShareCardModel/,
  /buildWorkoutShareTextPayload/,
  /executeWorkoutShareAction/,
  /handleShareWorkout/,
  /shareModel/,
  /\bnavigator\b/,
  /Compartiendo\.\.\./,
]) {
  assert.doesNotMatch(
    files.completion,
    forbiddenShareIntegration,
    "TrainingCompletionSummaryScreen no debe montar un segundo resumen ni acciones de compartir",
  );
}

assert.doesNotMatch(files.completion, /^"use client";/);
assert.doesNotMatch(files.completion, /\buseEffect\b|\buseRef\b|\buseState\b/);

const completionTableIndex = files.completion.indexOf("<div className=\"training-completion-table\"");
const dashboardButtonIndex = files.completion.indexOf(
  "<button className=\"button training-completion-button\" type=\"button\" onClick={onDashboard}>",
);
assert.ok(completionTableIndex >= 0 && completionTableIndex < dashboardButtonIndex);
assert.match(
  files.completion,
  /<button className="button training-completion-button" type="button" onClick=\{onDashboard\}>\s*Ir al panel principal\s*<\/button>/,
  "el boton Dashboard conserva clase, tipo, handler y texto",
);
assert.equal(JSON.parse(packageSource).scripts.test.split(" && ").length, 122);

// GuidedTrainingScreen (P3-30): extraccion mecanica. Conserva el contrato de props, reutiliza el
// normalizador canonico de P3-29 sin redeclararlo, y no introduce estado ni efectos propios.
assert.match(files.guided, /export interface GuidedTrainingScreenProps \{/);
assert.match(files.guided, /className="card wide mobile-series-card"/);
assert.match(files.guided, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.doesNotMatch(files.guided, /^\s*function RoutineMetricGrid\b/m);
assert.match(
  files.guided,
  /import \{ normalizeExerciseDraft, type ExerciseDraft \} from "@\/lib\/training\/training-exercise-draft";/,
);
assert.doesNotMatch(files.guided, /function normalizeExerciseDrafts?\(/, "no debe duplicar los normalizadores canonicos de P3-29");
for (const forbiddenHook of [/\buseState\b/, /\buseEffect\b/, /\buseReducer\b/, /\buseRef\b/]) {
  assert.doesNotMatch(files.guided, forbiddenHook, "GuidedTrainingScreen debe permanecer sin estado ni efectos propios");
}
for (const prop of [
  "day", "routine", "exercises", "targetSummary", "activeIndex", "setActiveIndex", "drafts",
  "updateDraft", "registerExercise", "saveCompletedTraining", "editRoutine", "routineDays",
  "switchDay", "notice", "isBusy",
]) {
  assert.match(files.guided, new RegExp(`^\\s{2}${prop}[?]?:`, "m"), `GuidedTrainingScreenProps debe declarar ${prop}`);
}

const registration = "tsx src/features/active-workout/active-workout-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("active-workout controller runtime and visual static integration contract tests passed");
