import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "supabase/migrations/20261126200850_progress_photo_individual_sharing_v1.sql", "utf8",
);

test("un permiso privado y revocable sustituye el acceso implícito del reporte", () => {
  assert.match(source, /alter table private\.progress_photo_shares force row level security/);
  assert.match(source, /revoke all on private\.progress_photo_shares from public, anon, authenticated/);
  const reader = source.match(/create or replace function private\.can_read_progress_object\([\s\S]*?\$fn\$;/)?.[0] ?? "";
  assert.match(reader, /private\.can_coach_read_shared_photo\(asset\.id, v_actor\)/);
  assert.doesNotMatch(reader, /private\.progress_report_items|report\.kind = 'photos'/);
  const grant = source.match(/create function private\.can_coach_read_shared_photo\([\s\S]*?\$fn\$;/)?.[0] ?? "";
  assert.match(grant, /share\.revoked_at is null/);
  assert.match(grant, /episode\.coach_user_id = p_coach and episode\.ended_at is null/);
  const view = source.match(/create or replace function private\.progress_report_view\([\s\S]*?\$fn\$;/)?.[0] ?? "";
  assert.match(view, /private\.can_coach_read_shared_photo\(item\.asset_id, auth\.uid\(\)\)/);
});

test("el alumno escoge una foto propia y un envío reintentado no restaura una revocación", () => {
  const action = source.match(/create function public\.set_own_progress_photo_shared\([\s\S]*?\$fn\$;/)?.[0] ?? "";
  assert.match(action, /photo\.student_user_id = asset\.student_user_id/);
  assert.match(action, /asset\.student_user_id = v_student/);
  assert.match(action, /for update of episode/);
  const report = source.match(/create or replace function public\.create_own_progress_photo_report\([\s\S]*?\$fn\$;/)?.[0] ?? "";
  assert.match(report, /v_relationship\.episode_id <> p_expected_episode_id/);
  assert.match(report, /on conflict \(asset_id, relationship_episode_id\) do nothing/);
  assert.doesNotMatch(report, /set revoked_at = null/);
});
