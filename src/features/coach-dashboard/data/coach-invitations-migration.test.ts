import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Existing repository migration-history protocol: one exact owning contract.
// Primary SQL security/concurrency evidence lives in the real Postgres runner.
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260909044235_coach_invitation_persistence.sql":
    "0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc",
  "20260909085022_coach_pending_invitations_list.sql":
    "30190a102caf00fde6f687b9191f0f9ca1a1c5fd429e15e75dcebad08acc3590",
  "20260909100428_coach_active_relationships_list.sql":
    "0f46a48418e1fed82aadd9e47bd3c9da994c1c7f762004b371763ac2411a4085",
} as const;

const filename = "20260909044235_coach_invitation_persistence.sql";
const source = readFileSync(`supabase/migrations/${filename}`, "utf8");

test("active list migration has its own exact registration in the global migration inventory", () => {
  const activeFilename = "20260909100428_coach_active_relationships_list.sql";
  const activeSource = readFileSync(`supabase/migrations/${activeFilename}`, "utf8");
  assert.equal(createHash("sha256").update(activeSource).digest("hex"),
    POST_PERF_06_MIGRATION_OWNERSHIP[activeFilename]);
});

test("pending list migration has its own exact registration in the global migration inventory", () => {
  const pendingFilename = "20260909085022_coach_pending_invitations_list.sql";
  const pendingSource = readFileSync(`supabase/migrations/${pendingFilename}`, "utf8");
  assert.equal(createHash("sha256").update(pendingSource).digest("hex"),
    POST_PERF_06_MIGRATION_OWNERSHIP[pendingFilename]);
});

test("invitation migration has a frozen owning hash independent from preferences", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[filename]);
  assert.doesNotMatch(source, /(?:insert into|update|delete from|alter table) public\.(?:training_|exercise_|coach_registrations|user_registrations|profiles)/i);
  assert.doesNotMatch(source, /(?:create|alter|drop)\s+(?:policy|trigger)/i);
  assert.doesNotMatch(source, /service_role|vault\.|auth\.jwt\(|user_metadata|http_post|net\./i);
});

test("public invitation and revocation RPCs accept only their exact scalar allowlists", () => {
  const rpcs = [...source.matchAll(/create function public\.([a-z_]+)\(([^)]*)\)/g)]
    .map(([, name, args]) => [name, args.replace(/\s+/g, " ").trim()]);
  assert.deepEqual(rpcs, [
    ["create_own_coach_invitation", "p_recipient_email text, p_request_id uuid"],
    ["resend_own_coach_invitation", "p_invitation_id uuid, p_request_id uuid"],
    ["regenerate_own_coach_invitation", "p_invitation_id uuid, p_request_id uuid"],
    ["cancel_own_coach_invitation", "p_invitation_id uuid, p_request_id uuid"],
    ["revoke_own_coach_relationship", "p_episode_id uuid, p_request_id uuid"],
    ["read_own_coach_invitation", "p_invitation_id uuid"],
    ["read_own_coach_invitation_operation", "p_request_id uuid"],
    ["read_own_coach_relationship", "p_episode_id uuid"],
  ]);
  assert.doesNotMatch(source, /create function public\.(?:accept|link|create.*relationship)/i);
});

test("storage stays private, default-deny and separate from delivery or training", () => {
  assert.equal((source.match(/create table private\./g) ?? []).length, 3);
  assert.equal((source.match(/enable row level security/g) ?? []).length, 3);
  assert.equal((source.match(/force row level security/g) ?? []).length, 3);
  assert.doesNotMatch(source, /grant (?:all|select|insert|update|delete).*\btable\b/i);
  assert.doesNotMatch(source, /\braise\s+(?:notice|log|info|warning|debug)\b/i);
  assert.doesNotMatch(source, /from\s+auth\.users/i);
  assert.match(source, /state text not null check \(state in \('reserved', 'completed', 'cancelled'\)\)/);
  assert.match(source, /create unique index coach_relationship_one_active_student .* where ended_at is null/);
});

test("executable SQL evidence is present and isolated, not replaced by source checks", () => {
  const sql = readFileSync("supabase/tests/coach_invitations_local.sql", "utf8");
  const runner = readFileSync("supabase/tests/support/run_coach_invitations_postgres.mjs", "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^rollback;$/m);
  assert.match(sql, /RLS insert default deny despite grant/);
  assert.match(sql, /one active Coach per student/);
  assert.match(runner, /Promise\.allSettled/);
  assert.match(runner, /daily fifty-first blocked/);
  assert.match(runner, /regeneration consumes creation quota/);
  assert.match(runner, /-h '' -k \$\{socket\}/);
  assert.doesNotMatch(runner, /process\.env\.(?:DATABASE_URL|SUPABASE|PGHOST)/);
});
