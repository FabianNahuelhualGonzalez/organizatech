import assert from "node:assert/strict";
import test from "node:test";

import { createNotificationsController } from "./notifications-controller";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
} from "@/lib/session/session-data-epoch";
import type { AppNotification } from "@/lib/notifications/notification-types";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCOPE_A = `supabase:${USER_A}` as const;
const SCOPE_B = `supabase:${USER_B}` as const;

const notification: AppNotification = {
  id: "notice-1",
  title: "N",
  summary: "S",
  category: "Sistema",
  tone: "info",
  priority: "low",
  dedupeKey: "notice-1",
  target: "dashboard",
  kind: "feature",
  createdAt: "2026-08-04T12:00:00.000Z",
};

const secondNotification: AppNotification = {
  ...notification,
  id: "notice-2",
  dedupeKey: "notice-2",
  target: "perfil",
  section: "personal-data",
};

const persistedCalendarNotification: AppNotification = {
  ...notification,
  id: "calendar:20000000-0000-4000-8000-000000000001",
  dedupeKey: "calendar:20000000-0000-4000-8000-000000000001",
  target: "calendario",
  kind: "calendar",
};

const persistedTrainingCycleNotification: AppNotification = {
  ...notification,
  id: "training-cycle:30000000-0000-4000-8000-000000000001",
  dedupeKey: "training-cycle:30000000-0000-4000-8000-000000000001",
  target: "registro-entrenamiento",
  kind: "training-cycle",
};

function createIntentCounters() {
  const counters = { intents: 0, navigations: 0, scrolls: 0 };
  return {
    counters,
    publish() {
      counters.intents += 1;
      counters.navigations += 1;
      counters.scrolls += 1;
    },
  };
}

function harness() {
  let epoch = createSessionDataEpoch({ userId: USER_A, scope: SCOPE_A });
  const records = new Map<string, Array<{ id: string; seenAt: number }>>();
  const writes: Array<{ scope: string; records: Array<{ id: string; seenAt: number }> }> = [];
  const controller = createNotificationsController({
    identity: {
      captureRequestToken: () => captureSessionDataRequestToken(epoch),
      isRequestTokenCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
    },
    storage: {
      load: (scope) => records.get(scope) ?? [],
      save: (next, scope) => {
        const projected = next.map((record) => ({ id: record.id, seenAt: record.seenAt }));
        records.set(scope, projected);
        writes.push({ scope, records: projected });
      },
    },
  });
  controller.replaceIdentityScope(SCOPE_A);
  return {
    controller,
    writes,
    records,
    switchToB() {
      epoch = advanceSessionDataEpoch(epoch, { userId: USER_B, scope: SCOPE_B });
      controller.replaceIdentityScope(SCOPE_B);
    },
  };
}

test("callback capturado en A e invocado bajo B no persiste ni navega", () => {
  const { controller, writes, switchToB } = harness();
  const commandsA = controller.captureCommands();
  switchToB();
  let navigations = 0;
  assert.equal(commandsA.open(notification, () => { navigations += 1; }), false);
  assert.equal(writes.length, 0);
  assert.equal(navigations, 0);
  assert.deepEqual(controller.getSeenRecords(), []);
});

test("scope queda capturado y demo/Supabase permanecen aislados", () => {
  const { controller, writes, switchToB } = harness();
  const commandsA = controller.captureCommands();
  assert.equal(commandsA.markSeen(["a"]), true);
  switchToB();
  const commandsB = controller.captureCommands();
  assert.equal(commandsB.markSeen(["b"]), true);
  assert.deepEqual(writes.map((write) => write.scope), [SCOPE_A, SCOPE_B]);
  controller.replaceIdentityScope(SCOPE_A);
  assert.deepEqual(controller.getSeenRecords().map((record) => record.id), ["a"]);
  const mismatchedScopeCommands = controller.captureCommands();
  assert.equal(mismatchedScopeCommands.markSeen(["cross-owner"]), false);
  assert.equal(writes.length, 2);
});

test("Strict Mode/replay e invocaciones duplicadas persisten una sola vez", () => {
  const { controller, writes } = harness();
  const commands = controller.captureCommands();
  assert.equal(commands.markSeen([notification.id]), true);
  assert.equal(commands.markSeen([notification.id]), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0].records[0]).sort(), ["id", "seenAt"]);
});

test("open deduplica replay inmediato de persistencia, intent, navegación y scroll", () => {
  const { controller, writes } = harness();
  const commands = controller.captureCommands();
  const { counters, publish } = createIntentCounters();

  assert.equal(commands.open(notification, publish), true);
  assert.equal(commands.open(notification, publish), false);
  assert.equal(writes.length, 1);
  assert.deepEqual(counters, { intents: 1, navigations: 1, scrolls: 1 });
});

test("open libera el guard en microtask y permite una interacción posterior sin save duplicado", async () => {
  const { controller, writes } = harness();
  const commands = controller.captureCommands();
  const { counters, publish } = createIntentCounters();

  assert.equal(commands.open(notification, publish), true);
  await Promise.resolve();
  assert.equal(commands.open(notification, publish), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(counters, { intents: 2, navigations: 2, scrolls: 2 });
});

test("open mantiene guards independientes para notificaciones diferentes", () => {
  const { controller, writes } = harness();
  const commands = controller.captureCommands();
  const { counters, publish } = createIntentCounters();

  assert.equal(commands.open(notification, publish), true);
  assert.equal(commands.open(secondNotification, publish), true);
  assert.equal(writes.length, 2);
  assert.deepEqual(counters, { intents: 2, navigations: 2, scrolls: 2 });
});

test("invalidación y dispose limpian guards y mantienen callbacks anteriores stale", () => {
  const { controller, writes } = harness();
  const commandsBeforeInvalidation = controller.captureCommands();
  controller.invalidateIdentity();
  controller.replaceIdentityScope(SCOPE_A);
  const { counters, publish } = createIntentCounters();

  assert.equal(commandsBeforeInvalidation.open(notification, publish), false);
  const commandsBeforeDispose = controller.captureCommands();
  controller.dispose();
  assert.equal(commandsBeforeDispose.open(notification, publish), false);
  assert.equal(writes.length, 0);
  assert.deepEqual(counters, { intents: 0, navigations: 0, scrolls: 0 });
});

test("mark seen es inmutable, idempotente y mantiene el ref autoritativo", () => {
  const { controller } = harness();
  const initial = controller.getSeenRecords();
  const commands = controller.captureCommands();
  commands.markSeen(["a", "a"]);
  const current = controller.getSeenRecords();
  assert.notEqual(current, initial);
  assert.deepEqual(current.map((record) => record.id), ["a"]);
  const currentReference = controller.getSeenRecords();
  commands.markSeen(["a"]);
  assert.equal(controller.getSeenRecords(), currentReference);
});

test("notificaciones persistidas Calendar y Ciclo delegan read_at al servidor", () => {
  const { controller, writes } = harness();
  const commands = controller.captureCommands();
  const opened: string[] = [];

  assert.equal(commands.open(persistedCalendarNotification, (intent) => opened.push(intent.notificationId)), true);
  assert.equal(commands.open(persistedTrainingCycleNotification, (intent) => opened.push(intent.notificationId)), true);
  assert.deepEqual(opened, [persistedCalendarNotification.id, persistedTrainingCycleNotification.id]);
  assert.equal(writes.length, 0);
  assert.deepEqual(controller.getSeenRecords(), []);
});

test("kind persistido con prefijo incorrecto no evade persistencia local", () => {
  const { controller, writes } = harness();
  const commands = controller.captureCommands();
  const malformed: AppNotification = {
    ...persistedTrainingCycleNotification,
    id: "notice-with-wrong-prefix",
    dedupeKey: "notice-with-wrong-prefix",
  };

  assert.equal(commands.open(malformed, () => undefined), true);
  assert.equal(writes.length, 1);
  assert.deepEqual(controller.getSeenRecords().map((record) => record.id), [malformed.id]);
});
