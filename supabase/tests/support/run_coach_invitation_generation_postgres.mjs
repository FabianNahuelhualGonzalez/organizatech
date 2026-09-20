// Isolated synthetic PostgreSQL only. Required cached public binary; no downloads,
// dotenv, SDK, remote database or real Auth. Local overrides are pinned by SHA.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = "supabase/migrations/20260909120120_coach_invitation_generation_binding.sql";
const dependencyRelative = "supabase/migrations/20260909044235_coach_invitation_persistence.sql";
const dependencyHash = "0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc";
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const options = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const path = args[index + 1];
  if (!["--invitation-migration", "--postgres-archive"].includes(flag) || options.has(flag)
    || typeof path !== "string" || !isAbsolute(path)
    || (flag === "--invitation-migration" && !path.endsWith("/20260909044235_coach_invitation_persistence.sql"))
    || (flag === "--postgres-archive" && !path.endsWith(".jar"))) {
    throw new Error("Only unique --invitation-migration SQL and --postgres-archive JAR absolute local paths are allowed.");
  }
  options.set(flag, path);
}
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local runner requires macOS arm64.");
const archive = options.get("--postgres-archive");
if (!archive) throw new Error("Provide --postgres-archive with the verified cached PostgreSQL 17.5 JAR.");
const dependency = readFileSync(options.get("--invitation-migration") ?? join(root, dependencyRelative), "utf8");
if (digest(dependency) !== dependencyHash) throw new Error("Pinned invitation R2 dependency differs; no SQL executed.");
if (digest(readFileSync(archive)) !== archiveHash) throw new Error("Pinned PostgreSQL archive differs; no SQL executed.");
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C" };
const runtime = mkdtempSync(join(tmpdir(), "org-coach-generation-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const clients = [];
let started = false;
let checks = 0;
let stage = "binary";
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const newNames = ["resend_own_coach_invitation_for_generation", "regenerate_own_coach_invitation_for_generation",
  "read_own_coach_invitation_generation_operation", "mutate_coach_invitation_for_generation",
  "coach_invitation_generation_operation_view"];
const readSql = (path) => readFileSync(join(root, path), "utf8");
const run = (command, argv, config = {}) => execFileSync(command, argv, { env: childEnv, ...config });
const check = (condition, label) => {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks++;
};
const value = async (connection, sql, parameters = []) => (await connection.query(sql, parameters)).rows[0]?.value;
const command = (connection, action, id, generation, request) => {
  if (!["resend", "regenerate"].includes(action)) throw new Error("Invalid test action");
  return value(connection, `select public.${action}_own_coach_invitation_for_generation($1::uuid,$2::integer,$3::uuid) as value`,
    [id, generation, request]);
};
const legacy = (connection, action, id, request = randomUUID()) => {
  if (!["resend", "regenerate", "cancel"].includes(action)) throw new Error("Invalid test action");
  return value(connection, `select public.${action}_own_coach_invitation($1::uuid,$2::uuid) as value`, [id, request]);
};
const read = (connection, request) => value(connection,
  "select public.read_own_coach_invitation_generation_operation($1::uuid) as value", [request]);
const outcome = (promise) => promise.then((result) => ({ result }),
  (error) => ({ code: error.code, message: error.message }));
async function connect(userId = null) {
  const connection = new pg.Client({ host: socket, port: 55447, user: "postgres", database: "postgres",
    password: null, ssl: false, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
  await connection.connect();
  clients.push(connection);
  await connection.query("set timezone='UTC'");
  if (userId) {
    await connection.query("set role authenticated");
    await connection.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  }
  return connection;
}
async function waitForLock(admin, pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await value(admin, "select wait_event_type='Lock' as value from pg_stat_activity where pid=$1", [pid])) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Assertion failed: second connection waited for actual SQL lock");
}
async function fixture(admin, owner, expired = true) {
  const id = randomUUID();
  await admin.query(`insert into private.coach_invitations(id,coach_user_id,recipient_email,invitation_code,
    generation,created_at,issued_at,expires_at) values($1,$2,$3,private.new_coach_invitation_code(),1,
    now()-interval '9 days',now()-$4::interval,now()-$4::interval+interval '168 hours')`,
  [id, owner, id + "@example.test", expired ? "8 days" : "2 minutes"]);
  return id;
}
async function receiptCount(admin, owner, request) {
  return value(admin, "select count(*)::int as value from private.coach_invitation_operations where coach_user_id=$1 and request_id=$2", [owner, request]);
}

try {
  check(digest(readFileSync(archive)) === archiveHash, "cached binary SHA-256");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  stage = "initdb";
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
  stage = "start";
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55447 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
    "-w", "start"], { stdio: "ignore" });
  started = true;
  stage = "synthetic bootstrap";
  const admin = await connect();
  await admin.query(readSql("supabase/tests/support/coach_preferences_local_bootstrap.sql"));
  await admin.query(readSql("supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql"));
  await admin.query("create table public.profiles(id uuid primary key,created_at timestamptz not null)");
  await admin.query(readSql("supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql"));
  await admin.query("insert into public.user_registrations(user_id) values($1)", [ids[2]]);
  await admin.query("insert into public.coach_registrations(user_id,first_name,last_name,birth_date,gender,phone_number,professional_title) select id,'Synthetic','Coach','1990-01-01','prefer_not_to_say','test','Test' from auth.users where id<>$1", [ids[2]]);
  await admin.query(dependency);
  check(await value(admin, "select current_setting('server_version_num')::int between 170000 and 179999 as value"), "PostgreSQL 17");
  check(await value(admin, "select current_setting('listen_addresses')='' as value"), "private Unix socket; no TCP");
  const existingCatalog = async () => value(admin, `select md5(string_agg(v,'|' order by v)) as value from (
    select row_to_json(p)::text as v from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace)
      and not (p.proname=any($1::text[]))
    union all select row_to_json(c)::text from pg_class c where c.relnamespace='private'::regnamespace
    union all select row_to_json(p)::text from pg_policy p
  ) entries`, [newNames]);
  const before = await existingCatalog();
  stage = "new migration";
  await admin.query(readSql(migrationPath));
  check(await existingCatalog() === before, "existing functions, tables, indexes, grants and policies unchanged");
  check(await value(admin, "select count(*)::int as value from pg_proc where proname=any($1::text[])", [newNames]) === 5,
    "exactly three public RPCs and two private helpers");
  stage = "transactional SQL contract";
  await admin.query(readSql("supabase/tests/coach_invitation_generation_local.sql"));
  check(await value(admin, "select count(*)::int as value from private.coach_invitations") === 0, "SQL invitation fixtures rolled back");
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations") === 0, "SQL operation fixtures rolled back");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes") === 0, "SQL relationship table untouched");
  check(await existingCatalog() === before, "fault-injection trigger and test grants rolled back; old catalog unchanged");
  console.log("COACH_INVITATION_GENERATION_SQL_TRANSACTION=PASS (ACL/RLS, DTO, legacy separation, bounds, quotas, fault rollback)");
  const a = await connect(ids[0]);
  const a2 = await connect(ids[0]);
  const b = await connect(ids[1]);

  stage = "same request simultaneous regeneration";
  const first = await fixture(admin, ids[0]);
  const request = randomUUID();
  await a.query("begin");
  const recorded = await command(a, "regenerate", first, 1, request);
  const replaying = outcome(command(a2, "regenerate", first, 1, request));
  await waitForLock(admin, a2.processID);
  check(await read(b, request) === null, "another Coach is not blocked and cannot read ownless receipt");
  const releaseTime = await value(admin, "select clock_timestamp() as value");
  await a.query("commit");
  const replay = (await replaying).result;
  check(JSON.stringify(replay?.operation) === JSON.stringify(recorded.operation), "simultaneous exact request replays same receipt");
  check(new Date(replay.serverNow) >= releaseTime, "serverNow captured after exclusive owner lock");
  check(await receiptCount(admin, ids[0], request) === 1, "one concurrent request creates one quota operation");
  check(await value(admin, "select generation as value from private.coach_invitations where id=$1", [first]) === 2,
    "concurrent same request advances only once");
  check(Object.keys(replay.operation).sort().join(",") === "action,expectedGeneration,generation,invitationId,requestId,reservedAt,state",
    "runtime receipt exact seven keys");

  stage = "different request same generation race";
  const race = await fixture(admin, ids[0]);
  const losingRequest = randomUUID();
  await a.query("begin");
  await command(a, "regenerate", race, 1, randomUUID());
  const losing = outcome(command(a2, "regenerate", race, 1, losingRequest));
  await waitForLock(admin, a2.processID);
  await a.query("commit");
  const lost = await losing;
  check(lost.code === "55000" && lost.message === "coach_invitation_generation_conflict", "stale concurrent generation rejected sanitised");
  check(await receiptCount(admin, ids[0], losingRequest) === 0, "losing request creates no quota or binding");

  stage = "read cannot observe intermediate legacy payload";
  const visible = await fixture(admin, ids[0], false);
  const visibleRequest = randomUUID();
  await a.query("begin");
  const bound = await command(a, "resend", visible, 1, visibleRequest);
  const waitingRead = outcome(read(a2, visibleRequest));
  await waitForLock(admin, a2.processID);
  check(await receiptCount(admin, ids[0], visibleRequest) === 0, "uncommitted new operation is invisible to other snapshot");
  await a.query("commit");
  check(JSON.stringify((await waitingRead).result) === JSON.stringify(bound.operation), "read observes only committed bound receipt");

  stage = "legacy wins same request";
  const legacyFirst = await fixture(admin, ids[0], false);
  const legacyRequest = randomUUID();
  await a.query("begin");
  await legacy(a, "resend", legacyFirst, legacyRequest);
  const v2losing = outcome(command(a2, "resend", legacyFirst, 1, legacyRequest));
  await waitForLock(admin, a2.processID);
  await a.query("commit");
  check((await v2losing).code === "22023", "v2 cannot adopt concurrently committed v1");
  check(await value(admin, "select payload=jsonb_build_object('invitationId',invitation_id) as value from private.coach_invitation_operations where request_id=$1", [legacyRequest]),
    "legacy payload is not rewritten");
  stage = "bound request wins against legacy";
  const boundFirst = await fixture(admin, ids[0], false);
  const boundRequest = randomUUID();
  await a.query("begin");
  await command(a, "resend", boundFirst, 1, boundRequest);
  const legacyLosing = outcome(legacy(a2, "resend", boundFirst, boundRequest));
  await waitForLock(admin, a2.processID);
  await a.query("commit");
  check((await legacyLosing).code === "22023", "legacy cannot adopt concurrently committed v2");
  check((await read(a, boundRequest)).expectedGeneration === 1, "bound receipt remains generation aware");

  stage = "cancellation after generation command";
  const cancelAfter = await fixture(admin, ids[0]);
  const cancelAfterRequest = randomUUID();
  await a.query("begin");
  await command(a, "regenerate", cancelAfter, 1, cancelAfterRequest);
  const cancelling = outcome(legacy(a2, "cancel", cancelAfter));
  await waitForLock(admin, a2.processID);
  await a.query("commit");
  check((await cancelling).result?.status === "recorded", "cancellation runs after generation owner lock");
  const cancelledReplay = await command(a, "regenerate", cancelAfter, 1, cancelAfterRequest);
  check(cancelledReplay.operation.state === "cancelled" && cancelledReplay.operation.generation === 2,
    "cancelled exact replay is reconciliation, not a new mutation");
  stage = "cancellation before generation command";
  const cancelBefore = await fixture(admin, ids[0]);
  const cancelBeforeRequest = randomUUID();
  await a.query("begin");
  await legacy(a, "cancel", cancelBefore);
  const afterCancel = outcome(command(a2, "regenerate", cancelBefore, 1, cancelBeforeRequest));
  await waitForLock(admin, a2.processID);
  await a.query("commit");
  const cancelled = await afterCancel;
  check(cancelled.code === "55000" && cancelled.message === "coach_invitation_state_conflict", "cancel-first forbids a new generation");
  check(await receiptCount(admin, ids[0], cancelBeforeRequest) === 0, "cancel-first leaves no attempted reservation");

  stage = "rollback then explicit same request";
  const rolled = await fixture(admin, ids[0]);
  const rolledRequest = randomUUID();
  await a.query("begin");
  await command(a, "regenerate", rolled, 1, rolledRequest);
  await a.query("rollback");
  check(await read(a2, rolledRequest) === null, "explicit transaction rollback leaves no receipt");
  check((await command(a2, "regenerate", rolled, 1, rolledRequest)).operation.generation === 2, "caller may explicitly repeat same intention after rollback");

  stage = "different owner same request and current membership";
  const other = await fixture(admin, ids[1]);
  check((await command(b, "regenerate", other, 1, request)).operation.invitationId === other, "request namespace is owner scoped");
  check((await read(a, request)).invitationId === first && (await read(b, request)).invitationId === other,
    "same UUID never crosses ownership");
  await admin.query("begin");
  await admin.query("delete from public.coach_registrations where user_id=$1", [ids[0]]);
  const membershipRead = outcome(read(a, request));
  await waitForLock(admin, a.processID);
  await admin.query("commit");
  check((await membershipRead).code === "42501", "live membership removal blocks receipt read");
  check((await outcome(command(a2, "regenerate", first, 1, request))).code === "42501",
    "former Coach cannot replay old bound success");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes") === 0,
    "runtime never creates consent or touches relationship history");
  console.log(`COACH_INVITATION_GENERATION_LOCAL_POSTGRES=PASS (${checks} runner checks; PostgreSQL 17.5; no TCP/remote DB)`);
} catch (error) {
  // Never print SQL, arguments, identity, code, email or PostgreSQL detail/context.
  console.error(`COACH_INVITATION_GENERATION_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? error.status ?? "assertion"}`);
  if (stage === "new migration" && /^[0-9]+$/.test(error.position ?? "")) {
    console.error(`Migration syntax position=${error.position}`);
  }
  if (error.message?.startsWith("Assertion failed:")) console.error(error.message);
  if (stage === "transactional SQL contract"
    && /^(assertion failed|wrong SQLSTATE|unsanitized error|expected rejection): /.test(error.message ?? "")) {
    console.error(error.message); // Fixed labels only, never database detail.
  }
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  // Exact directory allocated by this invocation, never the external archive.
  rmSync(runtime, { recursive: true, force: true });
}
