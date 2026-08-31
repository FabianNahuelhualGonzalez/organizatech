import { createClient, type Session, type User } from "@supabase/supabase-js";

import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type RepositoryError = { readonly message?: string } | null;

export type TrainingCycleNotificationEventKind =
  | "expires_t3"
  | "expires_t2"
  | "expires_t1"
  | "expires_t0"
  | "closed_t1";

interface TrainingCycleNotificationRow {
  readonly notificationId: string;
  readonly cycleId: string;
  readonly eventKind: TrainingCycleNotificationEventKind;
  readonly scheduledOn: string;
  readonly title: string;
  readonly body: string;
  readonly materializedAt: string;
  readonly readAt: string | null;
}

export interface TrainingCycleNotificationsCursor {
  readonly beforeMaterializedAt: string;
  readonly beforeId: string;
}

export interface TrainingCycleNotificationsPage {
  readonly notifications: readonly AppNotification[];
  readonly seenRecords: readonly SeenNotificationRecord[];
  readonly nextCursor: TrainingCycleNotificationsCursor | null;
}

export interface TrainingCycleNotificationsDataClient {
  rpc(
    name: "list_own_training_cycle_notifications" | "mark_own_training_cycle_notifications_read",
    args: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown; readonly error: RepositoryError }>;
}

export interface TrainingCycleNotificationsPrincipalClient {
  readonly auth: {
    getSession(): Promise<{ readonly data: { readonly session: Session | null }; readonly error: RepositoryError }>;
    getUser(accessToken?: string): Promise<{ readonly data: { readonly user: User | null }; readonly error: RepositoryError }>;
  };
}

export interface TrainingCycleNotificationsPinnedOperation {
  readonly dataClient: TrainingCycleNotificationsDataClient;
  readonly verifyExpectedUser: () => Promise<void>;
}

const PORTAL_SCOPE = "usuario" as const;
const PAGE_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_KINDS = new Set<TrainingCycleNotificationEventKind>([
  "expires_t3",
  "expires_t2",
  "expires_t1",
  "expires_t0",
  "closed_t1",
]);

function fail(code: string): never {
  throw new Error(`training-cycle-notifications-${code}`);
}

function getPrincipalClient(): TrainingCycleNotificationsPrincipalClient | null {
  return getSupabaseBrowserClient() as unknown as TrainingCycleNotificationsPrincipalClient | null;
}

function createPinnedClient(accessToken: string): TrainingCycleNotificationsDataClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) fail("client-unavailable");
  return createClient(url, anonKey, {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as TrainingCycleNotificationsDataClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseCursor(value: unknown): TrainingCycleNotificationsCursor | null {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ["beforeMaterializedAt", "beforeId"])) {
    fail("invalid-cursor");
  }
  if (!isTimestamp(value.beforeMaterializedAt) || typeof value.beforeId !== "string" || !UUID.test(value.beforeId)) {
    fail("invalid-cursor");
  }
  return {
    beforeMaterializedAt: value.beforeMaterializedAt,
    beforeId: value.beforeId,
  };
}

function parseRow(value: unknown): TrainingCycleNotificationRow {
  if (!isRecord(value) || !hasExactKeys(value, [
    "notificationId",
    "cycleId",
    "eventKind",
    "scheduledOn",
    "title",
    "body",
    "materializedAt",
    "readAt",
  ])) fail("invalid-row");

  if (
    typeof value.notificationId !== "string" || !UUID.test(value.notificationId)
    || typeof value.cycleId !== "string" || !UUID.test(value.cycleId)
    || typeof value.eventKind !== "string" || !EVENT_KINDS.has(value.eventKind as TrainingCycleNotificationEventKind)
    || !isDateKey(value.scheduledOn)
    || typeof value.title !== "string" || value.title.length < 1 || value.title.length > 120
    || typeof value.body !== "string" || value.body.length < 1 || value.body.length > 1000
    || !isTimestamp(value.materializedAt)
    || (value.readAt !== null && !isTimestamp(value.readAt))
  ) fail("invalid-row");

  return value as unknown as TrainingCycleNotificationRow;
}

function parsePage(value: unknown): {
  readonly rows: readonly TrainingCycleNotificationRow[];
  readonly nextCursor: TrainingCycleNotificationsCursor | null;
} {
  if (!isRecord(value) || !hasExactKeys(value, ["items", "nextCursor"]) || !Array.isArray(value.items)) {
    fail("invalid-result");
  }
  if (value.items.length > PAGE_LIMIT) fail("invalid-result");
  const rows = value.items.map(parseRow);
  const nextCursor = parseCursor(value.nextCursor);
  if (nextCursor) {
    const last = rows.at(-1);
    if (
      rows.length !== PAGE_LIMIT
      || !last
      || last.materializedAt !== nextCursor.beforeMaterializedAt
      || last.notificationId !== nextCursor.beforeId
    ) fail("invalid-cursor");
  }
  return { rows, nextCursor };
}

function parseMarkReadReceipt(value: unknown, requestId: string) {
  if (!isRecord(value) || !hasExactKeys(value, [
    "responseKind",
    "requestId",
    "operationKind",
    "aggregateId",
    "resultVersion",
  ])) fail("invalid-receipt");
  if (
    value.responseKind !== "accepted_operation"
    || value.requestId !== requestId
    || value.operationKind !== "notifications_mark_read"
    || value.aggregateId !== requestId
    || value.resultVersion !== null
  ) fail("invalid-receipt");
}

async function getSessionSafely(principal: TrainingCycleNotificationsPrincipalClient) {
  try {
    return await principal.auth.getSession();
  } catch {
    return fail("session-mismatch");
  }
}

async function assertTokenOwner(
  principal: TrainingCycleNotificationsPrincipalClient,
  accessToken: string,
  expectedUserId: string,
) {
  try {
    const result = await principal.auth.getUser(accessToken);
    if (result.error || result.data.user?.id !== expectedUserId) fail("session-mismatch");
  } catch (error) {
    if (error instanceof Error && error.message === "training-cycle-notifications-session-mismatch") throw error;
    fail("session-mismatch");
  }
}

async function rpcSafely(
  client: TrainingCycleNotificationsDataClient,
  name: "list_own_training_cycle_notifications" | "mark_own_training_cycle_notifications_read",
  args: Readonly<Record<string, unknown>>,
  errorCode: "load-failed" | "mark-read-failed",
) {
  try {
    const result = await client.rpc(name, args);
    if (result.error) fail(errorCode);
    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message === `training-cycle-notifications-${errorCode}`) throw error;
    fail(errorCode);
  }
}

function assertCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) fail("operation-stale");
}

async function verifyOperationOwner(
  operation: TrainingCycleNotificationsPinnedOperation,
  isCurrent: () => boolean,
) {
  assertCurrent(isCurrent);
  await operation.verifyExpectedUser();
  assertCurrent(isCurrent);
}

export async function captureTrainingCycleNotificationsOperation(input: {
  readonly principal: TrainingCycleNotificationsPrincipalClient;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly createPinnedClient?: (accessToken: string) => TrainingCycleNotificationsDataClient;
}): Promise<TrainingCycleNotificationsPinnedOperation> {
  assertCurrent(input.isCurrent);
  const result = await getSessionSafely(input.principal);
  assertCurrent(input.isCurrent);
  const session = result.data.session;
  if (result.error || !session?.access_token || session.user.id !== input.expectedUserId) {
    fail("session-mismatch");
  }
  const accessToken = session.access_token;
  assertCurrent(input.isCurrent);
  await assertTokenOwner(input.principal, accessToken, input.expectedUserId);
  assertCurrent(input.isCurrent);
  return {
    dataClient: (input.createPinnedClient ?? createPinnedClient)(accessToken),
    verifyExpectedUser: () => assertTokenOwner(input.principal, accessToken, input.expectedUserId),
  };
}

export async function listOwnTrainingCycleNotifications(
  expectedUserId: string,
  cursor: TrainingCycleNotificationsCursor | null = null,
  isCurrent: () => boolean = () => true,
): Promise<TrainingCycleNotificationsPage> {
  const principal = getPrincipalClient();
  if (!principal) fail("client-unavailable");
  const operation = await captureTrainingCycleNotificationsOperation({ principal, expectedUserId, isCurrent });
  return listTrainingCycleNotificationsWithOperation({ operation, cursor, isCurrent });
}

export async function listTrainingCycleNotificationsWithOperation(input: {
  readonly operation: TrainingCycleNotificationsPinnedOperation;
  readonly cursor?: TrainingCycleNotificationsCursor | null;
  readonly isCurrent: () => boolean;
}): Promise<TrainingCycleNotificationsPage> {
  const cursor = input.cursor ?? null;
  assertCurrent(input.isCurrent);
  const data = await rpcSafely(input.operation.dataClient, "list_own_training_cycle_notifications", {
    p_portal_scope: PORTAL_SCOPE,
    p_limit: PAGE_LIMIT,
    p_before_materialized_at: cursor?.beforeMaterializedAt ?? null,
    p_before_id: cursor?.beforeId ?? null,
  }, "load-failed");
  assertCurrent(input.isCurrent);
  await verifyOperationOwner(input.operation, input.isCurrent);
  const page = parsePage(data);
  return {
    notifications: page.rows.map((row): AppNotification => ({
      id: `training-cycle:${row.notificationId}`,
      title: row.title,
      summary: row.body,
      category: "Entrenamiento",
      tone: row.eventKind === "closed_t1" ? "success" : "warning",
      priority: "high",
      dedupeKey: `training-cycle:${row.notificationId}`,
      target: "registro-entrenamiento",
      kind: "training-cycle",
      createdAt: row.materializedAt,
    })),
    seenRecords: page.rows.flatMap((row) => row.readAt
      ? [{ id: `training-cycle:${row.notificationId}`, seenAt: new Date(row.readAt).getTime() }]
      : []),
    nextCursor: page.nextCursor,
  };
}

export function isTrainingCycleNotificationAppId(value: string) {
  if (!value.startsWith("training-cycle:")) return false;
  return UUID.test(value.slice("training-cycle:".length));
}

function parseNotificationIds(appNotificationIds: readonly string[]) {
  if (appNotificationIds.length < 1 || appNotificationIds.length > PAGE_LIMIT) fail("invalid-selection");
  const ids = appNotificationIds.map((appNotificationId) => {
    if (!isTrainingCycleNotificationAppId(appNotificationId)) fail("invalid-id");
    const id = appNotificationId.slice("training-cycle:".length);
    if (!UUID.test(id)) fail("invalid-id");
    return id;
  });
  if (new Set(ids).size !== ids.length) fail("invalid-selection");
  return ids;
}

export async function markOwnTrainingCycleNotificationsRead(
  expectedUserId: string,
  appNotificationIds: readonly string[],
  requestId: string,
  isCurrent: () => boolean = () => true,
) {
  const ids = parseNotificationIds(appNotificationIds);
  if (!UUID.test(requestId)) fail("invalid-request-id");
  const principal = getPrincipalClient();
  if (!principal) fail("client-unavailable");
  const operation = await captureTrainingCycleNotificationsOperation({ principal, expectedUserId, isCurrent });
  await markTrainingCycleNotificationsReadWithOperation({ operation, ids, requestId, isCurrent });
}

export async function markTrainingCycleNotificationsReadWithOperation(input: {
  readonly operation: TrainingCycleNotificationsPinnedOperation;
  readonly ids: readonly string[];
  readonly requestId: string;
  readonly isCurrent: () => boolean;
}) {
  if (input.ids.length < 1 || input.ids.length > PAGE_LIMIT || new Set(input.ids).size !== input.ids.length) {
    fail("invalid-selection");
  }
  if (!input.ids.every((id) => UUID.test(id))) fail("invalid-id");
  if (!UUID.test(input.requestId)) fail("invalid-request-id");
  assertCurrent(input.isCurrent);
  const data = await rpcSafely(input.operation.dataClient, "mark_own_training_cycle_notifications_read", {
    p_request_id: input.requestId,
    p_portal_scope: PORTAL_SCOPE,
    p_notification_ids: [...input.ids],
  }, "mark-read-failed");
  assertCurrent(input.isCurrent);
  await verifyOperationOwner(input.operation, input.isCurrent);
  parseMarkReadReceipt(data, input.requestId);
}
