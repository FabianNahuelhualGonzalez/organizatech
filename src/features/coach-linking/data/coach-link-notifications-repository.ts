import { createClient, type Session, type User } from "@supabase/supabase-js";

import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CoachLinkNotificationPortalScope = "usuario" | "coach";

interface RpcClient {
  rpc(name: "list_own_coach_link_notifications" | "mark_own_coach_link_notifications_read",
    args: Readonly<Record<string, unknown>>): Promise<{ readonly data: unknown; readonly error: unknown }>;
}

interface PrincipalClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: unknown }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: unknown }>;
  };
}

interface Row {
  readonly id: string;
  readonly episode_id: string;
  readonly title: string;
  readonly body: string;
  readonly read_at: string | null;
  readonly created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function capture(expectedUserId: string) {
  const principal = getSupabaseBrowserClient() as unknown as PrincipalClient | null;
  if (!principal) throw new Error("coach-link-notifications-unavailable");
  const sessionResult = await principal.auth.getSession();
  const session = sessionResult.data.session;
  if (sessionResult.error || !session?.access_token || session.user.id !== expectedUserId) {
    throw new Error("coach-link-notifications-session-mismatch");
  }
  const token = session.access_token;
  const verify = async () => {
    const result = await principal.auth.getUser(token);
    if (result.error || result.data.user?.id !== expectedUserId) {
      throw new Error("coach-link-notifications-session-mismatch");
    }
  };
  await verify();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publicKey) throw new Error("coach-link-notifications-unavailable");
  const client = createClient(url, publicKey, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as RpcClient;
  return { client, verify };
}

function rows(value: unknown): readonly Row[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("coach-link-notifications-invalid-response");
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("coach-link-notifications-invalid-response");
    }
    const row = candidate as Record<string, unknown>;
    if (Reflect.ownKeys(row).length !== 6 || typeof row.id !== "string" || !UUID.test(row.id)
      || typeof row.episode_id !== "string" || !UUID.test(row.episode_id)
      || typeof row.title !== "string" || row.title.length < 1 || row.title.length > 120
      || typeof row.body !== "string" || row.body.length < 1 || row.body.length > 1100
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
      || (row.read_at !== null && (typeof row.read_at !== "string" || !Number.isFinite(Date.parse(row.read_at))))) {
      throw new Error("coach-link-notifications-invalid-response");
    }
    return row as unknown as Row;
  });
}

export async function listOwnCoachLinkNotifications(
  expectedUserId: string,
  portalScope: CoachLinkNotificationPortalScope,
): Promise<{ notifications: AppNotification[]; seenRecords: SeenNotificationRecord[] }> {
  const operation = await capture(expectedUserId);
  const result = await operation.client.rpc("list_own_coach_link_notifications", {
    p_portal_scope: portalScope,
    p_limit: 50,
  });
  if (result.error) throw new Error("coach-link-notifications-load-failed");
  await operation.verify();
  const parsed = rows(result.data);
  return {
    notifications: parsed.map((row): AppNotification => ({
      id: `coach-link:${row.id}`,
      title: row.title,
      summary: row.body,
      category: "Coach",
      tone: "success",
      priority: "high",
      dedupeKey: `coach-link:${row.id}`,
      target: portalScope === "usuario" ? "perfil" : "dashboard",
      section: portalScope === "usuario" ? "coach-linking" : undefined,
      referenceId: portalScope === "coach" ? row.episode_id : undefined,
      kind: "coach",
      createdAt: row.created_at,
    })),
    seenRecords: parsed.flatMap((row) => row.read_at
      ? [{ id: `coach-link:${row.id}`, seenAt: new Date(row.read_at).getTime() }]
      : []),
  };
}

export async function markOwnCoachLinkNotificationRead(
  expectedUserId: string,
  portalScope: CoachLinkNotificationPortalScope,
  notificationId: string,
) {
  if (!notificationId.startsWith("coach-link:")) return;
  const id = notificationId.slice("coach-link:".length);
  if (!UUID.test(id)) throw new Error("coach-link-notifications-invalid-id");
  const operation = await capture(expectedUserId);
  const result = await operation.client.rpc("mark_own_coach_link_notifications_read", {
    p_portal_scope: portalScope,
    p_notification_ids: [id],
  });
  if (result.error || result.data !== 1) throw new Error("coach-link-notifications-mark-read-failed");
  await operation.verify();
}
