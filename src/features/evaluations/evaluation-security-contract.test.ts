import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationFilename = "20260919225532_coach_student_evaluations.sql";
const migration = readFileSync(`supabase/migrations/${migrationFilename}`, "utf8");
const repository = readFileSync("src/features/evaluations/data/evaluations-repository.ts", "utf8");
const handler = readFileSync("supabase/functions/send-evaluation-emails/handler.ts", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260919225532_coach_student_evaluations.sql": "5e6e46bdc585fbb79d6c6b06e1b5d79193fc9861fae1e75a5be7316898b43e83",
} as const;

test("las tablas canónicas son privadas, RLS forzada y sin writes directos del cliente", () => {
  for (const table of [
    "evaluation_templates", "evaluation_assignments", "evaluation_responses",
    "evaluation_operations", "evaluation_notifications", "evaluation_email_deliveries",
  ]) {
    assert.match(migration, new RegExp(`alter table private\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`alter table private\\.${table} force row level security`));
  }
  assert.match(migration, /revoke all on table private\.evaluation_templates[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[^;]*private\.evaluation_/i);
  assert.doesNotMatch(repository, /\.from\(/);
});

test("ownership, vínculo activo, snapshots, vencimiento e idempotencia se resuelven en servidor", () => {
  assert.match(migration, /private\.lock_coach_invitation_owner\(\)/);
  assert.match(migration, /episode\.ended_at is null/);
  assert.match(migration, /evaluation_assignment_snapshot_immutable/);
  assert.match(migration, /evaluation_completed_response_immutable/);
  assert.match(migration, /private\.evaluation_status\([\s\S]*response\.draft_updated_at, assignment\.reopened_at, v_now/);
  assert.match(migration, /v_assignment\.due_at is not null and v_assignment\.due_at <= v_now/);
  assert.match(migration, /primary key \(actor_user_id, request_id\)/);
  assert.match(migration, /evaluation_already_completed/);
  assert.match(migration, /evaluation_recipient_not_linked/);
  assert.match(migration, /case when response\.state = 'completed' then response\.answers else '\{\}'::jsonb end/);
  assert.match(migration, /assignment\.student_user_id = v_student[\s\S]*episode\.ended_at is null for update of assignment/);
});

test("la validación de respuestas obligatorias conserva condiciones PL/pgSQL cerradas", () => {
  assert.match(migration, /v_answer is null or jsonb_typeof\(v_answer\) <> 'string'[\s\S]*\)\) then raise exception 'evaluation_required_answers_missing'/);
  assert.match(migration, /v_answer is null or jsonb_typeof\(v_answer->'rows'\) <> 'array'[\s\S]*\)\) then raise exception 'evaluation_required_answers_missing'/);
  assert.doesNotMatch(migration, /pg_catalog\.coalesce/);
});

test("notificaciones y correo permanecen aislados de vinculación y sin secretos privilegiados", () => {
  assert.match(migration, /evaluation_received[\s\S]*evaluation_sent[\s\S]*evaluation_completed[\s\S]*evaluation_due_reminder/);
  assert.match(migration, /reminder_origin = 'automatic'/);
  assert.match(migration, /interval '48 hours'/);
  assert.equal((migration.match(/if not private\.verify_evaluation_email_capability\(p_capability\) then/g) ?? []).length, 2);
  assert.match(migration, /assignment\.due_at > v_now and assignment\.due_at <= v_now \+ interval '48 hours'/);
  assert.match(handler, /send-evaluation-emails|claim_evaluation_email_deliveries/);
  assert.match(supabaseConfig, /\[functions\.send-evaluation-emails\][\s\S]*verify_jwt = false/);
  assert.doesNotMatch(`${migration}\n${repository}\n${handler}`, /service_role|send-coach-link-emails/);
  assert.doesNotMatch(migration, /training_sessions|exercise_entries/);
});

test("la migración canónica conserva el hash contractual post PERF-06", () => {
  assert.equal(createHash("sha256").update(migration).digest("hex"), POST_PERF_06_MIGRATION_OWNERSHIP[migrationFilename]);
});
