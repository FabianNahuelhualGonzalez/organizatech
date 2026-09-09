import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAcceptedLoadRecommendation,
  recommendLoadFromRecentHistory,
  type ExerciseHistoryObservation,
} from "./recommendations";
import { createFixtureExercise, createFixtureSet } from "./test-fixtures";
import type { ExerciseDraft } from "./types";

const recentHistory: readonly ExerciseHistoryObservation[] = [
  { sessionId: "session-1", performedOn: "2026-10-01", loadKg: 100, completedReps: 10, toFailure: false },
  { sessionId: "session-2", performedOn: "2026-10-05", loadKg: 100, completedReps: 11, toFailure: true },
  { sessionId: "session-3", performedOn: "2026-10-10", loadKg: 102.5, completedReps: 9, toFailure: false },
  { sessionId: "old", performedOn: "2026-09-01", loadKg: 200, completedReps: 1, toFailure: true },
  { sessionId: "future", performedOn: "2026-10-14", loadKg: 200, completedReps: 1, toFailure: true },
  { sessionId: "invalid", performedOn: "2026-10-11", loadKg: 0, completedReps: 10, toFailure: true },
];

function exerciseWithSeries(
  reps: readonly number[],
  loads: readonly number[] = reps.map(() => 0),
): ExerciseDraft {
  return createFixtureExercise({
    id: "back-squat-plan",
    sourceExerciseId: "back-squat-lineage",
    loadBasis: "external",
    sets: reps.map((targetReps, index) => createFixtureSet({
      id: `planned-set-${index + 1}`,
      sourceSetId: `lineage-set-${index + 1}`,
      order: index + 1,
      targetReps,
      targetKg: loads[index] ?? 0,
    })),
  });
}

test("recomienda cargas reales por serie para objetivos 15/15/12/10", () => {
  const exercise = exerciseWithSeries([15, 15, 12, 10]);
  const result = recommendLoadFromRecentHistory({
    exercise,
    goal: "definition",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(result.available, true);
  if (!result.available) return;

  assert.deepEqual(
    result.setRecommendations.map((entry) => entry.targetReps),
    [15, 15, 12, 10],
  );
  assert.deepEqual(
    result.setRecommendations.map((entry) => entry.suggestedLoadKg),
    [84, 84, 90, 94.5],
  );
  assert.equal(new Set(result.setRecommendations.map((entry) => entry.suggestedLoadKg)).size, 3);
  for (const [index, entry] of result.setRecommendations.entries()) {
    assert.match(entry.explanation.join(" "), new RegExp(`Serie ${index + 1}`));
    assert.match(entry.explanation.join(" "), /no es una promesa/i);
    assert.equal(entry.estimatedRepsAtSuggestedLoad.qualifier, "estimate_not_guarantee");
    assert.equal(entry.estimatedRepsAtPlannedLoad, null);
  }
  assert.equal(result.binding.exerciseId, "back-squat-plan");
  assert.equal(result.binding.sourceExerciseId, "back-squat-lineage");
  assert.equal(result.binding.exerciseLineageId, "back-squat-lineage");
  assert.equal(result.source.windowStart, "2026-09-23");
  assert.equal(result.source.windowEnd, "2026-10-13");
  assert.equal(result.source.sampleCount, 3);
  assert.equal(result.source.sessionCount, 3);
  assert.equal(result.source.excludedSampleCount, 3);
  assert.equal(result.autoApply, false);
  assert.equal(result.requiresUserConfirmation, true);
  assert.match(result.explanation.join(" "), /estimaciones, no garantías/i);
  assert.equal(result.model.id, "epley_conservative_per_set_v2");
});

test("estima reps por serie al cambiar cargas y limita aumentos conservadoramente", () => {
  const exercise = exerciseWithSeries([10, 10, 10], [70, 100, 110]);
  const result = recommendLoadFromRecentHistory({
    exercise,
    goal: "definition",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(result.available, true);
  if (!result.available) return;

  assert.deepEqual(
    result.setRecommendations.map((entry) => entry.suggestedLoadKg),
    [73.5, 94.5, 94.5],
  );
  assert.equal(result.setRecommendations[0]?.increaseLimitApplied, true);
  assert.match(result.setRecommendations[0]?.explanation.join(" ") ?? "", /limitado a 5%/);
  assert.deepEqual(
    result.setRecommendations.map((entry) => entry.estimatedRepsAtPlannedLoad),
    [
      { min: 22, max: 27, qualifier: "estimate_not_guarantee" },
      { min: 5, max: 10, qualifier: "estimate_not_guarantee" },
      { min: 2, max: 7, qualifier: "estimate_not_guarantee" },
    ],
  );
  assert.ok((result.setRecommendations[0]?.suggestedLoadKg ?? Infinity) <= 70 * 1.05);
});

test("historial insuficiente no inventa cargas por serie", () => {
  const result = recommendLoadFromRecentHistory({
    exercise: exerciseWithSeries([5, 5]),
    goal: "strength",
    asOfDate: "2026-10-13",
    history: [recentHistory[0]],
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "insufficient_history");
  assert.deepEqual(result.setRecommendations, []);
  assert.equal(result.confidence, "none");
  assert.equal(result.autoApply, false);
  assert.match(result.explanation.join(" "), /No se aplicó ningún cambio/);
});

test("peso corporal queda fuera hasta tener carga efectiva comparable", () => {
  const result = recommendLoadFromRecentHistory({
    exercise: { ...exerciseWithSeries([10]), loadBasis: "bodyweight" },
    goal: "volume",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "unsupported_bodyweight");
  assert.deepEqual(result.setRecommendations, []);
});

test("entrada inválida o fuera de límites se expresa sin lanzar ni producir NaN", () => {
  const invalidDate = recommendLoadFromRecentHistory({
    exercise: exerciseWithSeries([10]),
    goal: "deload",
    asOfDate: "13/10/2026",
    history: recentHistory,
  });
  assert.equal(invalidDate.available, false);
  assert.equal(invalidDate.reason, "invalid_input");
  assert.deepEqual(invalidDate.setRecommendations, []);

  const excessiveReps = recommendLoadFromRecentHistory({
    exercise: exerciseWithSeries([16]),
    goal: "definition",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(excessiveReps.available, false);
  assert.equal(excessiveReps.reason, "invalid_input");

  const invalidPolicy = recommendLoadFromRecentHistory({
    exercise: exerciseWithSeries([10]),
    goal: "definition",
    asOfDate: "2026-10-13",
    history: recentHistory,
    policy: {
      windowDays: 21,
      minimumSessions: 2,
      minimumSamples: 3,
      mediumConfidenceSessions: 3,
      mediumConfidenceSamples: 6,
      highConfidenceSessions: 5,
      highConfidenceSamples: 10,
      maxObservedReps: 15,
      maxObservedLoadKg: 5_000,
      maxTargetReps: 15,
      maxEstimatedReps: 30,
      maxSuggestedLoadKg: 5_000,
      conservativePercentile: 0.25,
      safetyFactor: 0.95,
      loadIncrementKg: 0.5,
      repRangeUncertainty: 2,
      maxIncreaseFractionFromPlanned: 0.5,
    },
  });
  assert.equal(invalidPolicy.available, false);
  assert.equal(invalidPolicy.reason, "invalid_input");
});

test("confianza sube sólo con varias sesiones y baja variabilidad", () => {
  const history = Array.from({ length: 5 }, (_, sessionIndex) => [0, 1].map((setIndex) => ({
    sessionId: `s-${sessionIndex + 1}`,
    performedOn: `2026-10-${String(sessionIndex + 1).padStart(2, "0")}`,
    loadKg: 100,
    completedReps: 10,
    toFailure: setIndex === 1,
  }))).flat();
  const result = recommendLoadFromRecentHistory({
    exercise: exerciseWithSeries([12]),
    goal: "volume",
    asOfDate: "2026-10-13",
    history,
  });
  assert.equal(result.available, true);
  if (result.available) assert.equal(result.confidence, "high");
});

test("aplicar exige confirmación y conserva cargas distintas por serie", () => {
  const exercise = exerciseWithSeries([15, 15, 12, 10]);
  const recommendation = recommendLoadFromRecentHistory({
    exercise,
    goal: "definition",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(recommendation.available, true);
  if (!recommendation.available) return;
  const original = structuredClone(exercise);

  assert.deepEqual(applyAcceptedLoadRecommendation(exercise, recommendation, {
    accepted: false,
    recommendationId: recommendation.recommendationId,
  }), { ok: false, reason: "confirmation_required" });
  assert.deepEqual(applyAcceptedLoadRecommendation(exercise, recommendation, {
    accepted: true,
    recommendationId: "otra",
  }), { ok: false, reason: "recommendation_mismatch" });

  const applied = applyAcceptedLoadRecommendation(exercise, recommendation, {
    accepted: true,
    recommendationId: recommendation.recommendationId,
  });
  assert.equal(applied.ok, true);
  if (applied.ok) {
    assert.equal(applied.appliedByUser, true);
    assert.deepEqual(applied.exercise.sets.map((set) => set.targetKg), [84, 84, 90, 94.5]);
  }
  assert.deepEqual(exercise, original, "aceptar retorna una copia y no muta la entrada");
});

test("binding estricto impide aplicar recomendación del ejercicio A sobre B", () => {
  const exerciseA = exerciseWithSeries([12, 10]);
  const recommendation = recommendLoadFromRecentHistory({
    exercise: exerciseA,
    goal: "volume",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(recommendation.available, true);
  if (!recommendation.available) return;
  const acceptance = { accepted: true, recommendationId: recommendation.recommendationId } as const;

  const exerciseB = {
    ...structuredClone(exerciseA),
    id: "other-exercise",
    sourceExerciseId: "other-lineage",
  };
  assert.deepEqual(applyAcceptedLoadRecommendation(exerciseB, recommendation, acceptance), {
    ok: false,
    reason: "exercise_mismatch",
  });

  const wrongLineage = { ...structuredClone(exerciseA), sourceExerciseId: "other-lineage" };
  assert.deepEqual(applyAcceptedLoadRecommendation(wrongLineage, recommendation, acceptance), {
    ok: false,
    reason: "exercise_mismatch",
  });

  const withoutLineage = { ...structuredClone(exerciseA), sourceExerciseId: null };
  assert.deepEqual(applyAcceptedLoadRecommendation(withoutLineage, recommendation, acceptance), {
    ok: false,
    reason: "exercise_mismatch",
  });
});

test("cambiar reps, carga o linaje de serie invalida una recomendación anterior", () => {
  const exercise = exerciseWithSeries([12, 10], [80, 85]);
  const recommendation = recommendLoadFromRecentHistory({
    exercise,
    goal: "volume",
    asOfDate: "2026-10-13",
    history: recentHistory,
  });
  assert.equal(recommendation.available, true);
  if (!recommendation.available) return;
  const acceptance = { accepted: true, recommendationId: recommendation.recommendationId } as const;

  for (const changedSet of [
    { ...exercise.sets[0], targetReps: 11 },
    { ...exercise.sets[0], targetKg: 82.5 },
    { ...exercise.sets[0], sourceSetId: "other-set-lineage" },
  ]) {
    const changedExercise = { ...exercise, sets: [changedSet, exercise.sets[1]] };
    assert.deepEqual(applyAcceptedLoadRecommendation(changedExercise, recommendation, acceptance), {
      ok: false,
      reason: "plan_changed",
    });
  }
});

test("una recomendación no disponible nunca se puede aplicar", () => {
  const exercise = exerciseWithSeries([10]);
  const unavailable = recommendLoadFromRecentHistory({
    exercise,
    goal: "volume",
    asOfDate: "2026-10-13",
    history: [],
  });
  assert.deepEqual(applyAcceptedLoadRecommendation(exercise, unavailable, {
    accepted: true,
    recommendationId: "cualquiera",
  }), { ok: false, reason: "recommendation_unavailable" });
});
