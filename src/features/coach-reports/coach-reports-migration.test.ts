import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261017122521_coach_reports_inbox_v1.sql", "utf8");

test("la bandeja Coach conserva ownership activo y usa los reportes privados existentes", () => {
  assert.match(sql, /create or replace function public\.list_own_coach_progress_reports/);
  assert.match(sql, /episode\.coach_user_id = v_coach/);
  assert.match(sql, /episode\.ended_at is null/);
  assert.match(sql, /not private\.can_coach_read_medical_document_asset/);
  assert.match(sql, /create or replace function public\.review_own_coach_progress_report/);
  assert.match(sql, /insert into private\.progress_report_reviews/);
  assert.match(sql, /update private\.progress_report_notifications/);
  assert.doesNotMatch(sql, /grant .* to anon/i);
});

test("compartir por primera vez un documento médico crea una sola entrega reutilizando el reporte", () => {
  assert.match(sql, /v_changed boolean := false/);
  assert.match(sql, /if p_shared and v_changed then/);
  assert.match(sql, /public\.create_own_progress_report\(\s*'medical_document'/);
  assert.match(sql, /create or replace function private\.materialize_progress_report_delivery/);
  assert.doesNotMatch(sql, /service_role|storage\.objects.*update|delete from private\.progress_reports/i);
});

test("las entregas de correo siguen siendo privadas e idempotentes", () => {
  assert.match(sql, /create or replace function public\.claim_progress_report_email_deliveries/);
  assert.match(sql, /delivery\.attempt_count < 5/);
  assert.match(sql, /for update of delivery skip locked/);
  assert.match(sql, /claimed\.idempotency_key/);
  assert.match(sql, /grant execute on function public\.list_own_coach_progress_reports\(integer\) to authenticated/);
});
