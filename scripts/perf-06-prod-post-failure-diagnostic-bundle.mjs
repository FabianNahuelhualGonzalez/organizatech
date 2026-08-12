import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EXPECTED_BASELINE_FINGERPRINT } from "./perf-06-migration-manifest.mjs";
import {
  PROD_EXTRA_FUNCTION_DEFINITION_SHA256,
  PROD_EXTRA_FUNCTION_ITEM_SHA256,
  PROD_BASELINE_FINGERPRINT,
  PROD_PROJECT_REF,
  buildProdCanonicalFingerprintSql,
  diagnosticCountSql,
  diagnosticHashSql,
  prodGuardSql,
} from "./perf-06-prod-sql-editor-rollback-bundle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "supabase/operations/production/perf-06");

export const PROD_POST_FAILURE_FILE = "05_post_failure_readonly.sql";
export const PROD_POST_CAPTURE_FILE = "10_post_capture_readonly.sql";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildProdPostFailureDiagnostic(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "Post-failure diagnostic must be built from repository root");
  const canonicalFingerprintSql = buildProdCanonicalFingerprintSql();
  const sql = `-- ORGANIZATECH PERF-06 — PRODUCCIÓN — POST-FAILURE DIAGNOSTIC READ-ONLY
-- DESTINO EXCLUSIVO: organizatech PROD (${PROD_PROJECT_REF}).
-- Verifica que el fallo del primer gate no dejó cambios persistentes.
-- No modifica objetos ni datos y termina con ROLLBACK.

begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-post-failure-readonly';

with
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
fingerprint as (
${canonicalFingerprintSql}
),
overall as (
  select item_count, sha256 from fingerprint where category = 'OVERALL'
),
prod_guard as (
${prodGuardSql()}
),
diagnostic_count as (
${diagnosticCountSql()}
),
diagnostic_hash as (
${diagnosticHashSql()}
),
partial_application as (
  select
    pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null as history_absent,
    pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is null as identity_function_absent,
    pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null as invariant_function_absent,
    pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is null as lineage_function_absent,
    pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null as perf_index_absent,
    not exists (
      select 1
      from pg_catalog.pg_trigger
      where tgname in ('exercises_prevent_identity_change', 'exercises_ensure_legacy_lineage', 'training_exercise_lineages_validate_identity_update')
        and not tgisinternal
    ) as perf_triggers_absent
),
lineage as (
  select
    pg_catalog.count(*) filter (where not exists (
      select 1
      from public.training_exercise_lineages as lineage
      where lineage.user_id = exercise.user_id
        and lineage.source_legacy_exercise_id = exercise.id
    ))::integer as pending,
    (select pg_catalog.count(*)::integer
     from public.training_exercise_lineages
     where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
    ) as markers
  from public.exercises as exercise
),
residual_sessions as (
  select pg_catalog.count(*)::integer as session_count
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and application_name in (
      'organizatech-perf-06-prod-sql-editor-rollback',
      'organizatech-perf-06-prod-rollback-postcheck'
    )
),
residual_locks as (
  select pg_catalog.count(*)::integer as lock_count
  from pg_catalog.pg_locks as lock_row
  join pg_catalog.pg_stat_activity as activity on activity.pid = lock_row.pid
  where activity.pid <> pg_catalog.pg_backend_pid()
    and activity.datname = pg_catalog.current_database()
    and activity.application_name in (
      'organizatech-perf-06-prod-sql-editor-rollback',
      'organizatech-perf-06-prod-rollback-postcheck'
    )
),
evaluation as (
  select
    runtime.*,
    overall.item_count,
    overall.sha256 as fingerprint,
    prod_guard.valid as prod_guard_valid,
    prod_guard.function_item_sha256,
    prod_guard.definition_sha256,
    diagnostic_count.diagnostic_count,
    diagnostic_count.diagnostic_executed_count,
    diagnostic_hash.diagnostic_hash,
    partial_application.*,
    lineage.pending,
    lineage.markers,
    residual_sessions.session_count as residual_sessions,
    residual_locks.lock_count as residual_locks,
    runtime.current_user = 'postgres'
      and runtime.session_user = 'postgres'
      and runtime.isolation_level = 'repeatable read'
      and runtime.read_only = 'on'
      and runtime.server_version_num = 170006
      and runtime.database_name = 'postgres'
      and runtime.tls_active
      and overall.item_count = 346
      and overall.sha256 = '${EXPECTED_BASELINE_FINGERPRINT}'
      and prod_guard.valid
      and prod_guard.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'
      and prod_guard.definition_sha256 = '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'
      and diagnostic_count.diagnostic_count = 3
      and diagnostic_count.diagnostic_executed_count = 3
      and pg_catalog.length(coalesce(diagnostic_hash.diagnostic_hash, '')) = 64
      and partial_application.history_absent
      and partial_application.identity_function_absent
      and partial_application.invariant_function_absent
      and partial_application.lineage_function_absent
      and partial_application.perf_index_absent
      and partial_application.perf_triggers_absent
      and lineage.pending = 0
      and lineage.markers = 0
      and residual_sessions.session_count = 0
      and residual_locks.lock_count = 0
      as valid
  from runtime, overall, prod_guard, diagnostic_count, diagnostic_hash,
       partial_application, lineage, residual_sessions, residual_locks
)
select
  case when valid then 'PASS_POST_FAILURE_STATE_VERIFIED' else 'BLOCKED' end as verdict,
  '${PROD_PROJECT_REF}'::text as expected_project_ref,
  true as visual_project_confirmation_required,
  current_user,
  session_user,
  isolation_level,
  read_only as transaction_read_only,
  server_version_num,
  database_name,
  tls_active,
  item_count as canonical_items,
  fingerprint as canonical_fingerprint,
  prod_guard_valid,
  function_item_sha256,
  definition_sha256,
  history_absent,
  identity_function_absent,
  invariant_function_absent,
  lineage_function_absent,
  perf_index_absent,
  perf_triggers_absent,
  pending as pending_lineages,
  markers as reconciliation_markers,
  diagnostic_count as diagnostic_rows,
  diagnostic_executed_count as diagnostic_executed_rows,
  diagnostic_hash,
  residual_sessions,
  residual_locks
from evaluation;

rollback;
`;

  invariant(!/\$\{[A-Z0-9_]+\}/u.test(sql), "Post-failure SQL contains an unresolved template placeholder");
  return Object.freeze({
    sql,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      diagnosticSha256: sha256(sql),
      canonicalBaselineFingerprint: EXPECTED_BASELINE_FINGERPRINT,
      extraFunctionItemSha256: PROD_EXTRA_FUNCTION_ITEM_SHA256,
      extraFunctionDefinitionSha256: PROD_EXTRA_FUNCTION_DEFINITION_SHA256,
    }),
  });
}

export function buildProdPostCaptureDiagnostic(root = repositoryRoot) {
  const baseline = buildProdPostFailureDiagnostic(root);
  let sql = baseline.sql;
  sql = sql.replace(
    "POST-FAILURE DIAGNOSTIC READ-ONLY",
    "POST-CAPTURE DIAGNOSTIC READ-ONLY",
  );
  sql = sql.replace(
    "Verifica que el fallo del primer gate no dejó cambios persistentes.",
    "Verifica que la captura controlada P0001 revirtió todos los cambios.",
  );
  sql = sql.replace(
    "organizatech-perf-06-prod-post-failure-readonly",
    "organizatech-perf-06-prod-post-capture-readonly",
  );
  sql = sql.replace(EXPECTED_BASELINE_FINGERPRINT, PROD_BASELINE_FINGERPRINT);
  sql = sql.replace("PASS_POST_FAILURE_STATE_VERIFIED", "PASS_POST_CAPTURE_ROLLBACK_VERIFIED");

  invariant(sql !== baseline.sql, "Post-capture diagnostic transformation must be effective");
  invariant(!/\$\{[A-Z0-9_]+\}/u.test(sql), "Post-capture SQL contains an unresolved placeholder");
  return Object.freeze({
    sql,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      diagnosticSha256: sha256(sql),
      canonicalBaselineFingerprint: PROD_BASELINE_FINGERPRINT,
    }),
  });
}

export function writeProdPostFailureDiagnostic(root = outputRoot) {
  const artifact = buildProdPostFailureDiagnostic();
  writeFileSync(resolve(root, PROD_POST_FAILURE_FILE), artifact.sql);
  const postCapture = buildProdPostCaptureDiagnostic();
  writeFileSync(resolve(root, PROD_POST_CAPTURE_FILE), postCapture.sql);
  return artifact.summary;
}

export function verifyProdPostFailureDiagnostic(root = outputRoot) {
  const artifact = buildProdPostFailureDiagnostic();
  const path = resolve(root, PROD_POST_FAILURE_FILE);
  invariant(existsSync(path), `Missing post-failure diagnostic: ${PROD_POST_FAILURE_FILE}`);
  invariant(readFileSync(path, "utf8") === artifact.sql, `${PROD_POST_FAILURE_FILE} is not deterministic`);
  const postCapture = buildProdPostCaptureDiagnostic();
  const postCapturePath = resolve(root, PROD_POST_CAPTURE_FILE);
  invariant(existsSync(postCapturePath), `Missing post-capture diagnostic: ${PROD_POST_CAPTURE_FILE}`);
  invariant(readFileSync(postCapturePath, "utf8") === postCapture.sql, `${PROD_POST_CAPTURE_FILE} is not deterministic`);
  return artifact.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-prod-post-failure-diagnostic-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeProdPostFailureDiagnostic() : verifyProdPostFailureDiagnostic();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
