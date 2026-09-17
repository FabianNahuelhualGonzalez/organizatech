// Isolated synthetic PostgreSQL only. Never use this bootstrap against Supabase.
// Optional dependency/archive overrides are absolute LOCAL paths pinned by SHA.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = "supabase/migrations/20260909100428_coach_active_relationships_list.sql";
const dependencyRelative = "supabase/migrations/20260909044235_coach_invitation_persistence.sql";
const dependencyHash = "0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc";
const args = process.argv.slice(2);
const options = new Map();
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
const dependency = readFileSync(options.get("--invitation-migration") ?? join(root, dependencyRelative), "utf8");
const digest = (value) => createHash("sha256").update(value).digest("hex");
if (digest(dependency) !== dependencyHash) throw new Error("Pinned invitation R2 dependency differs; no SQL executed.");
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const archiveOverride = options.get("--postgres-archive");
if (archiveOverride && digest(readFileSync(archiveOverride)) !== archiveHash) {
  throw new Error("Pinned local PostgreSQL archive differs; no SQL executed.");
}

// Discard PG defaults without reading/logging their values; no dotenv is loaded.
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C" };
const runtime = mkdtempSync(join(tmpdir(), "org-coach-active-list-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = archiveOverride ?? join(runtime, "postgres.jar");
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const clients = [];
let started = false;
let checks = 0;
let stage = "binary";
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const readSql = (path) => readFileSync(join(root, path), "utf8");
const run = (command, argv, config = {}) => execFileSync(command, argv, { env: childEnv, ...config });
const check = (condition, label) => {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks++;
};
const value = async (connection, sql, parameters = []) => (await connection.query(sql, parameters)).rows[0]?.value;
const list = (connection, query = "", limit = 25, cursor = null) => value(connection,
  "select public.list_own_active_coach_relationships($1,$2,$3::timestamptz,$4::uuid) as value",
  [query, limit, cursor?.linkedAt ?? null, cursor?.id ?? null]);
const revoke = (connection, id) => value(connection,
  "select public.revoke_own_coach_relationship($1::uuid,$2::uuid) as value", [id, randomUUID()]);
async function connect(userId = null) {
  const connection = new pg.Client({ host: socket, port: 55446, user: "postgres", database: "postgres",
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
async function fixture(admin, owner, name, email) {
  // Admin fixture only; not an acceptance API and never attributed to a Coach.
  const studentId = randomUUID();
  const invitationId = randomUUID();
  const episodeId = randomUUID();
  await admin.query("insert into auth.users(id) values($1)", [studentId]);
  await admin.query("insert into public.user_registrations(user_id) values($1)", [studentId]);
  await admin.query(`insert into private.coach_invitations(id,coach_user_id,recipient_email,state,created_at,issued_at,expires_at)
    values($1,$2,$3,'accepted',now()-interval '1 day',now()-interval '1 day',now()+interval '6 days')`,
  [invitationId, owner, email]);
  await admin.query(`insert into private.coach_relationship_episodes(id,invitation_id,coach_user_id,student_user_id,
    student_name_snapshot,student_email_snapshot,consented_at,linked_at)
    values($1,$2,$3,$4,$5,$6,now()-interval '1 day',now()-interval '1 day')`,
  [episodeId, invitationId, owner, studentId, name, email]);
  return episodeId;
}

try {
  if (!archiveOverride) run("curl", ["-fsSL", "--max-time", "60", archiveUrl, "-o", archive], { stdio: "ignore" });
  check(digest(readFileSync(archive)) === archiveHash, "binary SHA-256");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  stage = "initdb";
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
  stage = "start";
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55446 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
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
  check(await value(admin, "select current_setting('server_version_num')::int>=170000 and exists(select 1 from pg_collation where collname='pg_c_utf8' and collnamespace='pg_catalog'::regnamespace) as value"),
    "PostgreSQL 17 built-in Unicode collation exists");
  check(await value(admin, "select current_setting('listen_addresses')='' as value"), "private Unix socket only; no TCP listener");
  const existingCatalog = async () => value(admin, `select md5(string_agg(v,'|' order by v)) as value from (
    select row_to_json(p)::text as v from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace)
      and p.proname<>'list_own_active_coach_relationships'
    union all select row_to_json(c)::text from pg_class c where c.relnamespace='private'::regnamespace
    union all select row_to_json(p)::text from pg_policy p
  ) entries`);
  const before = await existingCatalog();
  stage = "new migration";
  await admin.query(readSql(migrationPath));
  check(await existingCatalog() === before, "existing functions, tables, indexes, grants and policies unchanged");
  stage = "transactional SQL contract";
  await admin.query(readSql("supabase/tests/coach_active_relationships_list_local.sql"));
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes") === 0, "SQL episodes rolled back");
  check(await value(admin, "select count(*)::int as value from private.coach_invitations") === 0, "SQL invitations rolled back");
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations") === 0, "SQL operations rolled back");
  check(await value(admin, "select count(*)::int as value from auth.users") === 4, "SQL synthetic identities rolled back");
  console.log("COACH_ACTIVE_RELATIONSHIPS_LIST_SQL_TRANSACTION=PASS (ACL/RLS, input, snapshots, literal search, keyset, rollback)");

  stage = "runtime synthetic fixtures";
  await admin.query("begin");
  const first = await fixture(admin, ids[0], "First", "first@example.test");
  await fixture(admin, ids[0], "Second", "second@example.test");
  await fixture(admin, ids[0], "Third", "third@example.test");
  await fixture(admin, ids[1], "SØREN ΟΣ", "first@example.test");
  await admin.query("commit");
  const a = await connect(ids[0]);
  const b = await connect(ids[1]);
  const a2 = await connect(ids[0]);
  stage = "fresh snapshot after revocation lock";
  await a.query("begin");
  await revoke(a, first);
  const pending = list(a2);
  await waitForLock(admin, a2.processID);
  check((await list(b)).totalActive === 1, "different Coach reads independently");
  const beforeRelease = await value(admin, "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as value");
  await a.query("commit");
  const result = await pending;
  check(result.totalActive === 2 && result.matchingCount === 2 && result.items.length === 2
    && result.items.every((item) => item.id !== first), "counts/items see same post-revocation snapshot");
  check(result.serverNow >= beforeRelease, "server clock captured after exclusive lock");
  check(result.items.every((item) => item.linkedAt <= result.serverNow), "past fixture timestamps precede snapshot clock");
  check(result.items.every((item) => Object.keys(item).sort().join(",") === "id,linkedAt,studentEmail,studentName"), "runtime DTO item allowlist");
  const page = await list(a, "", 1);
  check(page.nextCursor !== null && page.items.length === 1 && page.totalActive === 2, "runtime next cursor does not truncate count");
  const next = await list(a, "", 1, page.nextCursor);
  check(next.items.length === 1 && next.nextCursor === null && next.items[0].id !== page.items[0].id, "runtime last page no duplicate");
  check((await list(a, "", 1)).items[0].id === page.items[0].id, "repeat listing preserves cursor identity");

  stage = "list lock serializes revocation";
  await a.query("begin");
  const held = await list(a, "", 1);
  const revoking = revoke(a2, held.items[0].id);
  await waitForLock(admin, a2.processID);
  check((await list(a)).totalActive === 2, "own transaction holds exclusive lock while revocation waits");
  await a.query("commit");
  check((await revoking).status === "recorded", "revocation proceeds after list transaction");
  const afterRevoke = await list(a, "", 1, held.nextCursor);
  check(afterRevoke.totalActive === 1 && afterRevoke.items.length === 1, "revoked cursor anchor remains usable across connections");
  await revoke(a2, afterRevoke.items[0].id);
  const empty = await list(a, "", 1, held.nextCursor);
  check(empty.totalActive === 0 && empty.matchingCount === 0 && empty.items.length === 0 && empty.nextCursor === null,
    "next page may become empty after revocations");
  check(await value(admin, "select count(*)::int as value from private.coach_relationship_episodes where coach_user_id=$1 and ended_at is not null", [ids[0]]) === 3,
    "revocation retains schema history but listing excludes it");

  stage = "membership removal serializes read";
  await admin.query("begin");
  await admin.query("delete from public.coach_registrations where user_id=$1", [ids[0]]);
  const revoked = list(a).then(() => "allowed", (error) => error.code);
  await waitForLock(admin, a.processID);
  await admin.query("commit");
  check(await revoked === "42501", "removed membership cannot list");
  stage = "Unicode authoritative matching";
  const unicode = await list(b, "οσ");
  check(unicode.matchingCount === 1 && unicode.items[0].studentName === "SØREN ΟΣ", "SQL Unicode simple lowercase sigma");
  const simpleLower = await value(admin, "select lower('ΟΣ' collate pg_catalog.pg_c_utf8) as value");
  check(simpleLower === "οσ" && simpleLower !== "ΟΣ".toLowerCase(), "JS contextual lowercase must not reject server matches");
  stage = "scope invariants";
  const source = readSql(migrationPath);
  check(!/\b(create\s+(table|index|policy|extension|trigger)|alter\s+table|insert\s+into|update\s+private|delete\s+from|training_sessions|exercise_entries)\b/i.test(source), "new SQL contains only listing boundary");
  check(!/\braise\s+(notice|log|info|debug|warning)\b/i.test(source), "no database logging");
  console.log(`COACH_ACTIVE_RELATIONSHIPS_LIST_LOCAL_POSTGRES=PASS (${checks} runner checks; PostgreSQL 17.5; no TCP/remote DB)`);
} catch (error) {
  // Never print SQL, parameters, identities or PostgreSQL detail/context.
  console.error(`COACH_ACTIVE_RELATIONSHIPS_LIST_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? error.status ?? "assertion"}`);
  if (error.message?.startsWith("Assertion failed:")) console.error(error.message);
  if (stage === "transactional SQL contract"
    && /^(assertion failed|wrong SQLSTATE|unsanitized error|expected rejection): /.test(error.message ?? "")) {
    console.error(error.message); // Fixed test labels only, never database detail.
  }
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  // Exact directory allocated by this invocation; an external archive is untouched.
  rmSync(runtime, { recursive: true, force: true });
}
