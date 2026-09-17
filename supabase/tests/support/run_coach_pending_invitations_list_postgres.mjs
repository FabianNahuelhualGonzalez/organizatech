// Isolated synthetic PostgreSQL only. Never use this bootstrap against Supabase.
// Dependency override is an explicit LOCAL SQL path with a pinned R2 digest.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationPath = "supabase/migrations/20260909085022_coach_pending_invitations_list.sql";
const dependencyRelative = "supabase/migrations/20260909044235_coach_invitation_persistence.sql";
const dependencyHash = "0f72a10fc35fc4203aa65d11c4181206749a56be31302f891ce90afc00eec3fc";
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--invitation-migration" || !isAbsolute(args[1])
  || !args[1].endsWith("/20260909044235_coach_invitation_persistence.sql"))) {
  throw new Error("Use no arguments or --invitation-migration with an absolute local SQL path.");
}
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local runner requires macOS arm64.");
const dependency = readFileSync(args[1] ?? join(root, dependencyRelative), "utf8");
const digest = (value) => createHash("sha256").update(value).digest("hex");
if (digest(dependency) !== dependencyHash) throw new Error("Pinned invitation R2 dependency differs; no SQL executed.");

// Discard PG defaults without reading/logging their values; no dotenv is loaded.
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const runtime = mkdtempSync(join(tmpdir(), "org-coach-pending-list-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = join(runtime, "postgres.jar");
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const clients = [];
let started = false;
let checks = 0;
let stage = "binary";
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const readSql = (path) => readFileSync(join(root, path), "utf8");
const run = (command, argv, options = {}) => execFileSync(command, argv, { env: childEnv, ...options });
const check = (condition, label) => {
  if (!condition) throw new Error(`Assertion failed: ${label}`);
  checks++;
};
const value = async (connection, sql, parameters = []) => (await connection.query(sql, parameters)).rows[0]?.value;
const list = (connection, query = "", limit = 25, cursor = null) => value(connection,
  "select public.list_own_pending_coach_invitations($1,$2,$3::timestamptz,$4::uuid) as value",
  [query, limit, cursor?.createdAt ?? null, cursor?.id ?? null]);
const create = (connection, email) => value(connection,
  "select public.create_own_coach_invitation($1,$2::uuid) as value", [email, randomUUID()]);
async function connect(userId = null) {
  const connection = new pg.Client({ host: socket, port: 55445, user: "postgres", database: "postgres",
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

try {
  run("curl", ["-fsSL", "--max-time", "60", archiveUrl, "-o", archive], { stdio: "ignore" });
  check(digest(readFileSync(archive)) === archiveHash, "binary SHA-256");
  const tarball = run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 });
  run("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  stage = "initdb";
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres", "--encoding=UTF8", "--locale=C"], { stdio: "ignore" });
  stage = "start";
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55445 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
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
  check(await value(admin, "select exists(select 1 from pg_collation where collname='pg_c_utf8' and collnamespace='pg_catalog'::regnamespace) as value"), "PostgreSQL 17 built-in Unicode collation exists");
  const existingCatalog = async () => value(admin, `select md5(string_agg(row_to_json(p)::text,'|' order by p.oid)) as value
    from pg_proc p where p.pronamespace in ('public'::regnamespace,'private'::regnamespace)
      and p.proname<>'list_own_pending_coach_invitations'`);
  const before = await existingCatalog();
  stage = "new migration";
  await admin.query(readSql(migrationPath));
  check(await existingCatalog() === before, "existing functions unchanged by new migration");
  stage = "transactional SQL contract";
  await admin.query(readSql("supabase/tests/coach_pending_invitations_list_local.sql"));
  check(await value(admin, "select count(*)::int as value from private.coach_invitations") === 0, "SQL fixtures rolled back");
  check(await value(admin, "select count(*)::int as value from private.coach_invitation_operations") === 0, "SQL operations rolled back");
  console.log("COACH_PENDING_INVITATIONS_LIST_SQL_TRANSACTION=PASS (ACL/RLS, input, literal search, keyset, expiry, rollback)");

  const a = await connect(ids[0]);
  const b = await connect(ids[1]);
  const a2 = await connect(ids[0]);
  stage = "fresh snapshot after writer lock";
  await a.query("begin");
  await create(a, "first@example.test");
  const pending = list(a2);
  await waitForLock(admin, a2.processID);
  check((await list(b)).totalPending === 0, "different Coach reads independently");
  await create(a, "second@example.test");
  const beforeRelease = await value(admin, "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as value");
  await a.query("commit");
  const result = await pending;
  check(result.totalPending === 2 && result.matchingCount === 2 && result.items.length === 2, "counts/items see same post-lock snapshot");
  check(result.serverNow >= beforeRelease, "server clock captured after exclusive lock");
  check(result.items.every((item) => item.issuedAt <= result.serverNow), "newly committed rows precede snapshot clock");
  check(result.items.every((item) => Object.keys(item).sort().join(",") === "createdAt,expiresAt,id,issuedAt,recipientEmail,state"), "runtime DTO item allowlist");
  const page = await list(a, "", 1);
  check(page.nextCursor !== null && page.items.length === 1 && page.totalPending === 2, "runtime next cursor does not truncate count");
  const next = await list(a, "", 1, page.nextCursor);
  check(next.items.length === 1 && next.nextCursor === null && next.items[0].id !== page.items[0].id, "runtime last page no duplicate");

  stage = "list lock serializes cancellation";
  await a.query("begin");
  const held = await list(a, "", 1);
  const cancelId = held.items[0].id;
  const cancelling = value(a2, "select public.cancel_own_coach_invitation($1::uuid,$2::uuid) as value", [cancelId, randomUUID()]);
  await waitForLock(admin, a2.processID);
  check((await list(a)).totalPending === 2, "same transaction stable while cancel waits");
  await a.query("commit");
  check((await cancelling).status === "recorded", "cancel proceeds after list transaction");
  const afterCancel = await list(a, "", 1, held.nextCursor);
  check(afterCancel.totalPending === 1 && afterCancel.items.length === 1, "cancelled cursor anchor remains usable across connections");
  await value(a2, "select public.cancel_own_coach_invitation($1::uuid,$2::uuid) as value", [afterCancel.items[0].id, randomUUID()]);
  const empty = await list(a, "", 1, held.nextCursor);
  check(empty.totalPending === 0 && empty.matchingCount === 0 && empty.items.length === 0 && empty.nextCursor === null,
    "next page may become empty after cancellations");

  stage = "membership removal serializes read";
  await admin.query("begin");
  await admin.query("delete from public.coach_registrations where user_id=$1", [ids[0]]);
  const revoked = list(a).then(() => "allowed", (error) => error.code);
  await waitForLock(admin, a.processID);
  await admin.query("commit");
  check(await revoked === "42501", "removed membership cannot list");
  stage = "Unicode authoritative matching";
  await create(b, "οσ@example.test");
  const unicode = await list(b, "ΟΣ");
  check(unicode.matchingCount === 1 && unicode.items[0].recipientEmail === "οσ@example.test", "SQL Unicode simple lowercase sigma");
  const simpleLower = await value(admin, "select lower('ΟΣ' collate pg_catalog.pg_c_utf8) as value");
  check(simpleLower === "οσ" && simpleLower !== "ΟΣ".toLowerCase(), "JS contextual lowercase must not reject server matches");
  stage = "scope invariants";
  const source = readSql(migrationPath);
  check(!/\b(create\s+(table|index|policy|extension|trigger)|alter\s+table|insert\s+into|update\s+private|delete\s+from|training_sessions|exercise_entries)\b/i.test(source), "new SQL contains only listing boundary");
  check(!/\braise\s+(notice|log|info|debug|warning)\b/i.test(source), "no database logging");
  console.log(`COACH_PENDING_INVITATIONS_LIST_LOCAL_POSTGRES=PASS (${checks} runner checks; PostgreSQL 17.5; no TCP/remote DB)`);
} catch (error) {
  // Never print SQL, parameters, emails, codes or PostgreSQL detail/context.
  console.error(`COACH_PENDING_INVITATIONS_LIST_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? error.status ?? "assertion"}`);
  if (error.message?.startsWith("Assertion failed:")) console.error(error.message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  // Exact directory allocated by this invocation; never a worktree or account path.
  rmSync(runtime, { recursive: true, force: true });
}
