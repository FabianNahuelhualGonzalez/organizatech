import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationFilename = "20260920060000_coach_self_student_and_evaluation_template_deletion.sql";
const migration = readFileSync(
  `supabase/migrations/${migrationFilename}`,
  "utf8",
);

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260920060000_coach_self_student_and_evaluation_template_deletion.sql":
    "77de13c51c05535b4c8e7eda24c315982843489c2ba50ad1839a4dc2f5da90e9",
} as const;
const relationshipBase = readFileSync(
  "supabase/migrations/20260909044235_coach_invitation_persistence.sql",
  "utf8",
);
const evaluationBase = readFileSync(
  "supabase/migrations/20260918000000_coach_student_evaluations.sql",
  "utf8",
);
const activationBoundary = readFileSync(
  "src/features/coach-portal/components/coach-same-identity-activation.tsx",
  "utf8",
);
const coachPortal = readFileSync(
  "src/features/coach-portal/components/coach-portal.tsx",
  "utf8",
);

test("la misma identidad puede materializar Usuario sin ownership ni una segunda cuenta", () => {
  assert.match(migration, /create or replace function public\.register_own_user\(\)/);
  assert.match(migration, /v_authenticated_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /insert into public\.user_registrations default values/);
  assert.doesNotMatch(migration, /p_(?:user_id|owner_id|profile_id|role)/);
  assert.doesNotMatch(migration, /requires a separate auth identity/);
  assert.match(migration, /create or replace function private\.student_coach_identity\(\)/);
  assert.doesNotMatch(migration, /pg_catalog\.coalesce\s*\(/);
  assert.match(activationBoundary, /Activar mi perfil Usuario/);
  assert.match(activationBoundary, /No se creará una segunda cuenta/);
  assert.match(activationBoundary, /Ir a mi perfil Usuario/);
  assert.match(coachPortal, /<CoachSameIdentityActivation expectedUserId=\{session\.userId\} \/>/);
});

test("el vínculo propio elimina sólo la desigualdad y conserva un Coach activo por Alumno", () => {
  assert.match(migration, /alter table private\.coach_relationship_episodes[\s\S]*drop constraint coach_relationship_episodes_check/);
  assert.match(relationshipBase, /create unique index coach_relationship_one_active_student[\s\S]*\(student_user_id\) where ended_at is null/);
  assert.doesNotMatch(migration, /drop index[^;]*coach_relationship_one_active_student/i);
  assert.doesNotMatch(migration, /v_invitation\.coach_user_id = (?:p_student_user_id|v_identity\.student_user_id)/);
  assert.match(migration, /where episode\.student_user_id = v_identity\.student_user_id[\s\S]*episode\.ended_at is null[\s\S]*for update/);
  assert.match(migration, /when unique_violation then[\s\S]*'status', 'ya_tiene_coach'/);
});

test("vínculos normales y eventos separados por rol conservan sus validaciones", () => {
  assert.match(migration, /v_invitation\.recipient_email <> v_identity\.student_email/);
  assert.match(migration, /from public\.coach_registrations as coach[\s\S]*coach\.user_id = v_history\.coach_user_id[\s\S]*for update/);
  assert.match(migration, /'usuario', 'student'/);
  assert.match(migration, /'coach', 'coach'/);
  assert.match(migration, /student:' \|\| v_episode\.id::text/);
  assert.match(migration, /coach:' \|\| v_episode\.id::text/);
});

test("autoevaluaciones mantienen snapshots, consentimiento y ownership de plantilla", () => {
  assert.match(migration, /alter table private\.evaluation_assignments[\s\S]*drop constraint evaluation_assignments_check/);
  assert.match(evaluationBase, /evaluation_assignment_snapshot_immutable/);
  assert.match(evaluationBase, /if \(p_snapshot->>'sensitive'\)::boolean and not coalesce\(p_consent, false\)/);
  assert.match(migration, /create function public\.delete_own_evaluation_template\(p_template_id uuid\)/);
  assert.match(migration, /template\.coach_user_id = v_owner[\s\S]*for update/);
  assert.match(migration, /if v_template\.hidden_at is null then[\s\S]*set hidden_at = v_now,[\s\S]*updated_at = v_now/);
  assert.doesNotMatch(migration, /delete from private\.evaluation_templates/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /revoke all on function public\.delete_own_evaluation_template\(uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.delete_own_evaluation_template\(uuid\)[\s\S]*to authenticated/);
});

test("la migración queda fuera de entrenamiento, secretos y superficies remotas", () => {
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    POST_PERF_06_MIGRATION_OWNERSHIP[migrationFilename],
  );
  assert.doesNotMatch(migration, /training_sessions|exercise_entries|service_role|supabase_service_role|private_key|storage\./i);
  assert.doesNotMatch(migration, /create policy[\s\S]*(?:public|anon)/i);
});
