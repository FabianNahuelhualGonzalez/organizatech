import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260924130000_progress_cloudinary_photo_ingest.sql", "utf8");
const upload = readFileSync("src/app/api/progress/photos/route.ts", "utf8");
const read = readFileSync("src/app/api/progress/photos/[assetId]/route.ts", "utf8");

test("registro exige vínculo activo, auth.uid, prueba backend y ownership sin parámetros de dueño", () => {
  assert.match(sql, /v_student uuid := auth\.uid\(\)/);
  assert.match(sql, /private\.require_own_active_student_relationship\(\)/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /extensions\.hmac/);
  assert.match(sql, /v_expected <> p_attestation/);
  assert.match(sql, /student_user_id, kind, bucket_id/);
  assert.doesNotMatch(sql, /p_(?:student|coach|owner|user)_id/);
  assert.doesNotMatch(upload, /service_role|secure_url|url: photo\./i);
  assert.match(upload, /get_own_student_progress_access/);
});

test("lectura Coach ata ítem, reporte, alumno y episodio activo en cada request", () => {
  assert.match(sql, /item\.report_id = p_report_id and item\.asset_id = asset\.id/);
  assert.match(sql, /item\.student_user_id = asset\.student_user_id/);
  assert.match(sql, /report\.coach_user_id = v_actor/);
  assert.match(sql, /episode\.ended_at is null/);
  assert.match(read, /get_own_cloudinary_progress_photo/);
  assert.match(read, /Cache-Control|PRIVATE_PHOTO_HEADERS/);
  assert.doesNotMatch(read, /redirect|secure_url|createSignedUrl|publicUrl/);
});
