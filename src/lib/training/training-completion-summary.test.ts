import assert from "node:assert/strict";

import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  activeWorkoutCompletionMessages,
  buildCycleScopedWorkoutCompletionEntries,
  buildLegacyWorkoutCompletionEntries,
  captureActiveWorkoutCompletionContext,
  prepareActiveWorkoutCompletion,
  resolveActiveWorkoutCompletionMode,
  resolveActiveWorkoutCompletionStart,
} from "@/lib/training/active-workout-completion";
import type { CycleScopedTrainingPlan } from "@/lib/training/cycle-scoped-training-repository";
import type { LatestExercisePerformance } from "@/lib/training/exercise-last-performance-repository";
import {
  buildTrainingCompletionExerciseInputs,
  buildTrainingCompletionSummary,
  calculateWorkoutDurationMinutes,
  formatDurationLabel,
  loadTrainingCompletionHistoricalInputs,
} from "@/lib/training/training-completion-summary";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";

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

void runCompletionDecompositionTests();

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

async function runCompletionDecompositionTests() {
  const exercises = createCompletionExercises();
  const drafts = createCompletionDrafts();
  const cyclePlan = createCycleScopedPlan();
  const readinessContext = {
    workoutAttemptId: "attempt-1",
    cycleId: "cycle-1",
    cycleDayId: "cycle-day-1",
    workoutStartedAt: "2026-07-08T10:00:00.000Z",
    plannedDay: "wednesday",
    plannedDate: "2026-07-08",
  };

  assert.equal(resolveActiveWorkoutCompletionMode({
    repositoryActive: true,
    hasPersistedActiveCycle: true,
    cycleScopedActiveCycle: true,
  }), "cycle_scoped");
  for (const input of [
    { repositoryActive: false, hasPersistedActiveCycle: true, cycleScopedActiveCycle: true },
    { repositoryActive: true, hasPersistedActiveCycle: false, cycleScopedActiveCycle: true },
    { repositoryActive: true, hasPersistedActiveCycle: true, cycleScopedActiveCycle: false },
  ]) {
    assert.equal(resolveActiveWorkoutCompletionMode(input), "legacy");
  }

  assert.deepEqual(resolveActiveWorkoutCompletionStart(null), { kind: "prepare_completion" });
  const recoveredPending = {
    workoutAttemptId: "attempt-recovered",
    trainingSessionId: "session-recovered",
  };
  const recoveredDecision = resolveActiveWorkoutCompletionStart(recoveredPending);
  assert.deepEqual(recoveredDecision, {
    kind: "retry_pending_link",
    pendingLink: recoveredPending,
  });
  assert.notEqual(
    recoveredDecision.kind === "retry_pending_link" ? recoveredDecision.pendingLink : null,
    recoveredPending,
    "la decision captura el pending recuperado sin compartir su referencia",
  );

  const legacyPreparation = prepareActiveWorkoutCompletion({
    mode: "legacy",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: false,
    workoutAttemptId: null,
    readinessContext: null,
  });
  assert.equal(legacyPreparation.kind, "ready");
  assert.equal(legacyPreparation.kind === "ready" ? legacyPreparation.mode : null, "legacy");
  if (legacyPreparation.kind === "ready") {
    assert.notEqual(legacyPreparation.validExercises, exercises);
    assert.notEqual(legacyPreparation.validExercises[0], exercises[0]);
  }

  const invalidWorkout = prepareActiveWorkoutCompletion({
    mode: "legacy",
    exercises,
    drafts: { ...drafts, "exercise-2": { ...drafts["exercise-2"], registered: false } },
    shouldLinkWorkoutReadiness: false,
    workoutAttemptId: null,
    readinessContext: null,
  });
  assert.deepEqual(invalidWorkout, {
    kind: "blocked",
    message: "Registra todos los ejercicios antes de guardar el entrenamiento.",
  });

  const missingIdentity = prepareActiveWorkoutCompletion({
    mode: "cycle_scoped",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: true,
    workoutAttemptId: null,
    readinessContext,
    cycle: validCyclePreparationInput(cyclePlan),
  });
  assert.deepEqual(missingIdentity, {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.missingWorkoutIdentity,
  });
  for (const mismatchedIdentity of [
    { ...readinessContext, workoutAttemptId: "attempt-other" },
    { ...readinessContext, cycleId: "cycle-other" },
    { ...readinessContext, cycleDayId: "day-other" },
  ]) {
    assert.deepEqual(prepareActiveWorkoutCompletion({
      mode: "cycle_scoped",
      exercises,
      drafts,
      shouldLinkWorkoutReadiness: true,
      workoutAttemptId: "attempt-1",
      readinessContext: mismatchedIdentity,
      cycle: validCyclePreparationInput(cyclePlan),
    }), {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingWorkoutIdentity,
    }, "attempt, ciclo y dia deben pertenecer al mismo contexto capturado");
  }

  const missingPlan = prepareActiveWorkoutCompletion({
    mode: "cycle_scoped",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: false,
    workoutAttemptId: null,
    readinessContext: null,
    cycle: { ...validCyclePreparationInput(cyclePlan), plan: null },
  });
  assert.deepEqual(missingPlan, {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.missingCyclePlan,
  });

  const missingDay = prepareActiveWorkoutCompletion({
    mode: "cycle_scoped",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: false,
    workoutAttemptId: null,
    readinessContext: null,
    cycle: { ...validCyclePreparationInput(cyclePlan), plannedDay: "monday" },
  });
  assert.deepEqual(missingDay, {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.missingCycleDay,
  });

  const invalidRange = prepareActiveWorkoutCompletion({
    mode: "cycle_scoped",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: false,
    workoutAttemptId: null,
    readinessContext: null,
    cycle: { ...validCyclePreparationInput(cyclePlan), plannedStartDate: null },
  });
  assert.deepEqual(invalidRange, {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.invalidCycleRange,
  });

  const invalidDate = prepareActiveWorkoutCompletion({
    mode: "cycle_scoped",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: false,
    workoutAttemptId: null,
    readinessContext: null,
    cycle: { ...validCyclePreparationInput(cyclePlan), trainedDate: "fecha-invalida" },
  });
  assert.deepEqual(invalidDate, {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.invalidPlannedDate,
  });

  const cyclePreparation = prepareActiveWorkoutCompletion({
    mode: "cycle_scoped",
    exercises,
    drafts,
    shouldLinkWorkoutReadiness: true,
    workoutAttemptId: "attempt-1",
    readinessContext,
    cycle: validCyclePreparationInput(cyclePlan),
  });
  assert.equal(cyclePreparation.kind, "ready");
  assert.equal(cyclePreparation.kind === "ready" ? cyclePreparation.mode : null, "cycle_scoped");
  if (cyclePreparation.kind !== "ready" || cyclePreparation.mode !== "cycle_scoped") {
    throw new Error("cycle preparation fixture should be ready");
  }
  assert.equal(cyclePreparation.cycleDay.id, "cycle-day-1");
  assert.equal(cyclePreparation.plannedDate, "2026-07-08");
  assert.equal(cyclePreparation.weekNumber, 1);

  const draftsBeforeEntries = structuredClone(drafts);
  const exercisesBeforeEntries = structuredClone(exercises);
  const cycleEntries = buildCycleScopedWorkoutCompletionEntries({
    cycleId: "cycle-1",
    cycleDay: cyclePreparation.cycleDay,
    exercises,
    drafts,
    entryIds: ["entry-cycle-1", "entry-cycle-2"],
    dayLabel: "Miércoles",
    readinessNote: "Formulario de motivación omitido: usuario no quiso registrar.",
  });
  assert.equal(cycleEntries.kind, "ready");
  if (cycleEntries.kind !== "ready") throw new Error("cycle entries fixture should be ready");
  assert.deepEqual(cycleEntries.entries, [
    {
      id: "entry-cycle-1",
      trainingCycleExerciseId: "exercise-1",
      exerciseId: "legacy-exercise-1",
      exerciseLineageId: "lineage-1",
      weight: 42.5,
      previousWeight: 40,
      reps: [10, 9],
      rir: "2",
      notes: "Entrenamiento Miércoles: Rutina A. Formulario de motivación omitido: usuario no quiso registrar.",
      observation: "Control escapular",
    },
    {
      id: "entry-cycle-2",
      trainingCycleExerciseId: "exercise-2",
      exerciseId: null,
      exerciseLineageId: null,
      weight: 0,
      previousWeight: 0,
      reps: [0],
      rir: "",
      notes: "Entrenamiento Miércoles: Rutina A. Formulario de motivación omitido: usuario no quiso registrar.",
      observation: "",
    },
  ]);
  assert.deepEqual(drafts, draftsBeforeEntries, "el builder cycle-scoped no muta drafts");
  assert.deepEqual(exercises, exercisesBeforeEntries, "el builder cycle-scoped no muta ejercicios");

  for (const cycleDay of [
    { ...cyclePreparation.cycleDay, exercises: [{ ...cyclePreparation.cycleDay.exercises[0], cycleId: "cycle-other" }] },
    { ...cyclePreparation.cycleDay, exercises: [{ ...cyclePreparation.cycleDay.exercises[0], dayId: "day-other" }] },
    { ...cyclePreparation.cycleDay, exercises: [] },
  ]) {
    const isolated = buildCycleScopedWorkoutCompletionEntries({
      cycleId: "cycle-1",
      cycleDay,
      exercises: [exercises[0]],
      drafts,
      entryIds: ["entry-isolated"],
      dayLabel: "Miércoles",
      readinessNote: "Formulario de motivación no registrado.",
    });
    assert.deepEqual(isolated, {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingCycleExercise,
    });
    assert.equal("entries" in isolated, false, "un error cycle-scoped no expone payload parcial");
  }
  const noPartialCycleEntries = buildCycleScopedWorkoutCompletionEntries({
    cycleId: "cycle-1",
    cycleDay: {
      ...cyclePreparation.cycleDay,
      exercises: [cyclePreparation.cycleDay.exercises[0]],
    },
    exercises,
    drafts,
    entryIds: ["entry-first", "entry-missing"],
    dayLabel: "Miércoles",
    readinessNote: "Formulario de motivación no registrado.",
  });
  assert.deepEqual(noPartialCycleEntries, {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.missingCycleExercise,
  }, "un ejercicio posterior invalido descarta tambien la entrada previa");

  const legacyEntries = buildLegacyWorkoutCompletionEntries({
    exercises,
    drafts,
    previousEntries: [
      { exerciseId: "exercise-1", weight: 35 },
      { exerciseId: "exercise-other", weight: 99 },
      { exerciseId: "exercise-1", weight: 41 },
    ],
    entryIds: ["entry-legacy-1", "entry-legacy-2"],
    dayLabel: "Miércoles",
    readinessNote: "Formulario de motivación no registrado.",
  });
  assert.deepEqual(legacyEntries[0], {
    id: "entry-legacy-1",
    exerciseId: "exercise-1",
    exerciseName: "Press",
    routine: "Rutina A",
    targetSets: 2,
    targetReps: 10,
    weight: 42.5,
    previousWeight: 41,
    reps: [10, 9],
    rir: "2",
    notes: "Entrenamiento Miércoles: Rutina A. Formulario de motivación no registrado.",
    observation: "Control escapular",
  });
  assert.equal(legacyEntries[1].weight, 0, "cero mantiene la compatibilidad de peso");
  assert.deepEqual(legacyEntries[1].reps, [0], "cero mantiene la compatibilidad de reps");
  assert.deepEqual(drafts, draftsBeforeEntries, "el builder legacy no muta drafts");

  const captureInput = {
    shouldLinkWorkoutReadiness: true,
    activeRoutineDay: "Miércoles",
    activeExerciseIndex: 1,
    readiness: { skipped: false, motivation: 5, hydration: 6, sleep: 4, energy: 5 },
    exerciseDrafts: drafts,
    workoutAttemptId: "attempt-1",
    readinessContext,
    activeWorkoutStartedAt: "2026-07-08T09:00:00.000Z",
    fallbackCycleId: "cycle-fallback",
    fallbackCycleDayId: "day-fallback",
  } as const;
  const captureBefore = structuredClone(captureInput);
  const firstCapture = captureActiveWorkoutCompletionContext(captureInput);
  const secondCapture = captureActiveWorkoutCompletionContext(captureInput);
  assert.equal(firstCapture.kind, "ready");
  assert.deepEqual(captureInput, captureBefore, "capturar contexto no muta inputs");
  assert.deepEqual(firstCapture, secondCapture, "capturar contexto es determinista");
  if (firstCapture.kind !== "ready" || secondCapture.kind !== "ready") {
    throw new Error("capture fixture should be ready");
  }
  assert.equal(
    firstCapture.context.workoutStartedAt,
    readinessContext.workoutStartedAt,
    "V2 prioriza el workoutStartedAt del contexto de readiness",
  );
  assert.equal(firstCapture.context.cycleId, readinessContext.cycleId);
  assert.notEqual(firstCapture.context.exerciseDrafts, drafts);
  assert.notEqual(firstCapture.context.exerciseDrafts["exercise-1"].reps, drafts["exercise-1"].reps);
  assert.notEqual(firstCapture.context.exerciseDrafts, secondCapture.context.exerciseDrafts);
  assert.notEqual(firstCapture.context.readiness, captureInput.readiness);

  const legacyCaptureInput = {
    ...captureInput,
    shouldLinkWorkoutReadiness: false,
    activeWorkoutStartedAt: "2026-07-08T08:00:00.000Z",
    readinessContext: {
      ...readinessContext,
      workoutStartedAt: "2026-07-08T07:00:00.000Z",
    },
  } as const;
  const legacyCaptureBefore = structuredClone(legacyCaptureInput);
  const legacyCapture = captureActiveWorkoutCompletionContext(legacyCaptureInput);
  assert.equal(legacyCapture.kind, "ready");
  if (legacyCapture.kind !== "ready") throw new Error("legacy capture fixture should be ready");
  assert.equal(
    legacyCapture.context.workoutStartedAt,
    legacyCaptureInput.activeWorkoutStartedAt,
    "legacy ignora el workoutStartedAt de un contexto V2 residual",
  );
  assert.deepEqual(legacyCaptureInput, legacyCaptureBefore, "capturar contexto legacy no muta inputs");

  assert.deepEqual(captureActiveWorkoutCompletionContext({
    ...captureInput,
    readinessContext: null,
    activeWorkoutStartedAt: null,
  }), {
    kind: "blocked",
    message: activeWorkoutCompletionMessages.missingWorkoutStartedAt,
  });

  const summaryInputs = buildTrainingCompletionExerciseInputs({ exercises, drafts });
  assert.deepEqual(summaryInputs[0], {
    exerciseId: "exercise-1",
    exerciseLineageId: "lineage-1",
    exerciseName: "Press",
    targetSets: 2,
    draft: { weight: "42,5", reps: [10, 9] },
  });
  assert.notEqual(summaryInputs[0].draft?.reps, drafts["exercise-1"].reps);

  const historicalCalls: Array<{ exerciseLineageId: string; currentSessionId: string }> = [];
  const historical = await loadTrainingCompletionHistoricalInputs({
    currentSessionId: "session-current",
    exercises: [
      { id: "first", exerciseLineageId: null },
      { id: "ready", exerciseLineageId: "lineage-ready" },
      { id: "unavailable", exerciseLineageId: "lineage-error" },
    ],
    async loadLatestByLineage(input) {
      historicalCalls.push(input);
      if (input.exerciseLineageId === "lineage-error") throw new Error("historical unavailable");
      return performance({
        sessionId: "session-previous",
        exerciseLineageId: input.exerciseLineageId,
        trainedDate: "2026-07-01",
        reps: [10],
        weights: [40],
      });
    },
  });
  assert.equal(historical.first.status, "first_reference");
  assert.equal(historical.ready.status, "ready");
  assert.equal(historical.unavailable.status, "unavailable");
  assert.deepEqual(historicalCalls, [
    { exerciseLineageId: "lineage-ready", currentSessionId: "session-current" },
    { exerciseLineageId: "lineage-error", currentSessionId: "session-current" },
  ], "el histórico excluye la sesión actual y no consulta ejercicios sin lineage");

  console.log("training-completion-summary and active-workout-completion tests passed");
}

function createCompletionExercises(): ExerciseTemplate[] {
  return [
    {
      id: "exercise-1",
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      trainingCycleExerciseId: "exercise-1",
      exerciseLineageId: "lineage-1",
      sourceLegacyExerciseId: "legacy-exercise-1",
      routine: "Rutina A",
      day: "Miércoles",
      name: "Press",
      targetSets: 2,
      targetReps: 10,
      baseWeight: 40,
    },
    {
      id: "exercise-2",
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      trainingCycleExerciseId: "exercise-2",
      exerciseLineageId: null,
      sourceLegacyExerciseId: null,
      routine: "Rutina A",
      day: "Miércoles",
      name: "Remo",
      targetSets: 1,
      targetReps: 12,
      baseWeight: 0,
    },
  ];
}

function createCompletionDrafts(): Record<string, ExerciseDraft> {
  return {
    "exercise-1": {
      weight: "42,5",
      rir: "2",
      reps: [10, 9, 99],
      registered: true,
      observation: "Control escapular",
    },
    "exercise-2": {
      weight: "0",
      rir: "",
      reps: [0],
      registered: true,
      observation: "",
    },
  };
}

function createCycleScopedPlan(): CycleScopedTrainingPlan {
  return {
    routines: [{
      id: "routine-1",
      cycleId: "cycle-1",
      name: "Rutina A",
      sortOrder: 1,
      notes: null,
      days: [{
        id: "cycle-day-1",
        cycleId: "cycle-1",
        routineId: "routine-1",
        weekIndex: 1,
        dayCode: "wednesday",
        sortOrder: 1,
        notes: null,
        exercises: [{
          id: "exercise-1",
          cycleId: "cycle-1",
          dayId: "cycle-day-1",
          name: "Press",
          targetSets: 2,
          targetReps: 10,
          baseWeight: 40,
          sideWeight: null,
          sortOrder: 1,
          notes: null,
          sourceLegacyExerciseId: "legacy-exercise-1",
          exerciseLineageId: "lineage-1",
        }, {
          id: "exercise-2",
          cycleId: "cycle-1",
          dayId: "cycle-day-1",
          name: "Remo",
          targetSets: 1,
          targetReps: 12,
          baseWeight: 0,
          sideWeight: null,
          sortOrder: 2,
          notes: null,
          sourceLegacyExerciseId: null,
          exerciseLineageId: null,
        }],
      }],
    }],
  };
}

function validCyclePreparationInput(plan: CycleScopedTrainingPlan) {
  return {
    plan,
    cycleId: "cycle-1",
    plannedStartDate: "2026-07-06",
    plannedDay: "wednesday" as const,
    trainedDate: "2026-07-08",
  };
}
