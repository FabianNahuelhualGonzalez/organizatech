// Isolated PostgreSQL 17.5, real training migration chain with a synthetic link.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("macOS arm64 required");
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync("/tmp/org-cst-pg-");
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket"), data = join(runtime, "data");
const archive = "/tmp/organizatech-postgres-17.5.jar";
const digest = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const sql = (path) => readFileSync(join(root, path), "utf8");
const migration = (name) => sql(`supabase/migrations/${name}`);
const run = (bin, args, options = {}) => execFileSync(bin, args, { env: childEnv, ...options });
const ids = {
  student: "10000000-0000-4000-8000-000000000001",
  coach: "10000000-0000-4000-8000-000000000002",
  other: "10000000-0000-4000-8000-000000000003",
  episode: "20000000-0000-4000-8000-000000000001",
};
let client, started = false, stage = "archive", checks = 0;
function check(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks++;
}
async function one(query, params = []) { return (await client.query(query, params)).rows[0]; }
async function reject(query, params, code, label) {
  try { await client.query(query, params); } catch (error) {
    check(error.code === code, label);
    return;
  }
  throw new Error(`Expected ${code}: ${label}`);
}
async function actor(userId) {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
}

try {
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === digest,
    "pinned binary hash");
  run("tar", ["-xJ", "-C", runtime], { input: run("unzip", ["-p", archive,
    "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 }) });
  mkdirSync(socket, { mode: 0o700 });
  stage = "start local PostgreSQL";
  run(join(runtime, "bin/initdb"), ["-D", data, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  run(join(runtime, "bin/pg_ctl"), ["-D", data, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55447 -c log_statement=none -c log_min_error_statement=panic`,
  "-w", "start"], { stdio: "ignore" });
  started = true;
  client = new pg.Client({ host: socket, port: 55447, user: "postgres",
    database: "postgres", ssl: false, statement_timeout: 30000 });
  await client.connect();
  stage = "real training migration chain";
  await client.query(sql("supabase/tests/support/cycle_active_replacement_embedded_bootstrap.sql"));
  await client.query(`
    create table public.routines (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
      name text not null, deleted_at timestamptz);
    alter table public.exercises
      add column routine_id uuid references public.routines(id),
      add column target_sets integer not null default 1,
      add column target_reps integer not null default 1,
      add column base_weight numeric not null default 0,
      add column notes text;
    alter table public.training_sessions
      add column week_number integer not null default 1,
      add column trained_at date, add column notes text;
    alter table public.exercise_entries
      add column session_id uuid references public.training_sessions(id),
      add column weight numeric not null default 0,
      add column previous_weight numeric not null default 0,
      add column reps integer[] not null default '{}',
      add column rir text, add column notes text;
  `);
  const legacy = migration("20260610000001_training_exercise_lineage.sql")
    .match(/create or replace function public\.create_training_cycle_with_plan\([\s\S]*?\n\$\$;/);
  if (!legacy) throw new Error("Legacy cycle function not found");
  await client.query(legacy[0]);
  for (const name of [
    "20260527000002_training_sessions_source_of_truth.sql",
    "20260604000001_training_cycle_scoped_model.sql",
    "20260604000002_training_cycle_scoped_policy_fix.sql",
    "20260605000001_training_cycle_scoped_session_entries_contract.sql",
    "20260829200846_cycle_redesign_schema.sql",
    "20260829200847_cycle_redesign_api.sql",
    "20260831213114_cycle_active_replacement.sql",
    "20260709000001_p0_d1_harden_training_session_entries_writes.sql",
    "20260902163716_sec_training_rpc_resource_bounds.sql",
    "20261108035032_user_flexible_training_schedule_v1.sql",
  ]) await client.query(migration(name));
  await client.query(`
    create table private.coach_relationship_episodes (
      id uuid primary key, coach_user_id uuid not null, student_user_id uuid not null,
      ended_at timestamptz);
  `);
  await client.query(migration("20261126200911_coach_student_training_edit_v1.sql"));
  await client.query(migration("20261126200922_coach_student_training_cycle_edges_v1.sql"));
  await client.query(migration("20261126210619_coach_student_cycle_replacement_close_v1.sql"));
  await client.query(migration("20261126200900_coach_student_training_read_v1.sql"));
  stage = "apply Coach activity read";
  await client.query(migration("20261127142942_coach_student_cycle_executions_read_v1.sql"));
  await client.query(migration("20261127143334_coach_student_legacy_cycle_activity_v1.sql"));
  check((await one(`select has_function_privilege('authenticated',
    'public.edit_own_coach_student_active_training_cycle(uuid,uuid,uuid,integer,text,text,jsonb)',
    'EXECUTE') as allowed`)).allowed, "Coach RPC executable by authenticated");
  check(!(await one(`select has_function_privilege('anon',
    'public.edit_own_coach_student_active_training_cycle(uuid,uuid,uuid,integer,text,text,jsonb)',
    'EXECUTE') as allowed`)).allowed, "anonymous actor denied RPC");
  check(!(await one(`select has_function_privilege('authenticated',
    'private.allow_coach_student_training_cycle_update(public.training_cycles,public.training_cycles,uuid)',
    'EXECUTE') as allowed`)).allowed, "authenticated cannot call private UPDATE exception");
  await client.query("insert into auth.users(id) values ($1),($2),($3)",
    [ids.student, ids.coach, ids.other]);
  await client.query("insert into public.user_registrations(user_id) values ($1)", [ids.student]);
  await client.query("insert into public.coach_registrations(user_id) values ($1),($2)",
    [ids.coach, ids.other]);
  await client.query(`insert into private.coach_relationship_episodes values ($1,$2,$3,null)`,
    [ids.episode, ids.coach, ids.student]);
  const initial = { days: [{ day: "monday", name: "A", order: 0, exercises: [] }] };
  const added = { days: [...initial.days,
    { day: "tuesday", name: "B", order: 1, exercises: [] }] };
  const changed = { days: [initial.days[0],
    { day: "tuesday", name: "B editada", order: 1, exercises: [] }] };
  stage = "owner creates active cycle";
  await client.query("set role authenticated");
  await actor(ids.student);
  const draft = (await one(`select public.create_own_training_cycle_draft(
    gen_random_uuid(),'usuario','manual','strength',current_date,current_date+30,$1::jsonb) value`,
  [JSON.stringify(initial)])).value;
  const activated = (await one(`select public.activate_own_training_cycle_draft(
    gen_random_uuid(),'usuario',$1,1) value`, [draft.aggregateId])).value;
  const cycle = activated.aggregateId;
  stage = "delegated edits";
  await actor(ids.coach);
  stage = "Coach activity access";
  const activity = (await one(`select public.get_own_coach_student_cycle_activity($1,$2) value`,
    [ids.episode, cycle])).value;
  check(activity.cycleId === cycle && activity.sessionCount === 0 && activity.records.length === 0,
    "linked Coach can read an empty cycle without fabricated results");
  check((await one(`select public.list_own_coach_student_cycle_sessions($1,$2) value`,
    [ids.episode, cycle])).value.length === 0, "empty session page");
  await actor(ids.other);
  await reject(`select public.get_own_coach_student_cycle_activity($1,$2)`,
    [ids.episode, cycle], "42501", "unrelated Coach denied execution history");
  await actor(ids.coach);
  stage = "delegated edits";
  const request = "30000000-0000-4000-8000-000000000001";
  const edit = `select public.edit_own_coach_student_active_training_cycle(
    $1,$2,$3,$4,$5,'strength',$6::jsonb) value`;
  const args = (requestId, expectedVersion, action, plan) =>
    [ids.episode, requestId, cycle, expectedVersion, action, JSON.stringify(plan)];
  check((await one(edit, args(request, 1, "create_routine", added))).value.resultVersion === 2,
    "Coach adds a routine to existing cycle");
  check((await one(edit, args(request, 1, "create_routine", added))).value.resultVersion === 2,
    "exact retry returns same version");
  await reject(edit, args(request, 1, "create_routine", changed), "22023",
    "request ID rejects changed payload");
  await reject(edit, args("30000000-0000-4000-8000-000000000002", 1,
    "modify_routine", changed), "40001", "stale Student or Coach version rejected");
  check((await one(edit, args("30000000-0000-4000-8000-000000000003", 2,
    "modify_routine", changed))).value.resultVersion === 3,
  "Coach modifies a routine");
  const close = `select public.close_own_coach_student_last_routine($1,$2,$3,$4) value`;
  await reject(close, [ids.episode, "30000000-0000-4000-8000-000000000010", cycle, 3],
    "22023", "cycle with two routines cannot close as last routine");
  check((await one(edit, args("30000000-0000-4000-8000-000000000004", 3,
    "remove_routine", initial))).value.resultVersion === 4,
  "Coach removes a routine, preserving previous versions");
  await client.query("reset role");
  check((await one("select count(*)::integer count from public.training_cycle_plan_versions where cycle_id=$1",
    [cycle])).count === 4, "all plan versions retained");
  check((await one("select count(*)::integer count from private.coach_student_training_edits where cycle_id=$1",
    [cycle])).count === 3, "actor and episode audit has three edits");
  check((await one(`select count(*)::integer count from private.coach_student_training_edits
    where cycle_id=$1 and actor_user_id=$2 and relationship_episode_id=$3`,
  [cycle, ids.coach, ids.episode])).count === 3, "all edits attribute the Coach and episode");
  await client.query("set role authenticated");
  await reject("update public.training_cycles set goal='volume' where id=$1",
    [cycle], "42501", "Coach cannot update a cycle directly");
  stage = "last routine and new cycle";
  const closeRequest = "30000000-0000-4000-8000-000000000007";
  await reject(close, [ids.episode, "30000000-0000-4000-8000-000000000008", cycle, 3],
    "40001", "last routine closure rejects stale version");
  check((await one(close, [ids.episode, closeRequest, cycle, 4])).value.operationKind === "cycle_close",
    "Coach closes cycle after removing its last routine");
  check((await one(close, [ids.episode, closeRequest, cycle, 4])).value.aggregateId === cycle,
    "close retry is idempotent");
  const created = (await one(`select public.create_own_coach_student_training_cycle(
    $1,$2,'strength',current_date,current_date+30,$3::jsonb) value`,
  [ids.episode, "30000000-0000-4000-8000-000000000009", JSON.stringify(initial)])).value;
  check(created.aggregateId !== cycle && created.resultVersion === 1,
    "Coach creates first routine in a new cycle");
  stage = "Coach replaces an active multi-routine cycle";
  check((await one(edit, [ids.episode, "30000000-0000-4000-8000-000000000012",
    created.aggregateId, 1, "create_routine", JSON.stringify(added)])).value.resultVersion === 2,
  "Coach prepares an active cycle with two routines");
  const replace = `select public.close_own_coach_student_cycle_for_replacement($1,$2,$3,$4) value`;
  await reject(replace, [ids.episode, "30000000-0000-4000-8000-000000000013",
    created.aggregateId, 1], "40001", "replacement rejects a stale version");
  const replacementRequest = "30000000-0000-4000-8000-000000000014";
  check((await one(replace, [ids.episode, replacementRequest, created.aggregateId, 2])).value
    .operationKind === "cycle_close", "Coach closes multi-routine cycle after confirmation");
  check((await one(replace, [ids.episode, replacementRequest, created.aggregateId, 2])).value
    .aggregateId === created.aggregateId, "replacement close retry is idempotent");
  const next = (await one(`select public.create_own_coach_student_training_cycle(
    $1,$2,'strength',current_date,current_date+30,$3::jsonb) value`,
  [ids.episode, "30000000-0000-4000-8000-000000000015", JSON.stringify(initial)])).value;
  check(next.aggregateId !== created.aggregateId, "replacement activates a distinct cycle");
  await client.query("reset role");
  check((await one("select status from public.training_cycles where id=$1", [cycle])).status === "completed",
    "old cycle remains in history");
  check((await one(`select count(*)::integer count from private.coach_student_training_cycle_actions
    where actor_user_id=$1 and relationship_episode_id=$2`, [ids.coach, ids.episode])).count === 4,
  "all boundary operations attribute the Coach and episode");
  check((await one("select status from public.training_cycles where id=$1",
    [created.aggregateId])).status === "completed", "replaced cycle remains in history");
  await client.query("set role authenticated");
  stage = "authorization and unlink";
  await actor(ids.other);
  await reject(edit, args("30000000-0000-4000-8000-000000000005", 4,
    "modify_routine", changed), "42501", "unrelated Coach denied");
  await reject(`select public.create_own_coach_student_training_cycle(
    $1,$2,'strength',current_date,current_date+30,$3::jsonb) value`,
  [ids.episode, "30000000-0000-4000-8000-000000000011", JSON.stringify(initial)],
  "42501", "unrelated Coach cannot create a cycle");
  await actor(ids.coach);
  await client.query("reset role");
  await client.query("update private.coach_relationship_episodes set ended_at=now() where id=$1",
    [ids.episode]);
  await client.query("set role authenticated");
  await reject(edit, args("30000000-0000-4000-8000-000000000006", 4,
    "modify_routine", changed), "42501", "former Coach denied");
  await reject(`select public.list_own_coach_student_cycle_sessions($1,$2)`,
    [ids.episode, cycle], "42501", "former Coach denied session page");
  console.log(`COACH_STUDENT_TRAINING_EDIT_LOCAL_POSTGRES=PASS (${checks} checks; Unix socket only)`);
} catch (error) {
  console.error(`COACH_STUDENT_TRAINING_EDIT_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? "assertion"}: ${error.message}`);
  if (started) {
    try { console.error(readFileSync(join(runtime, "server.log"), "utf8").slice(-2000)); }
    catch { /* No log yet. */ }
  }
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
  if (started) {
    try { run(join(runtime, "bin/pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"],
      { stdio: "ignore" }); } catch { /* Temporary cluster cleanup. */ }
  }
  rmSync(runtime, { recursive: true, force: true });
}
