import type { Session, User } from "@supabase/supabase-js";

import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type EvaluationNotificationPortalScope = "usuario" | "coach";

interface Client {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
  rpc(name: "list_own_evaluation_notifications" | "mark_own_evaluation_notifications_read",
    args: Readonly<Record<string, unknown>>): Promise<{ readonly data: unknown; readonly error: unknown }>;
}

interface Row {
  readonly id: string;
  readonly assignment_id: string | null;
  readonly event_kind: string;
  readonly title: string;
  readonly body: string;
  readonly read_at: string | null;
  readonly created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function capture(expectedUserId: string) {
  const client = getSupabaseBrowserClient() as unknown as Client | null;
  if (!client) throw new Error("evaluation-notifications-unavailable");
  const result = await client.auth.getSession();
  const session = result.data.session;
  if (result.error || !session?.access_token || session.user.id !== expectedUserId) throw new Error("evaluation-notifications-forbidden");
  const verify = async () => {
    const currentSessionResult = await client.auth.getSession();
    const currentSession = currentSessionResult.data.session;
    if (currentSessionResult.error || !currentSession?.access_token || currentSession.user.id !== expectedUserId) {
      throw new Error("evaluation-notifications-forbidden");
    }
    const checked = await client.auth.getUser(currentSession.access_token);
    if (checked.error || checked.data.user?.id !== expectedUserId) throw new Error("evaluation-notifications-forbidden");
  };
  await verify();
  return { client, verify };
}

function rows(value: unknown): readonly Row[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("evaluation-notifications-invalid");
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("evaluation-notifications-invalid");
    const row = candidate as Record<string, unknown>;
    if (typeof row.id !== "string" || !UUID.test(row.id)
      || (row.assignment_id !== null && (typeof row.assignment_id !== "string" || !UUID.test(row.assignment_id)))
      || typeof row.event_kind !== "string" || typeof row.title !== "string" || typeof row.body !== "string"
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at as string))
      || (row.read_at !== null && (typeof row.read_at !== "string" || !Number.isFinite(Date.parse(row.read_at as string))))) {
      throw new Error("evaluation-notifications-invalid");
    }
    return row as unknown as Row;
  });
}

export async function listOwnEvaluationNotifications(expectedUserId: string, portalScope: EvaluationNotificationPortalScope) {
  const operation = await capture(expectedUserId);
  const result = await operation.client.rpc("list_own_evaluation_notifications", { p_portal_scope: portalScope, p_limit: 50 });
  if (result.error) throw new Error("evaluation-notifications-load-failed");
  await operation.verify();
  const parsed = rows(result.data);
  return {
    notifications: parsed.map((row): AppNotification => ({
      id: `evaluation:${row.id}`,
      title: row.title,
      summary: row.body,
      category: "Coach",
      tone: row.event_kind === "evaluation_due_reminder" ? "warning" : "success",
      priority: "high",
      dedupeKey: `evaluation:${row.id}`,
      target: "evaluaciones",
      section: "evaluations",
      referenceId: row.assignment_id ?? undefined,
      kind: "evaluation",
      createdAt: row.created_at,
    })),
    seenRecords: parsed.flatMap((row): SeenNotificationRecord[] => row.read_at
      ? [{ id: `evaluation:${row.id}`, seenAt: new Date(row.read_at).getTime() }]
      : []),
  };
}

export async function markOwnEvaluationNotificationRead(expectedUserId: string, portalScope: EvaluationNotificationPortalScope, notificationId: string) {
  if (!notificationId.startsWith("evaluation:")) return;
  const id = notificationId.slice("evaluation:".length);
  if (!UUID.test(id)) throw new Error("evaluation-notifications-invalid-id");
  const operation = await capture(expectedUserId);
  const result = await operation.client.rpc("mark_own_evaluation_notifications_read", {
    p_portal_scope: portalScope, p_notification_ids: [id],
  });
  if (result.error || result.data !== 1) throw new Error("evaluation-notifications-mark-failed");
  await operation.verify();
}
