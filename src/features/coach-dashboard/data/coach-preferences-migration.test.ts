import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Existing migration-history protocol requires one owning contract per migration.
// Runtime ownership/CAS/security are tested separately in the local PostgreSQL runner.
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260908201518_coach_dashboard_private_preferences.sql":
    "1dcba62528dac569acaa18d84437cd3a965d5ebd4274f9cfef1d1d20f2ba2cee",
} as const;

const filename = "20260908201518_coach_dashboard_private_preferences.sql";
const source = readFileSync(`supabase/migrations/${filename}`, "utf8");

test("new preference migration has exact ownership and does not mutate existing features", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[filename]);
  assert.doesNotMatch(source, /(?:insert into|update|delete from|alter table) public\.(?:training_|exercise_|coach_registrations|user_registrations|profiles)/i);
  assert.doesNotMatch(source, /(?:create|alter|drop)\s+policy/i);
  assert.doesNotMatch(source, /(?:create|alter|drop)\s+trigger/i);
  assert.doesNotMatch(source, /service_role|vault\.|auth\.jwt\(|user_metadata|http_post|net\./i);
});

test("only approved scalar RPC inputs and default-deny private storage are present", () => {
  const inputs = [...source.matchAll(/\bp_[a-z_]+\b/g)].map(([name]) => name);
  assert.deepEqual([...new Set(inputs)].sort(), ["p_expected_version", "p_monthly_fee_clp"]);
  assert.equal((source.match(/create table private\./g) ?? []).length, 2);
  assert.equal((source.match(/force row level security/g) ?? []).length, 2);
  assert.equal((source.match(/create function public\./g) ?? []).length, 3);
  assert.equal((source.match(/grant execute on function public\..* to authenticated;/g) ?? []).length, 3);
  assert.doesNotMatch(source, /grant (?:all|select|insert|update|delete).*\btable\b/i);
  assert.match(source, /auth\.uid\(\)/);
  assert.match(source, /from public\.coach_registrations/);
});
