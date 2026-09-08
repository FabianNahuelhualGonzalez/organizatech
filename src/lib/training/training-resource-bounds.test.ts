import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MAX_TRAINING_EXERCISES_PER_DAY,
  MAX_TRAINING_SERIES_PER_EXERCISE,
  exceedsTrainingExerciseLimit,
  exceedsTrainingSeriesLimit,
} from "@/lib/training/training-resource-bounds";

test("preserva hasta 20 ejercicios diarios y rechaza el ejercicio 21", () => {
  assert.equal(MAX_TRAINING_EXERCISES_PER_DAY, 20);
  assert.equal(exceedsTrainingExerciseLimit(13), false);
  assert.equal(exceedsTrainingExerciseLimit(19), false);
  assert.equal(exceedsTrainingExerciseLimit(20), false);
  assert.equal(exceedsTrainingExerciseLimit(21), true);
  assert.equal(exceedsTrainingExerciseLimit(100_000), true);
});

test("mantiene un margen amplio para series pero evita arreglos abusivos", () => {
  assert.equal(MAX_TRAINING_SERIES_PER_EXERCISE, 64);
  assert.equal(exceedsTrainingSeriesLimit(1), false);
  assert.equal(exceedsTrainingSeriesLimit(20), false);
  assert.equal(exceedsTrainingSeriesLimit(64), false);
  assert.equal(exceedsTrainingSeriesLimit(65), true);
});

test("los dos repositorios aplican el preflight y los omitidos no envian entries", () => {
  const legacyRepository = readFileSync("src/lib/data/repository.ts", "utf8");
  const cycleRepository = readFileSync(
    "src/lib/training/cycle-scoped-training-repository.ts",
    "utf8",
  );

  assert.match(legacyRepository, /exceedsTrainingExerciseLimit\(input\.entries\.length\)/);
  assert.match(legacyRepository, /exceedsTrainingSeriesLimit\(entry\.reps\.length\)/);
  assert.match(cycleRepository, /exceedsTrainingExerciseLimit\(day\.exercises\.length\)/);
  assert.match(cycleRepository, /exceedsTrainingExerciseLimit\(input\.entries\.length\)/);
  assert.match(cycleRepository, /exceedsTrainingSeriesLimit\(entry\.reps\.length\)/);
  assert.match(
    cycleRepository,
    /p_entries:\s*input\.status === "completed"\s*\?[\s\S]*?: \[\],/,
  );
  assert.match(cycleRepository, /rpc\("apply_training_cycle_day_exercise_changes"/);
  assert.match(
    cycleRepository,
    /code === "P0001" \|\| code === "22023" \|\| code === "54000"/,
  );
  assert.doesNotMatch(
    cycleRepository,
    /\.from\("training_cycle_exercises"\)\s*\.insert\(additionsWithLineage/,
  );
});
