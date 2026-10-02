// Synthetic local PostgreSQL only: Unix socket, temporary cluster, no .env or QA/PROD.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Local PostgreSQL runner requires macOS arm64.");
}
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "org-photo-deletion-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = join(runtime, "postgres.jar");
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const connections = [];
let started = false;
let stage = "bootstrap";
let assertions = 0;

const ids = {
  coach: "10000000-0000-4000-8000-000000000001",
  student: "10000000-0000-4000-8000-000000000002",
  other: "10000000-0000-4000-8000-000000000003",
  publisher: "10000000-0000-4000-8000-000000000004",
  episode: "20000000-0000-4000-8000-000000000001",
};
const run = (command, args, options = {}) => execFileSync(command, args, { env: childEnv, ...options });
const migration = (name) => readFileSync(join(root, "supabase/migrations", name), "utf8");
const check = (condition, label) => {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  assertions += 1;
};
async function expectCode(promise, code, label) {
  try { await promise; } catch (error) {
    check(error.code === code, `${label}: expected ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`Assertion failed: ${label} unexpectedly succeeded`);
}
async function connect(userId = null, publisher = false) {
  const client = new pg.Client({ host: socket, port: 55446, user: "postgres",
    database: "postgres", ssl: false, statement_timeout: 20000,
    connectionTimeoutMillis: 5000 });
  await client.connect();
  connections.push(client);
  if (publisher) {
    await client.query("set role progress_photo_publisher");
    await client.query("select set_config('request.jwt.claim.role','progress_photo_publisher',false)");
  } else if (userId) await client.query("set role authenticated");
  if (userId) await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  return client;
}
async function scalar(client, sql, params = []) {
  const row = (await client.query(sql, params)).rows[0];
  return row ? Object.values(row)[0] : undefined;
}
async function photo(admin, owner = ids.student) {
  const assetId = randomUUID();
  const path = `${randomUUID()}/${assetId}.jpg`;
  await admin.query("insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)", [path]);
  await admin.query(`insert into private.progress_assets
    (id,student_user_id,kind,bucket_id,object_name,mime_type,extension,
      byte_size,width,height,sanitized_at,available_at)
    values($1,$2,'photo','progress-check-photos',$3,'image/jpeg','jpg',
      100,20,20,clock_timestamp(),clock_timestamp())`, [assetId, owner, path]);
  return { assetId, path };
}
async function checkWith(admin, assets, owner = ids.student) {
  const checkId = await scalar(admin, `insert into private.progress_checks
    (student_user_id,checked_on) values($1,(clock_timestamp() at time zone 'America/Santiago')::date)
    returning id`, [owner]);
  const poses = ["frente", "perfil", "espalda"];
  for (const [index, asset] of assets.entries()) {
    await admin.query(`insert into private.progress_check_photos
      (check_id,photo_asset_id,student_user_id,pose,position)
      values($1,$2,$3,$4,$5)`, [checkId, asset.assetId, owner, poses[index], index + 1]);
  }
  return checkId;
}

try {
  run("curl", ["-fsSL", "--max-time", "90", archiveUrl, "-o", archive]);
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === archiveHash,
    "pinned PostgreSQL binary hash");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"],
    { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"],
    { stdio: "ignore" });
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"),
    "-o", `-h '' -k ${socket} -p 55446 -c log_statement=none -c log_min_error_statement=panic`,
    "-w", "start"], { stdio: "ignore" });
  started = true;

  stage = "minimal local Supabase schema";
  const admin = await connect();
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role authenticator nologin;
    create role supabase_auth_admin nologin;
    create schema auth; create schema storage; create schema private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    create table public.user_registrations (user_id uuid primary key references auth.users(id));
    create table public.coach_registrations
      (user_id uuid primary key references auth.users(id), first_name text, last_name text);
    create table private.coach_relationship_episodes (
      id uuid primary key,
      coach_user_id uuid not null references public.coach_registrations(user_id),
      student_user_id uuid not null references public.user_registrations(user_id),
      ended_at timestamptz, unique (id, coach_user_id));
    create table private.evaluation_assignments (
      id uuid primary key, coach_user_id uuid not null, student_user_id uuid not null,
      relationship_episode_id uuid not null, send_batch_id uuid not null,
      snapshot jsonb not null, coach_name_snapshot text not null,
      student_name_snapshot text not null, sent_at timestamptz not null,
      due_at timestamptz, reopened_at timestamptz);
    create table private.evaluation_responses (
      assignment_id uuid primary key references private.evaluation_assignments(id),
      state text not null, answers jsonb not null, consent_confirmed boolean not null,
      draft_updated_at timestamptz, completed_at timestamptz);
    create table private.evaluation_notifications (
      id uuid primary key default gen_random_uuid(), assignment_id uuid,
      send_batch_id uuid, recipient_user_id uuid not null, portal_scope text not null,
      event_kind text not null, title text not null, body text not null,
      read_at timestamptz, created_at timestamptz not null);
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text not null
        references storage.buckets(id), name text not null, unique(bucket_id,name));
    alter table storage.objects enable row level security;
    alter table storage.objects force row level security;
    grant usage on schema public, storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    create function private.coach_public_name(p_coach_user_id uuid)
    returns text language sql stable security definer set search_path = '' as $$
      select nullif(btrim(concat_ws(' ',coach.first_name,coach.last_name)),'')
      from public.coach_registrations coach where coach.user_id=p_coach_user_id $$;
    create function private.lock_coach_invitation_owner()
    returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_owner uuid := auth.uid(); begin
      perform 1 from public.coach_registrations registration
        where registration.user_id=v_owner for update;
      if not found then raise exception 'coach_forbidden' using errcode='42501'; end if;
      return v_owner; end $$;
    create function private.evaluation_status(
      p_due_at timestamptz,p_state text,p_draft_updated_at timestamptz,
      p_reopened_at timestamptz,p_now timestamptz)
    returns text language sql stable as $$
      select case when p_state='completed' then 'completed'
        when p_due_at is not null and p_due_at<=p_now then 'expired'
        when p_state='draft' then 'draft' else 'pending' end $$;
    create function private.can_coach_read_medical_document_asset(uuid,uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $$ select false $$;
  `);
  await admin.query(`insert into auth.users(id,email) values
    ($1,'coach@example.test'),($2,'student@example.test'),
    ($3,'other@example.test'),($4,'publisher@example.test')`,
  [ids.coach, ids.student, ids.other, ids.publisher]);
  await admin.query("insert into public.user_registrations(user_id) values($1),($2)",
    [ids.student, ids.other]);
  await admin.query("insert into public.coach_registrations(user_id,first_name,last_name) values($1,'Coach','Test')", [ids.coach]);
  await admin.query(`insert into private.coach_relationship_episodes
    (id,coach_user_id,student_user_id) values($1,$2,$3)`,
  [ids.episode, ids.coach, ids.student]);

  stage = "apply forward-only migrations";
  for (const name of [
    "20260923184225_progress_records_private_storage_reports_phase1.sql",
    "20260924140000_progress_photo_staging_preparation.sql",
    "20260925004129_progress_photo_stage_volatility.sql",
    "20260925012214_progress_photo_select_volatility.sql",
    "20260930163231_progress_photo_student_gateway.sql",
    "20261001230633_progress_photo_original_staging_jpeg_publication.sql",
    "20261002014402_progress_photo_automatic_publication.sql",
  ]) await admin.query(migration(name));
  await admin.query("insert into private.progress_photo_principals(auth_user_id,state) values($1,'active')", [ids.publisher]);
  const student = await connect(ids.student);
  const other = await connect(ids.other);
  const coach = await connect(ids.coach);
  const publisher = await connect(ids.publisher, true);

  stage = "one-photo check and immediate Coach revocation";
  const single = await photo(admin);
  const singleCheck = await checkWith(admin, [single]);
  check((await scalar(student, "select public.list_own_progress_checks()" )).length === 1,
    "one-photo check visible before deletion");
  const report = await scalar(student, `select public.create_own_progress_report(
    'photos',array[$1]::uuid[],null,$2)`, [single.assetId, randomUUID()]);
  check(report.items.length === 1, "Coach report has photo before deletion");
  check((await scalar(coach, "select public.get_own_coach_progress_report($1)", [report.id])).items.length === 1,
    "Coach can read report before deletion");
  check(await scalar(coach, "select count(*)::int from storage.objects where bucket_id='progress-check-photos' and name=$1", [single.path]) === 1,
    "Coach can read private photo before deletion");
  check((await scalar(student, "select public.get_own_progress_photo_deletion_target($1)", [single.assetId])).kind === "check",
    "one-photo target requires check confirmation");
  await expectCode(student.query("select public.delete_own_progress_photo($1)", [single.assetId]),
    "P4090", "photo-only call cannot silently delete last check");
  check(await scalar(student, "select public.delete_own_progress_check($1)", [single.assetId]) === "check_deleted",
    "confirmed last-photo deletion removes check");
  check(await scalar(student, "select public.delete_own_progress_check($1)", [single.assetId]) === "already_deleted",
    "duplicate deletion is idempotent");
  check((await scalar(student, "select public.list_own_progress_checks()")).length === 0,
    "deleted one-photo check disappears for Student");
  check((await scalar(student, "select public.list_own_progress_photos()")).length === 0,
    "deleted photo disappears for Student before Storage cleanup");
  await expectCode(coach.query("select public.get_own_coach_progress_report($1)", [report.id]),
    "42501", "Coach report disappears immediately");
  check(await scalar(coach, "select count(*)::int from storage.objects where bucket_id='progress-check-photos' and name=$1", [single.path]) === 0,
    "Coach Storage read is revoked immediately");
  check(await scalar(student, "select count(*)::int from storage.objects where bucket_id='progress-check-photos' and name=$1", [single.path]) === 0,
    "Student Storage read is revoked immediately");
  check(await scalar(admin, "select count(*)::int from storage.objects where name=$1", [single.path]) === 1,
    "failed or pending Storage cleanup does not make photo visible");

  stage = "two- and three-photo checks, BOLA and stale tabs";
  const two = [await photo(admin), await photo(admin)];
  const twoCheck = await checkWith(admin, two);
  await expectCode(other.query("select public.delete_own_progress_photo($1)", [two[0].assetId]),
    "42501", "foreign photo deletion denied");
  await expectCode(other.query("select public.get_own_progress_photo_deletion_target($1)", [two[0].assetId]),
    "42501", "foreign target lookup denied");
  check(await scalar(student, "select public.delete_own_progress_photo($1)", [two[0].assetId]) === "photo_deleted",
    "first photo deletion keeps two-photo check");
  check((await scalar(student, "select public.list_own_progress_checks()"))[0].photos.length === 1,
    "two-photo check has one surviving photo");
  await expectCode(student.query("select public.delete_own_progress_photo($1)", [two[1].assetId]),
    "P4090", "stale second tab cannot delete last photo under photo confirmation");
  check(await scalar(student, "select public.delete_own_progress_check($1)", [two[1].assetId]) === "check_deleted",
    "fresh last-check confirmation succeeds");
  check(await scalar(admin, "select deleted_at is not null from private.progress_checks where id=$1", [twoCheck]) === true,
    "two-photo check tombstoned after last deletion");
  const three = [await photo(admin), await photo(admin), await photo(admin)];
  const threeCheck = await checkWith(admin, three);
  const partialReport = await scalar(student, `select public.create_own_progress_report(
    'photos',array[$1,$2,$3]::uuid[],null,$4)`, [
    three[0].assetId, three[1].assetId, three[2].assetId, randomUUID(),
  ]);
  check(await scalar(student, "select public.delete_own_progress_photo($1)", [three[0].assetId]) === "photo_deleted",
    "first three-photo deletion is photo-only");
  check((await scalar(coach, "select public.get_own_coach_progress_report($1)", [partialReport.id])).items.length === 2,
    "Coach report immediately loses only the deleted photo");
  check(await scalar(student, "select public.delete_own_progress_photo($1)", [three[1].assetId]) === "photo_deleted",
    "second three-photo deletion is photo-only");
  check((await scalar(coach, "select public.get_own_coach_progress_report($1)", [partialReport.id])).items.length === 1,
    "Coach report keeps only the surviving photo");
  check(await scalar(admin, "select deleted_at is null from private.progress_checks where id=$1", [threeCheck]) === true,
    "three-photo check persists with final surviving photo");
  check((await scalar(student, "select public.list_own_progress_checks()"))[0].photos.length === 1,
    "three-photo check lists only remaining photo");
  await expectCode(admin.query(`insert into private.progress_check_photos
    (check_id,photo_asset_id,student_user_id,pose,position)
    values($1,$2,$3,'espalda',3)`, [randomUUID(), three[0].assetId, ids.student]),
  "42501", "deleted asset cannot be attached to a new check");

  stage = "two tabs delete the same standalone photo";
  const standalone = await photo(admin);
  const secondTab = await connect(ids.student);
  const duplicates = await Promise.all([
    scalar(student, "select public.delete_own_progress_photo($1)", [standalone.assetId]),
    scalar(secondTab, "select public.delete_own_progress_photo($1)", [standalone.assetId]),
  ]);
  check(duplicates.includes("photo_deleted") && duplicates.includes("already_deleted"),
    "concurrent duplicate deletes commit once and remain idempotent");

  stage = "deleted Storage object and bounded technical cleanup";
  const cleanup = await scalar(publisher, "select public.claim_own_deleted_progress_photo_cleanup($1,3)", [ids.student]);
  check(cleanup.length === 3 && cleanup.some((item) => item.assetId === single.assetId),
    "technical cleanup claims only three exact deleted finals");
  await expectCode(publisher.query("select public.complete_deleted_progress_photo_cleanup($1)", [single.assetId]),
    "42501", "Storage failure keeps cleanup debt");
  await publisher.query("delete from storage.objects where bucket_id='progress-check-photos' and name=$1", [single.path]);
  await publisher.query("select public.complete_deleted_progress_photo_cleanup($1)", [single.assetId]);
  check(await scalar(admin, "select deleted_storage_cleaned_at is not null from private.progress_assets where id=$1", [single.assetId]) === true,
    "exact deleted final can be completed after Storage removal");
  check(await scalar(admin, "select count(*)::int from storage.objects where name=$1", [two[0].path]) === 1,
    "unrelated deleted final remains tracked until its own cleanup claim");

  stage = "concurrent different-photo deletion in one check";
  const simultaneous = [await photo(admin), await photo(admin)];
  await checkWith(admin, simultaneous);
  const concurrent = await Promise.allSettled([
    scalar(student, "select public.delete_own_progress_photo($1)", [simultaneous[0].assetId]),
    scalar(secondTab, "select public.delete_own_progress_photo($1)", [simultaneous[1].assetId]),
  ]);
  check(concurrent.filter((result) => result.status === "fulfilled"
    && result.value === "photo_deleted").length === 1,
  "only one concurrent photo deletion commits");
  check(concurrent.filter((result) => result.status === "rejected"
    && result.reason.code === "P4090").length === 1,
  "other tab must obtain fresh last-check confirmation");
  check((await scalar(student, "select public.list_own_progress_checks()"))
    .some((item) => item.photos.length === 1
      && item.photos.some((entry) => simultaneous.some((asset) => asset.assetId === entry.assetId))),
  "concurrent deletion keeps one-photo check intact");

  stage = "queued cancellation and already-published cancellation race";
  const queuedId = randomUUID();
  const queuedPath = `${randomUUID()}/${randomUUID()}.jpg`;
  await admin.query("insert into storage.objects(bucket_id,name) values('progress-check-staging',$1)", [queuedPath]);
  await admin.query(`with instant as (select clock_timestamp() as now)
    insert into private.progress_photo_uploads
    (id,student_user_id,object_name,pose,mime_type,extension,state,created_at,expires_at)
    select $1,$2,$3,'frente','image/jpeg','jpg','queued',instant.now,
      instant.now+interval '1 hour' from instant`, [queuedId, ids.student, queuedPath]);
  check(await scalar(student, "select public.abandon_own_progress_photo_upload($1)", [queuedId]) === "cleaning",
    "queued upload is cancelled by its owner");
  check(await scalar(publisher, "select public.claim_progress_photo_for_student($1,$2)", [ids.student, queuedId]) === null,
    "cancelled queued upload cannot be claimed automatically");
  check((await scalar(student, "select public.list_own_progress_photo_uploads()"))
    .every((upload) => upload.uploadId !== queuedId),
  "cancelled queued upload never reappears");
  const failedId = randomUUID();
  await admin.query(`with instant as (select clock_timestamp() as now)
    insert into private.progress_photo_uploads
    (id,student_user_id,object_name,pose,mime_type,extension,state,created_at,expires_at)
    select $1,$2,$3,'perfil','image/jpeg','jpg','cleanup_pending',instant.now,
      instant.now+interval '1 hour' from instant`,
  [failedId, ids.student, `${randomUUID()}/${randomUUID()}.jpg`]);
  check((await scalar(student, "select public.list_own_progress_photo_uploads()"))
    .some((upload) => upload.uploadId === failedId && upload.status === "fallida"),
  "failed non-cancelled upload remains visible as a safe error");
  check(await scalar(student, "select public.abandon_own_progress_photo_upload($1)", [failedId]) === "cleaning",
    "Student can dismiss an upload that failed before cancellation");
  check((await scalar(student, "select public.list_own_progress_photo_uploads()"))
    .every((upload) => upload.uploadId !== failedId),
  "explicitly cancelled failed upload stays hidden");
  const raced = await photo(admin);
  const racedUpload = randomUUID();
  await admin.query(`with instant as (select clock_timestamp() as now)
    insert into private.progress_photo_uploads
    (id,student_user_id,object_name,pose,mime_type,extension,state,
      final_asset_id,final_object_name,claimed_at,published_at,created_at,expires_at)
    select $1,$2,$3,'frente','image/jpeg','jpg','published',$4,$5,
      instant.now,instant.now,instant.now,instant.now+interval '1 hour' from instant`,
  [racedUpload, ids.student, `${randomUUID()}/${randomUUID()}.jpg`, raced.assetId, raced.path]);
  check(await scalar(student, "select public.abandon_own_progress_photo_upload($1)", [racedUpload]) === "cleaning",
    "cancel after unlinked publication hides the final asset");
  check(await scalar(admin, "select deleted_at is not null from private.progress_assets where id=$1", [raced.assetId]) === true,
    "late completed publication cannot reappear after cancellation");

  stage = "queued and processing cancellation blocks late publication";
  const queueId = randomUUID();
  const queuePath = `${randomUUID()}/${randomUUID()}.jpg`;
  await admin.query("insert into storage.objects(bucket_id,name) values('progress-check-staging',$1)", [queuePath]);
  await admin.query(`with instant as (select clock_timestamp() as now)
    insert into private.progress_photo_uploads
    (id,student_user_id,object_name,pose,mime_type,extension,state,created_at,expires_at)
    select $1,$2,$3,'frente','image/jpeg','jpg','queued',instant.now,
      instant.now+interval '1 hour' from instant`, [queueId, ids.student, queuePath]);
  const claim = await scalar(publisher, "select public.claim_progress_photo_for_student($1,$2)", [ids.student, queueId]);
  check(claim?.attemptId, "publisher claimed processing upload");
  check(await scalar(student, "select public.abandon_own_progress_photo_upload($1)", [queueId]) === "cleaning",
    "Student cancels processing photo");
  await expectCode(publisher.query(`select public.publish_verified_progress_photo_automatic(
    $1,$2,100,20,20)`, [queueId, claim.attemptId]), "42501",
  "late automatic publication cannot commit after cancellation");
  check((await scalar(student, "select public.list_own_progress_photo_uploads()"))
    .every((upload) => upload.uploadId !== queueId),
  "cancelled processing photo does not reappear in Student list");

  console.log(`Local PostgreSQL PASS: ${assertions} assertions; one/two/three photos, BOLA, duplicate, stale tab, Coach visibility, cleanup, cancellation.`);
} catch (error) {
  console.error(`Local PostgreSQL FAIL at ${stage}: ${error.stack ?? error.message}`);
  if (error.code) console.error(`PostgreSQL ${error.code}: ${error.where ?? error.detail ?? "no detail"}`);
  process.exitCode = 1;
} finally {
  for (const client of connections.reverse()) {
    try { await client.end(); } catch { /* Local cleanup. */ }
  }
  if (started) {
    try { run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"],
      { stdio: "ignore" }); } catch { /* Temporary directory is still removed. */ }
  }
  rmSync(runtime, { recursive: true, force: true });
}
