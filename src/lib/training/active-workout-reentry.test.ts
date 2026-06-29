import assert from "node:assert/strict";

import {
  canResumeActiveWorkoutFromMemory,
  resolveActiveWorkoutReentryDecision,
  shouldRetainActiveWorkoutAttemptState,
} from "@/lib/training/active-workout-reentry";

async function run() {
  const activeMemory = {
    attemptV2: true,
    hasStartedTraining: true,
    readiness: { skipped: false, motivation: 6, hydration: 6, sleep: 5, energy: 6 },
    activeWorkoutStartedAt: "2026-06-29T12:00:00.000Z",
    workoutAttemptId: "attempt-1",
    cycleId: "cycle-1",
    cycleDayId: "cycle-day-1",
  };

  assert.equal(canResumeActiveWorkoutFromMemory(activeMemory), true);
  assert.equal(resolveActiveWorkoutReentryDecision(activeMemory, true), "resume-memory");
  assert.equal(resolveActiveWorkoutReentryDecision(activeMemory, false), "resume-memory");

  for (const state of [
    { ...activeMemory, hasStartedTraining: false },
    { ...activeMemory, readiness: null },
    { ...activeMemory, activeWorkoutStartedAt: null },
  ]) {
    assert.equal(canResumeActiveWorkoutFromMemory(state), false);
    assert.equal(resolveActiveWorkoutReentryDecision(state, true), "restore-draft");
    assert.equal(resolveActiveWorkoutReentryDecision(state, false), "start-readiness");
  }

  for (const state of [
    { ...activeMemory, workoutAttemptId: null },
    { ...activeMemory, cycleId: null },
    { ...activeMemory, cycleDayId: null },
  ]) {
    assert.equal(canResumeActiveWorkoutFromMemory(state), false);
    assert.equal(resolveActiveWorkoutReentryDecision(state, true), "restore-draft");
    assert.equal(resolveActiveWorkoutReentryDecision(state, false), "start-readiness");
  }

  const legacyMemory = {
    ...activeMemory,
    attemptV2: false,
    workoutAttemptId: null,
    cycleId: null,
    cycleDayId: null,
  };
  assert.equal(canResumeActiveWorkoutFromMemory(legacyMemory), true);
  assert.equal(resolveActiveWorkoutReentryDecision(legacyMemory, false), "resume-memory");

  assert.equal(
    resolveActiveWorkoutReentryDecision({
      attemptV2: true,
      hasStartedTraining: false,
      readiness: null,
      activeWorkoutStartedAt: null,
      workoutAttemptId: null,
      cycleId: null,
      cycleDayId: null,
    }, false),
    "start-readiness",
  );

  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "dashboard", hasStartedTraining: true }), true);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "comparacion", hasStartedTraining: true }), true);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "historial-ciclos", hasStartedTraining: true }), true);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "perfil", hasStartedTraining: true }), true);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "dashboard", hasStartedTraining: false }), false);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "entrenamiento", hasStartedTraining: true }), false);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "login", hasStartedTraining: true }), false);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "registro", hasStartedTraining: true }), false);
  assert.equal(shouldRetainActiveWorkoutAttemptState({ screen: "registro-entrenamiento", hasStartedTraining: true }), false);

  console.log("active workout reentry tests passed");
}

void run();
