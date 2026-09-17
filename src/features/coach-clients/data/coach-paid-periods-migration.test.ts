import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Migration-history protocol only. Executable Postgres is the primary evidence.
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260909054933_coach_paid_period_persistence.sql":
    "bd4f106772558062c856eb586e243c919adaaa4b1c7bf4e21bb5381674b79192",
} as const;

const filename = "20260909054933_coach_paid_period_persistence.sql";
const source = readFileSync(`supabase/migrations/${filename}`, "utf8");

test("paid-period migration has one frozen owning hash and no unrelated writes", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[filename]);
  assert.doesNotMatch(source, /(?:insert into|update|delete from|alter table) public\./i);
  assert.doesNotMatch(source, /(?:insert into|update|delete from|alter table) private\.coach_(?:invitations|relationship_episodes|invitation_operations)\b/i);
  assert.doesNotMatch(source, /\b(?:training_sessions|exercise_entries|training_cycles)\b|storage\.|service_role|vault\.|auth\.jwt\(|user_metadata|http_post|net\./i);
  assert.doesNotMatch(source, /(?:create|alter|drop)\s+(?:policy|trigger)/i);
});

test("four narrow RPCs expose only dates, episode references and explicit request/version IDs", () => {
  const rpcs = [...source.matchAll(/create function public\.([a-z_]+)\(([^)]*)\)/g)]
    .map(([, name, args]) => [name, args.replace(/\s+/g, " ").trim()]);
  assert.deepEqual(rpcs, [
    ["confirm_own_coach_paid_period", "p_episode_id uuid, p_start text, p_end text, p_expected_version uuid, p_request_id uuid"],
    ["correct_own_coach_paid_period", "p_episode_id uuid, p_period_id uuid, p_start text, p_end text, p_expected_version uuid, p_request_id uuid"],
    ["read_own_coach_paid_period", "p_episode_id uuid"],
    ["read_own_coach_paid_period_operation", "p_request_id uuid"],
  ]);
  assert.doesNotMatch(source, /create function public\.(?:accept|link|revoke|send|renew)/i);
  assert.match(source, /v_owner := private\.lock_coach_invitation_owner\(\)/);
  assert.match(source, /where e\.id = p_episode_id and e\.coach_user_id = v_owner for update/);
});

test("commercial storage is default-deny and separate from activity, delivery and mutable receipts", () => {
  assert.equal((source.match(/create table private\./g) ?? []).length, 3);
  assert.equal((source.match(/enable row level security/g) ?? []).length, 3);
  assert.equal((source.match(/force row level security/g) ?? []).length, 3);
  assert.doesNotMatch(source, /grant (?:all|select|insert|update|delete).*\btable\b/i);
  assert.doesNotMatch(source, /\braise\s+(?:notice|log|info|warning|debug)\b/i);
  assert.doesNotMatch(source, /(?:update|delete from) private\.coach_paid_period_operations\b/i);
  assert.match(source, /primary key \(coach_user_id, request_id\)/);
  assert.match(source, /previous_start date/);
  assert.match(source, /previous_end date/);
});

test("real SQL and two-connection races are required evidence, not regex substitutes", () => {
  const sql = readFileSync("supabase/tests/coach_paid_periods_local.sql", "utf8");
  const runner = readFileSync("supabase/tests/support/run_coach_paid_periods_postgres.mjs", "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^rollback;$/m);
  assert.match(sql, /RLS SELECT default deny despite grant/);
  assert.match(sql, /correction preserves period identity/);
  assert.match(sql, /civil DTO is independent of DateStyle and timezone/);
  assert.match(runner, /Promise\.allSettled/);
  assert.match(runner, /wait_event_type='Lock'/);
  assert.match(runner, /revocation wins and denies new write/);
  assert.match(runner, /payment-first retains commercial fact after unlink/);
  assert.match(runner, /-h '' -k \$\{socket\}/);
  assert.doesNotMatch(runner, /process\.env\.(?:DATABASE_URL|SUPABASE|PGHOST)/);
});
