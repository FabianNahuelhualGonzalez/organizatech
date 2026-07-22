import type { TrainingDayCode } from "@/lib/progress/types";

export type CycleHistoryCycleStatus = "active" | "completed" | "cancelled";

export interface CycleHistoryCycleMetadata {
  cycleId: string;
  name: string;
  cycleNumber: number;
  cycleType: string | null;
  status: CycleHistoryCycleStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /**
   * Duración planificada/histórica del ciclo (en semanas), entregada por la futura
   * capa de integración. No se deriva ni se recalcula en este dominio, y no
   * necesariamente coincide con `CycleHistoryBreakdown.weeksWithData.length`, que
   * solo refleja las semanas con al menos un registro válido.
   */
  durationWeeks: number | null;
  /**
   * Cantidad de días de semana distintos del plan real del ciclo, obtenida desde
   * los day_code vigentes de training_cycle_days. No representa sesiones
   * realizadas y puede ser null cuando no existe información confiable.
   */
  trainingDayCount: number | null;
}

export interface CycleHistoryPlannedExercise {
  id: string;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  sortOrder: number;
  exerciseLineageId: string | null;
}

export interface CycleHistoryPlannedDay {
  id: string;
  routineId: string;
  weekIndex: number;
  dayCode: TrainingDayCode;
  sortOrder: number;
  exercises: CycleHistoryPlannedExercise[];
}

export interface CycleHistoryPlannedRoutine {
  id: string;
  name: string;
  sortOrder: number;
  days: CycleHistoryPlannedDay[];
}

export interface CycleHistoryPlan {
  cycleId: string;
  routines: CycleHistoryPlannedRoutine[];
}

export interface CycleHistorySessionRow {
  id: string;
  /** Ciclo real al que pertenece la sesión. Toda sesión con un cycleId distinto al `selectedCycleId` es excluida silenciosamente por el dominio. */
  cycleId: string;
  /** Identidad de rutina de esta sesión, tal como fue registrada al momento de guardarla. */
  routineId: string | null;
  routineName: string;
  calendarWeekStart?: string | null;
  trainedDate?: string | null;
  plannedDate?: string | null;
  trainedAt?: string | null;
}

export interface CycleHistoryEntryRow {
  id: string;
  /**
   * Debe referenciar una `CycleHistorySessionRow` existente y perteneciente al mismo
   * ciclo seleccionado. La rutina de un entry NUNCA se lee de este objeto: se deriva
   * exclusivamente de la sesión asociada (ver `CycleHistorySessionRow.routineId`),
   * porque el shape real de `exercise_entries` no contiene una columna de rutina propia.
   * La futura capa de integración es responsable de descartar o adaptar entries reales
   * que no tengan un `sessionId` válido antes de invocar este dominio: aquí el campo
   * es requerido y un entry sin sesión válida (id inexistente o de otro ciclo) se
   * excluye silenciosamente.
   */
  sessionId: string;
  exerciseLineageId: string | null;
  trainingCycleExerciseId: string | null;
  exerciseName: string;
  weight: number;
  reps: number[];
}

export type CycleHistoryExerciseIdentityKind = "lineage" | "trainingCycleExercise" | "unmatched";

export interface CycleHistoryExerciseIdentity {
  kind: CycleHistoryExerciseIdentityKind;
  key: string;
}

export interface CycleHistoryExercisePlan {
  targetSets: number;
  targetReps: number;
  baseWeight: number;
}

export interface CycleHistorySeriesEntry {
  entryId: string;
  weight: number;
  /** Repeticiones ya saneadas: solo valores finitos y mayores que cero. */
  reps: number[];
  volume: number;
}

export interface CycleHistoryWeekRegistration {
  week: number;
  series: CycleHistorySeriesEntry[];
  totalReps: number;
  volume: number;
}

export interface CycleHistoryExerciseBreakdown {
  identity: CycleHistoryExerciseIdentity;
  name: string;
  plan: CycleHistoryExercisePlan | null;
  weeks: Record<number, CycleHistoryWeekRegistration>;
}

export interface CycleHistoryRoutineBreakdown {
  routineId: string;
  routineName: string;
  sortOrder: number;
  exercises: CycleHistoryExerciseBreakdown[];
}

export interface CycleHistoryBreakdown {
  cycleId: string;
  routines: CycleHistoryRoutineBreakdown[];
  weeksWithData: number[];
}

export type CycleHistoryVolumeProgressState = "increase" | "decrease" | "unchanged" | "insufficient_data";

export interface CycleHistoryVolumeProgress {
  state: CycleHistoryVolumeProgressState;
  firstWeek: number | null;
  lastWeek: number | null;
  firstWeekVolume: number | null;
  lastWeekVolume: number | null;
  differenceKg: number | null;
}

export interface CycleHistoryMetricsSummary {
  totalVolumeKg: number;
  registeredExerciseCount: number;
  weeklyVolumeKg: Record<number, number>;
  volumeProgress: CycleHistoryVolumeProgress;
}

export interface CycleHistoryPersonalData {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  phoneNumber: string | null;
}
