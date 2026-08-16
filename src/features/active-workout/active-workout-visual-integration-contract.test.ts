import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

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
import { isDecimalWeightDraftInput, parseDecimalWeightInput } from "@/lib/progress/weight-format";
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
const boundaryHookSource = readSource(
  "src/features/active-workout/hooks/useActiveWorkoutBoundary.ts",
);
const files = {
  readiness: readSource("src/features/active-workout/components/TrainingReadinessScreen.tsx"),
  start: readSource("src/features/active-workout/components/TrainingStartScreen.tsx"),
  completion: readSource("src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx"),
  performancePanel: readSource("src/features/active-workout/components/ExerciseLastPerformancePanel.tsx"),
  seriesResult: readSource("src/features/active-workout/components/SeriesResult.tsx"),
  guided: readSource("src/features/active-workout/components/GuidedTrainingScreen.tsx"),
  workoutStyles: readSource("src/features/active-workout/active-workout.module.css"),
  exerciseDraft: readSource("src/lib/training/training-exercise-draft.ts"),
  metricGrid: readSource("src/ui/data-display/metric-grid.tsx"),
  workoutRegistration: readSource("src/lib/training/workout-registration.ts"),
  trainingDayOrder: readSource("src/lib/training/training-day-order.ts"),
};
const globalStyles = readSource("src/app/globals.css");

const protectedFileHashes = {
  "AGENTS.md": "f0c3ef88979a0ab085551a656ebb1843bfa56138d948ca4236bce6fcd1fa9dd0",
  "package.json": "912d03a06a3bbe4bd45490e5cfc1f4b71ee8090d5a1196e5645880850e2de762",
  "package-lock.json": "3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5",
  "src/app/globals.css": "57a8d03c03fc729a72a06a7b846ae8a73a721b7d89551edf18b0003b26cfc5c9",
  "src/components/organizatech-app.tsx": "2ddbbdd604953fdbb6aaab4b9e9ee110b1d3f30ae449349ee2dd3efec6e15266",
  "src/features/progress/components/comparison-screen-v2.tsx": "bff390e44cf5a04fe59b0f2a594fcb53fb2a50602c850362f1a88ca136765743",
  "src/features/progress/progress-visual-integration-contract.test.ts": "9c0f432417b1a98a0cd3b9542b2e6a4c3dd4a8126989c6f17bc3a65133a56821",
  "src/features/active-workout/model/active-workout-controller-state.ts": "37006210eabda3f99217bd98b6ebf876780ed5ecc33bb8fba936eda7fd085ea5",
  "src/features/active-workout/hooks/useActiveWorkoutController.ts": "c7b475636a3b8731a9e8b9a46702584b9c2a4a06333b75139791bf3ef2ce25bf",
  "src/features/active-workout/hooks/useActiveWorkoutBoundary.ts": "5ee8be6ccea0e751659c0d20b76184874f161be04a89ea3a4f41c640b8aef1e9",
  "src/lib/progress/calculations.ts": "fb71a58d8dbb9481666ffe180d2014d060b76626bb8ff68bbd68cb538adba90a",
  "src/lib/progress/types.ts": "aa4aa66f24f6eb65e9c5eef68d70f5e0e149fea1299623bae207ecc0a06f0cf2",
  "src/lib/progress/weight-format.ts": "e9843337c3359a50799010eb1526c6867bea9af3295fd7495cf67b96938636ea",
  "src/lib/training/active-workout-completion.ts": "3c48c1ef32c39522888c5b96fcc5fe9c322fa49adbb077587e17fe8f513f84b2",
  "src/lib/training/active-workout-draft.ts": "2fb96884332583f7b9cb8f24afd78516df4e03492109f3c4184eba9f61a5ca33",
  "src/lib/training/active-workout-history-load.ts": "b6f101adb982daea357369df0554cbd90f8039678fda3e6f823143417e96a478",
  "src/lib/training/exercise-current-result-presentation.ts": "03ff9c71b89d4c025536d47818338032389d4131a4fd70bdea20c267da356ad1",
  "src/lib/training/exercise-last-observation-presentation.ts": "69d8d7580b1d9fd151e4cfb327bfcfee5f4f09c1d5a7381c2d245a9945965299",
  "src/lib/training/exercise-last-performance-presentation.ts": "00284459d5ceaf7eff3adb63c0bd10ac6609ea12767d94a756f7d22aeafc88e4",
  "src/lib/training/training-completion-summary.ts": "60766dcaf47d95680cb93e3f9ad02f832d1f2efeebd02624b0ae315e4ae3a8c1",
  "src/lib/training/training-exercise-draft.ts": "d394157cd8c093071cc9e5d5b52cf6185a1318032be446ba397669675bc70bd1",
  "src/lib/training/workout-registration.ts": "432a2bad50ebd22f39ddb8ad1c3c3b2cf1dadcc059a6051b7a5fb7e5f9e08c60",
  "src/lib/training/workout-draft-storage.ts": "9bc72346cceb27881bd0f5171a63967ebc78663613742bc8156f65dbb20d5c11",
  "src/lib/training/exercise-last-observation-repository.ts": "073bdbeed5b95dfac9e2f43523cb8de6568b700673aac1a848d8013ca6b97f23",
  "src/lib/training/exercise-last-performance-repository.ts": "292701936e74f3bcecb3e0b07eff5a8ba1408b9d9097a772157508ec394a5a3b",
} as const;

type ProtectedFilePath = keyof typeof protectedFileHashes;
type ProtectedFileSources = Record<ProtectedFilePath, string>;

const protectedFileSources = Object.fromEntries(
  Object.keys(protectedFileHashes).map((path) => [path, readSource(path)]),
) as ProtectedFileSources;

function sha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

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
  /import \{ useActiveWorkoutBoundary \} from "@\/features\/active-workout\/hooks\/useActiveWorkoutBoundary";/,
);
assert.equal(
  (appSource.match(/useActiveWorkoutBoundary\(/g) ?? []).length,
  1,
  "el root invoca una sola instancia del boundary",
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
  /const activeWorkoutBoundary = useActiveWorkoutBoundary\(/,
);
assert.match(appSource, /const activeWorkoutState = activeWorkoutBoundary\.state;/);
assert.match(appSource, /const activeWorkoutActions = activeWorkoutBoundary\.controllerActions;/);
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
  appSource.indexOf("  async function startTrainingCommand"),
);
assert.ok(
  startBoundarySource.indexOf("activeWorkoutBoundary.replaceRuntimeSnapshot") <
    startBoundarySource.indexOf("activeWorkoutActions.commitWorkoutStart"),
  "start sincroniza attempt ref antes de publicar la transicion atomica",
);
assert.ok(
  startBoundarySource.indexOf("pendingReadinessLink: start.value.pendingReadinessLink") <
    startBoundarySource.indexOf("activeWorkoutActions.commitWorkoutStart"),
  "start sincroniza pending ref antes de publicar la transicion atomica",
);
const recoveryBoundarySource = appSource.slice(
  appSource.indexOf("  function restoreWorkoutDraftRecord"),
  appSource.indexOf("  function restoreActiveWorkoutForNavigation"),
);
assert.ok(
  recoveryBoundarySource.indexOf("activeWorkoutBoundary.replaceRuntimeSnapshot") <
    recoveryBoundarySource.indexOf("activeWorkoutActions.recoverWorkout"),
);
assert.ok(
  recoveryBoundarySource.indexOf("pendingReadinessLink: recovery.value.pendingReadinessLink") <
    recoveryBoundarySource.indexOf("activeWorkoutActions.recoverWorkout"),
);
const resetBoundarySource = appSource.slice(
  appSource.indexOf("  const resetActiveWorkoutSessionState = useCallback"),
  appSource.indexOf("  useEffect(() =>", appSource.indexOf("  const resetActiveWorkoutSessionState = useCallback")),
);
assert.ok(
  resetBoundarySource.indexOf("activeWorkoutBoundary.resetForIdentity") >= 0,
  "reset invalida owners y refs antes de publicar memoria limpia",
);
assert.ok(
  boundaryHookSource.indexOf("invalidateOperations();") <
    boundaryHookSource.indexOf("controller.actions.resetActiveWorkout();"),
  "el boundary invalida owners antes de publicar memoria limpia",
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
assert.match(files.seriesResult, /buildExerciseCurrentResultPresentation\(\{/);
assert.match(files.seriesResult, /className=\{styles\.objectives\} data-tone=\{result\.tone\}/);

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
assert.equal(JSON.parse(packageSource).scripts.test.split(" && ").length, 126);

// GuidedTrainingScreen conserva el boundary de P3-30: TRAIN-UI-01 cambia su presentacion,
// reutiliza el normalizador canonico de P3-29 y no introduce estado ni efectos propios.
assert.match(files.guided, /export interface GuidedTrainingScreenProps \{/);
assert.match(files.guided, /mobile-series-card \$\{styles\.workoutCard\}/);
assert.match(files.guided, /import \{ RoutineMetricGrid \} from "@\/ui\/data-display\/metric-grid";/);
assert.match(files.guided, /<RoutineMetricGrid targetSummary=\{targetSummary\} \/>/);
assert.match(files.guided, /<div className=\{styles\.srOnly\} aria-hidden="true">\s*<RoutineMetricGrid targetSummary=\{targetSummary\} \/>/);
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

// =============================================================================================
// TRAIN-UI-01 — contrato ESTATICO/source-based del rediseño. Verifica wiring de presentacion y
// accesibilidad sin afirmar render, interaccion real ni ausencia visual de overflow en navegador.
// =============================================================================================

// Estado A: selector y tabla consumen exclusivamente props productivas; el inicio conserva el
// callback y el estado busy existentes.
assert.match(files.start, /<select value=\{day\} onChange=\{\(event\) => switchDay\(event\.target\.value\)\}>/);
assert.match(files.start, /\{routineDays\.map\(\(item\) => \(/);
assert.match(files.start, /\{exercises\.map\(\(exercise\) => \(/);
for (const field of ["exercise.name", "exercise.targetSets", "exercise.targetReps", "exercise.baseWeight"]) {
  assert.match(files.start, new RegExp(field.replace(".", "\\.")), `la tabla inicial debe leer ${field}`);
}
assert.match(files.start, /role="table"/);
assert.equal((files.start.match(/role="columnheader"/g) ?? []).length, 4);
assert.match(files.start, /onClick=\{startTraining\}/);
assert.match(files.start, /disabled=\{isStartingTraining\}/);
assert.match(files.start, /aria-busy=\{isStartingTraining\}/);

// Estado B: selector, lista de botones y estado activo conservan callbacks/identidad reales sin
// simular un grid ARIA incompleto.
assert.match(files.guided, /<select value=\{day\} onChange=\{\(event\) => switchDay\(event\.target\.value\)\}>/);
assert.match(files.guided, /role="group"/);
assert.match(files.guided, /\{exercises\.map\(\(exercise, index\) => \{/);
assert.doesNotMatch(files.guided, /role="grid"|role="row"|role="rowgroup"|role="gridcell"/);
assert.match(files.guided, /aria-pressed=\{isActive\}/);
assert.match(files.guided, /onClick=\{\(\) => setActiveIndex\(index\)\}/);
assert.match(files.workoutStyles, /\.selectableTableRow\[aria-pressed="true"\]/);
assert.match(files.workoutStyles, /\.selectableTableRow:focus-visible/);

// Drafts/inputs: cantidad de series deriva de targetSets mediante el normalizador canonico; el
// JSX mapea ese draft, admite decimales y rechaza negativos/invalidos con parsers productivos.
assert.match(files.exerciseDraft, /Array\.from\(\{ length: exercise\.targetSets \}/);
assert.match(files.guided, /const draft = activeExercise \? normalizeExerciseDraft\(activeExercise, drafts\[activeExercise\.id\]\) : null;/);
assert.match(files.guided, /\{draft\.reps\.map\(\(reps, index\) => \(/);
assert.match(files.guided, /inputMode="decimal"/);
assert.match(files.guided, /isDecimalWeightDraftInput\(value\)/);
assert.match(files.guided, /parseDecimalWeightInput\(value\) \?\? ""/);
assert.equal(isDecimalWeightDraftInput("5,"), true, "5, se conserva como draft decimal intermedio");
assert.equal(isDecimalWeightDraftInput("5."), true, "5. se conserva como draft decimal intermedio");
assert.equal(parseDecimalWeightInput("5,"), null, "el registro final sigue rechazando un decimal incompleto");
assert.match(files.guided, /min=\{0\}/);
assert.match(files.guided, /step=\{1\}/);

// Historial y observacion: mantiene found/loading/empty/error de las presentaciones, acordeones
// nativos, historial anterior, textarea controlada y borrador por ejercicio.
assert.match(files.guided, /buildExerciseLastPerformancePresentation\(\{/);
assert.match(files.guided, /latest: latestExercisePerformance/);
assert.match(files.guided, /loading: latestExercisePerformanceLoading/);
assert.match(files.guided, /error: latestExercisePerformanceError/);
assert.match(files.performancePanel, /presentation\.status === "found"\s*\? presentation\.seriesDetailTitle\s*: presentation\.lastSummaryText/);
assert.match(files.performancePanel, /presentation\.seriesRows\.length > 0/);
assert.match(files.performancePanel, /presentation\.status === "loading"/);
assert.match(files.performancePanel, /presentation\.status === "error" \? "alert" : "status"/);
assert.match(files.performancePanel, /observationPresentation\.status === "loading"/);
assert.match(files.performancePanel, /observationPresentation\.status === "error" \? "alert" : "status"/);
assert.match(files.performancePanel, /value=\{observationValue\}/);
assert.match(files.guided, /onObservationChange=\{\(value\) => updateDraft\(activeExercise, \{ observation: value \}\)\}/);

// Objetivos: SeriesResult solo presenta calculos canonicos de reps/peso/series. Los tonos de
// alcanzado/superado son verdes y el pendiente es rojo; el detalle canonico queda visible.
for (const metric of [
  "totalReps: entry.totalReps",
  "targetTotalReps: entry.targetTotalReps",
  "completedSets: entry.completedSets",
  "targetSets: entry.targetSets",
  "actualWeight: entry.weight",
  "targetWeight: entry.previousWeight",
]) {
  assert.match(files.seriesResult, new RegExp(metric.replaceAll(".", "\\.")));
}
assert.match(files.seriesResult, /\{result\.headline\}/);
assert.match(files.seriesResult, /\{result\.message\}/);
assert.match(files.seriesResult, /\{item\.detail\}/);
assert.match(files.seriesResult, /item\.tone === "partial" \? styles\.pendingGoal : styles\.reachedGoal/);
assert.match(files.seriesResult, /item\.tone === "partial" \? <X size=\{20\} \/> : <Check size=\{20\} \/>/);
assert.match(files.workoutStyles, /--workout-goal-success: color-mix\([^;]+var\(--green\)[^;]+\);/);
assert.match(files.workoutStyles, /--workout-goal-pending: var\(--red\);/);
assert.match(files.workoutStyles, /border: 1px solid var\(--primary\);/);

// Registro/finalizacion: se conservan las tres ramas productivas sin introducir writes.
assert.match(files.guided, /!allRegistered && !activeExerciseAlreadyRegistered/);
assert.match(files.guided, /onClick=\{registerExercise\}/);
assert.match(files.guided, /Ejercicio ya registrado/);
assert.match(files.guided, /onClick=\{saveCompletedTraining\}/);
assert.match(files.guided, /disabled=\{isBusy\}/);
assert.match(files.guided, /isExerciseRegisteredInCurrentWorkout/);

// Encapsulacion visual/responsive: consume el token global aprobado, evita scroll horizontal
// propio y declara adaptaciones para movil pequeño, desktop y reduced motion.
assert.match(globalStyles, /--background:\s*#07101a;/i);
assert.match(files.workoutStyles, /background: var\(--background\);/);
assert.doesNotMatch(files.workoutStyles, /#07101a/i);
assert.doesNotMatch(files.workoutStyles, /overflow-x:\s*(?:auto|scroll)/);
assert.match(files.workoutStyles, /@media \(max-width: 360px\)/);
assert.match(files.workoutStyles, /@media \(min-width: 800px\)/);
assert.match(files.workoutStyles, /@media \(prefers-reduced-motion: reduce\)/);

// No se agregan hooks, repositories, requests, storage ni writes desde presentacion.
for (const source of [files.start, files.guided, files.performancePanel, files.seriesResult]) {
  assert.doesNotMatch(source, /\buseState\b|\buseEffect\b|\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b/);
  assert.doesNotMatch(source, /-repository"|@\/lib\/(?:data|supabase|storage)\//);
}

interface TrainUi01AuditSources {
  start: string;
  guided: string;
  performancePanel: string;
  seriesResult: string;
  workoutStyles: string;
  metricGrid: string;
  workoutRegistration: string;
  trainingDayOrder: string;
  globalStyles: string;
}

function readCssRule(source: string, selector: string) {
  const marker = `${selector} {`;
  const selectorIndex = source.indexOf(marker);
  assert.ok(selectorIndex >= 0, `falta la regla CSS exacta ${selector}`);
  const openingBraceIndex = source.indexOf("{", selectorIndex + selector.length);
  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) {
      return {
        body: source.slice(openingBraceIndex + 1, index),
        end: index + 1,
        start: selectorIndex,
      };
    }
  }

  assert.fail(`regla CSS sin cierre para ${selector}`);
}

function readCssProperty(ruleBody: string, property: string) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = ruleBody.match(new RegExp(`(?:^|\\n)\\s*${escapedProperty}:\\s*([^;]+);`));
  assert.ok(match, `falta ${property} en la regla CSS auditada`);
  return match[1].trim();
}

interface CssDeclaration {
  property: string;
  value: string;
  important: boolean;
  declarationOrder: number;
}

interface CssExecutableRule {
  selectors: string[];
  declarations: CssDeclaration[];
  minWidth: number;
  maxWidth: number;
  order: number;
}

interface CssAuditElement {
  tag?: string;
  classes?: readonly string[];
  attributes?: Readonly<Record<string, string>>;
  states?: readonly string[];
  pseudoElement?: string;
}

interface CssAuditTarget extends CssAuditElement {
  label: string;
  ancestors?: readonly CssAuditElement[];
}

function stripExecutableCssComments(source: string) {
  let result = "";
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      result += character;
      if (character === "\\") {
        result += next ?? "";
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }

    if (character === "/" && next === "*") {
      const closing = source.indexOf("*/", index + 2);
      assert.ok(closing >= 0, "CSS inválido: comentario sin cierre");
      result += " ".repeat(closing + 2 - index);
      index = closing + 1;
      continue;
    }

    result += character;
  }

  assert.equal(quote, "", "CSS inválido: string sin cierre");
  return result;
}

function findCssTokenOutsideGroups(source: string, start: number, expected: string) {
  let quote = "";
  let parentheses = 0;
  let brackets = 0;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === expected && parentheses === 0 && brackets === 0) return index;
  }

  return -1;
}

function findCssClosingBrace(source: string, openingBraceIndex: number) {
  let quote = "";
  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  assert.fail("CSS inválido: bloque sin cierre");
}

function splitCssOutsideGroups(source: string, delimiter: string) {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  let brackets = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === delimiter && parentheses === 0 && brackets === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function parseCssDeclarations(body: string) {
  return splitCssOutsideGroups(body, ";")
    .map((rawDeclaration) => rawDeclaration.trim())
    .filter(Boolean)
    .map((rawDeclaration, declarationOrder): CssDeclaration => {
      const colonIndex = findCssTokenOutsideGroups(rawDeclaration, 0, ":");
      assert.ok(colonIndex > 0, `CSS inválido: declaración sin dos puntos (${rawDeclaration})`);
      const property = rawDeclaration.slice(0, colonIndex).trim().toLowerCase();
      const rawValue = rawDeclaration.slice(colonIndex + 1).trim();
      assert.match(property, /^--[a-z0-9-]+$|^-?[a-z][a-z0-9-]*$/i, `CSS inválido: propiedad ${property}`);
      assert.ok(rawValue, `CSS inválido: ${property} sin valor`);
      const important = /\s*!important\s*$/i.test(rawValue);
      const value = rawValue.replace(/\s*!important\s*$/i, "").trim();
      return { property, value, important, declarationOrder };
    });
}

function parseExecutableCss(source: string) {
  const executableSource = stripExecutableCssComments(source);
  const rules: CssExecutableRule[] = [];
  let order = 0;

  const visit = (block: string, inheritedMinWidth: number, inheritedMaxWidth: number) => {
    let cursor = 0;
    while (cursor < block.length) {
      const openingBraceIndex = findCssTokenOutsideGroups(block, cursor, "{");
      if (openingBraceIndex < 0) {
        assert.equal(block.slice(cursor).trim(), "", "CSS inválido: contenido fuera de una regla");
        break;
      }
      const prelude = block.slice(cursor, openingBraceIndex).trim();
      assert.ok(prelude, "CSS inválido: regla sin selector");
      const closingBraceIndex = findCssClosingBrace(block, openingBraceIndex);
      const body = block.slice(openingBraceIndex + 1, closingBraceIndex);

      if (/^@media\b/i.test(prelude)) {
        const minMatch = prelude.match(/min-width\s*:\s*(\d+(?:\.\d+)?)px/i);
        const maxMatch = prelude.match(/max-width\s*:\s*(\d+(?:\.\d+)?)px/i);
        const minWidth = Math.max(inheritedMinWidth, minMatch ? Number(minMatch[1]) : 0);
        const maxWidth = Math.min(inheritedMaxWidth, maxMatch ? Number(maxMatch[1]) : Number.POSITIVE_INFINITY);
        assert.ok(minWidth <= maxWidth, `CSS inválido: media query imposible (${prelude})`);
        visit(body, minWidth, maxWidth);
      } else if (!prelude.startsWith("@")) {
        const selectors = splitCssOutsideGroups(prelude, ",").map((selector) => selector.trim());
        assert.ok(selectors.every(Boolean), `CSS inválido: selector vacío (${prelude})`);
        rules.push({
          selectors,
          declarations: parseCssDeclarations(body),
          minWidth: inheritedMinWidth,
          maxWidth: inheritedMaxWidth,
          order,
        });
        order += 1;
      }

      cursor = closingBraceIndex + 1;
    }
  };

  visit(executableSource, 0, Number.POSITIVE_INFINITY);
  return rules;
}

function normalizeCssModulesSelector(selector: string) {
  let normalized = selector;
  let previous = "";
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(/:global\(([^()]*)\)/g, "$1");
  }
  return normalized;
}

function splitSelectorCompounds(selector: string) {
  const normalized = normalizeCssModulesSelector(selector);
  const compounds: string[] = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  let brackets = 0;

  const push = (end: number) => {
    const compound = normalized.slice(start, end).trim();
    if (compound) compounds.push(compound);
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (parentheses === 0 && brackets === 0 && (character === ">" || character === "+" || character === "~" || /\s/.test(character))) {
      push(index);
      while (index + 1 < normalized.length && /\s/.test(normalized[index + 1])) index += 1;
      start = index + 1;
    }
  }
  push(normalized.length);
  return compounds;
}

function compoundMatchesElement(compoundInput: string, element: CssAuditElement) {
  let compound = compoundInput;
  for (const match of [...compound.matchAll(/:not\(([^()]*)\)/g)]) {
    if (compoundMatchesElement(match[1], element)) return false;
  }
  compound = compound.replace(/:not\(([^()]*)\)/g, "");

  const pseudoElement = compound.match(/::([a-z-]+)/i)?.[1];
  if ((pseudoElement ?? "") !== (element.pseudoElement ?? "")) return false;
  compound = compound.replace(/::[a-z-]+/gi, "");

  const states = new Set(element.states ?? []);
  const requiredStates = [...compound.matchAll(/:(hover|focus-visible|focus|active|disabled|checked|open|visited|target)\b/gi)]
    .map((match) => match[1].toLowerCase());
  if (requiredStates.some((state) => !states.has(state))) return false;
  compound = compound.replace(/:(hover|focus-visible|focus|active|disabled|checked|open|visited|target)\b/gi, "");

  const classes = new Set(element.classes ?? []);
  for (const match of compound.matchAll(/\.([_a-z][\w-]*)/gi)) {
    if (!classes.has(match[1])) return false;
  }

  const attributes = element.attributes ?? {};
  for (const match of compound.matchAll(/\[([\w-]+)(?:\s*=\s*["']?([^"'\]]+)["']?)?\]/g)) {
    const [, name, expectedValue] = match;
    if (!(name in attributes)) return false;
    if (expectedValue !== undefined && attributes[name] !== expectedValue.trim()) return false;
  }

  const withoutTokens = compound
    .replace(/#[\w-]+/g, "")
    .replace(/\.[\w-]+/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/:[\w-]+(?:\([^)]*\))?/g, "")
    .trim();
  if (withoutTokens && withoutTokens !== "*" && withoutTokens.toLowerCase() !== element.tag?.toLowerCase()) {
    return false;
  }

  return true;
}

function selectorMatchesTarget(selector: string, target: CssAuditTarget) {
  if (/:has\(/.test(selector)) return false;
  const compounds = splitSelectorCompounds(selector);
  if (compounds.length === 0 || !compoundMatchesElement(compounds.at(-1)!, target)) return false;

  const ancestors = target.ancestors ?? [];
  let ancestorIndex = 0;
  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    let matched = false;
    while (ancestorIndex < ancestors.length) {
      if (compoundMatchesElement(compounds[index], ancestors[ancestorIndex])) {
        matched = true;
        ancestorIndex += 1;
        break;
      }
      ancestorIndex += 1;
    }
    if (!matched) return false;
  }
  return true;
}

function cssSpecificity(selector: string) {
  const normalized = normalizeCssModulesSelector(selector);
  const specificitySource = normalized.replace(/:where\([^)]*\)/g, "");
  const ids = (specificitySource.match(/#[\w-]+/g) ?? []).length;
  const classes = (specificitySource.match(/\.[\w-]+/g) ?? []).length;
  const attributes = (specificitySource.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudoElements = (specificitySource.match(/::[\w-]+/g) ?? []).length;
  const withoutPseudoElements = specificitySource.replace(/::[\w-]+/g, "");
  const pseudoClasses = (withoutPseudoElements.match(/:(?!:|global\b)[\w-]+/g) ?? [])
    .filter((pseudoClass) => !/^:(?:not|is|where|has)$/.test(pseudoClass))
    .length;
  const types = splitSelectorCompounds(specificitySource).filter((compound) => (
    /^[a-z][\w-]*/i.test(compound) && !/^:/.test(compound)
  )).length;
  return [ids, classes + attributes + pseudoClasses, types + pseudoElements] as const;
}

function compareSpecificity(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function resolveDeclarationValue(declaration: CssDeclaration, property: string) {
  if (declaration.property === property) return declaration.value;
  if (property === "background-color" && declaration.property === "background") {
    return declaration.value;
  }
  if (property === "background-image" && declaration.property === "background") {
    return /(?:gradient|url|image-set)\s*\(/i.test(declaration.value) ? declaration.value : "none";
  }
  if (property === "overflow-x" && declaration.property === "overflow") return declaration.value;
  if (/^margin-(?:top|right|bottom|left)$/.test(property) && declaration.property === "margin") {
    const tokens = splitCssValueTokens(declaration.value);
    if (tokens.length === 1) return tokens[0];
    const side = property.slice("margin-".length);
    if (tokens.length === 2) return side === "top" || side === "bottom" ? tokens[0] : tokens[1];
    if (tokens.length === 3) {
      if (side === "top") return tokens[0];
      if (side === "bottom") return tokens[2];
      return tokens[1];
    }
    return tokens[{ top: 0, right: 1, bottom: 2, left: 3 }[side as "top" | "right" | "bottom" | "left"]];
  }
  if (
    (property === "margin-left" || property === "margin-right") &&
    declaration.property === "margin-inline"
  ) {
    const tokens = splitCssValueTokens(declaration.value);
    return property === "margin-left" ? tokens[0] : (tokens[1] ?? tokens[0]);
  }
  if (/^padding-(?:top|right|bottom|left)$/.test(property) && declaration.property === "padding") {
    const tokens = splitCssValueTokens(declaration.value);
    if (tokens.length === 1) return tokens[0];
    const side = property.slice("padding-".length);
    if (tokens.length === 2) return side === "top" || side === "bottom" ? tokens[0] : tokens[1];
    if (tokens.length === 3) {
      if (side === "top") return tokens[0];
      if (side === "bottom") return tokens[2];
      return tokens[1];
    }
    return tokens[{ top: 0, right: 1, bottom: 2, left: 3 }[side as "top" | "right" | "bottom" | "left"]];
  }
  if (
    (property === "padding-left" || property === "padding-right") &&
    declaration.property === "padding-inline"
  ) {
    const tokens = splitCssValueTokens(declaration.value);
    return property === "padding-left" ? tokens[0] : (tokens[1] ?? tokens[0]);
  }
  if (
    (property === "border-left-width" || property === "border-right-width") &&
    declaration.property === "border"
  ) {
    return splitCssValueTokens(declaration.value)[0] ?? null;
  }
  return null;
}

function readEffectiveCssProperty(input: {
  rules: readonly CssExecutableRule[];
  target: CssAuditTarget;
  property: string;
  viewportWidth: number;
  required?: boolean;
}) {
  let winner: {
    value: string;
    important: boolean;
    specificity: readonly number[];
    order: number;
  } | null = null;

  for (const rule of input.rules) {
    if (input.viewportWidth < rule.minWidth || input.viewportWidth > rule.maxWidth) continue;
    for (const selector of rule.selectors) {
      if (!selectorMatchesTarget(selector, input.target)) continue;
      const specificity = cssSpecificity(selector);
      for (const declaration of rule.declarations) {
        const value = resolveDeclarationValue(declaration, input.property);
        if (value === null) continue;
        const order = (rule.order * 1000) + declaration.declarationOrder;
        const wins = !winner ||
          Number(declaration.important) > Number(winner.important) ||
          (
            declaration.important === winner.important &&
            (
              compareSpecificity(specificity, winner.specificity) > 0 ||
              (compareSpecificity(specificity, winner.specificity) === 0 && order > winner.order)
            )
          );
        if (wins) winner = { value, important: declaration.important, specificity, order };
      }
    }
  }

  if (!winner) {
    assert.equal(
      input.required,
      false,
      `${input.target.label}: falta ${input.property} efectivo a ${input.viewportWidth}px`,
    );
    return null;
  }
  return winner.value;
}

function readHexToken(styles: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escapedToken}:\\s*(#[0-9a-f]{6});`, "i"));
  assert.ok(match, `falta el token hexadecimal ${token}`);
  return match[1];
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g);
  assert.ok(channels && channels.length === 3, `color hexadecimal inválido: ${hex}`);
  const [red, green, blue] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertAccessibleSmallTextContrast(input: {
  globalStyles: string;
  ruleBody: string;
  label: string;
}) {
  const foregroundValue = readCssProperty(input.ruleBody, "color");
  const backgroundValue = readCssProperty(input.ruleBody, "background");
  const foregroundToken = foregroundValue.match(/^var\((--[a-z-]+)\)$/)?.[1];
  const backgroundToken = backgroundValue.match(/^var\((--[a-z-]+)\)$/)?.[1];
  assert.ok(foregroundToken, `${input.label}: el foreground debe usar un token global directo`);
  assert.ok(backgroundToken, `${input.label}: el background debe usar un token global directo`);
  const ratio = contrastRatio(
    readHexToken(input.globalStyles, foregroundToken),
    readHexToken(input.globalStyles, backgroundToken),
  );
  assert.ok(ratio >= 4.5, `${input.label}: contraste ${ratio.toFixed(2)} menor que WCAG AA 4.5:1`);
}

function assertMobileFontAtLeast16Px(ruleBody: string, label: string) {
  const fontSize = readCssProperty(ruleBody, "font-size");
  const match = fontSize.match(/^(\d*\.?\d+)(px|rem)$/);
  assert.ok(match, `${label}: font-size móvil debe expresarse en px o rem`);
  const sizeInPixels = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
  assert.ok(sizeInPixels >= 16, `${label}: ${sizeInPixels}px provoca autozoom en iOS`);
}

const mobileAuditWidths = [320, 360, 361, 375, 390, 393, 400, 401, 430] as const;

const cssAuditTargets = {
  body: { label: "viewport", tag: "body" },
  shell: { label: "app shell", classes: ["app-shell"] },
  topbar: { label: "topbar", classes: ["topbar"], ancestors: [{ classes: ["app-shell"] }] },
  backRow: { label: "zona Back", classes: ["section-back-row"], ancestors: [{ classes: ["app-shell"] }] },
  screen: { label: "canvas TRAIN-UI-01", classes: ["screen"] },
  startCard: {
    label: "tarjeta inicial",
    tag: "article",
    classes: ["workoutCard", "card", "wide", "training-start-card"],
    ancestors: [{ classes: ["screen"] }],
  },
  guidedCard: {
    label: "tarjeta guiada",
    tag: "article",
    classes: ["workoutCard", "card", "wide", "routine-summary-card", "mobile-series-card"],
    ancestors: [{ classes: ["screen"] }],
  },
  referencePanel: {
    label: "panel de referencia",
    tag: "div",
    classes: ["referencePanel", "exercise-reference-card"],
    ancestors: [{ classes: ["workoutCard", "card"] }, { classes: ["screen"] }],
  },
  startHeading: {
    label: "título inicial",
    tag: "h2",
    ancestors: [{ classes: ["startIntro"] }, { classes: ["screen"] }],
  },
  routineHeading: {
    label: "título de rutina",
    tag: "h2",
    ancestors: [{ classes: ["routineTitle"] }, { classes: ["routineHeader"] }, { classes: ["workoutCard", "card"] }],
  },
  routineSubheading: {
    label: "subtítulo de rutina",
    tag: "p",
    ancestors: [{ classes: ["routineTitle"] }, { classes: ["routineHeader"] }, { classes: ["workoutCard", "card"] }],
  },
  sectionHeading: {
    label: "título de sección",
    tag: "h3",
    ancestors: [{ classes: ["sectionHeading"] }, { classes: ["planSection"] }, { classes: ["workoutCard", "card"] }],
  },
  newRecordHeading: {
    label: "título de nuevo registro",
    tag: "h3",
    ancestors: [{ classes: ["newRecord"] }, { classes: ["workoutCard", "card"] }],
  },
  objectivesHeading: {
    label: "título de objetivos",
    tag: "h3",
    ancestors: [{ classes: ["objectives"] }, { classes: ["workoutCard", "card"] }],
  },
  routineHeader: {
    label: "cabecera de rutina",
    classes: ["routineHeader"],
    ancestors: [{ classes: ["workoutCard", "card"] }],
  },
  routineTitle: {
    label: "contenedor del título de rutina",
    classes: ["routineTitle"],
    ancestors: [{ classes: ["routineHeader"] }, { classes: ["workoutCard", "card"] }],
  },
  routineControls: {
    label: "controles de rutina",
    classes: ["routineControls"],
    ancestors: [{ classes: ["routineHeader"] }, { classes: ["workoutCard", "card"] }],
  },
  daySelector: {
    label: "wrapper táctil del selector de día",
    tag: "label",
    classes: ["daySelector"],
    ancestors: [{ classes: ["routineControls"] }, { classes: ["routineHeader"] }],
  },
  daySelect: {
    label: "selector de día",
    tag: "select",
    ancestors: [{ tag: "label", classes: ["daySelector"] }, { classes: ["routineControls"] }],
  },
  editButton: {
    label: "botón Editar",
    tag: "button",
    classes: ["editRoutineButton", "icon-button"],
    ancestors: [{ classes: ["routineControls"] }, { classes: ["routineHeader"] }],
  },
  editButtonBefore: {
    label: "caja visual del botón Editar",
    tag: "button",
    classes: ["editRoutineButton", "icon-button"],
    pseudoElement: "before",
    ancestors: [{ classes: ["routineControls"] }, { classes: ["routineHeader"] }],
  },
  editButtonIcon: {
    label: "ícono del botón Editar",
    tag: "svg",
    ancestors: [
      { tag: "button", classes: ["editRoutineButton", "icon-button"] },
      { classes: ["routineControls"] },
    ],
  },
  exerciseTable: {
    label: "tabla de ejercicios",
    classes: ["exerciseTable"],
    ancestors: [{ classes: ["planSection"] }, { classes: ["workoutCard", "card"] }],
  },
  tableRow: {
    label: "fila de ejercicios",
    classes: ["tableRow"],
    ancestors: [{ classes: ["exerciseTable"] }, { classes: ["planSection"] }],
  },
  selectableRow: {
    label: "fila seleccionable",
    tag: "button",
    classes: ["selectableTableRow"],
    attributes: { "aria-pressed": "true" },
    ancestors: [{ classes: ["exerciseRows"] }, { classes: ["exerciseTable"] }],
  },
  tableCell: {
    label: "celda de ejercicios",
    tag: "span",
    ancestors: [{ classes: ["tableRow"] }, { classes: ["exerciseTable"] }],
  },
  disclosureContent: {
    label: "contenido desplegable",
    classes: ["disclosureContent"],
    ancestors: [{ classes: ["referencePanel", "exercise-reference-card"] }],
  },
  seriesDetailList: {
    label: "detalle de series",
    tag: "div",
    classes: ["exercise-series-detail-list"],
    ancestors: [{ classes: ["disclosureContent"] }, { classes: ["referencePanel"] }],
  },
  loadingHistory: {
    label: "estado loading del historial",
    tag: "div",
    classes: ["loadingState"],
    ancestors: [{ classes: ["disclosureContent"] }, { classes: ["referencePanel"] }],
  },
  historyStatus: {
    label: "estado textual del historial",
    tag: "p",
    classes: ["historyStatus"],
    ancestors: [{ classes: ["disclosureContent"] }, { classes: ["referencePanel"] }],
  },
  todayGoal: {
    label: "objetivo de hoy",
    tag: "p",
    classes: ["todayGoal"],
    ancestors: [{ classes: ["disclosureContent"] }, { classes: ["referencePanel"] }],
  },
} satisfies Record<string, CssAuditTarget>;

function assertProtectedFileIntegrity(sources: ProtectedFileSources) {
  for (const [path, expectedHash] of Object.entries(protectedFileHashes) as Array<[
    ProtectedFilePath,
    string,
  ]>) {
    assert.equal(
      sha256(sources[path]),
      expectedHash,
      `integridad byte a byte: cambió el archivo protegido ${path}`,
    );
  }
}

function readTypeScriptParseDiagnostics(sourceFile: ts.SourceFile) {
  return (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
}

function assertValidTypeScriptMutation(source: string, fileName: string, scriptKind: ts.ScriptKind) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  assert.equal(
    readTypeScriptParseDiagnostics(sourceFile).length,
    0,
    `${fileName}: el probe debe conservar sintaxis TypeScript válida`,
  );
}

function readJsxStylesClassName(node: ts.JsxElement, className: string) {
  const attribute = node.openingElement.attributes.properties.find((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && property.name.getText() === "className"
  ));
  if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer)) return false;
  const expression = attribute.initializer.expression;
  return Boolean(
    expression &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "styles" &&
    expression.name.text === className
  );
}

const approvedRoutineHeaderDays = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

const approvedRoutineTextPixels = 15;
const approvedDaySelectPixels = 92;
const approvedDaySelectUsefulInlinePixels = 76;
// Roboto Mono avanza nominalmente ~0.60em. El contrato usa 0.64em y redondea hacia arriba para
// absorber rasterización/subpíxeles sin fingir una medición de navegador.
const conservativeMonospaceAdvanceEm = 0.64;
const nominalMonospaceAdvanceEm = 0.6;

interface RoutineHeaderGeometryResult {
  viewportWidth: number;
  layout: "stacked" | "side-by-side";
  headerInlineWidth: number;
  titleTrackWidth: number;
  controlsWidth: number;
  headingFontSize: number;
  headingLetterSpacing: number;
  criticalDay: string;
  criticalTextWidth: number;
  minimumSlack: number;
}

function unwrapTypeScriptExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapTypeScriptExpression(expression.expression);
  }
  return expression;
}

function readTrainingDayLabels(source: string) {
  const sourceFile = ts.createSourceFile(
    "training-day-order.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(
    readTypeScriptParseDiagnostics(sourceFile).length,
    0,
    "copy geométrico: training-day-order debe conservar sintaxis válida",
  );
  let initializer: ts.Expression | null = null;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "TRAINING_DAY_LABELS" &&
      node.initializer
    ) {
      assert.equal(initializer, null, "copy geométrico: TRAINING_DAY_LABELS debe declararse una vez");
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(initializer, "copy geométrico: falta TRAINING_DAY_LABELS canónico");
  const unwrapped = unwrapTypeScriptExpression(initializer);
  assert.ok(ts.isArrayLiteralExpression(unwrapped), "copy geométrico: TRAINING_DAY_LABELS debe ser un array literal");
  const labels = unwrapped.elements.map((element) => {
    assert.ok(ts.isStringLiteral(element), "copy geométrico: cada día debe ser un string literal");
    return element.text;
  });
  assert.deepEqual(
    labels,
    approvedRoutineHeaderDays,
    "copy geométrico: no se permite abreviar ni alterar los días admitidos",
  );
  return labels;
}

function readRoutineHeaderCopyAndAssertDom(source: string, fileName: string) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(
    readTypeScriptParseDiagnostics(sourceFile).length,
    0,
    `geometría del header: ${fileName} debe conservar sintaxis TSX válida`,
  );
  const headers: ts.JsxElement[] = [];
  const collect = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === "header" &&
      readJsxStylesClassName(node, "routineHeader")
    ) {
      headers.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  assert.equal(headers.length, 1, `geometría del header: ${fileName} debe tener un routineHeader ejecutable`);
  const children = headers[0].children.filter((child) => !ts.isJsxText(child) || child.text.trim().length > 0);
  assert.equal(children.length, 2, `orden semántico: ${fileName} debe conservar título y controles directos`);
  assert.ok(
    ts.isJsxElement(children[0]) && readJsxStylesClassName(children[0], "routineTitle"),
    `orden semántico: ${fileName} debe mantener el título antes de los controles`,
  );
  assert.ok(
    ts.isJsxElement(children[1]) && readJsxStylesClassName(children[1], "routineControls"),
    `orden semántico: ${fileName} debe mantener los controles como segundo hijo`,
  );

  const heading = children[0].children.find((child): child is ts.JsxElement => (
    ts.isJsxElement(child) && /h[23]/.test(child.openingElement.tagName.getText())
  ));
  assert.ok(heading, `copy geométrico: ${fileName} debe conservar el heading de rutina`);
  const headingChildren = heading.children.filter((child) => !ts.isJsxText(child) || child.text.length > 0);
  assert.equal(headingChildren.length, 2, `copy geométrico: ${fileName} debe componer prefijo y day sin sustitutos`);
  assert.ok(ts.isJsxText(headingChildren[0]), `copy geométrico: ${fileName} debe conservar el prefijo literal`);
  assert.ok(
    ts.isJsxExpression(headingChildren[1]) &&
    headingChildren[1].expression &&
    ts.isIdentifier(headingChildren[1].expression) &&
    headingChildren[1].expression.text === "day",
    `copy geométrico: ${fileName} debe conservar el día completo`,
  );
  assert.equal(
    headingChildren[0].text,
    "Rutina registrada ",
    `copy geométrico: ${fileName} no puede abreviar el título`,
  );
  return headingChildren[0].text;
}

function evaluateCssLength(valueInput: string, viewportWidth: number, percentageBase: number): number {
  const value = valueInput.trim();
  const numeric = value.match(/^(-?\d*\.?\d+)(px|rem|vw|%)$/i);
  if (numeric) {
    const amount = Number(numeric[1]);
    if (numeric[2] === "px") return amount;
    if (numeric[2] === "rem") return amount * 16;
    if (numeric[2] === "vw") return (amount / 100) * viewportWidth;
    return (amount / 100) * percentageBase;
  }
  for (const functionName of ["min", "max", "clamp"] as const) {
    const prefix = `${functionName}(`;
    if (!value.startsWith(prefix) || !value.endsWith(")")) continue;
    const parts = splitCssOutsideGroups(value.slice(prefix.length, -1), ",")
      .map((part) => evaluateCssLength(part, viewportWidth, percentageBase));
    if (functionName === "min") return Math.min(...parts);
    if (functionName === "max") return Math.max(...parts);
    assert.equal(parts.length, 3, `geometría del header: clamp inválido ${value}`);
    return Math.max(parts[0], Math.min(parts[1], parts[2]));
  }
  assert.fail(`geometría del header: longitud CSS no soportada ${value}`);
}

function readEffectiveLength(input: {
  rules: readonly CssExecutableRule[];
  target: CssAuditTarget;
  property: string;
  viewportWidth: number;
  percentageBase: number;
}) {
  const value = readEffectiveCssProperty(input);
  assert.ok(value !== null);
  return evaluateCssLength(value, input.viewportWidth, input.percentageBase);
}

function readEffectiveLetterSpacing(input: {
  rules: readonly CssExecutableRule[];
  target: CssAuditTarget;
  viewportWidth: number;
  percentageBase: number;
}) {
  const value = readEffectiveCssProperty({
    ...input,
    property: "letter-spacing",
    required: false,
  });
  return value === null || value === "normal"
    ? 0
    : evaluateCssLength(value, input.viewportWidth, input.percentageBase);
}

function assertRoutineHeaderGeometry(
  sources: TrainUi01AuditSources,
  rules: readonly CssExecutableRule[],
) {
  const days = readTrainingDayLabels(sources.trainingDayOrder);
  const startPrefix = readRoutineHeaderCopyAndAssertDom(sources.start, "TrainingStartScreen.tsx");
  const guidedPrefix = readRoutineHeaderCopyAndAssertDom(sources.guided, "GuidedTrainingScreen.tsx");
  assert.equal(startPrefix, guidedPrefix, "copy geométrico: inicio y entrenamiento deben usar el mismo título");
  const headingTargets = [
    cssAuditTargets.routineHeading,
    { ...cssAuditTargets.routineHeading, label: "título de rutina h3", tag: "h3" },
  ];
  const results: RoutineHeaderGeometryResult[] = [];

  for (const viewportWidth of mobileAuditWidths) {
    const shellWidth = readEffectiveLength({
      rules,
      target: cssAuditTargets.shell,
      property: "width",
      viewportWidth,
      percentageBase: viewportWidth,
    });
    const shellPaddingLeft = readEffectiveLength({
      rules,
      target: cssAuditTargets.shell,
      property: "padding-left",
      viewportWidth,
      percentageBase: shellWidth,
    });
    const shellPaddingRight = readEffectiveLength({
      rules,
      target: cssAuditTargets.shell,
      property: "padding-right",
      viewportWidth,
      percentageBase: shellWidth,
    });
    const cardOuterWidth = shellWidth - shellPaddingLeft - shellPaddingRight;
    assertEffectiveCssValue({
      rules,
      target: cssAuditTargets.startCard,
      property: "width",
      expected: "100%",
      viewportWidth,
      message: "geometría del header: la tarjeta debe ocupar el ancho reducible del screen",
    });
    assertEffectiveCssValue({
      rules,
      target: cssAuditTargets.startCard,
      property: "box-sizing",
      expected: "border-box",
      viewportWidth,
      message: "geometría del header: padding y border deben permanecer dentro de la tarjeta",
    });
    const cardPaddingLeft = readEffectiveLength({
      rules,
      target: cssAuditTargets.startCard,
      property: "padding-left",
      viewportWidth,
      percentageBase: cardOuterWidth,
    });
    const cardPaddingRight = readEffectiveLength({
      rules,
      target: cssAuditTargets.startCard,
      property: "padding-right",
      viewportWidth,
      percentageBase: cardOuterWidth,
    });
    const cardBorderLeft = readEffectiveLength({
      rules,
      target: cssAuditTargets.startCard,
      property: "border-left-width",
      viewportWidth,
      percentageBase: cardOuterWidth,
    });
    const cardBorderRight = readEffectiveLength({
      rules,
      target: cssAuditTargets.startCard,
      property: "border-right-width",
      viewportWidth,
      percentageBase: cardOuterWidth,
    });
    const headerInlineWidth = cardOuterWidth - cardPaddingLeft - cardPaddingRight - cardBorderLeft - cardBorderRight;

    const headerColumns = readEffectiveCssProperty({
      rules,
      target: cssAuditTargets.routineHeader,
      property: "grid-template-columns",
      viewportWidth,
    });
    assert.ok(headerColumns !== null);
    const layout = headerColumns === "minmax(0, 1fr)" ? "stacked" : "side-by-side";
    const shouldStack = viewportWidth <= 400;
    assert.equal(
      layout === "stacked",
      shouldStack,
      `breakpoint adaptativo: ${viewportWidth}px debe usar layout ${shouldStack ? "apilado" : "lado a lado"} con corte real en 400px`,
    );
    const selectorWidth = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "width",
      viewportWidth,
      percentageBase: headerInlineWidth,
    });
    const selectorPaddingLeft = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "padding-left",
      viewportWidth,
      percentageBase: selectorWidth,
    });
    const selectorPaddingRight = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "padding-right",
      viewportWidth,
      percentageBase: selectorWidth,
    });
    const selectorBorderLeft = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "border-left-width",
      viewportWidth,
      percentageBase: selectorWidth,
    });
    const selectorBorderRight = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "border-right-width",
      viewportWidth,
      percentageBase: selectorWidth,
    });
    assert.ok(
      selectorWidth >= selectorPaddingLeft + selectorPaddingRight,
      `geometría del header: padding del selector excede su ancho a ${viewportWidth}px`,
    );
    const selectorUsefulInlineWidth = selectorWidth - selectorPaddingLeft - selectorPaddingRight -
      selectorBorderLeft - selectorBorderRight;
    assert.equal(
      selectorUsefulInlineWidth,
      approvedDaySelectUsefulInlinePixels,
      `geometría del selector: debe conservar ${approvedDaySelectUsefulInlinePixels}px útiles a ${viewportWidth}px`,
    );
    const selectorFontSize = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "font-size",
      viewportWidth,
      percentageBase: selectorUsefulInlineWidth,
    });
    assert.ok(
      selectorFontSize >= 16,
      `tipografía del selector: ${selectorFontSize}px queda bajo 16px a ${viewportWidth}px`,
    );
    const selectorLetterSpacing = readEffectiveLetterSpacing({
      rules,
      target: cssAuditTargets.daySelect,
      viewportWidth,
      percentageBase: selectorUsefulInlineWidth,
    });
    for (const day of days) {
      const glyphCount = [...day].length;
      const dayTextWidth = Math.ceil(
        (glyphCount * selectorFontSize * nominalMonospaceAdvanceEm) +
        (Math.max(0, glyphCount - 1) * selectorLetterSpacing),
      );
      assert.ok(
        dayTextWidth <= selectorUsefulInlineWidth,
        `geometría del selector: “${day}” no cabe completo a ${viewportWidth}px (${dayTextWidth}px > ${selectorUsefulInlineWidth}px)`,
      );
    }
    const editWidth = readEffectiveLength({
      rules,
      target: cssAuditTargets.editButton,
      property: "width",
      viewportWidth,
      percentageBase: headerInlineWidth,
    });
    const controlsGap = readEffectiveLength({
      rules,
      target: cssAuditTargets.routineControls,
      property: "gap",
      viewportWidth,
      percentageBase: headerInlineWidth,
    });
    const controlsWidth = selectorWidth + controlsGap + editWidth;
    const headerGap = readEffectiveLength({
      rules,
      target: cssAuditTargets.routineHeader,
      property: "gap",
      viewportWidth,
      percentageBase: headerInlineWidth,
    });
    const titleTrackWidth = layout === "stacked"
      ? headerInlineWidth
      : headerInlineWidth - controlsWidth - headerGap;

    const headingFontSize = readEffectiveLength({
      rules,
      target: cssAuditTargets.routineHeading,
      property: "font-size",
      viewportWidth,
      percentageBase: titleTrackWidth,
    });
    assert.equal(
      headingFontSize,
      approvedRoutineTextPixels,
      `tipografía geométrica: el título debe medir exactamente ${approvedRoutineTextPixels}px a ${viewportWidth}px`,
    );
    const headingLetterSpacing = readEffectiveLetterSpacing({
      rules,
      target: cssAuditTargets.routineHeading,
      viewportWidth,
      percentageBase: titleTrackWidth,
    });
    const routineNameFontSize = readEffectiveLength({
      rules,
      target: cssAuditTargets.routineSubheading,
      property: "font-size",
      viewportWidth,
      percentageBase: titleTrackWidth,
    });
    assert.equal(
      routineNameFontSize,
      approvedRoutineTextPixels,
      `tipografía geométrica: el nombre de rutina debe medir exactamente ${approvedRoutineTextPixels}px a ${viewportWidth}px`,
    );

    let minimumSlack = Number.POSITIVE_INFINITY;
    let criticalDay = "";
    let criticalTextWidth = 0;
    for (const day of days) {
      const text = `${startPrefix}${day}`;
      const glyphCount = [...text].length;
      const textWidth = Math.ceil(
        (glyphCount * headingFontSize * conservativeMonospaceAdvanceEm) +
        (Math.max(0, glyphCount - 1) * headingLetterSpacing),
      );
      const slack = titleTrackWidth - textWidth;
      if (slack < minimumSlack) {
        minimumSlack = slack;
        criticalDay = day;
        criticalTextWidth = textWidth;
      }
      assert.ok(
        slack >= 0,
        `geometría del header: colisión a ${viewportWidth}px con “${text}” (pista ${titleTrackWidth.toFixed(2)}px, texto ${textWidth.toFixed(2)}px, holgura ${slack.toFixed(2)}px)`,
      );
    }

    if (layout === "stacked") {
      assertEffectiveCssValue({
        rules,
        target: cssAuditTargets.routineTitle,
        property: "width",
        expected: "100%",
        viewportWidth,
        message: "geometría del header: título y categoría deben ocupar todo el ancho apilado",
      });
      assertEffectiveCssValue({
        rules,
        target: cssAuditTargets.routineControls,
        property: "width",
        expected: "100%",
        viewportWidth,
        message: "geometría del header: controles deben ocupar su segunda fila",
      });
      assertEffectiveCssValue({
        rules,
        target: cssAuditTargets.routineControls,
        property: "justify-content",
        expected: "flex-end",
        viewportWidth,
        message: "alineación apilada: selector y Editar deben permanecer juntos a la derecha",
      });
    } else {
      assert.equal(
        headerColumns,
        "minmax(0, 1fr) auto",
        `geometría del header: ${viewportWidth}px debe conservar pistas reducibles lado a lado`,
      );
    }

    for (const headingTarget of headingTargets) {
      assertEffectiveCssValue({
        rules,
        target: headingTarget,
        property: "white-space",
        expected: "nowrap",
        viewportWidth,
        message: `texto completo: ${headingTarget.label} debe permanecer nowrap`,
      });
      const overflow = readEffectiveCssProperty({
        rules,
        target: headingTarget,
        property: "overflow-x",
        viewportWidth,
        required: false,
      });
      const textOverflow = readEffectiveCssProperty({
        rules,
        target: headingTarget,
        property: "text-overflow",
        viewportWidth,
        required: false,
      });
      assert.notEqual(
        overflow,
        "hidden",
        `texto completo: ${headingTarget.label} no puede ocultar overflow a ${viewportWidth}px`,
      );
      assert.notEqual(
        textOverflow,
        "ellipsis",
        `texto completo: ${headingTarget.label} no puede usar ellipsis a ${viewportWidth}px`,
      );
    }

    results.push({
      viewportWidth,
      layout,
      headerInlineWidth,
      titleTrackWidth,
      controlsWidth,
      headingFontSize,
      headingLetterSpacing,
      criticalDay,
      criticalTextWidth,
      minimumSlack,
    });
  }

  return results;
}

function assertDirectPerformanceHistoryFlow(component: ts.FunctionDeclaration) {
  assert.ok(component.body);
  const disclosureContents: ts.JsxElement[] = [];
  const collect = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === "div" &&
      readJsxStylesClassName(node, "disclosureContent")
    ) {
      disclosureContents.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(component.body);
  assert.equal(
    disclosureContents.length,
    1,
    "flujo DOM directo: el historial debe tener un único contenedor disclosureContent auditable",
  );

  const children = disclosureContents[0].children.filter((child) => (
    !ts.isJsxText(child) || child.text.trim().length > 0
  ));
  assert.equal(
    children.length,
    3,
    "flujo DOM directo: no se permite wrapper, placeholder, texto ni reserva visual entre series y objetivo",
  );
  assert.ok(
    ts.isJsxElement(children[0]) && readJsxStylesClassName(children[0], "historyTitle"),
    "flujo DOM directo: el historial debe comenzar con su título canónico",
  );
  assert.ok(
    ts.isJsxExpression(children[1]) && children[1].expression && ts.isConditionalExpression(children[1].expression),
    "flujo DOM directo: el detalle/estado de series debe permanecer como segundo hijo directo",
  );
  assert.ok(
    ts.isJsxElement(children[2]) && readJsxStylesClassName(children[2], "todayGoal"),
    "flujo DOM directo: el objetivo debe seguir inmediatamente al detalle de series",
  );
}

function assertNoReservedComparisonSpace(rules: readonly CssExecutableRule[]) {
  const transitionTargets = [
    cssAuditTargets.seriesDetailList,
    cssAuditTargets.loadingHistory,
    cssAuditTargets.historyStatus,
    cssAuditTargets.todayGoal,
  ];

  for (const viewportWidth of mobileAuditWidths) {
    for (const pseudoElement of ["before", "after"] as const) {
      for (const target of transitionTargets) {
        const pseudoTarget = { ...target, pseudoElement };
        const content = readEffectiveCssProperty({
          rules,
          target: pseudoTarget,
          property: "content",
          viewportWidth,
          required: false,
        });
        assert.ok(
          content === null || /^(?:none|normal)$/.test(content),
          `flujo DOM directo: ${target.label} no puede generar texto ni placeholder con ::${pseudoElement}`,
        );
      }
    }

    for (const property of ["height", "min-height", "margin-top", "margin-bottom", "padding-top", "padding-bottom"] as const) {
      const value = readEffectiveCssProperty({
        rules,
        target: cssAuditTargets.todayGoal,
        property,
        viewportWidth,
        required: false,
      });
      assert.ok(
        value === null || /^0(?:[a-z%]+)?$/i.test(value),
        `flujo DOM directo: el objetivo no puede reservar el espacio eliminado mediante ${property} ${value}`,
      );
    }
  }
}

function assertEffectiveCssValue(input: {
  rules: readonly CssExecutableRule[];
  target: CssAuditTarget;
  property: string;
  expected: string | readonly string[];
  viewportWidth: number;
  message: string;
}) {
  const actual = readEffectiveCssProperty(input);
  const expectedValues = typeof input.expected === "string" ? [input.expected] : input.expected;
  assert.ok(
    actual !== null && expectedValues.includes(actual),
    `${input.message}; valor efectivo: ${actual ?? "ausente"}`,
  );
}

function assertNoProtectedTextClipping(rules: readonly CssExecutableRule[]) {
  const protectedTargets = [
    cssAuditTargets.startHeading,
    cssAuditTargets.routineHeading,
    cssAuditTargets.routineSubheading,
    cssAuditTargets.sectionHeading,
    cssAuditTargets.newRecordHeading,
    cssAuditTargets.objectivesHeading,
  ];

  for (const viewportWidth of mobileAuditWidths) {
    for (const target of protectedTargets) {
      assertEffectiveCssValue({
        rules,
        target,
        property: "white-space",
        expected: "nowrap",
        viewportWidth,
        message: `nowrap efectivo: ${target.label} debe permanecer en una línea a ${viewportWidth}px`,
      });
      const overflow = readEffectiveCssProperty({
        rules,
        target,
        property: "overflow-x",
        viewportWidth,
        required: false,
      });
      const textOverflow = readEffectiveCssProperty({
        rules,
        target,
        property: "text-overflow",
        viewportWidth,
        required: false,
      });
      assert.notEqual(
        overflow,
        "hidden",
        `texto protegido con recorte efectivo: ${target.label} usa overflow hidden a ${viewportWidth}px`,
      );
      assert.notEqual(
        textOverflow,
        "ellipsis",
        `texto protegido con ellipsis efectivo: ${target.label} a ${viewportWidth}px`,
      );
    }
  }
}

function numericCssValues(value: string) {
  return [...value.matchAll(/(-?\d*\.?\d+)\s*(%)?/g)].map((match) => (
    match[2] ? Number(match[1]) / 100 : Number(match[1])
  ));
}

function declarationReducesTouchTarget(declaration: CssDeclaration) {
  if (declaration.property === "zoom" || declaration.property === "scale") {
    if (/^(?:none|normal)$/i.test(declaration.value)) return false;
    const values = numericCssValues(declaration.value);
    return values.length === 0 || values.some((value) => value < 1);
  }
  if (declaration.property !== "transform") return false;
  if (/matrix(?:3d)?\(/i.test(declaration.value)) return true;
  const scaleFunctions = [...declaration.value.matchAll(/scale(?:3d|x|y)?\(([^)]*)\)/gi)];
  if (scaleFunctions.length === 0) return false;
  return scaleFunctions.some((match) => {
    const values = numericCssValues(match[1]);
    return values.length === 0 || values.some((value) => value < 1);
  });
}

function assertNoTouchTargetReduction(rules: readonly CssExecutableRule[]) {
  const baseTargets = [
    cssAuditTargets.routineControls,
    cssAuditTargets.daySelector,
    cssAuditTargets.daySelect,
    cssAuditTargets.editButton,
    cssAuditTargets.editButtonBefore,
    cssAuditTargets.editButtonIcon,
  ];
  const states = [[], ["hover"], ["focus"], ["focus-visible"], ["active"]] as const;
  const targets = baseTargets.flatMap((target) => states.map((targetStates) => ({
    ...target,
    states: targetStates,
  })));

  for (const viewportWidth of mobileAuditWidths) {
    for (const target of targets) {
      for (const property of ["transform", "scale", "zoom"] as const) {
        const value = readEffectiveCssProperty({
          rules,
          target,
          property,
          viewportWidth,
          required: false,
        });
        if (value === null) continue;
        assert.equal(
          declarationReducesTouchTarget({
            property,
            value,
            important: false,
            declarationOrder: 0,
          }),
          false,
          `target táctil reducido por ${property} efectivo en ${target.label} a ${viewportWidth}px`,
        );
      }
    }
  }
}

function splitCssValueTokens(value: string) {
  const tokens: string[] = [];
  let start = 0;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") parentheses += 1;
    else if (value[index] === ")") parentheses -= 1;
    else if (/\s/.test(value[index]) && parentheses === 0) {
      const token = value.slice(start, index).trim();
      if (token) tokens.push(token);
      start = index + 1;
    }
  }
  const finalToken = value.slice(start).trim();
  if (finalToken) tokens.push(finalToken);
  return tokens;
}

function hasNegativeHorizontalMargin(property: string, value: string) {
  if (/^margin-(?:left|right|inline|inline-start|inline-end)$/.test(property)) {
    return /(^|\s)-\d/.test(value);
  }
  if (property !== "margin") return false;
  const tokens = splitCssValueTokens(value);
  const horizontal = tokens.length === 1
    ? [tokens[0]]
    : tokens.length === 2
      ? [tokens[1]]
      : tokens.length === 3
        ? [tokens[1]]
        : [tokens[1], tokens[3]];
  return horizontal.some((token) => /^-\d/.test(token));
}

function minimumGridTrackWidth(value: string): number {
  if (/\b(?:min-content|max-content)\b/.test(value)) return Number.POSITIVE_INFINITY;
  let expanded = value;
  let previous = "";
  while (expanded !== previous) {
    previous = expanded;
    expanded = expanded.replace(/repeat\(\s*(\d+)\s*,\s*([^()]+|minmax\([^()]+\))\s*\)/g, (_match, count, track) => (
      Array.from({ length: Number(count) }, () => track).join(" ")
    ));
  }
  return splitCssValueTokens(expanded).reduce((total, track) => {
    const minmax = track.match(/^minmax\(\s*(-?\d*\.?\d+)px\s*,/i);
    if (minmax) return total + Number(minmax[1]);
    const fixed = track.match(/^(-?\d*\.?\d+)px$/i);
    return fixed ? total + Number(fixed[1]) : total;
  }, 0);
}

function dimensionExceedsViewport(property: string, value: string, viewportWidth: number) {
  if (/calc\([^)]*100%\s*\+/i.test(value)) return true;
  const percentage = value.match(/^(\d*\.?\d+)%$/);
  if (percentage && Number(percentage[1]) > 100) return true;
  const viewportUnits = value.match(/(\d*\.?\d+)vw\b/i);
  if (viewportUnits) {
    if (property !== "width" && Number(viewportUnits[1]) > 0) return true;
    if (Number(viewportUnits[1]) >= 100) return true;
  }
  const fixedPixels = value.match(/^(\d*\.?\d+)px$/i);
  if (fixedPixels) return Number(fixedPixels[1]) > viewportWidth;
  const fixedRem = value.match(/^(\d*\.?\d+)rem$/i);
  return Boolean(fixedRem && (Number(fixedRem[1]) * 16) > viewportWidth);
}

function hasHorizontalTranslation(property: string, value: string) {
  const isZero = (token: string) => /^0(?:[a-z%]+)?$/i.test(token.trim());
  if (property === "translate") {
    return !isZero(splitCssValueTokens(value)[0] ?? "");
  }
  if (property !== "transform") return false;
  for (const match of value.matchAll(/translate(?:x|3d)?\(([^,)]*)/gi)) {
    if (!isZero(match[1])) return true;
  }
  return false;
}

function assertNoEffectiveHorizontalOverflow(rules: readonly CssExecutableRule[]) {
  const layoutTargets = [
    cssAuditTargets.screen,
    cssAuditTargets.startCard,
    cssAuditTargets.guidedCard,
    cssAuditTargets.routineHeader,
    cssAuditTargets.routineTitle,
    cssAuditTargets.routineControls,
    cssAuditTargets.daySelector,
    cssAuditTargets.daySelect,
    cssAuditTargets.exerciseTable,
    cssAuditTargets.tableRow,
    cssAuditTargets.selectableRow,
    cssAuditTargets.tableCell,
    cssAuditTargets.referencePanel,
    cssAuditTargets.disclosureContent,
  ];
  const mustShrinkTargets = [
    cssAuditTargets.screen,
    cssAuditTargets.startCard,
    cssAuditTargets.guidedCard,
    cssAuditTargets.routineHeader,
    cssAuditTargets.routineTitle,
    cssAuditTargets.routineControls,
    cssAuditTargets.daySelector,
    cssAuditTargets.daySelect,
    cssAuditTargets.exerciseTable,
    cssAuditTargets.tableRow,
    cssAuditTargets.selectableRow,
    cssAuditTargets.tableCell,
    cssAuditTargets.referencePanel,
    cssAuditTargets.disclosureContent,
  ];

  for (const viewportWidth of mobileAuditWidths) {
    for (const target of mustShrinkTargets) {
      assertEffectiveCssValue({
        rules,
        target,
        property: "min-width",
        expected: "0",
        viewportWidth,
        message: `overflow horizontal efectivo: ${target.label} debe conservar min-width 0 a ${viewportWidth}px`,
      });
      const overflowX = readEffectiveCssProperty({
        rules,
        target,
        property: "overflow-x",
        viewportWidth,
        required: false,
      });
      assert.doesNotMatch(
        overflowX ?? "",
        /^(?:auto|scroll)$/,
        `overflow horizontal efectivo: ${target.label} no puede crear scroll a ${viewportWidth}px`,
      );
    }

    for (const target of layoutTargets) {
      for (const property of ["width", "min-width", "min-inline-size"] as const) {
        const value = readEffectiveCssProperty({
          rules,
          target,
          property,
          viewportWidth,
          required: false,
        });
        if (value === null) continue;
        assert.equal(
          dimensionExceedsViewport(property, value, viewportWidth),
          false,
          `overflow horizontal efectivo: ${target.label} usa ${property} ${value} a ${viewportWidth}px`,
        );
      }
      for (const property of ["margin-left", "margin-right"] as const) {
        const value = readEffectiveCssProperty({
          rules,
          target,
          property,
          viewportWidth,
          required: false,
        });
        if (value === null) continue;
        assert.equal(
          hasNegativeHorizontalMargin(property, value),
          false,
          `overflow horizontal efectivo: ${target.label} expande el canvas con ${property} ${value}`,
        );
      }
      for (const property of ["transform", "translate"] as const) {
        const value = readEffectiveCssProperty({
          rules,
          target,
          property,
          viewportWidth,
          required: false,
        });
        if (value === null) continue;
        assert.equal(
          hasHorizontalTranslation(property, value),
          false,
          `overflow horizontal efectivo: ${target.label} desplaza contenido con ${property} ${value}`,
        );
      }
      const columns = readEffectiveCssProperty({
        rules,
        target,
        property: "grid-template-columns",
        viewportWidth,
        required: false,
      });
      if (columns !== null) {
        assert.ok(
          minimumGridTrackWidth(columns) <= viewportWidth,
          `overflow horizontal efectivo: columnas rígidas de ${target.label} no caben a ${viewportWidth}px`,
        );
      }
    }
  }
}

function assertEffectiveVisualCascade(rules: readonly CssExecutableRule[]) {
  for (const viewportWidth of mobileAuditWidths) {
    for (const [target, backgroundColor] of [
      [cssAuditTargets.body, "var(--background)"],
      [cssAuditTargets.shell, "var(--background)"],
      [cssAuditTargets.topbar, "var(--background)"],
      [cssAuditTargets.backRow, "var(--background)"],
      [cssAuditTargets.screen, "var(--background)"],
      [cssAuditTargets.startCard, "var(--background)"],
      [cssAuditTargets.guidedCard, "var(--background)"],
      [cssAuditTargets.referencePanel, "transparent"],
    ] as const) {
      assertEffectiveCssValue({
        rules,
        target,
        property: "background-color",
        expected: backgroundColor,
        viewportWidth,
        message: `fondo efectivo incorrecto en ${target.label} a ${viewportWidth}px`,
      });
    }

    for (const target of [
      cssAuditTargets.body,
      cssAuditTargets.shell,
      cssAuditTargets.topbar,
      cssAuditTargets.backRow,
      cssAuditTargets.screen,
      cssAuditTargets.startCard,
      cssAuditTargets.guidedCard,
      cssAuditTargets.referencePanel,
    ]) {
      assertEffectiveCssValue({
        rules,
        target,
        property: "background-image",
        expected: "none",
        viewportWidth,
        message: `fondo efectivo con imagen o gradiente en ${target.label} a ${viewportWidth}px`,
      });
    }

    for (const target of [cssAuditTargets.startCard, cssAuditTargets.guidedCard]) {
      assertEffectiveCssValue({
        rules,
        target,
        property: "overflow-x",
        expected: "visible",
        viewportWidth,
        message: `overflow efectivo incorrecto en ${target.label} a ${viewportWidth}px`,
      });
    }

    assertEffectiveCssValue({
      rules,
      target: cssAuditTargets.daySelector,
      property: "min-height",
      expected: "44px",
      viewportWidth,
      message: `target táctil efectivo incorrecto en ${cssAuditTargets.daySelector.label}`,
    });
    assertEffectiveCssValue({
      rules,
      target: cssAuditTargets.daySelect,
      property: "min-height",
      expected: "36px",
      viewportWidth,
      message: "tamaño compacto efectivo incorrecto en selector de día",
    });
    assertEffectiveCssValue({
      rules,
      target: cssAuditTargets.daySelect,
      property: "width",
      expected: `${approvedDaySelectPixels}px`,
      viewportWidth,
      message: `ancho aprobado incorrecto en selector de día; debe medir ${approvedDaySelectPixels}px`,
    });
    for (const property of ["width", "height"] as const) {
      assertEffectiveCssValue({
        rules,
        target: cssAuditTargets.editButton,
        property,
        expected: "44px",
        viewportWidth,
        message: `target táctil efectivo incorrecto en botón Editar (${property})`,
      });
    }
    assertEffectiveCssValue({
      rules,
      target: cssAuditTargets.editButtonBefore,
      property: "inset",
      expected: "5px",
      viewportWidth,
      message: "tamaño compacto efectivo incorrecto en caja visual Editar",
    });
  }

  for (const viewportWidth of [...mobileAuditWidths, 800]) {
    const selectorFontSize = readEffectiveLength({
      rules,
      target: cssAuditTargets.daySelect,
      property: "font-size",
      viewportWidth,
      percentageBase: approvedDaySelectUsefulInlinePixels,
    });
    assert.ok(
      selectorFontSize >= 16,
      `fuente efectiva del selector: ${selectorFontSize}px queda bajo 16px a ${viewportWidth}px`,
    );
  }

  assertEffectiveCssValue({
    rules,
    target: cssAuditTargets.topbar,
    property: "box-shadow",
    expected: "none",
    viewportWidth: 390,
    message: "fondo efectivo: topbar debe permanecer sin sombra",
  });
  assertEffectiveCssValue({
    rules,
    target: cssAuditTargets.topbar,
    property: "backdrop-filter",
    expected: "none",
    viewportWidth: 390,
    message: "fondo efectivo: topbar debe permanecer sin blur",
  });
  assertEffectiveCssValue({
    rules,
    target: cssAuditTargets.backRow,
    property: "box-shadow",
    expected: "none",
    viewportWidth: 390,
    message: "fondo efectivo: zona Back debe permanecer sin sombra",
  });
  assertEffectiveCssValue({
    rules,
    target: cssAuditTargets.referencePanel,
    property: "box-shadow",
    expected: "none",
    viewportWidth: 390,
    message: "fondo efectivo: panel de referencia debe permanecer plano",
  });

  const compactFonts = [
    [cssAuditTargets.startHeading, "clamp(0.58rem, 2.7vw, 1.1rem)"],
    [cssAuditTargets.routineHeading, "15px"],
    [cssAuditTargets.routineSubheading, "15px"],
    [cssAuditTargets.sectionHeading, "clamp(0.72rem, 3.2vw, 1.1rem)"],
    [cssAuditTargets.newRecordHeading, "clamp(0.72rem, 3.2vw, 1.1rem)"],
    [cssAuditTargets.objectivesHeading, "clamp(0.72rem, 3.2vw, 1.1rem)"],
  ] as const;
  for (const [target, expected] of compactFonts) {
    assertEffectiveCssValue({
      rules,
      target,
      property: "font-size",
      expected,
      viewportWidth: 390,
      message: `tamaño compacto efectivo incorrecto en ${target.label}`,
    });
  }

  assertNoReservedComparisonSpace(rules);
  assertNoProtectedTextClipping(rules);
  assertNoTouchTargetReduction(rules);
  assertNoEffectiveHorizontalOverflow(rules);
}

function assertNoUnauthorizedPerformanceComparison(source: string) {
  const sourceFile = ts.createSourceFile(
    "ExerciseLastPerformancePanel.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  assert.equal(
    readTypeScriptParseDiagnostics(sourceFile).length,
    0,
    "flujo DOM directo: ExerciseLastPerformancePanel debe conservar sintaxis TSX válida",
  );
  const components = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "ExerciseLastPerformancePanel"
  ));
  assert.equal(components.length, 1, "el panel de historial debe tener una única implementación ejecutable");
  const component = components[0];
  assert.ok(component.body, "el panel de historial debe conservar un cuerpo ejecutable");
  const parameter = component.parameters[0];
  assert.ok(parameter && ts.isObjectBindingPattern(parameter.name));
  const presentationBindings = parameter.name.elements.filter((element) => (
    !element.propertyName && ts.isIdentifier(element.name) && element.name.text === "presentation"
  ));
  assert.equal(
    presentationBindings.length,
    1,
    "presentation debe conservarse como binding directo para poder auditar todos sus usos",
  );

  const authorizedPresentationFields = new Set([
    "lastHeaderText",
    "lastSummaryText",
    "seriesDetailTitle",
    "seriesRows",
    "status",
    "todayGoalText",
  ]);
  const renderedPresentationFields = new Set<string>();
  const forbiddenDifferenceField = /^(?:comparisonText|comparisonTone|comparisonStatus|weightDifference|repsDifference)$/;

  const visit = (node: ts.Node) => {
    if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      forbiddenDifferenceField.test(node.text)
    ) {
      assert.fail(`el JSX ejecutable no puede consumir ${node.text}`);
    }

    if (ts.isIdentifier(node) && node.text === "presentation") {
      const parent = node.parent;
      assert.ok(
        ts.isPropertyAccessExpression(parent) && parent.expression === node,
        "presentation no puede ocultarse mediante alias, destructuring ni acceso dinámico",
      );
      assert.ok(
        authorizedPresentationFields.has(parent.name.text),
        `campo visual de presentation no autorizado: ${parent.name.text}`,
      );
      renderedPresentationFields.add(parent.name.text);
    }

    ts.forEachChild(node, visit);
  };
  visit(component.body);

  assert.deepEqual(
    [...renderedPresentationFields].sort(),
    [...authorizedPresentationFields].sort(),
    "el panel sólo puede renderizar historial, estados y objetivo aprobados",
  );
  assertDirectPerformanceHistoryFlow(component);
}

function assertTrainUi01AuditContracts(
  sources: TrainUi01AuditSources,
  protectedSources: ProtectedFileSources = protectedFileSources,
) {
  assertProtectedFileIntegrity(protectedSources);
  assert.doesNotMatch(
    sources.workoutStyles,
    /:has\(/,
    "la uniformidad visual no puede depender de :has() en el CSS activo",
  );
  const effectiveCssRules = parseExecutableCss(`${sources.globalStyles}\n${sources.workoutStyles}`);

  // El h1 pertenece al topbar; estas pantallas comienzan en h2 y sus secciones usan h3.
  assert.doesNotMatch(sources.start, /<h1\b/);
  assert.doesNotMatch(sources.guided, /<h1\b/);
  assert.match(sources.start, /<h2 id="training-start-title">/);
  assert.match(sources.guided, /<h2 id="guided-routine-title">/);
  assert.match(sources.guided, /<h3 id="guided-plan-title">/);
  assert.match(sources.seriesResult, /<h3 id="exercise-objectives-title">Objetivos<\/h3>/);

  // El summary cerrado usa la presentación canónica con fecha cuando existe y estados legibles
  // para loading/empty/error; no conserva un título estático alternativo.
  const firstSummaryStart = sources.performancePanel.indexOf("<summary>");
  const firstSummaryEnd = sources.performancePanel.indexOf("</summary>", firstSummaryStart);
  assert.ok(firstSummaryStart >= 0 && firstSummaryEnd > firstSummaryStart);
  const firstSummary = sources.performancePanel.slice(firstSummaryStart, firstSummaryEnd);
  assert.match(firstSummary, /presentation\.status === "found"/);
  assert.match(firstSummary, /presentation\.seriesDetailTitle/);
  assert.match(firstSummary, /presentation\.lastSummaryText/);
  assert.doesNotMatch(firstSummary, /Rendimiento anterior/);

  // El contrato recorre el AST del cuerpo ejecutable, no comentarios ni strings señuelo. Sólo se
  // autorizan los campos necesarios para historial/estado/objetivo; diferencias de peso/reps,
  // comparaciones, aliases y accesos dinámicos quedan fuera de la UI sin tocar el dominio.
  assertNoUnauthorizedPerformanceComparison(sources.performancePanel);
  assert.doesNotMatch(
    sources.workoutStyles,
    /\.historyComparison\b/,
    "flujo DOM directo: no debe sobrevivir un selector reservado para comparación",
  );

  // Las tarjetas presentan el detalle/estado canónico y derivan icono/tono del mismo item.
  assert.match(sources.seriesResult, /import \{ Check, X \} from "lucide-react";/);
  assert.match(sources.seriesResult, /data-tone=\{item\.tone\}/);
  assert.match(sources.seriesResult, /\{item\.detail\}/);
  assert.match(sources.seriesResult, /item\.tone === "partial" \? <X size=\{20\} \/> : <Check size=\{20\} \/>/);

  // La API local de labels preserva los defaults del resto del producto y sólo la pantalla
  // inicial solicita el copy de las referencias.
  assert.match(sources.metricGrid, /weightLabel\?: string;/);
  assert.match(sources.metricGrid, /repsLabel\?: string;/);
  assert.match(sources.metricGrid, /weightLabel = "KG totales de la rutina"/);
  assert.match(sources.metricGrid, /repsLabel = "Total reps"/);
  assert.match(
    sources.start,
    /weightLabel="Total de KG de la rutina"\s*repsLabel="Total Reps"\s*exerciseLabel="Total ejercicios registrados"/,
  );

  // La unidad ya está en el encabezado KG: las celdas visibles usan sólo el número localizado.
  assert.match(sources.start, /import \{ formatDecimalEs \} from "@\/lib\/progress\/weight-format";/);
  assert.match(sources.start, /<span role="cell">\{formatDecimalEs\(exercise\.baseWeight\)\}<\/span>/);
  assert.doesNotMatch(sources.start, /formatKg\(exercise\.baseWeight\)/);
  assert.match(sources.guided, /<span>\{formatDecimalEs\(exercise\.baseWeight\)\}<\/span>/);
  assert.match(sources.guided, /aria-label=\{`\$\{exercise\.name\}:[^`]*\$\{formatKg\(exercise\.baseWeight\)\}/);
  assert.match(sources.guided, /placeholder=\{formatKg\(activeExercise\.baseWeight\)\}/);

  // La selección conserva botones nativos: no hay grid/row ARIA simulado, y aria-pressed comunica
  // el estado manteniendo activación Tab/Enter/Space propia de button.
  assert.match(sources.guided, /<button\s*className=\{styles\.selectableTableRow\}\s*type="button"\s*aria-pressed=\{isActive\}/);
  assert.doesNotMatch(sources.guided, /role="grid"|role="row"|role="rowgroup"|role="gridcell"/);
  assert.match(sources.guided, /data-complete=\{isDone \? "true" : undefined\}/);

  // El status vacío está fuera del rowgroup de la tabla estática.
  assert.match(
    sources.start,
    /<div role="rowgroup">[\s\S]*<\/div>\s*<\/div>\s*\{exercises\.length === 0 \? \(\s*<p className=\{styles\.emptyTableMessage\} role="status">/,
  );

  // La grilla de métricas conservada por compatibilidad queda fuera del árbol accesible; el texto
  // único de progreso permanece disponible para tecnologías asistivas.
  assert.match(
    sources.guided,
    /<div className=\{styles\.srOnly\} aria-hidden="true">\s*<RoutineMetricGrid targetSummary=\{targetSummary\} \/>\s*<\/div>\s*<p className=\{styles\.srOnly\}>\s*Ejercicio/,
  );

  // La alerta de peso sólo aparece después del intento de registro canónico; 5, y 5. siguen siendo
  // drafts permitidos durante escritura. El boundary de registro mantiene el rechazo final.
  assert.match(
    sources.guided,
    /function isIntermediateDecimalWeightInput\(value: string\) \{[\s\S]*isDecimalWeightDraftInput\(value\)[\s\S]*normalized\.endsWith\(","\) \|\| normalized\.endsWith\("\."\)[\s\S]*const hasSubmittedInvalidWeight = draft\s*\? notice === incompleteCurrentExerciseMessage && \(\s*parseDecimalWeightInput\(draft\.weight\) === null &&\s*!isIntermediateDecimalWeightInput\(draft\.weight\)\s*\)\s*: false;/,
  );
  assert.match(sources.guided, /\{hasSubmittedInvalidWeight \? \(\s*<p className=\{styles\.fieldError\} id="exercise-weight-error" role="alert">/);
  assert.doesNotMatch(sources.guided, /\bhasInvalidWeight\b/);
  assert.match(sources.workoutRegistration, /parseDecimalWeightInput\(draft\.weight\) === null/);
  assert.match(sources.workoutRegistration, /kind: "invalid_draft"/);

  const selectedRule = readCssRule(sources.workoutStyles, '.selectableTableRow[aria-pressed="true"]');
  const completedRule = readCssRule(
    sources.workoutStyles,
    '.selectableTableRow[data-complete="true"]:not([aria-pressed="true"])',
  );
  const primaryActionRule = readCssRule(
    sources.workoutStyles,
    ".primaryAction.primaryAction.primaryAction",
  );
  const screenRule = readCssRule(sources.workoutStyles, ".screen");
  const workoutCardRule = readCssRule(sources.workoutStyles, ".workoutCard.workoutCard");
  const referencePanelRule = readCssRule(
    sources.workoutStyles,
    ".referencePanel.referencePanel",
  );
  const metricTitleRule = readCssRule(
    sources.workoutStyles,
    ".metricScope.metricScope :global(.metric-title-row span)",
  );
  const globalBodyRule = readCssRule(sources.globalStyles, "body");
  const globalShellRule = readCssRule(sources.globalStyles, ".app-shell");
  const globalTopbarRule = readCssRule(sources.globalStyles, ".topbar");
  const globalBackRule = readCssRule(sources.globalStyles, ".section-back-row");
  assert.equal(readCssProperty(selectedRule.body, "background"), "var(--primary-strong)");
  assert.equal(readCssProperty(completedRule.body, "color"), "var(--workout-row-complete)");
  assert.equal(readCssProperty(screenRule.body, "--workout-row-complete"), "var(--green)");
  assert.equal(readCssProperty(globalBodyRule.body, "background-color"), "var(--background)");
  assert.equal(readCssProperty(globalShellRule.body, "background-color"), "var(--background)");
  assert.equal(readCssProperty(globalTopbarRule.body, "background"), "var(--background)");
  assert.equal(readCssProperty(globalBackRule.body, "background"), "var(--background)");
  assert.equal(readCssProperty(screenRule.body, "background"), "var(--background)");
  assert.equal(readCssProperty(workoutCardRule.body, "background"), "var(--background)");
  for (const [label, rule] of [
    ["viewport", globalBodyRule],
    ["app shell", globalShellRule],
    ["topbar", globalTopbarRule],
    ["zona Back", globalBackRule],
  ] as const) {
    assert.equal(readCssProperty(rule.body, "background-image"), "none", `${label}: sin banda ni gradiente`);
  }
  assert.equal(readCssProperty(globalTopbarRule.body, "box-shadow"), "none");
  assert.equal(readCssProperty(globalTopbarRule.body, "backdrop-filter"), "none");
  assert.equal(readCssProperty(globalBackRule.body, "box-shadow"), "none");
  assert.equal(readCssProperty(referencePanelRule.body, "background"), "transparent");
  assert.equal(readCssProperty(referencePanelRule.body, "box-shadow"), "none");
  assert.equal(readCssProperty(metricTitleRule.body, "font-size"), "clamp(0.5rem, 2vw, 0.7rem)");
  assertAccessibleSmallTextContrast({
    globalStyles: sources.globalStyles,
    ruleBody: selectedRule.body,
    label: "fila seleccionada",
  });
  assertAccessibleSmallTextContrast({
    globalStyles: sources.globalStyles,
    ruleBody: primaryActionRule.body,
    label: "botón primario",
  });

  const mobileInputSelector = `.newRecord :global(.series-weight-field input),
.newRecord :global(.series-rep-box input)`;
  assertMobileFontAtLeast16Px(
    readCssRule(sources.workoutStyles, mobileInputSelector).body,
    "inputs de peso/repeticiones",
  );
  assertMobileFontAtLeast16Px(
    readCssRule(sources.workoutStyles, ".daySelector select").body,
    "selector de día",
  );
  assertMobileFontAtLeast16Px(
    readCssRule(sources.workoutStyles, ".referencePanel :global(.exercise-observation-textarea)").body,
    "textarea de observación",
  );

  // Las líneas que Figma presenta completas no vuelven a envolver. Selector y edición reducen su
  // caja visible, preservando un target etiquetado de 44 px para touch/teclado.
  for (const selector of [
    ".startIntro h2",
    `.routineTitle h2,
.routineTitle h3`,
    `.sectionHeading h3,
.newRecord h3,
.objectives h3`,
  ]) {
    const headingRule = readCssRule(sources.workoutStyles, selector);
    assert.equal(readCssProperty(headingRule.body, "white-space"), "nowrap", `${selector}: debe permanecer en una línea`);
    assert.doesNotMatch(headingRule.body, /overflow-wrap:\s*anywhere/);
  }
  const daySelectorRule = readCssRule(sources.workoutStyles, ".daySelector");
  const daySelectRule = readCssRule(sources.workoutStyles, ".daySelector select");
  const routineHeadingRule = readCssRule(
    sources.workoutStyles,
    `.routineTitle h2,
.routineTitle h3`,
  );
  const routineNameRule = readCssRule(sources.workoutStyles, ".routineTitle.routineTitle p");
  const editButtonRule = readCssRule(sources.workoutStyles, ".editRoutineButton.editRoutineButton");
  const editButtonVisualRule = readCssRule(
    sources.workoutStyles,
    ".editRoutineButton.editRoutineButton::before",
  );
  assert.equal(
    readCssProperty(daySelectorRule.body, "min-height"),
    "44px",
    "selector de día: el target táctil estructural debe medir al menos 44px",
  );
  assert.equal(readCssProperty(daySelectRule.body, "min-height"), "36px");
  assert.equal(
    readCssProperty(daySelectRule.body, "width"),
    `${approvedDaySelectPixels}px`,
    `selector de día: el ancho estructural debe medir exactamente ${approvedDaySelectPixels}px`,
  );
  assert.equal(readCssProperty(daySelectRule.body, "padding"), "0 7px");
  assert.equal(
    readCssProperty(routineHeadingRule.body, "font-size"),
    `${approvedRoutineTextPixels}px`,
    `título de rutina: el tamaño estructural debe medir exactamente ${approvedRoutineTextPixels}px`,
  );
  assert.equal(
    readCssProperty(routineNameRule.body, "font-size"),
    `${approvedRoutineTextPixels}px`,
    `nombre de rutina: el tamaño estructural debe medir exactamente ${approvedRoutineTextPixels}px`,
  );
  assert.equal(readCssProperty(editButtonRule.body, "width"), "44px");
  assert.equal(readCssProperty(editButtonRule.body, "height"), "44px");
  assert.equal(readCssProperty(editButtonVisualRule.body, "inset"), "5px");
  assert.equal((sources.start.match(/<Pencil size=\{15\}/g) ?? []).length, 1);
  assert.equal((sources.guided.match(/<Pencil size=\{15\}/g) ?? []).length, 1);

  // Los colores con token global no pueden reaparecer hardcodeados en el CSS local.
  assert.doesNotMatch(sources.workoutStyles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(sources.workoutStyles, /(?:linear|radial|conic)-gradient\s*\(/i);

  // La cascada completa se evalúa en el orden real de compilación (globals antes del módulo),
  // incluyendo media queries, especificidad y reglas tardías; no se asume que gana la primera.
  const headerGeometryResults = assertRoutineHeaderGeometry(sources, effectiveCssRules);
  assertEffectiveVisualCascade(effectiveCssRules);
  return headerGeometryResults;
}

function replaceAuditOnce(source: string, search: string, replacement: string) {
  assert.equal(source.split(search).length - 1, 1, `marcador de probe ambiguo: ${search}`);
  return source.replace(search, replacement);
}

function mutateCssRule(
  source: string,
  selector: string,
  search: string,
  replacement: string,
) {
  const rule = readCssRule(source, selector);
  const mutatedBody = replaceAuditOnce(rule.body, search, replacement);
  return `${source.slice(0, rule.start)}${selector} {${mutatedBody}}${source.slice(rule.end)}`;
}

const trainUi01AuditSources: TrainUi01AuditSources = {
  start: files.start,
  guided: files.guided,
  performancePanel: files.performancePanel,
  seriesResult: files.seriesResult,
  workoutStyles: files.workoutStyles,
  metricGrid: files.metricGrid,
  workoutRegistration: files.workoutRegistration,
  trainingDayOrder: files.trainingDayOrder,
  globalStyles,
};
const trainUi01HeaderGeometryResults = assertTrainUi01AuditContracts(trainUi01AuditSources);

console.log(
  `TRAIN-UI-01 header geometry passed (${trainUi01HeaderGeometryResults.length} widths): ${trainUi01HeaderGeometryResults.map((result) => (
    `${result.viewportWidth}px=${result.layout},track:${result.titleTrackWidth.toFixed(2)},text:${result.criticalTextWidth.toFixed(2)},slack:${result.minimumSlack.toFixed(2)},day:${result.criticalDay}`
  )).join(" | ")}`,
);

const trainUi01MutationProbes: Array<{
  name: string;
  target: keyof TrainUi01AuditSources;
  mutate(source: string): string;
}> = [
  {
    name: "eliminar título dinámico del historial",
    target: "performancePanel",
    mutate: (source) => replaceAuditOnce(
      source,
      "presentation.seriesDetailTitle",
      '"Rendimiento anterior"',
    ),
  },
  {
    name: "reconstruir comparación dinámica de peso y reps",
    target: "performancePanel",
    mutate: (source) => replaceAuditOnce(
      source,
      '          <p className={styles.todayGoal}>{presentation.todayGoalText}</p>',
      '          <p>{String(presentation["weightDifference"]) + " kg · " + String(presentation["repsDifference"]) + " reps"}</p>\n          <p className={styles.todayGoal}>{presentation.todayGoalText}</p>',
    ),
  },
  {
    name: "sustituir estado de objetivos por label genérico",
    target: "seriesResult",
    mutate: (source) => replaceAuditOnce(source, "{item.detail}", "{item.label}"),
  },
  {
    name: "reintroducir segundo h1",
    target: "guided",
    mutate: (source) => replaceAuditOnce(
      replaceAuditOnce(source, '<h2 id="guided-routine-title">', '<h1 id="guided-routine-title">'),
      "</h2>",
      "</h1>",
    ),
  },
  {
    name: "aplicar role row al botón seleccionable",
    target: "guided",
    mutate: (source) => replaceAuditOnce(
      source,
      'type="button"\n                    aria-pressed={isActive}',
      'type="button"\n                    role="row"\n                    aria-pressed={isActive}',
    ),
  },
  {
    name: "emitir alert durante el draft 5,",
    target: "guided",
    mutate: (source) => replaceAuditOnce(
      source,
      "!isIntermediateDecimalWeightInput(draft.weight)",
      "true",
    ),
  },
  {
    name: "reducir inputs móviles bajo 16px",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      `.newRecord :global(.series-weight-field input),
.newRecord :global(.series-rep-box input)`,
      "font-size: 1rem;",
      "font-size: 0.875rem;",
    ),
  },
  {
    name: "degradar contraste de fila seleccionada",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      '.selectableTableRow[aria-pressed="true"]',
      "background: var(--primary-strong);",
      "background: var(--primary);",
    ),
  },
  {
    name: "mover el estilo seleccionado a un bloque señuelo",
    target: "workoutStyles",
    mutate: (source) => `${mutateCssRule(
      source,
      '.selectableTableRow[aria-pressed="true"]',
      "background: var(--primary-strong);",
      "background: transparent;",
    )}\n.decoy-selected { background: var(--primary-strong); }\n`,
  },
  {
    name: "convertir data-complete en literal no ejecutable",
    target: "guided",
    mutate: (source) => replaceAuditOnce(
      source,
      'data-complete={isDone ? "true" : undefined}',
      'data-complete="true"',
    ),
  },
  {
    name: "eliminar verde del estado completado",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      '.selectableTableRow[data-complete="true"]:not([aria-pressed="true"])',
      "color: var(--workout-row-complete);",
      "color: var(--muted);",
    ),
  },
  {
    name: "hardcodear fondo TRAIN-UI-01",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      ".daySelector select",
      "background: var(--background);",
      "background: #07101a;",
    ),
  },
  {
    name: "reintroducir banda distinta en zona Back",
    target: "globalStyles",
    mutate: (source) => mutateCssRule(
      source,
      ".section-back-row",
      "background: var(--background);",
      "background: var(--panel);",
    ),
  },
  {
    name: "degradar especificidad de tarjeta frente al CSS global",
    target: "workoutStyles",
    mutate: (source) => source.replace(
      ".workoutCard.workoutCard {",
      ":where(.workoutCard) {",
    ),
  },
  {
    name: "reintroducir gradiente en topbar",
    target: "globalStyles",
    mutate: (source) => mutateCssRule(
      source,
      ".topbar",
      "background-image: none;",
      "background-image: linear-gradient(var(--background), var(--panel));",
    ),
  },
  {
    name: "permitir wrap del título de rutina",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      `.routineTitle h2,
.routineTitle h3`,
      "white-space: nowrap;",
      "white-space: normal;",
    ),
  },
  {
    name: "agrandar visualmente el selector de día",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      ".daySelector select",
      "min-height: 36px;",
      "min-height: 44px;",
    ),
  },
  {
    name: "agrandar visualmente el botón Editar",
    target: "workoutStyles",
    mutate: (source) => mutateCssRule(
      source,
      ".editRoutineButton.editRoutineButton::before",
      "inset: 5px;",
      "inset: 0;",
    ),
  },
];

for (const probe of trainUi01MutationProbes) {
  const original = trainUi01AuditSources[probe.target];
  const mutated = probe.mutate(original);
  assert.notEqual(mutated, original, `probe sin mutación efectiva: ${probe.name}`);
  assert.throws(
    () => assertTrainUi01AuditContracts({
      ...trainUi01AuditSources,
      [probe.target]: mutated,
    }),
    `el contrato debe matar la mutación: ${probe.name}`,
  );
}

console.log(
  `TRAIN-UI-01 previous focal mutation probes passed (${trainUi01MutationProbes.length}): ${trainUi01MutationProbes.map((probe) => probe.name).join(" | ")}`,
);

type TrainUi01ReauditProbe = {
  name: string;
  diskPath: string;
  syntax: "css" | "tsx" | "ts";
  expectedFailure: RegExp;
  target:
    | { kind: "audit"; key: keyof TrainUi01AuditSources }
    | { kind: "protected"; path: ProtectedFilePath };
  mutate(source: string): string;
};

const trainUi01ReauditProbes: TrainUi01ReauditProbe[] = [
  {
    name: "A · aplicar ellipsis por override tardío efectivo",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /texto protegido con (?:recorte|ellipsis) efectivo/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.routineTitle.routineTitle p {\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n`,
  },
  {
    name: "B · reducir target Editar desde pseudoestado",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /target táctil reducido por transform/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.editRoutineButton:hover {\n  transform: scale(0.5);\n}\n`,
  },
  {
    name: "C · reservar espacio entre series y objetivo",
    diskPath: "src/features/active-workout/components/ExerciseLastPerformancePanel.tsx",
    syntax: "tsx",
    expectedFailure: /flujo DOM directo: no se permite wrapper, placeholder, texto ni reserva visual/,
    target: { kind: "audit", key: "performancePanel" },
    mutate: (source) => replaceAuditOnce(
      source,
      '          <p className={styles.todayGoal}>{presentation.todayGoalText}</p>',
      '          <div aria-hidden="true" style={{ minHeight: 24 }} />\n          <p className={styles.todayGoal}>{presentation.todayGoalText}</p>',
    ),
  },
  {
    name: "D · sobrescribir fondo con igual especificidad",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /fondo efectivo incorrecto en tarjeta/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.workoutCard.workoutCard {\n  background: var(--panel);\n}\n`,
  },
  {
    name: "E · expandir canvas a 200vw",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /overflow horizontal efectivo: .*200vw/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.screen {\n  width: 200vw;\n}\n`,
  },
  {
    name: "F · mutar payload productivo protegido",
    diskPath: "src/lib/training/workout-registration.ts",
    syntax: "ts",
    expectedFailure: /integridad byte a byte: cambió el archivo protegido .*workout-registration\.ts/,
    target: { kind: "protected", path: "src/lib/training/workout-registration.ts" },
    mutate: (source) => `${source}\nexport const trainUi01MutationProbe = true;\n`,
  },
  {
    name: "G · modificar accidentalmente Progreso",
    diskPath: "src/features/progress/components/comparison-screen-v2.tsx",
    syntax: "tsx",
    expectedFailure: /integridad byte a byte: cambió el archivo protegido .*comparison-screen-v2\.tsx/,
    target: { kind: "protected", path: "src/features/progress/components/comparison-screen-v2.tsx" },
    mutate: (source) => `${source}\nexport const trainUi01ProgressMutationProbe = true;\n`,
  },
  {
    name: "H · modificar accidentalmente CSS global prohibido",
    diskPath: "src/app/globals.css",
    syntax: "css",
    expectedFailure: /integridad byte a byte: cambió el archivo protegido .*globals\.css/,
    target: { kind: "protected", path: "src/app/globals.css" },
    mutate: (source) => `${source}\n.train-ui-01-forbidden-probe { color: var(--text); }\n`,
  },
];

function runTrainUi01IsolatedProbe(probe: TrainUi01ReauditProbe) {
  const original = probe.target.kind === "audit"
    ? trainUi01AuditSources[probe.target.key]
    : protectedFileSources[probe.target.path];
  const originalDiskHash = sha256(readSource(probe.diskPath));
  assert.equal(
    originalDiskHash,
    sha256(original),
    `restauración byte a byte: el source base de ${probe.name} debe coincidir con disco`,
  );

  const mutated = probe.mutate(original);
  assert.notEqual(mutated, original, `probe sin mutación efectiva: ${probe.name}`);
  assert.notEqual(sha256(mutated), originalDiskHash, `probe sin cambio byte a byte: ${probe.name}`);
  if (probe.syntax === "css") parseExecutableCss(mutated);
  else assertValidTypeScriptMutation(
    mutated,
    probe.diskPath,
    probe.syntax === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const mutatedAuditSources = probe.target.kind === "audit"
    ? { ...trainUi01AuditSources, [probe.target.key]: mutated }
    : trainUi01AuditSources;
  const mutatedProtectedSources = probe.target.kind === "protected"
    ? { ...protectedFileSources, [probe.target.path]: mutated }
    : protectedFileSources;

  let semanticFailure: unknown;
  try {
    assertTrainUi01AuditContracts(mutatedAuditSources, mutatedProtectedSources);
  } catch (error) {
    semanticFailure = error;
  }
  assert.ok(semanticFailure instanceof Error, `el contrato debe matar la mutación: ${probe.name}`);
  assert.match(
    semanticFailure.message,
    probe.expectedFailure,
    `el probe debe morir por su aserción semántica específica: ${probe.name}`,
  );
  assert.equal(
    sha256(readSource(probe.diskPath)),
    originalDiskHash,
    `restauración byte a byte fallida después de ${probe.name}`,
  );
}

for (const probe of trainUi01ReauditProbes) runTrainUi01IsolatedProbe(probe);

console.log(
  `TRAIN-UI-01 survivor reaudit mutation probes passed (${trainUi01ReauditProbes.length}): ${trainUi01ReauditProbes.map((probe) => probe.name).join(" | ")}`,
);

const trainUi01HeaderGeometryProbes: TrainUi01ReauditProbe[] = [
  {
    name: "G1 · devolver breakpoint apilado a 360px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /breakpoint adaptativo: 361px debe usar layout apilado/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => replaceAuditOnce(
      source,
      "@media (max-width: 400px) {",
      "@media (max-width: 360px) {",
    ),
  },
  {
    name: "G2 · reducir breakpoint apilado a 393px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /breakpoint adaptativo: 400px debe usar layout apilado/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => replaceAuditOnce(
      source,
      "@media (max-width: 400px) {",
      "@media (max-width: 393px) {",
    ),
  },
  {
    name: "G3 · mantener controles en la misma fila a 390px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /breakpoint adaptativo: 390px debe usar layout apilado/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n@media (min-width: 390px) and (max-width: 390px) {\n  .routineHeader {\n    grid-template-columns: minmax(0, 1fr) auto;\n  }\n}\n`,
  },
  {
    name: "G4 · aumentar selector hasta provocar colisión",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /geometría del selector: debe conservar 76px útiles a 401px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n@media (min-width: 401px) and (max-width: 401px) {\n  .daySelector select {\n    width: 120px;\n  }\n}\n`,
  },
  {
    name: "G5 · aumentar gap hasta provocar colisión",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /geometría del header: colisión a 401px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n@media (min-width: 401px) and (max-width: 401px) {\n  .routineControls {\n    gap: 16px;\n  }\n}\n`,
  },
  {
    name: "G6 · introducir ellipsis en el título",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /texto completo: título de rutina no puede usar ellipsis a 320px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.routineTitle h2,\n.routineTitle h3 {\n  text-overflow: ellipsis;\n}\n`,
  },
  {
    name: "G7 · ocultar overflow del título",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /texto completo: título de rutina no puede ocultar overflow a 320px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.routineTitle h2,\n.routineTitle h3 {\n  overflow: hidden;\n}\n`,
  },
  {
    name: "G8 · abreviar Miércoles",
    diskPath: "src/lib/training/training-day-order.ts",
    syntax: "ts",
    expectedFailure: /copy geométrico: no se permite abreviar ni alterar los días admitidos/,
    target: { kind: "audit", key: "trainingDayOrder" },
    mutate: (source) => replaceAuditOnce(source, '  "Miércoles",', '  "Mié.",'),
  },
  {
    name: "G9 · reducir tipografía bajo el mínimo aprobado",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /tipografía geométrica: el título debe medir exactamente 15px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.routineTitle h2,\n.routineTitle h3 {\n  font-size: 0.6rem;\n}\n`,
  },
  {
    name: "G10 · centrar controles en layout apilado",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /alineación apilada: selector y Editar deben permanecer juntos a la derecha/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n@media (max-width: 400px) {\n  .routineControls {\n    justify-content: center;\n  }\n}\n`,
  },
  {
    name: "G11 · aumentar título sobre 15px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /tipografía geométrica: el título debe medir exactamente 15px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n.routineTitle h2,\n.routineTitle h3 {\n  font-size: 16px;\n}\n`,
  },
  {
    name: "G12 · aumentar nombre de rutina sobre 15px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /nombre de rutina: el tamaño estructural debe medir exactamente 15px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => mutateCssRule(
      source,
      ".routineTitle.routineTitle p",
      "font-size: 15px;",
      "font-size: 16px;",
    ),
  },
  {
    name: "G13 · reducir selector bajo 92px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /selector de día: el ancho estructural debe medir exactamente 92px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => mutateCssRule(
      source,
      ".daySelector select",
      "width: 92px;",
      "width: 91px;",
    ),
  },
  {
    name: "G14 · aumentar selector sobre 92px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /selector de día: el ancho estructural debe medir exactamente 92px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => mutateCssRule(
      source,
      ".daySelector select",
      "width: 92px;",
      "width: 93px;",
    ),
  },
  {
    name: "G15 · reducir fuente del selector bajo 16px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /selector de día: 15px provoca autozoom en iOS/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => mutateCssRule(
      source,
      ".daySelector select",
      "font-size: 1rem;",
      "font-size: 15px;",
    ),
  },
  {
    name: "G16 · reducir target táctil del selector bajo 44px",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /selector de día: el target táctil estructural debe medir al menos 44px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => mutateCssRule(
      source,
      ".daySelector",
      "min-height: 44px;",
      "min-height: 43px;",
    ),
  },
  {
    name: "G17 · reducir fuente efectiva del selector en viewport amplio",
    diskPath: "src/features/active-workout/active-workout.module.css",
    syntax: "css",
    expectedFailure: /fuente efectiva del selector: 15px queda bajo 16px a 800px/,
    target: { kind: "audit", key: "workoutStyles" },
    mutate: (source) => `${source}\n@media (min-width: 800px) {\n  .daySelector select {\n    font-size: 15px;\n  }\n}\n`,
  },
];

for (const probe of trainUi01HeaderGeometryProbes) runTrainUi01IsolatedProbe(probe);

console.log(
  `TRAIN-UI-01 header geometry mutation probes passed (${trainUi01HeaderGeometryProbes.length}): ${trainUi01HeaderGeometryProbes.map((probe) => probe.name).join(" | ")}`,
);

const registration = "tsx src/features/active-workout/active-workout-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("active-workout controller runtime and visual static integration contract tests passed");
