import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20261005000000_coach_commercial_portfolio_v1.sql":
    "aef9b4856ba28c15cf67467e83edfbe6160a31e78a85f5eb84fe486daa573910",
} as const;
const filename = "20261005000000_coach_commercial_portfolio_v1.sql";
const source = readFileSync(`supabase/migrations/${filename}`, "utf8");

test("commercial migration owns its frozen history and avoids unrelated tables", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[filename]);
  assert.doesNotMatch(source, /(?:insert into|update|delete from|alter table) public\./i);
  assert.doesNotMatch(source, /\b(?:training_sessions|exercise_entries|training_cycles)\b|storage\.|service_role|vault\.|auth\.jwt\(/i);
  assert.equal((source.match(/enable row level security/g) ?? []).length, 3);
  assert.equal((source.match(/force row level security/g) ?? []).length, 3);
  assert.doesNotMatch(source, /\bcreate policy\b|\braise\s+(?:notice|log|info|warning|debug)\b/i);
  assert.match(source, /v_owner := private\.lock_coach_invitation_owner\(\)/);
  assert.match(source, /where id = p_episode_id and coach_user_id = v_owner for update/);
  assert.match(source, /primary key \(coach_user_id, request_id\)/);
  assert.match(source, /v_period\.starts_on <= v_today/);
  assert.match(source, /v_period\.paid_at is not null/);
  assert.doesNotMatch(source, /(?:update|delete from) private\.coach_commercial_operations\b/i);
});

test("commercial RPC API never accepts coach or student ownership", () => {
  const rpcs = [...source.matchAll(/create function public\.([a-z_]+)\(([\s\S]*?)\)\s*returns jsonb/g)]
    .map(([, name, args]) => [name, args.replace(/\s+/g, " ").trim()]);
  assert.deepEqual(rpcs.map(([name]) => name), [
    "write_own_coach_commercial", "read_own_coach_commercial", "read_own_coach_commercial_operation",
  ]);
  for (const [, args] of rpcs) assert.doesNotMatch(args, /coach_user_id|student_user_id|owner_id|profile_id/i);
  const runner = readFileSync("supabase/tests/support/run_coach_commercial_postgres.mjs", "utf8");
  assert.match(runner, /Promise\.all/);
  assert.match(runner, /foreign receipt hidden/);
  assert.match(runner, /future correction preserves booked history/);
  assert.doesNotMatch(runner, /process\.env\.(?:DATABASE_URL|SUPABASE|PGHOST)/);
});
