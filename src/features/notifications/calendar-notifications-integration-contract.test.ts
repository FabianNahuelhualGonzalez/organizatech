import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  selectOwnedCalendarNotificationsSnapshot,
  shouldReloadAfterCalendarMarkReadFailure,
} from "./hooks/usePersistedCalendarNotifications";
import type { AppNotification } from "@/lib/notifications/notification-types";

const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
const coach = readFileSync("src/features/coach-portal/components/coach-portal.tsx", "utf8");
const hook = readFileSync("src/features/notifications/hooks/usePersistedCalendarNotifications.ts", "utf8");
const controller = readFileSync("src/features/notifications/model/notifications-controller.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");
const repository = readFileSync("src/features/notifications/data/supabase-calendar-notifications-repository.ts", "utf8");

test("Usuario y Coach usan scopes persistidos separados y Coach no recibe catálogo Usuario", () => {
  assert.match(root, /usePersistedCalendarNotifications\([\s\S]*supabaseUser\?\.id \?\? null,[\s\S]*coachPortalSession \? "coach" : "usuario"/);
  assert.match(root, /includeCatalogNotifications: !coachPortalSession/);
  assert.match(root, /additionalNotifications: persistedCalendarNotifications\.notifications/);
  assert.match(root, /persistedSeenRecords: persistedCalendarNotifications\.seenRecords/);
  assert.match(coach, /aria-controls="notification-panel"/);
  assert.match(coach, /aria-expanded=\{isNotificationPanelOpen\}/);
  assert.match(coach, /className=\{styles\.notificationBadge\}/);
  assert.match(coach, /\{notificationOverlay\}/);
});

test("read_at remoto es autoridad de calendar y localStorage no puede ocultar rollback", () => {
  assert.match(controller, /isPersistedCalendarNotification/);
  assert.match(controller, /if \(!isPersistedCalendarNotification\) \{[\s\S]*if \(!markSeen\(\[notification\.id\]\)\)/);
  assert.match(hook, /markOwnCalendarNotificationRead/);
  assert.match(hook, /\.catch\(\(\) => \{[\s\S]*shouldReloadAfterCalendarMarkReadFailure\(current, generation\.current\)[\s\S]*void reload\(\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(root, /if \(!isNotificationPanelOpen\) void persistedCalendarNotifications\.reload\(\)/);
});

test("un snapshot Calendar nunca cruza de la identidad A a B mientras B carga o falla", () => {
  const notification: AppNotification = {
    id: "calendar:00000000-0000-4000-8000-000000000001",
    title: "Privado A",
    summary: "Sólo pertenece a A",
    category: "Sistema",
    tone: "info",
    priority: "high",
    dedupeKey: "calendar:00000000-0000-4000-8000-000000000001",
    target: "calendario",
    kind: "calendar",
    createdAt: "2026-08-27T20:00:00.000Z",
  };
  const snapshotA = {
    ownerContextKey: "identity-a:usuario",
    notifications: [notification],
    seenRecords: [{ id: notification.id, seenAt: 1 }],
  };

  assert.deepEqual(selectOwnedCalendarNotificationsSnapshot(snapshotA, "identity-a:usuario"), {
    notifications: [notification],
    seenRecords: [{ id: notification.id, seenAt: 1 }],
  });
  assert.deepEqual(selectOwnedCalendarNotificationsSnapshot(snapshotA, "identity-a:coach"), {
    notifications: [],
    seenRecords: [],
  });
  assert.deepEqual(selectOwnedCalendarNotificationsSnapshot(snapshotA, null), {
    notifications: [],
    seenRecords: [],
  });
});

test("el hook aplica el gate de owner en render e invalida operaciones antes de pintar B", () => {
  assert.match(hook, /ownerContextKey: requestedContextKey/);
  assert.match(hook, /currentState\.ownerContextKey === contextKey/);
  assert.match(hook, /selectOwnedCalendarNotificationsSnapshot\(state, contextKey\)/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{[\s\S]*generation\.current \+= 1/);
  assert.match(hook, /return \{ \.\.\.visibleState, markRead, reload \}/);
});

test("list y mark-read envían el mismo portal allowlisted al RPC", () => {
  assert.match(repository, /list_own_calendar_notifications"[\s\S]*p_portal_scope: portalScope/);
  assert.match(repository, /mark_own_calendar_notifications_read"[\s\S]*p_portal_scope: portalScope/);
  assert.match(hook, /listOwnCalendarNotifications\([\s\S]*requestedIdentityKey,[\s\S]*portalScope/);
  assert.match(hook, /markOwnCalendarNotificationRead\([\s\S]*identityKey,[\s\S]*portalScope/);
});

test("un fallo tardío de markRead A no invalida la carga vigente de B", () => {
  const markReadGenerationA = 4;

  assert.equal(
    shouldReloadAfterCalendarMarkReadFailure(markReadGenerationA, markReadGenerationA),
    true,
  );
  assert.equal(
    shouldReloadAfterCalendarMarkReadFailure(markReadGenerationA, markReadGenerationA + 1),
    false,
  );
  assert.match(
    hook,
    /\.catch\(\(\) => \{[\s\S]*shouldReloadAfterCalendarMarkReadFailure\(current, generation\.current\)[\s\S]*void reload\(\)/,
  );
});

test("worker exige scheduler secret y capability separada, sin service_role", () => {
  assert.match(config, /\[functions\.send-calendar-reminders\][\s\S]*verify_jwt = false/);
  const worker = readFileSync("supabase/functions/send-calendar-reminders/handler.ts", "utf8");
  const index = readFileSync("supabase/functions/send-calendar-reminders/index.ts", "utf8");
  assert.match(worker, /calendarReminderRpcSecret/);
  assert.match(worker, /schedulerSecret/);
  assert.match(index, /CALENDAR_REMINDER_RPC_SECRET/);
  assert.match(index, /CALENDAR_REMINDER_SCHEDULER_SECRET/);
  assert.equal(`${worker}\n${index}`.includes("service_role"), false);
});

test("abrir detalle visible marca calendar y dirige al Calendario del portal activo", () => {
  assert.match(root, /if \(intent\.notificationId\.startsWith\("calendar:"\)\) \{[\s\S]*persistedCalendarNotifications\.markRead\(intent\.notificationId\)/);
  assert.match(root, /intent\.target === "calendario"/);
  assert.match(root, /setCoachCalendarOpenRequest/);
  assert.match(repository, /target: "calendario"/);
});

test("una solicitud de Calendario Coach pertenece al auth uid y se consume una sola vez", () => {
  assert.match(root, /ownerUserId: string;[\s\S]*sequence: number;/);
  assert.match(root, /session\?\.userId !== coachPortalSessionRef\.current\?\.userId[\s\S]*setCoachCalendarOpenRequest\(null\)/);
  assert.match(root, /ownerUserId = coachPortalSessionRef\.current\.userId/);
  assert.match(root, /onCalendarOpenRequestConsumed=\{\(request\) =>/);
  assert.match(coach, /calendarOpenRequest\?\.ownerUserId === session\.userId/);
  assert.match(coach, /onCalendarOpenRequestConsumed\(calendarOpenRequest\)/);
});
