// Synthetic local PostgreSQL 17.5 only. No env files, TCP, QA or PROD.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local PostgreSQL runner requires macOS arm64");
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key])
  .map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "org-commercial-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket"), dataDir = join(runtime, "data"), archive = join(runtime, "postgres.jar");
const url = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const hash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const connections = [];
const run = (bin, args, options = {}) => execFileSync(bin, args, { env: childEnv, ...options });
const sql = (path) => readFileSync(join(root, path), "utf8");
const check = (condition, label) => { if (!condition) throw new Error(`Assertion failed: ${label}`); };
let started = false, stage = "bootstrap";
async function connect(userId = null) {
  const connection = new pg.Client({ host: socket, port: 55446, user: "postgres", database: "postgres",
    password: null, ssl: false, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
  await connection.connect();
  connections.push(connection);
  if (userId) {
    await connection.query("set role authenticated");
    await connection.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  }
  return connection;
}
const value = async (connection, query, args = []) => (await connection.query(query, args)).rows[0]?.value;
async function fixture(admin, owner) {
  const student = randomUUID(), invitation = randomUUID(), episode = randomUUID();
  await admin.query("insert into auth.users(id) values($1)", [student]);
  await admin.query("insert into public.user_registrations(user_id) values($1)", [student]);
  await admin.query("insert into private.coach_invitations(id,coach_user_id,recipient_email,state,invitation_code,created_at,issued_at,expires_at) select $1,$2,'synthetic@example.test','accepted',null,t,t,t+interval '168 hours' from (select clock_timestamp()-interval '1 day' t) q", [invitation, owner]);
  await admin.query("insert into private.coach_relationship_episodes(id,invitation_id,coach_user_id,student_user_id,student_name_snapshot,student_email_snapshot,consented_at,linked_at) select $1,$2,$3,$4,'Synthetic Student','synthetic@example.test',t,t from (select clock_timestamp()-interval '12 hours' t) q", [episode, invitation, owner, student]);
  return episode;
}
const zero = "00000000-0000-0000-0000-000000000000";
const write = (c, action, episode, version, request, period = null, amount = null, frequency = null, start = null, end = null) =>
  value(c, "select public.write_own_coach_commercial($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7,$8,$9) value",
    [action, episode, request, version, period, amount, frequency, start, end]);
const rejected = async (promise, code) => {
  const result = await promise.then(() => "allowed", (error) => error.code);
  check(result === code, `expected SQLSTATE ${code}, got ${result}`);
};
try {
  run("curl", ["-fsSL", "--max-time", "90", url, "-o", archive]);
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === hash, "PostgreSQL artifact hash");
  run("tar", ["-xJ", "-C", runtime], { input: run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 }) });
  mkdirSync(socket, { mode: 0o700 });
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55446 -c log_statement=none -c log_min_error_statement=panic`, "-w", "start"], { stdio: "ignore" });
  started = true;
  stage = "migration";
  const admin = await connect();
  await admin.query(sql("supabase/tests/support/coach_preferences_local_bootstrap.sql"));
  await admin.query(sql("supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql"));
  await admin.query("create table public.profiles (id uuid primary key, created_at timestamptz not null)");
  await admin.query(sql("supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql"));
  await admin.query("insert into public.user_registrations(user_id) values ($1)", [ids[2]]);
  await admin.query("insert into public.coach_registrations(user_id,first_name,last_name,birth_date,gender,phone_number,professional_title) select id,'Synthetic','Coach','1990-01-01','prefer_not_to_say','test','Test' from auth.users where id<>$1", [ids[2]]);
  await admin.query(sql("supabase/migrations/20260909044235_coach_invitation_persistence.sql"));
  await admin.query(sql("supabase/migrations/20261005000000_coach_commercial_portfolio_v1.sql"));
  await admin.query(sql("supabase/migrations/20261005193856_coach_commercial_pagination_v1.sql"));
  stage = "ACL and ownership";
  const a = await connect(ids[0]), a2 = await connect(ids[0]), b = await connect(ids[1]), student = await connect(ids[2]);
  const episode = await fixture(admin, ids[0]), foreignEpisode = await fixture(admin, ids[1]);
  const today = await value(admin, "select to_char((clock_timestamp() at time zone 'America/Santiago')::date,'YYYY-MM-DD') value");
  check(await value(admin, "select has_table_privilege('authenticated','private.coach_commercial_periods','SELECT') value") === false, "no direct table read");
  check(await value(admin, "select has_table_privilege('authenticated','private.coach_commercial_periods','INSERT') value") === false, "no direct table write");
  check(await value(admin, "select relforcerowsecurity value from pg_class where oid='private.coach_commercial_periods'::regclass") === true, "RLS forced");
  check(await value(admin, "select has_function_privilege('anon','public.write_own_coach_commercial(text,uuid,uuid,uuid,uuid,bigint,text,text,text)','EXECUTE') value") === false, "anon cannot execute write RPC");
  await rejected(write(student, "start", episode, zero, randomUUID(), null, 45000, "monthly", today), "42501");
  await rejected(write(b, "start", episode, zero, randomUUID(), null, 45000, "monthly", today), "P0002");
  await rejected(write(a, "start", foreignEpisode, zero, randomUUID(), null, 45000, "monthly", today), "P0002");
  stage = "frequencies and idempotency";
  const request = randomUUID();
  const same = await Promise.all([
    write(a, "start", episode, zero, request, null, 45000, "monthly", today),
    write(a2, "start", episode, zero, request, null, 45000, "monthly", today),
  ]);
  check(JSON.stringify(same[0]) === JSON.stringify(same[1]), "concurrent replay stable");
  check(await value(admin, "select count(*)::int value from private.coach_commercial_periods where episode_id=$1", [episode]) === 1, "one period");
  await rejected(write(a, "start", episode, zero, request, null, 40000, "monthly", today), "22023");
  await rejected(write(a, "start", episode, zero, randomUUID(), null, 45000, "monthly", today), "40001");
  await rejected(write(a, "renew", episode, same[0].version, randomUUID(), null, 45000, "invalid", today), "22023");
  const end = await value(admin, "select to_char(ends_before,'YYYY-MM-DD') value from private.coach_commercial_periods where episode_id=$1", [episode]);
  for (const [frequency, expected] of [["daily", "1 day"], ["weekly", "7 days"], ["quarterly", "3 months"], ["semiannual", "6 months"], ["annual", "1 year"]]) {
    const actual = await value(admin, "select private.coach_commercial_period_end($1::date,$2)::text value", [today, frequency]);
    const calendar = await value(admin, `select ($1::date + interval '${expected}')::date::text value`, [today]);
    check(actual === calendar, `${frequency} calendar arithmetic`);
  }
  check(await value(admin, "select private.coach_commercial_period_end('2024-01-31','monthly')::text value") === "2024-02-29", "leap month end");
  check(await value(admin, "select private.coach_commercial_period_end('2024-02-29','annual')::text value") === "2025-02-28", "annual leap rollover");
  const racingEpisode = await fixture(admin, ids[0]);
  const competing = await Promise.allSettled([
    write(a, "start", racingEpisode, zero, randomUUID(), null, 30000, "monthly", today),
    write(a2, "start", racingEpisode, zero, randomUUID(), null, 35000, "monthly", today),
  ]);
  check(competing.filter((result) => result.status === "fulfilled").length === 1, "distinct request race one winner");
  check(competing.filter((result) => result.status === "rejected" && result.reason.code === "40001").length === 1,
    "distinct request race stale version rejected");
  stage = "payment and history";
  const period = same[0].periodId;
  const paid = await write(a, "confirm_payment", episode, same[0].version, randomUUID(), period);
  await rejected(write(a, "confirm_payment", episode, paid.version, randomUUID(), period), "55000");
  await rejected(write(a, "confirm_payment", episode, paid.version, randomUUID(), randomUUID()), "P0002");
  const snapshot = await value(a, "select public.read_own_coach_commercial() value");
  const raceAmount = competing[0].status === "fulfilled" ? 30000 : 35000;
  const page = async (connection, kind, episodeId = null, cursor = null, limit = 20) =>
    value(connection, "select public.read_own_coach_commercial_page($1,$2::uuid,$3,$4) value",
      [kind, episodeId, cursor, limit]);
  check(await value(admin, "select has_function_privilege('anon','public.read_own_coach_commercial_page(text,uuid,text,integer)','EXECUTE') value") === false, "anonymous page denied");
  await rejected(page(student, "items"), "42501");
  await rejected(page(a, "periods", foreignEpisode), "P0002");
  await rejected(page(b, "periods", episode), "P0002");
  await rejected(page(a, "periods", episode, "bad"), "22023");
  await rejected(page(a, "items", null, null, 51), "22023");
  await rejected(page(a, "months", episode), "22023");
  const ownPeriods = await page(a, "periods", episode, null, 1);
  check(ownPeriods.rows.length === 1 && ownPeriods.rows[0].id === period, "owner period page");
  const ownItems = await page(a, "items", null, null, 1);
  check(ownItems.rows.length === 1 && ownItems.nextCursor !== null, "bounded item page");
  const nextItems = await page(a, "items", null, ownItems.nextCursor, 1);
  check(nextItems.rows.length === 1 && nextItems.rows[0].episodeId !== ownItems.rows[0].episodeId,
    "stable item cursor");
  const monthPage = await page(a, "months", null, null, 1);
  check(monthPage.rows.length === 1 && monthPage.rows[0].estimatedClp === 45000 + raceAmount,
    "monthly sum unaffected by page size");
  const overview = await value(a, "select public.read_own_coach_commercial_overview() value");
  check(overview.stats.activeCount === snapshot.activeCount && overview.stats.alertCount === 0,
    "overview counts match complete facts");
  check(overview.months[0].estimatedClp === snapshot.months[0].estimatedClp
    && overview.months[0].confirmedPaymentsClp === snapshot.months[0].confirmedPaymentsClp,
  "overview money matches complete history");
  check(snapshot.months.some((month) => month.estimatedClp === 45000 + raceAmount
    && month.confirmedPaymentsClp === 45000), "estimate and payment separate facts");
  check(snapshot.items.find((item) => item.episodeId === episode).latestPeriod.amountClp === 45000, "amount pinned");
  await admin.query("update private.coach_relationship_episodes set linked_at=t, consented_at=t from (select clock_timestamp()-interval '2 months' t) q where id=$1", [foreignEpisode]);
  const emptyMonths = await value(b, "select public.read_own_coach_commercial() value");
  check(emptyMonths.months.length >= 3 && emptyMonths.months.every((month) =>
    month.estimatedClp === 0 && month.confirmedPaymentsClp === 0 && month.students === 1),
  "months with linked student and no agreement retain real zero money and student count");
  const emptyOverview = await value(b, "select public.read_own_coach_commercial_overview() value");
  check(emptyOverview.stats.years.length >= 1
    && emptyOverview.stats.years.every((year) => year.estimatedClp === 0 && year.confirmedPaymentsClp === 0),
  "annual zero-money history remains available");
  await rejected(write(a, "correct_future", episode, paid.version, randomUUID(), period, 50000, "monthly", today), "55000");
  stage = "future correction and renewal";
  const futureEpisode = await fixture(admin, ids[0]);
  const tomorrow = await value(admin, "select ((clock_timestamp() at time zone 'America/Santiago')::date + 1)::text value");
  const future = await write(a, "start", futureEpisode, zero, randomUUID(), null, 40000, "weekly", tomorrow);
  const futureBefore = await value(a, "select public.read_own_coach_commercial() value");
  const corrected = await write(a, "correct_future", futureEpisode, future.version, randomUUID(),
    future.periodId, 50000, "weekly", tomorrow);
  check(corrected.periodId === future.periodId, "future correction keeps period identity");
  await rejected(write(a, "correct_future", futureEpisode, future.version, randomUUID(),
    future.periodId, 60000, "weekly", tomorrow), "40001");
  await rejected(write(a, "confirm_payment", futureEpisode, corrected.version, randomUUID(), future.periodId), "55000");
  const futureAfter = await value(a, "select public.read_own_coach_commercial() value");
  check(JSON.stringify(futureBefore.months) === JSON.stringify(futureAfter.months), "future correction preserves booked history");
  const dueEpisode = await fixture(admin, ids[0]);
  const version = randomUUID();
  const yesterday = await value(admin, "select ((clock_timestamp() at time zone 'America/Santiago')::date - 1)::text value");
  await admin.query("insert into private.coach_commercial_agreements(episode_id,coach_user_id,starts_on,status,version,created_at) values($1,$2,$3,'active',$4,clock_timestamp())", [dueEpisode, ids[0], yesterday, version]);
  await admin.query("insert into private.coach_commercial_periods(episode_id,coach_user_id,starts_on,ends_before,amount_clp,frequency,confirmed_at) values($1,$2,$3,$4,30000,'daily',clock_timestamp()-interval '2 days')", [dueEpisode, ids[0], yesterday, today]);
  const renewed = await write(a, "renew", dueEpisode, version, randomUUID(), null, 35000, "monthly", today);
  check(renewed.status === "recorded", "due period renewed with new future amount");
  check(await value(admin, "select amount_clp::int value from private.coach_commercial_periods where episode_id=$1 and starts_on=$2::date", [dueEpisode, yesterday]) === 30000, "old amount immutable");
  const declinedEpisode = await fixture(admin, ids[0]);
  await admin.query("insert into private.coach_commercial_agreements(episode_id,coach_user_id,starts_on,status,version,created_at) values($1,$2,$3,'active',$4,clock_timestamp())", [declinedEpisode, ids[0], yesterday, version]);
  await admin.query("insert into private.coach_commercial_periods(episode_id,coach_user_id,starts_on,ends_before,amount_clp,frequency,confirmed_at) values($1,$2,$3,$4,30000,'daily',clock_timestamp()-interval '2 days')", [declinedEpisode, ids[0], yesterday, today]);
  const declined = await write(a, "not_continuing", declinedEpisode, version, randomUUID());
  check(declined.status === "recorded", "explicit no-continuation");
  await rejected(write(a, "renew", declinedEpisode, declined.version, randomUUID(), null, 35000, "monthly", today), "55000");
  stage = "paginated history";
  await admin.query("insert into private.coach_commercial_periods(episode_id,coach_user_id,starts_on,ends_before,amount_clp,frequency,confirmed_at) values($1,$2,'2024-01-01','2024-02-01',1000,'monthly',clock_timestamp()-interval '1 year'),($1,$2,'2025-01-01','2025-02-01',2000,'monthly',clock_timestamp()-interval '1 year'),($1,$2,'2025-02-01','2025-03-01',3000,'monthly',clock_timestamp()-interval '1 year')", [episode, ids[0]]);
  const full = await value(a, "select public.read_own_coach_commercial() value");
  const overviewAfterHistory = await value(a, "select public.read_own_coach_commercial_overview() value");
  const seenItems = [];
  let itemCursor = null;
  do {
    const result = await page(a, "items", null, itemCursor, 2);
    seenItems.push(...result.rows);
    itemCursor = result.nextCursor;
  } while (itemCursor);
  check(JSON.stringify(seenItems.map((row) => row.episodeId))
    === JSON.stringify(full.items.map((row) => row.episodeId)),
  "all owned items reachable in deterministic order");
  const seenPeriods = [];
  let periodCursor = null;
  do {
    const result = await page(a, "periods", episode, periodCursor, 1);
    seenPeriods.push(...result.rows);
    periodCursor = result.nextCursor;
  } while (periodCursor);
  check(seenPeriods.length === full.periods.filter((row) => row.episodeId === episode).length,
    "all periods reachable by cursor");
  check(seenPeriods.every((row, index) => index === 0 || row.startsOn < seenPeriods[index - 1].startsOn),
    "period order deterministic");
  check(seenPeriods.reduce((sum, row) => sum + row.amountClp, 0)
    === full.periods.filter((row) => row.episodeId === episode).reduce((sum, row) => sum + row.amountClp, 0),
  "period sum preserved across pages");
  const seenMonths = [];
  let monthCursor = null;
  do {
    const result = await page(a, "months", null, monthCursor, 3);
    seenMonths.push(...result.rows);
    monthCursor = result.nextCursor;
  } while (monthCursor);
  check(JSON.stringify(seenMonths) === JSON.stringify(full.months), "all calendar months reachable in order");
  check(overviewAfterHistory.stats.years.reduce((sum, year) => sum + year.estimatedClp, 0)
    === full.months.reduce((sum, month) => sum + month.estimatedClp, 0),
  "annual estimate remains complete with paged months");
  check(overviewAfterHistory.stats.years.reduce((sum, year) => sum + year.confirmedPaymentsClp, 0)
    === full.months.reduce((sum, month) => sum + month.confirmedPaymentsClp, 0),
  "annual payments remain complete with paged months");
  check((await page(a, "student", episode, null, 1)).rows[0].episodeId === episode,
    "owner detail lookup");
  await rejected(page(a, "student", foreignEpisode, null, 1), "P0002");
  await rejected(page(b, "student", episode, null, 1), "P0002");
  await rejected(page(a, "periods", episode, "2026-02-30|" + period), "22023");
  await rejected(page(a, "months", null, "9999-12"), "22023");
  await rejected(page(a, "student", episode, null, 2), "22023");
  for (let index = 0; index < 31; index++) await fixture(admin, ids[0]);
  const boundedOverview = await value(a, "select public.read_own_coach_commercial_overview() value");
  check(boundedOverview.items.length === 30 && boundedOverview.itemCursor !== null,
    "dashboard item payload stays bounded with many students");
  check(boundedOverview.stats.alertCount === 31 && boundedOverview.stats.renewedCount === 2
    && boundedOverview.stats.declinedCount === 1,
  "dashboard alerts and renewal counts include students beyond its first page");
  check((await page(a, "items", null, boundedOverview.itemCursor, 20)).rows.length > 0,
    "older students remain reachable after dashboard page");
  const ownReceipt = await value(a, "select public.read_own_coach_commercial_operation($1::uuid) value", [request]);
  check(JSON.stringify(ownReceipt) === JSON.stringify(same[0]), "operation reconciliation");
  check(await value(b, "select public.read_own_coach_commercial_operation($1::uuid) value", [request]) === null, "foreign receipt hidden");
  check(end > today, "period finite even when agreement indefinite");
  console.log("COACH_COMMERCIAL_LOCAL_POSTGRES=PASS (migration, ACL, RLS, BOLA, concurrency, money, frequency, history)");
} catch (error) {
  console.error(`COACH_COMMERCIAL_LOCAL_POSTGRES=FAIL stage=${stage} code=${error.code ?? "assertion"}`);
  if (stage === "migration" || error.message?.startsWith("Assertion failed:")) console.error(error.message, error.position ?? "");
  process.exitCode = 1;
} finally {
  await Promise.allSettled(connections.map((connection) => connection.end()));
  if (started) run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  rmSync(runtime, { recursive: true, force: true });
}
