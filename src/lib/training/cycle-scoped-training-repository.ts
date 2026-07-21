import { toPersistedExerciseObservation } from "@/lib/data/repository";
import { PublicError } from "@/lib/errors/public-error";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ExerciseEntry, TrainingDayCode, TrainingSession, TrainingSessionStatus } from "@/lib/progress/types";
import {
  createCycleScopedRetiredExerciseNotes,
  getCycleScopedExerciseDisplayNotes,
  isCycleScopedExerciseRetired,
  normalizeCycleScopedExerciseName,
} from "@/lib/training/cycle-scoped-plan-edit";
import {
  createExerciseLineageInsertPayload,
  resolveExerciseLineageIdForReplacement,
  resolveExerciseLineageIdForSessionEntry,
} from "@/lib/training/training-exercise-lineage";

export interface CycleScopedTrainingCycleInput {
  name: string;
  cycleNumber: number;
  cycleType: string;
  goal: string;
  durationWeeks: number;
  plannedStartDate: string;
  plannedEndDate: string;
  plan: CycleScopedPlanInput;
}

export interface CycleScopedPlanInput {
  source: string;
  trainingDays: string[];
  exerciseCount: number;
  routines: CycleScopedRoutineInput[];
}

export interface CycleScopedRoutineInput {
  name: string;
  sortOrder: number;
  notes?: string | null;
  days: CycleScopedDayInput[];
}

export interface CycleScopedDayInput {
  weekIndex: number;
  dayCode: TrainingDayCode;
  sortOrder: number;
  notes?: string | null;
  exercises: CycleScopedExerciseInput[];
}

export interface CycleScopedExerciseInput {
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  sideWeight?: number | null;
  sortOrder: number;
  notes?: string | null;
  sourceLegacyExerciseId?: string | null;
  exerciseLineageId?: string | null;
}

export interface CycleScopedTrainingSessionInput {
  cycleId: string;
  cycleDayId: string;
  plannedDay: TrainingDayCode;
  plannedDate: string;
  trainedDate: string;
  status: TrainingSessionStatus;
  weekNumber: number;
  notes?: string | null;
  entries: CycleScopedTrainingSessionEntryInput[];
}

export interface CycleScopedTrainingSessionEntryInput {
  id: string;
  trainingCycleExerciseId: string;
  exerciseId?: string | null;
  exerciseLineageId?: string | null;
  weight: number;
  previousWeight: number;
  reps: number[];
  rir?: string | null;
  notes?: string | null;
  observation?: string | null;
}

export interface AddCycleScopedTrainingPlanInput {
  cycleId: string;
  days: Array<{
    existingDayId?: string;
    routineId: string;
    weekIndex: number;
    dayCode: TrainingDayCode;
    sortOrder: number;
    notes?: string | null;
    exercises: Array<{
      sourceExerciseId?: string;
      exerciseLineageId?: string | null;
      name: string;
      targetSets: number;
      targetReps: number;
      baseWeight: number;
      sideWeight?: number | null;
      sortOrder: number;
      notes?: string | null;
    }>;
    updates?: Array<{
      exerciseId: string;
      exerciseLineageId?: string | null;
      name: string;
      targetSets: number;
      targetReps: number;
      baseWeight: number;
      sideWeight?: number | null;
      sortOrder: number;
      notes?: string | null;
    }>;
    replacements?: Array<{
      previousExerciseId: string;
      exerciseLineageId?: string | null;
      name: string;
      targetSets: number;
      targetReps: number;
      baseWeight: number;
      sideWeight?: number | null;
      sortOrder: number;
      notes?: string | null;
    }>;
    pendingDeleteExerciseIds?: string[];
    registeredRetireExerciseIds?: string[];
  }>;
}

export interface AddCycleScopedTrainingPlanResult {
  daysAdded: number;
  exercisesAdded: number;
  exercisesUpdated: number;
  exercisesRetired: number;
}

export interface CycleScopedTrainingPlan {
  routines: CycleScopedRoutine[];
}

export interface CycleScopedTrainingSessionData {
  sessions: TrainingSession[];
  entries: ExerciseEntry[];
}

export interface CycleScopedRoutine {
  id: string;
  cycleId: string;
  name: string;
  sortOrder: number;
  notes: string | null;
  days: CycleScopedDay[];
}

export interface CycleScopedDay {
  id: string;
  cycleId: string;
  routineId: string;
  weekIndex: number;
  dayCode: TrainingDayCode;
  sortOrder: number;
  notes: string | null;
  exercises: CycleScopedExercise[];
}

export interface CycleScopedExercise {
  id: string;
  cycleId: string;
  dayId: string;
  name: string;
  targetSets: number;
  targetReps: number;
  baseWeight: number;
  sideWeight: number | null;
  sortOrder: number;
  notes: string | null;
  sourceLegacyExerciseId: string | null;
  exerciseLineageId: string | null;
}

export type CycleScopedTrainingRepositoryErrorCode =
  | "session_required"
  | "session_expired"
  | "invalid_plan"
  | "active_cycle_exists"
  | "permission_denied"
  | "unexpected";

export class CycleScopedTrainingRepositoryError extends PublicError {
  constructor(
    public readonly code: CycleScopedTrainingRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, cause);
    this.name = "CycleScopedTrainingRepositoryError";
  }
}

export async function createTrainingCycleWithPlan(input: CycleScopedTrainingCycleInput): Promise<string> {
  validatePlanInput(input);
  const { supabase } = await getAuthenticatedCycleScopedRepository();
  const rpcPlan = toCreateTrainingCycleWithPlanPayload(input.plan);

  const { data, error } = await supabase.rpc("create_training_cycle_with_plan", {
    p_name: input.name,
    p_cycle_number: input.cycleNumber,
    p_cycle_type: input.cycleType,
    p_goal: input.goal,
    p_duration_weeks: input.durationWeeks,
    p_planned_start_date: input.plannedStartDate,
    p_planned_end_date: input.plannedEndDate,
    p_plan: rpcPlan,
  });

  if (error) throw mapCycleScopedRepositoryError(error);
  if (typeof data !== "string" || data.length === 0) {
    throw new CycleScopedTrainingRepositoryError(
      "unexpected",
      "No pudimos confirmar el ciclo creado.",
    );
  }

  return data;
}

export async function createTrainingSessionWithCycleEntries(input: CycleScopedTrainingSessionInput): Promise<string> {
  validateTrainingSessionInput(input);
  const { supabase } = await getAuthenticatedCycleScopedRepository();

  const { data, error } = await supabase.rpc("create_training_session_with_cycle_entries", {
    p_cycle_id: input.cycleId,
    p_cycle_day_id: input.cycleDayId,
    p_planned_day: input.plannedDay,
    p_planned_date: input.plannedDate,
    p_trained_date: input.trainedDate,
    p_status: input.status,
    p_week_number: input.weekNumber,
    p_notes: input.notes ?? null,
    p_entries: input.entries.map((entry) => {
      const observation = toPersistedExerciseObservation(entry.observation);
      return {
        id: entry.id,
        training_cycle_exercise_id: entry.trainingCycleExerciseId,
        exercise_id: entry.exerciseId ?? null,
        exercise_lineage_id: resolveExerciseLineageIdForSessionEntry(entry),
        weight: entry.weight,
        previous_weight: entry.previousWeight,
        reps: entry.reps,
        rir: entry.rir ?? "",
        notes: entry.notes ?? "",
        ...(observation ? { observation } : {}),
      };
    }),
  });

  if (error) throw mapCycleScopedRepositoryError(error);
  if (typeof data !== "string" || data.length === 0) {
    throw new CycleScopedTrainingRepositoryError(
      "unexpected",
      "No pudimos confirmar el entrenamiento guardado.",
    );
  }

  return data;
}

export async function addCycleScopedTrainingDaysAndExercises(
  input: AddCycleScopedTrainingPlanInput,
): Promise<AddCycleScopedTrainingPlanResult> {
  if (!input.cycleId || input.days.length === 0) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "Agrega al menos un cambio al plan activo.",
    );
  }

  const { supabase, userId } = await getAuthenticatedCycleScopedRepository();

  const { data: activeCycle, error: cycleError } = await supabase
    .from("training_cycles")
    .select("id")
    .eq("id", input.cycleId)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (cycleError) throw mapCycleScopedRepositoryError(cycleError);
  if (!activeCycle) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "El ciclo cycle-scoped ya no esta activo.",
    );
  }

  const routineIds = Array.from(new Set(input.days.map((day) => day.routineId)));
  const { data: routines, error: routinesError } = await supabase
    .from("training_cycle_routines")
    .select("id")
    .eq("user_id", userId)
    .eq("cycle_id", input.cycleId)
    .in("id", routineIds)
    .is("deleted_at", null);

  if (routinesError) throw mapCycleScopedRepositoryError(routinesError);
  if ((routines ?? []).length !== routineIds.length) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "Una de las rutinas seleccionadas no pertenece al ciclo activo.",
    );
  }

  const { data: currentDays, error: daysError } = await supabase
    .from("training_cycle_days")
    .select("id,routine_id,week_index,day_code")
    .eq("user_id", userId)
    .eq("cycle_id", input.cycleId)
    .is("deleted_at", null);

  if (daysError) throw mapCycleScopedRepositoryError(daysError);

  const currentDaysByKey = new Map(
    (currentDays ?? []).map((day) => [`${day.week_index}:${day.day_code}`, day]),
  );
  const requestedDayKeys = new Set<string>();
  for (const day of input.days) {
    const key = `${day.weekIndex}:${day.dayCode}`;
    if (requestedDayKeys.has(key)) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "El mismo dia aparece mas de una vez en la actualizacion.",
      );
    }
    requestedDayKeys.add(key);

    const existingDay = currentDaysByKey.get(key);
    if (day.existingDayId && existingDay?.id !== day.existingDayId) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "Uno de los dias seleccionados no pertenece al ciclo activo.",
      );
    }
  }

  const missingDays = input.days.filter((day) =>
    !currentDaysByKey.has(`${day.weekIndex}:${day.dayCode}`),
  );
  let insertedDays: Array<{ id: string; routine_id: string; week_index: number; day_code: string }> = [];
  if (missingDays.length > 0) {
    const { data, error } = await supabase
      .from("training_cycle_days")
      .insert(missingDays.map((day) => ({
        user_id: userId,
        cycle_id: input.cycleId,
        routine_id: day.routineId,
        week_index: Math.max(1, day.weekIndex),
        day_code: day.dayCode,
        sort_order: Math.max(0, day.sortOrder),
        notes: day.notes ?? null,
      })))
      .select("id,routine_id,week_index,day_code");

    if (error) throw mapCycleScopedRepositoryError(error);
    insertedDays = data ?? [];
    if (insertedDays.length !== missingDays.length) {
      throw new CycleScopedTrainingRepositoryError(
        "unexpected",
        "No pudimos confirmar todos los dias agregados.",
      );
    }
  }

  const allDays = [...(currentDays ?? []), ...insertedDays];
  const allDaysByKey = new Map(
    allDays.map((day) => [`${day.week_index}:${day.day_code}`, day]),
  );
  const daysWithIds = input.days.map((day) => {
    const persistedDay = allDaysByKey.get(`${day.weekIndex}:${day.dayCode}`);
    if (!persistedDay) {
      throw new CycleScopedTrainingRepositoryError(
        "unexpected",
        "No pudimos resolver uno de los dias del plan actualizado.",
      );
    }

    return {
      ...day,
      dayId: persistedDay.id,
    };
  });
  const additions = daysWithIds.flatMap((day) =>
    day.exercises.map((exercise) => ({
      ...exercise,
      dayId: day.dayId,
    })),
  );
  const updates = daysWithIds.flatMap((day) =>
    (day.updates ?? []).map((exercise) => ({
      ...exercise,
      dayId: day.dayId,
    })),
  );
  const replacements = daysWithIds.flatMap((day) =>
    (day.replacements ?? []).map((exercise) => ({
      ...exercise,
      dayId: day.dayId,
    })),
  );
  const retiredIds = Array.from(new Set([
    ...daysWithIds.flatMap((day) => [
      ...(day.pendingDeleteExerciseIds ?? []),
      ...(day.registeredRetireExerciseIds ?? []),
    ]),
    ...replacements.map((replacement) => replacement.previousExerciseId),
  ]));
  const affectedExerciseIds = Array.from(new Set([
    ...updates.map((exercise) => exercise.exerciseId),
    ...replacements.map((exercise) => exercise.previousExerciseId),
    ...retiredIds,
  ]));
  const dayIds = Array.from(new Set([
    ...additions.map((addition) => addition.dayId),
    ...updates.map((update) => update.dayId),
    ...replacements.map((replacement) => replacement.dayId),
    ...daysWithIds.map((day) => day.dayId),
  ]));

  const { data: existingExercises, error: existingError } = await supabase
    .from("training_cycle_exercises")
    .select("id,day_id,name,notes,source_legacy_exercise_id,exercise_lineage_id")
    .eq("user_id", userId)
    .eq("cycle_id", input.cycleId)
    .in("day_id", dayIds)
    .is("deleted_at", null);

  if (existingError) throw mapCycleScopedRepositoryError(existingError);

  const existingById = new Map((existingExercises ?? []).map((exercise) => [exercise.id, exercise]));
  for (const exerciseId of affectedExerciseIds) {
    if (!existingById.has(exerciseId)) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "Uno de los ejercicios seleccionados no pertenece al ciclo activo.",
      );
    }
  }

  const { data: linkedEntries, error: entriesError } = affectedExerciseIds.length > 0
    ? await supabase
      .from("exercise_entries")
      .select("training_cycle_exercise_id,training_sessions!inner(id,user_id,deleted_at)")
      .eq("user_id", userId)
      .in("training_cycle_exercise_id", affectedExerciseIds)
      .eq("training_sessions.user_id", userId)
      .is("training_sessions.deleted_at", null)
    : { data: [], error: null };

  if (entriesError) throw mapCycleScopedRepositoryError(entriesError);
  const registeredExerciseIds = new Set(
    (linkedEntries ?? [])
      .map((entry) => entry.training_cycle_exercise_id)
      .filter((id): id is string => Boolean(id)),
  );
  const invalidPendingUpdates = updates.filter((update) => registeredExerciseIds.has(update.exerciseId));
  if (invalidPendingUpdates.length > 0) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "Un ejercicio con historial debe versionarse, no actualizarse directamente.",
    );
  }

  const existingKeys = new Set(
    (existingExercises ?? [])
      .filter((exercise) => !retiredIds.includes(exercise.id) && !isCycleScopedExerciseRetired(exercise.notes))
      .map((exercise) => `${exercise.day_id}:${normalizeCycleScopedExerciseName(exercise.name)}`),
  );
  const additionKeys = new Set<string>();
  const insertions = [
    ...additions,
    ...replacements.map((replacement) => ({
      dayId: replacement.dayId,
      name: replacement.name,
      targetSets: replacement.targetSets,
      targetReps: replacement.targetReps,
      baseWeight: replacement.baseWeight,
      sideWeight: replacement.sideWeight,
      sortOrder: replacement.sortOrder,
      notes: replacement.notes,
      exerciseLineageId: replacement.exerciseLineageId ??
        resolveExerciseLineageIdForReplacement(existingById.get(replacement.previousExerciseId)),
    })),
  ];
  const uniqueAdditions = insertions.filter((addition) => {
    const key = `${addition.dayId}:${normalizeCycleScopedExerciseName(addition.name)}`;
    if (!normalizeCycleScopedExerciseName(addition.name)) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "Cada ejercicio nuevo requiere un nombre.",
      );
    }
    if (existingKeys.has(key) || additionKeys.has(key)) return false;
    additionKeys.add(key);
    return true;
  });

  for (const update of updates) {
    const current = existingById.get(update.exerciseId);
    if (!current) continue;
    const key = `${update.dayId}:${normalizeCycleScopedExerciseName(update.name)}`;
    const currentKey = `${current.day_id}:${normalizeCycleScopedExerciseName(current.name)}`;
    if (key !== currentKey && (existingKeys.has(key) || additionKeys.has(key))) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        `El ejercicio "${update.name.trim()}" ya existe en ese dia.`,
      );
    }
    existingKeys.delete(currentKey);
    existingKeys.add(key);
  }

  const updatedExercises: Array<{ id: string }> = [];
  if (updates.length > 0) {
    for (const update of updates) {
      const { data, error } = await supabase
        .from("training_cycle_exercises")
        .update({
          name: update.name.trim(),
          target_sets: Math.max(1, update.targetSets),
          target_reps: Math.max(1, update.targetReps),
          base_weight: Math.max(0, update.baseWeight),
          side_weight: update.sideWeight ?? null,
          sort_order: Math.max(0, update.sortOrder),
          notes: update.notes ?? null,
        })
        .eq("id", update.exerciseId)
        .eq("user_id", userId)
        .eq("cycle_id", input.cycleId)
        .eq("day_id", update.dayId)
        .is("deleted_at", null)
        .select("id");

      if (error) throw mapCycleScopedRepositoryError(error);
      if ((data ?? []).length !== 1) {
        throw new CycleScopedTrainingRepositoryError(
          "unexpected",
          "No pudimos confirmar la actualizacion de un ejercicio.",
        );
      }
      updatedExercises.push(data[0]);
    }
  }

  let insertedExercises: Array<{ id: string }> = [];
  if (uniqueAdditions.length > 0) {
    const additionsWithLineage = [];
    for (const addition of uniqueAdditions) {
      additionsWithLineage.push({
        ...addition,
        exerciseLineageId: addition.exerciseLineageId ??
          await createTrainingExerciseLineage(supabase, userId, null),
      });
    }

    const { data, error } = await supabase
      .from("training_cycle_exercises")
      .insert(additionsWithLineage.map((addition) => ({
        user_id: userId,
        cycle_id: input.cycleId,
        day_id: addition.dayId,
        name: addition.name.trim(),
        target_sets: Math.max(1, addition.targetSets),
        target_reps: Math.max(1, addition.targetReps),
        base_weight: Math.max(0, addition.baseWeight),
        side_weight: addition.sideWeight ?? null,
        sort_order: Math.max(0, addition.sortOrder),
        notes: addition.notes ?? null,
        source_legacy_exercise_id: null,
        exercise_lineage_id: addition.exerciseLineageId,
      })))
      .select("id");

    if (error) throw mapCycleScopedRepositoryError(error);
    insertedExercises = data ?? [];
    if (insertedExercises.length !== uniqueAdditions.length) {
      throw new CycleScopedTrainingRepositoryError(
        "unexpected",
        "No pudimos confirmar todos los ejercicios agregados.",
      );
    }
  }

  const retiredAt = new Date().toISOString();
  const retiredExercises: Array<{ id: string }> = [];
  if (retiredIds.length > 0) {
    for (const exerciseId of retiredIds) {
      const current = existingById.get(exerciseId);
      if (!current) continue;
      const hasEntries = registeredExerciseIds.has(exerciseId);
      const updatePayload = hasEntries
        ? { notes: createCycleScopedRetiredExerciseNotes(current.notes ?? null, retiredAt) }
        : { deleted_at: retiredAt };
      const { data, error } = await supabase
        .from("training_cycle_exercises")
        .update(updatePayload)
        .eq("id", exerciseId)
        .eq("user_id", userId)
        .eq("cycle_id", input.cycleId)
        .is("deleted_at", null)
        .select("id");

      if (error) throw mapCycleScopedRepositoryError(error);
      if ((data ?? []).length !== 1) {
        throw new CycleScopedTrainingRepositoryError(
          "unexpected",
          "No pudimos confirmar el retiro de un ejercicio.",
        );
      }
      retiredExercises.push(data[0]);
    }
  }

  return {
    daysAdded: insertedDays.length,
    exercisesAdded: insertedExercises.length,
    exercisesUpdated: updatedExercises.length,
    exercisesRetired: retiredExercises.length,
  };
}

export async function getCycleScopedTrainingPlan(cycleId: string): Promise<CycleScopedTrainingPlan> {
  const { supabase, userId } = await getAuthenticatedCycleScopedRepository();

  const { data: routines, error: routinesError } = await supabase
    .from("training_cycle_routines")
    .select("id,cycle_id,name,sort_order,notes")
    .eq("user_id", userId)
    .eq("cycle_id", cycleId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (routinesError) throw mapCycleScopedRepositoryError(routinesError);

  const { data: days, error: daysError } = await supabase
    .from("training_cycle_days")
    .select("id,cycle_id,routine_id,week_index,day_code,sort_order,notes")
    .eq("user_id", userId)
    .eq("cycle_id", cycleId)
    .is("deleted_at", null)
    .order("week_index", { ascending: true })
    .order("sort_order", { ascending: true });

  if (daysError) throw mapCycleScopedRepositoryError(daysError);

  const { data: exercises, error: exercisesError } = await supabase
    .from("training_cycle_exercises")
    .select("id,cycle_id,day_id,name,target_sets,target_reps,base_weight,side_weight,sort_order,notes,source_legacy_exercise_id,exercise_lineage_id")
    .eq("user_id", userId)
    .eq("cycle_id", cycleId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (exercisesError) throw mapCycleScopedRepositoryError(exercisesError);

  return mapCycleScopedTrainingPlan(
    (routines ?? []) as unknown as CycleScopedRoutineRow[],
    (days ?? []) as unknown as CycleScopedDayRow[],
    (exercises ?? []) as unknown as CycleScopedExerciseRow[],
  );
}

export async function getCycleScopedTrainingSessionData(
  cycleId: string,
  plan: CycleScopedTrainingPlan,
): Promise<CycleScopedTrainingSessionData> {
  const { supabase, userId } = await getAuthenticatedCycleScopedRepository();
  const planIndex = createCycleScopedPlanIndex(plan);

  const { data: sessions, error: sessionsError } = await supabase
    .from("training_sessions")
    .select("id,cycle_id,cycle_day_id,week_number,trained_at,calendar_week_start,planned_day,planned_date,trained_date,status,completed_at,deleted_at,notes,created_at")
    .eq("user_id", userId)
    .eq("cycle_id", cycleId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (sessionsError) throw mapCycleScopedRepositoryError(sessionsError);

  const sessionRows = (sessions ?? []) as unknown as CycleScopedTrainingSessionRow[];
  if (sessionRows.length === 0) {
    return { sessions: [], entries: [] };
  }

  const sessionIds = sessionRows.map((session) => session.id);
  const { data: entries, error: entriesError } = await supabase
    .from("exercise_entries")
    .select("id,session_id,exercise_id,training_cycle_exercise_id,exercise_lineage_id,weight,previous_weight,reps,rir,notes,created_at")
    .eq("user_id", userId)
    .in("session_id", sessionIds)
    .order("created_at", { ascending: true });

  if (entriesError) throw mapCycleScopedRepositoryError(entriesError);
  const entryRows = (entries ?? []) as unknown as CycleScopedTrainingSessionEntryRow[];
  const historicalExerciseIds = Array.from(new Set(
    entryRows
      .map((entry) => entry.training_cycle_exercise_id)
      .filter((id): id is string => typeof id === "string" && !planIndex.exercisesById.has(id)),
  ));

  if (historicalExerciseIds.length > 0) {
    const { data: historicalExercises, error: historicalError } = await supabase
      .from("training_cycle_exercises")
      .select("id,cycle_id,day_id,name,target_sets,target_reps,base_weight,side_weight,sort_order,notes,source_legacy_exercise_id,exercise_lineage_id")
      .eq("user_id", userId)
      .eq("cycle_id", cycleId)
      .in("id", historicalExerciseIds);

    if (historicalError) throw mapCycleScopedRepositoryError(historicalError);
    for (const exercise of (historicalExercises ?? []) as unknown as CycleScopedExerciseRow[]) {
      planIndex.exercisesById.set(exercise.id, mapCycleScopedExerciseRow(exercise));
    }
  }

  return mapCycleScopedTrainingSessionData(
    sessionRows,
    entryRows,
    planIndex,
  );
}

function toCreateTrainingCycleWithPlanPayload(plan: CycleScopedPlanInput) {
  return {
    source: plan.source,
    trainingDays: plan.trainingDays,
    exerciseCount: plan.exerciseCount,
    routines: plan.routines.map((routine) => ({
      name: routine.name,
      sort_order: routine.sortOrder,
      notes: routine.notes ?? null,
      days: routine.days.map((day) => ({
        week_index: day.weekIndex,
        day_code: day.dayCode,
        sort_order: day.sortOrder,
        notes: day.notes ?? null,
        exercises: day.exercises.map((exercise) => ({
          name: exercise.name,
          target_sets: exercise.targetSets,
          target_reps: exercise.targetReps,
          base_weight: exercise.baseWeight,
          side_weight: exercise.sideWeight ?? null,
          sort_order: exercise.sortOrder,
          notes: exercise.notes ?? null,
          source_legacy_exercise_id: exercise.sourceLegacyExerciseId ?? null,
          exercise_lineage_id: exercise.exerciseLineageId ?? null,
        })),
      })),
    })),
  };
}

async function getAuthenticatedCycleScopedRepository() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new CycleScopedTrainingRepositoryError(
      "session_required",
      "Debes iniciar sesion para gestionar el plan del ciclo.",
    );
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new CycleScopedTrainingRepositoryError(
      "session_expired",
      "Tu sesion expiro. Inicia sesion nuevamente.",
      error,
    );
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new CycleScopedTrainingRepositoryError(
      "session_required",
      "Debes iniciar sesion para gestionar el plan del ciclo.",
    );
  }

  return { supabase, userId };
}

async function createTrainingExerciseLineage(
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  userId: string,
  sourceLegacyExerciseId: string | null,
) {
  if (!supabase) {
    throw new CycleScopedTrainingRepositoryError(
      "session_required",
      "Debes iniciar sesion para gestionar el plan del ciclo.",
    );
  }

  if (sourceLegacyExerciseId) {
    const { data: existing, error: existingError } = await supabase
      .from("training_exercise_lineages")
      .select("id")
      .eq("user_id", userId)
      .eq("source_legacy_exercise_id", sourceLegacyExerciseId)
      .maybeSingle();

    if (existingError) throw mapCycleScopedRepositoryError(existingError);
    if (existing?.id) return existing.id as string;
  }

  const { data, error } = await supabase
    .from("training_exercise_lineages")
    .insert(createExerciseLineageInsertPayload({ userId, sourceLegacyExerciseId }))
    .select("id")
    .single();

  if (error) throw mapCycleScopedRepositoryError(error);
  if (!data?.id) {
    throw new CycleScopedTrainingRepositoryError(
      "unexpected",
      "No pudimos confirmar la identidad historica del ejercicio.",
    );
  }

  return data.id as string;
}

function validatePlanInput(input: CycleScopedTrainingCycleInput) {
  if (input.durationWeeks <= 0) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "La duracion del ciclo debe ser mayor que cero.",
    );
  }

  if (input.plan.routines.length === 0) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "Configura al menos una rutina antes de crear el ciclo.",
    );
  }

  const hasDay = input.plan.routines.some((routine) => routine.days.length > 0);
  const hasExercise = input.plan.routines.some((routine) =>
    routine.days.some((day) => day.exercises.length > 0),
  );

  if (!hasDay || !hasExercise) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "Configura al menos un dia y un ejercicio antes de crear el ciclo.",
    );
  }
}

function validateTrainingSessionInput(input: CycleScopedTrainingSessionInput) {
  if (!input.cycleId || !input.cycleDayId) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "El ciclo y el dia del ciclo son obligatorios para guardar el entrenamiento.",
    );
  }

  if (input.status === "completed" && input.entries.length === 0) {
    throw new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "Registra al menos un ejercicio antes de guardar el entrenamiento.",
    );
  }

  for (const entry of input.entries) {
    if (!entry.trainingCycleExerciseId) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "Cada ejercicio debe estar vinculado al plan cycle-scoped.",
      );
    }

    if (entry.reps.length === 0) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "Cada ejercicio requiere al menos una serie registrada.",
      );
    }
  }
}

function mapCycleScopedTrainingPlan(
  routines: CycleScopedRoutineRow[],
  days: CycleScopedDayRow[],
  exercises: CycleScopedExerciseRow[],
): CycleScopedTrainingPlan {
  const exercisesByDay = new Map<string, CycleScopedExercise[]>();
  for (const exercise of exercises) {
    if (isCycleScopedExerciseRetired(exercise.notes)) continue;
    const list = exercisesByDay.get(exercise.day_id) ?? [];
    list.push(mapCycleScopedExerciseRow(exercise));
    exercisesByDay.set(exercise.day_id, list);
  }

  const daysByRoutine = new Map<string, CycleScopedDay[]>();
  for (const day of days) {
    const list = daysByRoutine.get(day.routine_id) ?? [];
    list.push({
      id: day.id,
      cycleId: day.cycle_id,
      routineId: day.routine_id,
      weekIndex: day.week_index,
      dayCode: readTrainingDayCode(day.day_code),
      sortOrder: day.sort_order,
      notes: day.notes,
      exercises: exercisesByDay.get(day.id) ?? [],
    });
    daysByRoutine.set(day.routine_id, list);
  }

  return {
    routines: routines.map((routine) => ({
      id: routine.id,
      cycleId: routine.cycle_id,
      name: routine.name,
      sortOrder: routine.sort_order,
      notes: routine.notes,
      days: daysByRoutine.get(routine.id) ?? [],
    })),
  };
}

function mapCycleScopedExerciseRow(exercise: CycleScopedExerciseRow): CycleScopedExercise {
  return {
    id: exercise.id,
    cycleId: exercise.cycle_id,
    dayId: exercise.day_id,
    name: exercise.name,
    targetSets: exercise.target_sets,
    targetReps: exercise.target_reps,
    baseWeight: Number(exercise.base_weight),
    sideWeight: exercise.side_weight === null ? null : Number(exercise.side_weight),
    sortOrder: exercise.sort_order,
    notes: getCycleScopedExerciseDisplayNotes(exercise.notes),
    sourceLegacyExerciseId: exercise.source_legacy_exercise_id,
    exerciseLineageId: exercise.exercise_lineage_id,
  };
}

function createCycleScopedPlanIndex(plan: CycleScopedTrainingPlan) {
  const daysById = new Map<string, CycleScopedDay>();
  const routinesByDayId = new Map<string, CycleScopedRoutine>();
  const exercisesById = new Map<string, CycleScopedExercise>();

  for (const routine of plan.routines) {
    for (const day of routine.days) {
      daysById.set(day.id, day);
      routinesByDayId.set(day.id, routine);
      for (const exercise of day.exercises) {
        exercisesById.set(exercise.id, exercise);
      }
    }
  }

  return { daysById, routinesByDayId, exercisesById };
}

function mapCycleScopedTrainingSessionData(
  sessionRows: CycleScopedTrainingSessionRow[],
  entryRows: CycleScopedTrainingSessionEntryRow[],
  planIndex: ReturnType<typeof createCycleScopedPlanIndex>,
): CycleScopedTrainingSessionData {
  const entriesBySessionId = new Map<string, ExerciseEntry[]>();
  const sessionsById = new Map(sessionRows.map((session) => [session.id, session]));

  for (const entry of entryRows) {
    const session = sessionsById.get(entry.session_id);
    if (!session) continue;

    const cycleExerciseId = entry.training_cycle_exercise_id;
    if (!cycleExerciseId) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "Una serie cycle-scoped no tiene training_cycle_exercise_id.",
      );
    }

    const exercise = planIndex.exercisesById.get(cycleExerciseId);
    const day = session.cycle_day_id ? planIndex.daysById.get(session.cycle_day_id) : undefined;
    const routine = day ? planIndex.routinesByDayId.get(day.id) : undefined;
    if (!exercise || !day || !routine) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "No pudimos asociar una serie guardada con el plan cycle-scoped activo.",
      );
    }

    const trainedDate = session.trained_date ?? session.trained_at;
    const sessionEntries = entriesBySessionId.get(entry.session_id) ?? [];
    sessionEntries.push({
      id: entry.id,
      sessionId: entry.session_id,
      cycleId: session.cycle_id,
      cycleDayId: session.cycle_day_id,
      trainingCycleExerciseId: cycleExerciseId,
      exerciseLineageId: entry.exercise_lineage_id ?? exercise.exerciseLineageId,
      exerciseId: cycleExerciseId,
      exerciseName: exercise.name,
      routine: routine.name,
      week: session.week_number,
      date: trainedDate,
      targetSets: exercise.targetSets,
      targetReps: exercise.targetReps,
      weight: Number(entry.weight),
      previousWeight: Number(entry.previous_weight),
      reps: readRepsArray(entry.reps),
      notes: entry.notes ?? exercise.notes ?? undefined,
      rir: entry.rir ?? undefined,
    });
    entriesBySessionId.set(entry.session_id, sessionEntries);
  }

  const mappedSessions = sessionRows.map((session) => {
    const day = session.cycle_day_id ? planIndex.daysById.get(session.cycle_day_id) : undefined;
    const routine = day ? planIndex.routinesByDayId.get(day.id) : undefined;
    if (!day || !routine) {
      throw new CycleScopedTrainingRepositoryError(
        "invalid_plan",
        "No pudimos asociar una sesion guardada con el plan cycle-scoped activo.",
      );
    }

    const trainedDate = session.trained_date ?? session.trained_at;
    return {
      id: session.id,
      cycleId: session.cycle_id,
      cycleDayId: session.cycle_day_id,
      routineId: routine.id,
      routine: routine.name,
      weekNumber: session.week_number,
      calendarWeekStart: session.calendar_week_start,
      plannedDay: readTrainingDayCode(session.planned_day ?? day.dayCode),
      plannedDate: session.planned_date,
      trainedDate,
      trainedAt: session.trained_at,
      status: readTrainingSessionStatus(session.status),
      completedAt: session.completed_at ?? undefined,
      deletedAt: session.deleted_at ?? undefined,
      notes: session.notes ?? undefined,
      entries: entriesBySessionId.get(session.id) ?? [],
    } satisfies TrainingSession;
  });

  const chronologicalEntries = [...mappedSessions]
    .reverse()
    .flatMap((session) => session.entries);

  return {
    sessions: mappedSessions,
    entries: chronologicalEntries,
  };
}

function readTrainingSessionStatus(value: string): TrainingSessionStatus {
  return value === "skipped" ? "skipped" : "completed";
}

function readRepsArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item) || 0);
}

function mapCycleScopedRepositoryError(error: unknown) {
  const code = readSupabaseErrorCode(error);

  if (code === "23505") {
    return new CycleScopedTrainingRepositoryError(
      "active_cycle_exists",
      "Ya existe un ciclo activo para este usuario.",
      error,
    );
  }

  if (code === "42501") {
    return new CycleScopedTrainingRepositoryError(
      "permission_denied",
      "No tienes permisos para gestionar este plan de ciclo.",
      error,
    );
  }

  if (code === "P0001") {
    return new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      "No pudimos validar el plan de entrenamiento. Revisa los datos e intenta nuevamente.",
      error,
    );
  }

  return new CycleScopedTrainingRepositoryError(
    "unexpected",
    "No pudimos completar la accion sobre el plan del ciclo.",
    error,
  );
}

function readTrainingDayCode(value: string): TrainingDayCode {
  if (
    value === "monday" ||
    value === "tuesday" ||
    value === "wednesday" ||
    value === "thursday" ||
    value === "friday" ||
    value === "saturday" ||
    value === "sunday"
  ) {
    return value;
  }

  return "monday";
}

function readSupabaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code);
}

interface CycleScopedRoutineRow {
  id: string;
  cycle_id: string;
  name: string;
  sort_order: number;
  notes: string | null;
}

interface CycleScopedDayRow {
  id: string;
  cycle_id: string;
  routine_id: string;
  week_index: number;
  day_code: string;
  sort_order: number;
  notes: string | null;
}

interface CycleScopedExerciseRow {
  id: string;
  cycle_id: string;
  day_id: string;
  name: string;
  target_sets: number;
  target_reps: number;
  base_weight: number | string;
  side_weight: number | string | null;
  sort_order: number;
  notes: string | null;
  source_legacy_exercise_id: string | null;
  exercise_lineage_id: string | null;
}

interface CycleScopedTrainingSessionRow {
  id: string;
  cycle_id: string;
  cycle_day_id: string | null;
  week_number: number;
  trained_at: string;
  calendar_week_start: string | null;
  planned_day: string | null;
  planned_date: string | null;
  trained_date: string | null;
  status: string;
  completed_at: string | null;
  deleted_at: string | null;
  notes: string | null;
  created_at: string;
}

interface CycleScopedTrainingSessionEntryRow {
  id: string;
  session_id: string;
  exercise_id: string | null;
  training_cycle_exercise_id: string | null;
  exercise_lineage_id: string | null;
  weight: number | string;
  previous_weight: number | string;
  reps: unknown;
  rir: string | null;
  notes: string | null;
  created_at: string;
}
