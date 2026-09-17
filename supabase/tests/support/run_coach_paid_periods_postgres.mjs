// Standalone synthetic PostgreSQL tests. No .env, TCP, QA/PROD or app server.
// Uses the existing pinned PostgreSQL 17.5 binary artifact and auth bootstrap.
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
// Prevent libpq/pg defaults, hooks or PGOPTIONS inherited from the user's shell.
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "org-paid-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = join(runtime, "postgres.jar");
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const clients = [];
let started = false;
let checks = 0;
let stage = "bootstrap";
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const readSql = (path) => readFileSync(join(root, path), "utf8");
const run = (command, args, options = {}) => execFileSync(command, args, { env: childEnv, ...options });
const check = (condition, label) => {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks++;
};
const value = async (connection, sql, args = []) => (await connection.query(sql, args)).rows[0]?.value;
async function connect(userId = null) {
  const connection = new pg.Client({ host: socket, port: 55444, user: "postgres", database: "postgres",
    password: null, ssl: false, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
  await connection.connect();
  clients.push(connection);
  if (userId) {
    await connection.query("set role authenticated");
    await connection.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  }
  return connection;
}

const zero = "00000000-0000-0000-0000-000000000000";
const confirm = (connection, episode, start, end, version, request = randomUUID()) => value(connection,
  "select public.confirm_own_coach_paid_period($1::uuid,$2,$3,$4::uuid,$5::uuid) as value",
  [episode, start, end, version, request]);
const correct = (connection, episode, period, start, end, version, request = randomUUID()) => value(connection,
  "select public.correct_own_coach_paid_period($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::uuid) as value",
  [episode, period, start, end, version, request]);
const revoke = (connection, episode) => value(connection,
  "select public.revoke_own_coach_relationship($1::uuid,$2::uuid) as value", [episode, randomUUID()]);
const read = (connection, episode) => value(connection,
  "select public.read_own_coach_paid_period($1::uuid) as value", [episode]);
async function fixture(admin, owner) {
  // Admin fixture only: no public acceptance, synthetic identity, no claimed consent QA.
  const student = randomUUID(), invitation = randomUUID(), episode = randomUUID();
  await admin.query("insert into auth.users(id) values($1)", [student]);
  await admin.query("insert into public.user_registrations(user_id) values($1)", [student]);
  await admin.query("insert into private.coach_invitations(id,coach_user_id,recipient_email,state,invitation_code,created_at,issued_at,expires_at) select $1,$2,'fixture@example.test','accepted',null,t,t,t+interval '168 hours' from (select clock_timestamp()-interval '1 day' t) q", [invitation, owner]);
  await admin.query("insert into private.coach_relationship_episodes(id,invitation_id,coach_user_id,student_user_id,student_name_snapshot,student_email_snapshot,consented_at,linked_at) select $1,$2,$3,$4,'Synthetic Student','fixture@example.test',t,t from (select clock_timestamp()-interval '12 hours' t) q", [episode, invitation, owner, student]);
  return episode;
}
async function waitingOnLock(admin, connection) {
  // Assert a real blocked second connection, not merely Promise scheduling.
  for (let i = 0; i < 100; i++) {
    if (await value(admin, "select wait_event_type='Lock' as value from pg_stat_activity where pid=$1", [connection.processID])) return;
    await admin.query("select pg_sleep(0.01)");
  }
  throw new Error("Assertion failed: second connection must wait on exclusive lock");
}

try {
  run("curl", ["-fsSL", "--max-time", "90", archiveUrl, "-o", archive]);
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === archiveHash, "binary SHA-256");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  stage = "initdb";
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  // Logs never contain SQL statements or parameter/code values.
  stage = "pg_ctl start";
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55444 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
    "-w", "start"], { stdio: "ignore" });
  started = true;
  stage = "auth and migration bootstrap";
  const admin = await connect();
  await admin.query(readSql("supabase/tests/support/coach_preferences_local_bootstrap.sql"));
  await admin.query(readSql("supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql"));
  // Only profile columns used by the real Usuario registration migration's backfill.
  await admin.query("create table public.profiles (id uuid primary key, created_at timestamptz not null)");
  await admin.query(readSql("supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql"));
  await admin.query("insert into public.user_registrations(user_id) values ($1)", [ids[2]]);
  await admin.query("insert into public.coach_registrations(user_id,first_name,last_name,birth_date,gender,phone_number,professional_title) select id,'Synthetic','Coach','1990-01-01','prefer_not_to_say','test','Test' from auth.users where id<>$1", [ids[2]]);
  await admin.query(readSql("supabase/migrations/20260909044235_coach_invitation_persistence.sql"));
  await admin.query(readSql("supabase/migrations/20260909054933_coach_paid_period_persistence.sql"));
  stage = "transactional SQL contract";
  await admin.query(readSql("supabase/tests/coach_paid_periods_local.sql"));
  check(await value(admin, "select count(*)::int as value from private.coach_paid_periods") === 0, "SQL fixture rollback");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes") === 0, "synthetic episode rollback");
  console.log("COACH_PAID_PERIODS_SQL_TRANSACTION=PASS (ACL, RLS, BOLA, dates, history, unlink; rolled back)");

  const a = await connect(ids[0]), a2 = await connect(ids[0]);
  const b = await connect(ids[1]), c = await connect(ids[3]);
  let episode = await fixture(admin, ids[0]);
  stage = "concurrent idempotency";
  const request = randomUUID();
  const pair = await Promise.all([
    confirm(a, episode, "2026-09-01", "2026-09-30", zero, request),
    confirm(a2, episode, "2026-09-01", "2026-09-30", zero, request),
  ]);
  check(JSON.stringify(pair[0]) === JSON.stringify(pair[1]), "same request concurrent stable receipt");
  check(await value(admin, "select count(*)::int as value from private.coach_paid_period_operations where episode_id=$1", [episode]) === 1, "one operation for concurrent replay");
  check(await value(admin, "select count(*)::int as value from private.coach_paid_periods where episode_id=$1", [episode]) === 1, "one period for concurrent replay");

  let current = await read(a, episode);
  const conflictRequest = randomUUID();
  const conflict = await Promise.allSettled([
    confirm(a, episode, "2026-10-01", "2026-10-30", current.version, conflictRequest),
    confirm(a2, episode, "2026-10-01", "2026-10-31", current.version, conflictRequest),
  ]);
  check(conflict.filter((r) => r.status === "fulfilled").length === 1, "different payload same request one winner");
  check(conflict.filter((r) => r.status === "rejected" && r.reason.code === "22023" && r.reason.message === "coach_paid_period_request_conflict").length === 1, "payload conflict sanitized");

  stage = "optimistic version races";
  current = await read(a, episode);
  const competing = await Promise.allSettled([
    confirm(a, episode, "2026-11-01", "2026-11-29", current.version),
    confirm(a2, episode, "2026-11-01", "2026-11-30", current.version),
  ]);
  check(competing.filter((r) => r.status === "fulfilled").length === 1, "distinct request stale version one winner");
  check(competing.filter((r) => r.status === "rejected" && r.reason.code === "40001").length === 1, "stale version conflicts without silent retry");
  current = await read(a, episode);
  const oldPeriod = current.period.id;
  const correctionRequest = randomUUID();
  const corrections = await Promise.all([
    correct(a, episode, oldPeriod, "2026-11-02", "2026-11-30", current.version, correctionRequest),
    correct(a2, episode, oldPeriod, "2026-11-02", "2026-11-30", current.version, correctionRequest),
  ]);
  check(JSON.stringify(corrections[0]) === JSON.stringify(corrections[1]), "concurrent correction replay once");
  check(corrections[0].operation.period.id === oldPeriod, "concurrent correction stable period id");
  current = await read(a, episode);
  const mixed = await Promise.allSettled([
    correct(a, episode, oldPeriod, "2026-11-03", "2026-11-30", current.version),
    confirm(a2, episode, "2026-12-01", "2026-12-31", current.version),
  ]);
  check(mixed.filter((r) => r.status === "fulfilled").length === 1, "correction and renewal serialize");
  check(mixed.filter((r) => r.status === "rejected" && r.reason.code === "40001").length === 1, "mixed race loser explicit version conflict");

  stage = "ownership and forged period references";
  const otherEpisode = await fixture(admin, ids[1]);
  const other = await confirm(b, otherEpisode, "2026-09-01", "2026-09-30", zero);
  current = await read(a, episode);
  const forged = await correct(a, episode, other.operation.period.id, "2026-09-01", "2026-09-30", current.version)
    .then(() => "allowed", (error) => error.code);
  check(forged === "P0002", "forged cross-owner period rejected");
  const wrongEpisode = await correct(a, otherEpisode, other.operation.period.id, "2026-09-01", "2026-09-30", other.operation.version)
    .then(() => "allowed", (error) => error.code);
  check(wrongEpisode === "P0002", "forged cross-owner episode rejected");
  check((await read(b, otherEpisode)).version === other.operation.version, "foreign record unchanged");
  const sameOwnerOtherEpisode = await fixture(admin, ids[0]);
  const mixedEpisode = await correct(a, sameOwnerOtherEpisode, oldPeriod, "2026-09-01", "2026-09-30", zero)
    .then(() => "allowed", (error) => error.code);
  check(mixedEpisode === "P0002", "same owner wrong episode period rejected");

  stage = "request identity is scoped to real Coach";
  const sharedRequest = randomUUID();
  const ownerOneEpisode = await fixture(admin, ids[0]);
  const ownerTwoEpisode = await fixture(admin, ids[1]);
  const independent = await Promise.all([
    confirm(a, ownerOneEpisode, "2026-09-01", "2026-09-30", zero, sharedRequest),
    confirm(b, ownerTwoEpisode, "2026-09-01", "2026-09-30", zero, sharedRequest),
  ]);
  check(independent.every((r) => r.status === "recorded"), "different Coaches can reuse request UUID independently");
  check(independent[0].operation.period.id !== independent[1].operation.period.id, "no cross-owner receipt replay");

  stage = "revoke wins deterministic lock race";
  episode = await fixture(admin, ids[0]);
  await a.query("begin");
  await revoke(a, episode);
  const blockedWrite = confirm(a2, episode, "2026-09-01", "2026-09-30", zero)
    .then(() => "allowed", (error) => error.code);
  await waitingOnLock(admin, a2);
  check(true, "payment waits on real exclusive Coach lock held by revoke");
  await a.query("commit");
  check(await blockedWrite === "55000", "revocation wins and denies new write");
  check(await value(admin, "select count(*)::int as value from private.coach_paid_periods where episode_id=$1", [episode]) === 0, "revoke-first leaves no new facts");

  stage = "payment wins deterministic lock race";
  episode = await fixture(admin, ids[0]);
  await a.query("begin");
  const saved = await confirm(a, episode, "2026-09-01", "2026-09-30", zero);
  const blockedRevoke = revoke(a2, episode);
  await waitingOnLock(admin, a2);
  check(true, "revoke waits on real exclusive Coach lock held by payment");
  await a.query("commit");
  await blockedRevoke;
  check((await read(a, episode)).period.id === saved.operation.period.id, "payment-first retains commercial fact after unlink");
  const retryAfterUnlink = await confirm(a, episode, "2026-09-01", "2026-09-30", zero, saved.operation.requestId)
    .then(() => "allowed", (error) => error.code);
  check(retryAfterUnlink === "55000", "write replay denied after unlink");
  const receipt = await value(a, "select public.read_own_coach_paid_period_operation($1::uuid) as value", [saved.operation.requestId]);
  check(JSON.stringify(receipt) === JSON.stringify(saved.operation), "read-only reconciliation after unlink");
  check(!Object.keys(receipt).some((key) => /owner|student|training|payload|email|code/i.test(key)), "receipt contains no student activity or ownership");

  stage = "membership removal lock race";
  episode = await fixture(admin, ids[3]);
  await admin.query("begin");
  await admin.query("delete from public.coach_registrations where user_id=$1", [ids[3]]);
  const removed = confirm(c, episode, "2026-09-01", "2026-09-30", zero)
    .then(() => "allowed", (error) => error.code);
  // Observe the real wait while the admin transaction holds the membership row.
  await waitingOnLock(admin, c);
  await admin.query("commit");
  check(await removed === "42501", "removed Coach membership cannot confirm");
  check(await value(admin, "select count(*)::int as value from private.coach_paid_periods where episode_id=$1", [episode]) === 0, "membership denial no persistence");

  stage = "scope invariants";
  const source = readSql("supabase/migrations/20260909054933_coach_paid_period_persistence.sql");
  check(!/\b(training_sessions|exercise_entries|training_cycles|storage\.|auth\.users\s+where)\b/i.test(source), "no training storage or global lookups");
  check(!/\braise\s+(notice|log|info|debug|warning)\b/i.test(source), "no data logging");
  console.log(`COACH_PAID_PERIODS_LOCAL_POSTGRES=PASS (${checks} runner checks plus SQL contract; PostgreSQL 17.5; no TCP/remote DB)`);
} catch (error) {
  console.error(`COACH_PAID_PERIODS_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? error.status ?? "assertion"}`);
  if (error.message?.startsWith("Assertion failed:")) console.error(error.message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  // Exact disposable private cluster only; no repository or home directory removal.
  rmSync(runtime, { recursive: true, force: true });
}
