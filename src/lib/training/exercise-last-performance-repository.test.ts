import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  mapLatestExercisePerformance,
  normalizeExerciseLineageId,
  normalizeHistoricalTimestamp,
  selectLatestCompletedSessionForLineage,
  type ExerciseLastPerformanceCandidateEntryRow,
  type ExerciseLastPerformanceEntryRow,
  type ExerciseLastPerformanceSessionRow,
} from "@/lib/training/exercise-last-performance-repository";

const repositorySource = readFileSync(
  "src/lib/training/exercise-last-performance-repository.ts",
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const LINEAGE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LINEAGE_ID = "22222222-2222-4222-8222-222222222222";

function session(
  id: string,
  overrides: Partial<ExerciseLastPerformanceSessionRow> = {},
): ExerciseLastPerformanceSessionRow {
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
  trainingSession: ExerciseLastPerformanceSessionRow,
  overrides: Partial<ExerciseLastPerformanceCandidateEntryRow> = {},
): ExerciseLastPerformanceCandidateEntryRow {
  return {
    id,
    user_id: trainingSession.user_id,
    session_id: trainingSession.id,
    exercise_lineage_id: LINEAGE_ID,
    weight: 80,
    previous_weight: 75,
    reps: [10, 9, 8],
    rir: "2",
    notes: null,
    created_at: trainingSession.created_at,
    training_sessions: trainingSession,
    ...overrides,
  };
}

function entry(
  id: string,
  trainingSession: ExerciseLastPerformanceSessionRow,
  overrides: Partial<ExerciseLastPerformanceEntryRow> = {},
): ExerciseLastPerformanceEntryRow {
  return {
    id,
    user_id: trainingSession.user_id,
    session_id: trainingSession.id,
    exercise_lineage_id: LINEAGE_ID,
    weight: 82.5,
    previous_weight: 80,
    reps: [10, 9, 8],
    rir: "1",
    notes: "control",
    created_at: trainingSession.created_at,
    ...overrides,
  };
}

function testLatestCompletedSessionByExactLineage() {
  const older = session("session-older", {
    completed_at: "2026-06-15T10:00:00.000Z",
    created_at: "2026-06-15T09:00:00.000Z",
  });
  const latest = session("session-latest", {
    completed_at: "2026-06-16T10:00:00.000Z",
    created_at: "2026-06-16T09:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [candidate("entry-older", older), candidate("entry-latest", latest)],
      { userId: USER_ID, exerciseLineageId: LINEAGE_ID },
    )?.id,
    "session-latest",
  );
}

function testRetrievesAllSeriesForLatestSession() {
  const trainingSession = session("session-series");
  const performance = mapLatestExercisePerformance(
    trainingSession,
    [
      entry("entry-b", trainingSession, {
        reps: [8],
        created_at: "2026-06-15T10:04:00.000Z",
      }),
      entry("entry-a", trainingSession, {
        reps: [10, 9],
        created_at: "2026-06-15T10:02:00.000Z",
      }),
    ],
    LINEAGE_ID,
  );

  assert.deepEqual(
    performance?.series.map((series) => ({
      entryId: series.entryId,
      order: series.order,
      reps: series.reps,
    })),
    [
      { entryId: "entry-a", order: 1, reps: 10 },
      { entryId: "entry-a", order: 2, reps: 9 },
      { entryId: "entry-b", order: 3, reps: 8 },
    ],
  );
}

function testDoesNotMixLineagesWithSameVisibleName() {
  const latestOtherLineage = session("session-other-lineage", {
    completed_at: "2026-06-16T10:00:00.000Z",
  });
  const olderExactLineage = session("session-exact-lineage", {
    completed_at: "2026-06-15T10:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [
        candidate("entry-other-lineage", latestOtherLineage, {
          exercise_lineage_id: OTHER_LINEAGE_ID,
        }),
        candidate("entry-exact-lineage", olderExactLineage),
      ],
      { userId: USER_ID, exerciseLineageId: LINEAGE_ID },
    )?.id,
    "session-exact-lineage",
  );
}

function testExcludesCurrentSession() {
  const current = session("session-current", {
    completed_at: "2026-06-16T10:00:00.000Z",
  });
  const previous = session("session-previous", {
    completed_at: "2026-06-15T10:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [candidate("entry-current", current), candidate("entry-previous", previous)],
      {
        userId: USER_ID,
        exerciseLineageId: LINEAGE_ID,
        currentSessionId: "session-current",
      },
    )?.id,
    "session-previous",
  );
}

function testAllowsEarlierSessionOnSameDay() {
  const laterSameDay = session("session-later", {
    trained_date: "2026-06-15",
    trained_at: "2026-06-15T16:00:00.000Z",
    completed_at: "2026-06-15T16:30:00.000Z",
    created_at: "2026-06-15T16:00:00.000Z",
  });
  const earlierSameDay = session("session-earlier", {
    trained_date: "2026-06-15",
    trained_at: "2026-06-15T09:00:00.000Z",
    completed_at: "2026-06-15T09:30:00.000Z",
    created_at: "2026-06-15T09:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [candidate("entry-later", laterSameDay), candidate("entry-earlier", earlierSameDay)],
      {
        userId: USER_ID,
        exerciseLineageId: LINEAGE_ID,
        beforeTimestamp: "2026-06-15T12:00:00.000Z",
      },
    )?.id,
    "session-earlier",
  );
}

function testExcludesNonCompletedAndDeletedSessions() {
  const skipped = session("session-skipped", {
    status: "skipped",
    completed_at: "2026-06-17T10:00:00.000Z",
  });
  const deleted = session("session-deleted", {
    completed_at: "2026-06-16T10:00:00.000Z",
    deleted_at: "2026-06-16T11:00:00.000Z",
  });
  const completed = session("session-completed", {
    completed_at: "2026-06-15T10:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [
        candidate("entry-skipped", skipped),
        candidate("entry-deleted", deleted),
        candidate("entry-completed", completed),
      ],
      { userId: USER_ID, exerciseLineageId: LINEAGE_ID },
    )?.id,
    "session-completed",
  );
}

function testExcludesOtherUser() {
  const otherUserSession = session("session-other-user", {
    user_id: OTHER_USER_ID,
    completed_at: "2026-06-16T10:00:00.000Z",
  });
  const ownSession = session("session-own", {
    completed_at: "2026-06-15T10:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [candidate("entry-other-user", otherUserSession), candidate("entry-own", ownSession)],
      { userId: USER_ID, exerciseLineageId: LINEAGE_ID },
    )?.id,
    "session-own",
  );
}

function testReturnsNullWithoutHistory() {
  assert.equal(
    selectLatestCompletedSessionForLineage(
      [],
      { userId: USER_ID, exerciseLineageId: LINEAGE_ID },
    ),
    null,
  );
}

function testReturnsNullForMissingLineage() {
  assert.equal(normalizeExerciseLineageId(null), null);
  assert.equal(normalizeExerciseLineageId(""), null);
  assert.equal(normalizeExerciseLineageId("not-a-uuid"), null);
}

function testWorksWithLegacyExerciseIdNull() {
  const trainingSession = session("session-exercise-id-null");
  const performance = mapLatestExercisePerformance(
    trainingSession,
    [entry("entry-exercise-id-null", trainingSession)],
    LINEAGE_ID,
  );

  assert.equal(performance?.exerciseLineageId, LINEAGE_ID);
  assert.equal(performance?.sessionId, "session-exercise-id-null");
}

function testDeterministicSessionAndEntryOrdering() {
  const sessionA = session("session-a", {
    completed_at: "2026-06-15T10:00:00.000Z",
    created_at: "2026-06-15T09:00:00.000Z",
  });
  const sessionB = session("session-b", {
    completed_at: "2026-06-15T10:00:00.000Z",
    created_at: "2026-06-15T09:00:00.000Z",
  });

  assert.equal(
    selectLatestCompletedSessionForLineage(
      [candidate("entry-a", sessionA), candidate("entry-b", sessionB)],
      { userId: USER_ID, exerciseLineageId: LINEAGE_ID },
    )?.id,
    "session-b",
  );

  const performance = mapLatestExercisePerformance(
    sessionA,
    [
      entry("entry-b", sessionA, { created_at: "2026-06-15T10:00:00.000Z", reps: [8] }),
      entry("entry-a", sessionA, { created_at: "2026-06-15T10:00:00.000Z", reps: [9] }),
    ],
    LINEAGE_ID,
  );

  assert.deepEqual(
    performance?.series.map((series) => series.entryId),
    ["entry-a", "entry-b"],
  );
}

function testTimestampNormalization() {
  assert.equal(normalizeHistoricalTimestamp("not-a-date"), null);
  assert.equal(
    normalizeHistoricalTimestamp(new Date("2026-06-15T10:00:00.000Z")),
    "2026-06-15T10:00:00.000Z",
  );
}

function testRepositoryDoesNotFallbackByNameOrExerciseId() {
  assert.doesNotMatch(repositorySource, /exerciseName|normalizedName|normalizeExerciseKey|getExerciseHistory/);
  assert.doesNotMatch(repositorySource, /\.eq\("exercise_id"/);
  assert.match(repositorySource, /\.eq\("exercise_lineage_id", exerciseLineageId\)/);
}

testLatestCompletedSessionByExactLineage();
testRetrievesAllSeriesForLatestSession();
testDoesNotMixLineagesWithSameVisibleName();
testExcludesCurrentSession();
testAllowsEarlierSessionOnSameDay();
testExcludesNonCompletedAndDeletedSessions();
testExcludesOtherUser();
testReturnsNullWithoutHistory();
testReturnsNullForMissingLineage();
testWorksWithLegacyExerciseIdNull();
testDeterministicSessionAndEntryOrdering();
testTimestampNormalization();
testRepositoryDoesNotFallbackByNameOrExerciseId();

console.log("exercise-last-performance-repository tests passed");
