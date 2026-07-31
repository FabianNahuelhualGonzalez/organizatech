import type {
  ExerciseEntry,
  ExerciseTemplate,
  TrainingDayCode,
} from "@/lib/progress/types";
import {
  buildCycleHistoryBreakdown,
} from "@/lib/training/cycle-history/cycle-history-breakdown";
import { buildCycleHistoryMetricsSummary } from "@/lib/training/cycle-history/cycle-history-metrics";
import { buildCycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type {
  CycleHistoryDetail,
  CycleHistoryService,
} from "@/lib/training/cycle-history/cycle-history-service";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryEntryRow,
  CycleHistoryPersonalData,
  CycleHistoryPlan,
  CycleHistorySessionRow,
} from "@/lib/training/cycle-history/cycle-history-types";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

export interface LegacyCycleHistorySnapshot {
  id: string;
  name: string;
  createdAt: string;
  endedAt: string;
  plan: TrainingPlan;
  exercises: readonly ExerciseTemplate[];
  entries: readonly ExerciseEntry[];
}

export interface CreateLegacyCycleHistoryServiceAdapterOptions {
  snapshots: readonly LegacyCycleHistorySnapshot[];
  personalData?: CycleHistoryPersonalData;
  now?: () => string;
}

interface LegacyCycleHistoryRecord {
  sourceIndex: number;
  snapshot: LegacyCycleHistorySnapshot;
  metadata: CycleHistoryCycleMetadata;
}

interface LegacyPlanAdaptation {
  plan: CycleHistoryPlan;
  routineIdByName: Map<string, string>;
  plannedExerciseIdBySourceId: Map<string, string>;
}

const LEGACY_LIST_ERROR_MESSAGE = "No pudimos cargar el historial de ciclos.";
const LEGACY_DETAIL_ERROR_MESSAGE = "No pudimos cargar el detalle de este ciclo.";
const EMPTY_PERSONAL_DATA: CycleHistoryPersonalData = {
  firstName: null,
  lastName: null,
  email: null,
  birthDate: null,
  gender: null,
  phoneNumber: null,
};
const TRAINING_DAY_CODES: readonly TrainingDayCode[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Adapta snapshots locales al contrato existente de Cycle History. No consulta ni
 * escribe storage, no conoce Supabase y no convierte los snapshots en registros
 * cycle-scoped: solo proyecta copias para el controller/presentacion compartidos.
 */
export function createLegacyCycleHistoryServiceAdapter(
  options: CreateLegacyCycleHistoryServiceAdapterOptions,
): CycleHistoryService {
  const now = options.now ?? (() => new Date().toISOString());
  const personalData = clonePersonalData(options.personalData ?? EMPTY_PERSONAL_DATA);

  return {
    async listCycles() {
      try {
        const cycles = buildLegacyRecords(options.snapshots).map((record) => record.metadata);
        return cycles.length === 0
          ? { status: "empty", cycles: [] }
          : { status: "ready", cycles };
      } catch {
        return {
          status: "error",
          error: { code: "unexpected", message: LEGACY_LIST_ERROR_MESSAGE },
        };
      }
    },

    async loadCycleDetail(selectedCycleId) {
      if (!isUsableId(selectedCycleId)) {
        return {
          status: "error",
          cycleId: selectedCycleId,
          error: {
            code: "cycle_required",
            message: "Selecciona un ciclo para revisar su historial.",
          },
        };
      }

      try {
        const record = buildLegacyRecords(options.snapshots)
          .find((candidate) => candidate.snapshot.id === selectedCycleId);
        if (!record) {
          return {
            status: "error",
            cycleId: selectedCycleId,
            error: { code: "cycle_not_found", message: "No encontramos el ciclo seleccionado." },
          };
        }

        const detail = buildLegacyDetail(record, personalData, now());
        return detail.breakdown.weeksWithData.length === 0
          ? { status: "empty", cycleId: selectedCycleId, data: detail }
          : { status: "ready", cycleId: selectedCycleId, data: detail };
      } catch {
        return {
          status: "error",
          cycleId: selectedCycleId,
          error: { code: "unexpected", message: LEGACY_DETAIL_ERROR_MESSAGE },
        };
      }
    },
  };
}

function buildLegacyRecords(
  snapshots: readonly LegacyCycleHistorySnapshot[],
): LegacyCycleHistoryRecord[] {
  return snapshots
    .map((snapshot, sourceIndex) => ({
      sourceIndex,
      snapshot,
      metadata: buildLegacyMetadata(snapshot, sourceIndex),
    }))
    .filter((record) => isUsableId(record.snapshot.id))
    .sort((left, right) => (
      getRecordRecency(right) - getRecordRecency(left) ||
      right.sourceIndex - left.sourceIndex ||
      left.snapshot.id.localeCompare(right.snapshot.id)
    ));
}

function buildLegacyMetadata(
  snapshot: LegacyCycleHistorySnapshot,
  sourceIndex: number,
): CycleHistoryCycleMetadata {
  const exercises = readExercises(snapshot);
  const plannedStartDate = readDateKey(snapshot.createdAt) ?? findFirstEntryDate(snapshot);

  return {
    cycleId: snapshot.id,
    name: snapshot.name,
    cycleNumber: sourceIndex + 1,
    cycleType: snapshot.plan?.cycleType ?? null,
    status: "completed",
    plannedStartDate,
    plannedEndDate: readDateKey(snapshot.endedAt),
    startedAt: snapshot.createdAt || null,
    endedAt: snapshot.endedAt || null,
    durationWeeks: readLegacyDurationWeeks(snapshot.plan),
    trainingDayCount: countLegacyTrainingDays(exercises),
  };
}

function buildLegacyDetail(
  record: LegacyCycleHistoryRecord,
  personalData: CycleHistoryPersonalData,
  generatedAt: string,
): CycleHistoryDetail {
  const planAdaptation = adaptLegacyPlan(record.snapshot);
  const { sessions, entries } = adaptLegacyRegistrations(
    record.snapshot,
    record.metadata.plannedStartDate,
    planAdaptation,
  );
  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: record.snapshot.id,
    plan: planAdaptation.plan,
    sessions,
    entries,
    plannedStartDate: record.metadata.plannedStartDate,
  });
  const metrics = buildCycleHistoryMetricsSummary(breakdown);

  return {
    metadata: { ...record.metadata },
    plan: planAdaptation.plan,
    breakdown,
    metrics,
    pdfModel: buildCycleHistoryPdfModel({
      cycle: record.metadata,
      breakdown,
      personalData: clonePersonalData(personalData),
      generatedAt,
    }),
    sessionCount: sessions.length,
    entryCount: entries.length,
  };
}

function adaptLegacyPlan(snapshot: LegacyCycleHistorySnapshot): LegacyPlanAdaptation {
  const routineIdByName = new Map<string, string>();
  const plannedExerciseIdBySourceId = new Map<string, string>();
  const routines: CycleHistoryPlan["routines"] = [];

  for (const [sourceIndex, exercise] of readExercises(snapshot).entries()) {
    const routineName = exercise.routine || "Rutina no identificada";
    let routineId = routineIdByName.get(routineName);
    let routine = routineId
      ? routines.find((candidate) => candidate.id === routineId)
      : undefined;

    if (!routine) {
      routineId = `legacy-routine-${routines.length + 1}`;
      routineIdByName.set(routineName, routineId);
      routine = {
        id: routineId,
        name: routineName,
        sortOrder: routines.length,
        days: [],
      };
      routines.push(routine);
    }

    const dayLabel = resolveLegacyDayLabel(exercise.day);
    const daySortOrder = TRAINING_DAY_LABELS.indexOf(dayLabel);
    let day = routine.days.find((candidate) => candidate.sortOrder === daySortOrder);
    if (!day) {
      day = {
        id: `${routine.id}-day-${daySortOrder + 1}`,
        routineId: routine.id,
        weekIndex: 1,
        dayCode: TRAINING_DAY_CODES[daySortOrder] ?? "monday",
        sortOrder: daySortOrder,
        exercises: [],
      };
      routine.days.push(day);
      routine.days.sort((left, right) => left.sortOrder - right.sortOrder);
    }

    const sourceExerciseId = readNonEmptyString(exercise.id);
    const trainingCycleExerciseId = readNonEmptyString(exercise.trainingCycleExerciseId);
    const plannedExerciseId = trainingCycleExerciseId ??
      sourceExerciseId ??
      `${day.id}-exercise-${sourceIndex + 1}`;
    if (sourceExerciseId) {
      plannedExerciseIdBySourceId.set(sourceExerciseId, plannedExerciseId);
    }
    if (trainingCycleExerciseId) {
      plannedExerciseIdBySourceId.set(trainingCycleExerciseId, plannedExerciseId);
    }

    day.exercises.push({
      id: plannedExerciseId,
      name: exercise.name,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      baseWeight: exercise.baseWeight,
      sortOrder: day.exercises.length,
      exerciseLineageId: exercise.exerciseLineageId ?? null,
    });
  }

  return {
    plan: { cycleId: snapshot.id, routines },
    routineIdByName,
    plannedExerciseIdBySourceId,
  };
}

function adaptLegacyRegistrations(
  snapshot: LegacyCycleHistorySnapshot,
  plannedStartDate: string | null,
  plan: LegacyPlanAdaptation,
): { sessions: CycleHistorySessionRow[]; entries: CycleHistoryEntryRow[] } {
  const sessions: CycleHistorySessionRow[] = [];
  const entries: CycleHistoryEntryRow[] = [];
  const sessionIdBySourceKey = new Map<string, string>();

  for (const [entryIndex, entry] of readEntries(snapshot).entries()) {
    const sourceSessionId = readNonEmptyString(entry.sessionId);
    const sourceSessionKey = sourceSessionId ?? [
      "legacy",
      entry.week,
      entry.date,
      entry.routine,
    ].join("\u0000");
    let sessionId = sessionIdBySourceKey.get(sourceSessionKey);

    if (!sessionId) {
      sessionId = sourceSessionId ?? `legacy-session-${sessions.length + 1}`;
      sessionIdBySourceKey.set(sourceSessionKey, sessionId);
      const trainedDate = resolveLegacyEntryDate(entry, plannedStartDate);
      sessions.push({
        id: sessionId,
        cycleId: snapshot.id,
        routineId: plan.routineIdByName.get(entry.routine) ?? null,
        routineName: entry.routine || "Rutina no identificada",
        calendarWeekStart: null,
        trainedDate,
        plannedDate: trainedDate,
        trainedAt: entry.date || null,
      });
    }

    const matchingPlannedExerciseId = plan.plannedExerciseIdBySourceId.get(entry.exerciseId);
    entries.push({
      id: readNonEmptyString(entry.id) ?? `legacy-entry-${entryIndex + 1}`,
      sessionId,
      exerciseLineageId: entry.exerciseLineageId ?? null,
      trainingCycleExerciseId: readNonEmptyString(entry.trainingCycleExerciseId) ??
        matchingPlannedExerciseId ??
        null,
      exerciseName: entry.exerciseName,
      weight: entry.weight,
      reps: Array.isArray(entry.reps) ? [...entry.reps] : [],
    });
  }

  return { sessions, entries };
}

function readExercises(snapshot: LegacyCycleHistorySnapshot): readonly ExerciseTemplate[] {
  return Array.isArray(snapshot.exercises) ? snapshot.exercises : [];
}

function readEntries(snapshot: LegacyCycleHistorySnapshot): readonly ExerciseEntry[] {
  return Array.isArray(snapshot.entries) ? snapshot.entries : [];
}

function countLegacyTrainingDays(exercises: readonly ExerciseTemplate[]): number {
  const days = new Set(
    exercises
      .map((exercise) => exercise.day ?? "Lunes")
      .filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
  );
  return days.size > 0 ? days.size : 1;
}

function resolveLegacyDayLabel(value: string | undefined): (typeof TRAINING_DAY_LABELS)[number] {
  return TRAINING_DAY_LABELS.find((day) => day === value) ?? "Lunes";
}

function readLegacyDurationWeeks(plan: TrainingPlan | null | undefined): number | null {
  if (!plan) return null;
  const value = plan.cycleType === "macro"
    ? plan.macroDurationMonths * 4
    : plan.cycleType === "meso"
      ? plan.mesoDurationWeeks
      : plan.cycleType === "micro"
        ? plan.microDurationWeeks
        : 1;
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : null;
}

function findFirstEntryDate(snapshot: LegacyCycleHistorySnapshot): string | null {
  for (const entry of readEntries(snapshot)) {
    const dateKey = readDateKey(entry.date);
    if (dateKey) return dateKey;
  }
  return null;
}

function resolveLegacyEntryDate(
  entry: ExerciseEntry,
  plannedStartDate: string | null,
): string | null {
  const persistedDate = readDateKey(entry.date);
  if (persistedDate) return persistedDate;
  if (!plannedStartDate || !Number.isInteger(entry.week) || entry.week < 1) return null;

  const start = new Date(`${plannedStartDate}T12:00:00.000Z`);
  if (!Number.isFinite(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() + ((entry.week - 1) * 7));
  return start.toISOString().slice(0, 10);
}

function readDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${dateKey}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateKey
    ? dateKey
    : null;
}

function getRecordRecency(record: LegacyCycleHistoryRecord): number {
  for (const value of [record.snapshot.endedAt, record.snapshot.createdAt]) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return record.sourceIndex;
}

function clonePersonalData(value: CycleHistoryPersonalData): CycleHistoryPersonalData {
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    email: value.email,
    birthDate: value.birthDate,
    gender: value.gender,
    phoneNumber: value.phoneNumber,
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isUsableId(value: unknown): value is string {
  return readNonEmptyString(value) !== null;
}
