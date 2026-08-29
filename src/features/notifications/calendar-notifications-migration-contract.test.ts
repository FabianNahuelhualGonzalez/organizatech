import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260827120000_calendar_notification_delivery.sql": "9deefd69a077ca906ad55d61f54ad9c73160cdb8917c6a5936fd77c4ce1ebe7e",
  "20260827165000_calendar_notification_claim_ambiguity_fix.sql": "6ae4a7929a36275520046bb9239b4e4ddf54a0b0d79add62b7e167aed5980861",
  "20260828020534_notifications_portal_separation.sql": "8c1cb748c127f249ebeb61cd84b07761d6f7604d0d5de28c15740deeccc52771",
  "20260828192434_sec_calendar_resource_bounds.sql": "274d2674d5efcc05304ba1f666cc23f933cffba3af8589dc6ef0dcf5b34a3f38",
} as const;

const migrationPath = "supabase/migrations/20260827120000_calendar_notification_delivery.sql";
const migration = readFileSync(migrationPath, "utf8");
const ambiguityFixPath = "supabase/migrations/20260827165000_calendar_notification_claim_ambiguity_fix.sql";
const ambiguityFix = readFileSync(ambiguityFixPath, "utf8");
const portalSeparationPath = "supabase/migrations/20260828020534_notifications_portal_separation.sql";
const portalSeparation = readFileSync(portalSeparationPath, "utf8");
const resourceBoundsPath = "supabase/migrations/20260828192434_sec_calendar_resource_bounds.sql";
const resourceBounds = readFileSync(resourceBoundsPath, "utf8");

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

function assertNotificationPortalSeparation(source: string) {
  assert.match(source, /alter table public\.calendar_notifications[\s\S]*add column portal_scope text not null default 'usuario'/);
  assert.match(source, /calendar_notifications_portal_scope_allowed[\s\S]*portal_scope in \('usuario', 'coach'\)/);
  assert.match(source, /calendar_notifications_owner_portal_created_idx[\s\S]*\(user_id, portal_scope, created_at desc, id\)/);
  assert.match(source, /revoke all privileges on table public\.calendar_notifications from public, anon, authenticated/);
  assert.doesNotMatch(source, /grant select on table public\.calendar_notifications to authenticated/);
  assert.match(source, /before insert on public\.calendar_notifications[\s\S]*assign_calendar_notification_portal_scope/);
  assert.match(source, /new\.portal_scope := v_portal_scope/);
  assert.match(source, /v_reminder_user_id is distinct from new\.user_id/);
  assert.match(source, /create function public\.list_own_calendar_notifications\([\s\S]*p_portal_scope text/);
  assert.match(source, /notification\.user_id = v_user_id[\s\S]*notification\.portal_scope = p_portal_scope/);
  assert.match(source, /create function public\.mark_own_calendar_notifications_read\([\s\S]*p_portal_scope text/);
  assert.match(source, /notification\.portal_scope = p_portal_scope[\s\S]*notification\.id = any\(p_notification_ids\)/);
  assert.match(source, /p_portal_scope = 'coach'[\s\S]*public\.coach_registrations/);
  assert.match(source, /security definer[\s\S]*set search_path = ''/);
  assert.match(source, /grant execute on function public\.list_own_calendar_notifications\(text, integer\)[\s\S]*to authenticated/);
  assert.match(source, /grant execute on function public\.mark_own_calendar_notifications_read\(text, uuid\[\]\)[\s\S]*to authenticated/);
}

function assertCalendarResourceBounds(source: string) {
  const recurrenceBody =
    source.match(/create or replace function private\.calendar_reminder_occurs_on[\s\S]*?\$calendar_reminder_occurs_on\$;/i)?.[0] ??
    "";
  assert.ok(recurrenceBody, "hotfix reemplaza el helper de recurrencia");
  assert.doesNotMatch(
    recurrenceBody,
    /generate_series\s*\(\s*p_reminder\.starts_on/i,
    "recurrencia no expande un día por fecha desde starts_on",
  );
  assert.match(recurrenceBody, /\(v_days \/ 7\) \* pg_catalog\.cardinality\(p_reminder\.weekly_days\)/);
  assert.match(recurrenceBody, /for v_offset in 0\.\.v_remainder loop/);
  assert.match(recurrenceBody, /if v_month_span > 120 then[\s\S]*return false/);
  assert.match(recurrenceBody, /for v_month_offset in 0\.\.v_month_span loop/);
  assert.match(source, /create or replace function public\.create_own_calendar_reminder\([\s\S]*p_portal_scope text/);
  assert.match(source, /security definer[\s\S]*set search_path = ''/);
  assert.match(source, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(source, /p_portal_scope = 'coach'[\s\S]*public\.coach_registrations/);
  assert.match(source, /pg_catalog\.pg_advisory_xact_lock\([\s\S]*security-calendar-quota/);
  assert.match(
    source,
    /security-calendar-quota:[\s\S]*pg_catalog\.pg_advisory_xact_lock\([\s\S]*organizatech:calendar-request:/,
    "el lock de cuota precede al lock por request para serializar reuso cross-portal sin deadlocks",
  );
  assert.match(source, /organizatech:calendar-request:[\s\S]*p_request_id::pg_catalog\.text/);
  assert.match(source, /reminder\.user_id = v_user_id[\s\S]*reminder\.portal_scope = p_portal_scope[\s\S]*offset 499\s+limit 1/);
  assert.match(source, /errcode = '54000'[\s\S]*calendar reminder limit reached/);
  assert.match(source, /from private\.create_own_calendar_reminder\(/);
  assert.match(source, /revoke all on function public\.create_own_calendar_reminder\([\s\S]*from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.create_own_calendar_reminder\([\s\S]*to authenticated/);
  assert.doesNotMatch(
    source,
    /alter function public\.claim_due_calendar_reminder_deliveries\(text\)[\s\S]*set statement_timeout/,
    "un timeout configurado dentro de la función no limita la sentencia RPC ya iniciada",
  );
  assert.doesNotMatch(source, /public\.(training_sessions|exercise_entries)/);
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

test("migración posterior separa inbox y read_at por portal", () => {
  assertNotificationPortalSeparation(portalSeparation);
});

test("mutantes de portal, ownership y bypass directo mueren", () => {
  const mutants = [
    portalSeparation.replaceAll("notification.portal_scope = p_portal_scope", "true"),
    portalSeparation.replace("new.portal_scope := v_portal_scope", "new.portal_scope := 'usuario'"),
    portalSeparation.replace("v_reminder_user_id is distinct from new.user_id", "false"),
    portalSeparation.replace(
      "revoke all privileges on table public.calendar_notifications from public, anon, authenticated",
      "grant select on table public.calendar_notifications to authenticated",
    ),
    portalSeparation.replaceAll("set search_path = ''", "set search_path = 'public'"),
  ];
  mutants.forEach((mutant, index) => {
    assert.throws(
      () => assertNotificationPortalSeparation(mutant),
      `notification portal mutant ${index + 1} sobrevivió`,
    );
  });
});

test("hotfix acota recurrencia y cardinalidad sin un falso timeout local", () => {
  assertCalendarResourceBounds(resourceBounds);
});

test("mutantes de agotamiento de recursos de calendario mueren", () => {
  const mutants = [
    resourceBounds.replace("if v_month_span > 120 then", "if false then"),
    resourceBounds.replace("offset 499", "offset 499999"),
    resourceBounds.replace("pg_catalog.pg_advisory_xact_lock", "pg_catalog.pg_advisory_unlock"),
    resourceBounds.replace("'organizatech:calendar-request:'", "'organizatech:calendar-request-disabled:'"),
    `${resourceBounds}\nalter function public.claim_due_calendar_reminder_deliveries(text) set statement_timeout = '2500ms';`,
    resourceBounds.replace("v_user_id uuid := auth.uid()", "v_user_id uuid := p_request_id"),
  ];
  mutants.forEach((mutant, index) => {
    assert.throws(
      () => assertCalendarResourceBounds(mutant),
      `calendar resource mutant ${index + 1} sobrevivió`,
    );
  });
});
