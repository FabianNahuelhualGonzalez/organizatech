import { createClient, type Session, type User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { expandCalendarReminder, type StoredCalendarReminder } from "../model/reminder-recurrence";
import { parseCalendarDateKey } from "../model/calendar-date";
import type {
  CalendarDateKey,
  CalendarReminder,
  CalendarReminderEnd,
  CalendarPortalScope,
  CalendarReminderRecurrence,
  CalendarWeekday,
  CreateCalendarReminderDto,
} from "../model/types";

type RepositoryError = { readonly message?: string } | null;

interface CalendarReminderRow {
  readonly id: string;
  readonly starts_on: string;
  readonly title: string;
  readonly description: string;
  readonly kind: string;
  readonly reminder_time: string;
  readonly lead_time: string;
  readonly email_notification: boolean;
  readonly recurrence_frequency: string;
  readonly weekly_days: unknown;
  readonly monthly_mode: string | null;
  readonly monthly_day: number | null;
  readonly monthly_weekday: string | null;
  readonly monthly_position: string | null;
  readonly end_mode: string;
  readonly ends_on: string | null;
  readonly occurrence_count: number | null;
}

export interface CalendarRemindersDataClient {
  rpc(
    name: "create_own_calendar_reminder" | "list_own_calendar_reminders",
    args: Readonly<Record<string, unknown>>,
  ): Promise<{
    data: unknown;
    error: RepositoryError;
  }>;
}

export interface CalendarRemindersClient extends CalendarRemindersDataClient {
  readonly auth: {
    getUser(accessToken?: string): Promise<{ data: { user: User | null }; error: RepositoryError }>;
  };
}

export interface CalendarRemindersPrincipalClient extends CalendarRemindersClient {
  readonly auth: CalendarRemindersClient["auth"] & {
    getSession(): Promise<{ data: { session: Session | null }; error: RepositoryError }>;
  };
}

export interface CalendarRemindersPinnedOperation {
  readonly dataClient: CalendarRemindersDataClient;
  readonly verifyExpectedUser: () => Promise<void>;
}

const WEEKDAYS = new Set<CalendarWeekday>(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

async function assertExpectedUser(client: CalendarRemindersClient, expectedUserId: string) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new Error("calendar-reminders-session-mismatch");
  }
}

function parseEnd(row: CalendarReminderRow): CalendarReminderEnd {
  if (row.end_mode === "never") return { mode: "never" };
  if (row.end_mode === "on_date" && row.ends_on && parseCalendarDateKey(row.ends_on)) {
    return { mode: "on_date", date: row.ends_on };
  }
  if (row.end_mode === "after_occurrences" && Number.isInteger(row.occurrence_count)) {
    return { mode: "after_occurrences", occurrences: row.occurrence_count as number };
  }
  throw new Error("calendar-reminders-invalid-end");
}

function parseRecurrence(row: CalendarReminderRow): CalendarReminderRecurrence {
  if (row.recurrence_frequency === "once") return { frequency: "once" };
  const end = parseEnd(row);
  if (row.recurrence_frequency === "daily") return { frequency: "daily", end };
  if (row.recurrence_frequency === "weekly") {
    if (!Array.isArray(row.weekly_days) || !row.weekly_days.every((day) => WEEKDAYS.has(day))) {
      throw new Error("calendar-reminders-invalid-weekdays");
    }
    return { frequency: "weekly", weekdays: row.weekly_days as CalendarWeekday[], end };
  }
  if (row.recurrence_frequency === "monthly" && row.monthly_mode === "day_of_month") {
    if (!Number.isInteger(row.monthly_day) || (row.monthly_day ?? 0) < 1 || (row.monthly_day ?? 0) > 31) {
      throw new Error("calendar-reminders-invalid-month-day");
    }
    return { frequency: "monthly", mode: { type: "day_of_month", day: row.monthly_day as number }, end };
  }
  if (
    row.recurrence_frequency === "monthly"
    && row.monthly_mode === "weekday_position"
    && WEEKDAYS.has(row.monthly_weekday as CalendarWeekday)
    && ["1", "2", "3", "4", "last"].includes(row.monthly_position ?? "")
  ) {
    const rawPosition = row.monthly_position as "1" | "2" | "3" | "4" | "last";
    return {
      frequency: "monthly",
      mode: {
        type: "weekday_position",
        weekday: row.monthly_weekday as CalendarWeekday,
        position: rawPosition === "last" ? "last" : Number(rawPosition) as 1 | 2 | 3 | 4,
      },
      end,
    };
  }
  throw new Error("calendar-reminders-invalid-recurrence");
}

function mapRow(row: CalendarReminderRow): StoredCalendarReminder {
  if (!parseCalendarDateKey(row.starts_on)) throw new Error("calendar-reminders-invalid-date");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(row.reminder_time)) {
    throw new Error("calendar-reminders-invalid-time");
  }
  if (!(["revision", "vencimiento", "personal"] as const).includes(row.kind as never)) {
    throw new Error("calendar-reminders-invalid-kind");
  }
  if (!(["at_time", "10_minutes", "1_hour", "1_day"] as const).includes(row.lead_time as never)) {
    throw new Error("calendar-reminders-invalid-lead");
  }
  return {
    id: row.id,
    startsOn: row.starts_on,
    title: row.title,
    description: row.description,
    kind: row.kind as StoredCalendarReminder["kind"],
    time: row.reminder_time.slice(0, 5),
    leadTime: row.lead_time as StoredCalendarReminder["leadTime"],
    emailNotification: row.email_notification,
    recurrence: parseRecurrence(row),
  };
}

export function getCalendarRemindersClient(): CalendarRemindersPrincipalClient | null {
  return getSupabaseBrowserClient() as unknown as CalendarRemindersPrincipalClient | null;
}

function createPinnedCalendarRemindersClient(accessToken: string): CalendarRemindersDataClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("calendar-reminders-client-unavailable");
  return createClient(url, anonKey, {
    accessToken: async () => accessToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as unknown as CalendarRemindersDataClient;
}

async function assertExpectedAccessTokenUser(
  principal: CalendarRemindersPrincipalClient,
  accessToken: string,
  expectedUserId: string,
) {
  const { data, error } = await principal.auth.getUser(accessToken);
  if (error || !data.user || data.user.id !== expectedUserId) {
    throw new Error("calendar-reminders-session-mismatch");
  }
}

export async function captureCalendarRemindersOperationClient(input: {
  readonly principal: CalendarRemindersPrincipalClient;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly createPinnedClient?: (accessToken: string) => CalendarRemindersDataClient;
}): Promise<CalendarRemindersPinnedOperation> {
  if (!input.isCurrent()) throw new Error("calendar-reminders-operation-stale");
  const { data, error } = await input.principal.auth.getSession();
  const session = data.session;
  if (
    error
    || !session
    || session.user.id !== input.expectedUserId
    || !session.access_token
    || !input.isCurrent()
  ) throw new Error("calendar-reminders-session-mismatch");
  const capturedAccessToken = session.access_token;
  await assertExpectedAccessTokenUser(input.principal, capturedAccessToken, input.expectedUserId);
  if (!input.isCurrent()) throw new Error("calendar-reminders-operation-stale");
  const dataClient = (input.createPinnedClient ?? createPinnedCalendarRemindersClient)(capturedAccessToken);
  return {
    dataClient,
    verifyExpectedUser: () => assertExpectedAccessTokenUser(
      input.principal,
      capturedAccessToken,
      input.expectedUserId,
    ),
  };
}

export async function listOwnCalendarReminderOccurrences(input: {
  readonly client: CalendarRemindersClient;
  readonly expectedUserId: string;
  readonly portalScope: CalendarPortalScope;
  readonly from: CalendarDateKey;
  readonly to: CalendarDateKey;
}): Promise<readonly CalendarReminder[]> {
  await assertExpectedUser(input.client, input.expectedUserId);
  const { data, error } = await input.client.rpc("list_own_calendar_reminders", {
    p_portal_scope: input.portalScope,
    p_starts_on_lte: input.to,
  });
  if (error || !Array.isArray(data) || data.length > 500) {
    throw new Error("calendar-reminders-read-failed");
  }
  await assertExpectedUser(input.client, input.expectedUserId);
  return data.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("calendar-reminders-invalid-row");
    }
    return expandCalendarReminder(mapRow(candidate as CalendarReminderRow), {
      from: input.from,
      to: input.to,
    });
  });
}

function recurrenceRpcFields(recurrence: CreateCalendarReminderDto["recurrence"]) {
  const end = recurrence.frequency === "once" ? { mode: "never" as const } : recurrence.end;
  return {
    p_recurrence_frequency: recurrence.frequency,
    p_weekly_days: recurrence.frequency === "weekly" ? [...recurrence.weekdays] : null,
    p_monthly_mode: recurrence.frequency === "monthly" ? recurrence.mode.type : null,
    p_monthly_day: recurrence.frequency === "monthly" && recurrence.mode.type === "day_of_month"
      ? recurrence.mode.day : null,
    p_monthly_weekday: recurrence.frequency === "monthly" && recurrence.mode.type === "weekday_position"
      ? recurrence.mode.weekday : null,
    p_monthly_position: recurrence.frequency === "monthly" && recurrence.mode.type === "weekday_position"
      ? String(recurrence.mode.position) : null,
    p_end_mode: end.mode,
    p_ends_on: end.mode === "on_date" ? end.date : null,
    p_occurrence_count: end.mode === "after_occurrences" ? end.occurrences : null,
  };
}

export async function createOwnCalendarReminder(input: {
  readonly operation: CalendarRemindersPinnedOperation;
  readonly expectedUserId: string;
  readonly portalScope: CalendarPortalScope;
  readonly requestId: string;
  readonly dto: CreateCalendarReminderDto;
  readonly isCurrent: () => boolean;
}): Promise<{ readonly id: string }> {
  if (!input.isCurrent()) throw new Error("calendar-reminders-operation-stale");
  await input.operation.verifyExpectedUser();
  if (!input.isCurrent()) throw new Error("calendar-reminders-operation-stale");
  const { dto } = input;
  const { data, error } = await input.operation.dataClient.rpc("create_own_calendar_reminder", {
    p_request_id: input.requestId,
    p_title: dto.title,
    p_description: dto.description,
    p_kind: dto.kind,
    p_starts_on: dto.startsOn,
    p_reminder_time: dto.time,
    p_lead_time: dto.leadTime,
    p_email_notification: dto.emailNotification,
    p_portal_scope: input.portalScope,
    ...recurrenceRpcFields(dto.recurrence),
  });
  if (error || !data) throw new Error("calendar-reminders-create-failed");
  if (!input.isCurrent()) throw new Error("calendar-reminders-operation-stale");
  await input.operation.verifyExpectedUser();
  if (!input.isCurrent()) throw new Error("calendar-reminders-operation-stale");
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.id !== "string" || result.id.length === 0) {
    throw new Error("calendar-reminders-create-invalid-result");
  }
  // Match the stable occurrence id produced by the read adapter so the
  // optimistic first occurrence is reconciled instead of duplicated.
  return { id: `${result.id}:${dto.startsOn}` };
}
