import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
const coach = readFileSync("src/features/coach-portal/components/coach-portal.tsx", "utf8");
const hook = readFileSync("src/features/notifications/hooks/usePersistedCalendarNotifications.ts", "utf8");
const controller = readFileSync("src/features/notifications/model/notifications-controller.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");
const repository = readFileSync("src/features/notifications/data/supabase-calendar-notifications-repository.ts", "utf8");

test("Usuario y Coach comparten repositorio por auth uid, pero Coach no recibe catálogo Usuario", () => {
  assert.match(root, /usePersistedCalendarNotifications\(supabaseUser\?\.id \?\? null\)/);
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
  assert.match(hook, /\.catch\(\(\) => void reload\(\)\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(root, /if \(!isNotificationPanelOpen\) void persistedCalendarNotifications\.reload\(\)/);
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
