// Synthetic local PostgreSQL only. No .env, TCP, QA, PROD or app server.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local PostgreSQL runner requires macOS arm64");
for (const key of Object.keys(process.env)) if (/^PG/.test(key)) delete process.env[key];
const childEnv = Object.fromEntries(["PATH", "TMPDIR", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = mkdtempSync(join(tmpdir(), "org-link-terms-pg-"));
chmodSync(runtime, 0o700);
const socket = join(runtime, "socket"), dataDir = join(runtime, "data"), archive = join(runtime, "postgres.jar");
const archiveUrl = "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-darwin-arm64v8/17.5.0/embedded-postgres-binaries-darwin-arm64v8-17.5.0.jar";
const archiveHash = "e9d3398e10c2ec926395498b03e75ad1a24eeaed82895e756a7e173b202cf6de";
const ids = [1, 2, 3, 4].map((n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const emails = ids.map((_, i) => `identity-${i + 1}@example.test`);
const clients = [];
let started = false, stage = "bootstrap", checks = 0;
const sql = (path) => readFileSync(join(root, path), "utf8");
const run = (bin, args, options = {}) => execFileSync(bin, args, { env: childEnv, ...options });
const check = (condition, label) => { if (!condition) throw new Error(`Assertion failed: ${label}`); checks++; };
const value = async (client, query, args = []) => (await client.query(query, args)).rows[0]?.value;
async function rejected(promise, code, label) {
  try { await promise; } catch (error) { check(error.code === code, label); return; }
  throw new Error(`Assertion failed: ${label}`);
}
async function connect(userId = null) {
  const client = new pg.Client({ host: socket, port: 55448, user: "postgres", database: "postgres",
    password: null, ssl: false, statement_timeout: 15000, connectionTimeoutMillis: 5000 });
  await client.connect(); clients.push(client);
  if (userId) {
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  }
  return client;
}
async function invite(client, email, amount = null, frequency = null, requestId = randomUUID()) {
  const old = amount === null && frequency === null;
  const receipt = await value(client, old
    ? "select public.create_own_coach_invitation($1,$2::uuid) value"
    : "select public.create_own_coach_invitation($1,$2::uuid,$3::bigint,$4) value",
  old ? [email, requestId] : [email, requestId, amount, frequency]);
  const detail = await value(client, "select public.read_own_coach_invitation($1::uuid) value", [receipt.operation.invitationId]);
  return { receipt, id: receipt.operation.invitationId, code: detail.code.replaceAll("-", ""), requestId };
}
async function accept(client, code, requestId = randomUUID()) {
  return value(client, "select public.accept_own_coach_invitation($1,$2::uuid) value", [code, requestId]);
}
try {
  run("curl", ["-fsSL", "--max-time", "90", archiveUrl, "-o", archive]);
  check(createHash("sha256").update(readFileSync(archive)).digest("hex") === archiveHash, "binary SHA-256");
  run("tar", ["-xJ", "-C", runtime], { input: run("unzip", ["-p", archive, "postgres-darwin-arm_64.txz"], { maxBuffer: 100 * 1024 * 1024 }) });
  mkdirSync(socket, { mode: 0o700 });
  run(join(runtime, "bin/initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-l", join(runtime, "server.log"), "-o",
    `-h '' -k ${socket} -p 55448 -c log_statement=none -c log_min_error_statement=panic`, "-w", "start"], { stdio: "ignore" });
  started = true;
  stage = "schema and migration chain";
  const admin = await connect();
  await admin.query(sql("supabase/tests/support/coach_preferences_local_bootstrap.sql"));
  await admin.query("alter table auth.users add column email text");
  await admin.query("create schema extensions");
  await admin.query("create extension pgcrypto with schema extensions");
  await admin.query("create table public.profiles (id uuid primary key, display_name text, first_name text, last_name text, created_at timestamptz not null default now())");
  await admin.query(sql("supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql"));
  await admin.query(sql("supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql"));
  for (let i = 0; i < ids.length; i++) {
    await admin.query("update auth.users set email=$2 where id=$1", [ids[i], emails[i]]);
    await admin.query("insert into public.profiles(id,display_name,first_name,last_name) values($1,$2,'Identity',$3)", [ids[i], `Identity ${i + 1}`, String(i + 1)]);
  }
  await admin.query("insert into public.coach_registrations(user_id,first_name,last_name,birth_date,gender,phone_number,professional_title) values($1,'Coach','One','1990-01-01','prefer_not_to_say','test','Coach')", [ids[0]]);
  await admin.query("insert into public.user_registrations(user_id) values($1),($2),($3)", ids.slice(1));
  await admin.query(sql("supabase/migrations/20260909044235_coach_invitation_persistence.sql"));
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
  await admin.query(sql("supabase/migrations/20260917000000_student_coach_link_acceptance.sql"));
  await admin.query(sql("supabase/migrations/20260919225532_coach_student_evaluations.sql"));
  await admin.query(sql("supabase/migrations/20260920060000_coach_self_student_and_evaluation_template_deletion.sql"));
  await admin.query(sql("supabase/migrations/20261005000000_coach_commercial_portfolio_v1.sql"));
  const coach = await connect(ids[0]), historicStudent = await connect(ids[1]), oldPendingStudent = await connect(ids[2]), newStudent = await connect(ids[3]);
  stage = "historical state";
  const historic = await invite(coach, emails[1]);
  check((await accept(historicStudent, historic.code)).status === "linked", "historical link accepted");
  const oldPending = await invite(coach, emails[2]);
  const historicEpisode = await value(admin, "select id value from private.coach_relationship_episodes where invitation_id=$1", [historic.id]);
  check(await value(admin, "select count(*)::int value from private.coach_commercial_agreements where episode_id=$1", [historicEpisode]) === 0, "historical link lacks agreement");
  await admin.query(sql("supabase/migrations/20261009235959_coach_link_required_commercial_terms_v1.sql"));
  stage = "required terms and ACL";
  await rejected(invite(coach, emails[3]), "42501", "old RPC revoked");
  for (const [amount, frequency] of [[0, "monthly"], [-1, "monthly"], [25000, "biweekly"], [null, "monthly"], [25000, null]]) {
    await rejected(value(coach, "select public.create_own_coach_invitation($1,$2::uuid,$3::bigint,$4) value", [emails[3], randomUUID(), amount, frequency]), "22023", `invalid commercial terms rejected: ${amount}/${frequency}`);
  }
  const created = await invite(coach, emails[3], 25000, "monthly");
  check(await value(admin, "select amount_clp=25000 and frequency='monthly' value from private.coach_invitations where id=$1", [created.id]), "terms persisted on invitation");
  const replay = await invite(coach, emails[3], 25000, "monthly", created.requestId);
  check(replay.id === created.id, "same request preserves invitation");
  await rejected(value(coach, "select public.create_own_coach_invitation($1,$2::uuid,$3::bigint,$4) value", [emails[3], created.requestId, 30000, "monthly"]), "22023", "changed terms conflict with request");
  check((await value(oldPendingStudent, "select public.lookup_own_coach_invitation($1) value", [oldPending.code])).status === "requiere_renovacion", "legacy code lookup requests Coach renewal");
  await rejected(accept(oldPendingStudent, oldPending.code), "P0C01", "old pending invitation cannot create bare link");
  check(await value(admin, "select count(*)::int value from private.coach_relationship_episodes where invitation_id=$1", [oldPending.id]) === 0, "rejected acceptance rolled back episode");
  check(await value(admin, "select state='pending' value from private.coach_invitations where id=$1", [oldPending.id]), "rejected acceptance keeps old invitation pending");
  check(await value(admin, "select amount_clp is null and frequency is null value from private.coach_invitations where id=$1", [oldPending.id]), "legacy invitation has no default commercial terms");
  await admin.query(`insert into private.coach_invitation_operations
    (coach_user_id,request_id,action,payload,invitation_id,generation,reserved_at,state)
    select $1,gen_random_uuid(),'create','{"test":"rate-limit"}'::jsonb,$2,1,clock_timestamp(),'reserved'
    from generate_series(1,8)`, [ids[0], oldPending.id]);
  const limited = await value(coach, "select public.create_own_coach_invitation($1,$2::uuid,$3::bigint,$4) value", [emails[2], randomUUID(), 40000, "weekly"]);
  check(limited.status === "rate_limited", "replacement observes creation quota");
  check(await value(admin, "select state='pending' and invitation_code is not null value from private.coach_invitations where id=$1", [oldPending.id]), "rate limit leaves legacy invitation intact");
  await admin.query("delete from private.coach_invitation_operations where payload->>'test'='rate-limit'");
  const replacement = await invite(coach, emails[2], 40000, "weekly");
  check(replacement.id !== oldPending.id, "Coach replaces legacy invitation through creation flow");
  check((await invite(coach, emails[2], 40000, "weekly", replacement.requestId)).id === replacement.id,
    "replacement request replays the same invitation");
  check(await value(admin, "select state='cancelled' and invitation_code is null and amount_clp is null and frequency is null value from private.coach_invitations where id=$1", [oldPending.id]), "replacement retires code without rewriting historical terms");
  check(await value(admin, "select state='cancelled' value from private.coach_invitation_operations where request_id=$1", [oldPending.requestId]), "old reservation marked cancelled");
  check((await value(oldPendingStudent, "select public.lookup_own_coach_invitation($1) value", [oldPending.code])).status === "cancelado", "retired legacy code no longer looks valid");
  check((await accept(oldPendingStudent, replacement.code)).status === "linked", "student accepts replacement code");
  const replacementFacts = (await admin.query(`select p.amount_clp,p.frequency from private.coach_relationship_episodes e
    join private.coach_commercial_agreements a on a.episode_id=e.id
    join private.coach_commercial_periods p on p.episode_id=e.id where e.invitation_id=$1`, [replacement.id])).rows;
  check(replacementFacts.length === 1 && replacementFacts[0].amount_clp === "40000"
    && replacementFacts[0].frequency === "weekly", "replacement link starts with explicit agreement and period");
  stage = "new acceptance";
  const acceptId = randomUUID();
  check((await accept(newStudent, created.code, acceptId)).status === "linked", "new invitation accepted");
  check((await accept(newStudent, created.code, acceptId)).status === "linked", "accept replay remains idempotent");
  const facts = (await admin.query(`select e.id, a.status, a.version, a.starts_on, p.amount_clp, p.frequency, p.ends_before,
      p.confirmed_at=e.linked_at confirmed_with_link
    from private.coach_relationship_episodes e
    join private.coach_commercial_agreements a on a.episode_id=e.id
    join private.coach_commercial_periods p on p.episode_id=e.id
    where e.invitation_id=$1`, [created.id])).rows;
  check(facts.length === 1 && facts[0].status === "active" && facts[0].version
    && facts[0].amount_clp === "25000" && facts[0].frequency === "monthly" && facts[0].confirmed_with_link, "one agreement and initial period created atomically");
  check(await value(admin, "select count(*)::int value from private.coach_commercial_agreements where episode_id=$1", [historicEpisode]) === 0, "historical episode unchanged");
  check(await value(admin, "select count(*)::int value from private.coach_commercial_periods where episode_id=$1", [historicEpisode]) === 0, "historical periods unchanged");
  check(await value(admin, "select count(*)::int value from private.coach_commercial_periods where episode_id=$1", [facts[0].id]) === 1, "accept replay creates no duplicate period");
  const portfolio = await value(coach, "select public.read_own_coach_commercial() value");
  check(portfolio.items.find((item) => item.episodeId === facts[0].id)?.status === "active", "new link is active in visible portfolio");
  check(portfolio.items.find((item) => item.episodeId === historicEpisode)?.status === "needs_agreement", "historical link retains needs_agreement");
  console.log(`PASS coach link commercial terms local PostgreSQL (${checks} checks)`);
} catch (error) {
  console.error(`FAIL coach link commercial terms local PostgreSQL at ${stage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  if (started) {
    try { run(join(runtime, "bin/pg_ctl"), ["-D", dataDir, "-m", "immediate", "stop"], { stdio: "ignore" }); } catch { /* temp cleanup follows */ }
  }
  rmSync(runtime, { recursive: true, force: true });
}
