import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../../../supabase/migrations/20261108035032_user_flexible_training_schedule_v1.sql", import.meta.url), "utf8");

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
