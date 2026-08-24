import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

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

const secReadinessQaRoot = "supabase/operations/qa/sec-readiness-01";
const secPrecheck = readFileSync(`${secReadinessQaRoot}/01_precheck_readonly.sql`, "utf8");
const secFunctional = readFileSync(`${secReadinessQaRoot}/02_functional_transaction.sql`, "utf8");
const secPostcheck = readFileSync(`${secReadinessQaRoot}/03_postcheck_readonly.sql`, "utf8");
const secReadme = readFileSync(`${secReadinessQaRoot}/README.md`, "utf8");
const secMigrationNames = readdirSync("supabase/migrations").filter((name) =>
  /_sec_readiness_01_bound_workout_readiness_writes\.sql$/i.test(name),
);
assert.equal(secMigrationNames.length, 1, "paquete QA referencia una unica migracion SEC-READINESS-01");
const secMigrationPath = `supabase/migrations/${secMigrationNames[0]}`;
const secMigration = readFileSync(secMigrationPath, "utf8");
const secMigrationSha256 = createHash("sha256").update(secMigration).digest("hex");

function assertSecFunctionalContract(source: string): void {
  const normalized = normalizeLineEndings(source);
  const executable = executableSql(source);
  const checkNames = Array.from(
    normalized.matchAll(
      /insert\s+into\s+pg_temp\.sec_readiness_01_results\s+values\s*\(\s*'([^']+)'\s*,\s*true\s*\)\s*;/gi,
    ),
    (match) => match[1],
  );
  assert.equal(checkNames.length, 41, "SEC functional fija exactamente 41 checks materiales");
  assert.equal(new Set(checkNames).size, 41, "SEC functional usa 41 nombres de check únicos");
  assert.match(executable.trimStart(), /^begin;/i, "SEC functional inicia transaccion");
  assert.match(executable.trimEnd(), /rollback;$/i, "SEC functional termina fisicamente en ROLLBACK");
  assert.doesNotMatch(executable, /^\s*commit\s*;/im, "SEC functional nunca ejecuta COMMIT");
  assert.doesNotMatch(executable, /\bexecute\b/i, "SEC functional no usa SQL dinamico");
  assert.match(executable, /set local role authenticated;/i, "SEC functional prueba rol authenticated real");
  assert.match(executable, /reset role;/i, "SEC functional restablece rol entre identidades");
  assert.match(normalized, /request\.jwt\.claim\.sub/i, "SEC functional configura auth.uid material");
  assert.match(normalized, /request\.jwt\.claim\.role/i, "SEC functional configura rol JWT material");
  assert.match(normalized, /structural_insert_guard_rejected_oversize/i, "SEC functional prueba defensa INSERT estructural");
  const multibytePayloads = Array.from(
    normalized.matchAll(
      /([a-z_][a-z_0-9]*)\s+jsonb\s*:=\s*pg_catalog\.jsonb_build_object\(\s*'skipped'\s*,\s*true\s*,\s*'padding'\s*,\s*pg_catalog\.repeat\(\s*'ñ'\s*,\s*600\s*\)\s*\)/gi,
    ),
    (match) => match[1],
  );
  assert.equal(multibytePayloads.length, 2, "SEC functional construye fixtures UTF-8 para trigger y RPC");
  const structuralMultibytePayload = multibytePayloads[0];
  const rpcMultibytePayload = multibytePayloads[1];
  assert.match(
    normalized,
    new RegExp(
      `pg_catalog\\.length\\(${structuralMultibytePayload}::pg_catalog\\.text\\)\\s*>=\\s*1024[\\s\\S]{0,120}pg_catalog\\.octet_length\\(${structuralMultibytePayload}::pg_catalog\\.text\\)\\s*<=\\s*1024`,
      "i",
    ),
    "SEC functional prueba que el límite UTF-8 discrimina caracteres de bytes",
  );
  assert.match(
    normalized,
    new RegExp(
      `${structuralMultibytePayload}\\s*\\)\\s*;\\s*raise exception using errcode = 'P0002', message = 'structural multibyte oversized payload accepted';[\\s\\S]{0,180}'structural_insert_guard_rejected_multibyte_oversize'`,
      "i",
    ),
    "SEC functional pasa el fixture multibyte por el trigger estructural",
  );
  assert.match(
    normalized,
    new RegExp(
      `v_context\\.session_created_at\\s*,\\s*${rpcMultibytePayload}\\s*\\)\\s*;\\s*raise exception using errcode = 'P0002', message = 'rpc multibyte oversized payload accepted';[\\s\\S]{0,180}'payload_multibyte_oversize_rejected'`,
      "i",
    ),
    "SEC functional pasa el fixture multibyte por el RPC",
  );
  for (const scenario of [
    "multibyte_payload_bytes_not_characters",
    "structural_insert_guard_rejected_multibyte_oversize",
    "payload_multibyte_oversize_rejected",
    "payload_non_object_rejected",
    "payload_missing_skipped_rejected",
    "payload_skipped_wrong_type_rejected",
    "payload_skipped_null_rejected",
    "payload_skipped_extra_rejected",
    "payload_full_extra_rejected",
    "payload_oversize_new_attempt_rejected",
    "payload_oversize_existing_attempt_rejected",
    "payload_sql_null_rejected",
    "payload_json_null_rejected",
    "payload_wrong_type_rejected",
    "payload_null_score_rejected",
    "payload_fraction_rejected",
    "payload_below_range_rejected",
    "payload_above_range_rejected",
    "payload_full_valid_preserved",
    "attempt_32_allowed",
    "attempt_33_rejected",
    "retry_at_quota_idempotent",
    "advisory_xact_lock_held",
    "per_user_lock_keys_distinct",
    "foreign_cycle_rejected",
    "inactive_cycle_rejected",
    "deleted_cycle_rejected",
    "foreign_day_rejected",
    "deleted_day_rejected",
    "user_a_cannot_see_user_b",
    "user_b_cannot_see_user_a",
    "direct_insert_denied",
    "direct_update_denied",
    "direct_delete_denied",
    "link_first_call_operational",
    "link_retry_idempotent",
    "legacy_count_unchanged",
    "training_sessions_unchanged",
    "exercise_entries_unchanged",
  ]) {
    assert.match(normalized, new RegExp(`['\"]${scenario}['\"]`, "i"), `SEC functional cubre ${scenario}`);
  }
  assert.match(normalized, /when sqlstate '54000'[\s\S]+attempt_33_rejected/i, "SEC functional exige SQLSTATE de cuota para attempt 33");
  assert.match(normalized, /if\s+[a-z_][a-z_0-9]*\s*<>\s*32\s+then/i, "SEC functional confirma frontera exacta 32");
  assert.match(normalized, /pg_catalog\.pg_locks/i, "SEC functional inspecciona advisory locks retenidos");
  assert.match(normalized, /count\(distinct \(lock\.classid, lock\.objid\)\)/i, "SEC functional distingue claves de lock A\/B");
  assert.match(normalized, /update public\.training_cycles[\s\S]+set status = 'completed'/i, "SEC functional simula ciclo inactivo dentro de rollback");
  assert.match(normalized, /update public\.training_cycles[\s\S]+set deleted_at = pg_catalog\.now\(\)/i, "SEC functional simula ciclo eliminado dentro de rollback");
  assert.match(normalized, /update public\.training_cycle_days[\s\S]+set deleted_at = pg_catalog\.now\(\)/i, "SEC functional simula dia eliminado dentro de rollback");
  assert.doesNotMatch(
    executable,
    /\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:table\s+)?(?:public\.)?(?:training_sessions|exercise_entries|training_daily_readiness|auth\.users)\b/i,
    "SEC functional no escribe tablas protegidas, legacy ni Auth",
  );
  assert.match(normalized, /SEC_READINESS_01_FUNCTIONAL_VERIFIED/i, "SEC functional emite veredicto limitado");
  assert.match(normalized, /jsonb_object_agg\(results\.check_name, results\.ok order by results\.check_name\)/i, "SEC functional agrega checks sin IDs ni payloads");
}

function assertSecPostcheckContract(source: string): void {
  assertReadOnlyScript("SEC postcheck", source);
  const normalized = normalizeLineEndings(source);
  assert.match(normalized, /acldefault\('f', target\.proowner\)/i, "postcheck usa ACL efectiva de funciones cuando proacl es NULL");
  assert.match(normalized, /acldefault\('r', target\.relowner\)/i, "postcheck usa ACL efectiva de tabla cuando relacl es NULL");
  assert.match(normalized, /owner_bypassrls/i, "postcheck verifica BYPASSRLS del owner");
  assert.match(normalized, /search_path=\"\"/i, "postcheck verifica search_path vacio real");
  assert.match(normalized, /structural_insert_guard_present/i, "postcheck verifica trigger estructural INSERT-only");
  assert.match(normalized, /rpc_payload_contract_real/i, "postcheck inspecciona definicion real de payload");
  assert.match(normalized, /rpc_quota_and_serialization_real/i, "postcheck inspecciona cuota y orden real");
  assert.match(normalized, /rpc_active_context_and_row_locks_real/i, "postcheck inspecciona contexto activo y row locks");
  assert.match(normalized, /SEC_READINESS_01_QA_VERIFIED/i, "postcheck emite veredicto SEC exacto");
}

assertReadOnlyScript("SEC precheck", secPrecheck);
assertNoHardcodedUuid("SEC precheck", secPrecheck);
assert.match(secPrecheck, /SEC_READINESS_01_QA_READY/i, "precheck emite readiness verdict");
assert.match(secPrecheck, /pre_migration_guard_absent/i, "precheck evita aplicacion parcial o repetida");
assert.match(secPrecheck, /two_distinct_material_candidates/i, "precheck exige usuarios A y B materiales");
assert.match(secPrecheck, /recent_attempts[\s\S]+< 32/i, "precheck exige headroom de cuota");
assert.match(secPrecheck, /historical_payloads_outside_new_contract/i, "precheck cuenta historia incompatible sin exponer payloads");
assert.match(secPrecheck, /acldefault\('f', target\.proowner\)/i, "precheck no oculta EXECUTE PUBLIC por proacl NULL");
assert.doesNotMatch(secPrecheck, /training_workout_readiness_(?:rows|empty)[^\n]*=\s*0/i, "precheck no exige tabla activa vacia");

assertSecFunctionalContract(secFunctional);
assertNoHardcodedUuid("SEC functional", secFunctional);
assertSecPostcheckContract(secPostcheck);
assertNoHardcodedUuid("SEC postcheck", secPostcheck);

const secSqlArtifacts = readdirSync(secReadinessQaRoot).filter((name) => name.endsWith(".sql")).sort();
assert.deepEqual(
  secSqlArtifacts,
  ["01_precheck_readonly.sql", "02_functional_transaction.sql", "03_postcheck_readonly.sql"],
  "paquete QA no duplica la migracion en un apply bundle divergente",
);
assert.match(secReadme, new RegExp(secMigrationNames[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "README identifica migracion exacta");
assert.match(secReadme, new RegExp(secMigrationSha256), "README fija SHA-256 exacto de migracion");
assert.match(secReadme, /Supabase CLI `2\.115\.0`/i, "README registra version CLI");
assert.match(secReadme, /QA primero|exclusivo de QA/i, "README exige QA primero");
assert.match(secReadme, /nunca Production|Never run in Production|nunca run in Production/i, "README prohibe Production en esta fase");
assert.match(secReadme, /auditor[ií]a independiente Claude/i, "README exige auditoria Claude");
assert.match(secReadme, /dos conexiones|two connections/i, "README declara prueba material de concurrencia pendiente");
assert.match(secReadme, /no puede ser simult[aá]nea[\s\S]+ROLLBACK/i, "README no finge rollback global multi-conexion");
assert.match(secReadme, /No usar `dblink`/i, "README evita dependencia dblink no inventariada");

assert.throws(
  () => assertReadOnlyScript("precheck mutado", secPrecheck.replace("begin transaction read only;", "begin;")),
  "mutation probe rechaza precheck read-write",
);
assert.throws(
  () => assertSecFunctionalContract(secFunctional.replace(/rollback;\s*$/i, "")),
  "mutation probe rechaza functional sin rollback terminal",
);
assert.throws(
  () => assertSecFunctionalContract(secFunctional.replace("when sqlstate '54000'", "when sqlstate 'P0001'")),
  "mutation probe rechaza cuota con SQLSTATE incorrecto",
);
assert.throws(
  () => assertSecFunctionalContract(secFunctional.replace(
    "or pg_catalog.octet_length(v_multibyte_payload::pg_catalog.text) <= 1024 then",
    "or pg_catalog.length(v_multibyte_payload::pg_catalog.text) <= 1024 then",
  )),
  /SEC functional prueba que el límite UTF-8 discrimina caracteres de bytes/,
  "mutation probe rechaza límite multibyte basado sólo en caracteres",
);
assert.throws(
  () => assertSecFunctionalContract(secFunctional.replace("'attempt_32_allowed'", "'attempt_32_missing'")),
  "mutation probe rechaza ausencia de frontera 32",
);
assert.throws(
  () => assertSecFunctionalContract(secFunctional.replace(
    "rollback;",
    "update public.training_sessions set deleted_at = deleted_at;\nrollback;",
  )),
  "mutation probe rechaza DML a training_sessions",
);
assert.throws(
  () => assertSecPostcheckContract(secPostcheck.replace(
    "pg_catalog.acldefault('f', target.proowner)",
    "'{}'::pg_catalog.aclitem[]",
  )),
  "mutation probe rechaza ACL NULL convertida en vacia",
);

const innocentPrecheck = `-- comentario inocente\n${secPrecheck.replace(/\n/g, "\n  ")}`;
assert.doesNotThrow(() => assertReadOnlyScript("precheck inocente", innocentPrecheck), "precheck tolera comentarios y formato");
const innocentFunctional = `-- comentario inocente\n${secFunctional
  .replaceAll("$payload_and_quota$", "$renamed_payload_probe$")
  .replaceAll("v_recent_count", "v_window_count")
  .replaceAll("v_multibyte_payload", "v_utf8_payload")
  .replace(/\n/g, "\n  ")}`;
assert.doesNotThrow(() => assertSecFunctionalContract(innocentFunctional), "functional tolera formato, dollar tag y renombres locales");

console.log("training-workout-readiness rpc QA operation tests passed");
