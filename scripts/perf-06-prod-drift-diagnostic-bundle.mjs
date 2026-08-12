import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { splitAndTrim } from "./perf-06-migration-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "supabase/operations/production/perf-06");

export const PROD_PROJECT_REF = "lzycxltqbrtsnwfdotqw";
export const PROD_DRIFT_DIAGNOSTIC_FILE = "02_drift_diagnostic_readonly.sql";
export const OBSERVED_PROD_ITEMS = 347;
export const OBSERVED_PROD_FINGERPRINT = "1fefc787fe75385f63de9b5292b70d8dfe8c25f6a6e60b1cbf092493a29903a5";

const EXPECTED_CATEGORY_COUNTS = Object.freeze({
  relation: 12,
  column: 140,
  constraint: 87,
  index: 48,
  policy: 26,
  function: 8,
  trigger: 13,
  table_acl: 12,
  column_acl: 0,
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlString(value) {
  invariant(!value.includes("\0"), "SQL text cannot contain NUL bytes");
  return `'${value.replaceAll("'", "''")}'`;
}

function fingerprintCtes() {
  const statements = splitAndTrim(
    readFileSync(resolve(repositoryRoot, "supabase/diagnostics/perf-06-schema-fingerprint.sql"), "utf8"),
  );
  invariant(statements.length === 1, "Fingerprint must contain one statement");
  const source = statements[0];
  const finalSelect = "select category, item_count, sha256\nfrom category_hashes\nunion all\nselect 'OVERALL', item_count, sha256\nfrom overall\norder by category";
  invariant(source.endsWith(finalSelect), "Fingerprint final projection changed");
  return source.slice(0, -finalSelect.length).trimEnd();
}

export function objectKeySql() {
  return `case manifest.category
      when 'relation' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2))
      when 'column' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3), pg_catalog.split_part(manifest.line, '|', 4))
      when 'constraint' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'index' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'policy' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'function' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'trigger' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
      when 'table_acl' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2))
      when 'column_acl' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))
    end`;
}

export function buildProdDriftDiagnostic(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "PROD diagnostic must be built from the repository root");
  const categoryValues = Object.entries(EXPECTED_CATEGORY_COUNTS)
    .map(([category, count]) => `    (${sqlString(category)}::text, ${count}::bigint)`)
    .join(",\n");

  const sql = [
    "-- ORGANIZATECH PERF-06 — PRODUCCIÓN — DRIFT DIAGNOSTIC READ-ONLY",
    `-- DESTINO EXCLUSIVO: organizatech PROD (${PROD_PROJECT_REF}).`,
    "-- Identifica diferencias de catálogo; no lee filas de aplicación, Auth ni Storage.",
    "-- No aplica migraciones, no crea objetos, no modifica datos y termina con ROLLBACK.",
    "",
    "begin isolation level repeatable read read only;",
    "set local statement_timeout = '20s';",
    "set local lock_timeout = '3s';",
    "set local idle_in_transaction_session_timeout = '30s';",
    "set local application_name = 'organizatech-perf-06-prod-drift-readonly';",
    `${fingerprintCtes()},
expected_category_counts(category, expected_item_count) as (
  values
${categoryValues}
),
category_deltas as (
  select
    expected.category,
    coalesce(actual.item_count, 0)::bigint as item_count,
    expected.expected_item_count,
    actual.sha256,
    coalesce(actual.item_count, 0)::bigint <> expected.expected_item_count as count_differs
  from expected_category_counts as expected
  left join category_hashes as actual using (category)
),
drift_categories as (
  select category from category_deltas where count_differs
),
runtime as (
  select
    current_user::text as current_user,
    session_user::text as session_user,
    pg_catalog.current_setting('transaction_isolation') as isolation_level,
    pg_catalog.current_setting('transaction_read_only') as read_only,
    pg_catalog.current_setting('server_version_num')::integer as server_version_num,
    pg_catalog.current_database() as database_name,
    coalesce((select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()), false) as tls_active
),
diagnostic_relation as (
  select pg_catalog.to_regclass('public.training_session_consolidation_audit') as oid
),
diagnostic_catalog as (
  select pg_catalog.jsonb_build_object(
    'present', diagnostic.oid is not null,
    'constraints', (select pg_catalog.count(*) from pg_catalog.pg_constraint where conrelid = diagnostic.oid),
    'indexes', (select pg_catalog.count(*) from pg_catalog.pg_index where indrelid = diagnostic.oid),
    'policies', (select pg_catalog.count(*) from pg_catalog.pg_policy where polrelid = diagnostic.oid),
    'triggers', (select pg_catalog.count(*) from pg_catalog.pg_trigger where tgrelid = diagnostic.oid and not tgisinternal),
    'view_consumers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_depend as dependency
      join pg_catalog.pg_rewrite as rewrite_row
        on dependency.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
       and rewrite_row.oid = dependency.objid
      where dependency.refobjid = diagnostic.oid
        and rewrite_row.ev_class <> diagnostic.oid
    )
  ) as detail
  from diagnostic_relation as diagnostic
),
evaluation as (
  select case
    when runtime.current_user <> 'postgres'
      or runtime.session_user <> 'postgres'
      or runtime.read_only <> 'on'
      or runtime.isolation_level <> 'repeatable read'
    then 'BLOCKED_IDENTITY_OR_TRANSACTION'
    when overall.item_count <> ${OBSERVED_PROD_ITEMS}
      or overall.sha256 <> ${sqlString(OBSERVED_PROD_FINGERPRINT)}
    then 'DRIFT_SNAPSHOT_CHANGED'
    when not exists (select 1 from drift_categories)
    then 'BLOCKED_NO_COUNT_DRIFT_FOUND'
    else 'PASS_DRIFT_DIAGNOSTIC_COMPLETE'
  end as verdict
  from runtime cross join overall
),
report as (
  select
    1::integer as sort_group,
    'RUNTIME'::text as record_type,
    'runtime'::text as category,
    null::bigint as item_count,
    null::bigint as expected_item_count,
    null::text as category_sha256,
    null::text as object_key,
    null::text as item_sha256,
    pg_catalog.jsonb_build_object(
      'current_user', runtime.current_user,
      'session_user', runtime.session_user,
      'isolation_level', runtime.isolation_level,
      'transaction_read_only', runtime.read_only,
      'server_version_num', runtime.server_version_num,
      'database_name', runtime.database_name,
      'tls_active', runtime.tls_active,
      'overall_items', overall.item_count,
      'overall_sha256', overall.sha256
    ) as detail
  from runtime cross join overall

  union all

  select
    2,
    'CATEGORY',
    category,
    item_count,
    expected_item_count,
    sha256,
    null,
    null,
    pg_catalog.jsonb_build_object('count_differs', count_differs)
  from category_deltas

  union all

  select
    3,
    'OBJECT',
    manifest.category,
    null,
    null,
    null,
    ${objectKeySql()},
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(manifest.category || '|' || manifest.line, 'UTF8')),
      'hex'
    ),
    null
  from manifest
  join drift_categories using (category)

  union all

  select
    4,
    'EXCLUDED_DIAGNOSTIC',
    'excluded_diagnostic',
    null,
    null,
    null,
    'public|training_session_consolidation_audit',
    null,
    diagnostic_catalog.detail
  from diagnostic_catalog
)
select
  evaluation.verdict,
  ${sqlString(PROD_PROJECT_REF)}::text as expected_project_ref,
  true as visual_project_confirmation_required,
  report.record_type,
  report.category,
  report.item_count,
  report.expected_item_count,
  report.category_sha256,
  report.object_key,
  report.item_sha256,
  report.detail
from report cross join evaluation
order by report.sort_group, report.category, report.object_key nulls first;`,
    "rollback;",
  ].join("\n\n") + "\n";

  return Object.freeze({
    sql,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      observedItems: OBSERVED_PROD_ITEMS,
      observedFingerprint: OBSERVED_PROD_FINGERPRINT,
      diagnosticSha256: sha256(sql),
      expectedCategoryCounts: EXPECTED_CATEGORY_COUNTS,
    }),
  });
}

export function writeProdDriftDiagnostic(root = outputRoot) {
  const artifact = buildProdDriftDiagnostic();
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, PROD_DRIFT_DIAGNOSTIC_FILE), artifact.sql);
  return artifact.summary;
}

export function verifyProdDriftDiagnostic(root = outputRoot) {
  const artifact = buildProdDriftDiagnostic();
  const path = resolve(root, PROD_DRIFT_DIAGNOSTIC_FILE);
  invariant(existsSync(path), `Missing PROD diagnostic: ${PROD_DRIFT_DIAGNOSTIC_FILE}`);
  invariant(readFileSync(path, "utf8") === artifact.sql, `${PROD_DRIFT_DIAGNOSTIC_FILE} is not deterministic`);
  return artifact.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-prod-drift-diagnostic-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeProdDriftDiagnostic() : verifyProdDriftDiagnostic();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
