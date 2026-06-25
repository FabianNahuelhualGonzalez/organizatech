import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const precheck = readFileSync("supabase/operations/qa/release-b/d3/01_precheck_readonly.sql", "utf8");
const functional = readFileSync("supabase/operations/qa/release-b/d3/02_rpc_functional_transaction.sql", "utf8");
const postcheck = readFileSync("supabase/operations/qa/release-b/d3/03_postcheck_readonly.sql", "utf8");

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

function assertReadOnlyScript(name: string, source: string): void {
  const executable = executableSql(source);
  assert.match(executable.trimStart(), /^begin transaction read only;/i, `${name}: inicia read only`);
  assert.match(executable.trimEnd(), /rollback;$/i, `${name}: termina rollback`);
  assert.doesNotMatch(
    executable,
    /\b(insert|update|delete|truncate|alter|create|drop|grant|revoke|call|do|copy|merge|execute)\b/i,
    `${name}: sin instrucciones mutantes ejecutables`,
  );
}

function assertNoHardcodedUuid(name: string, source: string): void {
  assert.doesNotMatch(
    stripSqlComments(normalizeLineEndings(source)),
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    `${name}: sin UUIDs hardcodeados`,
  );
}

const precheckSql = normalizeLineEndings(precheck);
const functionalSql = normalizeLineEndings(functional);
const postcheckSql = normalizeLineEndings(postcheck);
const executableFunctional = executableSql(functional);

assertReadOnlyScript("precheck D3", precheckSql);
assert.match(precheckSql, /candidate_recent_sessions/i, "precheck busca candidate_recent_sessions");
assert.match(precheckSql, /D3_QA_READY/i, "precheck emite D3_QA_READY");
assert.match(precheckSql, /training_workout_readiness_rows\s*=\s*0/i, "precheck exige tabla nueva vacia");
assert.match(precheckSql, /training_daily_readiness_present/i, "precheck exige tabla legacy presente");
assert.match(precheckSql, /legacy_save_rpc_present/i, "precheck exige RPC legacy presente");
assert.match(precheckSql, /legacy_training_daily_readiness_rows/i, "precheck reporta conteo legacy informativo");
assert.doesNotMatch(precheckSql, /legacy_training_daily_readiness_rows\s*=\s*(3|4)/i, "precheck no bloquea por conteo legacy fijo");
assert.match(precheckSql, /session\.created_at >= now\(\) - interval '35 hours'/i, "precheck exige sesion reciente 35h");
assertNoHardcodedUuid("precheck D3", precheckSql);
assert.match(precheckSql, /case when bool_and\(checks\.ok\) then 'D3_QA_READY' else 'D3_QA_NOT_READY' end as verdict,[\s\S]+jsonb_object_agg\(checks\.check_name, checks\.ok order by checks\.check_name\) as checks,[\s\S]+\(select to_jsonb\(counts\) from counts\) as counts[\s\S]+from checks;/i, "precheck salida final limitada a verdict/checks/counts");

assert.match(executableFunctional.trimStart(), /^begin;/i, "funcional inicia transaccion");
assert.match(executableFunctional.trimEnd(), /rollback;$/i, "funcional termina con rollback");
assert.match(functionalSql, /training_workout_readiness debe tener 0 filas/i, "funcional guarda tabla nueva 0");
assert.match(functionalSql, /v_legacy_rows_before/i, "funcional captura legacy_rows_before");
assert.match(functionalSql, /v_legacy_rows_after/i, "funcional captura legacy_rows_after");
assert.match(functionalSql, /v_legacy_rows_after <> v_legacy_rows_before/i, "funcional compara conteos legacy before\/after");
assert.doesNotMatch(functionalSql, /training_daily_readiness debe tener (3|4) filas/i, "funcional no exige conteo legacy fijo");
assert.match(functionalSql, /session\.created_at >= now\(\) - interval '35 hours'/i, "funcional selecciona sesion en ultimas 35 horas");
assert.match(functionalSql, /order by session\.created_at desc, session\.id/i, "funcional ordena candidato deterministamente");
assert.match(functionalSql, /gen_random_uuid\(\)::text/i, "funcional genera attempts con gen_random_uuid");
assert.equal((functionalSql.match(/gen_random_uuid\(\)::text/gi) ?? []).length, 2, "funcional genera dos attempts");
assert.match(functionalSql, /request\.jwt\.claim\.sub/i, "funcional configura request.jwt.claim.sub");
assert.match(functionalSql, /request\.jwt\.claim\.role/i, "funcional configura request.jwt.claim.role");
assert.match(executableFunctional, /set local role authenticated;/i, "funcional usa SET LOCAL ROLE authenticated");
assert.match(executableFunctional, /reset role;/i, "funcional usa RESET ROLE");
assert.match(functionalSql, /save_training_workout_readiness_v2/i, "funcional llama save v2");
assert.match(functionalSql, /link_training_workout_readiness_session_v2/i, "funcional llama link v2");
assert.match(functionalSql, /primer guardado/i, "funcional cubre primer guardado");
assert.match(functionalSql, /retry identico/i, "funcional cubre retry identico");
assert.match(functionalSql, /context_mismatch is not true/i, "funcional valida context_mismatch true con payload distinto");
assert.match(functionalSql, /payload original fue sobrescrito/i, "funcional protege payload original intacto");
assert.match(functionalSql, /'\{\"skipped\": true\}'::jsonb/i, "funcional cubre segundo attempt skipped true");
assert.match(functionalSql, /already_linked is not false/i, "funcional valida primer link already_linked false");
assert.match(functionalSql, /already_linked is not true/i, "funcional valida segundo link already_linked true");
assert.match(functionalSql, /legacy_rows_before/i, "funcional expone legacy_rows_before sin UUIDs");
assert.match(functionalSql, /legacy_rows_after/i, "funcional expone legacy_rows_after sin UUIDs");
assert.match(functionalSql, /temporary_training_workout_readiness_rows/i, "funcional expone filas temporales de readiness");
assert.match(functionalSql, /D3_RPC_FUNCTIONAL_VERIFIED/i, "funcional emite veredicto correcto");
assertNoHardcodedUuid("funcional D3", functionalSql);
assert.doesNotMatch(executableFunctional, /\bexecute\b/i, "funcional no usa SQL dinamico");
assert.doesNotMatch(
  executableFunctional,
  /\b(insert|update|delete|truncate)\b\s+(?:into\s+)?(?:public\.)?(training_sessions|exercise_entries|training_daily_readiness|training_workout_readiness)\b/i,
  "funcional no hace DML directo a tablas permanentes protegidas",
);

assertReadOnlyScript("postcheck D3", postcheckSql);
assert.match(postcheckSql, /training_workout_readiness_rows\s*=\s*0/i, "postcheck exige tabla nueva 0");
assert.match(postcheckSql, /training_daily_readiness_present/i, "postcheck exige tabla legacy presente");
assert.match(postcheckSql, /legacy_save_rpc_present/i, "postcheck exige RPC legacy presente");
assert.match(postcheckSql, /legacy_training_daily_readiness_rows/i, "postcheck reporta conteo legacy informativo");
assert.doesNotMatch(postcheckSql, /legacy_training_daily_readiness_rows\s*=\s*(3|4)/i, "postcheck no bloquea por conteo legacy fijo");
assert.match(postcheckSql, /D3_QA_ROLLBACK_VERIFIED/i, "postcheck emite D3_QA_ROLLBACK_VERIFIED");
assertNoHardcodedUuid("postcheck D3", postcheckSql);
assert.doesNotMatch(precheckSql + "\n" + functionalSql + "\n" + postcheckSql, /legacy[^\n;]*(=|<>|debe tener)\s*(3|4)\b/i, "script D3 no exige legacy 3 o 4");

console.log("training-workout-readiness rpc QA operation tests passed");