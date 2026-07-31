import type { TrainingSessionEntryInput } from "@/lib/data/repository";
import { parseDecimalWeightInput } from "@/lib/progress/weight-format";
import type {
  ExerciseMetrics,
  ExerciseTemplate,
  TrainingDayCode,
} from "@/lib/progress/types";
import {
  getCycleCalendarPlannedDate,
  getCycleCalendarWeekNumber,
} from "@/lib/training/cycle-calendar-week";
import type {
  CycleScopedDay,
  CycleScopedTrainingPlan,
  CycleScopedTrainingSessionEntryInput,
} from "@/lib/training/cycle-scoped-training-repository";
import {
  normalizeExerciseDraft,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import { isNonEmptyString } from "@/lib/training/training-workout-readiness-flow";
import {
  buildCurrentWorkoutSavePlan,
  incompleteCurrentWorkoutMessage,
} from "@/lib/training/workout-registration";
import type {
  ActiveWorkoutReadinessContext,
  PendingWorkoutReadinessLink,
} from "@/lib/training/workout-draft-storage";

export type ActiveWorkoutCompletionMode = "legacy" | "cycle_scoped";

export const activeWorkoutCompletionMessages = {
  missingWorkoutIdentity: "No pudimos recuperar la identidad del entrenamiento. Recarga e intenta nuevamente.",
  missingCyclePlan: "No se pudo cargar el plan cycle-scoped del ciclo activo. No se guardaran datos legacy.",
  missingCycleDay: "No se encontro el dia cycle-scoped activo. No se guardaran datos legacy.",
  invalidCycleRange: "El ciclo activo no tiene un rango planificado valido. No se guardaran datos legacy.",
  invalidPlannedDate: "No se pudo resolver la fecha planificada dentro del rango del ciclo. No se guardaran datos legacy.",
  missingCycleExercise: "No se encontro el ejercicio cycle-scoped planificado. No se guardaran datos legacy.",
  missingWorkoutStartedAt: "No pudimos recuperar la identidad temporal del entrenamiento. Recarga e intenta nuevamente.",
  mismatchedReadinessSession: "La vinculacion del formulario no coincide con la sesion guardada.",
  unconfirmedReadinessLink: "No pudimos confirmar la vinculacion del formulario con la sesion guardada.",
} as const;

export type ActiveWorkoutCompletionStartDecision =
  | { kind: "retry_pending_link"; pendingLink: PendingWorkoutReadinessLink }
  | { kind: "prepare_completion" };

export type PreparedActiveWorkoutCompletion =
  | {
    kind: "blocked";
    message: string;
  }
  | {
    kind: "ready";
    mode: "legacy";
    validExercises: ExerciseTemplate[];
  }
  | {
    kind: "ready";
    mode: "cycle_scoped";
    validExercises: ExerciseTemplate[];
    cycleId: string;
    cyclePlan: CycleScopedTrainingPlan;
    cycleDay: CycleScopedDay;
    plannedDay: TrainingDayCode;
    plannedDate: string;
    trainedDate: string;
    weekNumber: number;
  };

export interface ActiveWorkoutCompletionAsyncContext {
  activeRoutineDay: string;
  activeExerciseIndex: number;
  readiness: TrainingReadiness | null;
  exerciseDrafts: Record<string, ExerciseDraft>;
  workoutAttemptId: string | null;
  workoutStartedAt: string | null;
  cycleId: string | null;
  cycleDayId: string | null;
}

export type CapturedActiveWorkoutCompletion =
  | { kind: "blocked"; message: string }
  | { kind: "ready"; context: ActiveWorkoutCompletionAsyncContext };

export type CycleScopedCompletionEntriesResult =
  | { kind: "blocked"; message: string }
  | { kind: "ready"; entries: CycleScopedTrainingSessionEntryInput[] };

export type WorkoutReadinessLinkConfirmation =
  | { kind: "confirmed" }
  | { kind: "blocked"; message: string };

export function resolveActiveWorkoutCompletionMode(input: {
  repositoryActive: boolean;
  hasPersistedActiveCycle: boolean;
  cycleScopedActiveCycle: boolean;
}): ActiveWorkoutCompletionMode {
  return input.repositoryActive && input.hasPersistedActiveCycle && input.cycleScopedActiveCycle
    ? "cycle_scoped"
    : "legacy";
}

export function resolveActiveWorkoutCompletionStart(
  pendingLink: PendingWorkoutReadinessLink | null,
): ActiveWorkoutCompletionStartDecision {
  return pendingLink
    ? {
      kind: "retry_pending_link",
      pendingLink: {
        workoutAttemptId: pendingLink.workoutAttemptId,
        trainingSessionId: pendingLink.trainingSessionId,
      },
    }
    : { kind: "prepare_completion" };
}

export function prepareActiveWorkoutCompletion(input: {
  mode: ActiveWorkoutCompletionMode;
  exercises: readonly ExerciseTemplate[];
  drafts: Readonly<Record<string, ExerciseDraft | undefined>>;
  shouldLinkWorkoutReadiness: boolean;
  workoutAttemptId: string | null;
  readinessContext: ActiveWorkoutReadinessContext | null;
  cycle?: {
    plan: CycleScopedTrainingPlan | null;
    cycleId: string;
    plannedStartDate: string | null;
    plannedDay: TrainingDayCode;
    trainedDate: string;
  };
}): PreparedActiveWorkoutCompletion {
  if (input.shouldLinkWorkoutReadiness &&
    (!input.readinessContext ||
      !isNonEmptyString(input.workoutAttemptId) ||
      input.readinessContext.workoutAttemptId !== input.workoutAttemptId)) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingWorkoutIdentity,
    };
  }

  const savePlan = buildCurrentWorkoutSavePlan(input.exercises, input.drafts);
  if (!savePlan.canSave) {
    return {
      kind: "blocked",
      message: savePlan.message ?? incompleteCurrentWorkoutMessage,
    };
  }

  const validExercises = savePlan.validExercises.map(cloneExerciseTemplate);
  if (input.mode === "legacy") {
    return { kind: "ready", mode: "legacy", validExercises };
  }

  const cycle = input.cycle;
  if (!cycle?.plan) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingCyclePlan,
    };
  }

  const cycleDay = findCycleScopedCompletionDay(
    cycle.plan,
    cycle.cycleId,
    cycle.plannedDay,
  );
  if (!cycleDay) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingCycleDay,
    };
  }

  if (input.shouldLinkWorkoutReadiness &&
    (input.readinessContext?.cycleId !== cycle.cycleId ||
      input.readinessContext.cycleDayId !== cycleDay.id)) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingWorkoutIdentity,
    };
  }

  if (!cycle.plannedStartDate) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.invalidCycleRange,
    };
  }

  try {
    const weekNumber = getCycleCalendarWeekNumber(
      cycle.plannedStartDate,
      cycle.trainedDate,
    );
    const plannedDate = getCycleCalendarPlannedDate({
      plannedStartDate: cycle.plannedStartDate,
      weekNumber,
      plannedDay: cycleDay.dayCode,
    });

    return {
      kind: "ready",
      mode: "cycle_scoped",
      validExercises,
      cycleId: cycle.cycleId,
      cyclePlan: cycle.plan,
      cycleDay,
      plannedDay: cycle.plannedDay,
      plannedDate,
      trainedDate: cycle.trainedDate,
      weekNumber,
    };
  } catch {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.invalidPlannedDate,
    };
  }
}

export function buildLegacyWorkoutCompletionEntries(input: {
  exercises: readonly ExerciseTemplate[];
  drafts: Readonly<Record<string, ExerciseDraft | undefined>>;
  previousEntries: readonly Pick<ExerciseMetrics, "exerciseId" | "weight">[];
  entryIds: readonly string[];
  dayLabel: string;
  readinessNote: string;
}): TrainingSessionEntryInput[] {
  return input.exercises.map((exercise, index) => {
    const draft = normalizeExerciseDraft(exercise, input.drafts[exercise.id]);
    const previous = input.previousEntries
      .filter((entry) => entry.exerciseId === exercise.id)
      .at(-1);

    return {
      id: input.entryIds[index],
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      routine: exercise.routine,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      weight: readCompletionWeight(draft.weight),
      previousWeight: previous?.weight ?? exercise.baseWeight,
      reps: readCompletionReps(draft, exercise.targetSets),
      rir: draft.rir,
      notes: `Entrenamiento ${input.dayLabel}: ${exercise.routine}. ${input.readinessNote}`,
      observation: draft.observation,
    };
  });
}

export function buildCycleScopedWorkoutCompletionEntries(input: {
  cycleId: string;
  cycleDay: CycleScopedDay;
  exercises: readonly ExerciseTemplate[];
  drafts: Readonly<Record<string, ExerciseDraft | undefined>>;
  entryIds: readonly string[];
  dayLabel: string;
  readinessNote: string;
}): CycleScopedCompletionEntriesResult {
  const entries: CycleScopedTrainingSessionEntryInput[] = [];

  for (const [index, exercise] of input.exercises.entries()) {
    const cycleExercise = input.cycleDay.exercises.find((item) =>
      item.id === exercise.id &&
      item.cycleId === input.cycleId &&
      item.dayId === input.cycleDay.id);
    if (!cycleExercise) {
      return {
        kind: "blocked",
        message: activeWorkoutCompletionMessages.missingCycleExercise,
      };
    }

    const draft = normalizeExerciseDraft(exercise, input.drafts[exercise.id]);
    entries.push({
      id: input.entryIds[index],
      trainingCycleExerciseId: cycleExercise.id,
      exerciseId: cycleExercise.sourceLegacyExerciseId ?? null,
      exerciseLineageId: cycleExercise.exerciseLineageId,
      weight: readCompletionWeight(draft.weight),
      previousWeight: exercise.baseWeight,
      reps: readCompletionReps(draft, exercise.targetSets),
      rir: draft.rir,
      notes: `Entrenamiento ${input.dayLabel}: ${exercise.routine}. ${input.readinessNote}`,
      observation: draft.observation,
    });
  }

  return { kind: "ready", entries };
}

export function captureActiveWorkoutCompletionContext(input: {
  shouldLinkWorkoutReadiness: boolean;
  activeRoutineDay: string;
  activeExerciseIndex: number;
  readiness: TrainingReadiness | null;
  exerciseDrafts: Readonly<Record<string, ExerciseDraft>>;
  workoutAttemptId: string | null;
  readinessContext: ActiveWorkoutReadinessContext | null;
  activeWorkoutStartedAt: string | null;
  fallbackCycleId: string | null;
  fallbackCycleDayId: string | null;
}): CapturedActiveWorkoutCompletion {
  const workoutStartedAt = input.shouldLinkWorkoutReadiness
    ? input.readinessContext?.workoutStartedAt ?? input.activeWorkoutStartedAt
    : input.activeWorkoutStartedAt;
  if (input.shouldLinkWorkoutReadiness && !isNonEmptyString(workoutStartedAt)) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.missingWorkoutStartedAt,
    };
  }

  return {
    kind: "ready",
    context: {
      activeRoutineDay: input.activeRoutineDay,
      activeExerciseIndex: input.activeExerciseIndex,
      readiness: cloneReadiness(input.readiness),
      exerciseDrafts: cloneExerciseDrafts(input.exerciseDrafts),
      workoutAttemptId: input.workoutAttemptId,
      workoutStartedAt,
      cycleId: input.readinessContext?.cycleId ?? input.fallbackCycleId,
      cycleDayId: input.readinessContext?.cycleDayId ?? input.fallbackCycleDayId,
    },
  };
}

export function resolveWorkoutReadinessLinkConfirmation(input: {
  pendingLink: PendingWorkoutReadinessLink;
  result: {
    trainingSessionId: string;
    linked: boolean;
    alreadyLinked: boolean;
  };
}): WorkoutReadinessLinkConfirmation {
  if (input.result.trainingSessionId !== input.pendingLink.trainingSessionId) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.mismatchedReadinessSession,
    };
  }
  if (!input.result.linked && !input.result.alreadyLinked) {
    return {
      kind: "blocked",
      message: activeWorkoutCompletionMessages.unconfirmedReadinessLink,
    };
  }
  return { kind: "confirmed" };
}

function findCycleScopedCompletionDay(
  plan: CycleScopedTrainingPlan,
  cycleId: string,
  dayCode: TrainingDayCode,
): CycleScopedDay | null {
  for (const routine of plan.routines) {
    const day = routine.days.find((item) =>
      item.cycleId === cycleId && item.dayCode === dayCode);
    if (day) return day;
  }
  return null;
}

function readCompletionWeight(value: string | number | "") {
  return parseDecimalWeightInput(value) ?? 0;
}

function readCompletionReps(draft: ExerciseDraft, targetSets: number) {
  return draft.reps
    .slice(0, targetSets)
    .map((value) => Number(value) || 0);
}

function cloneReadiness(value: TrainingReadiness | null): TrainingReadiness | null {
  if (!value) return null;
  return {
    motivation: value.motivation,
    hydration: value.hydration,
    sleep: value.sleep,
    energy: value.energy,
    skipped: value.skipped,
  };
}

function cloneExerciseTemplate(exercise: ExerciseTemplate): ExerciseTemplate {
  return {
    id: exercise.id,
    cycleId: exercise.cycleId,
    cycleDayId: exercise.cycleDayId,
    trainingCycleExerciseId: exercise.trainingCycleExerciseId,
    exerciseLineageId: exercise.exerciseLineageId,
    sourceLegacyExerciseId: exercise.sourceLegacyExerciseId,
    routine: exercise.routine,
    day: exercise.day,
    name: exercise.name,
    targetSets: exercise.targetSets,
    targetReps: exercise.targetReps,
    baseWeight: exercise.baseWeight,
    sideWeight: exercise.sideWeight,
    notes: exercise.notes,
  };
}

function cloneExerciseDrafts(
  drafts: Readonly<Record<string, ExerciseDraft>>,
): Record<string, ExerciseDraft> {
  return Object.fromEntries(Object.entries(drafts).map(([exerciseId, draft]) => [
    exerciseId,
    {
      weight: draft.weight,
      rir: draft.rir,
      reps: [...draft.reps],
      registered: draft.registered,
      observation: draft.observation,
    },
  ]));
}
