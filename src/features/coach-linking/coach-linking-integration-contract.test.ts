import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260917000000_student_coach_link_acceptance.sql":
    "2b41770fd7a06287f3dc5a5876038ceae41d1fe456a26729a24a68fa496f8fa0",
} as const;

const migration = readFileSync("supabase/migrations/20260917000000_student_coach_link_acceptance.sql", "utf8");
const baseMigration = readFileSync("supabase/migrations/20260909044235_coach_invitation_persistence.sql", "utf8");
const profile = readFileSync("src/components/profile/ProfileScreen.tsx", "utf8");
const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
const card = readFileSync("src/features/coach-linking/components/coach-linking-card.tsx", "utf8");
const screens = readFileSync("src/features/coach-linking/components/coach-linking-screens.tsx", "utf8");
const repository = readFileSync("src/features/coach-linking/data/coach-linking-repository.ts", "utf8");
const controller = readFileSync("src/features/coach-linking/hooks/use-coach-linking-controller.ts", "utf8");
const model = readFileSync("src/features/coach-linking/model/coach-linking.ts", "utf8");
const styles = readFileSync("src/features/coach-linking/components/coach-linking.module.css", "utf8");

test("Perfil conserva una sola pantalla y ordena Datos personales, Coaching y Preferencias", () => {
  const personal = profile.indexOf("<PersonalDataSection");
  const coaching = profile.indexOf("<CoachLinkingCardBoundary");
  const preferences = profile.indexOf('title="Preferencias de sistema"');
  assert.ok(personal >= 0 && personal < coaching && coaching < preferences);
  assert.doesNotMatch(profile, /Próximamente podrás vincularte/);
  assert.equal((profile.match(/<CoachLinkingCardBoundary/g) ?? []).length, 1);
});

test("el composition root sólo monta boundary/controller y pantallas tipadas", () => {
  assert.match(root, /useCoachLinkingController\(/);
  assert.match(root, /screen === "coach-link-confirmation"/);
  assert.match(root, /screen === "coach-link-success"/);
  assert.doesNotMatch(root, /lookup_own_coach_invitation|accept_own_coach_invitation|normalizeCoachLinkCode/);
});

test("UI contiene el copy literal, accesibilidad y request retenido por controller", () => {
  for (const copy of [
    "Escribe los 9 caracteres del código.",
    "Validando código…",
    "El código vence a los 7 días.",
    "Ingresa el código de tu coach",
  ]) assert.ok(`${card}\n${model}`.includes(copy), copy);
  for (const copy of [
    "TU COACH SERÍA",
    "AL VINCULARTE",
    "Vincularme",
    "Quedaste vinculado",
    "Ya estabas vinculado",
    "Inicia sesión para continuar",
  ]) assert.ok(screens.includes(copy), copy);
  assert.match(card, /aria-live="polite"/);
  assert.match(card, /inputMode="text"/);
  assert.match(styles, /font: 700 18px/);
});

test("repository fija token de usuario y no acepta ownership ni correo del cliente", () => {
  assert.match(repository, /getSession\(\)/);
  assert.match(repository, /getUser\(token\)/);
  assert.match(repository, /p_code: code/);
  assert.match(repository, /p_request_id: requestId/);
  assert.doesNotMatch(repository, /p_(?:student|user|owner|profile)_id|p_email/);
});

test("migración extiende tablas canónicas y protege código, consentimiento e idempotencia", () => {
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260917000000_student_coach_link_acceptance.sql"],
  );
  assert.match(migration, /references private\.coach_invitations\(id, coach_user_id\)/);
  assert.match(migration, /insert into private\.coach_relationship_episodes/);
  assert.doesNotMatch(migration, /create table (?:public|private)\.student_coach_relationship/);
  assert.match(migration, /coach_invitation_code_history[\s\S]*code_fingerprint text not null unique/);
  assert.match(migration, /on_coach_invitation_track_code_history/);
  assert.match(migration, /student_coach_link_operations[\s\S]*primary key \(student_user_id, request_id\)/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /v_invitation\.coach_user_id = v_identity\.student_user_id/);
  assert.match(baseMigration, /coach_relationship_one_active_student/);
  assert.match(migration, /v_invitation\.recipient_email <> v_identity\.student_email/);
  assert.match(migration, /set search_path = ''/g);
  assert.match(migration, /revoke all on function public\.lookup_own_coach_invitation/);
  assert.match(migration, /grant execute on function public\.lookup_own_coach_invitation[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:public|anon)/);
  const acceptFunction = migration.slice(migration.indexOf("create function public.accept_own_coach_invitation"));
  const invitationLock = acceptFunction.indexOf("where invitation.id = v_history.invitation_id\n  for update;");
  const refreshedHistory = acceptFunction.indexOf(
    "where history.code_fingerprint = v_fingerprint;",
    invitationLock,
  );
  const retirementBranch = acceptFunction.indexOf("if v_history.retirement_reason = 'accepted' then");
  assert.ok(invitationLock >= 0 && invitationLock < refreshedHistory && refreshedHistory < retirementBranch);
});

test("cambio directo A→B invalida código y confirmación locales antes de leer como B", () => {
  assert.match(controller, /previousIdentityKey !== input\.identityKey/);
  assert.match(controller, /if \(switchedDirectly\) \{[\s\S]*resumeConfirmation\.current = null;[\s\S]*pendingEntryCode\.current = null;[\s\S]*clearCoachLinkEntry/);
  assert.match(controller, /setSnapshot\(\(state\) => switchedDirectly \? EMPTY/);
});

test("aceptación crea dos campanas listas y dos correos recuperables sin provider I/O", () => {
  assert.match(migration, /v_episode\.id, v_identity\.student_user_id, 'usuario', 'student', 'ready'/);
  assert.match(migration, /v_episode\.id, v_invitation\.coach_user_id, 'coach', 'coach', 'ready'/);
  assert.match(migration, /unique \(episode_id, recipient_user_id, portal_scope\)/);
  assert.match(migration, /unique \(episode_id, recipient_user_id, audience\)/);
  assert.match(migration, /'Vinculación confirmada'/);
  assert.match(migration, /'Ahora estás vinculado con Coach ' \|\| v_coach_name \|\| '\.'/);
  assert.match(migration, /'Nuevo alumno vinculado'/);
  assert.match(migration, /v_identity\.student_name \|\| ' se vinculó a tu cuenta\.'/);
  assert.match(migration, /v_student_idempotency, 'pending'/);
  assert.match(migration, /create function public\.claim_own_coach_link_emails/);
  assert.match(migration, /create function public\.complete_own_coach_link_email/);
  assert.match(migration, /episode\.student_user_id = v_student_user_id/);
  assert.doesNotMatch(migration, /net\.http|http_post|pg_net/);
});
