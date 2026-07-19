import assert from "node:assert/strict";

import { buildExerciseLastObservationPresentation } from "@/lib/training/exercise-last-observation-presentation";

function testIdleBeforeAnyQuery() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: null,
    hasQueried: false,
  });

  assert.equal(presentation.status, "idle");
  assert.equal(presentation.historyLabel, "Última observación");
}

function testLoading() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: null,
    loading: true,
    hasQueried: true,
  });

  assert.equal(presentation.status, "loading");
  assert.equal(presentation.historyText.length > 0, true);
}

function testReadyWithText() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: {
      observation: "Buena ejecucion, subir peso",
      sessionId: "session-1",
      trainedDate: "2026-06-11",
      completedAt: "2026-06-11T13:00:00.000Z",
    },
    hasQueried: true,
  });

  assert.equal(presentation.status, "ready");
  assert.equal(presentation.historyText, "Buena ejecucion, subir peso");
}

function testEmptyWhenNoObservation() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: null,
    hasQueried: true,
  });

  assert.equal(presentation.status, "empty");
  assert.equal(presentation.historyText, "Sin observaciones anteriores.");
}

function testEmptyWhenObservationTextIsBlank() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: {
      observation: "   ",
      sessionId: "session-1",
      trainedDate: "2026-06-11",
      completedAt: "2026-06-11T13:00:00.000Z",
    },
    hasQueried: true,
  });

  assert.equal(presentation.status, "empty");
  assert.equal(presentation.historyText, "Sin observaciones anteriores.");
}

function testErrorIsNeutral() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: null,
    error: "relation exercise_entries: permission denied for role authenticated",
    hasQueried: true,
  });

  assert.equal(presentation.status, "error");
  assert.doesNotMatch(presentation.historyText, /permission denied|role authenticated|relation/);
}

function testLoadingTakesPrecedenceOverError() {
  const presentation = buildExerciseLastObservationPresentation({
    observation: null,
    loading: true,
    error: "algun error interno",
    hasQueried: true,
  });

  assert.equal(presentation.status, "loading");
}

testIdleBeforeAnyQuery();
testLoading();
testReadyWithText();
testEmptyWhenNoObservation();
testEmptyWhenObservationTextIsBlank();
testErrorIsNeutral();
testLoadingTakesPrecedenceOverError();

console.log("exercise-last-observation-presentation tests passed");
