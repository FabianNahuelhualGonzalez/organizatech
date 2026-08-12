import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalFingerprintCtes } from "./perf-06-prod-post-failure-drift-bundle.mjs";
import {
  PROD_EXTRA_FUNCTION_DEFINITION_SHA256,
  PROD_EXTRA_FUNCTION_ITEM_SHA256,
  PROD_PROJECT_REF,
  diagnosticCountSql,
  prodGuardSql,
} from "./perf-06-prod-sql-editor-rollback-bundle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "supabase/operations/production/perf-06");

export const PROD_ACL_FUNCTION_CLASSIFICATION_FILE = "07_acl_function_classification_readonly.sql";
export const OBSERVED_CANONICAL_ITEMS = 346;
export const OBSERVED_CANONICAL_FINGERPRINT = "4216b822625f6fbeea326d09312fc2f77bb268995b552280b6e4d2951870b210";
export const OBSERVED_FUNCTION_FINGERPRINT = "ac9f9145327f35a7c186d8e1aec5adeb0ca0495f46cc718fb1c965b231308ffb";
export const OBSERVED_TABLE_ACL_FINGERPRINT = "fe60fd8b07cf9ca0dbcb4eab09e49dda446d8e2e3240b62e6d2623aadccb5b39";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildProdAclFunctionClassification(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "ACL/function classification must be built from repository root");

  const sql = `-- ORGANIZATECH PERF-06 — PRODUCCIÓN — ACL/FUNCTION CLASSIFICATION READ-ONLY
-- DESTINO EXCLUSIVO: organizatech PROD (${PROD_PROJECT_REF}).
-- Separa definición/configuración de funciones y ACL directos sin devolver cuerpos ni datos de aplicación.

begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-acl-function-classification-readonly';

${canonicalFingerprintCtes()},
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
function_details as (
  select
    namespace.nspname || '|' || procedure.proname || '|' || pg_catalog.pg_get_function_identity_arguments(procedure.oid) as object_key,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g'),
          'UTF8'
        )
      ),
      'hex'
    ) as definition_sha256,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
      'language', language.lanname,
      'security_definer', procedure.prosecdef,
      'volatility', procedure.provolatile::text,
      'parallel', procedure.proparallel::text,
      'config', coalesce(pg_catalog.to_jsonb(procedure.proconfig), '[]'::jsonb),
      'direct_acl', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
              'privilege', acl.privilege_type,
              'grantable', acl.is_grantable,
              'grantor', pg_catalog.pg_get_userbyid(acl.grantor)
            )
            order by case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
              acl.privilege_type,
              acl.is_grantable
          )
          from pg_catalog.aclexplode(procedure.proacl) as acl
        ),
        '[]'::jsonb
      )
    ) as detail
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and not (
      procedure.proname = 'rls_auto_enable'
      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
    )
),
table_acl_details as (
  select
    target.nspname || '|' || target.relname as object_key,
    pg_catalog.jsonb_build_object(
      'owner', pg_catalog.pg_get_userbyid(relation.relowner),
      'direct_acl', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
              'privilege', acl.privilege_type,
              'grantable', acl.is_grantable,
              'grantor', pg_catalog.pg_get_userbyid(acl.grantor)
            )
            order by case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
              acl.privilege_type,
              acl.is_grantable
          )
          from pg_catalog.aclexplode(target.relacl) as acl
        ),
        '[]'::jsonb
      )
    ) as detail
  from target_rel as target
  join pg_catalog.pg_class as relation on relation.oid = target.oid
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
      or (select sha256 from category_hashes where category = 'function') <> '${OBSERVED_FUNCTION_FINGERPRINT}'
      or (select sha256 from category_hashes where category = 'table_acl') <> '${OBSERVED_TABLE_ACL_FINGERPRINT}'
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
    when (select count(*) from function_details) <> 8
      or (select count(*) from table_acl_details) <> 12
    then 'BLOCKED_CLASSIFICATION_CARDINALITY'
    else 'PASS_ACL_FUNCTION_CLASSIFICATION_CAPTURED'
  end as verdict
  from runtime, overall, prod_guard, diagnostic_count, partial_application
),
report as (
  select
    1::integer as sort_group,
    'RUNTIME'::text as record_type,
    'runtime'::text as category,
    null::text as object_key,
    null::text as definition_sha256,
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

  select 2, 'OBJECT', 'function', object_key, definition_sha256, detail
  from function_details

  union all

  select 3, 'OBJECT', 'table_acl', object_key, null, detail
  from table_acl_details
)
select
  evaluation.verdict,
  '${PROD_PROJECT_REF}'::text as expected_project_ref,
  true as visual_project_confirmation_required,
  report.record_type,
  report.category,
  report.object_key,
  report.definition_sha256,
  report.detail
from report cross join evaluation
order by report.sort_group, report.object_key nulls first;

rollback;
`;

  invariant(!/\$\{[A-Z0-9_]+\}/u.test(sql), "ACL/function SQL contains an unresolved placeholder");
  return Object.freeze({
    sql,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      classificationSha256: sha256(sql),
      observedCanonicalItems: OBSERVED_CANONICAL_ITEMS,
      observedCanonicalFingerprint: OBSERVED_CANONICAL_FINGERPRINT,
      observedFunctionFingerprint: OBSERVED_FUNCTION_FINGERPRINT,
      observedTableAclFingerprint: OBSERVED_TABLE_ACL_FINGERPRINT,
    }),
  });
}

export function writeProdAclFunctionClassification(root = outputRoot) {
  const artifact = buildProdAclFunctionClassification();
  writeFileSync(resolve(root, PROD_ACL_FUNCTION_CLASSIFICATION_FILE), artifact.sql);
  return artifact.summary;
}

export function verifyProdAclFunctionClassification(root = outputRoot) {
  const artifact = buildProdAclFunctionClassification();
  const path = resolve(root, PROD_ACL_FUNCTION_CLASSIFICATION_FILE);
  invariant(existsSync(path), `Missing ACL/function classification: ${PROD_ACL_FUNCTION_CLASSIFICATION_FILE}`);
  invariant(readFileSync(path, "utf8") === artifact.sql, `${PROD_ACL_FUNCTION_CLASSIFICATION_FILE} is not deterministic`);
  return artifact.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-prod-acl-function-classification-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeProdAclFunctionClassification() : verifyProdAclFunctionClassification();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
