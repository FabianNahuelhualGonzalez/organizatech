import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface GetLatestExercisePerformanceByLineageInput {
  exerciseLineageId?: string | null;
  currentSessionId?: string | null;
  beforeTimestamp?: string | Date | null;
}

export interface LatestExercisePerformanceSeries {
  entryId: string;
  order: number;
  weight: number | null;
  previousWeight: number | null;
  reps: number | null;
  rir: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LatestExercisePerformance {
  sessionId: string;
  exerciseLineageId: string;
  trainedDate: string;
  trainedAt: string;
  completedAt: string | null;
  createdAt: string;
  series: LatestExercisePerformanceSeries[];
}

export interface ExerciseLastPerformanceCandidateEntryRow {
  id: string;
  user_id: string;
  session_id: string;
  exercise_lineage_id: string | null;
  weight: number | string | null;
  previous_weight: number | string | null;
  reps: unknown;
  rir: string | null;
  notes: string | null;
  created_at: string;
  training_sessions: ExerciseLastPerformanceSessionRow | ExerciseLastPerformanceSessionRow[] | null;
}

export interface ExerciseLastPerformanceEntryRow {
  id: string;
  user_id: string;
  session_id: string;
  exercise_lineage_id: string | null;
  weight: number | string | null;
  previous_weight: number | string | null;
  reps: unknown;
  rir: string | null;
  notes: string | null;
  created_at: string;
}

export interface ExerciseLastPerformanceSessionRow {
  id: string;
  user_id: string;
  status: string | null;
  trained_date: string | null;
  trained_at: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export type ExerciseLastPerformanceRepositoryErrorCode =
  | "session_required"
  | "session_expired"
  | "unexpected";

export class ExerciseLastPerformanceRepositoryError extends Error {
  constructor(
    public readonly code: ExerciseLastPerformanceRepositoryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExerciseLastPerformanceRepositoryError";
  }
}

export async function getLatestExercisePerformanceByLineage(
  input: GetLatestExercisePerformanceByLineageInput,
): Promise<LatestExercisePerformance | null> {
  const exerciseLineageId = normalizeExerciseLineageId(input.exerciseLineageId);
  if (!exerciseLineageId) return null;

  const beforeTimestamp = normalizeHistoricalTimestamp(input.beforeTimestamp);
  const { supabase, userId } = await getAuthenticatedExerciseLastPerformanceRepository();

  const { data: candidates, error: candidateError } = await supabase
    .from("exercise_entries")
    .select("id,user_id,session_id,exercise_lineage_id,weight,previous_weight,reps,rir,notes,created_at,training_sessions!inner(id,user_id,status,trained_date,trained_at,completed_at,deleted_at,created_at)")
    .eq("user_id", userId)
    .eq("exercise_lineage_id", exerciseLineageId)
    .eq("training_sessions.user_id", userId)
    .eq("training_sessions.status", "completed")
    .is("training_sessions.deleted_at", null);

  if (candidateError) throw mapExerciseLastPerformanceRepositoryError(candidateError);

  const latestSession = selectLatestCompletedSessionForLineage(
    (candidates ?? []) as unknown as ExerciseLastPerformanceCandidateEntryRow[],
    {
      userId,
      exerciseLineageId,
      currentSessionId: input.currentSessionId ?? null,
      beforeTimestamp,
    },
  );

  if (!latestSession) return null;

  const { data: sessionEntries, error: entriesError } = await supabase
    .from("exercise_entries")
    .select("id,user_id,session_id,exercise_lineage_id,weight,previous_weight,reps,rir,notes,created_at")
    .eq("user_id", userId)
    .eq("session_id", latestSession.id)
    .eq("exercise_lineage_id", exerciseLineageId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (entriesError) throw mapExerciseLastPerformanceRepositoryError(entriesError);

  return mapLatestExercisePerformance(
    latestSession,
    (sessionEntries ?? []) as unknown as ExerciseLastPerformanceEntryRow[],
    exerciseLineageId,
  );
}

export function selectLatestCompletedSessionForLineage(
  rows: ExerciseLastPerformanceCandidateEntryRow[],
  input: {
    userId: string;
    exerciseLineageId: string;
    currentSessionId?: string | null;
    beforeTimestamp?: string | null;
  },
): ExerciseLastPerformanceSessionRow | null {
  const sessions = new Map<string, ExerciseLastPerformanceSessionRow>();
  const beforeTime = input.beforeTimestamp ? Date.parse(input.beforeTimestamp) : null;

  for (const row of rows) {
    const session = firstRelation(row.training_sessions);
    if (!session) continue;
    if (row.user_id !== input.userId || session.user_id !== input.userId) continue;
    if (row.exercise_lineage_id !== input.exerciseLineageId) continue;
    if (session.status !== "completed") continue;
    if (session.deleted_at) continue;
    if (input.currentSessionId && session.id === input.currentSessionId) continue;

    const sessionTime = getSessionHistoricalTime(session);
    if (beforeTime !== null && sessionTime >= beforeTime) continue;
    sessions.set(session.id, session);
  }

  return [...sessions.values()].sort(compareSessionsDescending)[0] ?? null;
}

export function mapLatestExercisePerformance(
  session: ExerciseLastPerformanceSessionRow,
  rows: ExerciseLastPerformanceEntryRow[],
  exerciseLineageId: string,
): LatestExercisePerformance | null {
  const entries = rows
    .filter((row) =>
      row.user_id === session.user_id &&
      row.session_id === session.id &&
      row.exercise_lineage_id === exerciseLineageId
    )
    .sort(compareEntriesAscending);

  if (entries.length === 0) return null;

  let order = 1;
  const series = entries.flatMap((entry) =>
    readRepsArray(entry.reps).map((reps) => ({
      entryId: entry.id,
      order: order++,
      weight: readNumber(entry.weight),
      previousWeight: readNumber(entry.previous_weight),
      reps,
      rir: entry.rir,
      notes: entry.notes,
      createdAt: entry.created_at,
    })),
  );

  return {
    sessionId: session.id,
    exerciseLineageId,
    trainedDate: session.trained_date ?? session.trained_at ?? session.created_at,
    trainedAt: session.trained_at ?? session.created_at,
    completedAt: session.completed_at,
    createdAt: session.created_at,
    series,
  };
}

export function normalizeExerciseLineageId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) return null;
  return normalized;
}

export function normalizeHistoricalTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function compareSessionsDescending(
  a: ExerciseLastPerformanceSessionRow,
  b: ExerciseLastPerformanceSessionRow,
) {
  return (
    getSessionHistoricalTime(b) - getSessionHistoricalTime(a) ||
    Date.parse(b.created_at) - Date.parse(a.created_at) ||
    b.id.localeCompare(a.id)
  );
}

function compareEntriesAscending(
  a: ExerciseLastPerformanceEntryRow,
  b: ExerciseLastPerformanceEntryRow,
) {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
}

function getSessionHistoricalTime(session: ExerciseLastPerformanceSessionRow) {
  return Date.parse(session.completed_at ?? session.trained_at ?? session.created_at ?? session.trained_date ?? "");
}

function readRepsArray(value: unknown): Array<number | null> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readNumber(item));
}

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function getAuthenticatedExerciseLastPerformanceRepository() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new ExerciseLastPerformanceRepositoryError(
      "session_required",
      "Debes iniciar sesion para revisar el historial del ejercicio.",
    );
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new ExerciseLastPerformanceRepositoryError(
      "session_expired",
      "Tu sesion expiro. Inicia sesion nuevamente.",
      error,
    );
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new ExerciseLastPerformanceRepositoryError(
      "session_required",
      "Debes iniciar sesion para revisar el historial del ejercicio.",
    );
  }

  return { supabase: supabase as SupabaseClient, userId };
}

function mapExerciseLastPerformanceRepositoryError(error: unknown) {
  return new ExerciseLastPerformanceRepositoryError(
    "unexpected",
    readSupabaseErrorMessage(error) || "No pudimos cargar el historial del ejercicio.",
    error,
  );
}

function readSupabaseErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String(error.message);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
