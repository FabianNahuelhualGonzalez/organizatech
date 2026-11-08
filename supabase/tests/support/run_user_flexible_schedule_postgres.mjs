// Synthetic PostgreSQL 17 only. No .env, QA, PROD or linked Supabase project.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local PostgreSQL runner requires macOS arm64");
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "org-flex-schedule-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket"), dataDir = join(runtime, "data"), archive = join(runtime, "postgres.jar");
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const userId = "10000000-0000-4000-8000-000000000001";
let client, started = false, stage = "bootstrap", checks = 0;
const sql = (path) => readFileSync(join(root, path), "utf8");
const run = (bin, args, options = {}) => execFileSync(bin, args, { env: childEnv, ...options });
const check = (condition, label) => { if (!condition) throw new Error(`Assertion failed: ${label}`); checks++; };
const one = async (query, args = []) => (await client.query(query, args)).rows[0];
async function rejects(query, code, label) {
  try { await client.query(query); } catch (error) { check(error.code === code, label); return; }
  throw new Error(`Assertion failed: ${label}`);
}

try {
  run("curl", ["-fsSL", "--max-time", "90", archiveUrl, "-o", archive]);
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === archiveHash, "binary SHA-256");
  run("tar", ["-xJ", "-C", runtime], { input: run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 }) });
  mkdirSync(socket, { mode: 0o700 });
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55449 -c log_statement=none -c log_min_error_statement=panic`, "-w", "start"], { stdio: "ignore" });
  started = true;
  client = new pg.Client({ host: socket, port: 55449, user: "postgres", database: "postgres", ssl: false, statement_timeout: 30000 });
  await client.connect();

  stage = "migration chain";
  await client.query(sql("supabase/tests/support/cycle_active_replacement_embedded_bootstrap.sql"));
  await client.query(`
    create table public.routines (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
      name text not null, deleted_at timestamptz
    );
    alter table public.exercises
      add column routine_id uuid references public.routines(id),
      add column target_sets integer not null default 1,
      add column target_reps integer not null default 1,
      add column base_weight numeric not null default 0,
      add column notes text;
    alter table public.training_sessions
      add column week_number integer not null default 1,
      add column trained_at date,
      add column notes text;
    alter table public.exercise_entries
      add column session_id uuid references public.training_sessions(id),
      add column weight numeric not null default 0,
      add column previous_weight numeric not null default 0,
      add column reps integer[] not null default '{}',
      add column rir text,
      add column notes text;
  `);
  const legacySource = sql("supabase/migrations/20260610000001_training_exercise_lineage.sql");
  const legacyMatch = legacySource.match(/create or replace function public\.create_training_cycle_with_plan\([\s\S]*?\n\$\$;/);
  if (!legacyMatch) throw new Error("Legacy cycle function not found");
  await client.query(legacyMatch[0]);
  await client.query(sql("supabase/migrations/20260527000002_training_sessions_source_of_truth.sql"));
  await client.query(sql("supabase/migrations/20260604000001_training_cycle_scoped_model.sql"));
  await client.query(sql("supabase/migrations/20260604000002_training_cycle_scoped_policy_fix.sql"));
  await client.query(sql("supabase/migrations/20260605000001_training_cycle_scoped_session_entries_contract.sql"));
  await client.query(sql("supabase/migrations/20260829200846_cycle_redesign_schema.sql"));
  await client.query(sql("supabase/migrations/20260829200847_cycle_redesign_api.sql"));
  await client.query(sql("supabase/migrations/20260709000001_p0_d1_harden_training_session_entries_writes.sql"));
  await client.query(sql("supabase/migrations/20260902163716_sec_training_rpc_resource_bounds.sql"));
  await client.query(sql("supabase/migrations/20261108035032_user_flexible_training_schedule_v1.sql"));

  stage = "schema, ACL and validation";
  const column = await one("select column_default, is_nullable from information_schema.columns where table_schema='public' and table_name='training_sessions' and column_name='is_flexible_schedule'");
  check(column.column_default === "false" && column.is_nullable === "NO", "existing sessions remain fixed by default");
  const index = await one("select pg_get_expr(i.indpred,i.indrelid) predicate from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='training_sessions_user_cycle_day_trained_unique_idx'");
  check(index.predicate.includes("NOT is_flexible_schedule"), "fixed-day uniqueness remains guarded");
  check((await one("select has_function_privilege('authenticated','public.create_training_session_with_cycle_entries(uuid,uuid,text,date,date,text,integer,text,jsonb)','EXECUTE') allowed")).allowed, "authenticated can execute session RPC");
  check(!(await one("select has_function_privilege('anon','public.create_training_session_with_cycle_entries(uuid,uuid,text,date,date,text,integer,text,jsonb)','EXECUTE') allowed")).allowed, "anon cannot execute session RPC");
  const definition = (await one("select pg_get_functiondef('public.create_training_session_with_cycle_entries(uuid,uuid,text,date,date,text,integer,text,jsonb)'::regprocedure) definition")).definition;
  check(definition.includes("plan_snapshot #>> '{plan,scheduleMode}'"), "RPC derives flexible mode from owned active cycle");
  check(definition.includes("if not v_flexible_schedule and exists"), "same-date duplicate guard remains for fixed cycles");

  await client.query("insert into auth.users(id) values($1)", [userId]);
  await client.query("insert into public.user_registrations(user_id) values($1)", [userId]);
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  const flexiblePlan = { scheduleMode: "flexible", days: [{ day: "monday", name: "A", order: 0, exercises: [] }] };
  await client.query("select private.validate_training_cycle_plan($1,'usuario',$2::jsonb)", [userId, JSON.stringify(flexiblePlan)]);
  checks++;
  await rejects(`select private.validate_training_cycle_plan('${userId}','usuario','{"scheduleMode":"flexible","days":[{"day":"tuesday","name":"A","order":0,"exercises":[]}]}'::jsonb)`, "22023", "flexible slots are canonical A-G");
  await rejects(`select private.validate_training_cycle_plan('${userId}','coach','{"scheduleMode":"flexible","days":[{"day":"monday","name":"A","order":0,"exercises":[]}]}'::jsonb)`, "42501", "Coach cannot create a Usuario flexible plan");
  console.log(`USER_FLEXIBLE_SCHEDULE_POSTGRES=PASS checks=${checks}`);
} catch (error) {
  console.error(`USER_FLEXIBLE_SCHEDULE_POSTGRES=FAIL stage=${stage}`);
  throw error;
} finally {
  if (client) await client.end().catch(() => undefined);
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], { stdio: "ignore" });
  rmSync(runtime, { recursive: true, force: true });
}
