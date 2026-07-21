import { getSessionEffectiveCycleWeekNumber } from "@/lib/training/cycle-calendar-week";
import type {
  CycleHistoryBreakdown,
  CycleHistoryEntryRow,
  CycleHistoryExerciseBreakdown,
  CycleHistoryExerciseIdentity,
  CycleHistoryPlan,
  CycleHistoryRoutineBreakdown,
  CycleHistorySeriesEntry,
  CycleHistorySessionRow,
  CycleHistoryWeekRegistration,
} from "@/lib/training/cycle-history/cycle-history-types";

export interface CycleHistoryJoinedEntry {
  entryId: string;
  sessionId: string;
  week: number;
  identity: CycleHistoryExerciseIdentity;
  sessionRoutineId: string | null;
  sessionRoutineName: string;
  exerciseName: string;
  weight: number;
  /** Repeticiones ya saneadas (finitas y mayores que cero); nunca vacío en un resultado incluido. */
  reps: number[];
  volume: number;
}

export const UNASSIGNED_ROUTINE_ID = "unassigned";
export const UNASSIGNED_ROUTINE_NAME = "Rutina no identificada";

export const CYCLE_HISTORY_PLAN_MISMATCH_MESSAGE = "El plan entregado no corresponde al ciclo seleccionado.";

export class CycleHistoryBreakdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleHistoryBreakdownError";
  }
}

export function resolveExerciseIdentity(entry: CycleHistoryEntryRow): CycleHistoryExerciseIdentity {
  if (entry.exerciseLineageId) return { kind: "lineage", key: entry.exerciseLineageId };
  if (entry.trainingCycleExerciseId) return { kind: "trainingCycleExercise", key: entry.trainingCycleExerciseId };
  return { kind: "unmatched", key: `entry:${entry.id}` };
}

function resolvePlannedExerciseIdentity(exerciseLineageId: string | null, exerciseId: string): CycleHistoryExerciseIdentity {
  if (exerciseLineageId) return { kind: "lineage", key: exerciseLineageId };
  return { kind: "trainingCycleExercise", key: exerciseId };
}

function identityKey(identity: CycleHistoryExerciseIdentity): string {
  return `${identity.kind}:${identity.key}`;
}

function toNonNegativeFiniteWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Una serie es válida cuando existe al menos una repetición finita y mayor que cero.
 * Reps inválidas (NaN, negativas, cero, infinitas) se descartan individualmente; las
 * demás repeticiones válidas de la misma entry se conservan.
 */
export function sanitizeCycleHistoryReps(reps: number[]): number[] {
  return (Array.isArray(reps) ? reps : []).filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
}

export function calculateSeriesVolume(weight: number, repsForSeries: number): number {
  const safeWeight = toNonNegativeFiniteWeight(weight);
  const validRep = typeof repsForSeries === "number" && Number.isFinite(repsForSeries) && repsForSeries > 0 ? repsForSeries : 0;
  return safeWeight * validRep;
}

export function calculateEntryVolume(weight: number, reps: number[]): number {
  const safeWeight = toNonNegativeFiniteWeight(weight);
  return sanitizeCycleHistoryReps(reps).reduce((total, repsForSeries) => total + safeWeight * repsForSeries, 0);
}

/**
 * Une entries con su sesión, filtrando defensivamente por ciclo.
 *
 * - Sesiones cuyo `cycleId` no coincide con `selectedCycleId` se descartan antes de
 *   construir el mapa de sesiones válidas.
 * - Un entry cuyo `sessionId` no resuelve a una sesión válida (inexistente o de otro
 *   ciclo) se excluye silenciosamente, sin lanzar error.
 * - Un entry sin ninguna repetición válida (ver `sanitizeCycleHistoryReps`) también se
 *   excluye: no debe crear semana, volumen ni fila visible en el breakdown.
 * - Si `plannedStartDate` es null, o la semana efectiva no es derivable desde las
 *   fechas de la sesión, el entry se excluye (no se inventa una semana).
 */
export function joinCycleHistoryEntriesWithSessions(input: {
  selectedCycleId: string;
  sessions: CycleHistorySessionRow[];
  entries: CycleHistoryEntryRow[];
  plannedStartDate: string | null;
}): CycleHistoryJoinedEntry[] {
  const validSessionById = new Map(
    input.sessions
      .filter((session) => session.cycleId === input.selectedCycleId)
      .map((session) => [session.id, session]),
  );

  const joined: CycleHistoryJoinedEntry[] = [];

  for (const entry of input.entries) {
    const session = validSessionById.get(entry.sessionId);
    if (!session) continue;

    const week = input.plannedStartDate
      ? getSessionEffectiveCycleWeekNumber(input.plannedStartDate, session)
      : null;
    if (week === null) continue;

    const validReps = sanitizeCycleHistoryReps(entry.reps);
    if (validReps.length === 0) continue;

    joined.push({
      entryId: entry.id,
      sessionId: entry.sessionId,
      week,
      identity: resolveExerciseIdentity(entry),
      sessionRoutineId: session.routineId,
      sessionRoutineName: session.routineName,
      exerciseName: entry.exerciseName,
      weight: entry.weight,
      reps: validReps,
      volume: calculateEntryVolume(entry.weight, validReps),
    });
  }

  return joined;
}

export function buildCycleHistoryBreakdown(input: {
  selectedCycleId: string;
  plan: CycleHistoryPlan;
  sessions: CycleHistorySessionRow[];
  entries: CycleHistoryEntryRow[];
  plannedStartDate: string | null;
}): CycleHistoryBreakdown {
  if (input.plan.cycleId !== input.selectedCycleId) {
    throw new CycleHistoryBreakdownError(CYCLE_HISTORY_PLAN_MISMATCH_MESSAGE);
  }

  const routineOrder: string[] = [];
  const routineMetaById = new Map<string, { name: string; sortOrder: number }>();
  const plannedExerciseByIdentityKey = new Map<
    string,
    { routineId: string; identity: CycleHistoryExerciseIdentity; name: string; targetSets: number; targetReps: number; baseWeight: number; sortOrder: number }
  >();

  for (const routine of input.plan.routines) {
    if (!routineMetaById.has(routine.id)) {
      routineMetaById.set(routine.id, { name: routine.name, sortOrder: routine.sortOrder });
      routineOrder.push(routine.id);
    }

    for (const day of routine.days) {
      for (const exercise of day.exercises) {
        const identity = resolvePlannedExerciseIdentity(exercise.exerciseLineageId, exercise.id);
        const key = identityKey(identity);
        if (!plannedExerciseByIdentityKey.has(key)) {
          plannedExerciseByIdentityKey.set(key, {
            routineId: routine.id,
            identity,
            name: exercise.name,
            targetSets: exercise.targetSets,
            targetReps: exercise.targetReps,
            baseWeight: exercise.baseWeight,
            sortOrder: exercise.sortOrder,
          });
        }
      }
    }
  }

  const joinedEntries = joinCycleHistoryEntriesWithSessions({
    selectedCycleId: input.selectedCycleId,
    sessions: input.sessions,
    entries: input.entries,
    plannedStartDate: input.plannedStartDate,
  });

  const exerciseBucketsByRoutine = new Map<string, Map<string, CycleHistoryExerciseBreakdown>>();
  const weeksWithData = new Set<number>();

  function getOrCreateRoutineBucket(routineId: string, routineName: string, sortOrder: number) {
    if (!routineMetaById.has(routineId)) {
      routineMetaById.set(routineId, { name: routineName, sortOrder });
      routineOrder.push(routineId);
    }
    let bucket = exerciseBucketsByRoutine.get(routineId);
    if (!bucket) {
      bucket = new Map<string, CycleHistoryExerciseBreakdown>();
      exerciseBucketsByRoutine.set(routineId, bucket);
    }
    return bucket;
  }

  function getOrCreateExerciseBreakdown(
    routineId: string,
    routineName: string,
    identity: CycleHistoryExerciseIdentity,
    name: string,
    plan: { targetSets: number; targetReps: number; baseWeight: number } | null,
  ): CycleHistoryExerciseBreakdown {
    const bucket = getOrCreateRoutineBucket(routineId, routineName, Number.MAX_SAFE_INTEGER);
    const key = identityKey(identity);
    let exercise = bucket.get(key);
    if (!exercise) {
      exercise = { identity, name, plan, weeks: {} };
      bucket.set(key, exercise);
    }
    return exercise;
  }

  for (const planned of plannedExerciseByIdentityKey.values()) {
    const routineMeta = routineMetaById.get(planned.routineId);
    getOrCreateExerciseBreakdown(
      planned.routineId,
      routineMeta?.name ?? planned.routineId,
      planned.identity,
      planned.name,
      { targetSets: planned.targetSets, targetReps: planned.targetReps, baseWeight: planned.baseWeight },
    );
  }

  for (const joined of joinedEntries) {
    const plannedMatch = plannedExerciseByIdentityKey.get(identityKey(joined.identity));

    let routineId: string;
    let routineName: string;
    let plan: { targetSets: number; targetReps: number; baseWeight: number } | null;

    if (plannedMatch) {
      routineId = plannedMatch.routineId;
      routineName = routineMetaById.get(plannedMatch.routineId)?.name ?? plannedMatch.routineId;
      plan = { targetSets: plannedMatch.targetSets, targetReps: plannedMatch.targetReps, baseWeight: plannedMatch.baseWeight };
    } else if (joined.sessionRoutineId && routineMetaById.has(joined.sessionRoutineId)) {
      routineId = joined.sessionRoutineId;
      routineName = routineMetaById.get(joined.sessionRoutineId)!.name;
      plan = null;
    } else {
      routineId = UNASSIGNED_ROUTINE_ID;
      routineName = UNASSIGNED_ROUTINE_NAME;
      plan = null;
    }

    const exercise = getOrCreateExerciseBreakdown(
      routineId,
      routineName,
      joined.identity,
      plannedMatch?.name ?? joined.exerciseName,
      plan,
    );

    weeksWithData.add(joined.week);

    const series: CycleHistorySeriesEntry = {
      entryId: joined.entryId,
      weight: joined.weight,
      reps: [...joined.reps],
      volume: joined.volume,
    };

    const existingWeek = exercise.weeks[joined.week];
    if (existingWeek) {
      existingWeek.series.push(series);
      existingWeek.totalReps += series.reps.reduce((total, value) => total + value, 0);
      existingWeek.volume += series.volume;
    } else {
      const registration: CycleHistoryWeekRegistration = {
        week: joined.week,
        series: [series],
        totalReps: series.reps.reduce((total, value) => total + value, 0),
        volume: series.volume,
      };
      exercise.weeks[joined.week] = registration;
    }
  }

  const routines: CycleHistoryRoutineBreakdown[] = routineOrder.map((routineId) => {
    const meta = routineMetaById.get(routineId);
    const bucket = exerciseBucketsByRoutine.get(routineId);
    const exercises = bucket ? Array.from(bucket.values()) : [];
    exercises.sort((a, b) => identityKey(a.identity).localeCompare(identityKey(b.identity)));

    return {
      routineId,
      routineName: meta?.name ?? routineId,
      sortOrder: meta?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      exercises,
    };
  });

  routines.sort((a, b) => a.sortOrder - b.sortOrder || a.routineId.localeCompare(b.routineId));

  return {
    cycleId: input.selectedCycleId,
    routines,
    weeksWithData: Array.from(weeksWithData).sort((a, b) => a - b),
  };
}
