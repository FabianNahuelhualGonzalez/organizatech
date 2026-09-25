// Standalone synthetic PostgreSQL test. No .env, TCP, QA/PROD or app server.
// Uses a pinned PostgreSQL 17.5 artifact and removes its temporary cluster.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Local runner requires macOS arm64; SQL not verified.");
}
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "org-progress-records-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = join(runtime, "postgres.jar");
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const clients = [];
let started = false;
let stage = "bootstrap";
let checks = 0;

const ids = {
  coach: "10000000-0000-4000-8000-000000000001",
  student: "10000000-0000-4000-8000-000000000002",
  unlinked: "10000000-0000-4000-8000-000000000003",
  endedStudent: "10000000-0000-4000-8000-000000000004",
  otherCoach: "10000000-0000-4000-8000-000000000005",
  publisher: "10000000-0000-4000-8000-000000000006",
  replacementPublisher: "10000000-0000-4000-8000-000000000007",
  activeEpisode: "20000000-0000-4000-8000-000000000001",
  endedEpisode: "20000000-0000-4000-8000-000000000002",
  photo: "30000000-0000-4000-8000-000000000001",
  privatePhoto: "30000000-0000-4000-8000-000000000002",
  pendingPhoto: "30000000-0000-4000-8000-000000000003",
  endedPhoto: "30000000-0000-4000-8000-000000000004",
  document: "30000000-0000-4000-8000-000000000005",
  check: "40000000-0000-4000-8000-000000000001",
  endedCheck: "40000000-0000-4000-8000-000000000002",
  activeAssignment: "50000000-0000-4000-8000-000000000001",
  endedAssignment: "50000000-0000-4000-8000-000000000002",
  pendingAssignment: "50000000-0000-4000-8000-000000000003",
  expiredAssignment: "50000000-0000-4000-8000-000000000004",
};
const paths = {
  photo: `${ids.photo}/${randomUUID()}.jpg`,
  privatePhoto: `${ids.privatePhoto}/${randomUUID()}.png`,
  pendingPhoto: `${ids.pendingPhoto}/${randomUUID()}.heic`,
  endedPhoto: `${ids.endedPhoto}/${randomUUID()}.webp`,
  document: `${ids.document}/${randomUUID()}.pdf`,
};

const readSql = (path) => readFileSync(join(root, path), "utf8");
const run = (command, args, options = {}) => execFileSync(command, args, { env: childEnv, ...options });
const check = (condition, label) => {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks += 1;
};
const value = async (connection, sql, args = []) => (await connection.query(sql, args)).rows[0]?.value;
async function expectCode(operation, code, label) {
  try {
    await operation;
  } catch (error) {
    check(error.code === code, `${label}: expected ${code}, received ${error.code}`);
    return;
  }
  throw new Error(`Assertion failed: ${label}`);
}
async function connect(userId = null) {
  const connection = new pg.Client({
    host: socket,
    port: 55445,
    user: "postgres",
    database: "postgres",
    password: null,
    ssl: false,
    statement_timeout: 20000,
    connectionTimeoutMillis: 5000,
  });
  await connection.connect();
  clients.push(connection);
  if (userId) {
    await connection.query("set role authenticated");
    await connection.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  }
  return connection;
}
async function connectPublisher() {
  const connection = await connect();
  await connection.query("set role progress_photo_publisher");
  await connection.query("select set_config('request.jwt.claim.role','progress_photo_publisher',false)");
  await connection.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.publisher]);
  return connection;
}

try {
  run("curl", ["-fsSL", "--max-time", "90", archiveUrl, "-o", archive]);
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === archiveHash, "binary SHA-256");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  stage = "initdb";
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55445 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
    "-w", "start"], { stdio: "ignore" });
  started = true;

  stage = "minimal Supabase bootstrap";
  const admin = await connect();
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role authenticator nologin;
    create role supabase_auth_admin nologin;
    create schema auth;
    create schema storage;
    create schema private;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.users (id uuid primary key, email text);
    create table public.user_registrations (user_id uuid primary key references auth.users(id));
    create table public.coach_registrations (
      user_id uuid primary key references auth.users(id), first_name text, last_name text
    );
    create table private.coach_relationship_episodes (
      id uuid primary key,
      coach_user_id uuid not null references public.coach_registrations(user_id),
      student_user_id uuid not null references public.user_registrations(user_id),
      ended_at timestamptz,
      unique (id, coach_user_id)
    );
    create table private.evaluation_assignments (
      id uuid primary key,
      coach_user_id uuid not null,
      student_user_id uuid not null,
      relationship_episode_id uuid not null,
      send_batch_id uuid not null,
      snapshot jsonb not null,
      coach_name_snapshot text not null,
      student_name_snapshot text not null,
      sent_at timestamptz not null,
      due_at timestamptz,
      reopened_at timestamptz
    );
    create table private.evaluation_responses (
      assignment_id uuid primary key references private.evaluation_assignments(id),
      state text not null,
      answers jsonb not null,
      consent_confirmed boolean not null,
      draft_updated_at timestamptz,
      completed_at timestamptz
    );
    create table private.evaluation_notifications (
      id uuid primary key default gen_random_uuid(),
      assignment_id uuid,
      send_batch_id uuid,
      recipient_user_id uuid not null,
      portal_scope text not null,
      event_kind text not null,
      title text not null,
      body text not null,
      read_at timestamptz,
      created_at timestamptz not null
    );
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    alter table storage.objects force row level security;
    grant usage on schema public, storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    create function private.coach_public_name(p_coach_user_id uuid)
    returns text language sql stable security definer set search_path = '' as $$
      select nullif(btrim(concat_ws(' ', coach.first_name, coach.last_name)), '')
      from public.coach_registrations coach where coach.user_id = p_coach_user_id
    $$;
    create function private.lock_coach_invitation_owner()
    returns uuid language plpgsql security definer set search_path = '' as $$
    declare v_owner uuid := auth.uid();
    begin
      perform registration.user_id from public.coach_registrations registration
      where registration.user_id = v_owner for update;
      if not found then raise exception 'coach_forbidden' using errcode = '42501'; end if;
      return v_owner;
    end
    $$;
    create function private.evaluation_status(
      p_due_at timestamptz, p_state text, p_draft_updated_at timestamptz,
      p_reopened_at timestamptz, p_now timestamptz
    ) returns text language sql stable as $$
      select case when p_state = 'completed' then 'completed'
        when p_due_at is not null and p_due_at <= p_now then 'expired'
        when p_state = 'draft' then 'draft' else 'pending' end
    $$;
  `);

  await admin.query(
    "insert into auth.users(id,email) select * from unnest($1::uuid[],$2::text[])",
    [[ids.coach, ids.student, ids.unlinked, ids.endedStudent, ids.otherCoach,
      ids.publisher, ids.replacementPublisher], [
      "coach@example.test", "student@example.test", "unlinked@example.test",
      "ended@example.test", "other-coach@example.test", "publisher@example.test",
      "replacement-publisher@example.test",
    ]],
  );
  await admin.query(
    "insert into public.user_registrations(user_id) select unnest($1::uuid[])",
    [[ids.student, ids.unlinked, ids.endedStudent]],
  );
  await admin.query(
    "insert into public.coach_registrations(user_id,first_name,last_name) values($1,'Coach','Activo'),($2,'Coach','Otro')",
    [ids.coach, ids.otherCoach],
  );
  await admin.query(
    "insert into private.coach_relationship_episodes(id,coach_user_id,student_user_id,ended_at) values($1,$2,$3,null),($4,$5,$6,clock_timestamp())",
    [ids.activeEpisode, ids.coach, ids.student, ids.endedEpisode, ids.otherCoach, ids.endedStudent],
  );

  stage = "apply migration";
  await admin.query(readSql("supabase/migrations/20260923184225_progress_records_private_storage_reports_phase1.sql"));
  await admin.query(readSql("supabase/migrations/20260924140000_progress_photo_staging_preparation.sql"));
  const stageFunctionBefore = await value(admin, `select to_jsonb(procedure) as value
    from pg_proc procedure
    where procedure.oid = 'private.can_stage_own_progress_photo(text,text)'::regprocedure`);
  check(stageFunctionBefore.provolatile === "s", "applied staging migration declares stable function");
  await admin.query(readSql("supabase/migrations/20260925004129_progress_photo_stage_volatility.sql"));
  const stageFunctionAfter = await value(admin, `select to_jsonb(procedure) as value
    from pg_proc procedure
    where procedure.oid = 'private.can_stage_own_progress_photo(text,text)'::regprocedure`);
  check(stageFunctionAfter.provolatile === "v", "follow-up migration makes staging function volatile");
  check(stageFunctionAfter.prosecdef === true,
    "security definer is preserved");
  check(stageFunctionBefore.proconfig?.some((setting) => setting.startsWith("search_path="))
    && isDeepStrictEqual(stageFunctionAfter.proconfig, stageFunctionBefore.proconfig),
  "function search_path is preserved");
  check(isDeepStrictEqual(stageFunctionAfter.proacl, stageFunctionBefore.proacl),
    "function grants are preserved");
  const { provolatile: beforeVolatility, ...beforeAttributes } = stageFunctionBefore;
  const { provolatile: afterVolatility, ...afterAttributes } = stageFunctionAfter;
  check(beforeVolatility === "s" && afterVolatility === "v"
    && isDeepStrictEqual(afterAttributes, beforeAttributes),
  "volatility is the only pg_proc attribute changed");
  await admin.query(`insert into private.progress_photo_principals(auth_user_id,state)
    values($1,'active')`, [ids.publisher]);
  await expectCode(admin.query(`insert into private.progress_photo_principals(auth_user_id,state)
    values($1,'active')`, [ids.replacementPublisher]), "23505",
  "distinct technical UUIDs cannot both be active");
  await admin.query(`with revoked as (select clock_timestamp() as at)
    insert into private.progress_photo_principals
      (auth_user_id,state,created_at,updated_at,revoked_at)
    select $1,'revoked',revoked.at,revoked.at,revoked.at from revoked`,
  [ids.replacementPublisher]);
  check(await value(admin, `select count(*)::int as value
    from private.progress_photo_principals where state='revoked'`) === 1,
  "active and revoked technical principals may coexist");
  await expectCode(admin.query(`update private.progress_photo_principals
    set state='active', revoked_at=null, updated_at=clock_timestamp()
    where auth_user_id=$1`, [ids.replacementPublisher]), "23505",
  "revoked replacement cannot activate before current principal is revoked");
  await admin.query(`
    create function public.get_own_student_evaluation(p_assignment_id uuid)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare v_student uuid := private.student_evaluation_identity(); v_result jsonb;
    begin
      if p_assignment_id is null then raise exception 'evaluation_invalid_assignment' using errcode = '22023'; end if;
      v_result := private.student_evaluation_view(p_assignment_id, v_student, clock_timestamp());
      if v_result is null then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
      return v_result;
    end
    $$;
    create function public.save_own_evaluation_draft(
      p_assignment_id uuid, p_answers jsonb, p_consent_confirmed boolean, p_request_id uuid
    ) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare v_student uuid := private.student_evaluation_identity();
    begin
      perform assignment.id from private.evaluation_assignments assignment
      join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
      where assignment.id = p_assignment_id and assignment.student_user_id = v_student
        and episode.ended_at is null;
      if not found then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
      return jsonb_build_object('status', 'draft');
    end
    $$;
    create function public.submit_own_evaluation(
      p_assignment_id uuid, p_answers jsonb, p_consent_confirmed boolean, p_request_id uuid
    ) returns jsonb language plpgsql security definer set search_path = '' as $$
    declare v_student uuid := private.student_evaluation_identity();
    begin
      perform assignment.id from private.evaluation_assignments assignment
      join private.coach_relationship_episodes episode on episode.id = assignment.relationship_episode_id
      where assignment.id = p_assignment_id and assignment.student_user_id = v_student
        and episode.ended_at is null;
      if not found then raise exception 'evaluation_assignment_forbidden' using errcode = '42501'; end if;
      return jsonb_build_object('status', 'completed');
    end
    $$;
    grant execute on function public.get_own_student_evaluation(uuid),
      public.save_own_evaluation_draft(uuid, jsonb, boolean, uuid),
      public.submit_own_evaluation(uuid, jsonb, boolean, uuid)
      to authenticated;
  `);

  const student = await connect(ids.student);
  const coach = await connect(ids.coach);
  const unlinked = await connect(ids.unlinked);
  const endedStudent = await connect(ids.endedStudent);
  const otherCoach = await connect(ids.otherCoach);
  const publisher = await connectPublisher();
  const anonymous = await connect();
  await anonymous.query("set role anon");

  stage = "custom access token hook authorization";
  const authAdmin = await connect();
  await authAdmin.query("set role supabase_auth_admin");
  const eventFor = (userId) => ({ user_id: userId, claims: {
    sub: userId, role: "authenticated", iat: 1000000, exp: 1003600,
    user_metadata: { role: "progress_photo_publisher" },
  } });
  const normalEvent = eventFor(ids.student);
  check(isDeepStrictEqual(await value(authAdmin,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(normalEvent)]), normalEvent),
  "normal user claims remain unchanged despite user_metadata");
  const publisherClaims = (await value(authAdmin,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(eventFor(ids.publisher))])).claims;
  check(publisherClaims.role === "progress_photo_publisher" && publisherClaims.exp === 1000900,
    "active technical principal receives only a 15-minute publisher role");
  check(isDeepStrictEqual(await value(authAdmin,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(eventFor(ids.replacementPublisher))]), eventFor(ids.replacementPublisher)),
  "revoked replacement principal receives no publisher role while another is active");
  check(await value(admin, `select rolcanlogin = false and rolbypassrls = false as value
    from pg_roles where rolname = 'progress_photo_publisher'`) === true,
  "publisher role cannot log in or bypass RLS");
  check(await value(admin, `select prosecdef = false as value from pg_proc
    where oid = 'private.progress_photo_access_token_hook(jsonb)'::regprocedure`) === true,
  "hook executes as invoker");
  check(await value(admin, `select has_function_privilege('supabase_auth_admin',
    'private.progress_photo_access_token_hook(jsonb)', 'EXECUTE') as value`) === true,
  "only Auth admin may execute hook");
  for (const role of ["anon", "authenticated"]) {
    check(await value(admin, `select has_function_privilege($1,
      'private.progress_photo_access_token_hook(jsonb)', 'EXECUTE') as value`, [role]) === false,
    `${role} cannot execute hook`);
    check(await value(admin, `select has_table_privilege($1,
      'private.progress_photo_principals', 'SELECT') as value`, [role]) === false,
    `${role} cannot read technical principals`);
  }
  await expectCode(value(student,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(eventFor(ids.student))]), "42501", "browser cannot invoke Auth hook");
  await expectCode(value(anonymous,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(eventFor(ids.publisher))]), "42501", "anonymous cannot invoke Auth hook");

  stage = "active relationship authorization";
  const access = await value(student, "select public.get_own_student_progress_access() as value");
  check(access.relationshipEpisodeId === ids.activeEpisode, "active student receives relationship context");
  check(access.coachUserId === ids.coach, "coach is derived server-side");
  await expectCode(
    value(unlinked, "select public.get_own_student_progress_access() as value"),
    "42501",
    "student without relationship is denied",
  );
  await expectCode(
    value(endedStudent, "select public.get_own_student_progress_access() as value"),
    "42501",
    "ended relationship is denied",
  );
  await expectCode(
    value(coach, "select public.get_own_student_progress_access() as value"),
    "42501",
    "Coach-only identity cannot enter student surface",
  );

  stage = "private resumable photo staging";
  await admin.query("create policy synthetic_broad_insert on storage.objects for insert to authenticated with check (true)");
  await admin.query("create policy synthetic_broad_select on storage.objects for select to authenticated using (true)");
  await admin.query("create policy synthetic_broad_update on storage.objects for update to authenticated using (true) with check (true)");
  await admin.query("create policy synthetic_broad_delete on storage.objects for delete to authenticated using (true)");
  await expectCode(value(unlinked,
    "select public.begin_own_progress_photo_upload('frente','jpeg') as value"),
    "42501", "unlinked Student cannot reserve staging");
  await expectCode(value(coach,
    "select public.begin_own_progress_photo_upload('frente','jpeg') as value"),
    "42501", "Coach cannot reserve staging");
  const staged = await value(student,
    "select public.begin_own_progress_photo_upload('frente','jpeg') as value");
  check(staged.bucketId === "progress-check-staging" && staged.mimeType === "image/jpeg",
    "server fixes private staging bucket and MIME");
  check(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(staged.objectName),
    "server generates opaque staging path");
  await expectCode(unlinked.query(
    "insert into storage.objects(bucket_id,name) values($1,$2)",
    [staged.bucketId, staged.objectName]), "42501", "other Student cannot write staging");
  await expectCode(student.query(
    "insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)",
    [`${randomUUID()}/${randomUUID()}.jpg`]), "42501", "broad policy cannot open final writes");
  await expectCode(anonymous.query(
    "insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)",
    [`${randomUUID()}/${randomUUID()}.jpg`]), "42501", "anonymous cannot write final bucket");
  await student.query("insert into storage.objects(bucket_id,name) values($1,$2)",
    [staged.bucketId, staged.objectName]);
  check(await value(student, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [staged.bucketId, staged.objectName]) === 1, "owner can read staged object");
  check(await value(coach, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [staged.bucketId, staged.objectName]) === 0, "Coach cannot read staging");
  check((await student.query(
    "update storage.objects set name=$1 where bucket_id=$2 and name=$3",
    [`${randomUUID()}/${randomUUID()}.jpg`, staged.bucketId, staged.objectName])).rowCount === 0,
  "broad policy cannot overwrite staging");
  await expectCode(value(unlinked,
    "select public.finalize_own_progress_photo_upload($1::uuid) as value", [staged.uploadId]),
    "42501", "other Student cannot finalize reservation");
  await expectCode(value(student, "select public.claim_progress_photo_for_verification() as value"),
    "42501", "browser role cannot claim publisher work");
  await expectCode(value(anonymous, "select public.claim_progress_photo_for_verification() as value"),
    "42501", "anonymous role cannot claim publisher work");
  await expectCode(value(student,
    "select public.publish_verified_progress_photo($1::uuid,1024,100,200) as value",
    [staged.uploadId]), "42501", "browser role cannot invoke publisher RPC");
  check(await value(student,
    "select public.finalize_own_progress_photo_upload($1::uuid) as value", [staged.uploadId])
    === staged.uploadId, "Student queues only own reservation");
  await expectCode(value(student,
    "select public.finalize_own_progress_photo_upload($1::uuid) as value", [staged.uploadId]),
    "42501", "queue replay is denied");
  check(await value(admin, "select count(*)::int as value from private.progress_assets where kind='photo'") === 0,
    "browser queue cannot publish final assets");
  const claimed = await value(publisher,
    "select public.claim_progress_photo_for_verification() as value");
  check(claimed.uploadId === staged.uploadId && claimed.stagingPath === staged.objectName,
    "publisher claims only queued reservation");
  check(await value(publisher,
    "select public.claim_progress_photo_for_verification() as value") === null,
    "publisher claim cannot replay processing reservation");
  await expectCode(student.query(
    "insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)",
    [claimed.finalPath]), "42501", "browser cannot write even known reserved final path");
  await publisher.query("insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)",
    [claimed.finalPath]);
  check(await value(student,
    "select count(*)::int as value from storage.objects where bucket_id='progress-check-photos' and name=$1",
    [claimed.finalPath]) === 0, "browser cannot read unpublished final candidate");
  check((await student.query(
    "update storage.objects set name=$1 where bucket_id='progress-check-photos' and name=$2",
    [`${randomUUID()}/${randomUUID()}.jpg`, claimed.finalPath])).rowCount === 0,
  "browser cannot overwrite reserved final candidate");
  await expectCode(value(publisher,
    "select public.publish_verified_progress_photo($1::uuid,1024,100,200) as value",
    [staged.uploadId]), "42501", "publication requires staging cleanup");
  await publisher.query("delete from storage.objects where bucket_id=$1 and name=$2",
    [staged.bucketId, staged.objectName]);
  const publishedAssetId = await value(publisher,
    "select public.publish_verified_progress_photo($1::uuid,1024,100,200) as value",
    [staged.uploadId]);
  check(await value(student, "select count(*)::int as value from storage.objects where bucket_id='progress-check-photos' and name=$1",
    [claimed.finalPath]) === 1, "Student reads published private final photo");
  check(await value(coach, "select count(*)::int as value from storage.objects where bucket_id='progress-check-photos' and name=$1",
    [claimed.finalPath]) === 0, "Coach cannot read unreported final photo");
  await expectCode(value(publisher,
    "select public.publish_verified_progress_photo($1::uuid,1024,100,200) as value",
    [staged.uploadId]), "42501", "publication replay is denied");
  check(publishedAssetId === (await value(admin,
    "select final_asset_id as value from private.progress_photo_uploads where id=$1", [staged.uploadId])),
  "published asset ID is generated by server");
  check((await publisher.query("delete from storage.objects where bucket_id='progress-check-photos' and name=$1",
    [claimed.finalPath])).rowCount === 0, "publisher cannot delete historical final asset");
  check((await student.query("delete from storage.objects where bucket_id='progress-check-photos' and name=$1",
    [claimed.finalPath])).rowCount === 0, "broad policy cannot delete historical final asset");
  const pendingStage = await value(student,
    "select public.begin_own_progress_photo_upload('perfil','jpeg') as value");
  await student.query("insert into storage.objects(bucket_id,name) values($1,$2)",
    [pendingStage.bucketId, pendingStage.objectName]);
  check(await value(student,
    "select public.finalize_own_progress_photo_upload($1::uuid) as value", [pendingStage.uploadId])
    === pendingStage.uploadId, "second reservation queues before unlink");
  const expiredStage = await value(student,
    "select public.begin_own_progress_photo_upload('espalda','jpeg') as value");
  await student.query("insert into storage.objects(bucket_id,name) values($1,$2)",
    [expiredStage.bucketId, expiredStage.objectName]);
  await admin.query("update private.progress_photo_uploads set created_at=clock_timestamp()-interval '2 hours', expires_at=clock_timestamp()-interval '1 hour 1 second' where id=$1",
    [expiredStage.uploadId]);
  await expectCode(value(student,
    "select public.finalize_own_progress_photo_upload($1::uuid) as value", [expiredStage.uploadId]),
    "42501", "expired staging cannot enter verification queue");
  const cleanupItems = await value(publisher,
    "select public.claim_expired_progress_photo_cleanup(3) as value");
  check(cleanupItems.length === 1 && cleanupItems[0].uploadId === expiredStage.uploadId,
    "cleanup claims only expired reservation within bound");
  await expectCode(value(publisher,
    "select public.complete_progress_photo_cleanup($1::uuid) as value", [expiredStage.uploadId]),
    "42501", "cleanup cannot complete while staging object remains");
  await publisher.query("delete from storage.objects where bucket_id=$1 and name=$2",
    [expiredStage.bucketId, expiredStage.objectName]);
  await value(publisher,
    "select public.complete_progress_photo_cleanup($1::uuid) as value", [expiredStage.uploadId]);
  check(await value(admin,
    "select state as value from private.progress_photo_uploads where id=$1", [expiredStage.uploadId])
    === "cleaned", "expired staging cleanup completes without final deletion");
  await value(student, "select public.begin_own_progress_photo_upload('frente','jpeg') as value");
  await value(student, "select public.begin_own_progress_photo_upload('espalda','webp') as value");
  await expectCode(value(student,
    "select public.begin_own_progress_photo_upload('frente','jpeg') as value"),
    "22023", "active staging reservations are bounded per Student");
  await admin.query("drop policy synthetic_broad_insert on storage.objects");
  await admin.query("drop policy synthetic_broad_select on storage.objects");
  await admin.query("drop policy synthetic_broad_update on storage.objects");
  await admin.query("drop policy synthetic_broad_delete on storage.objects");

  stage = "MIME size and opaque path constraints";
  const now = new Date().toISOString();
  await admin.query(`
    insert into private.progress_assets(
      id,student_user_id,kind,bucket_id,object_name,mime_type,extension,byte_size,
      width,height,sanitized_at,available_at,created_at
    ) values
      ($1,$2,'photo','progress-check-photos',$3,'image/jpeg','jpg',1024,3024,4032,$7,$7,$7),
      ($4,$2,'photo','progress-check-photos',$5,'image/png','png',2048,2048,2732,$7,$7,$7),
      ($6,$2,'photo','progress-check-photos',$8,'image/heic','heic',4096,null,null,null,null,$7)
  `, [ids.photo, ids.student, paths.photo, ids.privatePhoto, paths.privatePhoto, ids.pendingPhoto, now, paths.pendingPhoto]);
  await admin.query(`
    insert into private.progress_assets(
      id,student_user_id,kind,bucket_id,object_name,mime_type,extension,byte_size,
      width,height,sanitized_at,available_at,created_at
    ) values($1,$2,'photo','progress-check-photos',$3,'image/webp','webp',1024,1080,1440,$4,$4,$4)
  `, [ids.endedPhoto, ids.endedStudent, paths.endedPhoto, now]);
  await admin.query(`
    insert into private.progress_assets(
      id,student_user_id,kind,bucket_id,object_name,display_name,document_category,
      mime_type,extension,byte_size,available_at,created_at
    ) values($1,$2,'medical_document','progress-medical-documents',$3,'Examen','examen_medico',
      'application/pdf','pdf',1024,$4,$4)
  `, [ids.document, ids.student, paths.document, now]);
  await expectCode(admin.query(`
    insert into private.progress_assets(
      id,student_user_id,kind,bucket_id,object_name,mime_type,extension,byte_size,created_at
    ) values(gen_random_uuid(),$1,'photo','progress-check-photos',$2,'image/jpeg','png',1,$3)
  `, [ids.student, `${randomUUID()}/${randomUUID()}.png`, now]), "23514", "MIME and extension mismatch rejected");
  await expectCode(admin.query(`
    insert into private.progress_assets(
      id,student_user_id,kind,bucket_id,object_name,mime_type,extension,byte_size,created_at
    ) values(gen_random_uuid(),$1,'photo','progress-check-photos',$2,'image/jpeg','jpg',20971521,$3)
  `, [ids.student, `${randomUUID()}/${randomUUID()}.jpg`, now]), "23514", "photo over 20 MB rejected");
  await expectCode(admin.query(`
    insert into private.progress_assets(
      id,student_user_id,kind,bucket_id,object_name,display_name,document_category,
      mime_type,extension,byte_size,available_at,created_at
    ) values(gen_random_uuid(),$1,'medical_document','progress-medical-documents',$2,'Grande','otro',
      'application/pdf','pdf',26214401,$3,$3)
  `, [ids.student, `${randomUUID()}/${randomUUID()}.pdf`, now]), "23514", "PDF over 25 MB rejected");
  await admin.query(
    "insert into private.progress_checks(id,student_user_id,checked_on,created_at) values($1,$2,current_date,$4),($3,$5,current_date,$4)",
    [ids.check, ids.student, ids.endedCheck, now, ids.endedStudent],
  );
  await admin.query(
    "insert into private.progress_check_photos(check_id,photo_asset_id,student_user_id,pose,position,created_at) values($1,$2,$3,'frente',1,$6),($1,$4,$3,'perfil',2,$6),($5,$7,$8,'frente',1,$6)",
    [ids.check, ids.photo, ids.student, ids.privatePhoto, ids.endedCheck, now, ids.endedPhoto, ids.endedStudent],
  );
  for (const [bucket, name] of [
    ["progress-check-photos", paths.photo], ["progress-check-photos", paths.privatePhoto],
    ["progress-check-photos", paths.pendingPhoto], ["progress-check-photos", paths.endedPhoto],
    ["progress-medical-documents", paths.document],
  ]) await admin.query("insert into storage.objects(bucket_id,name) values($1,$2)", [bucket, name]);

  stage = "Storage default deny and report BOLA";
  await expectCode(
    student.query("insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)", [`${randomUUID()}/${randomUUID()}.jpg`]),
    "42501",
    "direct client upload is denied until trusted sanitizer exists",
  );
  check(await value(student, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 1,
    "active student reads own sanitized photo");
  check(await value(student, "select count(*)::int as value from storage.objects where name=$1", [paths.pendingPhoto]) === 0,
    "pending unsanitized photo is never served");
  check(await value(coach, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 0,
    "Coach cannot read unshared photo");
  check(await value(endedStudent, "select count(*)::int as value from storage.objects where name=$1", [paths.endedPhoto]) === 1,
    "unlinked student retains own available sanitized photo");
  check(await value(endedStudent, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 0,
    "unlinked student cannot read another student's object");
  check(await value(unlinked, "select count(*)::int as value from storage.objects where name=$1", [paths.endedPhoto]) === 0,
    "another student is denied by Storage ownership");

  const requestId = randomUUID();
  const report = await value(student,
    "select public.create_own_progress_report('photos',$1::uuid[],$2,$3::uuid) as value",
    [[ids.photo], "Revisión", requestId]);
  check(report.items.length === 1 && report.items[0].assetId === ids.photo, "student shares exact selected photo");
  const idempotentReport = await value(student,
    "select public.create_own_progress_report('photos',$1::uuid[],$2,$3::uuid) as value",
    [[ids.photo], "Revisión", requestId]);
  check(idempotentReport.id === report.id, "same request is idempotent");
  await expectCode(
    value(student, "select public.create_own_progress_report('photos',$1::uuid[],$2,$3::uuid) as value",
      [[ids.photo], "Carga distinta", requestId]),
    "55000",
    "idempotency key rejects a different payload",
  );
  check(await value(coach, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 1,
    "recipient Coach reads selected photo");
  check(await value(coach, "select count(*)::int as value from storage.objects where name=$1", [paths.privatePhoto]) === 0,
    "recipient Coach cannot read unselected photo");
  check(await value(otherCoach, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 0,
    "other Coach is denied by BOLA policy");
  await expectCode(
    value(student, "select public.create_own_progress_report('photos',$1::uuid[],null,$2::uuid) as value", [[ids.endedPhoto], randomUUID()]),
    "42501",
    "student cannot share another owner's asset",
  );
  await expectCode(
    value(student, "select public.create_own_progress_report('photos',$1::uuid[],null,$2::uuid) as value", [[ids.pendingPhoto], randomUUID()]),
    "42501",
    "student cannot share unsanitized photo",
  );
  const documentReport = await value(student,
    "select public.create_own_progress_report('medical_document',$1::uuid[],null,$2::uuid) as value",
    [[ids.document], randomUUID()]);
  check(documentReport.items.length === 1 && documentReport.items[0].assetId === ids.document,
    "student shares exactly the selected PDF");
  check(await value(coach, "select count(*)::int as value from storage.objects where name=$1", [paths.document]) === 1,
    "recipient Coach reads selected PDF while linked");
  check((await value(coach, "select public.get_own_coach_progress_report($1::uuid) as value", [report.id])).id === report.id,
    "Coach direct report access is allowed while linked");
  await expectCode(
    value(unlinked, "select public.get_own_student_progress_report($1::uuid) as value", [report.id]),
    "42501",
    "another student cannot read the report by direct id",
  );
  check((await value(coach, "select public.review_own_coach_progress_report($1::uuid) as value", [report.id])).reviewedAt !== null,
    "Coach review is idempotently recorded outside immutable report");
  await expectCode(
    admin.query("update private.progress_reports set message='mutated' where id=$1", [report.id]),
    "55000",
    "report is immutable",
  );
  check(await value(admin, "select count(*)::int as value from private.progress_report_delivery_intents where report_id=$1", [report.id]) === 2,
    "notification and email intents are prepared without delivery");

  stage = "historical evaluation retention and immediate Coach revocation";
  await admin.query(`
    insert into private.evaluation_assignments(
      id,coach_user_id,student_user_id,relationship_episode_id,send_batch_id,snapshot,
      coach_name_snapshot,student_name_snapshot,sent_at,due_at
    ) values
      ($1,$2,$3,$4,gen_random_uuid(),'{}','Coach Activo','Alumno Activo',clock_timestamp(),clock_timestamp() + interval '7 days'),
      ($5,$6,$7,$8,gen_random_uuid(),'{}','Coach Otro','Alumno Terminado',clock_timestamp(),clock_timestamp() + interval '7 days'),
      ($9,$2,$3,$4,gen_random_uuid(),'{}','Coach Activo','Alumno Activo',clock_timestamp(),clock_timestamp() + interval '7 days'),
      ($10,$2,$3,$4,gen_random_uuid(),'{}','Coach Activo','Alumno Activo',clock_timestamp(),clock_timestamp() - interval '1 day')
  `, [ids.activeAssignment, ids.coach, ids.student, ids.activeEpisode,
    ids.endedAssignment, ids.otherCoach, ids.endedStudent, ids.endedEpisode,
    ids.pendingAssignment, ids.expiredAssignment]);
  await admin.query(`
    insert into private.evaluation_responses(
      assignment_id,state,answers,consent_confirmed,draft_updated_at,completed_at
    ) values($1,'completed','{"answer":"private"}',true,clock_timestamp(),clock_timestamp()),
      ($2,'completed','{"answer":"ended"}',true,clock_timestamp(),clock_timestamp()),
      ($3,'draft','{"answer":"draft"}',false,clock_timestamp(),null)
  `, [ids.activeAssignment, ids.endedAssignment, ids.pendingAssignment]);
  check((await value(student, "select public.list_own_student_evaluations() as value")).length === 3,
    "active student lists completed, draft and expired evaluations");
  check((await value(endedStudent, "select public.list_own_student_evaluations() as value")).length === 1,
    "already unlinked student retains only completed evaluation");
  check((await value(coach, "select public.list_own_coach_evaluation_assignments() as value")).length === 3,
    "active Coach lists current evaluations");

  await admin.query("update private.coach_relationship_episodes set ended_at=clock_timestamp() where id=$1", [ids.activeEpisode]);
  check(await value(publisher,
    "select public.claim_progress_photo_for_verification() as value") === null,
    "publisher cannot claim queued photo after unlink");
  check(await value(student, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [pendingStage.bucketId, pendingStage.objectName]) === 0, "staging access closes after unlink");
  await expectCode(value(student,
    "select public.finalize_own_progress_photo_upload($1::uuid) as value", [pendingStage.uploadId]),
    "42501", "unlinked Student cannot finalize staging");
  check((await value(student, "select public.get_own_student_progress_report($1::uuid) as value", [report.id])).id === report.id,
    "persisted student session retains its own historical report");
  check((await value(student, "select public.get_own_student_progress_report($1::uuid) as value", [documentReport.id])).id === documentReport.id,
    "unlinked student retains its own historical document report");
  await expectCode(
    value(unlinked, "select public.get_own_student_progress_report($1::uuid) as value", [report.id]),
    "42501",
    "another student remains denied after unlink",
  );
  await expectCode(
    value(coach, "select public.get_own_coach_progress_report($1::uuid) as value", [report.id]),
    "42501",
    "Coach loses direct report access immediately",
  );
  check(await value(student, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 1,
    "student direct object access remains limited to own sanitized history");
  check(await value(student, "select count(*)::int as value from storage.objects where name=$1", [paths.document]) === 1,
    "student retains own historical PDF");
  check(await value(coach, "select count(*)::int as value from storage.objects where name=$1", [paths.photo]) === 0,
    "Coach direct object URL is revoked immediately");
  check(await value(coach, "select count(*)::int as value from storage.objects where name=$1", [paths.document]) === 0,
    "Coach PDF object URL is revoked immediately");
  await expectCode(
    value(coach, "select public.review_own_coach_progress_report($1::uuid) as value", [report.id]),
    "42501",
    "Coach cannot mutate review state after unlink",
  );
  check((await value(student, "select public.list_own_student_evaluations() as value")).length === 1,
    "unlinked student retains only completed evaluations");
  check((await value(student, "select public.get_own_student_evaluation($1::uuid) as value", [ids.activeAssignment])).id === ids.activeAssignment,
    "unlinked student reads own completed evaluation by direct id");
  await expectCode(
    value(student, "select public.get_own_student_evaluation($1::uuid) as value", [ids.pendingAssignment]),
    "42501",
    "unlinked student cannot read a draft by direct id",
  );
  await expectCode(
    value(unlinked, "select public.get_own_student_evaluation($1::uuid) as value", [ids.activeAssignment]),
    "42501",
    "another student cannot read a completed evaluation by direct id",
  );
  await expectCode(
    value(student, "select public.save_own_evaluation_draft($1::uuid,'{}'::jsonb,false,$2::uuid) as value",
      [ids.pendingAssignment, randomUUID()]),
    "42501",
    "unlinked student cannot edit a pending evaluation",
  );
  await expectCode(
    value(student, "select public.submit_own_evaluation($1::uuid,'{}'::jsonb,true,$2::uuid) as value",
      [ids.expiredAssignment, randomUUID()]),
    "42501",
    "unlinked student cannot submit an expired evaluation",
  );
  check((await value(coach, "select public.list_own_coach_evaluation_assignments() as value")).length === 0,
    "Coach completed answers disappear after unlink");

  stage = "technical principal revocation";
  const forgedPublisher = await connect();
  await forgedPublisher.query("set role progress_photo_publisher");
  await forgedPublisher.query("select set_config('request.jwt.claim.role','progress_photo_publisher',false)");
  await forgedPublisher.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.student]);
  await expectCode(value(forgedPublisher,
    "select public.claim_progress_photo_for_verification() as value"),
    "42501", "publisher claim with normal user identity is denied");
  await admin.query(`with revoked as (select clock_timestamp() as at)
    update private.progress_photo_principals
    set state='revoked', revoked_at=revoked.at, updated_at=revoked.at
    from revoked where auth_user_id=$1`, [ids.publisher]);
  check(isDeepStrictEqual(await value(authAdmin,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(eventFor(ids.publisher))]), eventFor(ids.publisher)),
  "revoked principal receives no publisher role on a new token");
  await expectCode(value(publisher,
    "select public.claim_progress_photo_for_verification() as value"),
    "42501", "revocation blocks an outstanding publisher token immediately");
  await expectCode(value(publisher,
    "select public.claim_expired_progress_photo_cleanup(3) as value"),
    "42501", "revocation also blocks cleanup RPC");
  await admin.query(`update private.progress_photo_principals
    set state='active', revoked_at=null, updated_at=clock_timestamp()
    where auth_user_id=$1`, [ids.replacementPublisher]);
  check(await value(admin, `select count(*)::int as value
    from private.progress_photo_principals where state='active'`) === 1,
  "controlled replacement leaves exactly one active technical principal");
  const replacementClaims = (await value(authAdmin,
    "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(eventFor(ids.replacementPublisher))])).claims;
  check(replacementClaims.role === "progress_photo_publisher" && replacementClaims.exp === 1000900,
    "replacement principal receives the publisher role after activation");
  const replacementSession = await connect();
  await replacementSession.query("set role progress_photo_publisher");
  await replacementSession.query("select set_config('request.jwt.claim.role','progress_photo_publisher',false)");
  await replacementSession.query("select set_config('request.jwt.claim.sub',$1,false)",
    [ids.replacementPublisher]);
  check(await value(replacementSession,
    "select private.progress_photo_publisher_identity() as value") === true,
  "replacement principal can use publisher identity after controlled activation");
  check(await value(publisher,
    "select private.progress_photo_publisher_identity() as value") === false,
  "previously issued publisher token stays denied after replacement");

  stage = "staging cleanup in disposable local cluster";
  await admin.query("delete from storage.objects where bucket_id='progress-check-staging'");
  await admin.query("drop policy \"progress photo staging insert\" on storage.objects");
  await admin.query("drop policy \"progress photo staging owner read\" on storage.objects");
  for (const policy of [
    "progress photo publisher stage read", "progress photo publisher stage delete",
    "progress photo publisher final insert", "progress photo publisher final read",
    "progress photo publisher final delete",
  ]) await admin.query(`drop policy "${policy}" on storage.objects`);
  await admin.query("drop policy \"progress photo restricted insert\" on storage.objects");
  await admin.query("drop policy \"progress photo restricted select\" on storage.objects");
  await admin.query("drop policy \"progress photo restricted update\" on storage.objects");
  await admin.query("drop policy \"progress photo restricted delete\" on storage.objects");
  await admin.query("drop function public.finalize_own_progress_photo_upload(uuid)");
  await admin.query("drop function public.begin_own_progress_photo_upload(text,text)");
  await admin.query("drop function public.complete_progress_photo_cleanup(uuid)");
  await admin.query("drop function public.claim_expired_progress_photo_cleanup(integer)");
  await admin.query("drop function public.fail_progress_photo_verification(uuid)");
  await admin.query("drop function public.publish_verified_progress_photo(uuid,bigint,integer,integer)");
  await admin.query("drop function public.claim_progress_photo_for_verification()");
  await admin.query("drop function private.can_select_progress_photo_object(text,text)");
  await admin.query("drop function private.publisher_final_candidate(text,text,boolean)");
  await admin.query("drop function private.publisher_stage_object(text,text)");
  await admin.query("drop function private.progress_photo_publisher_identity()");
  await admin.query("drop function private.can_stage_own_progress_photo(text,text)");
  await admin.query("drop table private.progress_photo_uploads");
  await admin.query("delete from storage.buckets where id='progress-check-staging'");

  stage = "QA rollback";
  await admin.query("delete from storage.objects where bucket_id in ('progress-check-photos','progress-medical-documents')");
  await admin.query(readSql("supabase/diagnostics/qa/20260923_progress_records_phase1_qa_rollback.sql"));
  check(await value(admin, "select to_regclass('private.progress_assets') is null as value") === true,
    "rollback removes progress tables");
  check(await value(admin, "select to_regprocedure('public.get_own_student_progress_access()') is null as value") === true,
    "rollback removes progress RPCs");
  check(await value(admin, "select count(*)::int as value from storage.buckets where id like 'progress-%'") === 0,
    "rollback removes empty progress buckets");
  check((await value(student, "select public.list_own_student_evaluations() as value")).length === 1,
    "rollback restores previous completed-evaluation behavior");
  check((await value(coach, "select public.list_own_coach_evaluation_assignments() as value")).length === 0,
    "rollback does not restore Coach access after unlink");

  console.log(`PASS progress-records PostgreSQL local: ${checks} assertions`);
} catch (error) {
  const serverLog = started ? readFileSync(join(runtime, "server.log"), "utf8") : "";
  console.error(`FAIL at ${stage}:`, error);
  if (serverLog) console.error(serverLog.slice(-6000));
  process.exitCode = 1;
} finally {
  for (const client of clients.reverse()) await client.end().catch(() => {});
  if (started) {
    try {
      run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    } catch {}
  }
  rmSync(runtime, { recursive: true, force: true });
}
