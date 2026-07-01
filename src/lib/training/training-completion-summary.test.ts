import assert from "node:assert/strict";

import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";
import {
  buildTrainingCompletionSummary,
  calculateWorkoutDurationMinutes,
  formatDurationLabel,
} from "@/lib/training/training-completion-summary";

{
  const summary = buildTrainingCompletionSummary({
    sessionId: "session-current",
    dayLabel: "Lunes",
    workoutName: "Pecho Hombro Triceps 1",
    cycleLabel: "Macrociclo",
    weekLabel: "Semana 1",
    progressLabel: "1 de 7 dias",
    workoutStartedAt: "2026-07-01T10:00:00.000Z",
    savedAt: "2026-07-01T11:20:00.000Z",
    currentDate: "2026-07-01",
    exercises: [
      exercise("exercise-1", "Press militar", [12, 11, 10, ""], "50", "lineage-1"),
      exercise("exercise-long", "Nombre de ejercicio extremadamente largo para validar wrap", [8, 8], "25", "lineage-long"),
    ],
    historicalByExerciseId: {
      "exercise-1": {
        status: "ready",
        latest: performance({
          sessionId: "session-previous",
          exerciseLineageId: "lineage-1",
          trainedDate: "2026-06-24",
          reps: [10, 10, 10],
          weights: [45, 45, 45],
        }),
      },
      "exercise-long": { status: "first_reference", latest: null },
    },
  });

  assert.equal(summary.sessionId, "session-current");
  assert.equal(summary.dayLabel, "Lunes");
  assert.equal(summary.statusLabel, "Completado");
  assert.equal(summary.workoutName, "Pecho Hombro Triceps 1");
  assert.equal(summary.cycleLabel, "Macrociclo");
  assert.equal(summary.weekLabel, "Semana 1");
  assert.equal(summary.progressLabel, "1 de 7 dias");
  assert.equal(summary.durationMinutes, 80);
  assert.equal(summary.durationLabel, "1 h 20 min");
  assert.equal(summary.exercises.length, 2, "soporta muchos ejercicios sin cambiar de modelo");

  const first = summary.exercises[0];
  assert.equal(first.exerciseId, "exercise-1");
  assert.equal(first.exerciseLineageId, "lineage-1");
  assert.equal(first.exerciseName, "Press militar");
  assert.equal(first.currentSeriesCount, 3);
  assert.equal(first.currentTotalReps, 33);
  assert.equal(first.currentWeight, 50);
  assert.equal(first.currentWeightLabel, "50 kg");
  assert.equal(first.previousDateLabel, "24/06");
  assert.equal(first.previousSeriesCount, 3);
  assert.equal(first.previousTotalReps, 30);
  assert.equal(first.previousWeightLabel, "45 kg");
  assert.equal(first.repsDifference, 3);
  assert.equal(first.weightDifference, 5);
  assert.equal(first.repsTone, "positive");
  assert.equal(first.weightTone, "positive");
  assert.deepEqual(first.resultLines, [
    { label: "+3 reps", tone: "positive" },
    { label: "+5 kg", tone: "positive" },
  ]);

  const longName = summary.exercises[1];
  assert.equal(longName.exerciseName, "Nombre de ejercicio extremadamente largo para validar wrap");
  assert.equal(longName.comparisonStatus, "first_reference");
  assert.equal(longName.previousTotalReps, null);
  assert.equal(longName.previousWeightLabel, "—");
  assert.deepEqual(longName.resultLines, [
    { label: "Este será tu punto de partida.", tone: "neutral" },
    { label: "Cuando completes la próxima semana, podrás comparar tu progreso.", tone: "neutral" },
  ]);
}

{
  const summary = buildTrainingCompletionSummary({
    ...baseInput(),
    exercises: [
      exercise("negative", "Sentadillas", [10, 9], "90", "lineage-negative"),
      exercise("zero", "Press plano", [10, 10], "100", "lineage-zero"),
      exercise("range", "Hack", [10], "120", "lineage-range"),
      exercise("error", "Gemelos", [12], "80", "lineage-error"),
      exercise("invalid", "Curl", [Number.NaN, -1, 0, 8], "bad", "lineage-invalid"),
      exercise("mixed", "Press inclinado", [12, 12], "95", "lineage-mixed"),
    ],
    historicalByExerciseId: {
      negative: {
        status: "ready",
        latest: performance({
          sessionId: "session-prev-negative",
          exerciseLineageId: "lineage-negative",
          trainedDate: "2026-06-24",
          reps: [12, 12],
          weights: [100, 100],
        }),
      },
      zero: {
        status: "ready",
        latest: performance({
          sessionId: "session-prev-zero",
          exerciseLineageId: "lineage-zero",
          trainedDate: "2026-06-24",
          reps: [10, 10],
          weights: [100, 100],
        }),
      },
      range: {
        status: "ready",
        latest: performance({
          sessionId: "session-prev-range",
          exerciseLineageId: "lineage-range",
          trainedDate: "2026-06-24",
          reps: [10, 10],
          weights: [100, 120],
        }),
      },
      error: { status: "unavailable", latest: null },
      invalid: {
        status: "ready",
        latest: performance({
          sessionId: "session-prev-invalid",
          exerciseLineageId: "lineage-invalid",
          trainedDate: "2026-06-24",
          reps: [Number.NaN, 8],
          weights: [Number.POSITIVE_INFINITY],
        }),
      },
      mixed: {
        status: "ready",
        latest: performance({
          sessionId: "session-prev-mixed",
          exerciseLineageId: "lineage-mixed",
          trainedDate: "2026-06-24",
          reps: [10, 10],
          weights: [100, 100],
        }),
      },
    },
  });

  const negative = summary.exercises[0];
  assert.equal(negative.repsDifference, -5);
  assert.equal(negative.weightDifference, -10);
  assert.equal(negative.repsTone, "danger");
  assert.equal(negative.weightTone, "danger");
  assert.deepEqual(negative.resultLines, [
    { label: "-5 reps", tone: "danger" },
    { label: "-10 kg", tone: "danger" },
  ]);

  const zero = summary.exercises[1];
  assert.equal(Object.is(zero.repsDifference, -0), false);
  assert.equal(Object.is(zero.weightDifference, -0), false);
  assert.equal(zero.repsDifference, 0);
  assert.equal(zero.weightDifference, 0);
  assert.equal(zero.repsTone, "neutral");
  assert.equal(zero.weightTone, "neutral");
  assert.deepEqual(zero.resultLines, [
    { label: "Sin diferencias", tone: "neutral" },
  ]);

  const range = summary.exercises[2];
  assert.equal(range.previousWeightLabel, "100-120 kg");
  assert.equal(range.weightDifference, null, "peso historico no comparable no calcula diferencia arbitraria");

  const error = summary.exercises[3];
  assert.equal(error.comparisonStatus, "unavailable");
  assert.deepEqual(error.resultLines, [{ label: "Comparación no disponible", tone: "neutral" }]);

  const invalid = summary.exercises[4];
  assert.equal(invalid.currentTotalReps, 8, "ignora reps invalidas sin NaN ni Infinity");
  assert.equal(invalid.previousTotalReps, 8);
  assert.equal(invalid.currentWeight, null);
  assert.equal(invalid.weightDifference, null);

  const mixed = summary.exercises[5];
  assert.equal(mixed.repsDifference, 4);
  assert.equal(mixed.weightDifference, -5);
  assert.deepEqual(mixed.resultLines, [
    { label: "+4 reps", tone: "positive" },
    { label: "-5 kg", tone: "danger" },
  ]);
}

assert.equal(formatDurationLabel(48), "48 min");
assert.equal(formatDurationLabel(80), "1 h 20 min");
assert.equal(formatDurationLabel(120), "2 h");
assert.equal(formatDurationLabel(360), "6 h");
assert.equal(formatDurationLabel(361), "6 h 1 min");
assert.equal(formatDurationLabel(null), "Duración no disponible");
assert.equal(calculateWorkoutDurationMinutes(new Date("2026-07-01T10:00:00Z"), new Date("2026-07-01T10:48:00Z")), 48);
assert.equal(calculateWorkoutDurationMinutes(null, new Date()), null);
assert.equal(calculateWorkoutDurationMinutes(new Date("bad"), new Date()), null);
assert.equal(calculateWorkoutDurationMinutes(new Date("2026-07-01T11:00:00Z"), new Date("2026-07-01T10:00:00Z")), null);
assert.equal(calculateWorkoutDurationMinutes(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T07:00:00Z")), 420);
assert.equal(formatDurationLabel(420), "7 h");
assert.equal(calculateWorkoutDurationMinutes(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T08:15:00Z")), 495);
assert.equal(formatDurationLabel(495), "8 h 15 min");

{
  const summary = buildTrainingCompletionSummary({
    ...baseInput(),
    sessionId: "legacy-session",
    exercises: [exercise("legacy", "Legacy", [10], "20", null)],
  });
  assert.equal(summary.sessionId, "legacy-session", "legacy genera el mismo modelo");
  assert.equal(summary.exercises[0].comparisonStatus, "first_reference");
}

{
  const summary = buildTrainingCompletionSummary({
    ...baseInput(),
    sessionId: "cycle-session",
    exercises: [exercise("cycle", "Cycle", [10], "20", "lineage-cycle")],
  });
  assert.equal(summary.sessionId, "cycle-session", "cycle-scoped genera el mismo modelo");
}

console.log("training-completion-summary tests passed");

function baseInput() {
  return {
    sessionId: "session-current",
    dayLabel: "Martes",
    workoutName: "Rutina",
    cycleLabel: "Mesociclo",
    weekLabel: "Semana 2",
    progressLabel: "2 de 5 dias",
    workoutStartedAt: "2026-07-01T10:00:00.000Z",
    savedAt: "2026-07-01T10:40:00.000Z",
    currentDate: "2026-07-01",
    exercises: [],
  };
}

function exercise(
  exerciseId: string,
  exerciseName: string,
  reps: Array<number | "">,
  weight: string,
  exerciseLineageId: string | null,
) {
  return {
    exerciseId,
    exerciseLineageId,
    exerciseName,
    targetSets: reps.length,
    draft: { reps, weight },
  };
}

function performance(input: {
  sessionId: string;
  exerciseLineageId: string;
  trainedDate: string;
  reps: number[];
  weights: number[];
}): LatestExercisePerformance {
  return {
    sessionId: input.sessionId,
    exerciseLineageId: input.exerciseLineageId,
    trainedDate: input.trainedDate,
    trainedAt: `${input.trainedDate}T10:00:00.000Z`,
    completedAt: `${input.trainedDate}T11:00:00.000Z`,
    createdAt: `${input.trainedDate}T11:00:00.000Z`,
    series: input.reps.map((reps, index) => ({
      entryId: `${input.sessionId}-${index}`,
      order: index + 1,
      weight: input.weights[index] ?? null,
      previousWeight: null,
      reps,
      rir: null,
      notes: null,
      createdAt: `${input.trainedDate}T10:0${index}:00.000Z`,
    })),
  };
}
