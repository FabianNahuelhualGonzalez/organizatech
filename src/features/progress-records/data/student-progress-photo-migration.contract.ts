import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260930163231_progress_photo_student_gateway.sql", "utf8");
const phaseOne = readFileSync("supabase/migrations/20260923184225_progress_records_private_storage_reports_phase1.sql", "utf8");

test("RPCs del Alumno mantienen identidad SQL, grants acotados y search_path cerrado", () => {
  for (const name of ["list_own_progress_photo_uploads", "list_own_progress_photos",
    "get_own_progress_photo", "list_own_progress_checks", "create_own_progress_check"]) {
    const functionSql = sql.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$${name}\\$;`))?.[0] ?? "";
    assert.match(functionSql, /security definer set search_path = ''/);
    assert.doesNotMatch(functionSql, /p_(?:student|coach|owner|profile|bucket|object|path)_/);
  }
  assert.match(sql, /v_student uuid := auth\.uid\(\)/);
  assert.match(sql, /public\.user_registrations/);
  assert.match(sql, /private\.require_own_active_student_relationship\(\)/);
  assert.match(sql, /revoke all on function public\.list_own_progress_photo_uploads[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.list_own_progress_photo_uploads[\s\S]*to authenticated/);
  assert.doesNotMatch(sql, /grant .* to (?:anon|public)/i);
});

test("publisher deja la foto sin check; cada asset y pose conservan unicidad en su primer check", () => {
  assert.match(phaseOne, /photo_asset_id uuid not null unique/);
  assert.match(phaseOne, /unique \(check_id, pose\)/);
  assert.doesNotMatch(sql, /drop constraint progress_check_photos_(?:photo_asset_id_key|check_id_pose_key)/);
  const publisher = sql.match(/create or replace function public\.publish_verified_progress_photo\([\s\S]*?\$publish_verified_progress_photo\$;/)?.[0] ?? "";
  assert.match(publisher, /security definer set search_path = ''/);
  assert.match(publisher, /private\.progress_photo_publisher_identity\(\)/);
  assert.match(publisher, /insert into private\.progress_assets/);
  assert.doesNotMatch(publisher, /insert into private\.progress_checks|insert into private\.progress_check_photos/);
  const createCheck = sql.match(/create function public\.create_own_progress_check\([\s\S]*?\$create_own_progress_check\$;/)?.[0] ?? "";
  assert.match(createCheck, /upload\.final_asset_id = asset\.id/);
  assert.match(createCheck, /upload\.state = 'published'/);
  assert.match(createCheck, /count\(distinct upload\.pose\)/);
  assert.match(createCheck, /not exists \(select 1 from private\.progress_check_photos/);
  assert.match(createCheck, /select v_check_id, asset\.id, v_relationship\.student_user_id, upload\.pose/);
  assert.doesNotMatch(createCheck, /p_pose|p_bucket|p_object|p_student|p_coach/);
});

test("historial es propio y reportes conservan sus contratos previos", () => {
  assert.match(sql, /upload\.student_user_id = v_student/);
  assert.match(sql, /asset\.student_user_id = v_student/);
  assert.match(sql, /progress_check\.student_user_id = v_student/);
  assert.match(sql, /asset\.student_user_id = v_relationship\.student_user_id/);
  assert.match(sql, /asset\.available_at is not null and asset\.sanitized_at is not null/);
  assert.match(sql, /'checkId', \(select check_photo\.check_id from private\.progress_check_photos/);
  assert.doesNotMatch(sql, /create or replace function public\.create_own_progress_report/);
  assert.doesNotMatch(sql, /create policy .*coach/i);
});
