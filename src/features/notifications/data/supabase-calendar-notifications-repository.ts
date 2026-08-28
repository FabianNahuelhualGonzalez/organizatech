import { createClient, type Session, type User } from "@supabase/supabase-js";

import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type RepositoryError = { readonly message?: string } | null;

interface Row {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly occurrence_on: string;
  readonly reminder_time: string;
  readonly read_at: string | null;
  readonly created_at: string;
}

export type CalendarNotificationPortalScope = "usuario" | "coach";

export interface CalendarNotificationsDataClient {
  rpc(
    name: "list_own_calendar_notifications" | "mark_own_calendar_notifications_read",
    args: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: RepositoryError }>;
}

export interface CalendarNotificationsPrincipalClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: RepositoryError }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: RepositoryError }>;
  };
}

export interface CalendarNotificationsPinnedOperation {
  readonly dataClient: CalendarNotificationsDataClient;
  readonly verifyExpectedUser: () => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function getPrincipalClient(): CalendarNotificationsPrincipalClient | null {
  return getSupabaseBrowserClient() as unknown as CalendarNotificationsPrincipalClient | null;
}

function createPinnedClient(accessToken: string): CalendarNotificationsDataClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("calendar-notifications-client-unavailable");
  return createClient(url, anonKey, {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as CalendarNotificationsDataClient;
}

async function assertTokenOwner(
  principal: CalendarNotificationsPrincipalClient,
  accessToken: string,
  expectedUserId: string,
) {
  const result = await principal.auth.getUser(accessToken);
  if (result.error || result.data.user?.id !== expectedUserId) {
    throw new Error("calendar-notifications-session-mismatch");
  }
}

export async function captureCalendarNotificationsOperation(input: {
  readonly principal: CalendarNotificationsPrincipalClient;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly createPinnedClient?: (accessToken: string) => CalendarNotificationsDataClient;
}): Promise<CalendarNotificationsPinnedOperation> {
  if (!input.isCurrent()) throw new Error("calendar-notifications-operation-stale");
  const result = await input.principal.auth.getSession();
  const session = result.data.session;
  if (result.error || !session?.access_token || session.user.id !== input.expectedUserId || !input.isCurrent()) {
    throw new Error("calendar-notifications-session-mismatch");
  }
  const accessToken = session.access_token;
  await assertTokenOwner(input.principal, accessToken, input.expectedUserId);
  if (!input.isCurrent()) throw new Error("calendar-notifications-operation-stale");
  return {
    dataClient: (input.createPinnedClient ?? createPinnedClient)(accessToken),
    verifyExpectedUser: () => assertTokenOwner(input.principal, accessToken, input.expectedUserId),
  };
}

function parseRows(value: unknown): readonly Row[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("calendar-notifications-invalid-result");
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("calendar-notifications-invalid-row");
    }
    const row = candidate as Record<string, unknown>;
    if (
      typeof row.id !== "string" || !UUID.test(row.id)
      || typeof row.title !== "string" || row.title.length < 1 || row.title.length > 120
      || typeof row.body !== "string" || row.body.length < 1 || row.body.length > 1100
      || typeof row.occurrence_on !== "string" || !DATE.test(row.occurrence_on)
      || typeof row.reminder_time !== "string" || !TIME.test(row.reminder_time)
      || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))
      || (row.read_at !== null && (typeof row.read_at !== "string" || !Number.isFinite(Date.parse(row.read_at))))
    ) throw new Error("calendar-notifications-invalid-row");
    return row as unknown as Row;
  });
}

export async function listOwnCalendarNotifications(
  expectedUserId: string,
  portalScope: CalendarNotificationPortalScope,
  isCurrent: () => boolean = () => true,
): Promise<{ notifications: AppNotification[]; seenRecords: SeenNotificationRecord[] }> {
  const principal = getPrincipalClient();
  if (!principal) return { notifications: [], seenRecords: [] };
  const operation = await captureCalendarNotificationsOperation({ principal, expectedUserId, isCurrent });
  return listCalendarNotificationsWithOperation({ operation, portalScope, isCurrent });
}

export async function listCalendarNotificationsWithOperation(input: {
  readonly operation: CalendarNotificationsPinnedOperation;
  readonly portalScope: CalendarNotificationPortalScope;
  readonly isCurrent: () => boolean;
}): Promise<{ notifications: AppNotification[]; seenRecords: SeenNotificationRecord[] }> {
  const { operation, portalScope, isCurrent } = input;
  if (!isCurrent()) throw new Error("calendar-notifications-operation-stale");
  const result = await operation.dataClient.rpc("list_own_calendar_notifications", {
    p_portal_scope: portalScope,
    p_limit: 50,
  });
  if (result.error || !isCurrent()) throw new Error("calendar-notifications-load-failed");
  await operation.verifyExpectedUser();
  if (!isCurrent()) throw new Error("calendar-notifications-operation-stale");
  const rows = parseRows(result.data);
  return {
    notifications: rows.map((row): AppNotification => ({
      id: `calendar:${row.id}`,
      title: row.title,
      summary: `${row.body} · ${row.occurrence_on} a las ${row.reminder_time.slice(0, 5)} hrs`,
      category: "Sistema",
      tone: "info",
      priority: "high",
      dedupeKey: `calendar:${row.id}`,
      target: "calendario",
      kind: "calendar",
      createdAt: row.created_at,
    })),
    seenRecords: rows.flatMap((row) => row.read_at
      ? [{ id: `calendar:${row.id}`, seenAt: new Date(row.read_at).getTime() }]
      : []),
  };
}

export async function markOwnCalendarNotificationRead(
  expectedUserId: string,
  portalScope: CalendarNotificationPortalScope,
  appNotificationId: string,
  isCurrent: () => boolean = () => true,
) {
  if (!appNotificationId.startsWith("calendar:")) return;
  const id = appNotificationId.slice("calendar:".length);
  if (!UUID.test(id)) throw new Error("calendar-notifications-invalid-id");
  const principal = getPrincipalClient();
  if (!principal) throw new Error("calendar-notifications-client-unavailable");
  const operation = await captureCalendarNotificationsOperation({ principal, expectedUserId, isCurrent });
  await markCalendarNotificationReadWithOperation({ operation, portalScope, appNotificationId, isCurrent });
}

export async function markCalendarNotificationReadWithOperation(input: {
  readonly operation: CalendarNotificationsPinnedOperation;
  readonly portalScope: CalendarNotificationPortalScope;
  readonly appNotificationId: string;
  readonly isCurrent: () => boolean;
}) {
  const { operation, portalScope, appNotificationId, isCurrent } = input;
  if (!appNotificationId.startsWith("calendar:")) throw new Error("calendar-notifications-invalid-id");
  const id = appNotificationId.slice("calendar:".length);
  if (!UUID.test(id)) throw new Error("calendar-notifications-invalid-id");
  if (!isCurrent()) throw new Error("calendar-notifications-operation-stale");
  const result = await operation.dataClient.rpc("mark_own_calendar_notifications_read", {
    p_portal_scope: portalScope,
    p_notification_ids: [id],
  });
  if (result.error || result.data !== 1 || !isCurrent()) throw new Error("calendar-notifications-mark-read-failed");
  await operation.verifyExpectedUser();
  if (!isCurrent()) throw new Error("calendar-notifications-operation-stale");
}
