import { getPublicErrorMessage } from "@/lib/errors/public-error";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
export type TrainingWorkoutReadinessPayload =
  | { skipped: true }
  | {
      skipped: false;
      motivation: number;
      hydration: number;
      sleep: number;
      energy: number;
    };

export interface SaveTrainingWorkoutReadinessInput {
  workoutAttemptId: string;
  cycleId: string;
  cycleDayId: string;
  workoutStartedAt: string;
  payload: TrainingWorkoutReadinessPayload;
}

export interface TrainingWorkoutReadinessRecord {
  id: string;
  userId: string;
  workoutAttemptId: string;
  cycleId: string;
  cycleDayId: string;
  workoutStartedAt: string;
  localDate: string;
  payload: TrainingWorkoutReadinessPayload;
  trainingSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTrainingWorkoutReadinessResult extends TrainingWorkoutReadinessRecord {
  contextMismatch: boolean;
}

export interface LinkTrainingWorkoutReadinessSessionInput {
  workoutAttemptId: string;
  trainingSessionId: string;
}

export interface LinkTrainingWorkoutReadinessSessionResult {
  id: string;
  workoutAttemptId: string;
  trainingSessionId: string;
  linked: boolean;
  alreadyLinked: boolean;
}

export type TrainingWorkoutReadinessRepositoryErrorCode =
  | "session_required"
  | "session_expired"
  | "empty_response"
  | "multiple_rows"
  | "invalid_response"
  | "unexpected";

export class TrainingWorkoutReadinessRepositoryError extends Error {
  constructor(
    public readonly code: TrainingWorkoutReadinessRepositoryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrainingWorkoutReadinessRepositoryError";
  }
}

export function translateTrainingWorkoutReadinessError(error: unknown) {
  if (error instanceof TrainingWorkoutReadinessRepositoryError) {
    if (error.code === "session_required") return "Inicia sesion para confirmar tu formulario de entrenamiento.";
    if (error.code === "session_expired") return "Tu sesión expiró. Inicia sesión nuevamente.";
    if (error.code === "empty_response" || error.code === "multiple_rows" || error.code === "invalid_response") {
      return "La respuesta del formulario de entrenamiento no tiene el formato esperado.";
    }
    return "No pudimos confirmar tu formulario de entrenamiento.";
  }
  return getPublicErrorMessage(
    error,
    "No pudimos confirmar tu formulario de entrenamiento. Intentalo nuevamente.",
  );
}

export interface TrainingWorkoutReadinessRpcClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface TrainingWorkoutReadinessRepositoryOptions {
  supabase?: TrainingWorkoutReadinessRpcClient | null;
}

export async function saveTrainingWorkoutReadiness(
  input: SaveTrainingWorkoutReadinessInput,
  expectedUserId: string,
  options: TrainingWorkoutReadinessRepositoryOptions = {},
): Promise<SaveTrainingWorkoutReadinessResult> {
  const supabase = getTrainingWorkoutReadinessClient(options);
  // La primera validacion vincula la operacion al owner capturado; como esa comprobacion
  // contiene un await, la segunda se mantiene inmediatamente antes del RPC.
  await assertExpectedTrainingWorkoutReadinessUser(supabase, expectedUserId);
  await assertExpectedTrainingWorkoutReadinessUser(supabase, expectedUserId);
  const { data, error } = await supabase.rpc("save_training_workout_readiness_v2", {
    p_workout_attempt_id: input.workoutAttemptId,
    p_cycle_id: input.cycleId,
    p_cycle_day_id: input.cycleDayId,
    p_workout_started_at: input.workoutStartedAt,
    p_payload: input.payload,
  });

  if (error) throw mapTrainingWorkoutReadinessError(error);
  return mapSaveTrainingWorkoutReadinessRow(readSingleRpcRow(data));
}

export async function linkTrainingWorkoutReadinessSession(
  input: LinkTrainingWorkoutReadinessSessionInput,
  expectedUserId: string,
  options: TrainingWorkoutReadinessRepositoryOptions = {},
): Promise<LinkTrainingWorkoutReadinessSessionResult> {
  const supabase = getTrainingWorkoutReadinessClient(options);
  // Linking aplica el mismo doble guard para no asociar bajo B un pending creado por A.
  await assertExpectedTrainingWorkoutReadinessUser(supabase, expectedUserId);
  await assertExpectedTrainingWorkoutReadinessUser(supabase, expectedUserId);
  const { data, error } = await supabase.rpc("link_training_workout_readiness_session_v2", {
    p_workout_attempt_id: input.workoutAttemptId,
    p_training_session_id: input.trainingSessionId,
  });

  if (error) throw mapTrainingWorkoutReadinessError(error);
  return mapLinkTrainingWorkoutReadinessSessionRow(readSingleRpcRow(data));
}

function getTrainingWorkoutReadinessClient(options: TrainingWorkoutReadinessRepositoryOptions) {
  const supabase = options.supabase ?? getSupabaseBrowserClient();
  if (!supabase) {
    throw new TrainingWorkoutReadinessRepositoryError(
      "session_required",
      "Inicia sesion para registrar tu formulario de entrenamiento.",
    );
  }
  return supabase;
}

async function assertExpectedTrainingWorkoutReadinessUser(
  supabase: TrainingWorkoutReadinessRpcClient,
  expectedUserId: string,
) {
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== expectedUserId) {
    throw new TrainingWorkoutReadinessRepositoryError(
      "session_expired",
      "Tu sesión expiró. Inicia sesión nuevamente.",
    );
  }
}

function readSingleRpcRow(data: unknown) {
  if (Array.isArray(data)) {
    if (data.length === 0) throw responseShapeError("empty_response");
    if (data.length > 1) throw responseShapeError("multiple_rows");
    return data[0];
  }

  if (data === null || data === undefined) throw responseShapeError("empty_response");
  if (!isPlainObject(data)) throw responseShapeError("invalid_response");
  return data;
}

function mapSaveTrainingWorkoutReadinessRow(row: unknown): SaveTrainingWorkoutReadinessResult {
  if (!isPlainObject(row)) throw invalidRowError();
  const typedRow = row;
  const payload = typedRow.payload;
  if (!isTrainingReadinessPayload(payload)) throw invalidRowError();

  return {
    id: readRequiredString(typedRow.id),
    userId: readRequiredString(typedRow.user_id),
    workoutAttemptId: readRequiredString(typedRow.workout_attempt_id),
    cycleId: readRequiredString(typedRow.cycle_id),
    cycleDayId: readRequiredString(typedRow.cycle_day_id),
    workoutStartedAt: readRequiredString(typedRow.workout_started_at),
    localDate: readRequiredString(typedRow.local_date),
    payload,
    trainingSessionId: readNullableString(typedRow.training_session_id),
    createdAt: readRequiredString(typedRow.created_at),
    updatedAt: readRequiredString(typedRow.updated_at),
    contextMismatch: readRequiredBoolean(typedRow.context_mismatch),
  };
}

function mapLinkTrainingWorkoutReadinessSessionRow(row: unknown): LinkTrainingWorkoutReadinessSessionResult {
  if (!isPlainObject(row)) throw invalidRowError();
  const typedRow = row;
  return {
    id: readRequiredString(typedRow.id),
    workoutAttemptId: readRequiredString(typedRow.workout_attempt_id),
    trainingSessionId: readRequiredString(typedRow.training_session_id),
    linked: readRequiredBoolean(typedRow.linked),
    alreadyLinked: readRequiredBoolean(typedRow.already_linked),
  };
}

function isTrainingReadinessPayload(value: unknown): value is TrainingWorkoutReadinessPayload {
  if (!isPlainObject(value) || typeof value.skipped !== "boolean") return false;
  if (value.skipped) return Object.keys(value).length === 1;
  return [value.motivation, value.hydration, value.sleep, value.energy].every(isRequiredIntegerScore);
}

function isRequiredIntegerScore(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRequiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) throw invalidRowError();
  return value;
}

function readNullableString(value: unknown) {
  if (value === null) return null;
  return readRequiredString(value);
}

function readRequiredBoolean(value: unknown) {
  if (typeof value !== "boolean") throw invalidRowError();
  return value;
}

function invalidRowError() {
  return responseShapeError("invalid_response");
}

function responseShapeError(code: "empty_response" | "multiple_rows" | "invalid_response") {
  return new TrainingWorkoutReadinessRepositoryError(
    code,
    "La respuesta del formulario de entrenamiento no tiene el formato esperado.",
  );
}

function mapTrainingWorkoutReadinessError(error: unknown) {
  return new TrainingWorkoutReadinessRepositoryError(
    "unexpected",
    "No pudimos confirmar tu formulario de entrenamiento.",
    error,
  );
}
