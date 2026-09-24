// Standalone synthetic PostgreSQL test. No .env, TCP, QA/PROD or app server.
// Uses a pinned PostgreSQL 17.5 artifact and removes its temporary cluster.
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const photoAttestationKey = "local-test-only-progress-photo-attestation-key";
const uploadedPhotoId = randomUUID();
const uploadedCloudinaryId = "opaqueCloudinaryAssetId123";

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
    create schema auth;
    create schema storage;
    create schema private;
    create schema extensions;
    create schema vault;
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text not null);
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
    [[ids.coach, ids.student, ids.unlinked, ids.endedStudent, ids.otherCoach], [
      "coach@example.test", "student@example.test", "unlinked@example.test",
      "ended@example.test", "other-coach@example.test",
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
  await admin.query(readSql("supabase/migrations/20260924130000_progress_cloudinary_photo_ingest.sql"));
  await admin.query("insert into vault.decrypted_secrets(name,decrypted_secret) values('progress_photo_attestation_key',$1)", [photoAttestationKey]);
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

  stage = "Cloudinary photo ingest attestation and ownership";
  const issuedAt = Math.floor(Date.now() / 1000);
  const attestation = (studentId = ids.student) => createHmac("sha256", photoAttestationKey)
    .update([studentId, uploadedPhotoId, uploadedCloudinaryId, "image/jpeg", "jpg", 1024, 100, 200, issuedAt].join("|"))
    .digest("hex");
  const registerSql = `select public.register_own_cloudinary_progress_photo(
    $1::uuid,$2::text,'image/jpeg','jpg',1024,100,200,'frente',$3::bigint,$4::text
  ) as value`;
  await expectCode(value(unlinked, registerSql,
    [uploadedPhotoId, uploadedCloudinaryId, issuedAt, attestation(ids.unlinked)]), "42501",
  "unlinked Student cannot register photo");
  await expectCode(value(student, registerSql,
    [uploadedPhotoId, uploadedCloudinaryId, issuedAt, "0".repeat(64)]), "42501",
  "browser cannot forge sanitized photo");
  check(await value(student, registerSql,
    [uploadedPhotoId, uploadedCloudinaryId, issuedAt, attestation()]) === uploadedPhotoId,
  "active Student registers signed sanitized photo");
  check((await value(student,
    "select public.get_own_cloudinary_progress_photo($1::uuid,null) as value", [uploadedPhotoId]))
    .cloudinaryAssetId === uploadedCloudinaryId, "owner reads own photo");
  await expectCode(value(unlinked,
    "select public.get_own_cloudinary_progress_photo($1::uuid,null) as value", [uploadedPhotoId]),
  "42501", "another Student cannot read photo ID");
  await expectCode(value(coach,
    "select public.get_own_cloudinary_progress_photo($1::uuid,null) as value", [uploadedPhotoId]),
  "42501", "Coach cannot read unshared photo");

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
  const cloudinaryReport = await value(student,
    "select public.create_own_progress_report('photos',$1::uuid[],null,$2::uuid) as value",
    [[uploadedPhotoId], randomUUID()]);
  check((await value(coach,
    "select public.get_own_cloudinary_progress_photo($1::uuid,$2::uuid) as value",
    [uploadedPhotoId, cloudinaryReport.id])).cloudinaryAssetId === uploadedCloudinaryId,
  "Coach reads only a selected reported photo");
  await expectCode(value(otherCoach,
    "select public.get_own_cloudinary_progress_photo($1::uuid,$2::uuid) as value",
    [uploadedPhotoId, cloudinaryReport.id]), "42501", "other Coach denied by BOLA");
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
  await expectCode(value(coach,
    "select public.get_own_cloudinary_progress_photo($1::uuid,$2::uuid) as value",
    [uploadedPhotoId, cloudinaryReport.id]), "42501", "Coach photo revoked after unlink");
  check((await value(student,
    "select public.get_own_cloudinary_progress_photo($1::uuid,null) as value", [uploadedPhotoId]))
    .cloudinaryAssetId === uploadedCloudinaryId, "Student retains own photo after unlink");
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

  stage = "QA rollback";
  await admin.query("drop function public.get_own_cloudinary_progress_photo(uuid,uuid)");
  await admin.query("drop function public.register_own_cloudinary_progress_photo(uuid,text,text,text,bigint,integer,integer,text,bigint,text)");
  await admin.query("drop table private.progress_cloudinary_photos");
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
