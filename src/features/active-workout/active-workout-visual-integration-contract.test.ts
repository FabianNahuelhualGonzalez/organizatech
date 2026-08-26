import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  sheetBoundary: readSource("src/features/active-workout/components/ActiveWorkoutSheetBoundary.tsx"),
  registrationSheet: readSource("src/features/active-workout/components/ExerciseRegistrationSheet.tsx"),
  goals: readSource("src/features/active-workout/components/ExerciseGoalsCard.tsx"),
  workoutStyles: readSource("src/features/active-workout/active-workout.module.css"),
  exerciseDraft: readSource("src/lib/training/training-exercise-draft.ts"),
  metricGrid: readSource("src/ui/data-display/metric-grid.tsx"),
  workoutRegistration: readSource("src/lib/training/workout-registration.ts"),
  trainingDayOrder: readSource("src/lib/training/training-day-order.ts"),
};
const globalStyles = readSource("src/app/globals.css");

const protectedFileHashes = {
  "AGENTS.md": "f0c3ef88979a0ab085551a656ebb1843bfa56138d948ca4236bce6fcd1fa9dd0",
  "package.json": "c871dcb53cb1540ef7e5d117aac06702867df335dffb602c7e06dffd964ce0af",
  "package-lock.json": "3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5",
  "src/components/organizatech-app.tsx": "e89ae12f1db3be90c87171cbc3a7b61443dcbfea0bd128f76c13b07cc4049115",
  "src/features/progress/components/comparison-screen-v2.tsx": "bff390e44cf5a04fe59b0f2a594fcb53fb2a50602c850362f1a88ca136765743",
  "src/features/active-workout/model/active-workout-controller-state.ts": "37006210eabda3f99217bd98b6ebf876780ed5ecc33bb8fba936eda7fd085ea5",
  "src/features/active-workout/hooks/useActiveWorkoutController.ts": "c7b475636a3b8731a9e8b9a46702584b9c2a4a06333b75139791bf3ef2ce25bf",
  "src/features/active-workout/hooks/useActiveWorkoutBoundary.ts": "6b1b7812e15636a21ceb99949a21c88f245c921975d06512f18fd3911711e1cd",
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
assert.match(
  boundaryHookSource,
  /completionPublicationRef\.current\.status === "saving"[\s\S]*return "ignored";/,
  "completion debe conservar single-flight antes de publicar una revisión nueva",
);
assert.match(
  boundaryHookSource,
  /canRetryActiveWorkoutCompletion\(completionPublicationRef\.current\.status\)/,
  "retry debe consultar la publicación autoritativa y no un render stale",
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
  if (!["sheetBoundary", "registrationSheet", "performancePanel"].includes(label)) {
    assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/);
  }
}

// Cada componente se verifica contra su consumidor REAL: importado alli, renderizado alli, y
// nunca declarado inline en el root. TRAIN-UI-02 mantiene Guided presentacional y mueve el owner
// modal a ActiveWorkoutSheetBoundary; Sheet consume Goals e History sin introducir repositories.
const components = [
  ["TrainingReadinessScreen", "@/features/active-workout/components/TrainingReadinessScreen", appSource],
  ["TrainingStartScreen", "@/features/active-workout/components/TrainingStartScreen", appSource],
  ["TrainingCompletionSummaryScreen", "@/features/active-workout/components/TrainingCompletionSummaryScreen", appSource],
  ["GuidedTrainingScreen", "@/features/active-workout/components/GuidedTrainingScreen", appSource],
  ["ActiveWorkoutSheetBoundary", "@/features/active-workout/components/ActiveWorkoutSheetBoundary", files.guided],
  ["ExerciseRegistrationSheet", "@/features/active-workout/components/ExerciseRegistrationSheet", files.sheetBoundary],
  ["ExerciseLastPerformancePanel", "@/features/active-workout/components/ExerciseLastPerformancePanel", files.registrationSheet],
  ["ExerciseGoalsCard", "@/features/active-workout/components/ExerciseGoalsCard", files.registrationSheet],
] as const;
for (const [componentName, modulePath, consumerSource] of components) {
  assert.match(
    consumerSource,
    new RegExp(`import\\s*\\{[\\s\\S]*?\\b${componentName}\\b[\\s\\S]*?\\}\\s*from "${modulePath}";`),
  );
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
assert.match(files.performancePanel, /className=\{styles\.sheetObservationField\}/);
assert.match(files.goals, /className=\{styles\.sheetGoals\}/);

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
assert.equal(JSON.parse(packageSource).scripts.test.split(" && ").length, 128);

// TRAIN-UI-02 reemplaza la composición visual legacy sin mover ownership al root.
assert.match(
  files.guided,
  /export interface GuidedTrainingScreenProps extends ActiveWorkoutSheetBoundaryProps/,
);
assert.match(files.guided, /<ActiveWorkoutSheetBoundary \{\.\.\.props\} \/>/);
for (const forbiddenHook of [/\buseState\b/, /\buseEffect\b/, /\buseReducer\b/, /\buseRef\b/]) {
  assert.doesNotMatch(files.guided, forbiddenHook);
}
assert.match(files.sheetBoundary, /useState\(createActiveWorkoutSheetState\)/);
assert.match(files.sheetBoundary, /reconcileActiveWorkoutSheet\(sheetState, \{/);
assert.match(files.sheetBoundary, /role="listbox"/);
assert.match(files.sheetBoundary, /role="option"/);
assert.match(files.sheetBoundary, /normalizeExerciseDraft\(activeExercise, drafts\[activeExercise\.id\]\)/);
assert.match(files.sheetBoundary, /createActiveWorkoutRegistrationCommit\(activeExercise, draft\)/);
assert.match(files.sheetBoundary, /saveCompletedTrainingStatus === "error"/);
assert.match(files.sheetBoundary, /retrySaveCompletedTraining/);
assert.match(files.registrationSheet, /<ExerciseGoalsCard goals=\{goals\} \/>/);
assert.match(files.registrationSheet, /<ExerciseLastPerformancePanel/);
assert.match(files.registrationSheet, /inputMode="decimal"/);
assert.match(files.registrationSheet, /onCommitRegistration\(registrationCommit\)/);
assert.match(files.performancePanel, /historyStatus === "idle"/);
assert.match(files.performancePanel, /historyStatus === "loading"/);
assert.match(files.performancePanel, /historyStatus === "ready"/);
assert.match(files.performancePanel, /historyStatus === "empty"/);
assert.match(files.performancePanel, /onClick=\{retryHistory\}/);
assert.match(files.goals, /className=\{styles\.sheetGoals\}/);
assert.match(appSource, /latestExercisePerformanceStatus=\{latestExercisePerformanceStatus\}/);
assert.match(appSource, /retryExerciseHistory=\{retryExerciseHistory\}/);
assert.match(appSource, /saveCompletedTrainingStatus=\{activeWorkoutBoundary\.completionStatus\}/);
assert.match(appSource, /retrySaveCompletedTraining=\{activeWorkoutBoundary\.retryCompletion\}/);
assert.match(globalStyles, /--background:\s*#07101a;/i);
assert.doesNotMatch(files.workoutStyles, /overflow-x:\s*(?:auto|scroll)/);
assert.match(files.workoutStyles, /@container active-workout-routine \(max-width: 359px\)/);
assert.match(files.workoutStyles, /@container active-workout-sheet \(max-width: 359px\)/);
assert.match(files.workoutStyles, /@media \(prefers-reduced-motion: reduce\)/);


interface TrainUi02ReservedSources {
  guided: string;
  boundary: string;
  sheet: string;
  history: string;
  goals: string;
  styles: string;
  app: string;
  packageJson: string;
  globals: string;
}

const trainUi02Sources: TrainUi02ReservedSources = {
  guided: files.guided,
  boundary: files.sheetBoundary,
  sheet: files.registrationSheet,
  history: files.performancePanel,
  goals: files.goals,
  styles: files.workoutStyles,
  app: appSource,
  packageJson: packageSource,
  globals: globalStyles,
};

function assertProtectedIntegrity(sources: ProtectedFileSources = protectedFileSources) {
  for (const [path, expected] of Object.entries(protectedFileHashes) as Array<[ProtectedFilePath, string]>) {
    assert.equal(sha256(sources[path]), expected, `integridad byte a byte: cambió ${path}`);
  }
}

function auditTrainUi02(
  sources: TrainUi02ReservedSources,
  protectedSources: ProtectedFileSources = protectedFileSources,
) {
  assertProtectedIntegrity(protectedSources);
  assert.match(sources.guided, /export interface GuidedTrainingScreenProps extends ActiveWorkoutSheetBoundaryProps/, "TRAIN-UI-02: Guided debe conservar el contrato presentacional");
  assert.match(sources.guided, /<ActiveWorkoutSheetBoundary \{\.\.\.props\} \/>/, "TRAIN-UI-02: Guided debe delegar en el boundary feature-owned");
  assert.doesNotMatch(sources.guided, /\buse(?:State|Effect|LayoutEffect|Memo|Ref)\b/, "TRAIN-UI-02: Guided no puede recuperar ownership local");
  assert.match(sources.boundary, /useState\(createActiveWorkoutSheetState\)/, "TRAIN-UI-02: el estado del sheet debe pertenecer a la feature");
  assert.match(sources.boundary, /reconcileActiveWorkoutSheet\(sheetState, \{/, "TRAIN-UI-02: día, scope, identidad y selección deben reconciliarse");
  assert.match(sources.boundary, /inert=\{canMountSheet \? true : undefined\}/, "TRAIN-UI-02: inert sólo puede activarse con el sheet montado");
  assert.match(sources.boundary, /role="listbox"[\s\S]*role="option"[\s\S]*aria-selected=\{isSelected\}/, "TRAIN-UI-02: la lista debe conservar semántica y selección");
  assert.match(sources.boundary, /createActiveWorkoutRegistrationCommit\(activeExercise, draft\)/, "TRAIN-UI-02: registro y actualización deben usar el commit tipado");
  assert.match(sources.boundary, /saveCompletedTrainingStatus: ActiveWorkoutCompletionStatus/, "TRAIN-UI-02: el guardado final debe usar estado tipado");
  assert.match(sources.boundary, /saveCompletedTrainingStatus === "error"/, "TRAIN-UI-02: el error final debe provenir del estado productivo");
  assert.match(sources.app, /saveCompletedTrainingStatus=\{activeWorkoutBoundary\.completionStatus\}/, "TRAIN-UI-02: el root debe cablear el estado final");
  assert.match(sources.app, /retrySaveCompletedTraining=\{activeWorkoutBoundary\.retryCompletion\}/, "TRAIN-UI-02: el root debe cablear el retry final");
  assert.match(sources.app, /latestExercisePerformanceStatus=\{latestExercisePerformanceStatus\}/, "TRAIN-UI-02: empty no puede degradarse a idle");
  assert.match(sources.app, /retryExerciseHistory=\{retryExerciseHistory\}/, "TRAIN-UI-02: el root debe cablear el retry de historial");

  for (const state of ["idle", "loading", "ready", "empty"]) {
    assert.match(sources.history, new RegExp(`historyStatus === "${state}"`), `TRAIN-UI-02: falta historial ${state}`);
  }
  assert.match(sources.history, /No se pudo cargar el registro anterior\./, "TRAIN-UI-02: el historial debe usar copy neutral");
  assert.match(sources.history, /onClick=\{retryHistory\}/, "TRAIN-UI-02: el retry de historial debe ser real");
  assert.doesNotMatch(sources.history, /errorMessage|Es la primera vez/, "TRAIN-UI-02: no se permite backend crudo ni inferencias");

  assert.match(sources.sheet, /role="dialog"[\s\S]*aria-modal="true"/, "TRAIN-UI-02: el sheet debe conservar semántica modal");
  assert.match(sources.sheet, /event\.key === "Escape"[\s\S]*event\.key !== "Tab"/, "TRAIN-UI-02: el sheet debe conservar Escape y trap");
  assert.match(sources.sheet, /tabIndex=\{-1\}/, "TRAIN-UI-02: el scrim no puede entrar al tab order");

  assert.match(sources.styles, /\.guidedScreen \{[\s\S]*background: var\(--background\);/, "TRAIN-UI-02: el canvas debe usar el token global");
  assert.match(sources.styles, /width: min\(100%, 430px\)/, "TRAIN-UI-02: el sheet debe conservar ancho mobile");
  assert.match(sources.styles, /@container active-workout-routine \(max-width: 359px\)/, "TRAIN-UI-02: falta responsive compacto de rutina");
  assert.match(sources.styles, /@container active-workout-sheet \(max-width: 359px\)/, "TRAIN-UI-02: falta responsive compacto del sheet");
  assert.match(sources.styles, /@media \(prefers-reduced-motion: reduce\)/, "TRAIN-UI-02: falta reduced motion");
  assert.doesNotMatch(sources.styles, /overflow-x:\s*(?:auto|scroll)/, "TRAIN-UI-02: no se permite scroll horizontal");
  assert.doesNotMatch(sources.styles, /#07101a/i, "TRAIN-UI-02: la feature no puede duplicar el token de fondo");
  assert.match(sources.globals, /--background:\s*#07101a;/i, "TRAIN-UI-02: debe conservarse el fondo global aprobado");

  const visual = [sources.guided, sources.boundary, sources.sheet, sources.history, sources.goals].join("\n");
  assert.doesNotMatch(visual, /\bfetch\s*\(|@\/lib\/(?:supabase|storage|data)\/|-repository["']/, "TRAIN-UI-02: UI no puede importar orígenes de datos");
  assert.doesNotMatch(visual, /RoutineMetricGrid|<details|<summary|series-rep-grid/, "TRAIN-UI-02: no puede sobrevivir DOM legacy");

  const registeredScripts = Object.values(
    JSON.parse(sources.packageJson).scripts as Record<string, string>,
  ).join("\n");
  for (const path of [
    "src/features/active-workout/model/active-workout-sheet.test.ts",
    "src/features/active-workout/train-ui-02-visual-contract.test.ts",
  ]) {
    assert.equal(
      registeredScripts.split(path).length - 1,
      1,
      `TRAIN-UI-02: ${path} debe registrarse exactamente una vez`,
    );
  }
}

auditTrainUi02(trainUi02Sources);

type Probe = { name: string; target: keyof TrainUi02ReservedSources; expected: string; mutate(source: string): string };
function replaceOnce(source: string, search: string, replacement: string) {
  assert.equal(source.split(search).length - 1, 1, `mutación ambigua: ${search}`);
  return source.replace(search, replacement);
}

const probes: Probe[] = [
  { name: "ownership", target: "guided", expected: "TRAIN-UI-02: Guided no puede recuperar ownership local", mutate: (s) => s.replace("export function GuidedTrainingScreen", "const useState = true;\nexport function GuidedTrainingScreen") },
  { name: "reconciliación", target: "boundary", expected: "TRAIN-UI-02: día, scope, identidad y selección deben reconciliarse", mutate: (s) => replaceOnce(s, "reconcileActiveWorkoutSheet(sheetState, {", "reconcileRemoved(sheetState, {") },
  { name: "inert", target: "boundary", expected: "TRAIN-UI-02: inert sólo puede activarse con el sheet montado", mutate: (s) => replaceOnce(s, "inert={canMountSheet ? true : undefined}", "inert={true}") },
  { name: "error final", target: "boundary", expected: "TRAIN-UI-02: el error final debe provenir del estado productivo", mutate: (s) => s.replaceAll('saveCompletedTrainingStatus === "error"', 'notice === "error"') },
  { name: "retry final", target: "app", expected: "TRAIN-UI-02: el root debe cablear el retry final", mutate: (s) => replaceOnce(s, "retrySaveCompletedTraining={activeWorkoutBoundary.retryCompletion}", "retrySaveCompletedTraining={() => undefined}") },
  { name: "empty", target: "app", expected: "TRAIN-UI-02: empty no puede degradarse a idle", mutate: (s) => replaceOnce(s, "latestExercisePerformanceStatus={latestExercisePerformanceStatus}", 'latestExercisePerformanceStatus="idle"') },
  { name: "retry historial", target: "history", expected: "TRAIN-UI-02: el retry de historial debe ser real", mutate: (s) => replaceOnce(s, "onClick={retryHistory}", "onClick={() => undefined}") },
  { name: "modal", target: "sheet", expected: "TRAIN-UI-02: el sheet debe conservar semántica modal", mutate: (s) => replaceOnce(s, 'aria-modal="true"', 'aria-modal="false"') },
  { name: "scrim", target: "sheet", expected: "TRAIN-UI-02: el scrim no puede entrar al tab order", mutate: (s) => replaceOnce(s, "tabIndex={-1}", "tabIndex={0}") },
  { name: "ancho", target: "styles", expected: "TRAIN-UI-02: el sheet debe conservar ancho mobile", mutate: (s) => s.replaceAll("width: min(100%, 430px)", "width: min(100%, 480px)") },
  { name: "fondo", target: "styles", expected: "TRAIN-UI-02: la feature no puede duplicar el token de fondo", mutate: (s) => s.replace("background: var(--background);", "background: #07101a;") },
  { name: "legacy", target: "boundary", expected: "TRAIN-UI-02: no puede sobrevivir DOM legacy", mutate: (s) => s.replace("export function ActiveWorkoutSheetBoundary", "const RoutineMetricGrid = true;\nexport function ActiveWorkoutSheetBoundary") },
];

for (const probe of probes) {
  const original = trainUi02Sources[probe.target];
  const mutated = probe.mutate(original);
  assert.notEqual(mutated, original, `probe sin mutación: ${probe.name}`);
  let failure: unknown;
  try { auditTrainUi02({ ...trainUi02Sources, [probe.target]: mutated }); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error, `mutante sobreviviente: ${probe.name}`);
  assert.equal(failure.message.split("\n", 1)[0], probe.expected, `barrera incorrecta: ${probe.name}`);
}

console.log(`TRAIN-UI-02 reserved contract passed: ${probes.length}/${probes.length} mutantes muertos`);
