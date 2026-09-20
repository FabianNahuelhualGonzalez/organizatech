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
const runtime = mkdtempSync(join(tmpdir(), "org-coach-invite-pg-"));
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
const create = (connection, email, request = randomUUID()) => value(connection,
  "select public.create_own_coach_invitation($1,$2::uuid) as value", [email, request]);
const invoke = (connection, action, id, request = randomUUID()) => {
  if (!["resend", "regenerate", "cancel"].includes(action)) throw new Error("Unknown test action");
  return value(connection, `select public.${action}_own_coach_invitation($1::uuid,$2::uuid) as value`, [id, request]);
};
async function connect(userId = null) {
  const connection = new pg.Client({ host: socket, port: 55443, user: "postgres", database: "postgres",
    password: null, ssl: false, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
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
  // Logs never contain SQL statements or parameter/code values.
  stage = "pg_ctl start";
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55443 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
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
  stage = "transactional SQL contract";
  await admin.query(readSql("supabase/tests/coach_invitations_local.sql"));
  check(await value(admin, "select count(*)::int as value from private.coach_invitations") === 0, "SQL fixture rollback");
  console.log("COACH_INVITATIONS_SQL_TRANSACTION=PASS (ACL, ownership, lifecycle, snapshots; rolled back)");

  stage = "concurrent idempotency";
  const a = await connect(ids[0]);
  const a2 = await connect(ids[0]);
  const c = await connect(ids[3]);
  const c2 = await connect(ids[3]);
  const request = randomUUID();
  const duplicate = await Promise.all([create(c, "same@example.test", request), create(c2, "same@example.test", request)]);
  check(JSON.stringify(duplicate[0].operation) === JSON.stringify(duplicate[1].operation), "concurrent replay same operation");
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations where coach_user_id=$1", [ids[3]]) === 1, "single quota reservation for retry");
  const conflictId = randomUUID();
  const conflict = await Promise.allSettled([create(c, "one@example.test", conflictId), create(c2, "two@example.test", conflictId)]);
  check(conflict.filter((r) => r.status === "fulfilled").length === 1, "payload race one winner");
  check(conflict.filter((r) => r.status === "rejected" && r.reason.code === "22023").length === 1, "payload conflict rejected");

  stage = "concurrent duplicate recipient";
  const duplicateRequests = [randomUUID(), randomUUID()];
  const beforeDuplicates = await value(admin, "select count(*)::int as value from private.coach_invitation_operations where coach_user_id=$1", [ids[3]]);
  const sameRecipient = await Promise.allSettled([
    create(c, "Own-Duplicate@Example.Test", duplicateRequests[0]),
    create(c2, " own-duplicate@example.test ", duplicateRequests[1]),
  ]);
  check(sameRecipient.filter((r) => r.status === "fulfilled" && r.value.status === "recorded").length === 1, "duplicate own recipient has one concurrent winner");
  check(sameRecipient.filter((r) => r.status === "rejected" && r.reason.code === "55000").length === 1, "backend rejects duplicate pending recipient in same Coach portfolio");
  check(await value(admin, "select count(*)::int as value from private.coach_invitations where coach_user_id=$1 and recipient_email='own-duplicate@example.test' and state='pending'", [ids[3]]) === 1, "one pending invitation after different-request race");
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations where coach_user_id=$1", [ids[3]]) === beforeDuplicates + 1, "rejected duplicate consumes no creation quota");

  stage = "hourly atomic quota";
  let target;
  for (let i = 0; i < 9; i++) {
    const result = await create(a, `hour-${i}@example.test`);
    check(result.status === "recorded", "first nine allowed");
    target = result.operation.invitationId;
  }
  const quotaRace = await Promise.all([create(a, "race-one@example.test"), create(a2, "race-two@example.test")]);
  check(quotaRace.filter((r) => r.status === "recorded").length === 1, "hour quota tenth winner");
  check(quotaRace.filter((r) => r.status === "rate_limited").length === 1, "hour quota eleventh blocked");
  const limited = quotaRace.find((r) => r.status === "rate_limited");
  check(new Date(limited.retryAt) > new Date(limited.serverNow), "authoritative quota retry timestamp");
  await admin.query("update private.coach_invitations set created_at=t,issued_at=t,expires_at=t+interval '168 hours' from (select clock_timestamp()-interval '168 hours' as t) q where id=$1", [target]);
  const expiredCode = await value(admin, "select invitation_code as value from private.coach_invitations where id=$1", [target]);
  check((await invoke(a, "regenerate", target)).status === "rate_limited", "regeneration consumes creation quota");
  check(await value(admin, "select invitation_code as value from private.coach_invitations where id=$1", [target]) === expiredCode, "denied regeneration does not mutate");
  // Exact old boundary is expired by the next server statement; no wall-clock wait.
  await admin.query("update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '1 hour' where coach_user_id=$1 and action='create'", [ids[0]]);
  const regenRace = await Promise.allSettled([invoke(a, "regenerate", target), invoke(a2, "regenerate", target)]);
  check(regenRace.filter((r) => r.status === "fulfilled" && r.value.status === "recorded").length === 1, "explicit regeneration race winner");
  check(regenRace.filter((r) => r.status === "rejected" && r.reason.code === "55000").length === 1, "no silent second regeneration");
  check(await value(admin, "select generation as value from private.coach_invitations where id=$1", [target]) === 2, "generation increment once");

  stage = "daily quota";
  // Seed only operation budget fixtures in the private temporary cluster.
  await admin.query("update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '2 hours' where coach_user_id=$1 and action in ('create','regenerate')", [ids[0]]);
  await admin.query("insert into private.coach_invitation_operations(coach_user_id,request_id,action,payload,invitation_id,generation,reserved_at,state) select $1,gen_random_uuid(),'create','{}'::jsonb,$2,1,clock_timestamp()-interval '2 hours','reserved' from generate_series(1,38)", [ids[0], target]);
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations where coach_user_id=$1 and action in ('create','regenerate')", [ids[0]]) === 49, "daily fixture 49");
  const daily = await Promise.all([create(a, "daily-one@example.test"), create(a2, "daily-two@example.test")]);
  check(daily.filter((r) => r.status === "recorded").length === 1, "daily fiftieth winner");
  check(daily.filter((r) => r.status === "rate_limited").length === 1, "daily fifty-first blocked");
  await admin.query("update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '24 hours' where coach_user_id=$1 and action in ('create','regenerate')", [ids[0]]);
  check((await create(a, "new-window@example.test")).status === "recorded", "daily exact window expires");

  stage = "resend and cancellation races";
  await admin.query("update private.coach_invitations set issued_at=t,expires_at=t+interval '168 hours' from (select clock_timestamp()-interval '60 seconds' t) q where id=$1", [target]);
  const resendRace = await Promise.all([invoke(a, "resend", target), invoke(a2, "resend", target)]);
  check(resendRace.filter((r) => r.status === "recorded").length === 1, "concurrent resend one reservation");
  check(resendRace.filter((r) => r.status === "rate_limited").length === 1, "concurrent resend cooldown blocks duplicate");
  await admin.query("update private.coach_invitation_operations set reserved_at=clock_timestamp()-interval '60 seconds' where invitation_id=$1 and action='resend'", [target]);
  const cancelled = await Promise.allSettled([invoke(a, "cancel", target), invoke(a2, "resend", target)]);
  check(cancelled[0].status === "fulfilled", "cancel race succeeds");
  check(cancelled[1].status === "fulfilled" || cancelled[1].reason.code === "55000", "resend serializes against cancel");
  check(await value(admin, "select state='cancelled' and invitation_code is null as value from private.coach_invitations where id=$1", [target]), "cancel final state invalidates code");
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations where invitation_id=$1 and state='reserved'", [target]) === 0, "no live reservation after cancellation");

  stage = "membership removal race";
  await admin.query("begin");
  await admin.query("delete from public.coach_registrations where user_id=$1", [ids[3]]);
  const pending = create(c, "revoked-membership@example.test").then(() => "allowed", (error) => error.code);
  await admin.query("commit");
  check(await pending === "42501", "membership revoked before lock denies mutation");

  // Source-level checks supplement, not replace, executable SQL checks above.
  stage = "scope invariants";
  const source = readSql("supabase/migrations/20260909044235_coach_invitation_persistence.sql");
  check(!/\b(training_sessions|exercise_entries|training_cycles|storage\.|auth\.users\s+where)\b/i.test(source), "no training, storage or global account lookups");
  check(!/\braise\s+(notice|log|info|debug|warning)\b/i.test(source), "no logging statements");
  console.log(`COACH_INVITATIONS_LOCAL_POSTGRES=PASS (${checks} runner checks plus SQL contract; PostgreSQL 17.5; no TCP/remote DB)`);
} catch (error) {
  // Do not print SQL, query parameters, PostgreSQL DETAIL or generated codes.
  console.error(`COACH_INVITATIONS_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? error.status ?? "assertion"}`);
  if (error.message?.startsWith("Assertion failed:")) console.error(error.message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  // Remove only the exact private directory created by this invocation.
  rmSync(runtime, { recursive: true, force: true });
}
