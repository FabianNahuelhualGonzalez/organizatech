import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261002153205_progress_photos_v11_reports_delivery.sql", "utf8");
const base = readFileSync("supabase/migrations/20260923184225_progress_records_private_storage_reports_phase1.sql", "utf8");
const publication = readFileSync("supabase/migrations/20261002014402_progress_photo_automatic_publication.sql", "utf8");
const staging = readFileSync("supabase/migrations/20261001230633_progress_photo_original_staging_jpeg_publication.sql", "utf8");
const publisher = readFileSync("src/features/progress-records/server/progress-photo-finalizer.ts", "utf8");
const gateway = readFileSync("src/features/progress-records/data/student-progress-photo-gateway.ts", "utf8");
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20261002153205_progress_photos_v11_reports_delivery.sql": "b65fbe586a443c7df63dc02cd45217d44491bbb0ec79fbd39cad19a798b5a2b0",
} as const;

test("v1.1 report migration is registered with its exact local hash", () => {
  assert.equal(createHash("sha256").update(sql).digest("hex"),
    POST_PERF_06_MIGRATION_OWNERSHIP["20261002153205_progress_photos_v11_reports_delivery.sql"]);
});

test("v1.1 report delivery has private durable notification and email records", () => {
  for (const table of ["progress_report_notifications", "progress_report_email_deliveries"]) {
    assert.match(sql, new RegExp(`create table private\\.${table}`));
    assert.match(sql, new RegExp(`alter table private\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`alter table private\\.${table} force row level security`));
    assert.match(sql, new RegExp(`revoke all on private\\.${table} from public, anon, authenticated`));
  }
  assert.match(sql, /report_id uuid not null unique references private\.progress_reports/);
  assert.match(sql, /create trigger progress_report_delivery_materialized/);
  assert.match(sql, /if v_report\.kind <> 'photos' then return new/);
  assert.match(sql, /new\.channel = 'in_app'/);
  assert.match(sql, /new\.channel = 'email'/);
  assert.doesNotMatch(sql, /service_role|createSignedUrl|publicUrl/i);
});

test("report recipient, email and ownership are resolved on server", () => {
  assert.match(sql, /private\.require_own_active_student_relationship\(\)/);
  assert.match(sql, /v_relationship\.episode_id <> p_expected_episode_id/);
  assert.match(sql, /public\.create_own_progress_report\('photos', p_asset_ids, p_message, p_request_id\)/);
  assert.match(sql, /auth\.users auth_user[\s\S]*auth_user\.id = v_report\.coach_user_id/);
  assert.match(sql, /private\.coach_public_name\(v_report\.coach_user_id\)/);
  assert.match(sql, /delivery\.student_user_id = v_student/);
  assert.match(sql, /report\.coach_user_id = v_coach/);
  assert.match(sql, /episode\.ended_at is null/);
  for (const signature of sql.matchAll(/create(?: or replace)? function public\.create_own_progress_(?:photo_)?report\(([\s\S]*?)\) returns jsonb/g)) {
    assert.doesNotMatch(signature[1], /p_(?:student|coach|owner|profile|email|bucket|object)_id/);
  }
});

test("email status requires provider acceptance and exact report photos remain private", () => {
  assert.match(sql, /status in \('pending', 'sending', 'sent', 'failed', 'ambiguous'\)/);
  assert.match(sql, /status = 'sent' and provider_message_id is not null and sent_at is not null/);
  assert.match(sql, /attempt_token = p_attempt_token/);
  assert.match(sql, /delivery\.status = 'sent'/);
  assert.match(sql, /notification\.id is not null/);
  assert.match(base, /private\.progress_report_items[\s\S]*item\.asset_id = asset\.id/);
  assert.match(base, /episode\.ended_at is null/);
  assert.match(base, /progress records authorized read/);
});

test("new photo reports reject an entire batch unless every asset is live, owned and published", () => {
  const create = sql.match(/create or replace function public\.create_own_progress_report\([\s\S]*?\$create_own_progress_report\$;/)?.[0] ?? "";
  assert.match(create, /cardinality\(p_asset_ids\) <>[\s\S]*count\(distinct selected\.asset_id\)/);
  assert.match(create, /asset\.student_user_id = v_relationship\.student_user_id/);
  assert.match(create, /asset\.kind = 'photo' and asset\.bucket_id = 'progress-check-photos'/);
  assert.match(create, /asset\.available_at is not null/);
  assert.match(create, /asset\.sanitized_at is not null and asset\.deleted_at is null/);
  assert.match(create, /upload\.final_asset_id = asset\.id[\s\S]*upload\.state = 'published'/);
  assert.match(create, /progress_check\.deleted_at is null/);
  assert.match(create, /stored\.bucket_id = asset\.bucket_id and stored\.name = asset\.object_name/);
  assert.match(create, /v_valid_count <> cardinality\(p_asset_ids\)[\s\S]*progress_report_asset_forbidden/);
  assert.ok(create.indexOf("v_valid_count <> cardinality(p_asset_ids)") < create.indexOf("insert into private.progress_reports"));
  assert.match(create, /for update of asset/);
  assert.match(create, /for share of progress_check/);
  assert.match(create, /if p_kind = 'photos'/);
  assert.match(create, /p_kind = 'medical_document' and asset\.kind = 'medical_document'/);
});

test("sent report snapshots retain their exact photo after Student deletion", () => {
  const view = sql.match(/create or replace function private\.progress_report_view\([\s\S]*?\$progress_report_view\$;/)?.[0] ?? "";
  const read = sql.match(/create or replace function private\.can_read_progress_object\([\s\S]*?\$can_read_progress_object\$;/)?.[0] ?? "";
  const cleanup = sql.match(/create or replace function public\.claim_own_deleted_progress_photo_cleanup\([\s\S]*?\$claim_own_deleted_progress_photo_cleanup\$;/)?.[0] ?? "";
  assert.match(view, /from private\.progress_report_items item[\s\S]*where item\.report_id = report\.id/);
  assert.doesNotMatch(view, /asset\.deleted_at is null/);
  assert.match(read, /asset\.student_user_id = v_actor[\s\S]*asset\.deleted_at is null/);
  assert.match(read, /item\.asset_id = asset\.id and item\.asset_kind = 'photo'/);
  assert.match(read, /item\.bucket_id = asset\.bucket_id and item\.object_name = asset\.object_name/);
  assert.match(read, /report\.coach_user_id = v_actor/);
  assert.match(read, /episode\.ended_at is null/);
  assert.match(cleanup, /not exists \(select 1 from private\.progress_report_items item[\s\S]*item\.asset_id = asset\.id/);
  assert.match(publication, /update private\.progress_assets set deleted_at = clock_timestamp\(\)/);
});

test("HEIC has no new reservation, staging, final upload or publication route", () => {
  assert.match(sql, /progress_photo_bucket_policy_mismatch/);
  assert.match(sql, /set allowed_mime_types = array\['image\/jpeg'\]::text\[\]/);
  assert.match(sql, /progress_assets_no_new_heic_v11/);
  assert.match(sql, /mime_type <> 'image\/heic' and extension <> 'heic'/);
  assert.match(staging, /p_format not in \('jpeg', 'png', 'webp'\)/);
  assert.match(staging, /'image\/jpeg', 'image\/png', 'image\/webp'/);
  assert.match(publication, /'progress-check-photos', v_upload\.final_object_name, 'image\/jpeg', 'jpg'/);
  assert.match(publisher, /FINAL_PATH = new RegExp\(`\^\$\{UUID\}\/\$\{UUID\}\\\\\.jpg\$`\)/);
  assert.doesNotMatch(gateway.match(/const FINAL_PATH = [^;]+;/)?.[0] ?? "", /heic/i);
});

test("episode locks and repeated active checks fail closed across report creation and delivery", () => {
  const relationship = base.match(/create function private\.require_own_active_student_relationship\(\)[\s\S]*?\$require_own_active_student_relationship\$;/)?.[0] ?? "";
  const wrapper = sql.match(/create function public\.create_own_progress_photo_report\([\s\S]*?\$create_own_progress_photo_report\$;/)?.[0] ?? "";
  const create = sql.match(/create or replace function public\.create_own_progress_report\([\s\S]*?\$create_own_progress_report\$;/)?.[0] ?? "";
  const materialize = sql.match(/create function private\.materialize_progress_report_delivery\([\s\S]*?\$materialize_progress_report_delivery\$;/)?.[0] ?? "";
  assert.match(relationship, /episode\.ended_at is null[\s\S]*for update of episode/);
  assert.match(wrapper, /require_own_active_student_relationship\(\)/);
  assert.match(wrapper, /v_relationship\.episode_id <> p_expected_episode_id/);
  assert.match(create, /require_own_active_student_relationship\(\)/);
  assert.match(materialize, /episode\.ended_at is null[\s\S]*for share of episode/);
  assert.match(sql, /episode\.ended_at is null[\s\S]*delivery\.student_user_id = v_student/);
});
