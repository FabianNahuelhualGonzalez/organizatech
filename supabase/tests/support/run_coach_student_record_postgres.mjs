// Synthetic local PostgreSQL 17.5: Unix socket and temporary cluster only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("macOS arm64 required");
for (const name of Object.keys(process.env)) if (/^PG/.test(name)) delete process.env[name];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const archive = "/tmp/organizatech-postgres-17.5.jar";
const hash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
// macOS limits Unix socket path length; /tmp is intentionally short.
const runtime = mkdtempSync("/tmp/org-csr-pg-");
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const clients = [];
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { env: childEnv, ...options });
const sql = (name) => readFileSync(join(root, "supabase/migrations", name), "utf8");
const ids = {
  coach: "10000000-0000-4000-8000-000000000001",
  student: "10000000-0000-4000-8000-000000000002",
  other: "10000000-0000-4000-8000-000000000003",
  episode: "20000000-0000-4000-8000-000000000001",
  nextEpisode: "20000000-0000-4000-8000-000000000002",
  photo: "30000000-0000-4000-8000-000000000001",
  privatePhoto: "30000000-0000-4000-8000-000000000002",
  check: "40000000-0000-4000-8000-000000000001",
  report: "50000000-0000-4000-8000-000000000001",
  assignment: "60000000-0000-4000-8000-000000000001",
  batch: "70000000-0000-4000-8000-000000000001",
  cycle: "80000000-0000-4000-8000-000000000001",
  version: "90000000-0000-4000-8000-000000000001",
};
let started = false;
let stage = "archive";
let assertions = 0;
function check(condition, label) {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  assertions += 1;
}
async function connect(userId = null) {
  const client = new pg.Client({ host: socket, port: 55446, user: "postgres",
    database: "postgres", ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 20000 });
  await client.connect();
  clients.push(client);
  if (userId) {
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  }
  return client;
}
async function value(client, query, params = []) {
  return (await client.query(query, params)).rows[0]?.value;
}
async function denied(promise, label) {
  try { await promise; } catch (error) {
    check(error.code === "42501", label);
    return;
  }
  throw new Error(`Expected 42501: ${label}`);
}

try {
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === hash,
    "pinned PostgreSQL archive hash");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"],
    { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  stage = "start isolated PostgreSQL";
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"]);
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55446 -c log_statement=none -c log_min_error_statement=panic`,
    "-w", "start"], { stdio: "ignore" });
  started = true;
  const admin = await connect();
  stage = "synthetic baseline";
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.user_registrations(user_id uuid primary key);
    create table public.coach_registrations(user_id uuid primary key);
    create table private.coach_relationship_episodes(
      id uuid primary key, coach_user_id uuid not null, student_user_id uuid not null,
      student_name_snapshot text not null, student_email_snapshot text not null,
      linked_at timestamptz not null, ended_at timestamptz);
    create table private.evaluation_assignments(
      id uuid primary key, send_batch_id uuid not null, student_name_snapshot text not null,
      snapshot jsonb not null, due_at timestamptz, reopened_at timestamptz,
      sent_at timestamptz not null, relationship_episode_id uuid not null,
      coach_user_id uuid not null);
    create table private.evaluation_responses(
      assignment_id uuid primary key, state text, draft_updated_at timestamptz,
      completed_at timestamptz, consent_confirmed boolean, answers jsonb);
    create table private.evaluation_notifications(
      assignment_id uuid, created_at timestamptz, event_kind text);
    create function private.evaluation_status(timestamptz,text,timestamptz,timestamptz,timestamptz)
      returns text language sql stable as $$ select case when $2='completed' then 'completed' else 'pending' end $$;
    create function private.require_own_progress_photo_reader() returns uuid
      language sql stable security definer set search_path = '' as $$
        select case when exists (select 1 from public.user_registrations where user_id=auth.uid())
          then auth.uid() else null end $$;
    create table private.progress_assets(
      id uuid primary key, student_user_id uuid not null, kind text not null,
      bucket_id text not null, object_name text not null, mime_type text not null,
      available_at timestamptz,
      sanitized_at timestamptz, deleted_at timestamptz, byte_size integer,
      unique(id,student_user_id));
    create table private.progress_checks(id uuid primary key, checked_on date, deleted_at timestamptz);
    create table private.progress_check_photos(
      photo_asset_id uuid primary key, student_user_id uuid, check_id uuid, pose text);
    create table private.progress_reports(
      id uuid primary key, relationship_episode_id uuid not null, student_user_id uuid not null,
      coach_user_id uuid not null, kind text not null, message text, sent_at timestamptz not null);
    create table private.progress_report_items(
      report_id uuid, asset_id uuid, asset_kind text, bucket_id text,
      object_name text, position integer, mime_type text, extension text,
      byte_size integer, check_id uuid, checked_on date, pose text,
      width integer, height integer, display_name text, document_category text);
    create table private.progress_report_reviews(
      report_id uuid primary key, coach_user_id uuid, reviewed_at timestamptz default clock_timestamp());
    create table private.progress_report_notifications(
      report_id uuid, recipient_user_id uuid, read_at timestamptz);
    create function private.can_coach_read_medical_document_asset(uuid,uuid)
      returns boolean language sql stable as $$ select false $$;
    create function private.require_own_active_student_relationship()
      returns table(episode_id uuid, student_user_id uuid, coach_user_id uuid)
      language sql security definer set search_path = '' as $$
        select id, student_user_id, coach_user_id from private.coach_relationship_episodes
        where student_user_id=auth.uid() and ended_at is null $$;
    create function public.create_own_progress_report(text,uuid[],text,uuid)
      returns jsonb language sql security definer set search_path = '' as $$
        select jsonb_build_object('id',id) from private.progress_reports
        where student_user_id=auth.uid() and kind=$1 limit 1 $$;
    create table public.training_cycles(
      id uuid primary key, user_id uuid not null, portal_scope text not null,
      current_plan_version_id uuid, current_plan_version integer,
      cycle_number integer, status text, deleted_at timestamptz,
      extension_count integer, source_draft_id uuid, source_cycle_id uuid,
      closed_at timestamptz, closed_reason text,
      created_at timestamptz, updated_at timestamptz);
    create table public.training_cycle_plan_versions(
      id uuid primary key, cycle_id uuid, user_id uuid, portal_scope text,
      version integer, change_kind text, goal text, start_date date, end_date date,
      source_version_id uuid, created_at timestamptz);
    create function private.training_cycle_plan_snapshot_json(uuid)
      returns jsonb language sql stable security definer set search_path = ''
      as $$ select jsonb_build_object('days', '[]'::jsonb) $$;
  `);
  await admin.query(`
    insert into public.coach_registrations values ('${ids.coach}'),('${ids.other}');
    insert into public.user_registrations values ('${ids.student}');
    insert into private.coach_relationship_episodes values
      ('${ids.episode}','${ids.coach}','${ids.student}','Alumno QA','student@example.test',now(),null);
    insert into private.evaluation_assignments values
      ('${ids.assignment}','${ids.batch}','Alumno QA','{"name":"Anamnesis"}',null,null,now(),
       '${ids.episode}','${ids.coach}');
    insert into private.evaluation_responses values
      ('${ids.assignment}','completed',null,now(),true,'{"answer":"respuesta"}');
    insert into private.progress_checks values ('${ids.check}',current_date,null);
    insert into private.progress_assets values
      ('${ids.photo}','${ids.student}','photo','progress-check-photos','photo/a.jpg','image/jpeg',now(),now(),null,100),
      ('${ids.privatePhoto}','${ids.student}','photo','progress-check-photos','photo/b.jpg','image/jpeg',now(),now(),null,100);
    insert into private.progress_check_photos values
      ('${ids.photo}','${ids.student}','${ids.check}','frente'),
      ('${ids.privatePhoto}','${ids.student}','${ids.check}','perfil');
    insert into private.progress_reports values
      ('${ids.report}','${ids.episode}','${ids.student}','${ids.coach}','photos','Mensaje conservado',now());
    insert into private.progress_report_items
      (report_id,asset_id,asset_kind,bucket_id,object_name,position,mime_type,extension,byte_size,
       check_id,checked_on,pose)
      values ('${ids.report}','${ids.photo}','photo','progress-check-photos','photo/a.jpg',1,
        'image/jpeg','jpg',100,'${ids.check}',current_date,'frente');
    insert into public.training_cycles values
      ('${ids.cycle}','${ids.student}','usuario','${ids.version}',1,1,
       'active',null,0,null,null,null,null,now(),now());
    insert into public.training_cycle_plan_versions values
      ('${ids.version}','${ids.cycle}','${ids.student}','usuario',1,
       'activation','strength',current_date-5,current_date+14,null,now());
  `);
  stage = "apply proposed migrations";
  await admin.query(sql("20261126200839_coach_student_evaluation_read_v1.sql"));
  await admin.query(sql("20261126200850_progress_photo_individual_sharing_v1.sql"));
  await admin.query(sql("20261126200900_coach_student_training_read_v1.sql"));
  await admin.query(sql("20261128143000_coach_reports_review_and_compare_v1.sql"));
  // Test-only wrappers emulate a Storage policy and the public Coach report
  // reader without exposing the private schema to authenticated clients.
  await admin.query(`
    create function public.test_storage_read(text,text) returns boolean
      language sql stable security definer set search_path = '' as $$
      select private.can_read_progress_object($1,$2) $$;
    create function public.test_coach_report(uuid) returns jsonb
      language sql stable security definer set search_path = '' as $$
      select private.progress_report_view($1) $$;
  `);
  const student = await connect(ids.student);
  const coach = await connect(ids.coach);
  const other = await connect(ids.other);
  stage = "Coach report review and comparison";
  check((await value(coach, "select public.get_own_coach_progress_report($1) as value", [ids.report]))
    .reviewedAt === null, "opening does not review");
  const inbox = await value(coach,
    "select public.page_own_coach_progress_reports('pending',null,'',20,0) as value");
  check(inbox.pending === 1 && inbox.reviewed === 0 && inbox.items.length === 1
    && inbox.hasMore === false, "inbox counts and first page follow authorized status");
  check(inbox.items[0].episodeId === ids.episode,
    "new page provides authorized episode for navigation");
  await denied(value(other, "select public.get_own_coach_progress_report($1) as value", [ids.report]),
    "unrelated Coach cannot open report");
  await denied(value(other, "select public.set_own_coach_progress_report_reviewed($1,true) as value", [ids.report]),
    "unrelated Coach cannot review report");
  check(await value(coach, "select public.get_previous_own_coach_photo_report($1) as value", [ids.report]) === null,
    "no previous photo report does not invent comparison");
  await admin.query(`insert into private.progress_reports values
      ('50000000-0000-4000-8000-000000000002',$1,$2,$3,'photos',null,now()-interval '7 days')`,
    [ids.episode, ids.student, ids.coach]);
  await admin.query(`insert into private.progress_report_items
      (report_id,asset_id,asset_kind,bucket_id,object_name,position,mime_type,extension,
       byte_size,check_id,checked_on,pose) values
      ('50000000-0000-4000-8000-000000000002',$1,'photo','progress-check-photos',
       'photo/a.jpg',1,'image/jpeg','jpg',100,$2,current_date-7,'frente')`,
    [ids.photo, ids.check]);
  check((await value(coach, "select public.get_previous_own_coach_photo_report($1) as value", [ids.report]))
    .items.length === 1, "comparison only loads authorized earlier photos");
  check((await value(coach, "select public.set_own_coach_progress_report_reviewed($1,true) as value", [ids.report]))
    .reviewedAt !== null, "explicit review persists");
  check((await value(coach,
    "select public.page_own_coach_progress_reports('reviewed',null,'',20,0) as value"))
    .items.length === 1, "reviewed filter follows persisted state");
  check((await value(coach, "select public.set_own_coach_progress_report_reviewed($1,false) as value", [ids.report]))
    .reviewedAt === null, "review can be reverted");
  stage = "active relationship and evaluation";
  check((await value(coach, "select public.get_own_coach_student_record_subject($1) as value",
    [ids.episode])).studentUserId === ids.student, "subject derives Student from episode");
  check((await value(coach, "select public.list_own_coach_student_evaluations($1) as value",
    [ids.episode]))[0].answers.answer === "respuesta", "completed answer visible to own Coach");
  await denied(value(other, "select public.get_own_coach_student_record_subject($1) as value",
    [ids.episode]), "unrelated Coach denied");
  await denied(value(other, "select public.list_own_coach_student_evaluations($1) as value",
    [ids.episode]), "unrelated Coach cannot read answers");
  stage = "delegated training reads";
  check((await value(coach, "select public.list_own_coach_student_training_cycles($1) as value",
    [ids.episode])).items[0].cycleId === ids.cycle, "Coach lists Student cycle");
  check((await value(coach, "select public.get_own_coach_student_training_cycle($1,$2) as value",
    [ids.episode, ids.cycle])).plan.days.length === 0, "Coach reads Student plan");
  check((await value(coach, "select public.get_own_coach_student_training_cycle_version($1,$2,1) as value",
    [ids.episode, ids.cycle])).snapshotId === ids.version, "Coach reads historical version");
  await denied(value(other, "select public.get_own_coach_student_training_cycle($1,$2) as value",
    [ids.episode, ids.cycle]), "other Coach denied Student plan");
  await denied(value(student, "select public.get_own_coach_student_training_cycle($1,$2) as value",
    [ids.episode, ids.cycle]), "Student cannot use Coach reader");
  stage = "individual photo permission";
  check(await value(coach, "select public.test_storage_read($1,$2) as value",
    ["progress-check-photos", "photo/a.jpg"]) === true, "old explicit report backfilled");
  check(await value(coach, "select public.test_storage_read($1,$2) as value",
    ["progress-check-photos", "photo/b.jpg"]) === false, "other check photo stays private");
  check(await value(student, "select public.set_own_progress_photo_shared($1,false) as value",
    [ids.photo]) === false, "Student revokes one photo");
  check(await value(coach, "select public.test_storage_read($1,$2) as value",
    ["progress-check-photos", "photo/a.jpg"]) === false, "Storage denies revoked photo");
  check((await value(coach, "select public.test_coach_report($1) as value", [ids.report]))
    .items.length === 0, "old report hides revoked asset metadata");
  check((await value(coach, "select public.list_own_coach_progress_reports() as value"))[0]
    .itemCount === 0, "report count reflects revoked photo");
  check(await value(student, "select public.set_own_progress_photo_shared($1,true) as value",
    [ids.privatePhoto]) === true, "Student shares exactly one previously private photo");
  check((await value(coach, "select public.list_shared_student_progress_photos($1) as value",
    [ids.episode])).map((item) => item.assetId).join() === ids.privatePhoto,
  "Coach list contains only currently authorized photos");
  await denied(value(other, "select public.list_shared_student_progress_photos($1) as value",
    [ids.episode]), "other Coach cannot enumerate shared photos");
  stage = "unlink and new Coach";
  await admin.query("update private.coach_relationship_episodes set ended_at=now() where id=$1", [ids.episode]);
  await denied(value(coach, "select public.get_own_coach_progress_report($1) as value", [ids.report]),
    "ended relationship cannot open report");
  await denied(value(coach, "select public.get_own_coach_student_record_subject($1) as value",
    [ids.episode]), "ended Coach loses subject access");
  await denied(value(coach, "select public.get_own_coach_student_training_cycle_version($1,$2,1) as value",
    [ids.episode, ids.cycle]), "ended Coach loses historical plan access");
  check(await value(coach, "select public.test_storage_read($1,$2) as value",
    ["progress-check-photos", "photo/b.jpg"]) === false, "ended Coach loses photo access");
  await admin.query(`insert into private.coach_relationship_episodes values
    ($1,$2,$3,'Alumno QA','student@example.test',now(),null)`,
  [ids.nextEpisode, ids.other, ids.student]);
  check(await value(other, "select public.test_storage_read($1,$2) as value",
    ["progress-check-photos", "photo/b.jpg"]) === false, "new Coach inherits no photo grant");
  console.log(`COACH_STUDENT_RECORD_LOCAL_POSTGRES=PASS (${assertions} checks; Unix socket only)`);
} catch (error) {
  console.error(`COACH_STUDENT_RECORD_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? "assertion"}: ${error.message}`);
  if (error.stderr) console.error(String(error.stderr).slice(-2000));
  if (started || stage === "start isolated PostgreSQL") {
    try { console.error(readFileSync(join(runtime, "server.log"), "utf8").slice(-2000)); }
    catch { /* Server may have failed before writing its log. */ }
  }
  process.exitCode = 1;
} finally {
  for (const client of clients.reverse()) await client.end().catch(() => {});
  if (started) {
    try { run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"],
      { stdio: "ignore" }); } catch { /* Temporary cluster cleanup. */ }
  }
  rmSync(runtime, { recursive: true, force: true });
}
