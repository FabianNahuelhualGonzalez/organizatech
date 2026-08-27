import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type User } from "@supabase/supabase-js";

import {
  captureCalendarRemindersOperationClient,
  createOwnCalendarReminder,
  listOwnCalendarReminderOccurrences,
  type CalendarRemindersClient,
  type CalendarRemindersDataClient,
  type CalendarRemindersPinnedOperation,
  type CalendarRemindersPrincipalClient,
} from "./supabase-calendar-reminders-repository";
import type { CreateCalendarReminderDto } from "../model/types";

const dto: CreateCalendarReminderDto = {
  title: "Control",
  description: "Revisar avances",
  kind: "revision",
  startsOn: "2026-08-26",
  time: "09:00",
  leadTime: "1_hour",
  emailNotification: true,
  recurrence: { frequency: "once" },
};

function user(id: string): User {
  return { id } as User;
}

function row(id: string) {
  return {
    id,
    starts_on: "2026-08-26",
    title: "Control",
    description: "",
    kind: "revision",
    reminder_time: "09:00:00",
    lead_time: "at_time",
    email_notification: false,
    recurrence_frequency: "once",
    weekly_days: null,
    monthly_mode: null,
    monthly_day: null,
    monthly_weekday: null,
    monthly_position: null,
    end_mode: "never",
    ends_on: null,
    occurrence_count: null,
  };
}

function fakeClient(input: {
  readonly authIds: readonly string[];
  readonly rows?: readonly ReturnType<typeof row>[];
  readonly rpcId?: string;
  readonly onRpc?: (args: Readonly<Record<string, unknown>>) => void;
}): CalendarRemindersClient {
  let authIndex = 0;
  return {
    auth: {
      async getUser() {
        const id = input.authIds[Math.min(authIndex, input.authIds.length - 1)];
        authIndex += 1;
        return { data: { user: id ? user(id) : null }, error: null };
      },
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async lte() {
                  return { data: [...(input.rows ?? [])], error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(_name, args) {
      input.onRpc?.(args);
      return { data: { id: input.rpcId ?? "created" }, error: null };
    },
  };
}

function fakeOperation(input: {
  readonly expectedUserId: string;
  readonly authIds: readonly string[];
  readonly rpcId?: string;
  readonly onRpc?: (args: Readonly<Record<string, unknown>>) => void;
}): CalendarRemindersPinnedOperation {
  const client = fakeClient(input);
  return {
    dataClient: client,
    async verifyExpectedUser() {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user || data.user.id !== input.expectedUserId) {
        throw new Error("calendar-reminders-session-mismatch");
      }
    },
  };
}

test("Usuario y Coach con el mismo auth.uid leen el mismo calendario; otra identidad queda aislada", async () => {
  const shared = fakeClient({ authIds: ["hybrid", "hybrid", "hybrid", "hybrid"], rows: [row("shared")] });
  const fromUserPortal = await listOwnCalendarReminderOccurrences({
    client: shared, expectedUserId: "hybrid", from: "2026-08-01", to: "2026-08-31",
  });
  const fromCoachPortal = await listOwnCalendarReminderOccurrences({
    client: shared, expectedUserId: "hybrid", from: "2026-08-01", to: "2026-08-31",
  });
  assert.deepEqual(fromUserPortal, fromCoachPortal);

  const separateCoach = fakeClient({ authIds: ["coach-only", "coach-only"], rows: [row("coach-row")] });
  const separate = await listOwnCalendarReminderOccurrences({
    client: separateCoach, expectedUserId: "coach-only", from: "2026-08-01", to: "2026-08-31",
  });
  assert.notEqual(separate[0]?.id, fromUserPortal[0]?.id);
});

test("BOLA y respuestas de una sesión cambiada fallan cerradas", async () => {
  await assert.rejects(() => listOwnCalendarReminderOccurrences({
    client: fakeClient({ authIds: ["user-a"] }),
    expectedUserId: "user-b",
    from: "2026-08-01",
    to: "2026-08-31",
  }), /session-mismatch/);

  await assert.rejects(() => createOwnCalendarReminder({
    operation: fakeOperation({ expectedUserId: "user-a", authIds: ["user-a", "user-b"] }),
    expectedUserId: "user-a",
    requestId: "11111111-1111-4111-8111-111111111111",
    dto,
    isCurrent: () => true,
  }), /session-mismatch/);
});

test("cambio adversarial A→B invalida antes del write y ejecuta cero RPC", async () => {
  let currentIdentity = "user-a";
  let rpcCalls = 0;
  const operationClient = fakeClient({
    authIds: ["user-a"],
    onRpc: () => { rpcCalls += 1; },
  });
  const principal = {
    ...fakeClient({ authIds: ["user-a"] }),
    auth: {
      async getUser() {
        return { data: { user: user(currentIdentity) }, error: null };
      },
      async getSession() {
        return {
          data: {
            session: {
              access_token: "captured-a",
              refresh_token: "unused",
              user: user("user-a"),
            },
          },
          error: null,
        };
      },
    },
  } as CalendarRemindersPrincipalClient;
  const pinned = await captureCalendarRemindersOperationClient({
    principal,
    expectedUserId: "user-a",
    isCurrent: () => currentIdentity === "user-a",
    createPinnedClient: () => operationClient,
  });
  currentIdentity = "user-b";

  await assert.rejects(() => createOwnCalendarReminder({
    operation: pinned,
    expectedUserId: "user-a",
    requestId: "11111111-1111-4111-8111-111111111111",
    dto,
    isCurrent: () => currentIdentity === "user-a",
  }), /operation-stale/);
  assert.equal(rpcCalls, 0);
});

test("el write usa RPC, allowlist e idempotency key sin ownership controlable", async () => {
  const capture: { value?: Readonly<Record<string, unknown>> } = {};
  const result = await createOwnCalendarReminder({
    operation: fakeOperation({
      expectedUserId: "user-a",
      authIds: ["user-a", "user-a"],
      onRpc: (args) => { capture.value = args; },
    }),
    expectedUserId: "user-a",
    requestId: "11111111-1111-4111-8111-111111111111",
    dto,
    isCurrent: () => true,
  });
  assert.equal(result.id, "created:2026-08-26");
  assert.ok(capture.value);
  assert.equal(capture.value.p_request_id, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(
    Object.keys(capture.value).filter((key) => /user|owner|profile/i.test(key)),
    [],
  );
});

test("createClient real fija Data/RPC al token A sin acceder al proxy auth", async () => {
  const capturedAccessToken = "test-access-token-a";
  let rpcCalls = 0;
  let tokenValidations = 0;
  const realPinnedClient = createClient("https://calendar-reminders.test.supabase.co", "test-anon-key", {
    accessToken: async () => capturedAccessToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (_input, init) => {
        rpcCalls += 1;
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${capturedAccessToken}`);
        return new Response(JSON.stringify({ id: "real-client-created" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  const principal = {
    ...fakeClient({ authIds: ["user-a"] }),
    auth: {
      async getUser(accessToken?: string) {
        tokenValidations += 1;
        assert.equal(accessToken, capturedAccessToken);
        return { data: { user: user("user-a") }, error: null };
      },
      async getSession() {
        return {
          data: {
            session: {
              access_token: capturedAccessToken,
              refresh_token: "unused",
              user: user("user-a"),
            },
          },
          error: null,
        };
      },
    },
  } as CalendarRemindersPrincipalClient;
  const operation = await captureCalendarRemindersOperationClient({
    principal,
    expectedUserId: "user-a",
    isCurrent: () => true,
    createPinnedClient: () => realPinnedClient as unknown as CalendarRemindersDataClient,
  });

  const result = await createOwnCalendarReminder({
    operation,
    expectedUserId: "user-a",
    requestId: "11111111-1111-4111-8111-111111111111",
    dto,
    isCurrent: () => true,
  });

  assert.equal(result.id, "real-client-created:2026-08-26");
  assert.equal(rpcCalls, 1);
  assert.equal(tokenValidations, 3);
});

test("el mutante que reintroduce auth.getUser en el cliente pinned muere", () => {
  const realPinnedClient = createClient("https://calendar-reminders.test.supabase.co", "test-anon-key", {
    accessToken: async () => "test-access-token-a",
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  assert.throws(
    () => realPinnedClient.auth.getUser(),
    /configured with the accessToken option.*auth\.getUser.*not possible/,
  );
});
