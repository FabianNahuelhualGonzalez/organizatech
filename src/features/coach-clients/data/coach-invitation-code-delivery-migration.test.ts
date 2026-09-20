import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const filename = "20260917120000_coach_invitation_code_delivery.sql";
const source = readFileSync(`supabase/migrations/${filename}`, "utf8");
const acceptance = readFileSync("supabase/migrations/20260917000000_student_coach_link_acceptance.sql", "utf8");
const invitationBase = readFileSync("supabase/migrations/20260909044235_coach_invitation_persistence.sql", "utf8");

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260917120000_coach_invitation_code_delivery.sql":
    "742ded67bb4905c7ea60f2db000c2539bc887d88390e75af3b37f4b1e5ca2ad3",
} as const;
const HASH = POST_PERF_06_MIGRATION_OWNERSHIP[filename];

test("delivery migration is frozen, transactional and additive", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"), HASH);
  assert.match(source, /^begin;$/m);
  assert.match(source, /^commit;$/m);
  assert.doesNotMatch(source, /\b(?:training_sessions|exercise_entries|training_cycles)\b/i);
  assert.doesNotMatch(source, /service_role|vault\.|http_post|net\.http|\braise\s+(?:notice|log|info|debug|warning)\b/i);
});

test("private ledgers are FORCE RLS/default-deny and writes have exact wrappers", () => {
  for (const table of ["coach_invitation_created_notifications", "coach_invitation_email_deliveries"]) {
    assert.match(source, new RegExp(`alter table private\\.${table} enable row level security`));
    assert.match(source, new RegExp(`alter table private\\.${table} force row level security`));
  }
  assert.match(source, /revoke all on table private\.coach_invitation_created_notifications,[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(source, /create policy|grant (?:select|insert|update|delete|all) on table/i);
  assert.equal((source.match(/security definer/g) ?? []).length, 5);
  assert.equal((source.match(/set search_path = ''/g) ?? []).length, 7);
  assert.match(source, /revoke all on function public\.claim_own_coach_invitation_emails\(text, uuid, boolean, uuid\)/);
  assert.match(source, /grant execute on function public\.claim_own_coach_invitation_emails\(text, uuid, boolean, uuid\),[\s\S]*to authenticated/);
  assert.match(source, /revoke all on function[\s\S]*public\.own_coach_invitation_email_delivery_complete\(text, uuid\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(source, /grant execute[\s\S]*to (?:public|anon)/);
});

test("aggregate status exposes no delivery data and remains owner/current-generation scoped", () => {
  const status = source.slice(source.indexOf("create function public.own_coach_invitation_email_delivery_complete"));
  assert.match(status, /private\.verify_transactional_email_capability\(p_capability\)/);
  assert.match(status, /v_coach_user_id := private\.lock_coach_invitation_owner\(\)/);
  assert.match(status, /invitation\.coach_user_id = v_coach_user_id/);
  assert.match(status, /delivery\.generation = invitation\.generation/);
  assert.match(status, /pg_catalog\.count\(distinct delivery\.audience\) = 2/);
  assert.doesNotMatch(status, /returns table|recipient_email|invitation_code\s+text/);
});

test("code creation atomically queues one bell and two deduplicated deliveries", () => {
  assert.match(source, /after insert on private\.coach_invitation_operations/);
  assert.match(source, /new\.action not in \('create', 'resend', 'regenerate'\)/);
  assert.match(source, /unique \(invitation_id, generation\)/);
  assert.match(source, /unique \(coach_user_id, request_id, audience\)/);
  assert.match(source, /'student',[\s\S]*'coach'/);
  assert.match(source, /'Código de vinculación creado'/);
  assert.match(source, /'Tu código de vinculación fue creado y vence en 7 días\.'/);
  const notificationInsert = source.slice(
    source.indexOf("insert into private.coach_invitation_created_notifications"),
    source.indexOf("insert into private.coach_invitation_email_deliveries"),
  );
  assert.doesNotMatch(notificationInsert, /invitation_code|v_invitation\.recipient_email/);
  assert.doesNotMatch(source, /jsonb_build_object\([^)]*(?:invitation_code|recipient_email_snapshot)/i);
});

test("claim is owner/capability bound, bounded and never accepts code, email or ownership from caller", () => {
  assert.match(source, /claim_own_coach_invitation_emails\(\s*p_capability text,\s*p_request_id uuid/);
  assert.doesNotMatch(source, /claim_own_coach_invitation_emails\([\s\S]*?p_(?:code|email|owner|coach_user_id)/);
  assert.match(source, /private\.verify_transactional_email_capability\(p_capability\)/);
  assert.match(source, /v_coach_user_id := private\.lock_coach_invitation_owner\(\)/);
  assert.match(source, /delivery\.coach_user_id = v_coach_user_id/);
  assert.match(source, /p_request_id is null or operation\.request_id = p_request_id/);
  assert.match(source, /p_invitation_id is null or operation\.invitation_id = p_invitation_id/);
  assert.match(source, /\(case when p_request_id is not null then 1 else 0 end\)[\s\S]*\(case when p_recover then 1 else 0 end\)[\s\S]*\(case when p_invitation_id is not null then 1 else 0 end\)[\s\S]*<> 1/);
  assert.match(source, /operation\.state = 'reserved'/);
  assert.match(source, /invitation\.state = 'pending'/);
  assert.match(source, /invitation\.expires_at > pg_catalog\.clock_timestamp\(\)/);
  assert.match(source, /invitation\.generation = delivery\.generation/);
  assert.match(source, /prepared\.recipient_email_snapshot,[\s\S]*prepared\.recipient_email,/);
  assert.match(source, /for update of delivery skip locked[\s\S]*limit 2/);
  assert.match(source, /delivery\.recipient_email_snapshot <> v_coach_email/);
  assert.match(source, /delivery\.audience <> 'coach' or delivery\.recipient_email_snapshot = v_coach_email/);
});

test("provider failures never mutate or regenerate the invitation and retries are bounded", () => {
  const completion = source.slice(source.indexOf("create function public.complete_own_coach_invitation_email"));
  assert.doesNotMatch(completion, /update private\.coach_invitations|new_coach_invitation_code|mutate_coach_invitation/);
  assert.match(source, /attempt_count smallint[\s\S]*between 0 and 5/);
  assert.match(source, /delivery\.attempt_count < 5/);
  assert.match(source, /interval '1 minute'/);
  assert.match(source, /interval '5 minutes'/);
  assert.match(source, /interval '30 minutes'/);
  assert.match(source, /interval '2 hours'/);
  assert.match(source, /delivery\.claimed_at <= pg_catalog\.clock_timestamp\(\) - interval '10 minutes'/);
  assert.match(invitationBase, /limit 3[\s\S]*v_times\[3\] \+ interval '24 hours'/);
  assert.match(invitationBase, /v_inv\.issued_at \+ interval '60 seconds'/);
});

test("existing atomic acceptance and its two bells/two emails remain intact", () => {
  assert.equal(createHash("sha256").update(acceptance).digest("hex"),
    "2b41770fd7a06287f3dc5a5876038ceae41d1fe456a26729a24a68fa496f8fa0");
  assert.match(acceptance, /v_invitation\.recipient_email <> v_identity\.student_email/);
  assert.match(invitationBase, /create unique index coach_relationship_one_active_student/);
  assert.match(acceptance, /v_episode\.id, v_identity\.student_user_id, 'usuario', 'student', 'ready'/);
  assert.match(acceptance, /v_episode\.id, v_invitation\.coach_user_id, 'coach', 'coach', 'ready'/);
  assert.match(acceptance, /v_student_idempotency, 'pending'/);
  assert.match(acceptance, /v_coach_idempotency, 'pending'/);
});
