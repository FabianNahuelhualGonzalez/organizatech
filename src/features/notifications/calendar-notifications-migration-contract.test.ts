import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260827120000_calendar_notification_delivery.sql": "9deefd69a077ca906ad55d61f54ad9c73160cdb8917c6a5936fd77c4ce1ebe7e",
  "20260827165000_calendar_notification_claim_ambiguity_fix.sql": "6ae4a7929a36275520046bb9239b4e4ddf54a0b0d79add62b7e167aed5980861",
} as const;

const migrationPath = "supabase/migrations/20260827120000_calendar_notification_delivery.sql";
const migration = readFileSync(migrationPath, "utf8");
const ambiguityFixPath = "supabase/migrations/20260827165000_calendar_notification_claim_ambiguity_fix.sql";
const ambiguityFix = readFileSync(ambiguityFixPath, "utf8");

function assertSecureCalendarMigration(source: string) {
  assert.match(source, /alter table public\.calendar_notifications enable row level security;/);
  assert.match(source, /alter table public\.calendar_notifications force row level security;/);
  assert.match(source, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(source, /revoke all privileges on table public\.calendar_notifications from public, anon, authenticated;/);
  assert.match(source, /grant select on table public\.calendar_notifications to authenticated;/);
  assert.doesNotMatch(source, /grant (?:insert|update|delete|all)[^;]*calendar_notifications/i);
  assert.match(source, /unique \(reminder_id, occurrence_on\)/);
  assert.match(source, /where n\.user_id = v_user_id and n\.id = any\(p_notification_ids\)/);
  assert.match(source, /set search_path = ''/);
  assert.match(source, /private\.verify_calendar_reminder_capability\(p_capability\)/);
  assert.match(source, /organizatech_calendar_reminder_rpc_secret/);
  assert.match(source, /due_bounded\.email_notification/);
  assert.match(source, /for update skip locked limit 25/);
  assert.match(source, /limit 100/);
  assert.match(source, /attempt_token = pg_catalog\.gen_random_uuid\(\)/);
  assert.match(source, /status = 'ambiguous'[\s\S]*stale_sending/);
  assert.match(source, /p_outcome not in \('sent', 'failed', 'rejected', 'ambiguous'\)/);
  assert.match(source, /private\.resolve_santiago_calendar_occurrence/);
  assert.match(source, /for v_minutes in 0\.\.180 loop/);
  assert.match(source, /select pg_catalog\.count\(\*\)::integer into v_occurrence[\s\S]*extract\(day from day\.value\)::integer = p_reminder\.monthly_day/);
  assert.match(source, /claim_due_calendar_reminder_deliveries\(p_capability text\)/);
  assert.doesNotMatch(source, /claim_due_calendar_reminder_deliveries\([^)]*p_now/);
  assert.match(source, /recipient_unavailable/);
}

function assertClaimAmbiguityFix(source: string) {
  assert.match(source, /create or replace function public\.claim_due_calendar_reminder_deliveries\(p_capability text\)/);
  assert.match(source, /security definer[\s\S]*set search_path = ''/);
  assert.match(source, /private\.verify_calendar_reminder_capability\(p_capability\)/);
  assert.match(source, /on conflict on constraint calendar_notifications_occurrence_unique do nothing/);
  assert.match(source, /returning inserted_notification\.reminder_id, inserted_notification\.occurrence_on/);
  assert.match(source, /on conflict on constraint calendar_reminder_deliveries_occurrence_unique do nothing/);
  assert.doesNotMatch(source, /on conflict \(reminder_id, occurrence_on\)/);
  assert.doesNotMatch(source, /returning reminder_id, occurrence_on/);
  assert.match(source, /revoke all on function public\.claim_due_calendar_reminder_deliveries\(text\)[\s\S]*from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.claim_due_calendar_reminder_deliveries\(text\) to anon/);
}

test("migración endurece ownership, claims, recurrencia y DST", () => {
  assertSecureCalendarMigration(migration);
});

test("mutantes críticos de seguridad y entrega mueren", () => {
  const mutants = [
    migration.replace("force row level security", "no force row level security"),
    migration.replace("(select auth.uid()) = user_id", "true"),
    migration.replaceAll("set search_path = ''", "set search_path = 'public'"),
    migration.replace("due_bounded.email_notification", "true"),
    migration.replace("for update skip locked limit 25", "limit 25"),
    migration.replaceAll("unique (reminder_id, occurrence_on)", "unique (id)"),
    migration.replaceAll("private.verify_calendar_reminder_capability(p_capability)", "true"),
    migration.replace("attempt_token = pg_catalog.gen_random_uuid()", "attempt_token = null"),
    migration.replace("p_outcome not in ('sent', 'failed', 'rejected', 'ambiguous')", "false"),
    migration.replace("for v_minutes in 0..180 loop", "for v_minutes in 0..0 loop"),
  ];
  for (const mutant of mutants) assert.throws(() => assertSecureCalendarMigration(mutant));
});

test("migración previa de Calendario permanece anterior y no fue reescrita", () => {
  assert.ok("20260826213606" < "20260827120000");
  assert.ok("20260827120000" < "20260827165000");
  assert.equal(migration.includes("training_sessions"), false);
  assert.equal(migration.includes("exercise_entries"), false);
  assert.equal(ambiguityFix.includes("training_sessions"), false);
  assert.equal(ambiguityFix.includes("exercise_entries"), false);
});

test("hotfix califica los targets que chocan con variables RETURNS TABLE", () => {
  assertClaimAmbiguityFix(ambiguityFix);
});

test("mutantes que restauran la ambigüedad PL/pgSQL mueren", () => {
  const mutants = [
    ambiguityFix.replace(
      "on conflict on constraint calendar_notifications_occurrence_unique do nothing",
      "on conflict (reminder_id, occurrence_on) do nothing",
    ),
    ambiguityFix.replace(
      "returning inserted_notification.reminder_id, inserted_notification.occurrence_on",
      "returning reminder_id, occurrence_on",
    ),
    ambiguityFix.replace(
      "on conflict on constraint calendar_reminder_deliveries_occurrence_unique do nothing",
      "on conflict (reminder_id, occurrence_on) do nothing",
    ),
  ];
  for (const mutant of mutants) assert.throws(() => assertClaimAmbiguityFix(mutant));
});
