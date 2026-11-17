import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20261108035032_user_flexible_training_schedule_v1.sql": "cc3f33a73fb364610d4efa5da3206a126350dc838041bc527c504a2813af72bf",
} as const;

const filename = "20261108035032_user_flexible_training_schedule_v1.sql";
const sql = readFileSync(new URL(`../../../../supabase/migrations/${filename}`, import.meta.url), "utf8");

assert.equal(createHash("sha256").update(sql).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[filename]);

test("la migración limita el modo flexible a Usuario y conserva el snapshot versionado", () => {
  assert.match(sql, /p_portal_scope <> 'usuario'/);
  assert.match(sql, /v_day_code <> \(array\[/);
  assert.match(sql, /version\.plan_payload \? 'scheduleMode'/);
  assert.match(sql, /jsonb_build_object\('scheduleMode'/);
});

test("las repeticiones del mismo día no desprotegen los planes de días fijos", () => {
  assert.match(sql, /is_flexible_schedule boolean not null default false/);
  assert.match(sql, /and not is_flexible_schedule/);
  assert.match(sql, /if not v_flexible_schedule and exists/);
  assert.match(sql, /plan_snapshot #>> '\{plan,scheduleMode\}'/);
  assert.match(sql, /grant execute on function public\.create_training_session_with_cycle_entries\([\s\S]*?\) to authenticated/);
});
