import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Existing migration-history ownership protocol; not a substitute for real SQL tests.
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260909120120_coach_invitation_generation_binding.sql":
    "dc8d07e9f1eb25b72b770e041a17e4d3a8367fb461d2ba666f7297434498c3de",
} as const;
const filename = "20260909120120_coach_invitation_generation_binding.sql";
const source = readFileSync(`supabase/migrations/${filename}`, "utf8");
test("bound invitation migration has one frozen owning registration", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[filename]);
  assert.match(source, /^begin;$/m); assert.match(source, /^commit;$/m);
});
test("generation RPCs are additive and have exact scalar allowlists", () => {
  const rpcs = [...source.matchAll(/create function public\.([a-z_]+)\(([^)]*)\)/g)]
    .map(([, name, args]) => [name, args.replace(/\s+/g, " ").trim()]);
  assert.deepEqual(rpcs, [
    ["resend_own_coach_invitation_for_generation", "p_invitation_id uuid, p_expected_generation integer, p_request_id uuid"],
    ["regenerate_own_coach_invitation_for_generation", "p_invitation_id uuid, p_expected_generation integer, p_request_id uuid"],
    ["read_own_coach_invitation_generation_operation", "p_request_id uuid"],
  ]);
  assert.equal((source.match(/create function private\./g) ?? []).length, 2);
  assert.doesNotMatch(source, /create or replace|\b(?:alter|drop|truncate)\s|create\s+(?:table|index|policy|trigger|role|extension)\b/i);
  assert.doesNotMatch(source, /(?:insert into|update|delete from) public\./i);
  assert.doesNotMatch(source, /service_role|vault\.|auth\.jwt\(|user_metadata|http_post|net\./i);
});
test("new functions keep empty search paths and revoke default execute", () => {
  assert.equal((source.match(/security definer set search_path = ''/g) ?? []).length, 3);
  assert.equal((source.match(/security invoker set search_path = ''/g) ?? []).length, 2);
  assert.match(source, /revoke all on function private\.[\s\S]+?from public, anon, authenticated;/);
  assert.match(source, /revoke all on function public\.[\s\S]+?from public, anon, authenticated;/);
  assert.match(source, /grant execute on function public\.[\s\S]+?to authenticated;/);
  assert.doesNotMatch(source, /grant execute on function private\./);
});
test("runtime SQL evidence covers real lock waits, rollback and legacy separation", () => {
  const sql = readFileSync("supabase/tests/coach_invitation_generation_local.sql", "utf8");
  const runner = readFileSync("supabase/tests/support/run_coach_invitation_generation_postgres.mjs", "utf8");
  assert.match(sql, /^begin;$/m); assert.match(sql, /^rollback;$/m);
  assert.match(sql, /FORCE RLS has no allow policy/); assert.match(sql, /legacy cannot adopt bound request/);
  assert.match(sql, /2147483647/); assert.match(sql, /create trigger/);
  assert.match(runner, /wait_event_type='Lock'/);
  assert.match(runner, /explicit transaction rollback leaves no receipt/);
  assert.match(runner, /read observes only committed bound receipt/);
  assert.match(runner, /-h '' -k \$\{socket\}/);
  assert.match(runner, /0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc/);
  assert.doesNotMatch(runner, /process\.env\.(?:DATABASE_URL|SUPABASE|PGHOST)|fetch\(/);
});
