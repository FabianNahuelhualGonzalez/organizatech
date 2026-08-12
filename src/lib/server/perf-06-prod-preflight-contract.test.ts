import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error The audited manifest library is intentionally native ESM.
import { splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error The PROD preflight generator is intentionally native ESM.
import { PROD_PREFLIGHT_FILE, PROD_PROJECT_REF, buildProdPreflight } from "../../../scripts/perf-06-prod-preflight-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/production/perf-06";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const baselineFingerprint = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";
const finalFingerprint = "833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9";
const historySha256 = "3325f11a1cac1738b9aaa4adb389594d7dfb366b2a5978959ffb7210ffbe9756";
const preflightSha256 = "22007a2b6d9b82ee20779c348aba26319e38003029c90a9c7dd9a6cd18e37429";

function executableHead(statement: string): string {
  let source = statement.trimStart();
  while (true) {
    const lineComment = /^--[^\n]*(?:\n|$)/u.exec(source);
    if (lineComment) {
      source = source.slice(lineComment[0].length).trimStart();
      continue;
    }
    const blockComment = /^\/\*[\s\S]*?\*\//u.exec(source);
    if (blockComment) {
      source = source.slice(blockComment[0].length).trimStart();
      continue;
    }
    return source.toLowerCase();
  }
}

function maskSqlLiteralsAndComments(source: string): string {
  return source
    .replace(/--[^\n]*(?=\n|$)/gu, (match) => " ".repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => " ".repeat(match.length))
    .replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, (match) => " ".repeat(match.length))
    .replace(/'(?:''|[^'])*'/gu, (match) => " ".repeat(match.length));
}

function stripSqlComments(source: string): string {
  return source
    .replace(/--[^\n]*(?=\n|$)/gu, (match) => " ".repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => " ".repeat(match.length));
}

function normalizeExecutableSql(source: string): string {
  return stripSqlComments(source).replace(/\s+/gu, " ").trim().toLowerCase();
}

function extractDoBody(statement: string): string {
  const match = /^\s*do\s+\$([a-z0-9_]*)\$([\s\S]*)\$\1\$\s*$/iu.exec(statement);
  assert.ok(match, "DO usa un cuerpo dollar-quoted reconocible");
  return match[2];
}

function assertNoSecrets(source: string): void {
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI PostgreSQL");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, "sin secretos");
  assert.doesNotMatch(source, /^\\[^\n]+/mu, "sin metacomandos de cliente");
}

function assertReadOnlyPreflight(source: string): void {
  const statements = splitAndTrim(source) as string[];
  const heads = statements.map((statement) => executableHead(statement).split(/\s+/u)[0]);
  assert.deepEqual(heads, ["begin", "set", "set", "set", "set", "do", "with", "rollback"], "top-level estrictamente read-only");

  assert.equal(normalizeExecutableSql(statements[0]), "begin isolation level repeatable read read only", "transacción READ ONLY ejecutable exacta");
  const finalQuery = normalizeExecutableSql(statements[6]);
  assert.match(finalQuery, /\bcurrent_user::text as current_user,/u, "current_user usa sintaxis PostgreSQL válida");
  assert.match(finalQuery, /\bsession_user::text as session_user,/u, "session_user usa sintaxis PostgreSQL válida");
  assert.doesNotMatch(source, /pg_catalog\.(?:current_user|session_user)\b/iu, "identidad no usa calificación inválida");
  assert.equal(heads.filter((head) => head === "commit").length, 0, "cero COMMIT");
  assert.equal(heads.filter((head) => head === "rollback").length, 1, "ROLLBACK final único");
  assert.doesNotMatch(source, /\bpg_advisory_xact_lock\b/iu, "sin advisory lock");
  assert.doesNotMatch(source, /\block\s+table\b/iu, "sin locks explícitos");

  const doBody = extractDoBody(executableHead(statements[5]));
  const executableDoBody = maskSqlLiteralsAndComments(doBody);
  const normalizedDoBody = executableDoBody.replace(/\s+/gu, " ").trim().toLowerCase();
  assert.doesNotMatch(executableDoBody, /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|lock)\b/iu, "DO sin DDL/DML/locks ejecutables");
  assert.match(normalizedDoBody, /perform pg_catalog\.set_config\([\s\S]*, true\s*\); end;$/u, "snapshot usa set_config transaccional");

  const dynamicDollarQueries = [...source.matchAll(/\bexecute\s+\$([a-z0-9_]+)\$([\s\S]*?)\$\1\$/giu)];
  assert.equal(dynamicDollarQueries.length, 4, "cuatro consultas dinámicas allowlisted");
  for (const [, tag, query] of dynamicDollarQueries) {
    assert.match(query.trimStart(), /^(?:select|with)\b/iu, `${tag}: SQL dinámico sólo SELECT/CTE`);
    assert.doesNotMatch(maskSqlLiteralsAndComments(query), /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|lock)\b/iu, `${tag}: sin write dinámico`);
  }
  assert.match(source, /execute pg_catalog\.format\('select pg_catalog\.count\(\*\) from public\.%I'/u, "conteos dinámicos usan SELECT allowlisted");
  assert.equal((source.match(/\bexecute\b/giu) ?? []).length, 5, "no existen otros EXECUTE dinámicos");

  assert.match(source, new RegExp(PROD_PROJECT_REF, "u"), "ref PROD explícita");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.match(source, /visual_project_confirmation_required/u, "confirmación visual obligatoria");
  assert.match(finalQuery, /\) select evaluation\.verdict,/u, "la proyección publica exclusivamente el veredicto calculado");
  assert.match(finalQuery, /when runtime\.current_user <> 'postgres' or runtime\.session_user <> 'postgres' or runtime\.read_only <> 'on' or runtime\.isolation_level <> 'repeatable read' then 'blocked_identity_or_transaction'/u, "identidad/transacción fail-closed ejecutable");
  assert.match(finalQuery, new RegExp(`when overall\\.item_count = 377 and overall\\.sha256 = '${finalFingerprint}'`, "u"), "rama final exige fingerprint exacto");
  assert.match(finalQuery, new RegExp(`when overall\\.item_count = 346 and overall\\.sha256 = '${baselineFingerprint}'`, "u"), "rama baseline exige fingerprint exacto");
  assert.match(finalQuery, /then 'already_applied'/u, "estado ya aplicado calculado");
  assert.match(finalQuery, /then 'pass_ready_for_prod_bundle_design'/u, "veredicto positivo calculado");
  assert.equal((finalQuery.match(/then 'pass_ready_for_prod_bundle_design'/gu) ?? []).length, 1, "existe una única rama positiva");
  assert.match(finalQuery, /else 'blocked' end as verdict/u, "fallback bloqueante calculado");
  assert.doesNotMatch(finalQuery, /select 'pass_ready_for_prod_bundle_design'::text as verdict/u, "sin éxito hardcodeado en proyección");

  assert.match(source, new RegExp(baselineFingerprint, "u"), "fingerprint baseline fijado");
  assert.match(source, new RegExp(finalFingerprint, "u"), "fingerprint final fijado");
  assert.match(source, new RegExp(historySha256, "u"), "digest de historial fijado");
  assert.match(source, /history_absent/u, "ausencia de historial inventariada");
  assert.match(source, /history_shape_valid/u, "shape de historial validado antes de leer");
  assert.match(source, /missing_relations/u, "relaciones requeridas inventariadas");
  assert.match(source, /invalid_auth_users/u, "usuarios inválidos agregados");
  assert.match(source, /invalid_routines/u, "ownership de rutina agregado");
  assert.match(source, /cross_owner_source_conflicts/u, "conflictos cross-owner agregados");
  assert.match(source, /entry_references/u, "referencias entries agregadas");
  assert.match(source, /cycle_references/u, "referencias cycle agregadas");
  assert.match(source, /diagnostic/u, "diagnóstico preservado e inventariado");
  assert.match(source, /other_transactions_over_30s/u, "actividad operativa agregada");
  assert.match(source, /exercise_entries_total_bytes/u, "tamaño del índice/tabla agregado");
  assert.match(source, /data_counts/u, "conteos allowlisted reportados");

  assert.doesNotMatch(source, /\b(?:email|phone_number|display_name|avatar_path|access_token|refresh_token)\b/iu, "sin datos personales o tokens");
  assertNoSecrets(source);
}

const generated = buildProdPreflight(root);
const preflight = readFileSync(join(root, operationDirectory, PROD_PREFLIGHT_FILE), "utf8");

assert.equal(preflight, generated.sql, "preflight generado determinísticamente");
assert.equal(generated.summary.projectRef, PROD_PROJECT_REF, "summary fija PROD");
assert.equal(generated.summary.preflightSha256, preflightSha256, "SHA-256 aprobado");
assert.equal(generated.summary.historySha256, historySha256, "digest final de historial aprobado");
assert.equal(generated.summary.migrations, 24, "24 migraciones inventariadas");
assert.equal(generated.summary.statements, 336, "336 statements inventariados");
assertReadOnlyPreflight(preflight);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "READ WRITE", mutate: (source) => source.replace("repeatable read read only", "repeatable read read write") },
  { name: "COMMIT", mutate: (source) => source.replace("\nrollback;\n", "\ncommit;\n") },
  { name: "DML top-level", mutate: (source) => source.replace("\nrollback;\n", "\nupdate public.profiles set display_name = display_name;\nrollback;\n") },
  { name: "DDL dinámico", mutate: (source) => source.replace("select pg_catalog.count(*) from public.training_session_consolidation_audit", "delete from public.training_session_consolidation_audit") },
  { name: "ref QA", mutate: (source) => source.replaceAll(PROD_PROJECT_REF, qaProjectRef) },
  { name: "sin baseline", mutate: (source) => source.replaceAll(baselineFingerprint, "0".repeat(64)) },
  { name: "sin final", mutate: (source) => source.replaceAll(finalFingerprint, "1".repeat(64)) },
  { name: "sin historial exacto", mutate: (source) => source.replaceAll(historySha256, "2".repeat(64)) },
  { name: "sin ownership auth", mutate: (source) => source.replaceAll("invalid_auth_users", "ignored_auth_users") },
  { name: "sin ownership rutina", mutate: (source) => source.replaceAll("invalid_routines", "ignored_routines") },
  { name: "sin cross-owner", mutate: (source) => source.replaceAll("cross_owner_source_conflicts", "ignored_cross_owner_conflicts") },
  { name: "sin diagnóstico", mutate: (source) => source.replaceAll("diagnostic", "ignored_artifact") },
  { name: "sin confirmación visual", mutate: (source) => source.replaceAll("visual_project_confirmation_required", "project_is_assumed") },
  { name: "éxito hardcodeado", mutate: (source) => source.replace("case\n      when runtime.current_user", "case\n      when true then 'PASS_READY_FOR_PROD_BUNDLE_DESIGN'\n      when runtime.current_user") },
  { name: "current_user calificado inválido", mutate: (source) => source.replace("current_user::text as current_user", "pg_catalog.current_user::text as current_user") },
  { name: "DDL dentro del DO", mutate: (source) => source.replace("begin\n  select coalesce", "begin\n  create temp table zz as select 1;\n  select coalesce") },
  { name: "READ ONLY sólo en comentario", mutate: (source) => source.replace("begin isolation level repeatable read read only;", "-- begin isolation level repeatable read read only;\nbegin isolation level repeatable read;") },
  { name: "READ ONLY sólo en string", mutate: (source) => source.replace("begin isolation level repeatable read read only;", "begin isolation level repeatable read;\nset local application_name = 'begin isolation level repeatable read read only';") },
  { name: "PASS hardcodeado en proyección", mutate: (source) => source.replace("evaluation.verdict,", "'PASS_READY_FOR_PROD_BUNDLE_DESIGN'::text as verdict,") },
  { name: "identidad neutralizada", mutate: (source) => source.replace("when runtime.current_user <> 'postgres'", "when false /* runtime.current_user <> 'postgres' */") },
  { name: "fingerprint final puenteado", mutate: (source) => source.replace("when overall.item_count = 377", "when true or (overall.item_count = 377") .replace(`and overall.sha256 = '${finalFingerprint}'`, `and overall.sha256 = '${finalFingerprint}')`) },
  { name: "set_config fuera de transacción", mutate: (source) => source.replace("    true\n  );\nend;", "    false\n  );\nend;") },
  { name: "PASS retirado y conservado sólo en comentario", mutate: (source) => source.replace("then 'PASS_READY_FOR_PROD_BUNDLE_DESIGN'", "then 'BLOCKED' /* PASS_READY_FOR_PROD_BUNDLE_DESIGN */") },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(preflight);
  assert.notEqual(mutated, preflight, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertReadOnlyPreflight(mutated), `${mutation.name}: contrato la rechaza`);
}

const readme = readFileSync(join(root, operationDirectory, "README.md"), "utf8");
assert.match(readme, new RegExp(PROD_PROJECT_REF, "u"), "README fija PROD");
assert.match(readme, /READ-ONLY/u, "README declara read-only");
assert.match(readme, /no ejecutarlo todavía/iu, "README prohíbe ejecución antes de auditoría");
assert.match(readme, /PASS_READY_FOR_PROD_BUNDLE_DESIGN/u, "README documenta PASS esperado");
assert.match(readme, /no contiene autorización/iu, "README no autoriza apply");

process.stdout.write(`PERF-06 PROD preflight contract passed; ${mutations.length} mutation probes killed\n`);
