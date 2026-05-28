export type ObjectiveStatus = "Cumplimos" | "Mantenemos esfuerzo" | "No cumplimos";
export type KgStatus = "Kg aumentado" | "Mismo kg" | "Kg disminuido";

export type RoutineName = string;
export type TrainingDayCode = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export type TrainingSessionStatus = "completed" | "skipped";

export interface ExerciseTemplate {
  id: string;
  routine: RoutineName;
  day?: string;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  sideWeight?: number;
  notes?: string;
}

export interface ExerciseEntry {
  id: string;
  sessionId?: string;
  exerciseId: string;
  exerciseName: string;
  routine: RoutineName;
  week: number;
  date: string;
  targetSets: number;
  targetReps: number;
  weight: number;
  previousWeight: number;
  reps: number[];
  notes?: string;
  rir?: string;
}

export interface TrainingSession {
  id: string;
  routineId: string | null;
  routine: RoutineName;
  weekNumber: number;
  calendarWeekStart: string | null;
  plannedDay: TrainingDayCode | null;
  plannedDate: string | null;
  trainedDate: string;
  trainedAt: string;
  status: TrainingSessionStatus;
  completedAt?: string;
  deletedAt?: string;
  notes?: string;
  entries: ExerciseEntry[];
}

export interface ExerciseMetrics extends ExerciseEntry {
  targetTotalReps: number;
  totalReps: number;
  repsDifference: number;
  kgDifference: number;
  kgStatus: KgStatus;
  objectiveStatus: ObjectiveStatus;
  volumeTotal: number;
  volumeDifference: number;
  volumePercentage: number;
}

export interface WeeklySummary {
  week: number;
  volumeTotal: number;
  totalReps: number;
  exerciseCount: number;
  objectivesOk: number;
  objectivesFailed: number;
  objectivesMaintained: number;
  volumeDifference: number;
  volumePercentage: number;
  repsDifference: number;
  exerciseDifference: number;
  complianceRate: number;
}

export interface SmartInsight {
  id: string;
  tone: "positivo" | "alerta" | "riesgo" | "info";
  title: string;
  detail: string;
}

export type ExerciseTrend =
  | "Mejora"
  | "Mantenimiento"
  | "Retroceso"
  | "Información insuficiente";

export interface ExerciseHistoryPoint {
  date: string;
  weekLabel?: string;
  weight: number;
  totalReps: number;
  volumeTotal: number;
}

export interface ExerciseComparisonSummary {
  exerciseName: string;
  firstWeight: number;
  firstDate: string;
  firstTotalReps: number;
  firstVolumeTotal: number;
  latestWeight: number;
  latestDate: string;
  latestTotalReps: number;
  latestVolumeTotal: number;
  weightGain: number;
  bestWeight: number;
  bestWeightDate: string;
  totalRecords: number;
  trend: ExerciseTrend;
  insight: string;
  history: ExerciseHistoryPoint[];
}
