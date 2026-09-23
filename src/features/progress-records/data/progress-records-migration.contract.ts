import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260923184225_progress_records_private_storage_reports_phase1.sql",
  "utf8",
);
const rollback = readFileSync(
  "supabase/diagnostics/qa/20260923_progress_records_phase1_qa_rollback.sql",
  "utf8",
);
const evaluationsMigration = readFileSync(
  "supabase/migrations/20260919225532_coach_student_evaluations.sql",
  "utf8",
);

// Updated after the SQL contract is finalized. PERF-06 discovers ownership in
// feature-local *-migration.contract.ts files without registering them globally.
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260923184225_progress_records_private_storage_reports_phase1.sql": "ee72147210ab601e335d519af0092d92513297e0b22fd5bf05c94ce26650060a",
} as const;

test("crea buckets privados con límites y MIME exactos", () => {
  assert.match(migration, /'progress-check-photos'[\s\S]*false,[\s\S]*20971520[\s\S]*array\['image\/jpeg', 'image\/png', 'image\/webp', 'image\/heic'\]/);
  assert.match(migration, /'progress-medical-documents'[\s\S]*false,[\s\S]*26214400[\s\S]*array\['application\/pdf'\]/);
  assert.doesNotMatch(migration, /on conflict \(id\) do update/);
});

test("tablas sensibles quedan privadas, con RLS forzada y sin grants directos", () => {
  for (const table of [
    "progress_assets", "progress_checks", "progress_check_photos", "progress_reports",
    "progress_report_items", "progress_report_reviews", "progress_report_delivery_intents",
    "progress_report_operations",
  ]) {
    assert.match(migration, new RegExp(`alter table private\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table private\\.${table} force row level security`));
  }
  assert.match(migration, /revoke all on table private\.progress_assets[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]*private\.progress_/i);
});

test("autorización reutilizable exige registro Alumno y relación activa para superficies visibles", () => {
  const authorization = migration.match(
    /create function private\.require_own_active_student_relationship\(\)[\s\S]*?\$require_own_active_student_relationship\$;/,
  )?.[0] ?? "";
  assert.match(authorization, /v_student uuid := auth\.uid\(\)/);
  assert.match(authorization, /public\.user_registrations/);
  assert.match(authorization, /episode\.student_user_id = v_student/);
  assert.match(authorization, /episode\.ended_at is null/);
  assert.match(authorization, /progress_active_relationship_required/);
});

test("reportes e ítems son snapshots inmutables y el destinatario se deriva en servidor", () => {
  assert.match(migration, /progress_reports_immutable/);
  assert.match(migration, /progress_report_items_immutable/);
  assert.match(migration, /p_asset_ids uuid\[\][\s\S]*p_message text[\s\S]*p_request_id uuid/);
  assert.doesNotMatch(migration, /create_own_progress_report\([\s\S]{0,300}p_(?:student|coach|owner|profile)_/);
  assert.match(migration, /v_relationship\.coach_user_id/);
  assert.match(migration, /with ordinality as selected\(asset_id, position\)/);
  assert.match(migration, /pending_implementation/);
});

test("Storage conserva ownership Alumno y exige reporte exacto más vínculo activo al Coach", () => {
  assert.match(migration, /create policy "progress records authorized read"[\s\S]*for select[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /create policy "progress records[^\"]*"[\s\S]{0,120}for (?:insert|update|delete)/i);
  const authorization = migration.match(
    /create function private\.can_read_progress_object[\s\S]*?\$can_read_progress_object\$;/,
  )?.[0] ?? "";
  assert.match(authorization, /asset\.student_user_id = v_actor/);
  assert.match(authorization, /private\.progress_report_items[\s\S]*report\.coach_user_id = v_actor/);
  assert.match(authorization, /item\.asset_id = asset\.id/);
  assert.match(authorization, /episode\.ended_at is null/);
  assert.match(authorization, /asset\.kind <> 'photo' or asset\.sanitized_at is not null/);
  assert.doesNotMatch(migration, /createSignedUrl|signed url|publicUrl|service_role/i);
});

test("MIME, extensión, tamaño y path opaco están cerrados también en SQL", () => {
  assert.match(migration, /mime_type = 'image\/jpeg' and extension in \('jpg', 'jpeg'\)/);
  assert.match(migration, /mime_type = 'image\/png' and extension = 'png'/);
  assert.match(migration, /mime_type = 'image\/webp' and extension = 'webp'/);
  assert.match(migration, /mime_type = 'image\/heic' and extension = 'heic'/);
  assert.match(migration, /mime_type = 'application\/pdf'/);
  assert.match(migration, /byte_size <= 20971520/);
  assert.match(migration, /byte_size <= 26214400/);
  assert.match(migration, /object_name text not null unique/);
  assert.match(migration, /object_name ~ '\^\[0-9a-f\]/);
});

test("Alumno conserva sólo evaluaciones completadas y Coach/notificaciones exigen vínculo activo", () => {
  const identity = migration.match(
    /create or replace function private\.student_evaluation_identity[\s\S]*?\$student_evaluation_identity\$;/,
  )?.[0] ?? "";
  assert.match(identity, /public\.user_registrations/);
  assert.doesNotMatch(identity, /require_own_active_student_relationship/);

  for (const functionName of [
    "list_own_coach_evaluation_assignments", "list_own_evaluation_notifications",
    "mark_own_evaluation_notifications_read",
  ]) {
    const definition = migration.match(new RegExp(
      `create or replace function (?:private|public)\\.${functionName}[\\s\\S]*?\\$${functionName}\\$;`,
    ))?.[0] ?? "";
    assert.match(definition, /episode\.ended_at is null/);
  }
  for (const functionName of ["student_evaluation_view", "list_own_student_evaluations"]) {
    const definition = migration.match(new RegExp(
      `create or replace function (?:private|public)\\.${functionName}[\\s\\S]*?\\$${functionName}\\$;`,
    ))?.[0] ?? "";
    assert.match(definition, /episode\.ended_at is null or response\.state = 'completed'/);
    assert.match(definition, /assignment\.student_user_id = (?:p_student_id|v_student)/);
  }
  assert.match(migration, /Phase 2 must hide the complete "Mis evaluaciones" section/);
  assert.match(migration, /do not apply this migration to QA before/);
});

test("escrituras de evaluaciones conservan su gate de episodio activo", () => {
  for (const functionName of ["save_own_evaluation_draft", "submit_own_evaluation"]) {
    const definition = evaluationsMigration.match(new RegExp(
      `create function public\\.${functionName}[\\s\\S]*?\\n\\$\\$;`,
    ))?.[0] ?? "";
    assert.match(definition, /assignment\.student_user_id = v_student/);
    assert.match(definition, /episode\.ended_at is null/);
    assert.match(definition, /evaluation_assignment_forbidden/);
  }
});

test("no amplía alcance a UI, entrenamiento, deploy ni correo real", () => {
  assert.doesNotMatch(migration, /training_sessions|exercise_entries|organizatech-app|Deno\.serve|provider_message_id/i);
  assert.doesNotMatch(migration, /state text[^;]*sent|status text[^;]*sent/i);
});

test("rollback QA restaura evaluaciones y exige buckets vacíos sin borrar objetos directo", () => {
  assert.match(rollback, /create or replace function private\.student_evaluation_identity/);
  assert.match(rollback, /episode\.ended_at is null or response\.state = 'completed'/);
  assert.match(rollback, /progress_records_rollback_requires_empty_buckets/);
  assert.match(rollback, /delete from storage\.buckets/);
  assert.doesNotMatch(rollback, /delete from storage\.objects|truncate storage\.objects/i);
  assert.match(rollback, /including completed historical records/);
  assert.match(rollback, /rollback must not[\s\S]*restore access to a Coach after unlinking/);
  assert.doesNotMatch(rollback, /create or replace function public\.list_own_coach_evaluation_assignments/);
  assert.doesNotMatch(rollback, /create or replace function public\.list_own_evaluation_notifications/);
  assert.doesNotMatch(rollback, /create or replace function public\.mark_own_evaluation_notifications_read/);
  assert.match(rollback, /drop policy if exists "progress records authorized read"/);
  assert.match(rollback, /drop policy if exists "progress records active participant read"/);
});
