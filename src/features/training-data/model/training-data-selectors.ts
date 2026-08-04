import type {
  ExerciseEntry,
  ExerciseTemplate,
  TrainingSession,
} from "@/lib/progress/types";
import {
  getSessionEffectiveCalendarWeekStart,
  getSessionEffectiveCycleWeekNumber,
} from "@/lib/training/cycle-calendar-week";
import { getCycleScopedDayRoutineName } from "@/lib/training/cycle-scoped-plan-edit";
import type { CycleScopedTrainingPlan } from "@/lib/training/cycle-scoped-training-repository";
import { dedupeExercisesByDayAndRoutine } from "@/lib/training/training-exercise-selection";
import {
  sortTrainingDaysByWeekOrder,
  TRAINING_DAY_LABELS,
} from "@/lib/training/training-day-order";
import { isTrainingCycleId } from "@/lib/training/training-cycle-id";
import {
  getTrainingPlanDurationField,
  getTrainingPlanObjectiveField,
} from "@/lib/training/training-plan-rules";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import { normalizeTrainingPlanInput } from "@/lib/training/training-plan-normalization";
import type {
  TrainingCycle,
  TrainingCycleSnapshot,
} from "@/lib/training/training-cycles-repository";

import {
  getTrainingDataResourceValue,
  type CycleScopedTrainingDataSnapshot,
  type PersistedTrainingCyclesSnapshot,
  type TrainingDataState,
} from "./training-data-state";

const CYCLE_RESOLUTION_MESSAGE = "Verificando el ciclo activo antes de mostrar rutinas.";
const CYCLE_LOADING_MESSAGE = "Cargando el plan operativo del ciclo activo.";
const CYCLE_EMPTY_MESSAGE = "El ciclo activo no tiene rutina, dia y ejercicio cycle-scoped cargados. No se mostraran datos legacy.";

export type TrainingDataBlockedReason =
  | "cycle-resolution"
  | "cycle-loading"
  | "cycle-empty"
  | "cycle-error";

interface TrainingDataViewBase {
  plan: TrainingPlan;
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  activeCycle: TrainingCycle | null;
  persistedCycleHistory: TrainingCycle[];
  cyclePlan: CycleScopedTrainingPlan | null;
  isCycleScoped: boolean;
}

export type TrainingDataView =
  | (TrainingDataViewBase & { mode: "legacy"; blockerMessage: "" })
  | (TrainingDataViewBase & { mode: "cycle-scoped"; blockerMessage: "" })
  | (TrainingDataViewBase & {
      mode: "blocked";
      reason: TrainingDataBlockedReason;
      blockerMessage: string;
    });

export function selectTrainingDataView(
  state: TrainingDataState,
  legacyPlan: TrainingPlan,
): TrainingDataView {
  const appData = getTrainingDataResourceValue(state.appData);
  const legacyExercises = [...(appData?.exercises ?? [])];
  const legacyEntries = [...(appData?.entries ?? [])];
  const legacySessions = [...(appData?.sessions ?? [])];
  const cycles = getPersistedCyclesValue(state);
  const activeCycle = cycles?.active ?? null;
  const persistedCycleHistory = [...(cycles?.history ?? [])];
  const displayPlan = activeCycle
    ? createTrainingPlanFromPersistedCycle(activeCycle, legacyPlan)
    : legacyPlan;

  if (state.cycles.status === "disabled") {
    return createLegacyView(
      displayPlan,
      legacyExercises,
      legacyEntries,
      legacySessions,
      activeCycle,
      persistedCycleHistory,
    );
  }

  if (state.cycles.status === "idle" || state.cycles.status === "loading") {
    return createBlockedView(
      "cycle-resolution",
      CYCLE_RESOLUTION_MESSAGE,
      displayPlan,
      activeCycle,
      persistedCycleHistory,
    );
  }

  if (state.cycles.status === "error") {
    return createBlockedView(
      "cycle-error",
      state.cycles.message,
      displayPlan,
      activeCycle,
      persistedCycleHistory,
    );
  }

  if (!activeCycle || !isCycleScopedTrainingCycle(activeCycle)) {
    return createLegacyView(
      displayPlan,
      legacyExercises,
      legacyEntries,
      legacySessions,
      activeCycle,
      persistedCycleHistory,
    );
  }

  if (state.cycleScoped.status === "loading" || state.cycleScoped.status === "disabled") {
    return createBlockedView(
      "cycle-loading",
      CYCLE_LOADING_MESSAGE,
      displayPlan,
      activeCycle,
      persistedCycleHistory,
    );
  }

  if (state.cycleScoped.status === "error") {
    return createBlockedView(
      "cycle-error",
      state.cycleScoped.message,
      displayPlan,
      activeCycle,
      persistedCycleHistory,
    );
  }

  if (
    state.cycleScoped.cycleId !== activeCycle.id ||
    state.cycleScoped.snapshot.cycleId !== activeCycle.id
  ) {
    return createBlockedView(
      "cycle-loading",
      CYCLE_LOADING_MESSAGE,
      displayPlan,
      activeCycle,
      persistedCycleHistory,
    );
  }

  const cycleExercises = createExerciseTemplatesFromCycleScopedPlan(
    state.cycleScoped.snapshot.plan,
  );
  if (state.cycleScoped.status === "empty" || cycleExercises.length === 0) {
    return createBlockedView(
      "cycle-empty",
      state.cycleScoped.status === "empty"
        ? state.cycleScoped.message
        : CYCLE_EMPTY_MESSAGE,
      displayPlan,
      activeCycle,
      persistedCycleHistory,
      state.cycleScoped.snapshot.plan,
    );
  }

  return {
    mode: "cycle-scoped",
    plan: displayPlan,
    exercises: dedupeExercisesByDayAndRoutine(cycleExercises),
    entries: [...state.cycleScoped.snapshot.entries],
    sessions: [...state.cycleScoped.snapshot.sessions],
    activeCycle,
    persistedCycleHistory,
    cyclePlan: state.cycleScoped.snapshot.plan,
    isCycleScoped: true,
    blockerMessage: "",
  };
}

export function createExerciseTemplatesFromCycleScopedPlan(
  plan: CycleScopedTrainingPlan,
): ExerciseTemplate[] {
  return plan.routines.flatMap((routine) =>
    routine.days.flatMap((day) =>
      day.exercises.map((exercise) => ({
        id: exercise.id,
        cycleId: exercise.cycleId,
        cycleDayId: day.id,
        trainingCycleExerciseId: exercise.id,
        exerciseLineageId: exercise.exerciseLineageId,
        sourceLegacyExerciseId: exercise.sourceLegacyExerciseId,
        routine: getCycleScopedDayRoutineName(day.notes, routine.name),
        day: getSetupDayFromTrainingDayCode(day.dayCode),
        name: exercise.name,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        baseWeight: exercise.baseWeight,
        sideWeight: exercise.sideWeight ?? undefined,
        notes: exercise.notes ?? undefined,
      })),
    ),
  );
}

export function isCycleScopedTrainingCycle(cycle: TrainingCycle): boolean {
  const snapshotSource = readSnapshotString(cycle.planSnapshot, "source");
  return snapshotSource === "cycle-scoped-qa" || snapshotSource === "cycle-scoped";
}

export function createTrainingPlanFromPersistedCycle(
  cycle: TrainingCycle,
  fallback: TrainingPlan,
): TrainingPlan {
  const snapshot = cycle.planSnapshot;
  const nestedPlan = readSnapshotRecord(snapshot, "plan");
  const snapshotCycleType = readSnapshotString(snapshot, "cycleType");
  const cycleType = isTrainingCycleId(snapshotCycleType)
    ? snapshotCycleType
    : isTrainingCycleId(cycle.cycleType)
      ? cycle.cycleType
      : fallback.cycleType;
  const goal = readNonEmptyString(cycle.goal) ??
    readSnapshotString(snapshot, "goal") ??
    getPlanObjectiveValue(fallback);
  const duration = readSnapshotNumber(snapshot, "duration") ||
    readSnapshotNumber(snapshot, "durationWeeks");
  const directTrainingDays = readSnapshotStringList(
    snapshot,
    "trainingDays",
    TRAINING_DAY_LABELS.length,
  );
  const trainingDays = directTrainingDays.length > 0
    ? directTrainingDays
    : readSnapshotStringList(nestedPlan, "trainingDays", TRAINING_DAY_LABELS.length);
  const next: TrainingPlan = {
    ...fallback,
    cycleType,
    trainingDays: sortTrainingDaysByWeekOrder(
      trainingDays.length > 0 ? trainingDays : fallback.trainingDays,
    ),
  };
  const objectiveField = getTrainingPlanObjectiveField(cycleType);
  const durationField = getTrainingPlanDurationField(cycleType);
  next[objectiveField] = goal;
  if (duration > 0) next[durationField] = duration;

  const normalized = normalizeTrainingPlanInput(next);
  const invalidActiveObjective = normalized.repairs.some((repair) => (
    repair.code === "invalid_objective_replaced" && repair.field === objectiveField
  ));
  const invalidActiveDuration = normalized.repairs.some((repair) => (
    repair.code === "invalid_duration_replaced" && repair.field === durationField
  ));
  if (!invalidActiveObjective && !invalidActiveDuration) return normalized.plan;

  if (invalidActiveObjective) next[objectiveField] = fallback[objectiveField];
  if (invalidActiveDuration) next[durationField] = fallback[durationField];
  return normalizeTrainingPlanInput(next).plan;
}

export function getNextPersistedCycleNumber(
  activeCycle: TrainingCycle | null,
  history: readonly TrainingCycle[],
): number {
  const numbers = [
    activeCycle?.cycleNumber,
    ...history.map((cycle) => cycle.cycleNumber),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return Math.max(0, ...numbers) + 1;
}

export function normalizeCycleScopedSessionsByCalendarWeek(
  sessions: readonly TrainingSession[],
  plannedStartDate: string,
): TrainingSession[] {
  return sessions.map((session) => {
    const effectiveWeekNumber = getSessionEffectiveCycleWeekNumber(plannedStartDate, session) ?? session.weekNumber;
    const effectiveCalendarWeekStart = getSessionEffectiveCalendarWeekStart(session) ?? session.calendarWeekStart;
    const normalizedEntries = session.entries.map((entry) => ({
      ...entry,
      week: getSessionEffectiveCycleWeekNumber(plannedStartDate, { trainedDate: entry.date }) ?? effectiveWeekNumber,
    }));
    return {
      ...session,
      weekNumber: effectiveWeekNumber,
      calendarWeekStart: effectiveCalendarWeekStart,
      entries: normalizedEntries,
    };
  });
}

export function normalizeCycleScopedEntriesByCalendarWeek(
  entries: readonly ExerciseEntry[],
  plannedStartDate: string,
): ExerciseEntry[] {
  return entries.map((entry) => ({
    ...entry,
    week: getSessionEffectiveCycleWeekNumber(plannedStartDate, { trainedDate: entry.date }) ?? entry.week,
  }));
}

export function isCycleScopedSnapshotEmpty(
  snapshot: CycleScopedTrainingDataSnapshot,
): boolean {
  return snapshot.plan.routines.length === 0 ||
    createExerciseTemplatesFromCycleScopedPlan(snapshot.plan).length === 0;
}

function getPersistedCyclesValue(
  state: TrainingDataState,
): PersistedTrainingCyclesSnapshot | null {
  if (state.cycles.status === "disabled") return null;
  return getTrainingDataResourceValue(state.cycles);
}

function createLegacyView(
  plan: TrainingPlan,
  exercises: ExerciseTemplate[],
  entries: ExerciseEntry[],
  sessions: TrainingSession[],
  activeCycle: TrainingCycle | null,
  persistedCycleHistory: TrainingCycle[],
): TrainingDataView {
  return {
    mode: "legacy",
    plan,
    exercises: dedupeExercisesByDayAndRoutine(exercises),
    entries,
    sessions,
    activeCycle,
    persistedCycleHistory,
    cyclePlan: null,
    isCycleScoped: false,
    blockerMessage: "",
  };
}

function createBlockedView(
  reason: TrainingDataBlockedReason,
  blockerMessage: string,
  plan: TrainingPlan,
  activeCycle: TrainingCycle | null,
  persistedCycleHistory: TrainingCycle[],
  cyclePlan: CycleScopedTrainingPlan | null = null,
): TrainingDataView {
  return {
    mode: "blocked",
    reason,
    blockerMessage,
    plan,
    exercises: [],
    entries: [],
    sessions: [],
    activeCycle,
    persistedCycleHistory,
    cyclePlan,
    isCycleScoped: Boolean(activeCycle && isCycleScopedTrainingCycle(activeCycle)),
  };
}

function getSetupDayFromTrainingDayCode(
  dayCode: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
): string {
  const mapping = {
    monday: TRAINING_DAY_LABELS[0],
    tuesday: TRAINING_DAY_LABELS[1],
    wednesday: TRAINING_DAY_LABELS[2],
    thursday: TRAINING_DAY_LABELS[3],
    friday: TRAINING_DAY_LABELS[4],
    saturday: TRAINING_DAY_LABELS[5],
    sunday: TRAINING_DAY_LABELS[6],
  } as const;
  return mapping[dayCode];
}

function getPlanObjectiveValue(plan: TrainingPlan): string {
  return String(plan[getTrainingPlanObjectiveField(plan.cycleType)]);
}

function readSnapshotNumber(snapshot: TrainingCycleSnapshot, key: string): number {
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readSnapshotString(snapshot: TrainingCycleSnapshot, key: string): string | null {
  return readNonEmptyString(snapshot[key]);
}

function readSnapshotRecord(
  snapshot: TrainingCycleSnapshot,
  key: string,
): TrainingCycleSnapshot {
  const value = snapshot[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as TrainingCycleSnapshot
    : {};
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readSnapshotStringList(
  snapshot: TrainingCycleSnapshot,
  key: string,
  limit: number,
): string[] {
  const value = snapshot[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, limit);
}
