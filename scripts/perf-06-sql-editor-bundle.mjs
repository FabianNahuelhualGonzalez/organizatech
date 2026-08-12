import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_BASELINE_FINGERPRINT,
  EXPECTED_FINAL_FINGERPRINT,
  EXPECTED_MANIFEST_SHA256,
  EXPECTED_PROJECT_REF,
  HISTORICAL_MIGRATIONS,
  buildManifest,
  splitAndTrim,
} from "./perf-06-migration-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const atomicOperationRoot = resolve(repositoryRoot, "supabase/operations/qa/perf-06-atomic");
const outputRoot = resolve(repositoryRoot, "supabase/operations/qa/perf-06-sql-editor");

export const SQL_EDITOR_FILES = Object.freeze({
  rollback: "perf-06-qa-rollback.sql",
  commit: "perf-06-qa-commit.sql",
  postcheck: "perf-06-qa-postcheck.sql",
});

const DATA_COUNT_RELATIONS = Object.freeze([
  "exercise_entries",
  "exercises",
  "profiles",
  "routines",
  "training_cycle_days",
  "training_cycle_exercises",
  "training_cycle_routines",
  "training_cycles",
  "training_daily_readiness",
  "training_exercise_lineages",
  "training_sessions",
  "training_workout_readiness",
]);

const BASELINE_PARTIAL_APPLICATION = Object.freeze({
  history_absent: true,
  identity_function_absent: true,
  invariant_function_absent: true,
  lineage_function_absent: true,
  perf_index_absent: true,
  perf_triggers_absent: true,
});

const FINAL_PARTIAL_APPLICATION = Object.freeze(
  Object.fromEntries(Object.keys(BASELINE_PARTIAL_APPLICATION).map((key) => [key, false])),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function loadNamedQueries(filename) {
  const source = readFileSync(resolve(atomicOperationRoot, filename), "utf8");
  invariant(!/^\\[^\n]+/mu.test(source), `${filename} contains a client metacommand`);
  const matches = [...source.matchAll(
    /^-- PERF06_QUERY ([a-z0-9_]+)\n([\s\S]*?)(?=^-- PERF06_QUERY [a-z0-9_]+\n|(?![\s\S]))/gmu,
  )];
  const queries = {};
  for (const [, name, sql] of matches) {
    const statements = splitAndTrim(sql.trim());
    invariant(statements.length === 1, `${filename}:${name} must contain exactly one statement`);
    invariant(!queries[name], `${filename}:${name} is duplicated`);
    queries[name] = statements[0];
  }
  invariant(Object.keys(queries).length > 0, `${filename} has no named queries`);
  return queries;
}

function sqlString(value) {
  invariant(!value.includes("\0"), "SQL text cannot contain NUL bytes");
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlTextArray(statements, rowIndex) {
  const elements = statements.map((statement, statementIndex) => {
    const tag = `$perf06_history_${rowIndex}_${statementIndex}$`;
    invariant(!statement.includes(tag), `History statement collides with ${tag}`);
    return `${tag}${statement}${tag}`;
  });
  return `array[\n${elements.map((element) => `      ${element}`).join(",\n")}\n    ]::text[]`;
}

function historyValue(row, rowIndex) {
  return `(${sqlString(row.version)}, ${sqlString(row.name)}, ${sqlTextArray(row.statements, rowIndex)})`;
}

function expectedHistoryCte(manifest) {
  return `expected_history(version, name, statements) as (\n  values\n${manifest
    .map((row, index) => `    ${historyValue(row, index)}`)
    .join(",\n")}\n)`;
}

function executableStatements(row, marker) {
  const statements = row.statements.map((statement, index) => [
    `-- PERF06_SQL_EDITOR_STATEMENT ${row.version} ${index + 1}/${row.statements.length}`,
    statement,
    ";",
  ].join("\n"));
  return [
    `-- PERF06_SQL_EDITOR_MIGRATION ${marker} ${row.version} ${row.name}`,
    ...statements,
  ].join("\n\n");
}

function historyInsert(row, rowIndex) {
  return [
    `-- PERF06_SQL_EDITOR_HISTORY ${row.version} ${row.name}`,
    "insert into supabase_migrations.schema_migrations (version, name, statements)",
    `values ${historyValue(row, rowIndex)};`,
  ].join("\n");
}

function snapshotQuery({ prechecks, postchecks, fingerprintSql, includeFinal, manifest, scenarios }) {
  const commonCtes = [
    `identity as (\n${prechecks.identity}\n)`,
    `partial_application as (\n${prechecks.partial_application}\n)`,
    `lineage_counts as (\n${prechecks.lineage_counts}\n)`,
    `marker_count as (\n${prechecks.marker_count}\n)`,
    `incompatible_lineages as (\n${prechecks.incompatible_lineages}\n)`,
    `fixture_identity as (\n${prechecks.fixture_identity}\n)`,
    `diagnostic_exists as (\n${prechecks.diagnostic_exists}\n)`,
    `diagnostic_count as (\n${prechecks.diagnostic_count}\n)`,
    `diagnostic_hash as (\n${prechecks.diagnostic_hash}\n)`,
    `diagnostic_consumers as (\n${prechecks.diagnostic_consumers}\n)`,
    `data_counts as (\n${prechecks.data_counts}\n)`,
    `fixtures as (\n${postchecks.fixtures}\n)`,
    `fingerprint as (\n${fingerprintSql}\n)`,
  ];

  const finalCtes = includeFinal ? [
    expectedHistoryCte(manifest),
    "actual_history as (\n  select version, name, statements\n  from supabase_migrations.schema_migrations\n)",
    [
      "history_check as (",
      "  select",
      "    (select count(*) from actual_history) = 24",
      "    and (select coalesce(sum(cardinality(statements)), 0) from actual_history) = 336",
      "    and not exists (",
      "      select 1",
      "      from expected_history expected",
      "      full join actual_history actual using (version)",
      "      where expected.version is null",
      "         or actual.version is null",
      "         or actual.name is distinct from expected.name",
      "         or actual.statements is distinct from expected.statements",
      "    ) as exact",
      ")",
    ].join("\n"),
    `lineage_state as (\n${postchecks.lineage_state}\n)`,
    `diagnostic as (\n${postchecks.diagnostic}\n)`,
    `catalog as (\n${scenarios.catalog}\n)`,
    `complete_state as (\n${scenarios.complete_state}\n)`,
  ] : [];

  const fields = [
    "'current_user', (select identity.\"current_user\" from identity)",
    "'session_user', (select identity.\"session_user\" from identity)",
    "'isolation_level', (select isolation_level from identity)",
    "'read_only', (select read_only from identity)",
    "'server_version_num', (select server_version_num from identity)",
    "'database_name', (select database_name from identity)",
    "'partial_application', (select to_jsonb(partial_application) from partial_application)",
    "'pending', (select pending from lineage_counts)",
    "'exercise_count', (select exercise_count from lineage_counts)",
    "'marker_count', (select marker_count from marker_count)",
    "'incompatible_count', (select incompatible_count from incompatible_lineages)",
    "'owner_id', (select owner_id from fixture_identity)",
    "'routine_id', (select routine_id from fixture_identity)",
    "'fixture_free', (select valid from fixtures)",
    "'diagnostic_present', (select diagnostic_exists from diagnostic_exists)",
    "'diagnostic_count', (select diagnostic_count from diagnostic_count)",
    "'diagnostic_hash', (select diagnostic_hash from diagnostic_hash)",
    "'diagnostic_consumers', (select consumer_count from diagnostic_consumers)",
    "'data_counts', (select counts from data_counts)",
    "'fingerprint_count', (select item_count from fingerprint where category = 'OVERALL')",
    "'fingerprint_hash', (select sha256 from fingerprint where category = 'OVERALL')",
  ];

  if (includeFinal) {
    fields.push(
      "'history_exact', (select exact from history_check)",
      "'history_versions', (select count(*) from actual_history)",
      "'history_statements', (select coalesce(sum(cardinality(statements)), 0) from actual_history)",
      "'lineage_pending', (select pending from lineage_state)",
      "'lineage_markers', (select markers from lineage_state)",
      "'diagnostic_final_present', (select present from diagnostic)",
      "'diagnostic_final_count', (select row_count from diagnostic)",
      "'catalog_valid', (select valid from catalog)",
      "'complete_state_valid', (select valid from complete_state)",
    );
  }

  return [
    "with",
    [...commonCtes, ...finalCtes].join(",\n"),
    "select jsonb_build_object(",
    fields.map((field) => `  ${field}`).join(",\n"),
    ") as snapshot",
  ].join("\n");
}

function baselineAssertionSql(column, label) {
  const baselinePartial = sqlString(JSON.stringify(BASELINE_PARTIAL_APPLICATION));
  return `do $perf06_${label}$
declare
  v_snapshot jsonb;
begin
  select ${column}
  into v_snapshot
  from pg_temp.perf06_sql_editor_context;

  if v_snapshot is null
    or v_snapshot ->> 'current_user' <> 'postgres'
    or v_snapshot ->> 'session_user' <> 'postgres'
    or v_snapshot ->> 'isolation_level' <> 'read committed'
    or v_snapshot ->> 'read_only' <> 'off'
    or (v_snapshot ->> 'server_version_num')::integer <> 170006
    or v_snapshot ->> 'database_name' <> 'postgres'
    or v_snapshot -> 'partial_application' <> ${baselinePartial}::jsonb
    or (v_snapshot ->> 'pending')::integer not in (0, 2)
    or (v_snapshot ->> 'exercise_count')::integer <= 0
    or (v_snapshot ->> 'marker_count')::integer <> 0
    or (v_snapshot ->> 'incompatible_count')::integer <> 0
    or coalesce((v_snapshot ->> 'fixture_free')::boolean, false) is not true
    or coalesce((v_snapshot ->> 'diagnostic_present')::boolean, false) is not true
    or (v_snapshot ->> 'diagnostic_count')::integer <> 0
    or pg_catalog.length(coalesce(v_snapshot ->> 'diagnostic_hash', '')) <> 64
    or (v_snapshot ->> 'diagnostic_consumers')::integer <> 0
    or coalesce(v_snapshot ->> 'owner_id', '') = ''
    or coalesce(v_snapshot ->> 'routine_id', '') = ''
    or (v_snapshot ->> 'fingerprint_count')::integer <> 346
    or v_snapshot ->> 'fingerprint_hash' <> '${EXPECTED_BASELINE_FINGERPRINT}'
  then
    raise exception using
      errcode = '55000',
      message = 'PERF-06 SQL Editor aborted: ${label} baseline gate failed';
  end if;
end;
$perf06_${label}$;`;
}

function finalAssertionSql() {
  const finalPartial = sqlString(JSON.stringify(FINAL_PARTIAL_APPLICATION));
  const relations = DATA_COUNT_RELATIONS.map(sqlString).join(", ");
  return `do $perf06_final_gate$
declare
  v_initial jsonb;
  v_final jsonb;
  v_pending integer;
  v_relation text;
  v_expected bigint;
begin
  select initial_snapshot, final_snapshot
  into v_initial, v_final
  from pg_temp.perf06_sql_editor_context;

  v_pending := (v_initial ->> 'pending')::integer;

  if v_final is null
    or (v_final ->> 'fingerprint_count')::integer <> 377
    or v_final ->> 'fingerprint_hash' <> '${EXPECTED_FINAL_FINGERPRINT}'
    or coalesce((v_final ->> 'history_exact')::boolean, false) is not true
    or (v_final ->> 'history_versions')::integer <> 24
    or (v_final ->> 'history_statements')::integer <> 336
    or v_final -> 'partial_application' <> ${finalPartial}::jsonb
    or (v_final ->> 'lineage_pending')::integer <> 0
    or (v_final ->> 'lineage_markers')::integer <> v_pending
    or (v_final ->> 'exercise_count')::integer <> (v_initial ->> 'exercise_count')::integer
    or (v_final ->> 'incompatible_count')::integer <> 0
    or coalesce((v_final ->> 'fixture_free')::boolean, false) is not true
    or coalesce((v_final ->> 'diagnostic_final_present')::boolean, false) is not true
    or (v_final ->> 'diagnostic_final_count')::integer <> 0
    or v_final ->> 'diagnostic_hash' <> v_initial ->> 'diagnostic_hash'
    or (v_final ->> 'diagnostic_consumers')::integer <> 0
    or coalesce((v_final ->> 'catalog_valid')::boolean, false) is not true
    or coalesce((v_final ->> 'complete_state_valid')::boolean, false) is not true
  then
    raise exception using
      errcode = '55000',
      message = 'PERF-06 SQL Editor aborted: final state gate failed';
  end if;

  foreach v_relation in array array[${relations}]
  loop
    v_expected := (v_initial -> 'data_counts' ->> v_relation)::bigint;
    if v_relation = 'training_exercise_lineages' then
      v_expected := v_expected + v_pending;
    end if;
    if (v_final -> 'data_counts' ->> v_relation)::bigint <> v_expected then
      raise exception using
        errcode = '55000',
        message = pg_catalog.format('PERF-06 SQL Editor aborted: unexpected row count for %s', v_relation);
    end if;
  end loop;
end;
$perf06_final_gate$;`;
}

function postcheckQuery({ finalSnapshotSql }) {
  const finalPartial = sqlString(JSON.stringify(FINAL_PARTIAL_APPLICATION));
  return `with state as (
${finalSnapshotSql}
)
select
  case
    when (snapshot ->> 'fingerprint_count')::integer = 377
      and snapshot ->> 'fingerprint_hash' = '${EXPECTED_FINAL_FINGERPRINT}'
      and coalesce((snapshot ->> 'history_exact')::boolean, false) is true
      and (snapshot ->> 'history_versions')::integer = 24
      and (snapshot ->> 'history_statements')::integer = 336
      and snapshot -> 'partial_application' = ${finalPartial}::jsonb
      and (snapshot ->> 'lineage_pending')::integer = 0
      and (snapshot ->> 'lineage_markers')::integer in (0, 2)
      and (snapshot ->> 'incompatible_count')::integer = 0
      and coalesce((snapshot ->> 'fixture_free')::boolean, false) is true
      and coalesce((snapshot ->> 'diagnostic_final_present')::boolean, false) is true
      and (snapshot ->> 'diagnostic_final_count')::integer = 0
      and (snapshot ->> 'diagnostic_consumers')::integer = 0
      and coalesce((snapshot ->> 'catalog_valid')::boolean, false) is true
      and coalesce((snapshot ->> 'complete_state_valid')::boolean, false) is true
    then 'PASS'
    else 'FAIL'
  end as verdict,
  '${EXPECTED_PROJECT_REF}'::text as expected_project_ref,
  snapshot ->> 'fingerprint_hash' as fingerprint,
  (snapshot ->> 'history_versions')::integer as history_versions,
  (snapshot ->> 'history_statements')::integer as history_statements,
  (snapshot ->> 'lineage_pending')::integer as pending_lineages,
  (snapshot ->> 'lineage_markers')::integer as reconciliation_markers,
  (snapshot ->> 'catalog_valid')::boolean as catalog_valid,
  (snapshot ->> 'complete_state_valid')::boolean as complete_state_valid
from state`;
}

function commonHeader(mode) {
  return `-- ORGANIZATECH PERF-06 — SUPABASE SQL EDITOR — ${mode}
-- DESTINO EXCLUSIVO: organizatech-qa (${EXPECTED_PROJECT_REF})
-- Antes de pulsar Run, confirma visualmente el proyecto y la ref en Supabase.
-- PROHIBIDO ejecutar este archivo en PROD.
-- Generado desde el manifiesto auditado ${EXPECTED_MANIFEST_SHA256}.
-- No contiene contraseñas, tokens, service_role ni metacomandos de cliente.
`;
}

function transactionBody({ manifest, prechecks, postchecks, fingerprintSql, scenarios }) {
  const historical = manifest.slice(0, HISTORICAL_MIGRATIONS.length);
  const perf = manifest.slice(HISTORICAL_MIGRATIONS.length);
  const initialSnapshotSql = snapshotQuery({
    prechecks,
    postchecks,
    fingerprintSql,
    includeFinal: false,
    manifest,
    scenarios,
  });
  const finalSnapshotSql = snapshotQuery({
    prechecks,
    postchecks,
    fingerprintSql,
    includeFinal: true,
    manifest,
    scenarios,
  });

  const historyBootstrap = [
    "create schema if not exists supabase_migrations;",
    "create table if not exists supabase_migrations.schema_migrations (version text not null primary key);",
    "alter table supabase_migrations.schema_migrations add column if not exists statements text[];",
    "alter table supabase_migrations.schema_migrations add column if not exists name text;",
    "insert into supabase_migrations.schema_migrations (version, name, statements)",
    "values",
    historical.map((row, index) => `  ${historyValue(row, index)}`).join(",\n"),
    ";",
    "do $perf06_history_gate$",
    "declare",
    "  v_versions integer;",
    "  v_statements integer;",
    "begin",
    "  select count(*)::integer, coalesce(sum(cardinality(statements)), 0)::integer",
    "  into v_versions, v_statements",
    "  from supabase_migrations.schema_migrations;",
    "  if v_versions <> 18 or v_statements <> 255 then",
    "    raise exception using errcode = '55000', message = 'PERF-06 SQL Editor aborted: historical bootstrap gate failed';",
    "  end if;",
    "end;",
    "$perf06_history_gate$;",
  ].join("\n");

  const perfSql = perf.map((row, index) => [
    executableStatements(row, "APPLY"),
    historyInsert(row, historical.length + index),
  ].join("\n\n")).join("\n\n");

  const compensation = perf.find((row) => row.version === "20260811035542");
  invariant(compensation, "Compensation migration is missing");

  return {
    sql: [
      "begin isolation level read committed read write;",
      "set local statement_timeout = '15s';",
      "set local lock_timeout = '5s';",
      "set local idle_in_transaction_session_timeout = '60s';",
      "set local application_name = 'organizatech-perf-06-sql-editor';",
      `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('organizatech:qa:PERF-06:${EXPECTED_PROJECT_REF}', 0));`,
      "create temporary table perf06_sql_editor_context (",
      "  initial_snapshot jsonb not null,",
      "  locked_snapshot jsonb,",
      "  final_snapshot jsonb",
      ") on commit drop;",
      `insert into pg_temp.perf06_sql_editor_context (initial_snapshot)\n${initialSnapshotSql};`,
      baselineAssertionSql("initial_snapshot", "initial"),
      prechecks.lock_diagnostic + ";",
      prechecks.lock_auth_users + ";",
      prechecks.lock_exercises + ";",
      prechecks.lock_dependents + ";",
      `update pg_temp.perf06_sql_editor_context\nset locked_snapshot = (\n${initialSnapshotSql}\n);`,
      baselineAssertionSql("locked_snapshot", "locked"),
      "do $perf06_same_precheck$",
      "begin",
      "  if (select initial_snapshot is distinct from locked_snapshot from pg_temp.perf06_sql_editor_context) then",
      "    raise exception using errcode = '55000', message = 'PERF-06 SQL Editor aborted: baseline changed while locks were acquired';",
      "  end if;",
      "end;",
      "$perf06_same_precheck$;",
      historyBootstrap,
      perfSql,
      executableStatements(compensation, "SECOND_COMPENSATION_NOOP"),
      `update pg_temp.perf06_sql_editor_context\nset final_snapshot = (\n${finalSnapshotSql}\n);`,
      finalAssertionSql(),
      "select",
      "  'PASS'::text as verdict,",
      "  'READY_FOR_TERMINAL'::text as phase,",
      `  '${EXPECTED_PROJECT_REF}'::text as expected_project_ref,`,
      `  '${EXPECTED_MANIFEST_SHA256}'::text as manifest_sha256,`,
      `  '${EXPECTED_FINAL_FINGERPRINT}'::text as final_fingerprint;`,
    ].join("\n\n"),
    finalSnapshotSql,
  };
}

export function buildSqlEditorArtifacts(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "SQL Editor artifacts must be built from the repository root");
  const { manifest, historicalCount, perfCount, hash } = buildManifest(repositoryRoot);
  invariant(manifest.length === 24 && historicalCount === 255 && perfCount === 81, "Manifest cardinality mismatch");
  invariant(hash === EXPECTED_MANIFEST_SHA256, "Manifest hash mismatch");

  const prechecks = loadNamedQueries("prechecks.sql");
  const postchecks = loadNamedQueries("postchecks.sql");
  const scenarios = loadNamedQueries("scenarios.sql");
  const fingerprintStatements = splitAndTrim(
    readFileSync(resolve(repositoryRoot, "supabase/diagnostics/perf-06-schema-fingerprint.sql"), "utf8"),
  );
  invariant(fingerprintStatements.length === 1, "Fingerprint must contain one statement");

  const transaction = transactionBody({
    manifest,
    prechecks,
    postchecks,
    scenarios,
    fingerprintSql: fingerprintStatements[0],
  });
  const independentPostcheck = postcheckQuery({ finalSnapshotSql: transaction.finalSnapshotSql });

  const rollback = [
    commonHeader("VALIDACIÓN TRANSACCIONAL CON ROLLBACK"),
    transaction.sql,
    "rollback;",
    "begin isolation level read committed read only;",
    "set local statement_timeout = '15s';",
    "set local lock_timeout = '5s';",
    "select",
    "  case",
    `    when fingerprint.item_count = 346 and fingerprint.sha256 = '${EXPECTED_BASELINE_FINGERPRINT}'`,
    "      and to_regclass('supabase_migrations.schema_migrations') is null",
    "      and to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null",
    "      and to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null",
    "    then 'PASS'",
    "    else 'FAIL'",
    "  end as verdict,",
    "  'ROLLBACK_VERIFIED'::text as terminal,",
    "  fingerprint.item_count as baseline_items,",
    "  fingerprint.sha256 as baseline_fingerprint",
    "from (",
    fingerprintStatements[0],
    ") fingerprint",
    "where fingerprint.category = 'OVERALL';",
    "rollback;",
  ].join("\n\n") + "\n";

  const commit = [
    commonHeader("APLICACIÓN PERSISTENTE EN QA"),
    "-- Este archivo contiene COMMIT. Ejecutarlo sólo después de que QA-ROLLBACK termine en PASS.",
    transaction.sql,
    "commit;",
    "begin isolation level read committed read only;",
    "set local statement_timeout = '15s';",
    "set local lock_timeout = '5s';",
    independentPostcheck + ";",
    "rollback;",
  ].join("\n\n") + "\n";

  const postcheck = [
    commonHeader("POSTCHECK READ-ONLY"),
    "begin isolation level read committed read only;",
    "set local statement_timeout = '15s';",
    "set local lock_timeout = '5s';",
    independentPostcheck + ";",
    "rollback;",
  ].join("\n\n") + "\n";

  return Object.freeze({
    rollback,
    commit,
    postcheck,
    summary: Object.freeze({
      projectRef: EXPECTED_PROJECT_REF,
      manifestSha256: EXPECTED_MANIFEST_SHA256,
      baselineFingerprint: EXPECTED_BASELINE_FINGERPRINT,
      finalFingerprint: EXPECTED_FINAL_FINGERPRINT,
      rollbackSha256: sha256(rollback),
      commitSha256: sha256(commit),
      postcheckSha256: sha256(postcheck),
      migrations: manifest.length,
      statements: historicalCount + perfCount,
    }),
  });
}

export function writeSqlEditorArtifacts(root = outputRoot) {
  const artifacts = buildSqlEditorArtifacts();
  mkdirSync(root, { recursive: true });
  for (const key of ["rollback", "commit", "postcheck"]) {
    writeFileSync(resolve(root, SQL_EDITOR_FILES[key]), artifacts[key]);
  }
  return artifacts.summary;
}

export function verifySqlEditorArtifacts(root = outputRoot) {
  const artifacts = buildSqlEditorArtifacts();
  for (const key of ["rollback", "commit", "postcheck"]) {
    const path = resolve(root, SQL_EDITOR_FILES[key]);
    invariant(existsSync(path), `Missing SQL Editor artifact: ${SQL_EDITOR_FILES[key]}`);
    invariant(readFileSync(path, "utf8") === artifacts[key], `${SQL_EDITOR_FILES[key]} is not deterministic`);
  }
  return artifacts.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-sql-editor-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeSqlEditorArtifacts() : verifySqlEditorArtifacts();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
