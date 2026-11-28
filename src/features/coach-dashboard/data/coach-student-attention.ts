import { captureCoachInvitationsOperation } from "@/features/coach-clients/data/coach-invitations-operation";
import { withCoachInvitationsDeadline } from "@/features/coach-clients/data/coach-invitations-deadline";
import { createPinnedCoachRpcPort, snapshotCoachPublicRpcRuntime,
  type CoachPublicRpcRuntimeInput } from "@/features/coach-clients/data/coach-public-rpc-runtime";

export interface CoachStudentAttentionRow {
  readonly episodeId: string;
  readonly studentName: string;
  readonly reasons: readonly string[];
  readonly dueOn: string | null;
  readonly lastTrainingOn: string | null;
  readonly routineUpdatedAt: string | null;
  readonly isTraining: boolean;
}
export interface CoachStudentAttentionPage {
  readonly serverToday: string;
  readonly total: number;
  readonly rows: readonly CoachStudentAttentionRow[];
}
export interface CoachStudentActivity {
  readonly lastTrainingOn: string | null;
  readonly sessionsInCycle: number;
  readonly isTraining: boolean;
}

const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value);
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const natural = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const validReasons = new Set(["Pago vencido", "Pago vence hoy", "Pago vence pronto", "Sin rutina vigente",
  "Rutina sin actualizar por más de un mes", "Aún no registra entrenamientos", "Sin entrenar desde hace 3 días o más"]);

export function parseCoachStudentAttentionPage(value: unknown): CoachStudentAttentionPage {
  if (!object(value) || !date(value.serverToday) || !natural(value.total) || !Array.isArray(value.rows)
    || value.rows.length > 40 || value.rows.length > (value.total as number)) throw new Error("attention_invalid_response");
  for (const row of value.rows) {
    if (!object(row) || !uuid(row.episodeId) || typeof row.studentName !== "string"
      || !row.studentName.trim() || row.studentName.length > 201 || !Array.isArray(row.reasons)
      || !row.reasons.length || row.reasons.some((reason: unknown) => !validReasons.has(reason as string))
      || (row.dueOn !== null && !date(row.dueOn))
      || (row.lastTrainingOn !== null && !date(row.lastTrainingOn))
      || (row.routineUpdatedAt !== null && !timestamp(row.routineUpdatedAt))
      || typeof row.isTraining !== "boolean") throw new Error("attention_invalid_response");
  }
  return value as unknown as CoachStudentAttentionPage;
}

export function parseCoachStudentActivity(value: unknown): CoachStudentActivity {
  if (!object(value) || (value.lastTrainingOn !== null && !date(value.lastTrainingOn))
    || !natural(value.sessionsInCycle) || typeof value.isTraining !== "boolean") throw new Error("activity_invalid_response");
  return value as unknown as CoachStudentActivity;
}

export function createCoachStudentAttentionGateway(input: CoachPublicRpcRuntimeInput) {
  const configuration = snapshotCoachPublicRpcRuntime(input);
  async function call(name: "read_own_coach_student_attention" | "read_own_coach_student_activity",
    args: Readonly<Record<string, number | string>>, signal?: AbortSignal) {
    return withCoachInvitationsDeadline(async (deadlineSignal, assertActive) => {
      const captured = await captureCoachInvitationsOperation({
        principal: input.principal, identity: configuration.identity, isCurrent: input.isCurrent,
        signal: deadlineSignal, createPinnedClient: (accessToken) =>
          createPinnedCoachRpcPort(configuration, accessToken, input.fetch),
      });
      assertActive();
      const result = await captured.client.rpc(name, args, { get: false, head: false }).abortSignal(deadlineSignal);
      assertActive();
      if (!captured.isCurrent(configuration.identity) || result.error) throw new Error("attention_unavailable");
      return result.data;
    }, 10_000, signal);
  }
  return {
    async list(offset = 0, signal?: AbortSignal) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw new Error("attention_invalid_offset");
      return parseCoachStudentAttentionPage(await call("read_own_coach_student_attention",
        { p_limit: 40, p_offset: offset }, signal));
    },
    async activity(episodeId: string, signal?: AbortSignal) {
      if (!uuid(episodeId)) throw new Error("activity_invalid_id");
      return parseCoachStudentActivity(await call("read_own_coach_student_activity", { p_episode_id: episodeId }, signal));
    },
  };
}
