import assert from "node:assert/strict";
import test from "node:test";

import {
  captureCalendarNotificationsOperation,
  listCalendarNotificationsWithOperation,
  markCalendarNotificationReadWithOperation,
  type CalendarNotificationsDataClient,
  type CalendarNotificationsPrincipalClient,
} from "./supabase-calendar-notifications-repository";

const USER_A = "10000000-0000-8000-8000-000000000001";
const NOTIFICATION = "10000000-0000-8000-8000-000000000002";

function principal(overrides?: { readonly onGetUser?: () => void }): CalendarNotificationsPrincipalClient {
  return {
    auth: {
      async getSession() {
        return { data: { session: { access_token: "token-a", user: { id: USER_A } } }, error: null } as never;
      },
      async getUser(accessToken?: string) {
        assert.equal(accessToken, "token-a");
        overrides?.onGetUser?.();
        return { data: { user: { id: USER_A } }, error: null } as never;
      },
    },
  };
}

test("captura token A y el cliente pinned nunca expone Auth", async () => {
  let pinnedToken = "";
  const dataClient = { rpc: async () => ({ data: [], error: null }) } as CalendarNotificationsDataClient;
  const operation = await captureCalendarNotificationsOperation({
    principal: principal(),
    expectedUserId: USER_A,
    isCurrent: () => true,
    createPinnedClient(accessToken) {
      pinnedToken = accessToken;
      return dataClient;
    },
  });
  assert.equal(pinnedToken, "token-a");
  assert.equal(operation.dataClient, dataClient);
  assert.equal("auth" in operation.dataClient, false);
});

test("A→B durante captura falla antes de construir o usar Data", async () => {
  let current = true;
  let pinnedCalls = 0;
  await assert.rejects(captureCalendarNotificationsOperation({
    principal: principal({ onGetUser: () => { current = false; } }),
    expectedUserId: USER_A,
    isCurrent: () => current,
    createPinnedClient() {
      pinnedCalls += 1;
      return { rpc: async () => ({ data: [], error: null }) };
    },
  }), /stale/);
  assert.equal(pinnedCalls, 0);
});

test("lista mapea detalle civil y read_at sólo después de postvalidar A", async () => {
  let verifications = 0;
  const result = await listCalendarNotificationsWithOperation({
    operation: {
      dataClient: { rpc: async (name, args) => {
        assert.equal(name, "list_own_calendar_notifications");
        assert.equal(args.p_portal_scope, "usuario");
        return { data: [{
          id: NOTIFICATION,
          title: "Control",
          body: "Revisar avance",
          occurrence_on: "2026-09-07",
          reminder_time: "09:30:00",
          read_at: "2026-09-01T12:00:00.000Z",
          created_at: "2026-09-01T11:00:00.000Z",
        }], error: null };
      } },
      verifyExpectedUser: async () => { verifications += 1; },
    },
    portalScope: "usuario",
    isCurrent: () => true,
  });
  assert.equal(verifications, 1);
  assert.equal(result.notifications[0]?.target, "calendario");
  assert.match(result.notifications[0]?.summary ?? "", /2026-09-07 a las 09:30/);
  assert.equal(result.seenRecords[0]?.id, `calendar:${NOTIFICATION}`);
});

test("mark-read exige una fila own y descarta owner stale", async () => {
  for (const candidate of [
    { data: 0, current: true },
    { data: 1, current: false },
  ]) {
    await assert.rejects(markCalendarNotificationReadWithOperation({
      operation: {
        dataClient: { rpc: async (name, args) => {
          assert.equal(name, "mark_own_calendar_notifications_read");
          assert.equal(args.p_portal_scope, "coach");
          return { data: candidate.data, error: null };
        } },
        verifyExpectedUser: async () => undefined,
      },
      portalScope: "coach",
      appNotificationId: `calendar:${NOTIFICATION}`,
      isCurrent: () => candidate.current,
    }));
  }
});
