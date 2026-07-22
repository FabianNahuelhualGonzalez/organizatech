import { PublicError } from "@/lib/errors/public-error";
import type {
  CycleHistorySourceCycle,
  CycleHistorySourceCycleData,
  CycleHistorySourceEntry,
  CycleHistorySourcePlan,
  CycleHistorySourceSession,
} from "@/lib/training/cycle-history/cycle-history-data-source";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryEntryRow,
  CycleHistoryPlan,
  CycleHistorySessionRow,
} from "@/lib/training/cycle-history/cycle-history-types";

export type CycleHistoryIntegrationErrorCode =
  | "cycle_mismatch"
  | "cycle_not_available"
  | "plan_mismatch"
  | "invalid_plan";

export class CycleHistoryIntegrationError extends PublicError {
  constructor(code: CycleHistoryIntegrationErrorCode, message: string) {
    super(code, message);
    this.name = "CycleHistoryIntegrationError";
  }
}

export interface AdaptedCycleHistoryData {
  plan: CycleHistoryPlan;
  sessions: CycleHistorySessionRow[];
  entries: CycleHistoryEntryRow[];
}

export function isCycleScopedHistoryCycle(cycle: CycleHistorySourceCycle): boolean {
  return cycle.planSource === "cycle-scoped" || cycle.planSource === "cycle-scoped-qa";
}

export function adaptCycleHistoryMetadata(
  cycle: CycleHistorySourceCycle,
  selectedCycleId: string,
): CycleHistoryCycleMetadata {
  if (cycle.id !== selectedCycleId) {
    throw new CycleHistoryIntegrationError(
      "cycle_mismatch",
      "El ciclo cargado no corresponde al ciclo seleccionado.",
    );
  }

  if (!isCycleScopedHistoryCycle(cycle)) {
    throw new CycleHistoryIntegrationError(
      "cycle_not_available",
      "Este ciclo no esta disponible en el historial cycle-scoped.",
    );
  }

  return {
    cycleId: cycle.id,
    name: cycle.name,
    cycleNumber: cycle.cycleNumber,
    cycleType: cycle.cycleType,
    status: cycle.status,
    plannedStartDate: cycle.plannedStartDate,
    plannedEndDate: cycle.plannedEndDate,
    startedAt: cycle.startedAt,
    endedAt: cycle.endedAt,
    durationWeeks: cycle.durationWeeks,
    trainingDayCount: cycle.trainingDayCount,
  };
}

export function adaptAndSortCycleHistoryList(
  cycles: readonly CycleHistorySourceCycle[],
): CycleHistoryCycleMetadata[] {
  return cycles
    .filter(isCycleScopedHistoryCycle)
    .map((cycle) => adaptCycleHistoryMetadata(cycle, cycle.id))
    .sort((left, right) => {
      const dateDifference = getCycleRecency(right) - getCycleRecency(left);
      return dateDifference || left.cycleId.localeCompare(right.cycleId);
    });
}

export function adaptCycleHistoryData(
  selectedCycleId: string,
  source: CycleHistorySourceCycleData,
): AdaptedCycleHistoryData {
  const plan = adaptCycleHistoryPlan(selectedCycleId, source.plan);
  const sessions = adaptCycleHistorySessions(selectedCycleId, source.sessions);
  const entries = adaptCycleHistoryEntries(selectedCycleId, sessions, source.entries);
  return { plan, sessions, entries };
}

export function adaptCycleHistoryPlan(
  selectedCycleId: string,
  source: CycleHistorySourcePlan,
): CycleHistoryPlan {
  const routineIds = new Set<string>();
  const dayIds = new Set<string>();
  const exerciseIds = new Set<string>();

  return {
    cycleId: selectedCycleId,
    routines: source.routines.map((routine) => {
      assertCycleId(routine.cycleId, selectedCycleId, "Una rutina pertenece a otro ciclo.");
      assertUniqueId(routineIds, routine.id, "El plan contiene rutinas duplicadas.");

      return {
        id: routine.id,
        name: routine.name,
        sortOrder: routine.sortOrder,
        days: routine.days.map((day) => {
          assertCycleId(day.cycleId, selectedCycleId, "Un dia pertenece a otro ciclo.");
          if (day.routineId !== routine.id) {
            throw new CycleHistoryIntegrationError(
              "invalid_plan",
              "Un dia no corresponde a su rutina del ciclo.",
            );
          }
          assertUniqueId(dayIds, day.id, "El plan contiene dias duplicados.");

          return {
            id: day.id,
            routineId: day.routineId,
            weekIndex: day.weekIndex,
            dayCode: day.dayCode,
            sortOrder: day.sortOrder,
            exercises: day.exercises.map((exercise) => {
              assertCycleId(
                exercise.cycleId,
                selectedCycleId,
                "Un ejercicio pertenece a otro ciclo.",
              );
              if (exercise.dayId !== day.id) {
                throw new CycleHistoryIntegrationError(
                  "invalid_plan",
                  "Un ejercicio no corresponde a su dia del ciclo.",
                );
              }
              assertUniqueId(
                exerciseIds,
                exercise.id,
                "El plan contiene ejercicios duplicados.",
              );

              return {
                id: exercise.id,
                name: exercise.name,
                targetSets: exercise.targetSets,
                targetReps: exercise.targetReps,
                baseWeight: exercise.baseWeight,
                sortOrder: exercise.sortOrder,
                exerciseLineageId: exercise.exerciseLineageId,
              };
            }),
          };
        }),
      };
    }),
  };
}

export function adaptCycleHistorySessions(
  selectedCycleId: string,
  sessions: readonly CycleHistorySourceSession[],
): CycleHistorySessionRow[] {
  const sessionIds = new Set<string>();

  return sessions
    .filter((session) => session.cycleId === selectedCycleId)
    .map((session) => {
      assertUniqueId(sessionIds, session.id, "El ciclo contiene sesiones duplicadas.");
      return {
        id: session.id,
        cycleId: selectedCycleId,
        routineId: session.routineId,
        routineName: session.routineName,
        calendarWeekStart: session.calendarWeekStart,
        trainedDate: session.trainedDate,
        plannedDate: session.plannedDate,
        trainedAt: session.trainedAt,
      };
    });
}

export function adaptCycleHistoryEntries(
  selectedCycleId: string,
  sessions: readonly CycleHistorySessionRow[],
  entries: readonly CycleHistorySourceEntry[],
): CycleHistoryEntryRow[] {
  const validSessionIds = new Set(sessions.map((session) => session.id));

  return entries
    .filter((entry) => {
      if (!entry.sessionId || !validSessionIds.has(entry.sessionId)) return false;
      return entry.cycleId === null || entry.cycleId === selectedCycleId;
    })
    .map((entry) => ({
      id: entry.id,
      sessionId: entry.sessionId!,
      exerciseLineageId: entry.exerciseLineageId,
      trainingCycleExerciseId: entry.trainingCycleExerciseId,
      exerciseName: entry.exerciseName,
      weight: entry.weight,
      reps: [...entry.reps],
    }));
}

function assertCycleId(actualCycleId: string, selectedCycleId: string, message: string) {
  if (actualCycleId !== selectedCycleId) {
    throw new CycleHistoryIntegrationError("plan_mismatch", message);
  }
}

function assertUniqueId(ids: Set<string>, id: string, message: string) {
  if (ids.has(id)) {
    throw new CycleHistoryIntegrationError("invalid_plan", message);
  }
  ids.add(id);
}

function getCycleRecency(cycle: CycleHistoryCycleMetadata): number {
  for (const value of [cycle.endedAt, cycle.startedAt, cycle.plannedStartDate]) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}
