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
    exercises: [exercise({ name: "Press inclinado", kgDifference: 5, repsDifference: 0 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: 800, volumePercentage: 8, repsDifference: 0, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.headline, "Progreso fuerte");
  assert.equal(feedback.strengths[0]?.title, "Progreso fuerte");
  assert.match(feedback.strengths[0]?.body ?? "", /mantuvo o mejoró repeticiones/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Press plano", kgDifference: 5, repsDifference: -3 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: -300, volumePercentage: -8, repsDifference: -3, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.headline, "Progresión de carga detectada");
  assert.equal(feedback.tone, "neutral");
  assert.equal(feedback.attentions[0]?.title, "Progresión de carga detectada");
  assert.match(feedback.attentions[0]?.body ?? "", /subiste el peso|normal al aumentar carga/i);
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
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "prueba 24 06", kgDifference: 0, repsDifference: -10 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: -1000, volumePercentage: -15, repsDifference: -10, kgIncreasedExercises: 0 },
  }));

  assert.equal(feedback.attentions[0]?.body, "prueba 24 06 bajó 10 reps. Es el punto más importante a revisar.");
  assert.equal(feedback.nextTarget, "Suma al menos 1 rep más o intenta recuperar las 10 reps perdidas en prueba 24 06.");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Laterales polea", kgDifference: 5, repsDifference: -12 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: -600, volumePercentage: -10, repsDifference: -12, kgIncreasedExercises: 1 },
  }));

  assert.ok(feedback.sourceSignals.includes("kg_up_reps_down"));
  assert.ok(!feedback.sourceSignals.includes("strong_exercise_drop"));
  assert.equal(feedback.attentions[0]?.title, "Progresión de carga detectada");
  assert.doesNotMatch(JSON.stringify(feedback), /Caída fuerte detectada|punto más importante a revisar/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Remo", kgDifference: 0, repsDifference: -1 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: -100, volumePercentage: -2, repsDifference: -1, kgIncreasedExercises: 0 },
  }));

  assert.equal(feedback.nextTarget, undefined, "una caida leve no crea objetivo de recuperacion fuerte");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Press militar", kgDifference: 5, repsDifference: -1 })],
    workout: { completedExercises: 2, totalExercises: 2, volumeDifference: -100, volumePercentage: -2, repsDifference: -1, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.nextTarget, "Suma 1 rep más para recuperar tu marca anterior en Press militar.");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Sentadilla", kgDifference: 5, repsDifference: 4 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: 1200, volumePercentage: 12, repsDifference: 4, kgIncreasedExercises: 1 },
  }));

  assert.equal(feedback.nextTarget, "Objetivo próximo: sostener el progreso de Sentadilla una sesión más.");
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

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    comparisonStatus: "first_reference",
    weeklyTrend: trend([
      trendWeek({ week: 3, totalVolume: 1000, totalReps: 30 }),
    ], { phase: "first_reference", currentWeek: 3 }),
  }));

  assert.equal(feedback.historicalInsight, undefined);
  assert.equal(feedback.trendSummary, undefined);
  assert.equal(feedback.trendSignals, undefined);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 3, totalVolume: 1000, totalReps: 30 }),
      trendWeek({ week: 4, totalVolume: 1120, totalReps: 34 }),
    ], { phase: "initial_comparison", currentWeek: 4 }),
  }));

  assert.equal(feedback.historicalInsight, undefined);
  assert.ok(feedback.trendSignals?.includes("historical_initial_comparison"));
  assert.doesNotMatch(JSON.stringify(feedback), /progreso sostenido/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 3, totalVolume: 1000, totalReps: 30 }),
      trendWeek({ week: 4, totalVolume: 1060, totalReps: 32 }),
      trendWeek({ week: 5, totalVolume: 1140, totalReps: 35 }),
    ], { phase: "early_trend", currentWeek: 5 }),
  }));

  assert.equal(feedback.historicalInsight?.title, "Primera señal de tendencia");
  assert.match(feedback.historicalInsight?.body ?? "", /primera señal|prudencia/i);
  assert.equal(feedback.confidence, "medium");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, complianceRate: 100 }),
      trendWeek({ week: 2, totalVolume: 1100, totalReps: 32, complianceRate: 100 }),
      trendWeek({ week: 3, totalVolume: 1220, totalReps: 35, complianceRate: 100 }),
      trendWeek({ week: 4, totalVolume: 1350, totalReps: 39, complianceRate: 100 }),
    ], { phase: "reliable_history", currentWeek: 4 }),
  }));

  assert.equal(feedback.historicalInsight?.title, "Progreso sostenido");
  assert.ok(feedback.trendSignals?.includes("historical_sustained_progress"));
  assert.match(feedback.historicalInsight?.body ?? "", /En estas 4 semanas/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, complianceRate: 80 }),
      trendWeek({ week: 2, totalVolume: 1020, totalReps: 31, complianceRate: 90 }),
      trendWeek({ week: 3, totalVolume: 1060, totalReps: 31, complianceRate: 90 }),
    ], { phase: "early_trend", currentWeek: 3 }),
  }));

  assert.ok(feedback.trendSignals?.includes("historical_volume_up"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, averageKg: 100 }),
      trendWeek({ week: 2, totalVolume: 1010, totalReps: 30, averageKg: 101 }),
      trendWeek({ week: 3, totalVolume: 1020, totalReps: 30, averageKg: 102 }),
      trendWeek({ week: 4, totalVolume: 1005, totalReps: 30, averageKg: 106 }),
    ], { phase: "reliable_history", currentWeek: 4 }),
  }));

  assert.ok(feedback.trendSignals?.includes("historical_load_up"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, averageKg: 100 }),
      trendWeek({ week: 2, totalVolume: 1010, totalReps: 31, averageKg: 100 }),
      trendWeek({ week: 3, totalVolume: 1030, totalReps: 34, averageKg: 100 }),
      trendWeek({ week: 4, totalVolume: 1040, totalReps: 37, averageKg: 100 }),
    ], { phase: "reliable_history", currentWeek: 4 }),
  }));

  assert.ok(feedback.trendSignals?.includes("historical_reps_up"));
  assert.notEqual(feedback.historicalInsight?.title, "Carga en aumento");
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, averageKg: 100, complianceRate: 75 }),
      trendWeek({ week: 2, totalVolume: 1020, totalReps: 31, averageKg: 100, complianceRate: 80 }),
      trendWeek({ week: 3, totalVolume: 980, totalReps: 29, averageKg: 101, complianceRate: 75 }),
    ], { phase: "early_trend", currentWeek: 3 }),
  }));

  assert.ok(feedback.trendSignals?.includes("historical_stable_low_progress"));
  assert.doesNotMatch(JSON.stringify(feedback), /estancado/i);
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, averageKg: 100, complianceRate: 100 }),
      trendWeek({ week: 2, totalVolume: 1010, totalReps: 30, averageKg: 100, complianceRate: 100 }),
      trendWeek({ week: 3, totalVolume: 995, totalReps: 31, averageKg: 100, complianceRate: 100 }),
      trendWeek({ week: 4, totalVolume: 1005, totalReps: 30, averageKg: 100, complianceRate: 100 }),
    ], { phase: "reliable_history", currentWeek: 4 }),
  }));

  assert.equal(feedback.historicalInsight?.title, "Constancia con poca progresión");
  assert.ok(feedback.trendSignals?.includes("historical_high_adherence_low_progress"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, complianceRate: 100 }),
      trendWeek({ week: 2, totalVolume: 1200, totalReps: 33, complianceRate: 100 }),
      trendWeek({ week: 3, totalVolume: 1350, totalReps: 36, complianceRate: 100 }),
      trendWeek({ week: 4, totalVolume: 900, totalReps: 28, complianceRate: 100 }),
    ], { phase: "reliable_history", currentWeek: 4, currentWeekComplete: true, isCurrentWeekInProgress: false }),
  }));

  assert.equal(feedback.historicalInsight?.title, "Progreso positivo con atención reciente");
  assert.ok(feedback.trendSignals?.includes("historical_recent_drop"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1000, totalReps: 30, complianceRate: 100 }),
      trendWeek({ week: 2, totalVolume: 1200, totalReps: 33, complianceRate: 100 }),
      trendWeek({ week: 3, totalVolume: 1350, totalReps: 36, complianceRate: 100 }),
      trendWeek({ week: 4, totalVolume: 900, totalReps: 28, complianceRate: 50 }),
    ], { phase: "reliable_history", currentWeek: 4, currentWeekComplete: false, isCurrentWeekInProgress: true }),
  }));

  assert.ok(!feedback.trendSignals?.includes("historical_recent_drop"));
  assert.ok(feedback.contradictionsResolved.includes("recent_drop_blocked_by_incomplete_week"));
}

{
  const feedback = buildTrainingCoachFeedback(baseInput({
    exercises: [exercise({ name: "Sentadilla", kgDifference: 5, repsDifference: -8 })],
    workout: { completedExercises: 3, totalExercises: 3, volumeDifference: -1200, volumePercentage: -18, repsDifference: -8, kgIncreasedExercises: 2 },
    weeklyTrend: trend([
      trendWeek({ week: 1, totalVolume: 1200, totalReps: 35, averageKg: 100 }),
      trendWeek({ week: 2, totalVolume: 1150, totalReps: 34, averageKg: 102 }),
      trendWeek({ week: 3, totalVolume: 1100, totalReps: 32, averageKg: 104 }),
      trendWeek({ week: 4, totalVolume: 1050, totalReps: 30, averageKg: 107 }),
    ], { phase: "reliable_history", currentWeek: 4 }),
  }));

  assert.equal(feedback.historicalInsight?.title, "Progreso mixto");
  assert.ok(feedback.trendSignals?.includes("historical_mixed_progress"));
  assert.doesNotMatch(feedback.nextAdvice, /subir peso/i);
}

{
  const input = baseInput({
    seed: "historical-stable",
    weeklyTrend: trend([
      trendWeek({ week: 3, totalVolume: 1000, totalReps: 30 }),
      trendWeek({ week: 4, totalVolume: 1100, totalReps: 33 }),
      trendWeek({ week: 5, totalVolume: 1200, totalReps: 35 }),
    ], { phase: "early_trend", currentWeek: 5 }),
  });

  assert.deepEqual(buildTrainingCoachFeedback(input), buildTrainingCoachFeedback(input));
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

function trend(
  weeks: NonNullable<TrainingCoachFeedbackInput["weeklyTrend"]>["weeks"],
  input: Partial<NonNullable<TrainingCoachFeedbackInput["weeklyTrend"]>> = {},
): NonNullable<TrainingCoachFeedbackInput["weeklyTrend"]> {
  const availableWeeks = input.availableWeeks ?? weeks.map((week) => week.week);
  return {
    phase: input.phase ?? (weeks.length >= 4 ? "reliable_history" : weeks.length === 3 ? "early_trend" : weeks.length === 2 ? "initial_comparison" : weeks.length === 1 ? "first_reference" : "no_history"),
    availableWeeks,
    weekCount: input.weekCount ?? availableWeeks.length,
    currentWeek: input.currentWeek ?? availableWeeks[availableWeeks.length - 1] ?? 0,
    currentWeekComplete: input.currentWeekComplete ?? true,
    isCurrentWeekInProgress: input.isCurrentWeekInProgress ?? false,
    missingWeeks: input.missingWeeks ?? [],
    confidence: input.confidence ?? (weeks.length >= 4 ? "high" : weeks.length >= 3 ? "medium" : "low"),
    trendWindow: input.trendWindow ?? (availableWeeks.length > 0 ? {
      firstWeek: availableWeeks[0]!,
      lastWeek: availableWeeks[availableWeeks.length - 1]!,
      weekCount: availableWeeks.length,
    } : null),
    weeks,
  };
}

function trendWeek(input: Partial<NonNullable<TrainingCoachFeedbackInput["weeklyTrend"]>["weeks"][number]>): NonNullable<TrainingCoachFeedbackInput["weeklyTrend"]>["weeks"][number] {
  return {
    week: input.week ?? 1,
    totalVolume: input.totalVolume ?? 1000,
    totalReps: input.totalReps ?? 30,
    completedExercises: input.completedExercises ?? 2,
    totalExercises: input.totalExercises ?? 2,
    complianceRate: input.complianceRate ?? 100,
    averageKg: input.averageKg ?? 100,
    increasedLoadExercises: input.increasedLoadExercises ?? 0,
  };
}

function assertNonEmptyFeedback(feedback: TrainingCoachFeedback) {
  assert.ok(feedback.headline.trim().length > 0);
  assert.ok(feedback.summary.trim().length > 0);
  assert.ok(feedback.nextAdvice.trim().length > 0);
  if (feedback.historicalInsight) {
    assert.ok(feedback.historicalInsight.title.trim().length > 0);
    assert.ok(feedback.historicalInsight.body.trim().length > 0);
  }
}

function assertNoInvalidText(feedback: TrainingCoachFeedback) {
  const text = JSON.stringify(feedback);
  assert.doesNotMatch(text, /NaN|Infinity|-Infinity/);
  assert.doesNotMatch(text, /""/);
}
