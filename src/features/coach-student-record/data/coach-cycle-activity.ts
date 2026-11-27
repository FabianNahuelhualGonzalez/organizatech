import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getCoachStudentRecordGateway } from "./coach-student-record-gateway";

const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Respuesta inválida");
  return v as Record<string, unknown>;
};
const arr = (v: unknown, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw new Error("Respuesta inválida");
  return v;
};
const date = (v: unknown): string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Fecha inválida");
  return v;
};
const count = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || Number(v) < 0) throw new Error("Conteo inválido");
  return Number(v);
};
const sets = (v: unknown): readonly ActualSet[] => arr(v, 20).map((value) => {
  const row = obj(value);
  if (typeof row.reps !== "number" || !Number.isInteger(row.reps) || row.reps < 1
    || row.reps > 1000 || typeof row.kg !== "number" || row.kg < 0 || row.kg > 99999.99) {
    throw new Error("Serie inválida");
  }
  return { reps: row.reps, kg: row.kg };
});

export interface ActualSet { readonly reps: number; readonly kg: number }
export interface ActualRecord {
  readonly performedOn: string; readonly maxKg: number; readonly sets: readonly ActualSet[];
}
export interface ExerciseHistory {
  readonly lineageId: string; readonly name: string;
  readonly first: ActualRecord; readonly last: ActualRecord;
}
export interface CycleActivity {
  readonly cycleId: string; readonly sessionCount: number;
  readonly lastSessionOn: string | null; readonly records: readonly ExerciseHistory[];
}
export interface ActualSession {
  readonly id: string; readonly performedOn: string; readonly dayName: string;
  readonly partial: boolean;
  readonly exercises: readonly { readonly lineageId: string; readonly name: string;
    readonly sets: readonly ActualSet[] }[];
}
function parseRecord(v: unknown): ActualRecord {
  const row = obj(v);
  if (typeof row.maxKg !== "number" || row.maxKg < 0 || row.maxKg > 99999.99) {
    throw new Error("Carga inválida");
  }
  return { performedOn: date(row.performedOn), maxKg: row.maxKg, sets: sets(row.sets) };
}
function parseActivity(v: unknown, cycleId: string): CycleActivity {
  const row = obj(v);
  if (row.cycleId !== cycleId) throw new Error("Ciclo inválido");
  return { cycleId, sessionCount: count(row.sessionCount),
    lastSessionOn: row.lastSessionOn === null ? null : date(row.lastSessionOn),
    records: arr(row.records, 500).map((v) => {
      const r = obj(v);
      if (!uuid(r.lineageId) || typeof r.name !== "string" || r.name.length > 120) throw new Error("Ejercicio inválido");
      return { lineageId: r.lineageId, name: r.name,
        first: parseRecord(r.first), last: parseRecord(r.last) };
    }) };
}
function parseSessions(v: unknown, limit: number): readonly ActualSession[] {
  return arr(v, limit).map((value) => {
    const row = obj(value);
    if (!uuid(row.id) || typeof row.dayName !== "string" || row.dayName.length > 120
      || typeof row.partial !== "boolean") throw new Error("Sesión inválida");
    return { id: row.id, performedOn: date(row.performedOn), dayName: row.dayName,
      partial: row.partial, exercises: arr(row.exercises, 200).map((value) => {
        const ex = obj(value);
        if (!uuid(ex.lineageId) || typeof ex.name !== "string" || ex.name.length > 120) {
          throw new Error("Ejercicio inválido");
        }
        return { lineageId: ex.lineageId, name: ex.name, sets: sets(ex.sets) };
      }) };
  });
}
async function call(coachId: string, name: string, args: Record<string, unknown>) {
  const client = getSupabaseBrowserClient();
  if (!client || !uuid(coachId) || !uuid(args.p_episode_id) || !uuid(args.p_cycle_id)) {
    throw new Error("Acceso inválido");
  }
  async function verify() {
    const session = await client!.auth.getSession();
    if (session.error || !session.data.session?.access_token
      || session.data.session.user.id !== coachId) throw new Error("Acceso denegado");
    const principal = await client!.auth.getUser(session.data.session.access_token);
    if (principal.error || principal.data.user?.id !== coachId) throw new Error("Acceso denegado");
  }
  await verify();
  const result = await client.rpc(name, args);
  if (result.error) throw new Error("Historial no disponible");
  await verify();
  await getCoachStudentRecordGateway(coachId, String(args.p_episode_id), () => true).getSubject();
  return result.data;
}
export async function getCoachCycleActivity(coachId: string, episodeId: string, cycleId: string) {
  return parseActivity(await call(coachId, "get_own_coach_student_cycle_activity",
    { p_episode_id: episodeId, p_cycle_id: cycleId }), cycleId);
}
export async function listCoachCycleSessions(coachId: string, episodeId: string,
  cycleId: string, limit = 6, offset = 0) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20
    || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("Página inválida");
  return parseSessions(await call(coachId, "list_own_coach_student_cycle_sessions",
    { p_episode_id: episodeId, p_cycle_id: cycleId, p_limit: limit, p_offset: offset }), limit);
}
