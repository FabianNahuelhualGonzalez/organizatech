import type { TrainingDayCode } from "@/lib/progress/types";
import { getProfilePersonalData } from "@/lib/profile/profile-repository";
import type {
  CycleHistoryCycleStatus,
  CycleHistoryPersonalData,
} from "@/lib/training/cycle-history/cycle-history-types";
import {
  getCycleScopedTrainingPlan,
  getCycleScopedTrainingSessionData,
} from "@/lib/training/cycle-scoped-training-repository";
import {
  getActiveTrainingCycle,
  getTrainingCycleHistory,
  type TrainingCycle,
} from "@/lib/training/training-cycles-repository";

export interface CycleHistorySourceCycle {
  id: string;
  name: string;
  cycleNumber: number;
  cycleType: string | null;
  status: CycleHistoryCycleStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  planSource: string | null;
  durationWeeks: number | null;
}

export interface CycleHistorySourceExercise {
  id: string;
  cycleId: string;
  dayId: string;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  sortOrder: number;
  exerciseLineageId: string | null;
}

export interface CycleHistorySourceDay {
  id: string;
  cycleId: string;
  routineId: string;
  weekIndex: number;
  dayCode: TrainingDayCode;
  sortOrder: number;
  exercises: CycleHistorySourceExercise[];
}

export interface CycleHistorySourceRoutine {
  id: string;
  cycleId: string;
  name: string;
  sortOrder: number;
  days: CycleHistorySourceDay[];
}

export interface CycleHistorySourcePlan {
  routines: CycleHistorySourceRoutine[];
}

export interface CycleHistorySourceSession {
  id: string;
  cycleId: string | null;
  routineId: string | null;
  routineName: string;
  calendarWeekStart: string | null;
  trainedDate: string | null;
  plannedDate: string | null;
  trainedAt: string | null;
}

export interface CycleHistorySourceEntry {
  id: string;
  sessionId: string | null;
  cycleId: string | null;
  exerciseLineageId: string | null;
  trainingCycleExerciseId: string | null;
  exerciseName: string;
  weight: number;
  reps: number[];
}

export interface CycleHistorySourceCycleData {
  plan: CycleHistorySourcePlan;
  sessions: CycleHistorySourceSession[];
  entries: CycleHistorySourceEntry[];
}

/**
 * Contrato inyectable del historial. La implementación real obtiene al usuario
 * desde la sesión Supabase de cada repositorio; ningún caller entrega userId.
 */
export interface CycleHistoryDataSource {
  listCycles(): Promise<readonly CycleHistorySourceCycle[]>;
  loadCycle(selectedCycleId: string): Promise<CycleHistorySourceCycle | null>;
  loadCycleData(selectedCycleId: string): Promise<CycleHistorySourceCycleData>;
  loadPersonalData(): Promise<CycleHistoryPersonalData>;
}

export function createRepositoryCycleHistoryDataSource(): CycleHistoryDataSource {
  return {
    listCycles: loadRepositoryCycles,
    async loadCycle(selectedCycleId) {
      const cycles = await loadRepositoryCycles();
      return cycles.find((cycle) => cycle.id === selectedCycleId) ?? null;
    },
    async loadCycleData(selectedCycleId) {
      const repositoryPlan = await getCycleScopedTrainingPlan(selectedCycleId);
      const repositorySessionData = await getCycleScopedTrainingSessionData(
        selectedCycleId,
        repositoryPlan,
      );

      return {
        plan: {
          routines: repositoryPlan.routines.map((routine) => ({
            id: routine.id,
            cycleId: routine.cycleId,
            name: routine.name,
            sortOrder: routine.sortOrder,
            days: routine.days.map((day) => ({
              id: day.id,
              cycleId: day.cycleId,
              routineId: day.routineId,
              weekIndex: day.weekIndex,
              dayCode: day.dayCode,
              sortOrder: day.sortOrder,
              exercises: day.exercises.map((exercise) => ({
                id: exercise.id,
                cycleId: exercise.cycleId,
                dayId: exercise.dayId,
                name: exercise.name,
                targetSets: exercise.targetSets,
                targetReps: exercise.targetReps,
                baseWeight: exercise.baseWeight,
                sortOrder: exercise.sortOrder,
                exerciseLineageId: exercise.exerciseLineageId,
              })),
            })),
          })),
        },
        sessions: repositorySessionData.sessions.map((session) => ({
          id: session.id,
          cycleId: session.cycleId ?? null,
          routineId: session.routineId,
          routineName: session.routine,
          calendarWeekStart: session.calendarWeekStart,
          trainedDate: session.trainedDate ?? null,
          plannedDate: session.plannedDate,
          trainedAt: session.trainedAt ?? null,
        })),
        entries: repositorySessionData.entries.map((entry) => ({
          id: entry.id,
          sessionId: entry.sessionId ?? null,
          cycleId: entry.cycleId ?? null,
          exerciseLineageId: entry.exerciseLineageId ?? null,
          trainingCycleExerciseId: entry.trainingCycleExerciseId ?? null,
          exerciseName: entry.exerciseName,
          weight: entry.weight,
          reps: [...entry.reps],
        })),
      };
    },
    async loadPersonalData() {
      const profile = await getProfilePersonalData();
      return {
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email || null,
        birthDate: profile.birthDate,
        gender: profile.gender,
        phoneNumber: profile.phoneNumber,
      };
    },
  };
}

async function loadRepositoryCycles(): Promise<CycleHistorySourceCycle[]> {
  const [activeCycle, historicalCycles] = await Promise.all([
    getActiveTrainingCycle(),
    getTrainingCycleHistory(),
  ]);
  const cycles = activeCycle ? [activeCycle, ...historicalCycles] : historicalCycles;
  const uniqueCycles = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  return Array.from(uniqueCycles.values(), mapRepositoryCycle);
}

function mapRepositoryCycle(cycle: TrainingCycle): CycleHistorySourceCycle {
  return {
    id: cycle.id,
    name: cycle.name,
    cycleNumber: cycle.cycleNumber,
    cycleType: cycle.cycleType,
    status: cycle.status,
    plannedStartDate: cycle.plannedStartDate,
    plannedEndDate: cycle.plannedEndDate,
    startedAt: cycle.startedAt,
    endedAt: cycle.endedAt,
    planSource: readString(cycle.planSnapshot.source),
    durationWeeks: readPositiveInteger(cycle.planSnapshot.durationWeeks),
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
