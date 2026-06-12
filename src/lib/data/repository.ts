import { demoEntries, exerciseTemplates } from "@/lib/data/demo";
import type {
  ExerciseEntry,
  ExerciseTemplate,
  RoutineName,
  TrainingDayCode,
  TrainingSession,
  TrainingSessionStatus,
} from "@/lib/progress/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type DataSource = "local" | "supabase";
export type RepositoryMode = "demo" | "supabase";

export interface AppData {
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  source: DataSource;
}

const LOCAL_EXERCISES_KEY = "organizatech:exercises";
const LOCAL_ENTRIES_KEY = "organizatech:entries";
const LOCAL_SESSIONS_KEY = "organizatech:training-sessions";

export interface TrainingSessionEntryInput {
  id: string;
  exerciseId: string;
  exerciseName: string;
  routine: RoutineName;
  targetSets: number;
  targetReps: number;
  weight: number;
  previousWeight: number;
  reps: number[];
  rir?: string;
  notes?: string;
}

export interface SaveTrainingSessionInput {
  routine: RoutineName;
  plannedDay: TrainingDayCode;
  plannedDate: string;
  trainedDate: string;
  weekNumber: number;
  status: TrainingSessionStatus;
  notes?: string;
  entries: TrainingSessionEntryInput[];
}

export async function loadAppData(mode: RepositoryMode = "demo"): Promise<AppData> {
  if (mode === "demo") return loadLocalData();

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw createSessionRequiredError();
  }

  const { data: userData, error } = await supabase.auth.getUser();
  if (error) throw createSessionExpiredError();
  const user = userData.user;
  const userId = user?.id;
  if (!userId) throw createSessionRequiredError();

  await ensureProfile(userId, user.email ?? "");
  const exercises = await fetchExercises(userId);
  const sessions = await fetchTrainingSessions(userId);
  const entries = sessions.flatMap((session) => session.entries);
  return { exercises, entries, sessions, source: "supabase" };
}

export async function saveExercise(exercise: ExerciseTemplate, mode: RepositoryMode = "demo"): Promise<ExerciseTemplate> {
  const auth = await getRepositoryAuth(mode);

  if (auth.mode === "demo") {
    const local = loadLocalData();
    const exists = local.exercises.some((item) => item.id === exercise.id);
    const exercises = exists
      ? local.exercises.map((item) => (item.id === exercise.id ? exercise : item))
      : [...local.exercises, exercise];
    saveLocalData(exercises, local.entries, local.sessions);
    return exercise;
  }

  const { supabase, userId } = auth;
  const routineId = await upsertRoutine(userId, exercise.routine);
  const payload = {
    id: exercise.id,
    user_id: userId,
    routine_id: routineId,
    name: exercise.name,
    target_sets: exercise.targetSets,
    target_reps: exercise.targetReps,
    base_weight: exercise.baseWeight,
    side_weight: exercise.sideWeight ?? null,
    day: exercise.day ?? null,
    notes: exercise.notes ?? null,
  };

  let { data, error } = await supabase.from("exercises").upsert(payload).select("id").single();
  if (isMissingDayColumnError(error)) {
    const { day: _day, ...payloadWithoutDay } = payload;
    const retry = await supabase.from("exercises").upsert(payloadWithoutDay).select("id").single();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw error;
  return { ...exercise, id: data!.id };
}

export async function deleteExercise(exerciseId: string, mode: RepositoryMode = "demo"): Promise<void> {
  const auth = await getRepositoryAuth(mode);

  if (auth.mode === "demo") {
    const local = loadLocalData();
    saveLocalData(
      local.exercises.filter((exercise) => exercise.id !== exerciseId),
      local.entries.filter((entry) => entry.exerciseId !== exerciseId),
      local.sessions.map((session) => ({
        ...session,
        entries: session.entries.filter((entry) => entry.exerciseId !== exerciseId),
      })),
    );
    return;
  }

  const { supabase, userId } = auth;
  const { data, error } = await supabase
    .from("exercises")
    .delete()
    .eq("id", exerciseId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  if (!data?.some((exercise) => exercise.id === exerciseId)) {
    throw new Error("No pudimos confirmar la eliminacion del ejercicio.");
  }
}

export async function deactivateActiveCycle(mode: RepositoryMode = "demo"): Promise<void> {
  if (mode === "demo") {
    replaceLocalData([], []);
    return;
  }

  const auth = await getRepositoryAuth(mode);
  if (auth.mode === "demo") return;

  const { supabase, userId } = auth;
  const { data, error } = await supabase
    .from("exercises")
    .select("id,notes")
    .eq("user_id", userId);

  if (error) throw error;

  const inactiveAt = new Date().toISOString();
  const activeRows = ((data ?? []) as Array<{ id: string; notes: string | null }>).filter(
    (row) => !isInactiveCycleNote(row.notes),
  );

  for (const row of activeRows) {
    const nextNotes = appendInactiveCycleNote(row.notes, inactiveAt);
    const { error: updateError } = await supabase
      .from("exercises")
      .update({ notes: nextNotes })
      .eq("id", row.id)
      .eq("user_id", userId);

    if (updateError) throw updateError;
  }
}

export async function saveTrainingSessionWithEntries(
  input: SaveTrainingSessionInput,
  mode: RepositoryMode = "demo",
): Promise<TrainingSession> {
  const auth = await getRepositoryAuth(mode);
  const routineId = createIdFromRoutine(input.routine);
  const sessionId = crypto.randomUUID();
  const calendarWeekStart = getCalendarWeekStart(input.trainedDate);
  const entries = input.status === "completed"
    ? input.entries.map((entry) => ({
      id: entry.id,
      sessionId,
      exerciseId: entry.exerciseId,
      exerciseName: entry.exerciseName,
      routine: entry.routine,
      week: input.weekNumber,
      date: input.trainedDate,
      targetSets: entry.targetSets,
      targetReps: entry.targetReps,
      weight: entry.weight,
      previousWeight: entry.previousWeight,
      reps: entry.reps,
      notes: entry.notes,
      rir: entry.rir,
    }))
    : [];

  const session: TrainingSession = {
    id: sessionId,
    routineId,
    routine: input.routine,
    weekNumber: input.weekNumber,
    calendarWeekStart,
    plannedDay: input.plannedDay,
    plannedDate: input.plannedDate,
    trainedDate: input.trainedDate,
    trainedAt: input.trainedDate,
    status: input.status,
    completedAt: input.status === "completed" ? new Date().toISOString() : undefined,
    notes: input.notes,
    entries,
  };

  if (auth.mode === "demo") {
    const local = loadLocalData();
    saveLocalData(local.exercises, [...local.entries, ...entries], [...local.sessions, session]);
    return session;
  }

  const { supabase, userId } = auth;
  const persistedRoutineId = await upsertRoutine(userId, input.routine);
  const { data, error } = await supabase.rpc("create_training_session_with_entries", {
    p_routine_id: persistedRoutineId,
    p_planned_day: input.plannedDay,
    p_planned_date: input.plannedDate,
    p_trained_date: input.trainedDate,
    p_status: input.status,
    p_week_number: input.weekNumber,
    p_notes: input.notes ?? null,
    p_entries: input.status === "completed"
      ? input.entries.map((entry) => ({
        id: entry.id,
        exercise_id: entry.exerciseId,
        weight: entry.weight,
        previous_weight: entry.previousWeight,
        reps: entry.reps,
        rir: entry.rir ?? "",
        notes: entry.notes ?? "",
      }))
      : [],
  });

  if (error) throw error;

  return {
    ...session,
    id: String(data),
    routineId: persistedRoutineId,
    entries: entries.map((entry) => ({ ...entry, sessionId: String(data) })),
  };
}

export function resetLocalData() {
  saveLocalData(exerciseTemplates, demoEntries, deriveLegacyTrainingSessions(demoEntries));
}

export function replaceLocalData(exercises: ExerciseTemplate[], entries: ExerciseEntry[]) {
  saveLocalData(exercises, entries, deriveLegacyTrainingSessions(entries));
}

async function getRepositoryAuth(mode: RepositoryMode) {
  if (mode === "demo") return { mode: "demo" as const };

  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    throw createSessionRequiredError();
  }

  const { data: userData, error } = await supabase.auth.getUser();
  if (error) throw createSessionExpiredError();
  const userId = userData.user?.id;

  if (!userId) {
    throw createSessionRequiredError();
  }

  return { mode: "supabase" as const, supabase, userId };
}

function createSessionRequiredError() {
  return new Error("Debes iniciar sesión para continuar.");
}

function createSessionExpiredError() {
  return new Error("Tu sesión expiró. Inicia sesión nuevamente.");
}

function loadLocalData(): AppData {
  if (typeof window === "undefined") {
    return { exercises: exerciseTemplates, entries: demoEntries, sessions: deriveLegacyTrainingSessions(demoEntries), source: "local" };
  }

  const savedExercises = window.localStorage.getItem(LOCAL_EXERCISES_KEY);
  const savedEntries = window.localStorage.getItem(LOCAL_ENTRIES_KEY);
  const savedSessions = window.localStorage.getItem(LOCAL_SESSIONS_KEY);
  const exercises = savedExercises ? (JSON.parse(savedExercises) as ExerciseTemplate[]) : [];
  const entries = savedEntries ? (JSON.parse(savedEntries) as ExerciseEntry[]) : [];
  const sessions = savedSessions ? (JSON.parse(savedSessions) as TrainingSession[]) : deriveLegacyTrainingSessions(entries);

  if (!savedExercises || !savedEntries || !savedSessions) saveLocalData(exercises, entries, sessions);
  return { exercises, entries, sessions, source: "local" };
}

function saveLocalData(exercises: ExerciseTemplate[], entries: ExerciseEntry[], sessions: TrainingSession[] = deriveLegacyTrainingSessions(entries)) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_EXERCISES_KEY, JSON.stringify(exercises));
  window.localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify(entries));
  window.localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
}

async function ensureProfile(userId: string, email: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;

  const { error } = await supabase.from("profiles").upsert({
    id: userId,
    email,
    display_name: email.split("@")[0] || "Usuario",
  });
  if (error) throw error;
}

async function upsertRoutine(userId: string, routine: RoutineName) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("No pudimos completar la acción. Intenta nuevamente.");

  const existing = await supabase
    .from("routines")
    .select("id")
    .eq("user_id", userId)
    .eq("name", routine)
    .maybeSingle();

  if (existing.data?.id) return existing.data.id as string;

  const { data, error } = await supabase
    .from("routines")
    .insert({ user_id: userId, name: routine })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function fetchExercises(userId: string): Promise<ExerciseTemplate[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const response = await supabase
    .from("exercises")
    .select("id,name,target_sets,target_reps,base_weight,side_weight,day,notes,routines(name)")
    .eq("user_id", userId)
    .order("created_at");
  let data: unknown = response.data;
  let error = response.error;

  if (isMissingDayColumnError(error)) {
    const retry = await supabase
      .from("exercises")
      .select("id,name,target_sets,target_reps,base_weight,side_weight,notes,routines(name)")
      .eq("user_id", userId)
      .order("created_at");

    data = retry.data as unknown;
    error = retry.error;
  }

  if (error) throw error;

  return ((data ?? []) as unknown as SupabaseExerciseRow[])
    .filter((row) => !isInactiveCycleNote(row.notes))
    .map((row) => ({
      id: row.id,
      routine: readRoutineName(firstRelation(row.routines)?.name),
      name: row.name,
      targetSets: row.target_sets,
      targetReps: row.target_reps,
      baseWeight: Number(row.base_weight),
      sideWeight: row.side_weight === null ? undefined : Number(row.side_weight),
      day: readExerciseDay(row.day, row.notes),
      notes: row.notes ?? undefined,
    }));
}

async function fetchEntries(userId: string): Promise<ExerciseEntry[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("exercise_entries")
    .select("id,session_id,weight,previous_weight,reps,rir,notes,training_sessions(week_number,trained_at),exercises(id,name,target_sets,target_reps,base_weight,notes,routines(name))")
    .eq("user_id", userId)
    .order("created_at");

  if (error) throw error;

  return ((data ?? []) as unknown as SupabaseEntryRow[]).flatMap((row) => {
    const session = firstRelation(row.training_sessions);
    const exercise = firstRelation(row.exercises);
    if (isInactiveCycleNote(exercise.notes)) return [];

    return [{
      id: row.id,
      sessionId: row.session_id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      routine: readRoutineName(firstRelation(exercise.routines)?.name),
      week: session.week_number,
      date: session.trained_at,
      targetSets: exercise.target_sets,
      targetReps: exercise.target_reps,
      weight: Number(row.weight),
      previousWeight: Number(row.previous_weight),
      reps: row.reps,
      notes: row.notes ?? exercise.notes ?? undefined,
      rir: row.rir ?? undefined,
    }];
  });
}

export async function fetchTrainingSessions(userId: string): Promise<TrainingSession[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("training_sessions")
    .select("id,routine_id,week_number,trained_at,calendar_week_start,planned_day,planned_date,trained_date,status,completed_at,deleted_at,notes,routines(name),exercise_entries(id,exercise_id,weight,previous_weight,reps,rir,notes,exercises(id,name,target_sets,target_reps,base_weight,notes,routines(name)))")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at");

  if (isMissingTrainingSessionSourceColumnError(error)) {
    return deriveLegacyTrainingSessions(await fetchEntries(userId));
  }
  if (error) throw error;

  return ((data ?? []) as unknown as SupabaseTrainingSessionRow[]).map((row) => {
    const routineName = readRoutineName(firstRelationOrNull(row.routines)?.name);
    const trainedDate = row.trained_date ?? row.trained_at;
    const entries = (row.exercise_entries ?? []).flatMap((entry) => {
      const exercise = firstRelation(entry.exercises);
      if (isInactiveCycleNote(exercise.notes)) return [];

      return [{
        id: entry.id,
        sessionId: row.id,
        exerciseId: entry.exercise_id,
        exerciseName: exercise.name,
        routine: readRoutineName(firstRelationOrNull(exercise.routines)?.name) || routineName,
        week: row.week_number,
        date: trainedDate,
        targetSets: exercise.target_sets,
        targetReps: exercise.target_reps,
        weight: Number(entry.weight),
        previousWeight: Number(entry.previous_weight),
        reps: entry.reps,
        notes: entry.notes ?? row.notes ?? undefined,
        rir: entry.rir ?? undefined,
      }];
    });

    return {
      id: row.id,
      routineId: row.routine_id,
      routine: routineName,
      weekNumber: row.week_number,
      calendarWeekStart: row.calendar_week_start,
      plannedDay: readTrainingDayCode(row.planned_day),
      plannedDate: row.planned_date,
      trainedDate,
      trainedAt: row.trained_at,
      status: readTrainingSessionStatus(row.status),
      completedAt: row.completed_at ?? undefined,
      deletedAt: row.deleted_at ?? undefined,
      notes: row.notes ?? undefined,
      entries,
    };
  });
}

export async function fetchTrainingSessionEntries(sessionId: string, mode: RepositoryMode = "demo"): Promise<ExerciseEntry[]> {
  const auth = await getRepositoryAuth(mode);

  if (auth.mode === "demo") {
    return loadLocalData().sessions.find((session) => session.id === sessionId)?.entries ?? [];
  }

  const { supabase, userId } = auth;
  const { data, error } = await supabase
    .from("exercise_entries")
    .select("id,session_id,weight,previous_weight,reps,rir,notes,training_sessions(week_number,trained_at,trained_date),exercises(id,name,target_sets,target_reps,base_weight,notes,routines(name))")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at");

  if (error) throw error;

  return ((data ?? []) as unknown as SupabaseEntryRow[]).flatMap((row) => {
    const session = firstRelation(row.training_sessions);
    const exercise = firstRelation(row.exercises);
    if (isInactiveCycleNote(exercise.notes)) return [];

    return [{
      id: row.id,
      sessionId: row.session_id,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      routine: readRoutineName(firstRelationOrNull(exercise.routines)?.name),
      week: session.week_number,
      date: session.trained_date ?? session.trained_at,
      targetSets: exercise.target_sets,
      targetReps: exercise.target_reps,
      weight: Number(row.weight),
      previousWeight: Number(row.previous_weight),
      reps: row.reps,
      notes: row.notes ?? exercise.notes ?? undefined,
      rir: row.rir ?? undefined,
    }];
  });
}

function readRoutineName(value: string | undefined): RoutineName {
  return value?.trim() || "Pecho Hombro Tríceps";
}

function readExerciseDay(day: string | null | undefined, notes: string | null) {
  if (day?.trim()) return day;
  const match = notes?.match(/Rutina creada para ([^.]+)\./i);
  return match?.[1]?.trim() || undefined;
}

function isInactiveCycleNote(notes: string | null | undefined) {
  return Boolean(notes?.includes("[[organizatech:cycle-inactive:"));
}

function appendInactiveCycleNote(notes: string | null | undefined, inactiveAt: string) {
  const baseNotes = notes?.trim();
  const marker = `[[organizatech:cycle-inactive:${inactiveAt}]]`;
  return baseNotes ? `${baseNotes}\n${marker}` : marker;
}

function deriveLegacyTrainingSessions(entries: ExerciseEntry[]): TrainingSession[] {
  const grouped = new Map<string, ExerciseEntry[]>();
  for (const entry of entries) {
    const key = `${entry.date}:${entry.week}:${entry.routine}`;
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    const [date, weekText, routine] = key.split(":");
    const id = `legacy:${key}`;
    return {
      id,
      routineId: null,
      routine: routine || group[0]?.routine || "Rutina",
      weekNumber: Number(weekText) || 1,
      calendarWeekStart: getCalendarWeekStart(date),
      plannedDay: null,
      plannedDate: date,
      trainedDate: date,
      trainedAt: date,
      status: "completed",
      notes: "Sesion legacy derivada de exercise_entries.",
      entries: group.map((entry) => ({ ...entry, sessionId: entry.sessionId ?? id })),
    };
  });
}

function getCalendarWeekStart(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
  date.setDate(date.getDate() - (dayOfWeek - 1));
  const startYear = date.getFullYear();
  const startMonth = String(date.getMonth() + 1).padStart(2, "0");
  const startDay = String(date.getDate()).padStart(2, "0");
  return `${startYear}-${startMonth}-${startDay}`;
}

function createIdFromRoutine(routine: RoutineName) {
  return `local:${routine.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`;
}

function readTrainingDayCode(value: string | null): TrainingDayCode | null {
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
  return null;
}

function readTrainingSessionStatus(value: string | null): TrainingSessionStatus {
  return value === "skipped" ? "skipped" : "completed";
}

function isMissingDayColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message) : "";
  const code = "code" in error ? String(error.code) : "";
  return code === "PGRST204" || (message.toLowerCase().includes("day") && message.toLowerCase().includes("column"));
}

function isMissingTrainingSessionSourceColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  const code = "code" in error ? String(error.code) : "";
  return code === "PGRST204" || (
    message.includes("calendar_week_start") ||
    message.includes("planned_day") ||
    message.includes("planned_date") ||
    message.includes("trained_date") ||
    message.includes("routine_id")
  );
}

function firstRelation<T>(value: T | T[] | null): T {
  if (Array.isArray(value)) return value[0];
  if (!value) throw new Error("No se pudo leer una relación de Supabase.");
  return value;
}

function firstRelationOrNull<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

interface SupabaseExerciseRow {
  id: string;
  name: string;
  target_sets: number;
  target_reps: number;
  base_weight: number | string;
  side_weight: number | string | null;
  day?: string | null;
  notes: string | null;
  routines: { name?: string } | Array<{ name?: string }> | null;
}

interface SupabaseEntryRow {
  id: string;
  session_id: string;
  weight: number | string;
  previous_weight: number | string;
  reps: number[];
  rir: string | null;
  notes: string | null;
  training_sessions: { week_number: number; trained_at: string; trained_date?: string | null } | Array<{ week_number: number; trained_at: string; trained_date?: string | null }>;
  exercises: {
    id: string;
    name: string;
    target_sets: number;
    target_reps: number;
    base_weight: number | string;
    notes: string | null;
    routines: { name?: string } | Array<{ name?: string }> | null;
  } | Array<{
    id: string;
    name: string;
    target_sets: number;
    target_reps: number;
    base_weight: number | string;
    notes: string | null;
    routines: { name?: string } | Array<{ name?: string }> | null;
  }>;
}

interface SupabaseTrainingSessionRow {
  id: string;
  routine_id: string | null;
  week_number: number;
  trained_at: string;
  calendar_week_start: string | null;
  planned_day: string | null;
  planned_date: string | null;
  trained_date: string | null;
  status: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  notes: string | null;
  routines: { name?: string } | Array<{ name?: string }> | null;
  exercise_entries: Array<{
    id: string;
    exercise_id: string;
    weight: number | string;
    previous_weight: number | string;
    reps: number[];
    rir: string | null;
    notes: string | null;
    exercises: {
      id: string;
      name: string;
      target_sets: number;
      target_reps: number;
      base_weight: number | string;
      notes: string | null;
      routines: { name?: string } | Array<{ name?: string }> | null;
    } | Array<{
      id: string;
      name: string;
      target_sets: number;
      target_reps: number;
      base_weight: number | string;
      notes: string | null;
      routines: { name?: string } | Array<{ name?: string }> | null;
    }>;
  }>;
}
