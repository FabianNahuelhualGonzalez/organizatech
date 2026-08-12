import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error Native ESM helper.
import { splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error Native ESM generator.
import { OBSERVED_CANONICAL_FINGERPRINT, OBSERVED_FUNCTION_FINGERPRINT, OBSERVED_TABLE_ACL_FINGERPRINT, PROD_ACL_FUNCTION_CLASSIFICATION_FILE, buildProdAclFunctionClassification } from "../../../scripts/perf-06-prod-acl-function-classification-bundle.mjs";
// @ts-expect-error Native ESM generator.
import { PROD_EXTRA_FUNCTION_DEFINITION_SHA256, PROD_EXTRA_FUNCTION_ITEM_SHA256, PROD_PROJECT_REF } from "../../../scripts/perf-06-prod-sql-editor-rollback-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/production/perf-06";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const expectedSha256 = "4e250e1fa46c50a40e36ef2b6eaec8dbaad9f0cc286a1c4ea4c72cf4cabbe357";

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function stripSqlComments(source: string): string {
  return source
    .replace(/--[^\n]*(?=\n|$)/gu, (match) => " ".repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => " ".repeat(match.length));
}

function maskSql(source: string): string {
  return stripSqlComments(source)
    .replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, (match) => " ".repeat(match.length))
    .replace(/'(?:''|[^'])*'/gu, (match) => " ".repeat(match.length));
}

function executableHead(statement: string): string {
  return stripSqlComments(statement).trimStart().toLowerCase().split(/\s+/u)[0] ?? "";
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function assertClassification(source: string): void {
  const semantic = stripSqlComments(source);
  const executable = maskSql(source);
  const statements = splitAndTrim(source) as string[];

  assert.doesNotMatch(source, /\$\{[A-Z0-9_]+\}/u, "sin placeholders");
  assert.match(source, new RegExp(`DESTINO EXCLUSIVO: organizatech PROD \\(${PROD_PROJECT_REF}\\)`, "u"), "destino PROD exacto");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|service_role_key)\s*=/iu, "sin secretos");
  assert.deepEqual(statements.map(executableHead), ["begin", "set", "set", "set", "set", "with", "rollback"], "forma read-only exacta");
  assert.match(stripSqlComments(statements[0] ?? "").trim(), /^begin isolation level repeatable read read only$/iu, "REPEATABLE READ READ ONLY");
  assert.doesNotMatch(executable, /\bcommit\s*;/iu, "cero COMMIT");
  assert.doesNotMatch(executable, /\block\s+table\b|\bfor\s+(?:update|share)\b/iu, "cero locks");
  assert.doesNotMatch(executable, /\b(?:insert\s+into|update\s+|delete\s+from|truncate\s+|merge\s+into)\b/iu, "cero DML");
  assert.doesNotMatch(executable, /\b(?:create|alter|drop|reindex|vacuum|analyze)\s+(?:table|schema|function|trigger|event|index|policy|role|extension)\b/iu, "cero DDL");
  assert.doesNotMatch(executable, /\bexecute\s+/iu, "sin SQL dinámico");

  assert.equal(occurrences(source, "'PASS_ACL_FUNCTION_CLASSIFICATION_CAPTURED'"), 1, "PASS único");
  assert.match(semantic, /else 'PASS_ACL_FUNCTION_CLASSIFICATION_CAPTURED'\s+end as verdict/u, "PASS depende del CASE");
  assert.match(semantic, new RegExp(`overall\\.sha256 <> '${OBSERVED_CANONICAL_FINGERPRINT}'`, "u"), "snapshot general fijado");
  assert.match(semantic, new RegExp(`category = 'function'\\) <> '${OBSERVED_FUNCTION_FINGERPRINT}'`, "u"), "snapshot function fijado");
  assert.match(semantic, new RegExp(`category = 'table_acl'\\) <> '${OBSERVED_TABLE_ACL_FINGERPRINT}'`, "u"), "snapshot table_acl fijado");
  assert.match(semantic, /when not prod_guard\.valid/u, "guard PROD exigido");
  assert.match(semantic, new RegExp(`prod_guard\\.function_item_sha256 <> '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'`, "u"), "guard de función extra");
  assert.match(semantic, new RegExp(`prod_guard\\.definition_sha256 <> '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'`, "u"), "guard de definición extra");
  assert.match(semantic, /diagnostic_count\.diagnostic_count <> 3[\s\S]+diagnostic_count\.diagnostic_executed_count <> 3/u, "diagnóstico preservado");
  assert.match(semantic, /not partial_application\.history_absent/u, "historial parcial bloqueado");
  assert.match(semantic, /when \(select count\(\*\) from function_details\) <> 8[\s\S]+table_acl_details\) <> 12/u, "cardinalidades exactas");
  assert.equal(occurrences(semantic, "pg_catalog.aclexplode"), 2, "ACL directos expandidos exactamente dos veces");
  assert.match(semantic, /pg_catalog\.aclexplode\(procedure\.proacl\)/u, "ACL nulo de funciones no se convierte en arreglo adimensional");
  assert.match(semantic, /pg_catalog\.aclexplode\(target\.relacl\)/u, "ACL nulo de tablas no se convierte en arreglo adimensional");
  assert.doesNotMatch(semantic, /aclexplode\(coalesce\(/u, "aclexplode nunca recibe un arreglo vacío adimensional");
  assert.match(semantic, /procedure\.proname = 'rls_auto_enable'[\s\S]+pg_get_function_identity_arguments\(procedure\.oid\) = ''/u, "función PROD extra excluida de las ocho canónicas");
  assert.equal(occurrences(semantic, "procedure.proname = 'rls_auto_enable'"), 3, "función PROD extra tratada exactamente en fingerprint, guard y clasificación");
  assert.match(semantic, /pg_catalog\.sha256\([\s\S]+pg_catalog\.pg_get_functiondef\(procedure\.oid\)[\s\S]+\) as definition_sha256/u, "definición sólo como SHA-256");
  assert.doesNotMatch(semantic, /pg_get_functiondef\(procedure\.oid\)\s+as\s+(?:definition|body|detail)/iu, "no expone cuerpos");
  assert.doesNotMatch(semantic, /pg_get_functiondef\(pg_catalog\.to_regprocedure/iu, "no reconstruye cuerpos en la proyección final");
  assert.match(semantic, /'direct_acl'[\s\S]+jsonb_agg/u, "ACL se publica estructurado");
  assert.match(semantic, /select 2, 'OBJECT', 'function'[\s\S]+select 3, 'OBJECT', 'table_acl'/u, "sólo funciones y ACL de tablas");
}

const generated = buildProdAclFunctionClassification(root);
const classification = readFileSync(join(root, operationDirectory, PROD_ACL_FUNCTION_CLASSIFICATION_FILE), "utf8");
assert.equal(classification, generated.sql, "artefacto determinista");
assert.equal(sha256(classification), expectedSha256, "SHA-256 aprobado");
assertClassification(classification);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "ref QA", mutate: (source) => source.replaceAll(PROD_PROJECT_REF, qaProjectRef) },
  { name: "read-write", mutate: (source) => source.replace("repeatable read read only", "repeatable read read write") },
  { name: "COMMIT", mutate: (source) => source.replace("\nrollback;\n", "\ncommit;\n") },
  { name: "DML", mutate: (source) => source.replace("rollback;", "delete from public.exercises where false;\nrollback;") },
  { name: "snapshot general permisivo", mutate: (source) => source.replace(`overall.sha256 <> '${OBSERVED_CANONICAL_FINGERPRINT}'`, "overall.sha256 is null") },
  { name: "snapshot function cambiado", mutate: (source) => source.replace(OBSERVED_FUNCTION_FINGERPRINT, "0".repeat(64)) },
  { name: "snapshot ACL cambiado", mutate: (source) => source.replace(OBSERVED_TABLE_ACL_FINGERPRINT, "0".repeat(64)) },
  { name: "guard omitido", mutate: (source) => source.replace("when not prod_guard.valid", "when false /* not prod_guard.valid */") },
  { name: "historial tolerado", mutate: (source) => source.replace("not partial_application.history_absent", "false /* not partial_application.history_absent */") },
  { name: "función extra incluida", mutate: (source) => source.replace("and not (\n      procedure.proname = 'rls_auto_enable'", "and not (\n      procedure.proname = 'otra_funcion'") },
  { name: "cuerpo expuesto", mutate: (source) => source.replace("report.definition_sha256,", "pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(report.object_key)) as definition,") },
  { name: "ACL de función omitido", mutate: (source) => source.replace("pg_catalog.aclexplode(procedure.proacl)", "pg_catalog.aclexplode(null::pg_catalog.aclitem[])") },
  { name: "ACL vacío adimensional", mutate: (source) => source.replace("pg_catalog.aclexplode(target.relacl)", "pg_catalog.aclexplode(coalesce(target.relacl, '{}'::pg_catalog.aclitem[]))") },
  { name: "cardinalidad function permisiva", mutate: (source) => source.replace("function_details) <> 8", "function_details) < 0") },
  { name: "PASS hardcodeado", mutate: (source) => source.replace(/case\n[\s\S]*?else 'PASS_ACL_FUNCTION_CLASSIFICATION_CAPTURED'\s+end as verdict/u, "'PASS_ACL_FUNCTION_CLASSIFICATION_CAPTURED' as verdict") },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(classification);
  assert.notEqual(mutated, classification, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertClassification(mutated), `${mutation.name}: mutación eliminada`);
}

console.log(`PERF-06 PROD ACL/function classification contract passed; ${mutations.length} mutation probes killed`);
