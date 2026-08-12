import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { splitAndTrim } from "./perf-06-migration-manifest.mjs";
import { objectKeySql } from "./perf-06-prod-drift-diagnostic-bundle.mjs";
import {
  PROD_EXTRA_FUNCTION_DEFINITION_SHA256,
  PROD_EXTRA_FUNCTION_ITEM_SHA256,
  PROD_PROJECT_REF,
  buildProdCanonicalFingerprintSql,
  diagnosticCountSql,
  prodGuardSql,
} from "./perf-06-prod-sql-editor-rollback-bundle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "supabase/operations/production/perf-06");

export const PROD_POST_FAILURE_DRIFT_FILE = "06_post_failure_drift_readonly.sql";
export const OBSERVED_CANONICAL_ITEMS = 346;
export const OBSERVED_CANONICAL_FINGERPRINT = "4216b822625f6fbeea326d09312fc2f77bb268995b552280b6e4d2951870b210";

const EXPECTED_CATEGORIES = Object.freeze({
  relation: Object.freeze({ count: 12, sha256: "27f39c8229b08c387618b3c239f67e7f21665855eefda34d5ef2a9ca4428deaa" }),
  column: Object.freeze({ count: 140, sha256: "69898daeb45e1089b14321e2213118cdf467497537f57e85aa11237563e463b5" }),
  constraint: Object.freeze({ count: 87, sha256: "f2a6754c268c5daf0d2928191776274ff5bdbaef261f1e6f117483071f099248" }),
  index: Object.freeze({ count: 48, sha256: "22e08687bf2c4d90d1b6b14581f8eb4da195347501c4c5cd119fab4d2170c4b8" }),
  policy: Object.freeze({ count: 26, sha256: "bd7c900256bb787b4b38875a7b002737cedc7261c7dc03cfef3426a1cc588cdf" }),
  function: Object.freeze({ count: 8, sha256: "892bea17c5e3850563128297ced60de517d353fffe624e1b48204435f550d62e" }),
  trigger: Object.freeze({ count: 13, sha256: "a82172aeb6f41d125020c4af5d58f7843942231301f41fe8b834532f0195a2ca" }),
  table_acl: Object.freeze({ count: 12, sha256: "25a6ff8df97e92bb63d29cc6f26083cb20522a3886069d76f3234ab5c6d57beb" }),
  column_acl: Object.freeze({ count: 0, sha256: null }),
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

export function canonicalFingerprintCtes() {
  const statements = splitAndTrim(buildProdCanonicalFingerprintSql());
  invariant(statements.length === 1, "Canonical fingerprint must contain one statement");
  const source = statements[0];
  const finalSelect = "select category, item_count, sha256\nfrom category_hashes\nunion all\nselect 'OVERALL', item_count, sha256\nfrom overall\norder by category";
  invariant(source.endsWith(finalSelect), "Canonical fingerprint final projection changed");
  return source.slice(0, -finalSelect.length).trimEnd();
}

export function buildProdPostFailureDriftDiagnostic(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "Post-failure drift diagnostic must be built from repository root");
  const expectedValues = Object.entries(EXPECTED_CATEGORIES)
    .map(([category, expected]) => `    (${sqlString(category)}::text, ${expected.count}::bigint, ${expected.sha256 ? `${sqlString(expected.sha256)}::text` : "null::text"})`)
    .join(",\n");

  const sql = `-- ORGANIZATECH PERF-06 — PRODUCCIÓN — POST-FAILURE CANONICAL DRIFT READ-ONLY
-- DESTINO EXCLUSIVO: organizatech PROD (${PROD_PROJECT_REF}).
-- Identifica la categoría y las claves de objeto del drift 346/4216 vs 346/ebd6.
-- No devuelve definiciones, ACL completas ni filas de aplicación y termina con ROLLBACK.

begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-post-failure-drift-readonly';

${canonicalFingerprintCtes()},
expected_categories(category, expected_item_count, expected_sha256) as (
  values
${expectedValues}
),
category_deltas as (
  select
    expected.category,
    coalesce(actual.item_count, 0)::bigint as item_count,
    expected.expected_item_count,
    actual.sha256 as category_sha256,
    expected.expected_sha256,
    coalesce(actual.item_count, 0)::bigint <> expected.expected_item_count
      or actual.sha256 is distinct from expected.expected_sha256 as differs
  from expected_categories as expected
  left join category_hashes as actual using (category)
),
drift_categories as (
  select category from category_deltas where differs
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
prod_guard as (
${prodGuardSql()}
),
diagnostic_count as (
${diagnosticCountSql()}
),
partial_application as (
  select
    pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null as history_absent,
    pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is null as identity_function_absent,
    pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null as invariant_function_absent,
    pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is null as lineage_function_absent,
    pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null as perf_index_absent,
    not exists (
      select 1 from pg_catalog.pg_trigger
      where tgname in ('exercises_prevent_identity_change', 'exercises_ensure_legacy_lineage', 'training_exercise_lineages_validate_identity_update')
        and not tgisinternal
    ) as perf_triggers_absent
),
evaluation as (
  select case
    when runtime.current_user <> 'postgres'
      or runtime.session_user <> 'postgres'
      or runtime.isolation_level <> 'repeatable read'
      or runtime.read_only <> 'on'
      or runtime.server_version_num <> 170006
      or runtime.database_name <> 'postgres'
      or not runtime.tls_active
    then 'BLOCKED_IDENTITY_OR_TRANSACTION'
    when overall.item_count <> ${OBSERVED_CANONICAL_ITEMS}
      or overall.sha256 <> '${OBSERVED_CANONICAL_FINGERPRINT}'
    then 'DRIFT_SNAPSHOT_CHANGED'
    when not prod_guard.valid
      or prod_guard.function_item_sha256 <> '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'
      or prod_guard.definition_sha256 <> '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'
    then 'BLOCKED_PROD_GUARD_CHANGED'
    when diagnostic_count.diagnostic_count <> 3
      or diagnostic_count.diagnostic_executed_count <> 3
    then 'BLOCKED_DIAGNOSTIC_CHANGED'
    when not partial_application.history_absent
      or not partial_application.identity_function_absent
      or not partial_application.invariant_function_absent
      or not partial_application.lineage_function_absent
      or not partial_application.perf_index_absent
      or not partial_application.perf_triggers_absent
    then 'BLOCKED_PARTIAL_APPLICATION'
    when not exists (select 1 from drift_categories)
    then 'BLOCKED_NO_CANONICAL_DRIFT_FOUND'
    else 'PASS_POST_FAILURE_DRIFT_CAPTURED'
  end as verdict
  from runtime, overall, prod_guard, diagnostic_count, partial_application
),
report as (
  select
    1::integer as sort_group,
    'RUNTIME'::text as record_type,
    'runtime'::text as category,
    null::bigint as item_count,
    null::bigint as expected_item_count,
    null::text as category_sha256,
    null::text as expected_category_sha256,
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
      'canonical_items', overall.item_count,
      'canonical_sha256', overall.sha256
    ) as detail
  from runtime cross join overall

  union all

  select
    2,
    'CATEGORY',
    category,
    item_count,
    expected_item_count,
    category_sha256,
    expected_sha256,
    null,
    null,
    pg_catalog.jsonb_build_object('differs', differs)
  from category_deltas

  union all

  select
    3,
    'OBJECT',
    manifest.category,
    null,
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
)
select
  evaluation.verdict,
  '${PROD_PROJECT_REF}'::text as expected_project_ref,
  true as visual_project_confirmation_required,
  report.record_type,
  report.category,
  report.item_count,
  report.expected_item_count,
  report.category_sha256,
  report.expected_category_sha256,
  report.object_key,
  report.item_sha256,
  report.detail
from report cross join evaluation
order by report.sort_group, report.category, report.object_key nulls first;

rollback;
`;

  invariant(!/\$\{[A-Z0-9_]+\}/u.test(sql), "Post-failure drift SQL contains an unresolved placeholder");
  return Object.freeze({
    sql,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      diagnosticSha256: sha256(sql),
      observedCanonicalItems: OBSERVED_CANONICAL_ITEMS,
      observedCanonicalFingerprint: OBSERVED_CANONICAL_FINGERPRINT,
      expectedCategories: EXPECTED_CATEGORIES,
    }),
  });
}

export function writeProdPostFailureDriftDiagnostic(root = outputRoot) {
  const artifact = buildProdPostFailureDriftDiagnostic();
  writeFileSync(resolve(root, PROD_POST_FAILURE_DRIFT_FILE), artifact.sql);
  return artifact.summary;
}

export function verifyProdPostFailureDriftDiagnostic(root = outputRoot) {
  const artifact = buildProdPostFailureDriftDiagnostic();
  const path = resolve(root, PROD_POST_FAILURE_DRIFT_FILE);
  invariant(existsSync(path), `Missing post-failure drift diagnostic: ${PROD_POST_FAILURE_DRIFT_FILE}`);
  invariant(readFileSync(path, "utf8") === artifact.sql, `${PROD_POST_FAILURE_DRIFT_FILE} is not deterministic`);
  return artifact.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-prod-post-failure-drift-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeProdPostFailureDriftDiagnostic() : verifyProdPostFailureDriftDiagnostic();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
