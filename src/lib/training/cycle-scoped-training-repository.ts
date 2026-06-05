import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TrainingDayCode, TrainingSessionStatus } from "@/lib/progress/types";

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
  weight: number;
  previousWeight: number;
  reps: number[];
  rir?: string | null;
  notes?: string | null;
}

export interface CycleScopedTrainingPlan {
  routines: CycleScopedRoutine[];
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
}

export type CycleScopedTrainingRepositoryErrorCode =
  | "session_required"
  | "session_expired"
  | "invalid_plan"
  | "active_cycle_exists"
  | "permission_denied"
  | "unexpected";

export class CycleScopedTrainingRepositoryError extends Error {
  constructor(
    public readonly code: CycleScopedTrainingRepositoryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
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
    p_entries: input.entries.map((entry) => ({
      id: entry.id,
      training_cycle_exercise_id: entry.trainingCycleExerciseId,
      exercise_id: entry.exerciseId ?? null,
      weight: entry.weight,
      previous_weight: entry.previousWeight,
      reps: entry.reps,
      rir: entry.rir ?? "",
      notes: entry.notes ?? "",
    })),
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
    .select("id,cycle_id,day_id,name,target_sets,target_reps,base_weight,side_weight,sort_order,notes,source_legacy_exercise_id")
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
    const list = exercisesByDay.get(exercise.day_id) ?? [];
    list.push({
      id: exercise.id,
      cycleId: exercise.cycle_id,
      dayId: exercise.day_id,
      name: exercise.name,
      targetSets: exercise.target_sets,
      targetReps: exercise.target_reps,
      baseWeight: Number(exercise.base_weight),
      sideWeight: exercise.side_weight === null ? null : Number(exercise.side_weight),
      sortOrder: exercise.sort_order,
      notes: exercise.notes,
      sourceLegacyExerciseId: exercise.source_legacy_exercise_id,
    });
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

function mapCycleScopedRepositoryError(error: unknown) {
  const code = readSupabaseErrorCode(error);
  const message = readSupabaseErrorMessage(error).toLowerCase();

  if (code === "23505" || message.includes("ya existe un ciclo activo")) {
    return new CycleScopedTrainingRepositoryError(
      "active_cycle_exists",
      "Ya existe un ciclo activo para este usuario.",
      error,
    );
  }

  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return new CycleScopedTrainingRepositoryError(
      "permission_denied",
      "No tienes permisos para gestionar este plan de ciclo.",
      error,
    );
  }

  if (message.includes("requiere") || message.includes("obligatorio") || message.includes("invalido")) {
    return new CycleScopedTrainingRepositoryError(
      "invalid_plan",
      readSupabaseErrorMessage(error),
      error,
    );
  }

  return new CycleScopedTrainingRepositoryError(
    "unexpected",
    readSupabaseErrorMessage(error) || "No pudimos completar la accion sobre el plan del ciclo.",
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

function readSupabaseErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String(error.message);
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
}
