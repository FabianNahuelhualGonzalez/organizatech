import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_BASELINE_FINGERPRINT,
  EXPECTED_MANIFEST_SHA256,
  EXPECTED_PROJECT_REF as QA_PROJECT_REF,
  PERF_06_MIGRATIONS,
  splitAndTrim,
} from "./perf-06-migration-manifest.mjs";
import { buildSqlEditorArtifacts } from "./perf-06-sql-editor-bundle.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "supabase/operations/production/perf-06");
const qaPrechecksPath = resolve(repositoryRoot, "supabase/operations/qa/perf-06-atomic/prechecks.sql");
const fingerprintPath = resolve(repositoryRoot, "supabase/diagnostics/perf-06-schema-fingerprint.sql");

export const PROD_PROJECT_REF = "lzycxltqbrtsnwfdotqw";
export const PROD_ROLLBACK_FILE = "08_prod_rollback_capture.sql";
export const PROD_ERROR_CAPTURE_FILE = "09_prod_final_fingerprint_capture.sql";
export const PROD_COMMIT_FILE = "11_prod_commit.sql";
export const PROD_POSTCOMMIT_FILE = "12_prod_postcheck_readonly.sql";
export const PROD_BASELINE_FINGERPRINT = "4216b822625f6fbeea326d09312fc2f77bb268995b552280b6e4d2951870b210";
export const PROD_FINAL_FINGERPRINT = "65267f8cc811923352e947ecce94196520d958ea45c760ea652d4e8235e84c3d";
export const PROD_HISTORY_SHA256 = "3325f11a1cac1738b9aaa4adb389594d7dfb366b2a5978959ffb7210ffbe9756";
export const PROD_DIAGNOSTIC_SHA256 = "6508604cac7b91490218d2f590d26a8616c9e0b525ca3c0548783139cdf39590";
export const PROD_EXTRA_FUNCTION_ITEM_SHA256 = "ebaddb158c298b7eae7866253693d743cac3092c141ccc1a4f312cd32498ca47";
export const PROD_EXTRA_FUNCTION_DEFINITION_SHA256 = "5d4290d1e54f4cee0080882c635a4fd6f669629322cfd8f963ef02da4eee5541";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function replaceExact(source, needle, replacement, expectedCount, label) {
  invariant(occurrences(source, needle) === expectedCount, `${label}: expected ${expectedCount} exact matches`);
  return source.replaceAll(needle, replacement);
}

function loadNamedQuery(name) {
  const source = readFileSync(qaPrechecksPath, "utf8");
  const matches = [...source.matchAll(
    /^-- PERF06_QUERY ([a-z0-9_]+)\n([\s\S]*?)(?=^-- PERF06_QUERY [a-z0-9_]+\n|(?![\s\S]))/gmu,
  )];
  const match = matches.find(([, queryName]) => queryName === name);
  invariant(match, `Missing QA precheck query: ${name}`);
  const statements = splitAndTrim(match[2].trim());
  invariant(statements.length === 1, `${name}: expected one statement`);
  return statements[0];
}

export function buildProdCanonicalFingerprintSql() {
  const statements = splitAndTrim(readFileSync(fingerprintPath, "utf8"));
  invariant(statements.length === 1, "Fingerprint must contain one statement");
  const source = statements[0];
  const functionTail = `  where namespace.nspname = 'public'\n\n  union all\n\n  select\n    'trigger',`;
  const replacement = `  where namespace.nspname = 'public'\n    and not (\n      procedure.proname = 'rls_auto_enable'\n      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''\n    )\n\n  union all\n\n  select\n    'trigger',`;
  return replaceExact(source, functionTail, replacement, 1, "canonical fingerprint exclusion");
}

export function diagnosticCountSql() {
  return `select
  pg_catalog.count(*)::integer as diagnostic_count,
  pg_catalog.count(*) filter (where status::text = 'executed')::integer as diagnostic_executed_count
from public.training_session_consolidation_audit`;
}

export function diagnosticHashSql() {
  return `with diagnostic_lines as (
  select 'relation|' || relation.relkind::text || '|' || relation.relrowsecurity::text || '|' || relation.relforcerowsecurity::text || '|' || coalesce(relation.relacl::text, '') as line
  from pg_catalog.pg_class relation
  where relation.oid = 'public.training_session_consolidation_audit'::regclass
  union all
  select 'column|' || attribute.attnum::text || '|' || attribute.attname || '|' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || '|' || attribute.attnotnull::text || '|' || coalesce(pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid, true), '')
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef attribute_default on attribute_default.adrelid = attribute.attrelid and attribute_default.adnum = attribute.attnum
  where attribute.attrelid = 'public.training_session_consolidation_audit'::regclass and attribute.attnum > 0 and not attribute.attisdropped
  union all
  select 'constraint|' || constraint_row.conname || '|' || pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.training_session_consolidation_audit'::regclass
  union all
  select 'index|' || relation.relname || '|' || pg_catalog.pg_get_indexdef(relation.oid)
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation on relation.oid = index_row.indexrelid
  where index_row.indrelid = 'public.training_session_consolidation_audit'::regclass
  union all
  select 'row|' || pg_catalog.to_jsonb(diagnostic)::text
  from public.training_session_consolidation_audit as diagnostic
)
select pg_catalog.encode(
  pg_catalog.sha256(
    pg_catalog.convert_to(pg_catalog.string_agg(line, E'\\n' order by line), 'UTF8')
  ),
  'hex'
) as diagnostic_hash
from diagnostic_lines`;
}

export function prodGuardSql() {
  return `with target_function as (
  select
    procedure.oid,
    procedure.proowner,
    owner_role.rolname as owner_name,
    language.lanname as language_name,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.proacl,
    pg_catalog.format_type(procedure.prorettype, null) as return_type,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
    pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g') as normalized_definition,
    pg_catalog.concat_ws(
      '|',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid),
      procedure.prosecdef::text,
      coalesce(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
      coalesce((
        select pg_catalog.string_agg(acl_item::text, ',' order by acl_item::text)
        from pg_catalog.unnest(coalesce(procedure.proacl, '{}'::pg_catalog.aclitem[])) as acl_item
      ), ''),
      pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef(procedure.oid), '[[:space:]]+', ' ', 'g')
    ) as fingerprint_line
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner_role on owner_role.oid = procedure.proowner
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where namespace.nspname = 'public'
    and procedure.proname = 'rls_auto_enable'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''
),
function_snapshot as (
  select
    pg_catalog.count(*)::integer as function_count,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('function|' || fingerprint_line, 'UTF8')), 'hex')) as function_item_sha256,
    pg_catalog.min(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(normalized_definition, 'UTF8')), 'hex')) as definition_sha256,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(language_name = 'plpgsql'), false) as language_is_plpgsql,
    coalesce(pg_catalog.bool_and(prosecdef), false) as security_definer,
    coalesce(pg_catalog.bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]), false) as search_path_pg_catalog,
    coalesce(pg_catalog.bool_and(return_type = 'event_trigger'), false) as returns_event_trigger,
    coalesce(pg_catalog.bool_and(identity_arguments = ''), false) as zero_arguments
  from target_function
),
target_event_triggers as (
  select
    event_trigger.evtname,
    event_trigger.evtevent,
    event_trigger.evtenabled,
    event_trigger.evttags,
    event_owner.rolname as owner_name,
    event_trigger.evtfoid,
    target.oid as target_function_oid
  from pg_catalog.pg_event_trigger as event_trigger
  join pg_catalog.pg_roles as event_owner on event_owner.oid = event_trigger.evtowner
  left join target_function as target on target.oid = event_trigger.evtfoid
  where event_trigger.evtname = 'ensure_rls' or target.oid is not null
),
event_snapshot as (
  select
    pg_catalog.count(*) filter (where evtname = 'ensure_rls')::integer as ensure_rls_count,
    pg_catalog.count(*) filter (where target_function_oid is not null)::integer as triggers_using_function,
    coalesce(pg_catalog.bool_and(owner_name = 'postgres') filter (where evtname = 'ensure_rls'), false) as owner_is_postgres,
    coalesce(pg_catalog.bool_and(evtevent = 'ddl_command_end') filter (where evtname = 'ensure_rls'), false) as event_is_ddl_command_end,
    coalesce(pg_catalog.bool_and(evtenabled = 'O') filter (where evtname = 'ensure_rls'), false) as enabled_for_origin,
    coalesce(pg_catalog.bool_and(evtfoid = target_function_oid) filter (where evtname = 'ensure_rls'), false) as calls_target_function,
    coalesce(pg_catalog.bool_and(
      evttags @> array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      and evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
    ) filter (where evtname = 'ensure_rls'), false) as tags_exact,
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', evtname,
      'event', evtevent,
      'enabled', evtenabled,
      'tags', evttags,
      'owner', owner_name,
      'calls_target', evtfoid = target_function_oid
    ) order by evtname), '[]'::jsonb) as event_triggers
  from target_event_triggers
),
dependency_rows as (
  select 'inbound'::text as direction, dependency.classid::pg_catalog.regclass::text as catalog_name, dependency.deptype::text as dependency_type
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.refobjid = target.oid
  union all
  select 'outbound', dependency.refclassid::pg_catalog.regclass::text, dependency.deptype::text
  from pg_catalog.pg_depend as dependency
  join target_function as target
    on dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass and dependency.objid = target.oid
),
dependency_snapshot as (
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'direction', direction,
    'catalog', catalog_name,
    'dependency_type', dependency_type,
    'count', dependency_count
  ) order by direction, catalog_name, dependency_type), '[]'::jsonb) as dependencies
  from (
    select direction, catalog_name, dependency_type, pg_catalog.count(*) as dependency_count
    from dependency_rows
    group by direction, catalog_name, dependency_type
  ) as grouped_dependencies
),
evaluation as (
  select
    function_snapshot.function_item_sha256,
    function_snapshot.definition_sha256,
    event_snapshot.event_triggers,
    dependency_snapshot.dependencies,
    function_snapshot.function_count = 1
      and function_snapshot.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'
      and function_snapshot.definition_sha256 = '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'
      and function_snapshot.owner_is_postgres
      and function_snapshot.language_is_plpgsql
      and function_snapshot.security_definer
      and function_snapshot.search_path_pg_catalog
      and function_snapshot.returns_event_trigger
      and function_snapshot.zero_arguments
      and event_snapshot.ensure_rls_count = 1
      and event_snapshot.triggers_using_function = 1
      and event_snapshot.owner_is_postgres
      and event_snapshot.event_is_ddl_command_end
      and event_snapshot.enabled_for_origin
      and event_snapshot.calls_target_function
      and event_snapshot.tags_exact
      and dependency_snapshot.dependencies = '[{"count":1,"catalog":"pg_event_trigger","direction":"inbound","dependency_type":"n"},{"count":1,"catalog":"pg_language","direction":"outbound","dependency_type":"n"},{"count":1,"catalog":"pg_namespace","direction":"outbound","dependency_type":"n"}]'::jsonb
      as valid
  from function_snapshot, event_snapshot, dependency_snapshot
)
select
  valid,
  function_item_sha256,
  definition_sha256,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.concat_ws('|', function_item_sha256, definition_sha256, event_triggers::text, dependencies::text),
    'UTF8'
  )), 'hex') as guard_hash
from evaluation`;
}

function addProdSnapshotFields(source) {
  const originalCount = loadNamedQuery("diagnostic_count");
  const originalHash = loadNamedQuery("diagnostic_hash");
  source = replaceExact(source, originalCount, diagnosticCountSql(), 3, "diagnostic count query");
  source = replaceExact(source, originalHash, diagnosticHashSql(), 3, "diagnostic hash query");

  const fingerprintAnchor = "fixtures as (\nselect\n  not exists (select 1 from public.exercises where name like '__perf06_fixture_%')";
  invariant(occurrences(source, fingerprintAnchor) === 3, "snapshot fixtures anchor cardinality");
  const prodGuardCte = `prod_guard as (\n${prodGuardSql()}\n),\n`;
  source = replaceExact(source, "fingerprint as (\n", `${prodGuardCte}fingerprint as (\n`, 3, "prod guard CTE insertion");

  source = replaceExact(
    source,
    "'diagnostic_count', (select diagnostic_count from diagnostic_count),",
    "'diagnostic_count', (select diagnostic_count from diagnostic_count),\n  'diagnostic_executed_count', (select diagnostic_executed_count from diagnostic_count),",
    3,
    "diagnostic executed field",
  );
  source = replaceExact(
    source,
    "'fingerprint_count', (select item_count from fingerprint where category = 'OVERALL'),",
    "'prod_guard_valid', (select valid from prod_guard),\n  'prod_guard_hash', (select guard_hash from prod_guard),\n  'prod_function_item_sha256', (select function_item_sha256 from prod_guard),\n  'prod_function_definition_sha256', (select definition_sha256 from prod_guard),\n  'fingerprint_count', (select item_count from fingerprint where category = 'OVERALL'),",
    3,
    "prod guard snapshot fields",
  );
  return source;
}

function strengthenAssertions(source) {
  source = replaceExact(
    source,
    "or (v_snapshot ->> 'diagnostic_count')::integer <> 0\n    or pg_catalog.length(coalesce(v_snapshot ->> 'diagnostic_hash', '')) <> 64",
    `or (v_snapshot ->> 'diagnostic_count')::integer <> 3\n    or (v_snapshot ->> 'diagnostic_executed_count')::integer <> 3\n    or pg_catalog.length(coalesce(v_snapshot ->> 'diagnostic_hash', '')) <> 64\n    or coalesce((v_snapshot ->> 'prod_guard_valid')::boolean, false) is not true\n    or v_snapshot ->> 'prod_function_item_sha256' <> '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'\n    or v_snapshot ->> 'prod_function_definition_sha256' <> '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'\n    or pg_catalog.length(coalesce(v_snapshot ->> 'prod_guard_hash', '')) <> 64`,
    2,
    "baseline PROD preservation gates",
  );
  source = replaceExact(
    source,
    "or (v_final ->> 'diagnostic_final_count')::integer <> 0\n    or v_final ->> 'diagnostic_hash' <> v_initial ->> 'diagnostic_hash'",
    `or (v_final ->> 'diagnostic_final_count')::integer <> 3\n    or (v_final ->> 'diagnostic_executed_count')::integer <> 3\n    or v_final ->> 'diagnostic_hash' <> v_initial ->> 'diagnostic_hash'\n    or coalesce((v_final ->> 'prod_guard_valid')::boolean, false) is not true\n    or v_final ->> 'prod_guard_hash' <> v_initial ->> 'prod_guard_hash'\n    or v_final ->> 'prod_function_item_sha256' <> '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'\n    or v_final ->> 'prod_function_definition_sha256' <> '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'`,
    1,
    "final PROD preservation gates",
  );
  return source;
}

function adaptFingerprintGatesForProdCapture(source) {
  source = replaceExact(
    source,
    EXPECTED_BASELINE_FINGERPRINT,
    PROD_BASELINE_FINGERPRINT,
    3,
    "PROD baseline fingerprint",
  );
  source = replaceExact(
    source,
    `or v_final ->> 'fingerprint_hash' <> '833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9'`,
    `or pg_catalog.length(coalesce(v_final ->> 'fingerprint_hash', '')) <> 64`,
    1,
    "capture final fingerprint gate",
  );
  source = replaceExact(
    source,
    `'833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9'::text as final_fingerprint;`,
    `(select final_snapshot ->> 'fingerprint_hash' from pg_temp.perf06_sql_editor_context) as captured_final_fingerprint;`,
    1,
    "capture final fingerprint output",
  );
  return source;
}

function postRollbackSql(canonicalFingerprintSql) {
  return `begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-rollback-postcheck';

with
fingerprint as (
${canonicalFingerprintSql}
),
overall as (
  select item_count, sha256 from fingerprint where category = 'OVERALL'
),
prod_guard as (
${prodGuardSql()}
),
diagnostic as (
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
)
select
  case
    when overall.item_count = 346
      and overall.sha256 = '${PROD_BASELINE_FINGERPRINT}'
      and prod_guard.valid
      and prod_guard.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'
      and prod_guard.definition_sha256 = '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'
      and diagnostic.diagnostic_count = 3
      and diagnostic.diagnostic_executed_count = 3
      and partial_application.history_absent
      and partial_application.identity_function_absent
      and partial_application.invariant_function_absent
      and partial_application.lineage_function_absent
      and partial_application.perf_index_absent
      and partial_application.perf_triggers_absent
    then 'PASS'
    else 'FAIL'
  end as verdict,
  'ROLLBACK_VERIFIED'::text as terminal,
  '${PROD_PROJECT_REF}'::text as expected_project_ref,
  overall.item_count as canonical_items,
  overall.sha256 as canonical_fingerprint,
  prod_guard.valid as prod_guard_valid,
  prod_guard.function_item_sha256,
  diagnostic.diagnostic_count as diagnostic_rows,
  diagnostic.diagnostic_executed_count as diagnostic_executed_rows
from overall, prod_guard, diagnostic, partial_application;

rollback;`;
}

export function buildProdRollbackArtifact(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "PROD rollback must be built from the repository root");
  const qa = buildSqlEditorArtifacts(repositoryRoot).rollback;
  const canonicalFingerprintSql = buildProdCanonicalFingerprintSql();
  const originalFingerprintSql = splitAndTrim(readFileSync(fingerprintPath, "utf8"))[0];

  let source = qa;
  source = replaceExact(source, QA_PROJECT_REF, PROD_PROJECT_REF, 3, "project ref");
  source = replaceExact(source, "ORGANIZATECH PERF-06 — SUPABASE SQL EDITOR", "ORGANIZATECH PERF-06 — PRODUCCIÓN — SUPABASE SQL EDITOR", 1, "PROD header");
  source = replaceExact(source, "-- DESTINO EXCLUSIVO: organizatech-qa", "-- DESTINO EXCLUSIVO: organizatech PROD", 1, "PROD destination");
  source = replaceExact(source, "-- PROHIBIDO ejecutar este archivo en PROD.", "-- Este archivo sólo valida la operación PROD y termina con ROLLBACK verificable.", 1, "PROD safety header");
  source = replaceExact(source, "organizatech:qa:PERF-06", "organizatech:prod:PERF-06", 1, "advisory lock namespace");
  source = replaceExact(source, "organizatech-perf-06-sql-editor", "organizatech-perf-06-prod-sql-editor-rollback", 1, "application name");
  source = replaceExact(source, originalFingerprintSql, canonicalFingerprintSql, 4, "canonical fingerprint substitution");
  source = addProdSnapshotFields(source);
  source = strengthenAssertions(source);
  source = adaptFingerprintGatesForProdCapture(source);

  const terminalAnchor = "\n\nrollback;\n\nbegin isolation level read committed read only;";
  invariant(occurrences(source, terminalAnchor) === 1, "main rollback terminal anchor");
  source = source.slice(0, source.indexOf(terminalAnchor))
    + "\n\nrollback;\n\n"
    + postRollbackSql(canonicalFingerprintSql)
    + "\n";

  invariant(!source.includes(QA_PROJECT_REF), "PROD rollback cannot contain QA ref");
  invariant(!/^\\[^\n]+/mu.test(source), "PROD rollback cannot contain client metacommands");
  invariant(PERF_06_MIGRATIONS.every((filename) => source.includes(filename.replace(/^(\d{14})_(.+)\.sql$/u, "$1 $2"))), "PROD rollback contains all PERF-06 migration markers");

  return Object.freeze({
    sql: source,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      manifestSha256: EXPECTED_MANIFEST_SHA256,
      canonicalBaselineFingerprint: PROD_BASELINE_FINGERPRINT,
      canonicalFinalFingerprint: "CAPTURED_DURING_ROLLBACK",
      extraFunctionItemSha256: PROD_EXTRA_FUNCTION_ITEM_SHA256,
      extraFunctionDefinitionSha256: PROD_EXTRA_FUNCTION_DEFINITION_SHA256,
      rollbackSha256: sha256(source),
      migrations: 24,
      statements: 336,
      diagnosticRows: 3,
    }),
  });
}

export function buildProdErrorCaptureArtifact(root = repositoryRoot) {
  const rollbackArtifact = buildProdRollbackArtifact(root);
  const terminalSelect = "\n\nselect\n\n  'PASS'::text as verdict,";
  const terminalIndex = rollbackArtifact.sql.indexOf(terminalSelect);
  invariant(terminalIndex > 0, "Missing audited terminal SELECT for capture transformation");

  const sql = `${rollbackArtifact.sql.slice(0, terminalIndex)}

do $perf06_capture_final$
declare
  v_final_fingerprint text;
begin
  select final_snapshot ->> 'fingerprint_hash'
  into v_final_fingerprint
  from pg_temp.perf06_sql_editor_context;

  if pg_catalog.length(coalesce(v_final_fingerprint, '')) <> 64 then
    raise exception using
      errcode = '55000',
      message = 'PERF06_CAPTURE_FAILED';
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'PERF06_EXPECTED_ROLLBACK final_fingerprint=' || v_final_fingerprint;
end;
$perf06_capture_final$;
`;

  const topLevelStatements = splitAndTrim(sql).map((statement) => statement.trimStart().toLowerCase());
  invariant(!topLevelStatements.some((statement) => statement === "commit"), "Capture bundle cannot COMMIT");
  invariant(!topLevelStatements.some((statement) => statement === "rollback"), "Capture bundle relies on the expected exception rollback");
  invariant(!/\$\{[A-Z0-9_]+\}/u.test(sql), "Capture bundle contains an unresolved placeholder");

  return Object.freeze({
    sql,
    summary: Object.freeze({
      ...rollbackArtifact.summary,
      captureSha256: sha256(sql),
      expectedSqlstate: "P0001",
      expectedMessagePrefix: "PERF06_EXPECTED_ROLLBACK final_fingerprint=",
    }),
  });
}

export function buildProdPostcommitSql() {
  const canonicalFingerprintSql = buildProdCanonicalFingerprintSql();
  return `begin isolation level repeatable read read only;

set local statement_timeout = '20s';

set local lock_timeout = '3s';

set local idle_in_transaction_session_timeout = '30s';

set local application_name = 'organizatech-perf-06-prod-postcommit-readonly';

with
fingerprint as (
${canonicalFingerprintSql}
),
overall as (
  select item_count, sha256 from fingerprint where category = 'OVERALL'
),
prod_guard as (
${prodGuardSql()}
),
diagnostic as (
${diagnosticCountSql()}
),
diagnostic_hash as (
${diagnosticHashSql()}
),
history as (
  select
    pg_catalog.count(*)::integer as versions,
    coalesce(pg_catalog.sum(pg_catalog.cardinality(statements)), 0)::integer as statements,
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(pg_catalog.string_agg(
            version || pg_catalog.chr(31) || name || pg_catalog.chr(31)
            || pg_catalog.array_to_string(statements, pg_catalog.chr(30)),
            E'\\n' order by version
          ), ''),
          'UTF8'
        )
      ),
      'hex'
    ) as sha256
  from supabase_migrations.schema_migrations
),
lineage as (
  select
    pg_catalog.count(*) filter (where not exists (
      select 1 from public.training_exercise_lineages as lineage
      where lineage.user_id = exercise.user_id
        and lineage.source_legacy_exercise_id = exercise.id
        and lineage.origin_kind = 'legacy'
        and lineage.origin_training_cycle_exercise_id is null
    ))::integer as pending,
    (select pg_catalog.count(*)::integer from public.training_exercise_lineages
     where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb) as markers
  from public.exercises as exercise
),
catalog as (
  select
    pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is not null
    and pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is not null
    and pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is not null
    and pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is not null
    and (select pg_catalog.count(*) from pg_catalog.pg_trigger
         where tgname in ('exercises_prevent_identity_change', 'exercises_ensure_legacy_lineage', 'training_exercise_lineages_validate_identity_update')
           and tgenabled = 'O' and not tgisinternal) = 3
    and (select pg_catalog.count(*) from pg_catalog.pg_policy
         where polrelid = 'public.training_exercise_lineages'::pg_catalog.regclass) = 3
    and pg_catalog.has_table_privilege('authenticated', 'public.training_exercise_lineages', 'SELECT')
    and pg_catalog.has_table_privilege('authenticated', 'public.training_exercise_lineages', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.training_exercise_lineages', 'DELETE')
    and pg_catalog.has_column_privilege('authenticated', 'public.training_exercise_lineages', 'origin_training_cycle_exercise_id', 'UPDATE')
    and not pg_catalog.has_column_privilege('authenticated', 'public.training_exercise_lineages', 'user_id', 'UPDATE')
    and pg_catalog.has_function_privilege('authenticated', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    and pg_catalog.has_function_privilege('postgres', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role', 'public.save_daily_training_readiness(jsonb)', 'EXECUTE')
    as valid
),
evaluation as (
  select
    overall.item_count = 377
    and overall.sha256 = '${PROD_FINAL_FINGERPRINT}'
    and prod_guard.valid
    and prod_guard.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'
    and prod_guard.definition_sha256 = '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'
    and diagnostic.diagnostic_count = 3
    and diagnostic.diagnostic_executed_count = 3
    and diagnostic_hash.diagnostic_hash = '${PROD_DIAGNOSTIC_SHA256}'
    and history.versions = 24
    and history.statements = 336
    and history.sha256 = '${PROD_HISTORY_SHA256}'
    and lineage.pending = 0
    and lineage.markers = 0
    and catalog.valid
    as valid,
    overall.item_count,
    overall.sha256,
    history.versions,
    history.statements,
    history.sha256 as history_sha256,
    lineage.pending,
    lineage.markers,
    prod_guard.valid as prod_guard_valid,
    diagnostic.diagnostic_count,
    diagnostic.diagnostic_executed_count,
    catalog.valid as catalog_valid
  from overall, prod_guard, diagnostic, diagnostic_hash, history, lineage, catalog
)
select
  case when valid then 'PASS_PROD_APPLIED' else 'BLOCKED' end as verdict,
  '${PROD_PROJECT_REF}'::text as expected_project_ref,
  item_count as canonical_items,
  sha256 as canonical_fingerprint,
  versions as history_versions,
  statements as history_statements,
  history_sha256,
  pending as pending_lineages,
  markers as reconciliation_markers,
  prod_guard_valid,
  diagnostic_count as diagnostic_rows,
  diagnostic_executed_count as diagnostic_executed_rows,
  catalog_valid
from evaluation;

rollback;`;
}

export function buildProdCommitArtifact(root = repositoryRoot) {
  const rollbackArtifact = buildProdRollbackArtifact(root);
  const terminalAnchor = "\n\nrollback;\n\nbegin isolation level repeatable read read only;";
  const terminalIndex = rollbackArtifact.sql.indexOf(terminalAnchor);
  invariant(terminalIndex > 0, "Missing rollback terminal anchor for COMMIT transformation");

  let main = rollbackArtifact.sql.slice(0, terminalIndex);
  main = replaceExact(
    main,
    `or pg_catalog.length(coalesce(v_final ->> 'fingerprint_hash', '')) <> 64`,
    `or v_final ->> 'fingerprint_hash' <> '${PROD_FINAL_FINGERPRINT}'`,
    1,
    "exact PROD final fingerprint",
  );
  main = replaceExact(
    main,
    `(select final_snapshot ->> 'fingerprint_hash' from pg_temp.perf06_sql_editor_context) as captured_final_fingerprint;`,
    `'${PROD_FINAL_FINGERPRINT}'::text as final_fingerprint;`,
    1,
    "fixed PROD final fingerprint output",
  );

  const postcommit = buildProdPostcommitSql();
  const sql = `${main}\n\ncommit;\n\n${postcommit}\n`;
  const topLevelStatements = splitAndTrim(sql).map((statement) => statement.trimStart().toLowerCase());
  invariant(topLevelStatements.filter((statement) => statement === "commit").length === 1, "PROD commit bundle requires exactly one top-level COMMIT");
  invariant(!/\$\{[A-Z0-9_]+\}/u.test(sql), "PROD commit bundle contains an unresolved placeholder");
  return Object.freeze({
    sql,
    postcommit,
    summary: Object.freeze({
      ...rollbackArtifact.summary,
      canonicalFinalFingerprint: PROD_FINAL_FINGERPRINT,
      commitSha256: sha256(sql),
      postcommitSha256: sha256(postcommit),
    }),
  });
}

export function writeProdRollbackArtifact(root = outputRoot) {
  const artifact = buildProdRollbackArtifact();
  writeFileSync(resolve(root, PROD_ROLLBACK_FILE), artifact.sql);
  const capture = buildProdErrorCaptureArtifact();
  writeFileSync(resolve(root, PROD_ERROR_CAPTURE_FILE), capture.sql);
  const commitArtifact = buildProdCommitArtifact();
  writeFileSync(resolve(root, PROD_COMMIT_FILE), commitArtifact.sql);
  writeFileSync(resolve(root, PROD_POSTCOMMIT_FILE), `${commitArtifact.postcommit}\n`);
  return artifact.summary;
}

export function verifyProdRollbackArtifact(root = outputRoot) {
  const artifact = buildProdRollbackArtifact();
  const path = resolve(root, PROD_ROLLBACK_FILE);
  invariant(existsSync(path), `Missing PROD rollback artifact: ${PROD_ROLLBACK_FILE}`);
  invariant(readFileSync(path, "utf8") === artifact.sql, `${PROD_ROLLBACK_FILE} is not deterministic`);
  const capture = buildProdErrorCaptureArtifact();
  const capturePath = resolve(root, PROD_ERROR_CAPTURE_FILE);
  invariant(existsSync(capturePath), `Missing PROD capture artifact: ${PROD_ERROR_CAPTURE_FILE}`);
  invariant(readFileSync(capturePath, "utf8") === capture.sql, `${PROD_ERROR_CAPTURE_FILE} is not deterministic`);
  const commitArtifact = buildProdCommitArtifact();
  const commitPath = resolve(root, PROD_COMMIT_FILE);
  const postcommitPath = resolve(root, PROD_POSTCOMMIT_FILE);
  invariant(existsSync(commitPath), `Missing PROD commit artifact: ${PROD_COMMIT_FILE}`);
  invariant(existsSync(postcommitPath), `Missing PROD postcommit artifact: ${PROD_POSTCOMMIT_FILE}`);
  invariant(readFileSync(commitPath, "utf8") === commitArtifact.sql, `${PROD_COMMIT_FILE} is not deterministic`);
  invariant(readFileSync(postcommitPath, "utf8") === `${commitArtifact.postcommit}\n`, `${PROD_POSTCOMMIT_FILE} is not deterministic`);
  return artifact.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-prod-sql-editor-rollback-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeProdRollbackArtifact() : verifyProdRollbackArtifact();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
