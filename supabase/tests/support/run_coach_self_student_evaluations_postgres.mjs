// Standalone synthetic PostgreSQL test. No .env, TCP, QA/PROD or app server.
// Uses the existing pinned PostgreSQL 17.5 artifact and removes its temp cluster.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const runtime = mkdtempSync(join(tmpdir(), "org-coach-self-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = join(runtime, "postgres.jar");
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const clients = [];
const ids = [1, 2, 3, 4, 5, 6, 7, 8]
  .map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const emails = ids.map((_, index) => `identity-${index + 1}@example.test`);
let started = false;
let stage = "bootstrap";
let checks = 0;

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
    check(error.code === code, label);
    return;
  }
  throw new Error(`Assertion failed: ${label}`);
}
async function connect(userId = null) {
  const connection = new pg.Client({
    host: socket,
    port: 55444,
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
async function createInvitation(connection, email) {
  const result = await value(connection,
    "select public.create_own_coach_invitation($1,$2::uuid) as value",
    [email, randomUUID()]);
  check(result?.status === "recorded", "invitation recorded");
  const invitationId = result.operation.invitationId;
  const detail = await value(connection,
    "select public.read_own_coach_invitation($1::uuid) as value",
    [invitationId]);
  check(typeof detail?.code === "string", "invitation has server code");
  // The browser controller submits the canonical nine-character payload after
  // rendering the separators locally (for example, AB2-CD3-EF4 -> AB2CD3EF4).
  return { invitationId, code: detail.code.replaceAll("-", "") };
}
async function accept(connection, code) {
  return value(connection,
    "select public.accept_own_coach_invitation($1,$2::uuid) as value",
    [code, randomUUID()]);
}
async function saveTemplate(connection, templateId, name) {
  const questionId = randomUUID();
  const template = await value(connection,
    "select public.save_own_evaluation_template($1::uuid,$2,$3::jsonb,$4::uuid) as value",
    [templateId, name, JSON.stringify([{ id: questionId, text: "¿Cómo te sientes?", required: true, mode: "text" }]), randomUUID()]);
  return { template, questionId };
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
    `-h '' -k ${socket} -p 55444 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
    "-w", "start"], { stdio: "ignore" });
  started = true;

  stage = "schema and migration chain";
  const admin = await connect();
  await admin.query(readSql("supabase/tests/support/coach_preferences_local_bootstrap.sql"));
  await admin.query("alter table auth.users add column email text");
  await admin.query("insert into auth.users(id) select unnest($1::uuid[])", [ids.slice(4)]);
  await admin.query("create schema extensions");
  await admin.query("create extension pgcrypto with schema extensions");
  await admin.query("create table public.profiles (id uuid primary key, display_name text, first_name text, last_name text, created_at timestamptz not null default now())");
  await admin.query(readSql("supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql"));
  await admin.query(readSql("supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql"));
  for (let index = 0; index < ids.length; index += 1) {
    await admin.query("update auth.users set email=$2 where id=$1", [ids[index], emails[index]]);
    await admin.query(
      "insert into public.profiles(id,display_name,first_name,last_name) values($1,$2,$3,$4)",
      [ids[index], `Identity ${index + 1}`, "Identity", String(index + 1)],
    );
  }
  for (const index of [0, 1, 2]) {
    await admin.query(
      "insert into public.coach_registrations(user_id,first_name,last_name,birth_date,gender,phone_number,professional_title) values($1,$2,$3,'1990-01-01','prefer_not_to_say','test','Coach')",
      [ids[index], "Coach", String(index + 1)],
    );
  }
  await admin.query(
    "insert into public.user_registrations(user_id) select unnest($1::uuid[])",
    [[ids[0], ...ids.slice(3)]],
  );
  await admin.query(readSql("supabase/migrations/20260909044235_coach_invitation_persistence.sql"));
  await admin.query(`
    create function private.transactional_email_sha256(p_value text)
    returns text language sql immutable strict security invoker set search_path = '' as $$
      select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
    $$;
    create function private.transactional_email_idempotency_uuid(p_value text)
    returns uuid language plpgsql immutable strict security invoker set search_path = '' as $$
    declare v_hash text := private.transactional_email_sha256(p_value);
    begin return (pg_catalog.substr(v_hash,1,8)||'-'||pg_catalog.substr(v_hash,9,4)||'-8'||
      pg_catalog.substr(v_hash,14,3)||'-8'||pg_catalog.substr(v_hash,18,3)||'-'||pg_catalog.substr(v_hash,21,12))::uuid; end
    $$;
    revoke all on function private.transactional_email_sha256(text),
      private.transactional_email_idempotency_uuid(text) from public, anon, authenticated;
  `);
  await admin.query(readSql("supabase/migrations/20260917000000_student_coach_link_acceptance.sql"));
  await admin.query(readSql("supabase/migrations/20260919225532_coach_student_evaluations.sql"));
  await admin.query(readSql("supabase/migrations/20260920060000_coach_self_student_and_evaluation_template_deletion.sql"));
  await admin.query(readSql("supabase/migrations/20260920172644_evaluations_reminders_status_bulk.sql"));

  const selfExisting = await connect(ids[0]);
  const selfActivated = await connect(ids[1]);
  const otherCoach = await connect(ids[2]);
  const normalStudent = await connect(ids[3]);
  const additionalStudents = await Promise.all(ids.slice(4).map((id) => connect(id)));

  stage = "self-link with existing Usuario";
  const firstSelfInvite = await createInvitation(selfExisting, emails[0]);
  check((await value(selfExisting, "select public.lookup_own_coach_invitation($1) as value", [firstSelfInvite.code]))?.status === "valido", "existing Usuario can look up self invitation");
  check((await accept(selfExisting, firstSelfInvite.code))?.status === "linked", "existing Usuario accepts self invitation");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes where coach_user_id=$1 and student_user_id=$1 and ended_at is null", [ids[0]]) === 1, "self relationship persisted");
  check(await value(admin, "select count(*)::int as value from private.coach_link_notifications where recipient_user_id=$1", [ids[0]]) === 2, "self link keeps both portal notifications");
  check(await value(admin, "select count(*)::int as value from private.coach_link_email_deliveries where recipient_user_id=$1", [ids[0]]) === 2, "self link keeps both audience emails");

  stage = "explicit Usuario activation";
  const secondSelfInvite = await createInvitation(selfActivated, emails[1]);
  await expectCode(accept(selfActivated, secondSelfInvite.code), "42501", "Coach without Usuario cannot accept before activation");
  const authCountBefore = await value(admin, "select count(*)::int as value from auth.users");
  const activated = await value(selfActivated, "select to_jsonb(public.register_own_user()) as value");
  check(activated.user_id === ids[1], "activation returns authenticated identity");
  check(await value(admin, "select count(*)::int as value from auth.users") === authCountBefore, "activation creates no second Auth account");
  check(await value(admin, "select count(*)::int as value from public.coach_registrations where user_id=$1", [ids[1]]) === 1, "activation preserves Coach membership");
  check((await accept(selfActivated, secondSelfInvite.code))?.status === "linked", "activated Usuario accepts self invitation");

  stage = "normal relationship and second Coach rejection";
  const normalInvite = await createInvitation(otherCoach, emails[3]);
  check((await accept(normalStudent, normalInvite.code))?.status === "linked", "two distinct identities still link");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes where coach_user_id=$1 and student_user_id=$2 and ended_at is null", [ids[2], ids[3]]) === 1, "normal relationship persisted");
  for (let index = 0; index < additionalStudents.length; index += 1) {
    const invitation = await createInvitation(otherCoach, emails[index + 4]);
    check((await accept(additionalStudents[index], invitation.code))?.status === "linked", `bulk student ${index + 2} linked`);
  }
  const competingInvite = await createInvitation(otherCoach, emails[0]);
  check((await accept(selfExisting, competingInvite.code))?.status === "ya_tiene_coach", "second distinct Coach is rejected");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes where student_user_id=$1 and ended_at is null", [ids[0]]) === 1, "one active Coach invariant retained");

  stage = "self-evaluation, consent and history";
  const selfEpisodeId = await value(admin, "select id as value from private.coach_relationship_episodes where coach_user_id=$1 and student_user_id=$1 and ended_at is null", [ids[0]]);
  const ownStudents = await value(selfExisting, "select public.list_own_evaluation_students() as value");
  check(ownStudents.some((student) => student.episodeId === selfEpisodeId), "Coach sees self as linked student");
  stage = "self-evaluation template creation";
  const { template, questionId } = await saveTemplate(selfExisting, null, "Autocuidado");
  stage = "self-evaluation send";
  const sent = await value(selfExisting,
    "select public.send_own_evaluation_template($1::uuid,$2::uuid[],$3::date,$4,$5::uuid) as value",
    [template.id, [selfEpisodeId], null, true, randomUUID()]);
  check(sent.created === 1, "self evaluation sent");
  const assignmentId = await value(admin, "select id as value from private.evaluation_assignments where coach_user_id=$1 and student_user_id=$1", [ids[0]]);
  check(await value(admin, "select sensitive and (snapshot->>'sensitive')::boolean as value from private.evaluation_assignments where id=$1", [assignmentId]) === true, "sensitive is persisted in immutable assignment and snapshot");
  const answers = { [questionId]: "Bien" };
  stage = "self-evaluation consent rejection";
  await expectCode(value(selfExisting,
    "select public.submit_own_evaluation($1::uuid,$2::jsonb,$3,$4::uuid) as value",
    [assignmentId, answers, false, randomUUID()]), "22023", "sensitive submit requires consent");
  stage = "self-evaluation submit";
  const completed = await value(selfExisting,
    "select public.submit_own_evaluation($1::uuid,$2::jsonb,$3,$4::uuid) as value",
    [assignmentId, answers, true, randomUUID()]);
  check(completed.status === "completed", "same identity responds to self evaluation");
  check(await value(admin, "select count(*)::int as value from private.evaluation_notifications where recipient_user_id=$1", [ids[0]]) === 3, "self evaluation keeps received, sent and completed notifications");
  check(await value(admin, "select count(*)::int as value from private.evaluation_email_deliveries where recipient_user_id=$1", [ids[0]]) === 3, "self evaluation keeps all email events");
  stage = "self-evaluation immutable snapshot";
  await expectCode(admin.query("update private.evaluation_assignments set sensitive=false where id=$1", [assignmentId]), "55000", "assignment sensitivity is immutable");

  stage = "self-evaluation template logical deletion";
  check(await value(selfExisting, "select public.delete_own_evaluation_template($1::uuid) as value", [template.id]) === true, "owner confirms logical deletion");
  check(await value(selfExisting, "select public.delete_own_evaluation_template($1::uuid) as value", [template.id]) === true, "owner deletion retry is idempotent");
  check((await value(selfExisting, "select public.list_own_evaluation_templates() as value")).length === 0, "deleted template leaves active library");
  check((await value(selfExisting, "select public.list_own_coach_evaluation_assignments() as value")).length === 1, "coach history remains accessible");
  check((await value(selfExisting, "select public.list_own_student_evaluations() as value")).length === 1, "student history remains accessible");
  check(await value(admin, "select count(*)::int as value from private.evaluation_responses where assignment_id=$1 and state='completed'", [assignmentId]) === 1, "response remains after template deletion");

  stage = "foreign template authorization";
  const foreign = await saveTemplate(selfExisting, null, "Privada");
  await expectCode(value(otherCoach,
    "select public.save_own_evaluation_template($1::uuid,$2,$3::jsonb,$4::uuid) as value",
    [foreign.template.id, "Ajena", JSON.stringify([{ id: randomUUID(), text: "Ajena", required: false, mode: "text" }]), randomUUID()]), "42501", "foreign template edit rejected");
  await expectCode(value(otherCoach,
    "select public.delete_own_evaluation_template($1::uuid) as value",
    [foreign.template.id]), "42501", "foreign template deletion rejected");

  stage = "manual and bulk evaluation reminders";
  const { template: bulkTemplate, questionId: bulkQuestionId } = await saveTemplate(otherCoach, null, "Seguimiento grupal");
  const bulkEpisodeIds = (await admin.query(
    "select id,student_user_id from private.coach_relationship_episodes where coach_user_id=$1 and student_user_id=any($2::uuid[]) and ended_at is null order by student_user_id",
    [ids[2], ids.slice(3)],
  )).rows.map((row) => row.id);
  check(bulkEpisodeIds.length === 5, "bulk fixture has five active relationships");
  const sendBatchId = randomUUID();
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const bulkSend = await value(otherCoach,
    "select public.send_own_evaluation_template($1::uuid,$2::uuid[],$3::date,$4,$5::uuid) as value",
    [bulkTemplate.id, bulkEpisodeIds, dueDate, false, sendBatchId]);
  check(bulkSend.created === 5, "bulk reminder fixture sent to five students");
  const assignmentRows = (await admin.query(
    "select id,student_user_id,relationship_episode_id from private.evaluation_assignments where send_batch_id=$1 order by student_user_id",
    [sendBatchId],
  )).rows;
  const assignmentFor = (studentId) => assignmentRows.find((row) => row.student_user_id === studentId);
  const pendingAssignment = assignmentFor(ids[3]);
  const draftAssignment = assignmentFor(ids[4]);
  const completedAssignment = assignmentFor(ids[5]);
  const expiredAssignment = assignmentFor(ids[6]);
  const unlinkedAssignment = assignmentFor(ids[7]);
  check([pendingAssignment, draftAssignment, completedAssignment, expiredAssignment, unlinkedAssignment].every(Boolean), "bulk assignments mapped by student");

  await value(additionalStudents[0],
    "select public.save_own_evaluation_draft($1::uuid,$2::jsonb,$3,$4::uuid) as value",
    [draftAssignment.id, { [bulkQuestionId]: "Borrador" }, false, randomUUID()]);
  await value(additionalStudents[1],
    "select public.submit_own_evaluation($1::uuid,$2::jsonb,$3,$4::uuid) as value",
    [completedAssignment.id, { [bulkQuestionId]: "Respondida" }, false, randomUUID()]);
  await admin.query(
    "update private.evaluation_assignments set due_at=clock_timestamp()-interval '1 microsecond' where id=$1",
    [expiredAssignment.id],
  );
  await admin.query(
    "update private.coach_relationship_episodes set ended_at=clock_timestamp() where id=$1",
    [unlinkedAssignment.relationship_episode_id],
  );

  const bulkReminderRequestId = randomUUID();
  const bulkReminder = await value(otherCoach,
    "select public.remind_own_evaluation_batch($1::uuid,$2::uuid) as value",
    [sendBatchId, bulkReminderRequestId]);
  check(bulkReminder.created === 2, "bulk reminder selects only pending and draft active assignments");
  check(await value(admin,
    "select count(*)::int as value from private.evaluation_notifications where send_batch_id is null and event_kind='evaluation_due_reminder' and assignment_id=any($1::uuid[])",
    [[pendingAssignment.id, draftAssignment.id]]) === 2, "bulk reminder created exactly two notifications");
  check(await value(admin,
    "select count(*)::int as value from private.evaluation_notifications where event_kind='evaluation_due_reminder' and assignment_id=any($1::uuid[])",
    [[completedAssignment.id, expiredAssignment.id, unlinkedAssignment.id]]) === 0, "completed, expired and unlinked assignments are excluded");
  const bulkRetry = await value(otherCoach,
    "select public.remind_own_evaluation_batch($1::uuid,$2::uuid) as value",
    [sendBatchId, bulkReminderRequestId]);
  check(bulkRetry.created === 2, "bulk retry returns the durable result");
  check(await value(admin,
    "select count(*)::int as value from private.evaluation_notifications where event_kind='evaluation_due_reminder' and assignment_id=any($1::uuid[])",
    [[pendingAssignment.id, draftAssignment.id]]) === 2, "bulk retry does not duplicate notifications");

  await admin.query("update private.evaluation_assignments set due_at=null where id=$1", [pendingAssignment.id]);
  const firstIndividualRequestId = randomUUID();
  await value(otherCoach,
    "select public.remind_own_evaluation_assignment($1::uuid,$2::uuid) as value",
    [pendingAssignment.id, firstIndividualRequestId]);
  await value(otherCoach,
    "select public.remind_own_evaluation_assignment($1::uuid,$2::uuid) as value",
    [pendingAssignment.id, firstIndividualRequestId]);
  check(await value(admin,
    "select count(*)::int as value from private.evaluation_notifications where event_kind='evaluation_due_reminder' and assignment_id=$1",
    [pendingAssignment.id]) === 2, "individual retry reuses requestId without duplication");
  await value(otherCoach,
    "select public.remind_own_evaluation_assignment($1::uuid,$2::uuid) as value",
    [pendingAssignment.id, randomUUID()]);
  check(await value(admin,
    "select count(*)::int as value from private.evaluation_notifications where event_kind='evaluation_due_reminder' and assignment_id=$1",
    [pendingAssignment.id]) === 3, "new requestId creates a repeated reminder without cooldown");

  for (const [assignment, label] of [
    [completedAssignment, "completed reminder rejected"],
    [expiredAssignment, "expired reminder rejected"],
    [unlinkedAssignment, "unlinked reminder rejected"],
  ]) {
    await expectCode(value(otherCoach,
      "select public.remind_own_evaluation_assignment($1::uuid,$2::uuid) as value",
      [assignment.id, randomUUID()]), "42501", label);
  }
  await expectCode(value(selfExisting,
    "select public.remind_own_evaluation_batch($1::uuid,$2::uuid) as value",
    [sendBatchId, randomUUID()]), "42501", "cross-coach bulk reminder rejected");

  const coachHistory = await value(otherCoach, "select public.list_own_coach_evaluation_assignments() as value");
  const bulkHistory = coachHistory.filter((assignment) => assignment.sendBatchId === sendBatchId);
  check(bulkHistory.length === 5, "owner sees all assignments in reminder group");
  check(bulkHistory.find((assignment) => assignment.id === pendingAssignment.id)?.reminderCount === 3, "individual reminder metadata counted");
  check(bulkHistory.find((assignment) => assignment.id === draftAssignment.id)?.reminderCount === 1, "bulk reminder metadata counted");
  check(typeof bulkHistory.find((assignment) => assignment.id === pendingAssignment.id)?.lastReminderAt === "string", "last reminder date returned");
  check(bulkHistory.find((assignment) => assignment.id === completedAssignment.id)?.status === "completed", "completed form status remains independent");
  check(bulkHistory.find((assignment) => assignment.id === expiredAssignment.id)?.status === "expired", "expired form status remains independent");
  check(!/email/i.test(JSON.stringify(bulkHistory)), "coach history exposes no email fields");
  check((await value(selfExisting, "select public.list_own_coach_evaluation_assignments() as value"))
    .every((assignment) => assignment.sendBatchId !== sendBatchId), "another coach cannot list the group or its responses");

  stage = "ACL and scope";
  check(await value(admin, "select has_function_privilege('authenticated','public.delete_own_evaluation_template(uuid)','EXECUTE') as value") === true, "authenticated can call narrow delete RPC");
  check(await value(admin, "select has_function_privilege('anon','public.delete_own_evaluation_template(uuid)','EXECUTE') as value") === false, "anon cannot delete templates");
  check(await value(admin, "select has_function_privilege('authenticated','public.remind_own_evaluation_batch(uuid,uuid)','EXECUTE') as value") === true, "authenticated can call narrow bulk reminder RPC");
  check(await value(admin, "select has_function_privilege('anon','public.remind_own_evaluation_batch(uuid,uuid)','EXECUTE') as value") === false, "anon cannot call bulk reminder RPC");
  const migration = readSql("supabase/migrations/20260920060000_coach_self_student_and_evaluation_template_deletion.sql");
  check(!/training_sessions|exercise_entries|service_role|storage\./i.test(migration), "migration stays outside excluded resources");

  console.log(`COACH_SELF_STUDENT_EVALUATIONS_LOCAL_POSTGRES=PASS (${checks} checks; PostgreSQL 17.5; no TCP/remote DB)`);
} catch (error) {
  console.error(`COACH_SELF_STUDENT_EVALUATIONS_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? error.status ?? "assertion"}`);
  if (typeof error.message === "string") console.error(error.message);
  if (typeof error.detail === "string") console.error(error.detail);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  rmSync(runtime, { recursive: true, force: true });
}
