import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type TrainingCycleStatus = "active" | "completed" | "cancelled";
export type TrainingCycleSnapshot = Record<string, unknown>;

export interface TrainingCycle {
  id: string;
  name: string;
  cycleNumber: number;
  cycleType: string | null;
  goal: string | null;
  startedAt: string;
  endedAt: string | null;
  status: TrainingCycleStatus;
  planSnapshot: TrainingCycleSnapshot;
  summarySnapshot: TrainingCycleSnapshot | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateTrainingCycleInput {
  name: string;
  cycleNumber: number;
  cycleType?: string | null;
  goal?: string | null;
  startedAt?: string;
  planSnapshot?: TrainingCycleSnapshot;
}

export interface CompleteTrainingCycleInput {
  endedAt?: string;
  summarySnapshot?: TrainingCycleSnapshot;
}

export interface CancelTrainingCycleInput {
  endedAt?: string;
  summarySnapshot?: TrainingCycleSnapshot;
}

export type TrainingCycleRepositoryErrorCode =
  | "session_required"
  | "session_expired"
  | "active_cycle_exists"
  | "active_cycle_missing"
  | "permission_denied"
  | "unexpected";

export class TrainingCycleRepositoryError extends Error {
  constructor(
    public readonly code: TrainingCycleRepositoryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrainingCycleRepositoryError";
  }
}

export async function getActiveTrainingCycle(): Promise<TrainingCycle | null> {
  const { supabase, userId } = await getAuthenticatedCycleRepository();
  const { data, error } = await supabase
    .from("training_cycles")
    .select(TRAINING_CYCLE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw mapCycleRepositoryError(error);
  return data ? mapTrainingCycleRow(data as unknown as TrainingCycleRow) : null;
}

export async function createTrainingCycle(input: CreateTrainingCycleInput): Promise<TrainingCycle> {
  const { supabase, userId } = await getAuthenticatedCycleRepository();
  const { data, error } = await supabase
    .from("training_cycles")
    .insert({
      user_id: userId,
      name: input.name,
      cycle_number: input.cycleNumber,
      cycle_type: input.cycleType ?? null,
      goal: input.goal ?? null,
      started_at: input.startedAt ?? new Date().toISOString(),
      status: "active",
      plan_snapshot: input.planSnapshot ?? {},
      summary_snapshot: null,
    })
    .select(TRAINING_CYCLE_COLUMNS)
    .single();

  if (error) throw mapCycleRepositoryError(error);
  return mapTrainingCycleRow(data as unknown as TrainingCycleRow);
}

export async function completeTrainingCycle(input: CompleteTrainingCycleInput = {}): Promise<TrainingCycle> {
  return finishActiveTrainingCycle("completed", input.endedAt, input.summarySnapshot ?? {});
}

export async function cancelTrainingCycle(input: CancelTrainingCycleInput = {}): Promise<TrainingCycle> {
  return finishActiveTrainingCycle("cancelled", input.endedAt, input.summarySnapshot ?? {});
}

export async function getTrainingCycleHistory(): Promise<TrainingCycle[]> {
  const { supabase, userId } = await getAuthenticatedCycleRepository();
  const { data, error } = await supabase
    .from("training_cycles")
    .select(TRAINING_CYCLE_COLUMNS)
    .eq("user_id", userId)
    .in("status", ["completed", "cancelled"])
    .is("deleted_at", null)
    .order("ended_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw mapCycleRepositoryError(error);
  return ((data ?? []) as unknown as TrainingCycleRow[]).map(mapTrainingCycleRow);
}

async function finishActiveTrainingCycle(
  status: Exclude<TrainingCycleStatus, "active">,
  endedAt = new Date().toISOString(),
  summarySnapshot: TrainingCycleSnapshot,
) {
  const { supabase, userId } = await getAuthenticatedCycleRepository();
  const { data: activeCycleData, error: activeCycleError } = await supabase
    .from("training_cycles")
    .select(TRAINING_CYCLE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (activeCycleError) throw mapCycleRepositoryError(activeCycleError);

  if (!activeCycleData) {
    throw new TrainingCycleRepositoryError(
      "active_cycle_missing",
      "No existe un ciclo activo para finalizar.",
    );
  }

  const activeCycle = mapTrainingCycleRow(activeCycleData as unknown as TrainingCycleRow);

  const { data, error } = await supabase
    .from("training_cycles")
    .update({
      status,
      ended_at: endedAt,
      summary_snapshot: summarySnapshot,
    })
    .eq("id", activeCycle.id)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .select(TRAINING_CYCLE_COLUMNS)
    .single();

  if (isNoRowsError(error)) {
    throw new TrainingCycleRepositoryError(
      "active_cycle_missing",
      "No existe un ciclo activo para finalizar.",
      error,
    );
  }
  if (error) throw mapCycleRepositoryError(error);
  return mapTrainingCycleRow(data as unknown as TrainingCycleRow);
}

async function getAuthenticatedCycleRepository() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new TrainingCycleRepositoryError(
      "session_required",
      "Debes iniciar sesion para gestionar ciclos.",
    );
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new TrainingCycleRepositoryError(
      "session_expired",
      "Tu sesion expiro. Inicia sesion nuevamente.",
      error,
    );
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new TrainingCycleRepositoryError(
      "session_required",
      "Debes iniciar sesion para gestionar ciclos.",
    );
  }

  return { supabase, userId };
}

function mapCycleRepositoryError(error: unknown) {
  const code = readSupabaseErrorCode(error);
  const message = readSupabaseErrorMessage(error).toLowerCase();

  if (code === "23505") {
    return new TrainingCycleRepositoryError(
      "active_cycle_exists",
      "Ya existe un ciclo activo para este usuario.",
      error,
    );
  }

  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return new TrainingCycleRepositoryError(
      "permission_denied",
      "No tienes permisos para acceder a este ciclo.",
      error,
    );
  }

  return new TrainingCycleRepositoryError(
    "unexpected",
    readSupabaseErrorMessage(error) || "No pudimos completar la accion sobre ciclos.",
    error,
  );
}

function mapTrainingCycleRow(row: TrainingCycleRow): TrainingCycle {
  return {
    id: row.id,
    name: row.name,
    cycleNumber: row.cycle_number,
    cycleType: row.cycle_type,
    goal: row.goal,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: readTrainingCycleStatus(row.status),
    planSnapshot: readSnapshot(row.plan_snapshot),
    summarySnapshot: row.summary_snapshot === null ? null : readSnapshot(row.summary_snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function readTrainingCycleStatus(value: string): TrainingCycleStatus {
  if (value === "completed" || value === "cancelled") return value;
  return "active";
}

function readSnapshot(value: unknown): TrainingCycleSnapshot {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as TrainingCycleSnapshot;
  }

  return {};
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

function isNoRowsError(error: unknown) {
  const code = readSupabaseErrorCode(error);
  const message = readSupabaseErrorMessage(error).toLowerCase();
  return code === "PGRST116" || message.includes("0 rows") || message.includes("no rows");
}

const TRAINING_CYCLE_COLUMNS = [
  "id",
  "name",
  "cycle_number",
  "cycle_type",
  "goal",
  "started_at",
  "ended_at",
  "status",
  "plan_snapshot",
  "summary_snapshot",
  "created_at",
  "updated_at",
  "deleted_at",
].join(",");

interface TrainingCycleRow {
  id: string;
  name: string;
  cycle_number: number;
  cycle_type: string | null;
  goal: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  plan_snapshot: unknown;
  summary_snapshot: unknown | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
