import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface GetLatestExerciseObservationByLineageInput {
  exerciseLineageId?: string | null;
  currentSessionId?: string | null;
  beforeTimestamp?: string | Date | null;
}

export interface LatestExerciseObservation {
  observation: string;
  sessionId: string;
  trainedDate: string;
  completedAt: string | null;
}

export interface ExerciseLastObservationCandidateEntryRow {
  id: string;
  user_id: string;
  session_id: string;
  exercise_lineage_id: string | null;
  observation: string | null;
  created_at: string;
  training_sessions:
    | ExerciseLastObservationSessionRow
    | ExerciseLastObservationSessionRow[]
    | null;
}

export interface ExerciseLastObservationSessionRow {
  id: string;
  user_id: string;
  status: string | null;
  trained_date: string | null;
  trained_at: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export type ExerciseLastObservationRepositoryErrorCode =
  | "session_required"
  | "session_expired"
  | "unexpected";

export class ExerciseLastObservationRepositoryError extends Error {
  constructor(
    public readonly code: ExerciseLastObservationRepositoryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ExerciseLastObservationRepositoryError";
  }
}

export async function getLatestExerciseObservationByLineage(
  input: GetLatestExerciseObservationByLineageInput,
): Promise<LatestExerciseObservation | null> {
  const exerciseLineageId = normalizeExerciseLineageId(input.exerciseLineageId);
  if (!exerciseLineageId) return null;

  const beforeTimestamp = normalizeHistoricalTimestamp(input.beforeTimestamp);
  const { supabase, userId } = await getAuthenticatedExerciseLastObservationRepository();

  const { data: candidates, error } = await supabase
    .from("exercise_entries")
    .select("id,user_id,session_id,exercise_lineage_id,observation,created_at,training_sessions!inner(id,user_id,status,trained_date,trained_at,completed_at,deleted_at,created_at)")
    .eq("user_id", userId)
    .eq("exercise_lineage_id", exerciseLineageId)
    .eq("training_sessions.user_id", userId)
    .eq("training_sessions.status", "completed")
    .is("training_sessions.deleted_at", null);

  if (error) throw mapExerciseLastObservationRepositoryError(error);

  return selectLatestNonEmptyObservation(
    (candidates ?? []) as unknown as ExerciseLastObservationCandidateEntryRow[],
    {
      userId,
      exerciseLineageId,
      currentSessionId: input.currentSessionId ?? null,
      beforeTimestamp,
    },
  );
}

export function selectLatestNonEmptyObservation(
  rows: ExerciseLastObservationCandidateEntryRow[],
  input: {
    userId: string;
    exerciseLineageId: string;
    currentSessionId?: string | null;
    beforeTimestamp?: string | null;
  },
): LatestExerciseObservation | null {
  const beforeTime = input.beforeTimestamp ? Date.parse(input.beforeTimestamp) : null;

  const candidates: Array<{
    row: ExerciseLastObservationCandidateEntryRow;
    session: ExerciseLastObservationSessionRow;
    observation: string;
  }> = [];

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

    const observation = normalizeObservationText(row.observation);
    if (!observation) continue;

    candidates.push({ row, session, observation });
  }

  candidates.sort(
    (a, b) => compareSessionsDescending(a.session, b.session) || b.row.id.localeCompare(a.row.id),
  );

  const winner = candidates[0];
  if (!winner) return null;

  return {
    observation: winner.observation,
    sessionId: winner.session.id,
    trainedDate: winner.session.trained_date ?? winner.session.trained_at ?? winner.session.created_at,
    completedAt: winner.session.completed_at,
  };
}

export function normalizeObservationText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  a: ExerciseLastObservationSessionRow,
  b: ExerciseLastObservationSessionRow,
) {
  return (
    getSessionHistoricalTime(b) - getSessionHistoricalTime(a) ||
    Date.parse(b.created_at) - Date.parse(a.created_at) ||
    b.id.localeCompare(a.id)
  );
}

function getSessionHistoricalTime(session: ExerciseLastObservationSessionRow) {
  return Date.parse(
    session.completed_at ?? session.trained_at ?? session.created_at ?? session.trained_date ?? "",
  );
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function getAuthenticatedExerciseLastObservationRepository() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new ExerciseLastObservationRepositoryError(
      "session_required",
      "Debes iniciar sesion para revisar la observacion anterior del ejercicio.",
    );
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new ExerciseLastObservationRepositoryError(
      "session_expired",
      "Tu sesion expiro. Inicia sesion nuevamente.",
      error,
    );
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new ExerciseLastObservationRepositoryError(
      "session_required",
      "Debes iniciar sesion para revisar la observacion anterior del ejercicio.",
    );
  }

  return { supabase: supabase as SupabaseClient, userId };
}

function mapExerciseLastObservationRepositoryError(error: unknown) {
  return new ExerciseLastObservationRepositoryError(
    "unexpected",
    readSupabaseErrorMessage(error) || "No pudimos cargar la observacion anterior del ejercicio.",
    error,
  );
}

function readSupabaseErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String(error.message);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
