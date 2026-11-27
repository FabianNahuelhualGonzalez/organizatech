import type { Session, User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  isUuid, parseAcceptedOperation, parseCycleListPage, parseCycleSnapshot,
  parseGoal, parseTrainingCycleRpcPlan, parseVersionSnapshot,
} from "./training-cycle-rpc-parsers";
import type { TrainingCycleListCursor, TrainingCycleRpcPlan } from "./training-cycle-rpc-types";

type CoachTrainingRpc = "list_own_coach_student_training_cycles"
  | "get_own_coach_student_training_cycle"
  | "get_own_coach_student_training_cycle_version"
  | "edit_own_coach_student_active_training_cycle"
  | "create_own_coach_student_training_cycle"
  | "close_own_coach_student_last_routine"
  | "close_own_coach_student_cycle_for_replacement";

interface CoachTrainingClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(token?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
  rpc(name: CoachTrainingRpc, args: Readonly<Record<string, unknown>>): Promise<{
    readonly data: unknown;
    readonly error: { readonly code?: string } | null;
  }>;
}

export class CoachStudentTrainingReadError extends Error {
  constructor(readonly code: "invalid" | "forbidden" | "conflict" | "unavailable") {
    super(code);
    this.name = "CoachStudentTrainingReadError";
  }
}

async function call(
  expectedCoachId: string, name: CoachTrainingRpc, args: Readonly<Record<string, unknown>>,
  client = getSupabaseBrowserClient() as CoachTrainingClient | null,
): Promise<unknown> {
  if (!client || !isUuid(expectedCoachId)) throw new CoachStudentTrainingReadError("forbidden");
  async function verify() {
    const { data, error } = await client!.auth.getSession();
    const session = data.session;
    if (error || !session?.access_token || session.user.id !== expectedCoachId) {
      throw new CoachStudentTrainingReadError("forbidden");
    }
    const principal = await client!.auth.getUser(session.access_token);
    if (principal.error || principal.data.user?.id !== expectedCoachId) {
      throw new CoachStudentTrainingReadError("forbidden");
    }
  }
  await verify();
  const result = await client.rpc(name, args);
  if (result.error) {
    throw new CoachStudentTrainingReadError(
      result.error.code === "42501" ? "forbidden"
        : result.error.code === "22023" ? "invalid"
          : result.error.code === "40001" || result.error.code === "55000"
            ? "conflict" : "unavailable",
    );
  }
  await verify();
  return result.data;
}

function episode(value: string) {
  if (!isUuid(value)) throw new CoachStudentTrainingReadError("invalid");
  return value;
}

export async function listOwnCoachStudentTrainingCycles(
  expectedCoachId: string, episodeId: string, limit = 30,
  cursor: TrainingCycleListCursor | null = null,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50
    || (cursor !== null && (!isUuid(cursor.beforeId)
      || !Number.isFinite(Date.parse(cursor.beforeCreatedAt))))) {
    throw new CoachStudentTrainingReadError("invalid");
  }
  return parseCycleListPage(await call(expectedCoachId,
    "list_own_coach_student_training_cycles", {
      p_episode_id: episode(episodeId), p_limit: limit,
      p_before_created_at: cursor?.beforeCreatedAt ?? null,
      p_before_id: cursor?.beforeId ?? null,
    }));
}

export async function getOwnCoachStudentTrainingCycle(
  expectedCoachId: string, episodeId: string, cycleId: string,
) {
  if (!isUuid(cycleId)) throw new CoachStudentTrainingReadError("invalid");
  const parsed = parseCycleSnapshot(await call(expectedCoachId,
    "get_own_coach_student_training_cycle", {
      p_episode_id: episode(episodeId), p_cycle_id: cycleId,
    }));
  if (parsed.cycleId !== cycleId || parsed.portalScope !== "usuario") {
    throw new CoachStudentTrainingReadError("unavailable");
  }
  return parsed;
}

export async function getOwnCoachStudentTrainingCycleVersion(
  expectedCoachId: string, episodeId: string, cycleId: string, version: number,
) {
  if (!isUuid(cycleId) || !Number.isInteger(version) || version < 1 || version > 256) {
    throw new CoachStudentTrainingReadError("invalid");
  }
  const parsed = parseVersionSnapshot(await call(expectedCoachId,
    "get_own_coach_student_training_cycle_version", {
      p_episode_id: episode(episodeId), p_cycle_id: cycleId, p_version: version,
    }));
  if (parsed.cycleId !== cycleId || parsed.version !== version) {
    throw new CoachStudentTrainingReadError("unavailable");
  }
  return parsed;
}

export async function editOwnCoachStudentActiveTrainingCycle(input: {
  readonly expectedCoachId: string;
  readonly episodeId: string;
  readonly requestId: string;
  readonly cycleId: string;
  readonly expectedVersion: number;
  readonly action: "create_routine" | "modify_routine" | "remove_routine";
  readonly goal: string;
  readonly plan: TrainingCycleRpcPlan;
}) {
  if (!isUuid(input.requestId) || !isUuid(input.cycleId)
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1 || input.expectedVersion > 255
    || !(["create_routine", "modify_routine", "remove_routine"] as const).includes(input.action)) {
    throw new CoachStudentTrainingReadError("invalid");
  }
  const goal = parseGoal(input.goal);
  const plan = parseTrainingCycleRpcPlan(input.plan);
  const result = parseAcceptedOperation(await call(input.expectedCoachId,
    "edit_own_coach_student_active_training_cycle", {
      p_episode_id: episode(input.episodeId), p_request_id: input.requestId,
      p_cycle_id: input.cycleId, p_expected_version: input.expectedVersion,
      p_action: input.action, p_goal: goal, p_plan: plan,
    }));
  if (result.operationKind !== "cycle_edit" || result.aggregateId !== input.cycleId
    || result.requestId !== input.requestId || result.resultVersion !== input.expectedVersion + 1) {
    throw new CoachStudentTrainingReadError("unavailable");
  }
  return result;
}

export async function createOwnCoachStudentTrainingCycle(input: {
  readonly expectedCoachId: string;
  readonly episodeId: string;
  readonly requestId: string;
  readonly goal: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly plan: TrainingCycleRpcPlan;
}) {
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!isUuid(input.requestId) || !validDate(input.startDate) || !validDate(input.endDate)) {
    throw new CoachStudentTrainingReadError("invalid");
  }
  const result = parseAcceptedOperation(await call(input.expectedCoachId,
    "create_own_coach_student_training_cycle", {
      p_episode_id: episode(input.episodeId), p_request_id: input.requestId,
      p_goal: parseGoal(input.goal), p_start_date: input.startDate,
      p_end_date: input.endDate, p_plan: parseTrainingCycleRpcPlan(input.plan),
    }));
  if (result.operationKind !== "cycle_activate" || result.requestId !== input.requestId
    || result.resultVersion !== 1) throw new CoachStudentTrainingReadError("unavailable");
  return result;
}

export async function closeOwnCoachStudentLastRoutine(input: {
  readonly expectedCoachId: string;
  readonly episodeId: string;
  readonly requestId: string;
  readonly cycleId: string;
  readonly expectedVersion: number;
}) {
  if (!isUuid(input.requestId) || !isUuid(input.cycleId)
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1 || input.expectedVersion > 256) {
    throw new CoachStudentTrainingReadError("invalid");
  }
  const result = parseAcceptedOperation(await call(input.expectedCoachId,
    "close_own_coach_student_last_routine", {
      p_episode_id: episode(input.episodeId), p_request_id: input.requestId,
      p_cycle_id: input.cycleId, p_expected_version: input.expectedVersion,
    }));
  if (result.operationKind !== "cycle_close" || result.aggregateId !== input.cycleId
    || result.requestId !== input.requestId || result.resultVersion !== null) {
    throw new CoachStudentTrainingReadError("unavailable");
  }
  return result;
}

export async function closeOwnCoachStudentCycleForReplacement(input: {
  readonly expectedCoachId: string;
  readonly episodeId: string;
  readonly requestId: string;
  readonly cycleId: string;
  readonly expectedVersion: number;
}) {
  if (!isUuid(input.requestId) || !isUuid(input.cycleId)
    || !Number.isInteger(input.expectedVersion)
    || input.expectedVersion < 1 || input.expectedVersion > 256) {
    throw new CoachStudentTrainingReadError("invalid");
  }
  const result = parseAcceptedOperation(await call(input.expectedCoachId,
    "close_own_coach_student_cycle_for_replacement", {
      p_episode_id: episode(input.episodeId), p_request_id: input.requestId,
      p_cycle_id: input.cycleId, p_expected_version: input.expectedVersion,
    }));
  if (result.operationKind !== "cycle_close" || result.aggregateId !== input.cycleId
    || result.requestId !== input.requestId || result.resultVersion !== null) {
    throw new CoachStudentTrainingReadError("unavailable");
  }
  return result;
}
