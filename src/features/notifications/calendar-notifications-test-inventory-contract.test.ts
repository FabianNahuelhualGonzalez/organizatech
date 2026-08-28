import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = readFileSync("package.json", "utf8");
const expected = [
  "supabase/functions/_shared/calendar-reminders/templates.test.ts",
  "supabase/functions/send-calendar-reminders/handler.test.ts",
  "src/features/notifications/calendar-notifications-migration-contract.test.ts",
  "src/features/notifications/calendar-notifications-integration-contract.test.ts",
  "src/features/notifications/calendar-notifications-test-inventory-contract.test.ts",
  "src/features/notifications/data/supabase-calendar-notifications-repository.test.ts",
] as const;

test("cada contrato Calendario Notifications está registrado exactamente una vez", () => {
  for (const path of expected) {
    assert.equal(packageJson.split(path).length - 1, 1, `${path} debe aparecer exactamente una vez`);
  }
});
