import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260924140000_progress_photo_staging_preparation.sql", "utf8",
);
const worker = readFileSync(
  "src/features/progress-records/server/supabase-progress-photo-publisher.ts", "utf8",
);

test("staging is private, bounded and only the server chooses opaque paths", () => {
  assert.match(sql, /'progress-check-staging', 'progress-check-staging', false, 20971520/);
  assert.match(sql, /private\.require_own_active_student_relationship\(\)/);
  assert.match(sql, /v_name := gen_random_uuid\(\)::text \|\| '\/' \|\| gen_random_uuid\(\)::text/);
  assert.match(sql, /upload\.student_user_id = v_student/);
  assert.match(sql, /episode\.ended_at is null/);
  assert.doesNotMatch(sql, /p_(?:student|coach|owner|user|object|path|asset|report)_id/);
});

test("Auth Hook grants the publisher role only to an active private technical principal", () => {
  const hook = sql.match(/create function private\.progress_photo_access_token_hook\(event jsonb\)[\s\S]*?\$progress_photo_access_token_hook\$;/)?.[0] ?? "";
  assert.match(sql, /create table private\.progress_photo_principals[\s\S]*auth_user_id uuid primary key references auth\.users\(id\)/);
  assert.match(sql, /state text not null check \(state in \('active', 'revoked'\)\)/);
  assert.match(sql, /create unique index progress_photo_principals_one_active\s+on private\.progress_photo_principals \(state\) where state = 'active'/);
  assert.match(sql, /alter table private\.progress_photo_principals force row level security/);
  assert.match(hook, /security invoker/);
  assert.doesNotMatch(hook, /security definer|user_metadata|app_metadata/i);
  assert.match(hook, /current_user <> 'supabase_auth_admin'/);
  assert.match(hook, /principal\.auth_user_id = v_user_id and principal\.state = 'active'/);
  assert.match(hook, /if not exists[\s\S]*return event/);
  assert.match(hook, /jsonb_set\(v_claims, '\{role\}', '"progress_photo_publisher"'::jsonb\)/);
  assert.match(hook, /least\(v_expires_at, v_issued_at \+ 900\)/);
  assert.match(sql, /grant select on table private\.progress_photo_principals to supabase_auth_admin/);
  assert.match(sql, /grant execute on function private\.progress_photo_access_token_hook\(jsonb\)[\s\S]*to supabase_auth_admin/);
  assert.match(sql, /revoke all on function private\.progress_photo_access_token_hook\(jsonb\)[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /principal\.auth_user_id = auth\.uid\(\) and principal\.state = 'active'/);
});

test("worker authenticates per pass without a fixed publisher token or project signing key", () => {
  assert.match(worker, /auth\.signInWithPassword\(/);
  assert.match(worker, /auth\.getClaims\(publisherJwt\)/);
  assert.match(worker, /verified\?\.claims\.role !== "progress_photo_publisher"/);
  assert.match(worker, /persistSession: false, autoRefreshToken: false/);
  const forbiddenNames = [
    ["PROGRESS_PHOTO_PUBLISHER", "JWT"].join("_"),
    ["JWT", "SECRET"].join("_"),
    "service_role", "SIGNING_KEY",
  ];
  for (const name of forbiddenNames) assert.doesNotMatch(worker, new RegExp(name));
});

test("browser queues only own staging; scoped publisher alone may publish", () => {
  assert.match(sql, /for insert to authenticated with check/);
  assert.match(sql, /for select to authenticated using/);
  for (const operation of ["insert", "select", "update", "delete"]) {
    assert.match(sql, new RegExp(`as restrictive for ${operation} to public`));
  }
  assert.match(sql, /bucket_id not in \('progress-check-staging', 'progress-check-photos'\)/);
  assert.match(sql, /create role progress_photo_publisher nologin nobypassrls/);
  assert.match(sql, /request\.jwt\.claim\.role', true\) = 'progress_photo_publisher'/);
  assert.match(sql, /upload\.state = 'pending'[\s\S]*upload\.expires_at > clock_timestamp\(\)/);
  assert.match(sql, /private\.publisher_final_candidate\(bucket_id, name, true\)/);
  assert.match(sql, /upload\.state = 'queued'[\s\S]*for update of upload skip locked/);
  assert.match(sql, /upload\.state in \('pending', 'queued', 'processing'\)[\s\S]*>= 3/);
  assert.match(sql, /exists \(select 1 from storage\.objects object[\s\S]*object\.name = v_upload\.final_object_name/);
  assert.match(sql, /exists \(select 1 from storage\.objects object[\s\S]*object\.name = v_upload\.object_name/);
  assert.match(sql, /grant execute on function public\.claim_progress_photo_for_verification\(\)[\s\S]*to progress_photo_publisher/);
  assert.doesNotMatch(sql, /grant execute on function public\.publish_verified_progress_photo[^;]*to authenticated/);
});
