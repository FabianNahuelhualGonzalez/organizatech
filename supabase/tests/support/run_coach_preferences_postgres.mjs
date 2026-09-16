// Runs only a fresh, private Unix-socket PostgreSQL instance, never QA/PROD.
// PostgreSQL 17.5 artifact is pinned by SHA-256; no dotenv or remote DB URL is loaded.
// pg may consult default PG* environment options; the SQL destination is fixed locally.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("This local runner requires macOS arm64; no SQL verification was performed.");
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "organizatech-coach-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket");
const dataDir = join(runtime, "data");
const archive = join(runtime, "postgres.jar");
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const clients = [];
let started = false;
let assertions = 0;
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const sqlFile = (path) => readFileSync(join(root, path), "utf8");

async function client(role = null, userId = "") {
  const connection = new pg.Client({ host: socket, port: 55442, user: "postgres", database: "postgres" });
  await connection.connect();
  clients.push(connection);
  // role comes only from these hardcoded local test cases, never user input.
  if (role) await connection.query(`set role ${role}`);
  await connection.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  return connection;
}

async function result(connection, sql, args = []) {
  return (await connection.query(sql, args)).rows[0]?.value;
}

async function rejects(connection, sql, args, code) {
  await assert.rejects(connection.query(sql, args), (error) => error.code === code);
  assertions++;
}

function same(actual, expected) {
  assert.deepEqual(actual, expected);
  assertions++;
}

const readSql = "select public.read_own_coach_dashboard_preferences() as value";
const saveSql = "select public.save_own_coach_dashboard_fee($1::numeric, $2::numeric) as value";
const chatSql = "select public.register_own_coach_chat_interest() as value";

try {
  execFileSync("curl", ["-fsSL", "--max-time", "90", archiveUrl, "-o", archive]);
  assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), archiveHash);
  const tarball = execFileSync("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 });
  execFileSync("tar", ["-xJ", "-C", runtime], { input: tarball });
  mkdirSync(socket, { mode: 0o700 });
  execFileSync(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  // Empty listen_addresses: no TCP listener; socket is inside our 0700 temp directory.
  execFileSync(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o", `-h '' -k ${socket} -p 55442`, "-w", "start"], { stdio: "ignore" });
  started = true;
  const admin = await client();
  await admin.query(sqlFile("supabase/tests/support/coach_preferences_local_bootstrap.sql"));
  await admin.query(sqlFile("supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql"));
  await admin.query("insert into public.coach_registrations (user_id,first_name,last_name,birth_date,gender,phone_number,professional_title) select id,'Synthetic','Coach','1990-01-01','prefer_not_to_say','test','Test' from auth.users where id <> $1", [ids[2]]);
  await admin.query(sqlFile("supabase/migrations/20260908201518_coach_dashboard_private_preferences.sql"));
  const coachA = await client("authenticated", ids[0]);
  const coachB = await client("authenticated", ids[1]);
  const noCoach = await client("authenticated", ids[2]);
  const anon = await client("anon");
  const noIdentity = await client("authenticated");
  const virgin = { monthlyFeeClp: null, version: 0, chatInterestRegistered: false };
  same(await result(coachA, readSql), virgin);
  same(await result(admin, "select count(*)::int as value from private.coach_dashboard_settings"), 0);

  for (const unauthorised of [noCoach, anon, noIdentity]) {
    await rejects(unauthorised, readSql, [], "42501");
    await rejects(unauthorised, saveSql, [35000, 0], "42501");
    await rejects(unauthorised, chatSql, [], "42501");
  }
  for (const amount of [null, -1, "0.1", "NaN", "Infinity", "-Infinity", "9007199254740992"]) {
    await rejects(coachA, saveSql, [amount, 0], "22023");
  }
  for (const version of [null, -1, "0.1", "NaN", "Infinity", "-Infinity", "9007199254740991"]) {
    await rejects(coachA, saveSql, [35000, version], "22023");
  }
  await rejects(coachA, saveSql, [35000, 1], "40001");
  await rejects(coachA, "select public.save_own_coach_dashboard_fee(p_monthly_fee_clp=>35000,p_expected_version=>0,p_owner_id=>$1::uuid)", [ids[1]], "42883");
  same(await result(coachA, saveSql, [35000, 0]), { monthlyFeeClp: 35000, version: 1 });
  await rejects(coachA, saveSql, [99999, 0], "40001");
  same(await result(coachA, readSql), { monthlyFeeClp: 35000, version: 1, chatInterestRegistered: false });
  same(await result(coachB, readSql), virgin);
  same(await result(coachB, saveSql, [0, 0]), { monthlyFeeClp: 0, version: 1 });
  same(await result(coachA, readSql), { monthlyFeeClp: 35000, version: 1, chatInterestRegistered: false });
  same(await result(coachA, saveSql, ["9007199254740991", 1]), { monthlyFeeClp: Number.MAX_SAFE_INTEGER, version: 2 });
  same(await result(coachA, chatSql), { chatInterestRegistered: true });
  const chatCreatedAt = await result(admin, "select created_at as value from private.coach_dashboard_feature_interests where coach_user_id=$1", [ids[0]]);
  same(await result(coachA, chatSql), { chatInterestRegistered: true });
  same(await result(admin, "select created_at as value from private.coach_dashboard_feature_interests where coach_user_id=$1", [ids[0]]), chatCreatedAt);
  same(await result(coachA, readSql), { monthlyFeeClp: Number.MAX_SAFE_INTEGER, version: 2, chatInterestRegistered: true });
  same(await result(coachB, readSql), { monthlyFeeClp: 0, version: 1, chatInterestRegistered: false });

  for (const role of ["anon", "authenticated"]) {
    for (const table of ["private.coach_dashboard_settings", "private.coach_dashboard_feature_interests"]) {
      same(await result(admin, "select has_table_privilege($1,$2,'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as value", [role, table]), false);
    }
  }
  for (const table of ["coach_dashboard_settings", "coach_dashboard_feature_interests"]) {
    const row = (await admin.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass", [`private.${table}`])).rows[0];
    same(row, { relrowsecurity: true, relforcerowsecurity: true });
    await rejects(coachA, `select * from private.${table}`, [], "42501");
  }
  const publicRpcNames = ["read_own_coach_dashboard_preferences", "save_own_coach_dashboard_fee", "register_own_coach_chat_interest"];
  const functions = (await admin.query("select p.proname,p.prosecdef,p.proconfig,exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) as acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute from pg_proc as p join pg_namespace as ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=any($1::text[])", [publicRpcNames])).rows;
  same(functions.length, 3);
  for (const fn of functions) {
    same({ definer: fn.prosecdef, path: fn.proconfig, public: fn.public_execute, anon: fn.anon_execute, authenticated: fn.authenticated_execute }, {
      definer: true, path: ['search_path=""'], public: false, anon: false, authenticated: true,
    });
  }
  same(await result(admin, "select has_function_privilege('authenticated','private.require_coach_dashboard_owner()','EXECUTE') as value"), false);

  // Real simultaneous transactions, not just sequential stale-version simulations.
  const concurrentA = await client("authenticated", ids[3]);
  const concurrentB = await client("authenticated", ids[3]);
  const race = await Promise.allSettled([
    concurrentA.query(saveSql, [100, 0]), concurrentB.query(saveSql, [200, 0]),
  ]);
  same(race.filter((entry) => entry.status === "fulfilled").length, 1);
  same(race.filter((entry) => entry.status === "rejected" && entry.reason.code === "40001").length, 1);
  same((await result(concurrentA, readSql)).version, 1);
  const updates = await Promise.allSettled([
    concurrentA.query(saveSql, [300, 1]), concurrentB.query(saveSql, [400, 1]),
  ]);
  same(updates.filter((entry) => entry.status === "fulfilled").length, 1);
  same(updates.filter((entry) => entry.status === "rejected" && entry.reason.code === "40001").length, 1);
  await Promise.all([concurrentA.query(chatSql), concurrentB.query(chatSql)]);
  same(await result(admin, "select count(*)::int as value from private.coach_dashboard_feature_interests where coach_user_id=$1", [ids[3]]), 1);
  same((await result(concurrentA, readSql)).version, 2);

  await admin.query("delete from public.coach_registrations where user_id=$1", [ids[1]]);
  await rejects(coachB, readSql, [], "42501");
  await rejects(coachB, saveSql, [100, 1], "42501");
  await rejects(coachB, chatSql, [], "42501");
  await admin.query("delete from auth.users where id=$1", [ids[0]]);
  same(await result(admin, "select count(*)::int as value from private.coach_dashboard_settings where coach_user_id=$1", [ids[0]]), 0);
  same(await result(admin, "select count(*)::int as value from private.coach_dashboard_feature_interests where coach_user_id=$1", [ids[0]]), 0);
  console.log(`COACH_PREFERENCES_LOCAL_POSTGRES=PASS (${assertions} assertions; PostgreSQL 17.5; no TCP/remote DB)`);
} finally {
  await Promise.allSettled(clients.map((connection) => connection.end()));
  if (started) execFileSync(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  // Only the exact directory returned by mkdtempSync above is removed.
  rmSync(runtime, { recursive: true, force: true });
}
