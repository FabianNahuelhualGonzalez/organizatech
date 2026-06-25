import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = readFileSync("package.json", "utf8");
const migration = readFileSync("supabase/migrations/20260620_training_workout_readiness.sql", "utf8");
const precheck = readFileSync("supabase/operations/production/release-b/01_precheck_readonly.sql", "utf8");
const apply = readFileSync("supabase/operations/production/release-b/02_apply_training_workout_readiness_v2.sql", "utf8");
const postcheck = readFileSync("supabase/operations/production/release-b/03_postcheck_readonly.sql", "utf8");
const rollback = readFileSync("supabase/operations/production/release-b/04_emergency_rollback.sql", "utf8");
const serviceRoleAcl = readFileSync("supabase/operations/production/release-b/05_service_role_acl_postcheck_readonly.sql", "utf8");
const readme = readFileSync("supabase/operations/production/release-b/README.md", "utf8");

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function stripSqlComments(value: string): string {
  return value
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripSqlStringLiterals(value: string): string {
  return value.replace(/'(?:''|[^'])*'/g, "''");
}

function executableSql(value: string): string {
  return stripSqlStringLiterals(stripSqlComments(normalizeLineEndings(value)));
}

function assertNoHardcodedUuids(label: string, value: string): void {
  assert.doesNotMatch(
    stripSqlComments(value),
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    `${label} no contiene UUIDs hardcodeados`,
  );
}

const normalizedMigration = normalizeLineEndings(migration).trim();
const normalizedApply = normalizeLineEndings(apply);
const precheckExecutable = executableSql(precheck);
const postcheckExecutable = executableSql(postcheck);
const rollbackExecutable = executableSql(rollback);
const applyExecutable = executableSql(apply);
const serviceRoleAclExecutable = executableSql(serviceRoleAcl);
const forbiddenReadOnlyOperations = /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|call|do|copy|merge|execute)\b/i;
const productionTestPath = "src/lib/training/training-workout-readiness-production-operations.test.ts";
const productionTestOccurrences = packageJson.match(new RegExp(productionTestPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [];

assert.equal(productionTestOccurrences.length, 1, "package.json incluye el test Production exactamente una vez");

assert.match(precheckExecutable.trimStart(), /^begin transaction read only;/i, "precheck inicia transaccion read only");
assert.match(precheckExecutable.trimEnd(), /rollback;$/i, "precheck termina con rollback");
assert.doesNotMatch(precheckExecutable, forbiddenReadOnlyOperations, "precheck no contiene instrucciones mutantes");
assert.match(precheck, /PROD_READINESS_V2_READY/i, "precheck incluye veredicto READY");
assert.match(precheck, /PROD_READINESS_V2_ALREADY_PRESENT/i, "precheck incluye veredicto ALREADY_PRESENT");
assert.match(precheck, /PROD_READINESS_V2_BLOCKED/i, "precheck incluye veredicto BLOCKED");
assert.match(precheck, /legacy_table_present/i, "precheck revisa tabla legacy");
assert.match(precheck, /legacy_save_rpc_single_signature/i, "precheck revisa RPC legacy");
assert.match(precheck, /legacy_cycle_day_id_absent/i, "precheck revisa ausencia de cycle_day_id legacy");
assert.match(precheck, /legacy_user_local_date_unique_present/i, "precheck revisa unique legacy");
assert.match(precheck, /legacy_no_user_local_date_duplicates/i, "precheck revisa duplicados legacy");
assert.match(precheck, /base_columns_present/i, "precheck revisa columnas base");
assert.match(precheck, /base_constraints_for_v2_fks_present/i, "precheck revisa constraints base para FKs");
assert.match(precheck, /gen_random_uuid_available/i, "precheck revisa gen_random_uuid");
assert.match(precheck, /set_updated_at_available/i, "precheck revisa set_updated_at");
assert.match(precheck, /america_santiago_timezone_valid/i, "precheck revisa timezone America/Santiago");
assert.match(precheck, /v2_not_partial_or_incompatible/i, "precheck detecta instalacion parcial");
assert.match(precheck, /jsonb_object_agg\(checks\.check_name, checks\.ok order by checks\.check_name\) as checks/i, "precheck devuelve checks JSON");
assert.match(precheck, /\(select to_jsonb\(counts\) from counts\) as counts/i, "precheck devuelve counts JSON");
assert.doesNotMatch(precheckExecutable, /from\s+auth\.users/i, "precheck no consulta auth.users");
assert.doesNotMatch(precheckExecutable, /raw_user_meta_data|email/i, "precheck no expone emails ni metadata personal");
assert.doesNotMatch(precheckExecutable, /select\s+[^;]*payload[^;]*from\s+public\./i, "precheck no selecciona payloads desde tablas publicas");

assert.match(normalizedApply, /Project ref: lzycxltqbrtsnwfdotqw/i, "apply identifica Production");
assert.match(applyExecutable.trimStart(), /^begin;/i, "apply inicia transaccion");
assert.match(applyExecutable.trimEnd(), /commit;$/i, "apply termina con commit");
assert.ok(normalizedApply.includes(normalizedMigration), "apply contiene el cuerpo exacto de la migracion 20260620");
assert.match(apply, /on conflict on constraint training_workout_readiness_user_attempt_key/i, "apply conserva ON CONFLICT ON CONSTRAINT");
assert.doesNotMatch(apply, /on conflict\s*\(\s*user_id\s*,\s*workout_attempt_id\s*\)/i, "apply no reintroduce target ambiguo");
assert.match(apply, /create table if not exists public\.training_workout_readiness/i, "apply crea tabla v2");
assert.match(apply, /create or replace function public\.save_training_workout_readiness_v2/i, "apply crea RPC save v2");
assert.match(apply, /create or replace function public\.link_training_workout_readiness_session_v2/i, "apply crea RPC link v2");
assert.match(apply, /security definer/i, "apply conserva SECURITY DEFINER");
assert.match(apply, /set search_path = public, pg_temp/i, "apply conserva search_path");
assert.doesNotMatch(applyExecutable, /\b(insert|update|delete)\s+public\.training_daily_readiness\b/i, "apply no muta readiness legacy directamente");
assert.doesNotMatch(applyExecutable, /\b(insert|update|delete)\s+public\.training_sessions\b/i, "apply no muta training_sessions directamente");
assert.doesNotMatch(applyExecutable, /\b(insert|update|delete)\s+public\.exercise_entries\b/i, "apply no muta exercise_entries directamente");

assert.match(postcheckExecutable.trimStart(), /^begin transaction read only;/i, "postcheck inicia transaccion read only");
assert.match(postcheckExecutable.trimEnd(), /rollback;$/i, "postcheck termina con rollback");
assert.doesNotMatch(postcheckExecutable, forbiddenReadOnlyOperations, "postcheck no contiene instrucciones mutantes");
assert.match(postcheck, /PROD_READINESS_V2_VERIFIED/i, "postcheck incluye veredicto verificado");
assert.match(postcheck, /PROD_READINESS_V2_POSTCHECK_FAILED/i, "postcheck incluye veredicto fallido");
assert.match(postcheck, /\('local_date', 'date', false\)/i, "postcheck exige local_date date not null");
assert.match(postcheck, /count\(\*\) = 11 as expected_column_count/i, "postcheck exige las 11 columnas reales");
assert.match(postcheck, /training_workout_readiness_session_key/i, "postcheck valida indice parcial de sesion");
assert.match(postcheck, /indisunique/i, "postcheck exige indice parcial UNIQUE");
assert.match(postcheck, /training_session_id is not null/i, "postcheck valida predicado parcial de sesion");
assert.match(postcheck, /training_workout_readiness_user_created_idx/i, "postcheck valida indice user_created");
assert.match(postcheck, /training_workout_readiness_cycle_day_created_idx/i, "postcheck valida indice cycle_day_created");
assert.match(postcheck, /array\['user_id'\]::text\[\]/i, "postcheck valida FK user_id origen");
assert.match(postcheck, /array\['cycle_id','user_id'\]::text\[\]/i, "postcheck valida FK cycle origen ordenada");
assert.match(postcheck, /array\['id','user_id'\]::text\[\]/i, "postcheck valida FK cycle destino ordenada");
assert.match(postcheck, /array\['cycle_day_id','cycle_id'\]::text\[\]/i, "postcheck valida FK cycle_day origen ordenada");
assert.match(postcheck, /array\['id','cycle_id'\]::text\[\]/i, "postcheck valida FK cycle_day destino ordenada");
assert.match(postcheck, /array\['training_session_id'\]::text\[\]/i, "postcheck valida FK training_session origen");
assert.match(postcheck, /array_agg\(att\.attname::text order by ord\.n\)/i, "postcheck usa casts attname::text");
assert.match(postcheck, /\(t\.tgtype & 1\) = 1/i, "postcheck valida trigger FOR EACH ROW");
assert.match(postcheck, /\(t\.tgtype & 2\) = 2/i, "postcheck valida trigger BEFORE");
assert.match(postcheck, /\(t\.tgtype & 16\) = 16/i, "postcheck valida trigger UPDATE");
assert.match(postcheck, /rls_enabled/i, "postcheck valida RLS");
assert.match(postcheck, /owner_select_policy_present/i, "postcheck valida policy");
assert.match(postcheck, /aclexplode/i, "postcheck usa aclexplode para ACL explicitas");
assert.match(postcheck, /service_role_table_explicit_acl_absent/i, "postcheck valida ACL explicita tabla service_role ausente");
assert.match(postcheck, /service_role_save_rpc_explicit_acl_absent/i, "postcheck valida ACL explicita save RPC service_role ausente");
assert.match(postcheck, /service_role_link_rpc_explicit_acl_absent/i, "postcheck valida ACL explicita link RPC service_role ausente");
assert.match(postcheck, /table_explicit_acl_rows/i, "postcheck reporta conteo ACL tabla");
assert.match(postcheck, /save_rpc_explicit_acl_rows/i, "postcheck reporta conteo ACL save RPC");
assert.match(postcheck, /link_rpc_explicit_acl_rows/i, "postcheck reporta conteo ACL link RPC");
assert.match(postcheck, /save_rpc_uses_named_conflict_constraint/i, "postcheck valida ON CONFLICT ON CONSTRAINT");
assert.match(postcheck, /save_rpc_no_ambiguous_conflict_target/i, "postcheck valida ausencia del target ambiguo");
assert.match(postcheck, /legacy_cycle_day_id_absent/i, "postcheck valida legacy intacto");
assert.match(postcheck, /jsonb_object_agg\(checks\.check_name, checks\.ok order by checks\.check_name\) as checks/i, "postcheck devuelve checks JSON");
assert.match(postcheck, /\(select to_jsonb\(counts\) from counts\) as counts/i, "postcheck devuelve counts JSON");
assert.doesNotMatch(postcheckExecutable, /from\s+auth\.users/i, "postcheck no consulta auth.users");
assert.doesNotMatch(postcheckExecutable, /raw_user_meta_data|email/i, "postcheck no expone emails ni metadata personal");
assert.doesNotMatch(postcheckExecutable, /select\s+[^;]*payload[^;]*from\s+public\./i, "postcheck no selecciona payloads desde tablas publicas");

assert.match(serviceRoleAclExecutable.trimStart(), /^begin transaction read only;/i, "script 05 inicia transaccion read only");
assert.match(serviceRoleAclExecutable.trimEnd(), /rollback;$/i, "script 05 termina con rollback");
assert.doesNotMatch(serviceRoleAclExecutable, forbiddenReadOnlyOperations, "script 05 no contiene instrucciones mutantes");
assert.match(serviceRoleAcl, /aclexplode/i, "script 05 usa aclexplode");
assert.match(serviceRoleAcl, /public\.training_workout_readiness/i, "script 05 revisa tabla v2");
assert.match(serviceRoleAcl, /save_training_workout_readiness_v2/i, "script 05 revisa save RPC v2");
assert.match(serviceRoleAcl, /link_training_workout_readiness_session_v2/i, "script 05 revisa link RPC v2");
assert.match(serviceRoleAcl, /PROD_SERVICE_ROLE_EXPLICIT_ACL_CLEAN/i, "script 05 incluye veredicto clean");
assert.match(serviceRoleAcl, /PROD_SERVICE_ROLE_EXPLICIT_ACL_FOUND/i, "script 05 incluye veredicto found");
assert.match(serviceRoleAcl, /table_explicit_acl_rows/i, "script 05 reporta ACL tabla");
assert.match(serviceRoleAcl, /save_rpc_explicit_acl_rows/i, "script 05 reporta ACL save RPC");
assert.match(serviceRoleAcl, /link_rpc_explicit_acl_rows/i, "script 05 reporta ACL link RPC");
assert.match(serviceRoleAcl, /jsonb_object_agg\(checks\.check_name, checks\.ok order by checks\.check_name\) as checks/i, "script 05 devuelve checks JSON");
assert.match(serviceRoleAcl, /\(select to_jsonb\(acl_counts\) from acl_counts\) as counts/i, "script 05 devuelve counts JSON");
assert.doesNotMatch(serviceRoleAclExecutable, /from\s+auth\.users/i, "script 05 no consulta auth.users");
assert.doesNotMatch(serviceRoleAclExecutable, /raw_user_meta_data|email|payload/i, "script 05 no expone datos personales ni payload");

assert.match(rollbackExecutable.trimStart(), /^begin;/i, "rollback inicia transaccion");
assert.match(rollbackExecutable.trimEnd(), /commit;$/i, "rollback termina con commit");
assert.match(rollback, /drop function if exists public\.link_training_workout_readiness_session_v2\(uuid, uuid\)/i, "rollback elimina solo RPC link v2");
assert.match(rollback, /drop function if exists public\.save_training_workout_readiness_v2\(uuid, uuid, uuid, timestamptz, jsonb\)/i, "rollback elimina solo RPC save v2");
assert.match(rollback, /drop table if exists public\.training_workout_readiness/i, "rollback elimina solo tabla v2");
assert.doesNotMatch(rollback, /cascade/i, "rollback no usa CASCADE");
assert.doesNotMatch(rollbackExecutable, /drop\s+(table|function)\s+(if\s+exists\s+)?public\.training_daily_readiness/i, "rollback no elimina legacy");
assert.doesNotMatch(rollbackExecutable, /drop\s+(table|function)\s+(if\s+exists\s+)?public\.save_daily_training_readiness/i, "rollback no elimina RPC legacy");
assert.doesNotMatch(rollbackExecutable, /training_sessions|exercise_entries/i, "rollback no toca sesiones ni entries");

assert.match(readme, /lzycxltqbrtsnwfdotqw/i, "README documenta proyecto Production");
assert.match(readme, /PROD_READINESS_V2_READY/i, "README registra precheck real");
assert.match(readme, /legacy rows = 19/i, "README registra filas legacy reales");
assert.match(readme, /duplicate groups = 0/i, "README registra duplicados reales");
assert.match(readme, /Success\. No rows returned/i, "README registra aplicacion real");
assert.match(readme, /PROD_READINESS_V2_VERIFIED/i, "README registra postcheck real");
assert.match(readme, /training_workout_readiness_rows = 0/i, "README registra filas v2 reales");
assert.match(readme, /PROD_SERVICE_ROLE_EXPLICIT_ACL_CLEAN/i, "README registra control ACL real");
assert.match(readme, /table ACL rows = 0/i, "README registra ACL tabla real");
assert.match(readme, /save RPC ACL rows = 0/i, "README registra ACL save RPC real");
assert.match(readme, /link RPC ACL rows = 0/i, "README registra ACL link RPC real");
assert.match(readme, /frontend still remains on the legacy readiness flow/i, "README confirma frontend legacy");
assert.match(readme, /Do not re-run `02_apply_training_workout_readiness_v2\.sql`/i, "README prohibe reejecutar apply");
assert.match(readme, /Do not run `04_emergency_rollback\.sql` without explicit Architecture authorization/i, "README prohibe rollback sin autorizacion");
assert.match(readme, /next phase is a separate controlled frontend integration/i, "README documenta siguiente fase separada");

for (const [label, value] of [
  ["precheck", precheck],
  ["apply", apply],
  ["postcheck", postcheck],
  ["serviceRoleAcl", serviceRoleAcl],
  ["rollback", rollback],
  ["readme", readme],
] as const) {
  assertNoHardcodedUuids(label, value);
}

console.log("training-workout-readiness production operation tests passed");
