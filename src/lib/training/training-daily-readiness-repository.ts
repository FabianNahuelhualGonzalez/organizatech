import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface TrainingDailyReadinessPayload {
  motivation?: number;
  hydration?: number;
  sleep?: number;
  energy?: number;
  skipped: boolean;
}

export type TrainingDailyReadinessScope =
  | { mode: "legacy" }
  | { mode: "cycle-scoped"; cycleDayId: string };

export interface TrainingDailyReadinessRecord {
  id: string;
  localDate: string;
  payload: TrainingDailyReadinessPayload;
  createdAt: string;
  updatedAt: string;
}

export type TrainingDailyReadinessErrorCode =
  | "session_required"
  | "session_expired"
  | "invalid_payload"
  | "invalid_context"
  | "permission_denied"
  | "unexpected";

export class TrainingDailyReadinessRepositoryError extends Error {
  constructor(
    public readonly code: TrainingDailyReadinessErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TrainingDailyReadinessRepositoryError";
  }
}

interface TrainingDailyReadinessRow {
  id: string;
  local_date: string;
  cycle_day_id?: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

const calendarDateFormatterCache = new Map<string, Intl.DateTimeFormat>();

export function getCalendarDateInTimeZone(date: Date, timeZone: string) {
  if (Number.isNaN(date.getTime())) {
    throw new TrainingDailyReadinessRepositoryError(
      "invalid_payload",
      "Fecha invalida para calcular el dia local.",
    );
  }

  const formatter = getCalendarDateFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new TrainingDailyReadinessRepositoryError(
      "unexpected",
      "No pudimos calcular el dia local.",
    );
  }

  return `${year}-${month}-${day}`;
}

export function getDailyTrainingReadinessLocalDate(reference = new Date()) {
  return getCalendarDateInTimeZone(reference, "America/Santiago");
}

export async function getDailyTrainingReadiness(
  scope: TrainingDailyReadinessScope,
  reference = new Date(),
): Promise<TrainingDailyReadinessRecord | null> {
  const normalizedScope = normalizeDailyReadinessScope(scope);
  const localDate = getDailyTrainingReadinessLocalDate(reference);
  const { supabase } = await getAuthenticatedDailyReadinessRepository();

  let query = supabase
    .from("training_daily_readiness")
    .select("id,local_date,cycle_day_id,payload,created_at,updated_at")
    .eq("local_date", localDate);

  query = normalizedScope.mode === "cycle-scoped"
    ? query.eq("cycle_day_id", normalizedScope.cycleDayId)
    : query.is("cycle_day_id", null);

  const { data, error } = await query.maybeSingle();

  if (error) throw mapDailyReadinessRepositoryError(error);
  if (!data) return null;

  return mapTrainingDailyReadinessRow(data as TrainingDailyReadinessRow);
}

export async function saveDailyTrainingReadiness(
  payload: TrainingDailyReadinessPayload,
  scope: TrainingDailyReadinessScope,
): Promise<TrainingDailyReadinessRecord> {
  const normalizedScope = normalizeDailyReadinessScope(scope);
  const normalizedPayload = normalizeDailyReadinessPayload(payload);
  const { supabase } = await getAuthenticatedDailyReadinessRepository();
  const rpcPayload = normalizedScope.mode === "cycle-scoped"
    ? { ...normalizedPayload, cycle_day_id: normalizedScope.cycleDayId }
    : { ...normalizedPayload, cycle_day_id: null };

  const { data, error } = await supabase.rpc("save_daily_training_readiness", {
    p_payload: rpcPayload,
  });

  if (error) throw mapDailyReadinessRepositoryError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new TrainingDailyReadinessRepositoryError(
      "unexpected",
      "No pudimos confirmar el formulario guardado.",
    );
  }

  return mapTrainingDailyReadinessRow(row as TrainingDailyReadinessRow);
}

export function normalizeDailyReadinessPayload(
  payload: TrainingDailyReadinessPayload,
): TrainingDailyReadinessPayload {
  if (!payload || typeof payload !== "object") {
    throw new TrainingDailyReadinessRepositoryError(
      "invalid_payload",
      "Formulario de motivacion invalido.",
    );
  }

  if (payload.skipped) return { skipped: true };

  return {
    motivation: normalizeReadinessScore(payload.motivation, "motivacion"),
    hydration: normalizeReadinessScore(payload.hydration, "hidratacion"),
    sleep: normalizeReadinessScore(payload.sleep, "sueno"),
    energy: normalizeReadinessScore(payload.energy, "energia"),
    skipped: false,
  };
}

export function shouldShowDailyReadinessForm(record: TrainingDailyReadinessRecord | null) {
  return record === null;
}

export function normalizeDailyReadinessScope(scope: TrainingDailyReadinessScope): TrainingDailyReadinessScope {
  if (!scope || typeof scope !== "object" || !("mode" in scope)) {
    throw new TrainingDailyReadinessRepositoryError(
      "invalid_context",
      "No pudimos identificar el entrenamiento para el formulario.",
    );
  }

  if (scope.mode === "legacy") return { mode: "legacy" };

  if (scope.mode === "cycle-scoped") {
    if (typeof scope.cycleDayId === "string" && scope.cycleDayId.trim().length > 0) {
      return { mode: "cycle-scoped", cycleDayId: scope.cycleDayId.trim() };
    }
    throw new TrainingDailyReadinessRepositoryError(
      "invalid_context",
      "No pudimos identificar el dia del ciclo para el formulario.",
    );
  }

  throw new TrainingDailyReadinessRepositoryError(
    "invalid_context",
    "No pudimos identificar el entrenamiento para el formulario.",
  );
}

function getCalendarDateFormatter(timeZone: string) {
  const cached = calendarDateFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  calendarDateFormatterCache.set(timeZone, formatter);
  return formatter;
}

async function getAuthenticatedDailyReadinessRepository() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    throw new TrainingDailyReadinessRepositoryError(
      "session_required",
      "Inicia sesion para registrar tu formulario diario.",
    );
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new TrainingDailyReadinessRepositoryError(
      "session_expired",
      "Tu sesion expiro. Vuelve a iniciar sesion.",
      error,
    );
  }

  if (!data.user?.id) {
    throw new TrainingDailyReadinessRepositoryError(
      "session_required",
      "Inicia sesion para registrar tu formulario diario.",
    );
  }

  return { supabase };
}

function mapTrainingDailyReadinessRow(row: TrainingDailyReadinessRow): TrainingDailyReadinessRecord {
  return {
    id: row.id,
    localDate: row.local_date,
    payload: normalizeDailyReadinessPayload(row.payload as TrainingDailyReadinessPayload),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeReadinessScore(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 7) {
    throw new TrainingDailyReadinessRepositoryError(
      "invalid_payload",
      `El valor de ${fieldName} debe estar entre 1 y 7.`,
    );
  }
  return value;
}

function mapDailyReadinessRepositoryError(error: unknown) {
  const message = readErrorMessage(error);
  const code = readErrorCode(error);
  if (message.toLowerCase().includes("jwt") || message.toLowerCase().includes("auth")) {
    return new TrainingDailyReadinessRepositoryError("session_expired", "Tu sesion expiro. Vuelve a iniciar sesion.", error);
  }
  if (code === "42501" || message.toLowerCase().includes("permission") || message.toLowerCase().includes("permis")) {
    return new TrainingDailyReadinessRepositoryError("permission_denied", "No tienes permisos para guardar este formulario.", error);
  }
  if (message.toLowerCase().includes("payload") || message.toLowerCase().includes("motivacion")) {
    return new TrainingDailyReadinessRepositoryError("invalid_payload", "Formulario de motivacion invalido.", error);
  }
  if (message.toLowerCase().includes("dia del ciclo") || message.toLowerCase().includes("entrenamiento")) {
    return new TrainingDailyReadinessRepositoryError("invalid_context", "No pudimos identificar el entrenamiento para el formulario.", error);
  }
  return new TrainingDailyReadinessRepositoryError("unexpected", "No pudimos guardar el formulario diario.", error);
}

function readErrorMessage(error: unknown) {
  return typeof error === "object" && error && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
}

function readErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}
