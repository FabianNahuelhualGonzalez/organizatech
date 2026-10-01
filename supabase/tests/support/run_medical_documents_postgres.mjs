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
      metadata jsonb,
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

  stage = "apply migrations";
  for (const file of [
    "20260923184225_progress_records_private_storage_reports_phase1.sql",
    "20260924140000_progress_photo_staging_preparation.sql",
    "20260925004129_progress_photo_stage_volatility.sql",
    "20260925012214_progress_photo_select_volatility.sql",
    "20260930163231_progress_photo_student_gateway.sql",
    "20261001141522_progress_medical_document_student_gateway.sql",
  ]) await admin.query(readSql(`supabase/migrations/${file}`));
  await admin.query("insert into private.progress_document_principals(auth_user_id,state) values($1,'active')",
    [ids.replacementPublisher]);
  await admin.query("insert into private.progress_photo_principals(auth_user_id,state) values($1,'active')",
    [ids.publisher]);
  check(await value(admin, "select public as value from storage.buckets where id='progress-document-staging'") === false,
    "document staging bucket is private");
  check(Number(await value(admin, "select file_size_limit as value from storage.buckets where id='progress-document-staging'")) === 26214400,
    "document staging bucket is capped at 25 MiB");
  check((await value(admin, "select allowed_mime_types as value from storage.buckets where id='progress-document-staging'"))
    .join() === "application/pdf", "document staging bucket accepts PDF only");
  check(Number(await value(admin, "select file_size_limit as value from storage.buckets where id='progress-medical-documents'")) === 26214400,
    "final bucket remains capped at 25 MiB");
  check(await value(admin, "select count(*)::int as value from pg_proc where proname='begin_own_medical_document_upload' and pronargs=0") === 1,
    "reservation accepts no client ownership or metadata");
  check(await value(admin, "select has_function_privilege('anon','public.begin_own_medical_document_upload()','EXECUTE') as value") === false,
    "anonymous role cannot reserve");
  check(await value(admin, "select has_function_privilege('authenticated','public.publish_verified_medical_document(uuid,bigint,integer)','EXECUTE') as value") === false,
    "browser cannot publish a document");

  const student = await connect(ids.student);
  const otherStudent = await connect(ids.unlinked);
  const coach = await connect(ids.coach);
  const otherCoach = await connect(ids.otherCoach);
  const publisher = await connect();
  await publisher.query("set role progress_document_publisher");
  await publisher.query("select set_config('request.jwt.claim.role','progress_document_publisher',false)");
  await publisher.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.replacementPublisher]);
  const authAdmin = await connect();
  await authAdmin.query("set role supabase_auth_admin");
  const photoPublisher = await connectPublisher();
  const event = (userId) => ({ user_id: userId, claims: {
    sub: userId, role: "authenticated", iat: 1000000, exp: 1003600,
  } });
  check((await value(authAdmin, "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(event(ids.replacementPublisher))])).claims.role === "progress_document_publisher",
  "separate document principal receives only its own role");
  check((await value(authAdmin, "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(event(ids.publisher))])).claims.role === "progress_photo_publisher",
  "existing photo principal retains only photo role");
  await expectCode(value(photoPublisher, "select public.claim_medical_document_for_verification() as value"),
    "42501", "photo publisher cannot claim document queue");
  check((await value(authAdmin, "select private.progress_photo_access_token_hook($1::jsonb) as value",
    [JSON.stringify(event(ids.student))])).claims.role === "authenticated",
  "ordinary Student claims stay unchanged");

  stage = "reservation, staging and BOLA";
  await admin.query("create policy synthetic_broad_insert on storage.objects for insert to authenticated with check (true)");
  await admin.query("create policy synthetic_broad_select on storage.objects for select to authenticated using (true)");
  await admin.query("create policy synthetic_broad_update on storage.objects for update to authenticated using (true) with check (true)");
  await admin.query("create policy synthetic_broad_delete on storage.objects for delete to authenticated using (true)");
  await expectCode(value(otherStudent, "select public.begin_own_medical_document_upload() as value"),
    "42501", "unlinked Student cannot reserve");
  await expectCode(value(coach, "select public.begin_own_medical_document_upload() as value"),
    "42501", "Coach cannot reserve");
  const reservation = await value(student, "select public.begin_own_medical_document_upload() as value");
  check(reservation.bucketId === "progress-document-staging"
    && reservation.mimeType === "application/pdf"
    && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(reservation.objectName),
  "SQL returns an opaque PDF path in private staging");
  await expectCode(otherStudent.query("insert into storage.objects(bucket_id,name) values($1,$2)",
    [reservation.bucketId, reservation.objectName]), "42501", "another Student cannot stage by known path");
  await expectCode(student.query("insert into storage.objects(bucket_id,name) values('progress-medical-documents',$1)",
    [reservation.objectName]), "42501", "browser cannot insert final PDF despite broad policy");
  await expectCode(student.query("insert into storage.objects(bucket_id,name) values('progress-document-staging',$1)",
    [`${randomUUID()}/${randomUUID()}.pdf`]), "42501", "browser cannot invent staging path");
  await student.query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
    [reservation.bucketId, reservation.objectName, { mimetype: "application/pdf", size: "100" }]);
  await expectCode(value(otherStudent,
    "select public.finalize_own_medical_document_upload($1::uuid) as value", [reservation.uploadId]),
    "42501", "another Student cannot enqueue by upload ID");
  check(await value(student, "select public.finalize_own_medical_document_upload($1::uuid) as value",
    [reservation.uploadId]) === reservation.uploadId, "owner queues staged PDF");
  await expectCode(value(student,
    "select public.finalize_own_medical_document_upload($1::uuid) as value", [reservation.uploadId]),
    "42501", "enqueue replay is denied");
  const claim = await value(publisher,
    "select public.claim_medical_document_for_verification() as value");
  check(claim.uploadId === reservation.uploadId && claim.finalBucket === "progress-medical-documents"
    && claim.finalPath !== reservation.objectName, "publisher receives separate opaque final path");
  await expectCode(publisher.query("insert into storage.objects(bucket_id,name) values('progress-check-photos',$1)",
    [claim.finalPath]), "42501", "document principal cannot write photo bucket");
  await expectCode(photoPublisher.query("insert into storage.objects(bucket_id,name) values('progress-medical-documents',$1)",
    [claim.finalPath]), "42501", "photo principal cannot write document bucket");
  await publisher.query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
    [claim.finalBucket, claim.finalPath, { mimetype: "application/pdf", size: "100" }]);
  await expectCode(value(student,
    "select public.publish_verified_medical_document($1::uuid,100,1) as value", [reservation.uploadId]),
    "42501", "browser cannot publish claimed PDF");
  await expectCode(value(publisher,
    "select public.publish_verified_medical_document($1::uuid,100,1) as value", [reservation.uploadId]),
    "42501", "staging must be removed before publication");
  await publisher.query("delete from storage.objects where bucket_id=$1 and name=$2",
    [reservation.bucketId, reservation.objectName]);
  await expectCode(value(publisher,
    "select public.publish_verified_medical_document($1::uuid,26214401,1) as value", [reservation.uploadId]),
    "42501", "publication rejects more than 25 MiB");
  await expectCode(value(publisher,
    "select public.publish_verified_medical_document($1::uuid,99,1) as value", [reservation.uploadId]),
    "42501", "publication rejects size mismatch with Storage metadata");
  await admin.query("update storage.objects set metadata='{}'::jsonb where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]);
  await expectCode(value(publisher,
    "select public.publish_verified_medical_document($1::uuid,100,1) as value", [reservation.uploadId]),
    "42501", "publication rejects missing Storage MIME and size");
  await admin.query("update storage.objects set metadata=$3 where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath, { mimetype: "application/pdf", size: "100" }]);
  const assetId = await value(publisher,
    "select public.publish_verified_medical_document($1::uuid,100,1) as value", [reservation.uploadId]);
  check((await value(student, "select public.list_own_medical_documents() as value"))[0].assetId === assetId,
    "owner lists its verified PDF");
  check((await value(student, "select public.get_own_medical_document($1::uuid) as value", [assetId])).assetId === assetId,
    "owner opens verified PDF by ID");
  await expectCode(value(otherStudent,
    "select public.get_own_medical_document($1::uuid) as value", [assetId]),
    "42501", "another Student cannot open by asset ID");
  check((await value(otherStudent, "select public.list_own_medical_documents() as value")).length === 0,
    "another Student cannot list the PDF");
  check(await value(student, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 1, "owner can read final private object");
  check(await value(coach, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 0, "Coach cannot read an unsent PDF");
  check(await value(otherCoach, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 0, "another Coach cannot read the PDF");
  check((await student.query("delete from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath])).rowCount === 0,
  "browser cannot delete final PDF despite broad policy");
  check((await student.query("update storage.objects set name=$1 where bucket_id=$2 and name=$3",
    [`${randomUUID()}/${randomUUID()}.pdf`, claim.finalBucket, claim.finalPath])).rowCount === 0,
  "browser cannot update final PDF despite broad policy");

  stage = "explicit report and revocation";
  const report = await value(student,
    "select public.create_own_progress_report('medical_document',$1::uuid[],null,$2::uuid) as value",
    [[assetId], randomUUID()]);
  check(report.items.length === 1 && report.items[0].assetId === assetId,
    "existing report RPC accepts only the explicitly selected asset");
  check(await value(coach, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 1, "recipient Coach can read the reported PDF");
  check(await value(otherCoach, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 0, "nonrecipient Coach remains denied");
  const pending = await value(student, "select public.begin_own_medical_document_upload() as value");
  await student.query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)",
    [pending.bucketId, pending.objectName, { mimetype: "application/pdf", size: "100" }]);
  await admin.query("update private.coach_relationship_episodes set ended_at=clock_timestamp() where id=$1",
    [ids.activeEpisode]);
  await expectCode(value(student, "select public.begin_own_medical_document_upload() as value"),
    "42501", "lost link blocks new reservation");
  await expectCode(value(student,
    "select public.finalize_own_medical_document_upload($1::uuid) as value", [pending.uploadId]),
    "42501", "lost link blocks pending enqueue");
  await expectCode(value(student,
    "select public.create_own_progress_report('medical_document',$1::uuid[],null,$2::uuid) as value",
    [[assetId], randomUUID()]), "42501", "lost link blocks new sending");
  check((await value(student, "select public.list_own_medical_documents() as value"))[0].assetId === assetId,
    "Student retains historical PDF listing");
  check(await value(student, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 1, "Student retains historical PDF bytes");
  check(await value(coach, "select count(*)::int as value from storage.objects where bucket_id=$1 and name=$2",
    [claim.finalBucket, claim.finalPath]) === 0, "Coach loses PDF bytes when link ends");
  check(await value(publisher, "select public.claim_medical_document_for_verification() as value") === null,
    "publisher cannot claim newly unlinked Student upload");
  await admin.query(`update private.progress_document_principals set state='revoked',
    revoked_at=clock_timestamp(), updated_at=clock_timestamp() where auth_user_id=$1`,
    [ids.replacementPublisher]);
  await expectCode(value(publisher, "select public.claim_medical_document_for_verification() as value"),
    "42501", "technical principal revocation blocks existing session");

  console.log(`PASS medical documents PostgreSQL local: ${checks} assertions`);
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
