import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_BASELINE_FINGERPRINT,
  EXPECTED_FINAL_FINGERPRINT,
  EXPECTED_MANIFEST_SHA256,
  buildManifest,
  splitAndTrim,
} from "./perf-06-migration-manifest.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(repositoryRoot, "supabase/operations/production/perf-06");

export const PROD_PROJECT_REF = "lzycxltqbrtsnwfdotqw";
export const PROD_PREFLIGHT_FILE = "01_preflight_readonly.sql";

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

const REQUIRED_RELATIONS = Object.freeze([
  ["auth", "users"],
  ...DATA_COUNT_RELATIONS.map((relation) => ["public", relation]),
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

function expectedHistoryDigest(manifest) {
  return sha256(manifest.map((row) => (
    `${row.version}\x1f${row.name}\x1f${row.statements.join("\x1e")}`
  )).join("\n"));
}

function dynamicSnapshotSql(expectedHistorySha256) {
  const relationValues = REQUIRED_RELATIONS
    .map(([schema, relation]) => `      (${sqlString(schema)}::text, ${sqlString(relation)}::text)`)
    .join(",\n");
  const dataRelations = DATA_COUNT_RELATIONS.map(sqlString).join(", ");

  return `do $perf06_prod_snapshot$
declare
  v_history_oid oid := pg_catalog.to_regclass('supabase_migrations.schema_migrations');
  v_diagnostic_oid oid := pg_catalog.to_regclass('public.training_session_consolidation_audit');
  v_history_shape_valid boolean := false;
  v_history_versions integer := 0;
  v_history_statements integer := 0;
  v_history_sha256 text;
  v_history_exact boolean := false;
  v_missing_relations jsonb := '[]'::jsonb;
  v_data_counts jsonb := '{}'::jsonb;
  v_lineage jsonb := '{}'::jsonb;
  v_diagnostic jsonb := '{}'::jsonb;
  v_operational jsonb := '{}'::jsonb;
  v_partial jsonb;
  v_relation text;
  v_count bigint;
  v_status_counts jsonb := '{}'::jsonb;
  v_diagnostic_count bigint := 0;
  v_diagnostic_consumers integer := 0;
begin
  select coalesce(pg_catalog.jsonb_agg(schema_name || '.' || relation_name order by schema_name, relation_name), '[]'::jsonb)
  into v_missing_relations
  from (values
${relationValues}
  ) as required_relation(schema_name, relation_name)
  where pg_catalog.to_regclass(schema_name || '.' || relation_name) is null;

  if v_history_oid is not null then
    select
      pg_catalog.count(*) filter (where attribute.attname = 'version' and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text') = 1
      and pg_catalog.count(*) filter (where attribute.attname = 'name' and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text') = 1
      and pg_catalog.count(*) filter (where attribute.attname = 'statements' and pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text[]') = 1
    into v_history_shape_valid
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = v_history_oid
      and attribute.attnum > 0
      and not attribute.attisdropped;

    if v_history_shape_valid then
      execute $perf06_history_query$
        select
          pg_catalog.count(*)::integer,
          coalesce(pg_catalog.sum(pg_catalog.cardinality(statements)), 0)::integer,
          pg_catalog.encode(
            pg_catalog.sha256(
              pg_catalog.convert_to(
                coalesce(
                  pg_catalog.string_agg(
                    version || pg_catalog.chr(31) || name || pg_catalog.chr(31)
                    || pg_catalog.array_to_string(statements, pg_catalog.chr(30)),
                    E'\\n' order by version
                  ),
                  ''
                ),
                'UTF8'
              )
            ),
            'hex'
          )
        from supabase_migrations.schema_migrations
      $perf06_history_query$
      into v_history_versions, v_history_statements, v_history_sha256;

      v_history_exact := v_history_versions = 24
        and v_history_statements = 336
        and v_history_sha256 = ${sqlString(expectedHistorySha256)};
    end if;
  end if;

  foreach v_relation in array array[${dataRelations}]
  loop
    if pg_catalog.to_regclass('public.' || v_relation) is not null then
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I', v_relation)
      into v_count;
      v_data_counts := v_data_counts || pg_catalog.jsonb_build_object(v_relation, v_count);
    end if;
  end loop;

  if v_missing_relations = '[]'::jsonb then
    execute $perf06_lineage_query$
      with pending as (
        select exercise.id, exercise.user_id, exercise.routine_id
        from public.exercises as exercise
        where not exists (
          select 1
          from public.training_exercise_lineages as lineage
          where lineage.user_id = exercise.user_id
            and lineage.source_legacy_exercise_id = exercise.id
        )
      )
      select pg_catalog.jsonb_build_object(
        'pending', (select pg_catalog.count(*) from pending),
        'exercise_count', (select pg_catalog.count(*) from public.exercises),
        'invalid_auth_users', (
          select pg_catalog.count(*)
          from pending
          left join auth.users as app_user on app_user.id = pending.user_id
          where app_user.id is null
        ),
        'invalid_routines', (
          select pg_catalog.count(*)
          from pending
          left join public.routines as routine on routine.id = pending.routine_id
          where routine.id is null or routine.user_id <> pending.user_id
        ),
        'entry_references', (
          select pg_catalog.count(*)
          from public.exercise_entries as entry
          join pending on pending.id = entry.exercise_id
        ),
        'cycle_references', (
          select pg_catalog.count(*)
          from public.training_cycle_exercises as cycle_exercise
          join pending on pending.id = cycle_exercise.source_legacy_exercise_id
        ),
        'cross_owner_source_conflicts', (
          select pg_catalog.count(*)
          from public.training_exercise_lineages as lineage
          join pending on pending.id = lineage.source_legacy_exercise_id
          where lineage.user_id <> pending.user_id
             or lineage.origin_kind <> 'legacy'
             or lineage.origin_training_cycle_exercise_id is not null
        ),
        'incompatible_lineages', (
          select pg_catalog.count(*)
          from public.training_exercise_lineages as lineage
          join public.exercises as exercise on exercise.id = lineage.source_legacy_exercise_id
          where lineage.user_id <> exercise.user_id
             or lineage.origin_kind <> 'legacy'
             or lineage.origin_training_cycle_exercise_id is not null
        ),
        'markers', (
          select pg_catalog.count(*)
          from public.training_exercise_lineages
          where metadata @> '{"reconciliation":"PERF-06R","source":"migration-history-normalization","version":1}'::jsonb
        ),
        'fixtures', (
          (select pg_catalog.count(*) from public.exercises where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.routines where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_cycles where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_cycle_routines where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_cycle_exercises where name like '__perf06_fixture_%')
          + (select pg_catalog.count(*) from public.training_exercise_lineages where metadata ? 'fixture')
        )
      )
    $perf06_lineage_query$
    into v_lineage;
  end if;

  if v_diagnostic_oid is not null then
    execute $perf06_diagnostic_count$
      select pg_catalog.count(*) from public.training_session_consolidation_audit
    $perf06_diagnostic_count$
    into v_diagnostic_count;

    if exists (
      select 1
      from pg_catalog.pg_attribute
      where attrelid = v_diagnostic_oid
        and attname = 'status'
        and attnum > 0
        and not attisdropped
    ) then
      execute $perf06_diagnostic_status$
        select coalesce(pg_catalog.jsonb_object_agg(status, row_count), '{}'::jsonb)
        from (
          select status::text, pg_catalog.count(*)::bigint as row_count
          from public.training_session_consolidation_audit
          group by status
          order by status
        ) as status_counts
      $perf06_diagnostic_status$
      into v_status_counts;
    end if;

    select pg_catalog.count(*)::integer
    into v_diagnostic_consumers
    from pg_catalog.pg_depend as dependency
    join pg_catalog.pg_rewrite as rewrite_row
      on dependency.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
     and rewrite_row.oid = dependency.objid
    join pg_catalog.pg_class as dependent on dependent.oid = rewrite_row.ev_class
    where dependency.refobjid = v_diagnostic_oid
      and dependent.oid <> dependency.refobjid;
  end if;

  v_partial := pg_catalog.jsonb_build_object(
    'history_absent', v_history_oid is null,
    'identity_function_absent', pg_catalog.to_regprocedure('public.prevent_exercise_identity_change()') is null,
    'invariant_function_absent', pg_catalog.to_regprocedure('public.ensure_legacy_exercise_lineage_invariant()') is null,
    'lineage_function_absent', pg_catalog.to_regprocedure('public.validate_training_exercise_lineage_identity_update()') is null,
    'perf_index_absent', pg_catalog.to_regclass('public.exercise_entries_session_user_lineage_created_id_idx') is null,
    'perf_triggers_absent', not exists (
      select 1
      from pg_catalog.pg_trigger
      where tgname in (
        'exercises_prevent_identity_change',
        'exercises_ensure_legacy_lineage',
        'training_exercise_lineages_validate_identity_update'
      )
        and not tgisinternal
    )
  );

  v_diagnostic := pg_catalog.jsonb_build_object(
    'present', v_diagnostic_oid is not null,
    'rows', v_diagnostic_count,
    'status_counts', v_status_counts,
    'consumers', v_diagnostic_consumers
  );

  select pg_catalog.jsonb_build_object(
    'other_transactions_over_30s', pg_catalog.count(*) filter (
      where activity.xact_start is not null
        and pg_catalog.clock_timestamp() - activity.xact_start > interval '30 seconds'
    ),
    'other_relation_locks', (
      select pg_catalog.count(*)
      from pg_catalog.pg_locks as lock_row
      where lock_row.pid <> pg_catalog.pg_backend_pid()
        and lock_row.database = (select oid from pg_catalog.pg_database where datname = pg_catalog.current_database())
        and lock_row.relation in (
          select relation.oid
          from pg_catalog.pg_class as relation
          join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
          where namespace.nspname in ('public', 'auth')
        )
    ),
    'exercise_entries_heap_bytes', coalesce(pg_catalog.pg_relation_size(pg_catalog.to_regclass('public.exercise_entries')), 0),
    'exercise_entries_total_bytes', coalesce(pg_catalog.pg_total_relation_size(pg_catalog.to_regclass('public.exercise_entries')), 0),
    'exercise_entries_live_rows_estimate', coalesce((
      select stats.n_live_tup from pg_catalog.pg_stat_user_tables as stats
      where stats.relid = pg_catalog.to_regclass('public.exercise_entries')
    ), 0),
    'exercise_entries_dead_rows_estimate', coalesce((
      select stats.n_dead_tup from pg_catalog.pg_stat_user_tables as stats
      where stats.relid = pg_catalog.to_regclass('public.exercise_entries')
    ), 0)
  )
  into v_operational
  from pg_catalog.pg_stat_activity as activity
  where activity.pid <> pg_catalog.pg_backend_pid()
    and activity.datname = pg_catalog.current_database();

  perform pg_catalog.set_config(
    'perf06.prod_preflight_snapshot',
    pg_catalog.jsonb_build_object(
      'history', pg_catalog.jsonb_build_object(
        'present', v_history_oid is not null,
        'shape_valid', v_history_shape_valid,
        'versions', v_history_versions,
        'statements', v_history_statements,
        'sha256', v_history_sha256,
        'exact_final', v_history_exact
      ),
      'missing_relations', v_missing_relations,
      'data_counts', v_data_counts,
      'lineage', v_lineage,
      'diagnostic', v_diagnostic,
      'operational', v_operational,
      'partial_application', v_partial
    )::text,
    true
  );
end;
$perf06_prod_snapshot$;`;
}

function finalQuery({ expectedHistorySha256, fingerprintSql }) {
  const baselinePartial = sqlString(JSON.stringify(BASELINE_PARTIAL_APPLICATION));
  const finalPartial = sqlString(JSON.stringify(FINAL_PARTIAL_APPLICATION));

  return `with
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
snapshot as (
  select pg_catalog.current_setting('perf06.prod_preflight_snapshot', false)::jsonb as value
),
fingerprint as (
${fingerprintSql}
),
overall as (
  select item_count, sha256 from fingerprint where category = 'OVERALL'
),
evaluation as (
  select
    case
      when runtime.current_user <> 'postgres'
        or runtime.session_user <> 'postgres'
        or runtime.read_only <> 'on'
        or runtime.isolation_level <> 'repeatable read'
      then 'BLOCKED_IDENTITY_OR_TRANSACTION'
      when overall.item_count = 377
        and overall.sha256 = ${sqlString(EXPECTED_FINAL_FINGERPRINT)}
        and snapshot.value -> 'partial_application' = ${finalPartial}::jsonb
        and coalesce((snapshot.value #>> '{history,exact_final}')::boolean, false) is true
        and coalesce((snapshot.value #>> '{lineage,pending}')::integer, -1) = 0
      then 'ALREADY_APPLIED'
      when overall.item_count = 346
        and overall.sha256 = ${sqlString(EXPECTED_BASELINE_FINGERPRINT)}
        and snapshot.value -> 'partial_application' = ${baselinePartial}::jsonb
        and coalesce((snapshot.value #>> '{history,present}')::boolean, true) is false
        and snapshot.value -> 'missing_relations' = '[]'::jsonb
        and coalesce((snapshot.value #>> '{lineage,invalid_auth_users}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,invalid_routines}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,cross_owner_source_conflicts}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,incompatible_lineages}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,markers}')::integer, -1) = 0
        and coalesce((snapshot.value #>> '{lineage,fixtures}')::integer, -1) = 0
      then 'PASS_READY_FOR_PROD_BUNDLE_DESIGN'
      else 'BLOCKED'
    end as verdict
  from runtime cross join snapshot cross join overall
)
select
  evaluation.verdict,
  ${sqlString(PROD_PROJECT_REF)}::text as expected_project_ref,
  true as visual_project_confirmation_required,
  runtime.current_user,
  runtime.session_user,
  runtime.isolation_level,
  runtime.read_only as transaction_read_only,
  runtime.server_version_num,
  runtime.database_name,
  runtime.tls_active,
  overall.item_count as fingerprint_items,
  overall.sha256 as fingerprint,
  snapshot.value -> 'history' as history,
  ${sqlString(expectedHistorySha256)}::text as expected_final_history_sha256,
  snapshot.value -> 'partial_application' as partial_application,
  snapshot.value -> 'missing_relations' as missing_relations,
  snapshot.value -> 'lineage' as lineage,
  snapshot.value -> 'diagnostic' as diagnostic,
  snapshot.value -> 'operational' as operational,
  snapshot.value -> 'data_counts' as data_counts,
  ${sqlString(EXPECTED_MANIFEST_SHA256)}::text as expected_manifest_sha256
from runtime cross join snapshot cross join overall cross join evaluation`;
}

export function buildProdPreflight(root = repositoryRoot) {
  invariant(resolve(root) === repositoryRoot, "PROD preflight must be built from the repository root");
  const { manifest, historicalCount, perfCount, hash } = buildManifest(repositoryRoot);
  invariant(manifest.length === 24 && historicalCount === 255 && perfCount === 81, "Manifest cardinality mismatch");
  invariant(hash === EXPECTED_MANIFEST_SHA256, "Manifest hash mismatch");

  const fingerprintStatements = splitAndTrim(
    readFileSync(resolve(repositoryRoot, "supabase/diagnostics/perf-06-schema-fingerprint.sql"), "utf8"),
  );
  invariant(fingerprintStatements.length === 1, "Fingerprint must contain one statement");

  const historySha256 = expectedHistoryDigest(manifest);
  const sql = [
    "-- ORGANIZATECH PERF-06 — PRODUCCIÓN — PREFLIGHT READ-ONLY",
    `-- DESTINO EXCLUSIVO: organizatech PROD (${PROD_PROJECT_REF}).`,
    "-- Confirma visualmente nombre y project ref antes de pulsar Run.",
    "-- No aplica migraciones, no crea objetos, no modifica datos y no usa service_role.",
    "-- Si el resultado no es PASS_READY_FOR_PROD_BUNDLE_DESIGN, detente y no reintentes.",
    "",
    "begin isolation level repeatable read read only;",
    "set local statement_timeout = '20s';",
    "set local lock_timeout = '3s';",
    "set local idle_in_transaction_session_timeout = '30s';",
    "set local application_name = 'organizatech-perf-06-prod-preflight-readonly';",
    dynamicSnapshotSql(historySha256),
    finalQuery({ expectedHistorySha256: historySha256, fingerprintSql: fingerprintStatements[0] }) + ";",
    "rollback;",
  ].join("\n\n") + "\n";

  return Object.freeze({
    sql,
    summary: Object.freeze({
      projectRef: PROD_PROJECT_REF,
      manifestSha256: EXPECTED_MANIFEST_SHA256,
      baselineFingerprint: EXPECTED_BASELINE_FINGERPRINT,
      finalFingerprint: EXPECTED_FINAL_FINGERPRINT,
      historySha256,
      preflightSha256: sha256(sql),
      migrations: manifest.length,
      statements: historicalCount + perfCount,
    }),
  });
}

export function writeProdPreflight(root = outputRoot) {
  const artifact = buildProdPreflight();
  mkdirSync(root, { recursive: true });
  writeFileSync(resolve(root, PROD_PREFLIGHT_FILE), artifact.sql);
  return artifact.summary;
}

export function verifyProdPreflight(root = outputRoot) {
  const artifact = buildProdPreflight();
  const path = resolve(root, PROD_PREFLIGHT_FILE);
  invariant(existsSync(path), `Missing PROD preflight: ${PROD_PREFLIGHT_FILE}`);
  invariant(readFileSync(path, "utf8") === artifact.sql, `${PROD_PREFLIGHT_FILE} is not deterministic`);
  return artifact.summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? "--verify";
  invariant(new Set(["--write", "--verify"]).has(action), "Usage: node scripts/perf-06-prod-preflight-bundle.mjs [--write|--verify]");
  const summary = action === "--write" ? writeProdPreflight() : verifyProdPreflight();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
