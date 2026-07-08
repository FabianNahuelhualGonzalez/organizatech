import assert from "node:assert/strict";

import { formatNotificationDate } from "@/lib/notifications/notification-date";

const now = new Date(2026, 7, 10, 12, 0, 0);

assert.equal(formatNotificationDate("2026-08-10T09:30:00.000Z", now), "Hoy");
assert.equal(formatNotificationDate("2026-08-09T09:30:00.000Z", now), "Ayer");
assert.equal(formatNotificationDate("2026-07-08T09:30:00.000Z", now), "8 de Julio");
assert.equal(formatNotificationDate("2025-07-08T09:30:00.000Z", now), "8 de Julio 2025");
assert.equal(formatNotificationDate("fecha-invalida", now), "Hoy");
assert.equal(formatNotificationDate(null, now), "Hoy");

console.log("notification-date tests passed");
