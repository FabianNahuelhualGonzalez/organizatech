import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  CoachEvaluationAssignment,
  EvaluationAnswers,
  EvaluationQuestion,
  EvaluationSnapshot,
  EvaluationStudent,
  EvaluationTemplate,
  StudentEvaluationAssignment,
} from "@/features/evaluations/model/evaluation-types";

type EvaluationRpcName =
  | "list_own_evaluation_templates"
  | "save_own_evaluation_template"
  | "hide_own_evaluation_templates"
  | "delete_own_evaluation_template"
  | "list_own_evaluation_students"
  | "send_own_evaluation_template"
  | "list_own_coach_evaluation_assignments"
  | "extend_own_evaluation_assignment"
  | "remind_own_evaluation_assignment"
  | "list_own_student_evaluations"
  | "get_own_student_evaluation"
  | "save_own_evaluation_draft"
  | "submit_own_evaluation";

interface EvaluationClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
  rpc(name: EvaluationRpcName, args: Readonly<Record<string, unknown>>): Promise<{
    readonly data: unknown;
    readonly error: { readonly code?: string; readonly message?: string } | null;
  }>;
  readonly functions: {
    invoke(name: "send-evaluation-emails", options: { readonly body: Readonly<Record<string, never>> }): Promise<unknown>;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EvaluationRepositoryError extends Error {
  constructor(readonly code: "unavailable" | "forbidden" | "invalid" | "expired" | "conflict" | "rate_limited") {
    super(code);
    this.name = "EvaluationRepositoryError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EvaluationRepositoryError("unavailable");
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new EvaluationRepositoryError("unavailable");
  return value;
}

function uuid(value: unknown): string {
  const parsed = text(value, 36);
  if (!UUID.test(parsed)) throw new EvaluationRepositoryError("unavailable");
  return parsed;
}

function iso(value: unknown): string {
  const parsed = text(value, 64);
  if (!Number.isFinite(Date.parse(parsed))) throw new EvaluationRepositoryError("unavailable");
  return parsed;
}

function nullableIso(value: unknown): string | null {
  return value === null ? null : iso(value);
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new EvaluationRepositoryError("unavailable");
  return value;
}

function questions(value: unknown): readonly EvaluationQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new EvaluationRepositoryError("unavailable");
  return value.map((candidate) => {
    const row = record(candidate);
    const mode = row.mode;
    if (mode !== "text" && mode !== "table") throw new EvaluationRepositoryError("unavailable");
    const base = {
      id: uuid(row.id),
      text: text(row.text, 100),
      required: bool(row.required),
      mode,
    } as EvaluationQuestion;
    if (mode === "text") return base;
    if (!Array.isArray(row.columns) || row.columns.length < 1 || row.columns.length > 12) {
      throw new EvaluationRepositoryError("unavailable");
    }
    const preset = row.preset;
    if (preset !== "meals" && preset !== "medications" && preset !== "custom") {
      throw new EvaluationRepositoryError("unavailable");
    }
    return {
      ...base,
      preset,
      guidance: typeof row.guidance === "string" ? row.guidance : undefined,
      columns: row.columns.map((column) => {
        const parsed = record(column);
        return { id: uuid(parsed.id), label: text(parsed.label, 80) };
      }),
    };
  });
}

function snapshot(value: unknown): EvaluationSnapshot {
  const row = record(value);
  return {
    templateOriginId: uuid(row.templateOriginId),
    name: text(row.name, 120),
    questions: questions(row.questions),
    sensitive: bool(row.sensitive),
  };
}

function answers(value: unknown): EvaluationAnswers {
  const row = record(value);
  if (Object.keys(row).length > 50) throw new EvaluationRepositoryError("unavailable");
  return Object.fromEntries(Object.entries(row).map(([questionId, answer]) => {
    if (!UUID.test(questionId)) throw new EvaluationRepositoryError("unavailable");
    if (typeof answer === "string") {
      if (answer.length > 5000) throw new EvaluationRepositoryError("unavailable");
      return [questionId, answer];
    }
    const tableAnswer = record(answer);
    if (Object.keys(tableAnswer).some((key) => key !== "rows")
      || !Array.isArray(tableAnswer.rows) || tableAnswer.rows.length > 500) {
      throw new EvaluationRepositoryError("unavailable");
    }
    return [questionId, { rows: tableAnswer.rows.map((candidate) => {
      const parsedRow = record(candidate);
      const values = record(parsedRow.values);
      if (Object.keys(parsedRow).some((key) => key !== "id" && key !== "values")
        || Object.keys(values).length > 12
        || Object.values(values).some((item) => typeof item !== "string" || item.length > 1000)) {
        throw new EvaluationRepositoryError("unavailable");
      }
      return { id: uuid(parsedRow.id), values: values as Record<string, string> };
    }) }];
  }));
}

function status(value: unknown): CoachEvaluationAssignment["status"] {
  if (value !== "pending" && value !== "draft" && value !== "expired" && value !== "completed") {
    throw new EvaluationRepositoryError("unavailable");
  }
  return value;
}

function templates(value: unknown): readonly EvaluationTemplate[] {
  if (!Array.isArray(value) || value.length > 100) throw new EvaluationRepositoryError("unavailable");
  return value.map((candidate) => {
    const row = record(candidate);
    return {
      id: uuid(row.id), name: text(row.name, 120), questions: questions(row.questions),
      createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
    };
  });
}

function students(value: unknown): readonly EvaluationStudent[] {
  if (!Array.isArray(value) || value.length > 100) throw new EvaluationRepositoryError("unavailable");
  return value.map((candidate) => {
    const row = record(candidate);
    return { episodeId: uuid(row.episodeId), name: text(row.name, 201), email: text(row.email, 254) };
  });
}

function coachAssignments(value: unknown): readonly CoachEvaluationAssignment[] {
  if (!Array.isArray(value) || value.length > 500) throw new EvaluationRepositoryError("unavailable");
  return value.map((candidate) => {
    const row = record(candidate);
    return {
      id: uuid(row.id), sendBatchId: uuid(row.sendBatchId), studentName: text(row.studentName, 201),
      snapshot: snapshot(row.snapshot), status: status(row.status),
      sentAt: iso(row.sentAt), dueAt: nullableIso(row.dueAt), completedAt: nullableIso(row.completedAt),
      consentConfirmed: bool(row.consentConfirmed), answers: answers(row.answers),
      canMutate: bool(row.canMutate), canRemind: bool(row.canRemind),
    };
  });
}

function studentAssignments(value: unknown): readonly StudentEvaluationAssignment[] {
  if (!Array.isArray(value) || value.length > 500) throw new EvaluationRepositoryError("unavailable");
  return value.map((candidate) => {
    const row = record(candidate);
    return {
      id: uuid(row.id), coachName: text(row.coachName, 201), snapshot: snapshot(row.snapshot),
      status: status(row.status), sentAt: iso(row.sentAt), dueAt: nullableIso(row.dueAt),
      completedAt: nullableIso(row.completedAt), consentConfirmed: bool(row.consentConfirmed),
      answers: answers(row.answers),
    };
  });
}

async function capture(expectedUserId: string): Promise<{
  readonly client: EvaluationClient;
  readonly verify: () => Promise<void>;
}> {
  const client = getSupabaseBrowserClient() as unknown as EvaluationClient | null;
  if (!client) throw new EvaluationRepositoryError("unavailable");
  const sessionResult = await client.auth.getSession();
  const session = sessionResult.data.session;
  if (sessionResult.error || !session?.access_token || session.user.id !== expectedUserId) {
    throw new EvaluationRepositoryError("forbidden");
  }
  const verify = async () => {
    const currentSessionResult = await client.auth.getSession();
    const currentSession = currentSessionResult.data.session;
    if (currentSessionResult.error || !currentSession?.access_token || currentSession.user.id !== expectedUserId) {
      throw new EvaluationRepositoryError("forbidden");
    }
    const result = await client.auth.getUser(currentSession.access_token);
    if (result.error || result.data.user?.id !== expectedUserId) throw new EvaluationRepositoryError("forbidden");
  };
  await verify();
  return { client, verify };
}

function mappedError(error: { readonly code?: string; readonly message?: string } | null) {
  const message = error?.message ?? "";
  if (error?.code === "42501") return new EvaluationRepositoryError("forbidden");
  if (error?.code === "22023") return new EvaluationRepositoryError("invalid");
  if (error?.code === "P0001" && message.includes("expired")) return new EvaluationRepositoryError("expired");
  if (error?.code === "55000" || error?.code === "23505") return new EvaluationRepositoryError("conflict");
  if (error?.code === "P0001" && message.includes("rate_limited")) return new EvaluationRepositoryError("rate_limited");
  return new EvaluationRepositoryError("unavailable");
}

async function rpc(expectedUserId: string, name: EvaluationRpcName, args: Readonly<Record<string, unknown>>) {
  const operation = await capture(expectedUserId);
  const result = await operation.client.rpc(name, args);
  if (result.error) throw mappedError(result.error);
  await operation.verify();
  return result.data;
}

async function requestEmailDelivery(expectedUserId: string) {
  try {
    const operation = await capture(expectedUserId);
    await operation.client.functions.invoke("send-evaluation-emails", { body: {} });
    await operation.verify();
  } catch {
    // La cola SQL es durable. El worker programado reintentará sin duplicar.
  }
}

export async function listOwnEvaluationTemplates(expectedUserId: string) {
  return templates(await rpc(expectedUserId, "list_own_evaluation_templates", {}));
}

export async function saveOwnEvaluationTemplate(expectedUserId: string, input: {
  readonly templateId: string | null;
  readonly name: string;
  readonly questions: readonly EvaluationQuestion[];
  readonly requestId: string;
}) {
  const value = await rpc(expectedUserId, "save_own_evaluation_template", {
    p_template_id: input.templateId,
    p_name: input.name,
    p_questions: input.questions,
    p_request_id: input.requestId,
  });
  return templates([value])[0]!;
}

export async function hideOwnEvaluationTemplates(expectedUserId: string, templateIds: readonly string[]) {
  await rpc(expectedUserId, "hide_own_evaluation_templates", { p_template_ids: [...templateIds] });
}

export async function deleteOwnEvaluationTemplate(expectedUserId: string, templateId: string) {
  await rpc(expectedUserId, "delete_own_evaluation_template", { p_template_id: templateId });
}

export async function listOwnEvaluationStudents(expectedUserId: string) {
  return students(await rpc(expectedUserId, "list_own_evaluation_students", {}));
}

export async function sendOwnEvaluationTemplate(expectedUserId: string, input: {
  readonly templateId: string;
  readonly episodeIds: readonly string[];
  readonly dueDate: string | null;
  readonly sensitive: boolean;
  readonly requestId: string;
}) {
  const result = record(await rpc(expectedUserId, "send_own_evaluation_template", {
    p_template_id: input.templateId,
    p_episode_ids: [...input.episodeIds],
    p_due_date: input.dueDate,
    p_sensitive: input.sensitive,
    p_request_id: input.requestId,
  }));
  void requestEmailDelivery(expectedUserId);
  return { created: Number(result.created ?? 0) };
}

export async function listOwnCoachEvaluationAssignments(expectedUserId: string) {
  return coachAssignments(await rpc(expectedUserId, "list_own_coach_evaluation_assignments", {}));
}

export async function extendOwnEvaluationAssignment(expectedUserId: string, assignmentId: string, dueDate: string, requestId: string) {
  await rpc(expectedUserId, "extend_own_evaluation_assignment", {
    p_assignment_id: assignmentId, p_due_date: dueDate, p_request_id: requestId,
  });
}

export async function remindOwnEvaluationAssignment(expectedUserId: string, assignmentId: string, requestId: string) {
  await rpc(expectedUserId, "remind_own_evaluation_assignment", {
    p_assignment_id: assignmentId, p_request_id: requestId,
  });
  void requestEmailDelivery(expectedUserId);
}

export async function listOwnStudentEvaluations(expectedUserId: string) {
  return studentAssignments(await rpc(expectedUserId, "list_own_student_evaluations", {}));
}

export async function getOwnStudentEvaluation(expectedUserId: string, assignmentId: string) {
  return studentAssignments([await rpc(expectedUserId, "get_own_student_evaluation", {
    p_assignment_id: assignmentId,
  })])[0]!;
}

export async function saveOwnEvaluationDraft(expectedUserId: string, input: {
  readonly assignmentId: string;
  readonly answers: EvaluationAnswers;
  readonly consentConfirmed: boolean;
  readonly requestId: string;
}) {
  await rpc(expectedUserId, "save_own_evaluation_draft", {
    p_assignment_id: input.assignmentId, p_answers: input.answers,
    p_consent_confirmed: input.consentConfirmed, p_request_id: input.requestId,
  });
}

export async function submitOwnEvaluation(expectedUserId: string, input: {
  readonly assignmentId: string;
  readonly answers: EvaluationAnswers;
  readonly consentConfirmed: boolean;
  readonly requestId: string;
}) {
  await rpc(expectedUserId, "submit_own_evaluation", {
    p_assignment_id: input.assignmentId, p_answers: input.answers,
    p_consent_confirmed: input.consentConfirmed, p_request_id: input.requestId,
  });
  void requestEmailDelivery(expectedUserId);
}

export type EvaluationSupabaseClient = SupabaseClient;
