import { demoEntries, exerciseTemplates } from "@/lib/data/demo";
import type { ExerciseEntry, ExerciseTemplate, RoutineName } from "@/lib/progress/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type DataSource = "local" | "supabase";
export type RepositoryMode = "demo" | "supabase";

export interface AppData {
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  source: DataSource;
}

const LOCAL_EXERCISES_KEY = "organizatech:exercises";
const LOCAL_ENTRIES_KEY = "organizatech:entries";

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
  const entries = await fetchEntries(userId);
  return { exercises, entries, source: "supabase" };
}

export async function saveExercise(exercise: ExerciseTemplate, mode: RepositoryMode = "demo"): Promise<ExerciseTemplate> {
  const auth = await getRepositoryAuth(mode);

  if (auth.mode === "demo") {
    const local = loadLocalData();
    const exists = local.exercises.some((item) => item.id === exercise.id);
    const exercises = exists
      ? local.exercises.map((item) => (item.id === exercise.id ? exercise : item))
      : [...local.exercises, exercise];
    saveLocalData(exercises, local.entries);
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
    );
    return;
  }

  const { supabase, userId } = auth;
  const { error } = await supabase.from("exercises").delete().eq("id", exerciseId).eq("user_id", userId);
  if (error) throw error;
}

export async function saveTrainingEntry(entry: ExerciseEntry, mode: RepositoryMode = "demo"): Promise<ExerciseEntry> {
  const auth = await getRepositoryAuth(mode);

  if (auth.mode === "demo") {
    const local = loadLocalData();
    const entries = [...local.entries, entry];
    saveLocalData(local.exercises, entries);
    return entry;
  }

  const { supabase, userId } = auth;
  const { data: session, error: sessionError } = await supabase
    .from("training_sessions")
    .insert({
      user_id: userId,
      week_number: entry.week,
      trained_at: entry.date,
      notes: entry.notes ?? null,
    })
    .select("id")
    .single();

  if (sessionError) throw sessionError;

  const { data, error } = await supabase
    .from("exercise_entries")
    .insert({
      id: entry.id,
      user_id: userId,
      session_id: session.id,
      exercise_id: entry.exerciseId,
      weight: entry.weight,
      previous_weight: entry.previousWeight,
      reps: entry.reps,
      rir: entry.rir ?? null,
      notes: entry.notes ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { ...entry, id: data.id };
}

export function resetLocalData() {
  saveLocalData(exerciseTemplates, demoEntries);
}

export function replaceLocalData(exercises: ExerciseTemplate[], entries: ExerciseEntry[]) {
  saveLocalData(exercises, entries);
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
    return { exercises: exerciseTemplates, entries: demoEntries, source: "local" };
  }

  const savedExercises = window.localStorage.getItem(LOCAL_EXERCISES_KEY);
  const savedEntries = window.localStorage.getItem(LOCAL_ENTRIES_KEY);
  const exercises = savedExercises ? (JSON.parse(savedExercises) as ExerciseTemplate[]) : [];
  const entries = savedEntries ? (JSON.parse(savedEntries) as ExerciseEntry[]) : [];

  if (!savedExercises || !savedEntries) saveLocalData(exercises, entries);
  return { exercises, entries, source: "local" };
}

function saveLocalData(exercises: ExerciseTemplate[], entries: ExerciseEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_EXERCISES_KEY, JSON.stringify(exercises));
  window.localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify(entries));
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

  return ((data ?? []) as unknown as SupabaseExerciseRow[]).map((row) => ({
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
    .select("id,weight,previous_weight,reps,rir,notes,training_sessions(week_number,trained_at),exercises(id,name,target_sets,target_reps,base_weight,notes,routines(name))")
    .eq("user_id", userId)
    .order("created_at");

  if (error) throw error;

  return ((data ?? []) as unknown as SupabaseEntryRow[]).map((row) => {
    const session = firstRelation(row.training_sessions);
    const exercise = firstRelation(row.exercises);

    return {
    id: row.id,
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
    };
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

function isMissingDayColumnError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message) : "";
  const code = "code" in error ? String(error.code) : "";
  return code === "PGRST204" || (message.toLowerCase().includes("day") && message.toLowerCase().includes("column"));
}

function firstRelation<T>(value: T | T[] | null): T {
  if (Array.isArray(value)) return value[0];
  if (!value) throw new Error("No se pudo leer una relación de Supabase.");
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
  weight: number | string;
  previous_weight: number | string;
  reps: number[];
  rir: string | null;
  notes: string | null;
  training_sessions: { week_number: number; trained_at: string } | Array<{ week_number: number; trained_at: string }>;
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
