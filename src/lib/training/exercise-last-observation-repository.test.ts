import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeExerciseLineageId,
  normalizeHistoricalTimestamp,
  normalizeObservationText,
  selectLatestNonEmptyObservation,
  type ExerciseLastObservationCandidateEntryRow,
  type ExerciseLastObservationSessionRow,
} from "@/lib/training/exercise-last-observation-repository";

const repositorySource = readFileSync(
  "src/lib/training/exercise-last-observation-repository.ts",
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const LINEAGE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LINEAGE_ID = "22222222-2222-4222-8222-222222222222";

function session(
  id: string,
  overrides: Partial<ExerciseLastObservationSessionRow> = {},
): ExerciseLastObservationSessionRow {
  return {
    id,
    user_id: USER_ID,
    status: "completed",
    trained_date: "2026-06-15",
    trained_at: "2026-06-15T10:00:00.000Z",
    completed_at: "2026-06-15T10:45:00.000Z",
    deleted_at: null,
    created_at: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function candidate(
  id: string,
  trainingSession: ExerciseLastObservationSessionRow,
  overrides: Partial<ExerciseLastObservationCandidateEntryRow> = {},
): ExerciseLastObservationCandidateEntryRow {
  return {
    id,
    user_id: trainingSession.user_id,
    session_id: trainingSession.id,
    exercise_lineage_id: LINEAGE_ID,
    observation: "Buena tecnica, mantener el tempo",
    created_at: trainingSession.created_at,
    training_sessions: trainingSession,
    ...overrides,
  };
}

function select(
  rows: ExerciseLastObservationCandidateEntryRow[],
  overrides: { currentSessionId?: string | null; beforeTimestamp?: string | null } = {},
) {
  return selectLatestNonEmptyObservation(rows, {
    userId: USER_ID,
    exerciseLineageId: LINEAGE_ID,
    ...overrides,
  });
}

function testReturnsMostRecentValidObservation() {
  const older = session("session-older", { completed_at: "2026-06-14T10:00:00.000Z" });
  const latest = session("session-latest", { completed_at: "2026-06-16T10:00:00.000Z" });

  const result = select([
    candidate("entry-older", older, { observation: "Observacion vieja" }),
    candidate("entry-latest", latest, { observation: "Observacion nueva" }),
  ]);

  assert.equal(result?.observation, "Observacion nueva");
  assert.equal(result?.sessionId, "session-latest");
}

function testTrimsResult() {
  const trainingSession = session("session-trim");
  const result = select([
    candidate("entry-trim", trainingSession, { observation: "   con espacios alrededor   " }),
  ]);

  assert.equal(result?.observation, "con espacios alrededor");
}

function testIgnoresNull() {
  const trainingSession = session("session-null");
  const result = select([candidate("entry-null", trainingSession, { observation: null })]);

  assert.equal(result, null);
}

function testIgnoresEmptyString() {
  const trainingSession = session("session-empty");
  const result = select([candidate("entry-empty", trainingSession, { observation: "" })]);

  assert.equal(result, null);
}

function testIgnoresWhitespaceOnly() {
  const trainingSession = session("session-whitespace");
  const result = select([candidate("entry-whitespace", trainingSession, { observation: "    " })]);

  assert.equal(result, null);
}

function testSkipsMostRecentEmptyAndFallsBackToOlder() {
  const latestEmpty = session("session-latest-empty", { completed_at: "2026-06-16T10:00:00.000Z" });
  const olderWithObservation = session("session-older-valid", { completed_at: "2026-06-14T10:00:00.000Z" });

  const result = select([
    candidate("entry-latest-empty", latestEmpty, { observation: "   " }),
    candidate("entry-older-valid", olderWithObservation, { observation: "Molestia leve en hombro" }),
  ]);

  assert.equal(result?.sessionId, "session-older-valid");
  assert.equal(result?.observation, "Molestia leve en hombro");
}

function testRespectsExerciseLineageId() {
  const trainingSession = session("session-lineage");
  const result = select([
    candidate("entry-other-lineage", trainingSession, {
      exercise_lineage_id: OTHER_LINEAGE_ID,
      observation: "No deberia aparecer",
    }),
  ]);

  assert.equal(result, null);
}

function testRespectsUserId() {
  const otherUserSession = session("session-other-user", { user_id: OTHER_USER_ID });
  const result = select([
    candidate("entry-other-user", otherUserSession, {
      user_id: OTHER_USER_ID,
      observation: "No deberia aparecer",
    }),
  ]);

  assert.equal(result, null);
}

function testExcludesNonCompletedSessions() {
  const skipped = session("session-skipped", { status: "skipped" });
  const result = select([candidate("entry-skipped", skipped, { observation: "No deberia aparecer" })]);

  assert.equal(result, null);
}

function testExcludesDeletedSessions() {
  const deleted = session("session-deleted", { deleted_at: "2026-06-16T11:00:00.000Z" });
  const result = select([candidate("entry-deleted", deleted, { observation: "No deberia aparecer" })]);

  assert.equal(result, null);
}

function testExcludesCurrentSession() {
  const current = session("session-current", { completed_at: "2026-06-16T10:00:00.000Z" });
  const previous = session("session-previous", { completed_at: "2026-06-15T10:00:00.000Z" });

  const result = select(
    [
      candidate("entry-current", current, { observation: "Actual, no deberia contar" }),
      candidate("entry-previous", previous, { observation: "Anterior valida" }),
    ],
    { currentSessionId: "session-current" },
  );

  assert.equal(result?.sessionId, "session-previous");
}

function testRespectsBeforeTimestamp() {
  const laterSameDay = session("session-later", { completed_at: "2026-06-15T16:30:00.000Z" });
  const earlierSameDay = session("session-earlier", { completed_at: "2026-06-15T09:30:00.000Z" });

  const result = select(
    [
      candidate("entry-later", laterSameDay, { observation: "Despues del corte" }),
      candidate("entry-earlier", earlierSameDay, { observation: "Antes del corte" }),
    ],
    { beforeTimestamp: "2026-06-15T12:00:00.000Z" },
  );

  assert.equal(result?.sessionId, "session-earlier");
}

function testDoesNotFallbackByName() {
  assert.doesNotMatch(
    repositorySource,
    /exerciseName|normalizedName|normalizeExerciseKey|getExerciseHistory/,
  );
}

function testDoesNotFallbackByExerciseId() {
  assert.doesNotMatch(repositorySource, /\.eq\("exercise_id"/);
  assert.match(repositorySource, /\.eq\("exercise_lineage_id", exerciseLineageId\)/);
}

function testDoesNotUseNotesAsObservation() {
  assert.doesNotMatch(repositorySource, /\bnotes\b/);
}

function testReturnsNullWhenNoValidObservationExists() {
  const trainingSession = session("session-no-observation");
  assert.equal(
    select([candidate("entry-no-observation", trainingSession, { observation: null })]),
    null,
  );
  assert.equal(select([]), null);
}

function testOrdersByDomainTemporalCriterion() {
  const fallsBackToTrainedAt = session("session-fallback-trained-at", {
    completed_at: null,
    trained_at: "2026-06-17T08:00:00.000Z",
  });
  const usesCompletedAt = session("session-with-completed-at", {
    completed_at: "2026-06-16T10:00:00.000Z",
    trained_at: "2026-06-10T08:00:00.000Z",
  });

  const result = select([
    candidate("entry-fallback", fallsBackToTrainedAt, { observation: "Usa trained_at" }),
    candidate("entry-completed", usesCompletedAt, { observation: "Usa completed_at" }),
  ]);

  assert.equal(result?.sessionId, "session-fallback-trained-at");
}

function testDoesNotMixUsersOrLineages() {
  const ownLatest = session("session-own-latest", { completed_at: "2026-06-16T10:00:00.000Z" });
  const otherUserLatest = session("session-other-user-latest", {
    user_id: OTHER_USER_ID,
    completed_at: "2026-06-17T10:00:00.000Z",
  });
  const ownOlderOtherLineage = session("session-own-other-lineage", {
    completed_at: "2026-06-15T10:00:00.000Z",
  });

  const result = select([
    candidate("entry-own-latest", ownLatest, { observation: "Propia y correcta" }),
    candidate("entry-other-user", otherUserLatest, {
      user_id: OTHER_USER_ID,
      observation: "De otro usuario, no deberia ganar",
    }),
    candidate("entry-other-lineage", ownOlderOtherLineage, {
      exercise_lineage_id: OTHER_LINEAGE_ID,
      observation: "De otro ejercicio, no deberia ganar",
    }),
  ]);

  assert.equal(result?.sessionId, "session-own-latest");
  assert.equal(result?.observation, "Propia y correcta");
}

function testNormalizeHelpers() {
  assert.equal(normalizeObservationText(null), null);
  assert.equal(normalizeObservationText(undefined), null);
  assert.equal(normalizeObservationText(""), null);
  assert.equal(normalizeObservationText("   "), null);
  assert.equal(normalizeObservationText("  hola  "), "hola");

  assert.equal(normalizeExerciseLineageId(null), null);
  assert.equal(normalizeExerciseLineageId("not-a-uuid"), null);
  assert.equal(normalizeExerciseLineageId(LINEAGE_ID.toUpperCase()), LINEAGE_ID);

  assert.equal(normalizeHistoricalTimestamp("not-a-date"), null);
  assert.equal(
    normalizeHistoricalTimestamp(new Date("2026-06-15T10:00:00.000Z")),
    "2026-06-15T10:00:00.000Z",
  );
}

testReturnsMostRecentValidObservation();
testTrimsResult();
testIgnoresNull();
testIgnoresEmptyString();
testIgnoresWhitespaceOnly();
testSkipsMostRecentEmptyAndFallsBackToOlder();
testRespectsExerciseLineageId();
testRespectsUserId();
testExcludesNonCompletedSessions();
testExcludesDeletedSessions();
testExcludesCurrentSession();
testRespectsBeforeTimestamp();
testDoesNotFallbackByName();
testDoesNotFallbackByExerciseId();
testDoesNotUseNotesAsObservation();
testReturnsNullWhenNoValidObservationExists();
testOrdersByDomainTemporalCriterion();
testDoesNotMixUsersOrLineages();
testNormalizeHelpers();

console.log("exercise-last-observation-repository tests passed");
