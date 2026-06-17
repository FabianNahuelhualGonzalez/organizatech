import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createExerciseLineageInsertPayload,
  resolveExerciseLineageIdForReplacement,
  resolveExerciseLineageIdForSessionEntry,
  shouldCreateExerciseLineage,
} from "@/lib/training/training-exercise-lineage";

const migration = readFileSync(
  "supabase/migrations/20260610_training_exercise_lineage.sql",
  "utf8",
);

function testReplacementKeepsLineage() {
  const previous = {
    id: "cycle-exercise-1",
    exerciseLineageId: "lineage-1",
  };

  assert.equal(resolveExerciseLineageIdForReplacement(previous), "lineage-1");
}

function testSessionEntrySnapshotsLineage() {
  const exercise = {
    id: "cycle-exercise-1",
    exerciseLineageId: "lineage-1",
  };

  assert.equal(resolveExerciseLineageIdForSessionEntry(exercise), "lineage-1");
}

function testNewPureScopedExerciseNeedsLineage() {
  assert.equal(shouldCreateExerciseLineage({ id: "cycle-exercise-1" }), true);
  assert.equal(shouldCreateExerciseLineage({ id: "cycle-exercise-1", exerciseLineageId: "lineage-1" }), false);
}

function testLegacyLineagePayload() {
  assert.deepEqual(
    createExerciseLineageInsertPayload({
      userId: "user-1",
      sourceLegacyExerciseId: "legacy-1",
    }),
    {
      user_id: "user-1",
      source_legacy_exercise_id: "legacy-1",
      origin_kind: "legacy",
    },
  );
}

function testScopedLineagePayload() {
  assert.deepEqual(
    createExerciseLineageInsertPayload({
      userId: "user-1",
      sourceLegacyExerciseId: null,
    }),
    {
      user_id: "user-1",
      source_legacy_exercise_id: null,
      origin_kind: "scoped",
    },
  );
}

function testMigrationContract() {
  assert.match(migration, /create table if not exists public\.training_exercise_lineages/);
  assert.match(migration, /exercise_lineage_id uuid null/);
  assert.match(migration, /training_cycle_exercises_exercise_lineage_user_fk/);
  assert.match(migration, /exercise_entries_exercise_lineage_user_fk/);
  assert.match(migration, /training_exercise_lineages_user_legacy_unique_idx/);
  assert.match(migration, /training_exercise_lineages_user_origin_cycle_exercise_unique_idx/);
  assert.match(migration, /create or replace function public\.create_training_cycle_with_plan/);
  assert.match(migration, /create or replace function public\.create_training_session_with_cycle_entries/);
  assert.match(migration, /exercise_lineage_id/);
}

testReplacementKeepsLineage();
testSessionEntrySnapshotsLineage();
testNewPureScopedExerciseNeedsLineage();
testLegacyLineagePayload();
testScopedLineagePayload();
testMigrationContract();

console.log("training-exercise-lineage tests passed");
