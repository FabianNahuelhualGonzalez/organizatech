import assert from "node:assert/strict";

import {
  buildTrainingCoachFeedback,
  pickVariant,
  type TrainingCoachFeedback,
  type TrainingCoachFeedbackInput,
} from "@/lib/training/training-coach-feedback";

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    comparisonStatus: "first_reference",
    exercises: [exercise({ name: "Press plano" })],
  }));

  assert.equal(feedback.headline, "Primer punto de partida");
  assert.match(feedback.summary, /base/i);
  assert.equal(feedback.strengths[0]?.title, "Registro base creado");
  assert.equal(feedback.strengths[0]?.action, undefined);
  assert.equal(feedback.nextAdvice, "Repite esta base una vez más y busca mantener técnica, carga y repeticiones antes de acelerar la progresión.");
  assert.equal(feedback.confidence, "medium");
  assert.ok(feedback.sourceSignals.includes("first_reference"));
  assertNonEmptyFeedback(feedback);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    comparisonStatus: "first_reference",
    exercises: [exercise({ name: "prueba 17-06", kgDifference: 10, repsDifference: 12 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: 1500, volumePercentage: 25, repsDifference: 12, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.headline, "Primer punto de partida");
  assert.equal(feedback.strengths[0]?.title, "Registro base creado");
  assert.notEqual(feedback.strengths[0]?.title, "Progreso fuerte");
  assert.deepEqual(
    feedback.sourceSignals.filter((signal) => signal === "kg_up_reps_up" || signal === "volume_up" || signal === "kg_up_reps_down"),
    [],
    "first_reference no debe generar señales comparativas aunque lleguen diferencias",
  );
  assert.doesNotMatch(JSON.stringify(feedback), /Progreso fuerte|subió carga|subió reps|bajó volumen/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Sentadilla", kgDifference: 5, repsDifference: 4 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: 1200, volumePercentage: 12, repsDifference: 4, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.headline, "Progreso fuerte");
  assert.equal(feedback.tone, "positive");
  assert.equal(feedback.strengths[0]?.title, "Progreso fuerte");
  assert.ok(feedback.nextTarget?.includes("Sentadilla"));
  assertNonEmptyFeedback(feedback);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Press plano", kgDifference: 5, repsDifference: -3 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: -300, volumePercentage: -8, repsDifference: -3, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.headline, "Carga en consolidación");
  assert.equal(feedback.tone, "neutral");
  assert.equal(feedback.attentions[0]?.title, "Carga en consolidación");
  assert.match(feedback.nextAdvice, /recupera repeticiones|recuperar/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Remo", kgDifference: 0, repsDifference: 6 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: 600, volumePercentage: 10, repsDifference: 6, kgIncreasedExercises: 0 },
  }));

  assert.equal(feedback.headline, "Progreso limpio");
  assert.equal(feedback.strengths[0]?.title, "Progreso limpio");
  assert.equal(feedback.tone, "positive");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Press militar", kgDifference: 0, repsDifference: -2 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: -200, volumePercentage: -5, repsDifference: -2, kgIncreasedExercises: 0 },
  }));

  assert.ok(feedback.sourceSignals.includes("same_kg_reps_down"));
  assert.equal(feedback.attentions[0]?.title, "Posible fatiga");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Sentadilla", kgDifference: 0, repsDifference: 0 })],
    workout: { completedExercises: 4, totalExercises: 4, volumeDifference: -1500, volumePercentage: -18, repsDifference: 0, kgIncreasedExercises: 0 },
  }));

  assert.equal(feedback.headline, "Semana controlada");
  assert.ok(feedback.sourceSignals.includes("volume_down_complete"));
  assert.match(feedback.summary, /mixta|puntos buenos|señales/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Hack", kgDifference: 10, repsDifference: 2 })],
    workout: { completedExercises: 4, totalExercises: 4, volumeDifference: -5000, volumePercentage: -34, repsDifference: 2, kgIncreasedExercises: 2 },
  }));

  assert.notEqual(feedback.headline, "Progreso sólido");
  assert.equal(feedback.tone, "neutral");
  assert.ok(feedback.contradictionsResolved.includes("positive_load_with_strong_volume_drop"));
  assert.match(feedback.summary, /mixto|menos volumen/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    readiness: { sleep: 3, energy: 3.5, hydration: 5, motivation: 5 },
    exercises: [exercise({ name: "Press plano", kgDifference: 0, repsDifference: -5 })],
    workout: { completedExercises: 2, totalExercises: 3, volumeDifference: -2000, volumePercentage: -30, repsDifference: -5, kgIncreasedExercises: 0 },
  }));

  assert.ok(feedback.sourceSignals.includes("sleep_low_performance_low"));
  assert.equal(feedback.readinessInsight?.title, "Recuperación limitada");
  assert.ok(feedback.contradictionsResolved.includes("low_readiness_explains_low_performance"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    readiness: { sleep: 3, energy: 6, hydration: 5, motivation: 6 },
    exercises: [exercise({ name: "Sentadilla", kgDifference: 5, repsDifference: 3 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: 900, volumePercentage: 11, repsDifference: 3, kgIncreasedExercises: 1 },
  }));

  assert.ok(feedback.sourceSignals.includes("sleep_low_performance_high"));
  assert.equal(feedback.readinessInsight?.title, "Buen rendimiento pese al sueño");
  assert.ok(feedback.contradictionsResolved.includes("low_readiness_but_high_performance"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    readiness: { motivation: 6.5, hydration: 3, sleep: 5, energy: 5 },
    exercises: [exercise({ name: "Curl", kgDifference: 0, repsDifference: 0 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: 0, volumePercentage: 0, repsDifference: 0, kgIncreasedExercises: 0 },
  }));

  assert.ok(feedback.sourceSignals.includes("motivation_high_hydration_low"));
  assert.equal(feedback.readinessInsight?.title, "Hidratación a mejorar");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Press plano", kgDifference: 0, repsDifference: -8 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: -1000, volumePercentage: -15, repsDifference: -8, kgIncreasedExercises: 0 },
  }));

  assert.ok(feedback.sourceSignals.includes("strong_exercise_drop"));
  assert.equal(feedback.attentions[0]?.title, "Caída fuerte detectada");
  assert.ok(feedback.nextTarget?.includes("Press plano"));
}

{
  const input = baseInput({
    seed: "stable-seed",
    exercises: [exercise({ name: "Sentadilla", kgDifference: 5, repsDifference: 4 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: 1200, volumePercentage: 12, repsDifference: 4, kgIncreasedExercises: 1 },
  });
  const first = buildTrainingCoachFeedback(input);
  const second = buildTrainingCoachFeedback(input);

  assert.deepEqual(first, second, "misma entrada devuelve mismo feedback");
  assert.equal(pickVariant("pattern", "seed", ["a", "b", "c"]), pickVariant("pattern", "seed", ["a", "b", "c"]));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [
      exercise({ name: "Valor inválido", kgDifference: Number.NaN, repsDifference: Number.POSITIVE_INFINITY }),
      exercise({ name: "", kgDifference: 1, repsDifference: 1 }),
    ],
    workout: {
      completedExercises: Number.NaN,
      totalExercises: Number.POSITIVE_INFINITY,
      volumeDifference: Number.NEGATIVE_INFINITY,
      volumePercentage: Number.NaN,
      repsDifference: Number.NaN,
      kgIncreasedExercises: Number.NaN,
    },
  }));

  assertNoInvalidText(feedback);
  assertNonEmptyFeedback(feedback);
}

console.log("training-coach-feedback tests passed");

function baseInput(overrides: Partial<TrainingCoachFeedbackInput> = {}): TrainingCoachFeedbackInput {
  return {
    seed: "week-5-lunes",
    comparisonStatus: "ready",
    workout: {
      completedExercises: 2,
      totalExercises: 2,
      volumeDifference: 0,
      volumePercentage: 0,
      repsDifference: 0,
      kgIncreasedExercises: 0,
    },
    exercises: [exercise({ name: "Press plano" })],
    readiness: null,
    currentWeek: 5,
    referenceWeek: 4,
    ...overrides,
  };
}

function exercise(input: Partial<TrainingCoachExerciseInput>): TrainingCoachExerciseInput {
  return {
    id: input.id ?? input.name ?? "exercise",
    name: input.name ?? "Press plano",
    kgDifference: input.kgDifference ?? 0,
    repsDifference: input.repsDifference ?? 0,
    volumeDifference: input.volumeDifference ?? 0,
    volumePercentage: input.volumePercentage ?? 0,
  };
}

type TrainingCoachExerciseInput = NonNullable<TrainingCoachFeedbackInput["exercises"]>[number];

function assertNonEmptyFeedback(feedback: TrainingCoachFeedback) {
  assert.ok(feedback.headline.trim().length > 0);
  assert.ok(feedback.summary.trim().length > 0);
  assert.ok(feedback.nextAdvice.trim().length > 0);
}

function assertNoInvalidText(feedback: TrainingCoachFeedback) {
  const text = JSON.stringify(feedback);
  assert.doesNotMatch(text, /NaN|Infinity|-Infinity/);
  assert.doesNotMatch(text, /""/);
}
