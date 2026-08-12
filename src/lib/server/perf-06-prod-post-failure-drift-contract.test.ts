import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error Native ESM helper.
import { splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error Native ESM generator.
import { OBSERVED_CANONICAL_FINGERPRINT, PROD_POST_FAILURE_DRIFT_FILE, buildProdPostFailureDriftDiagnostic } from "../../../scripts/perf-06-prod-post-failure-drift-bundle.mjs";
// @ts-expect-error Native ESM generator.
import { PROD_EXTRA_FUNCTION_DEFINITION_SHA256, PROD_EXTRA_FUNCTION_ITEM_SHA256, PROD_PROJECT_REF } from "../../../scripts/perf-06-prod-sql-editor-rollback-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/production/perf-06";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const expectedSha256 = "61a9d53be05fb1911db5df2472b9e9db37750c1a22b81a27121b926477339f17";
const expectedCategories = {
  relation: [12, "27f39c8229b08c387618b3c239f67e7f21665855eefda34d5ef2a9ca4428deaa"],
  column: [140, "69898daeb45e1089b14321e2213118cdf467497537f57e85aa11237563e463b5"],
  constraint: [87, "f2a6754c268c5daf0d2928191776274ff5bdbaef261f1e6f117483071f099248"],
  index: [48, "22e08687bf2c4d90d1b6b14581f8eb4da195347501c4c5cd119fab4d2170c4b8"],
  policy: [26, "bd7c900256bb787b4b38875a7b002737cedc7261c7dc03cfef3426a1cc588cdf"],
  function: [8, "892bea17c5e3850563128297ced60de517d353fffe624e1b48204435f550d62e"],
  trigger: [13, "a82172aeb6f41d125020c4af5d58f7843942231301f41fe8b834532f0195a2ca"],
  table_acl: [12, "25a6ff8df97e92bb63d29cc6f26083cb20522a3886069d76f3234ab5c6d57beb"],
} as const;

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

function assertDiagnostic(source: string): void {
  const semantic = stripSqlComments(source);
  const executable = maskSql(source);
  assert.doesNotMatch(source, /\$\{[A-Z0-9_]+\}/u, "sin placeholders sin resolver");
  assert.match(source, new RegExp(`DESTINO EXCLUSIVO: organizatech PROD \\(${PROD_PROJECT_REF}\\)`, "u"), "destino PROD exacto");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI PostgreSQL");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, "sin secretos");

  const statements = splitAndTrim(source) as string[];
  assert.deepEqual(statements.map(executableHead), ["begin", "set", "set", "set", "set", "with", "rollback"], "forma read-only exacta");
  assert.match(stripSqlComments(statements[0] ?? "").trim(), /^begin isolation level repeatable read read only$/iu, "transacción read-only");
  assert.equal(executableHead(statements.at(-1) ?? ""), "rollback", "termina con ROLLBACK");
  assert.doesNotMatch(executable, /\bcommit\s*;/iu, "cero COMMIT");
  assert.doesNotMatch(executable, /\block\s+table\b|\bfor\s+(?:update|share)\b/iu, "cero locks");
  assert.doesNotMatch(executable, /\b(?:insert\s+into|update\s+|delete\s+from|truncate\s+|merge\s+into)\b/iu, "cero DML");
  assert.doesNotMatch(executable, /\b(?:create|alter|drop|reindex|vacuum|analyze)\s+(?:table|schema|function|trigger|event|index|policy|role|extension)\b/iu, "cero DDL");
  assert.doesNotMatch(executable, /\bexecute\s+/iu, "sin SQL dinámico");

  assert.equal(occurrences(source, "'PASS_POST_FAILURE_DRIFT_CAPTURED'"), 1, "PASS aparece una vez");
  assert.match(semantic, /else 'PASS_POST_FAILURE_DRIFT_CAPTURED'\s+end as verdict/u, "PASS depende del CASE completo");
  assert.match(semantic, new RegExp(`overall\\.item_count <> 346[\\s\\S]+overall\\.sha256 <> '${OBSERVED_CANONICAL_FINGERPRINT}'`, "u"), "fotografía observada exacta");
  assert.match(semantic, /when not prod_guard\.valid/u, "guard PROD exigido");
  assert.match(semantic, new RegExp(`prod_guard\\.function_item_sha256 <> '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'`, "u"), "hash de objeto extra exigido");
  assert.match(semantic, new RegExp(`prod_guard\\.definition_sha256 <> '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'`, "u"), "hash de definición exigido");
  assert.match(semantic, /diagnostic_count\.diagnostic_count <> 3/u, "tres diagnósticos exigidos");
  assert.match(semantic, /diagnostic_count\.diagnostic_executed_count <> 3/u, "tres ejecutados exigidos");

  for (const condition of [
    "not partial_application.history_absent",
    "not partial_application.identity_function_absent",
    "not partial_application.invariant_function_absent",
    "not partial_application.lineage_function_absent",
    "not partial_application.perf_index_absent",
    "not partial_application.perf_triggers_absent",
  ]) {
    assert.equal(occurrences(semantic, condition), 1, `estado parcial bloqueado: ${condition}`);
  }

  for (const [category, [count, hash]] of Object.entries(expectedCategories)) {
    assert.match(source, new RegExp(`\\('${category}'::text, ${count}::bigint, '${hash}'::text\\)`, "u"), `${category}: checkpoint canónico exacto`);
  }
  assert.match(source, /\('column_acl'::text, 0::bigint, null::text\)/u, "column_acl cero sin hash inventado");
  assert.match(semantic, /actual\.sha256 is distinct from expected\.expected_sha256 as differs/u, "drift incluye diferencias de hash con conteo igual");
  assert.match(semantic, /join drift_categories using \(category\)/u, "objetos limitados a categorías divergentes");
  assert.match(semantic, /pg_catalog\.split_part\(manifest\.line/u, "object_key derivada con allowlist");
  assert.doesNotMatch(semantic, /manifest\.line\s+as\s+(?:detail|definition|acl)/iu, "no expone líneas canónicas completas");
  assert.match(semantic, /pg_catalog\.sha256\(pg_catalog\.convert_to\(manifest\.category \|\| '\|' \|\| manifest\.line, 'UTF8'\)\)/u, "objetos devueltos sólo como SHA-256");
  assert.match(semantic, /pg_catalog\.encode\([\s\S]*?manifest\.category \|\| '\|' \|\| manifest\.line[\s\S]*?\),\s+null\s+from manifest\s+join drift_categories/u, "detalle de objeto permanece NULL después del hash");
}

const generated = buildProdPostFailureDriftDiagnostic(root);
const diagnostic = readFileSync(join(root, operationDirectory, PROD_POST_FAILURE_DRIFT_FILE), "utf8");
assert.equal(diagnostic, generated.sql, "artefacto determinista");
assert.equal(sha256(diagnostic), expectedSha256, "SHA-256 aprobado");
assertDiagnostic(diagnostic);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "ref QA", mutate: (source) => source.replaceAll(PROD_PROJECT_REF, qaProjectRef) },
  { name: "read-write", mutate: (source) => source.replace("repeatable read read only", "repeatable read read write") },
  { name: "COMMIT", mutate: (source) => source.replace("\nrollback;\n", "\ncommit;\n") },
  { name: "DML", mutate: (source) => source.replace("rollback;", "delete from public.exercises where false;\nrollback;") },
  { name: "snapshot permisivo", mutate: (source) => source.replace(`overall.sha256 <> '${OBSERVED_CANONICAL_FINGERPRINT}'`, "overall.sha256 is null") },
  { name: "guard omitido", mutate: (source) => source.replace("when not prod_guard.valid", "when false /* not prod_guard.valid */") },
  { name: "diagnóstico permisivo", mutate: (source) => source.replace("diagnostic_count.diagnostic_count <> 3", "diagnostic_count.diagnostic_count < 0") },
  { name: "historial tolerado", mutate: (source) => source.replace("not partial_application.history_absent", "false /* not partial_application.history_absent */") },
  { name: "function hash cambiado", mutate: (source) => source.replace(expectedCategories.function[1], "0".repeat(64)) },
  { name: "table ACL hash cambiado", mutate: (source) => source.replace(expectedCategories.table_acl[1], "0".repeat(64)) },
  { name: "sólo compara conteos", mutate: (source) => source.replace("or actual.sha256 is distinct from expected.expected_sha256 as differs", "as differs") },
  { name: "expone línea completa", mutate: (source) => source.replace("null\n  from manifest", "manifest.line\n  from manifest") },
  { name: "objetos de todas las categorías", mutate: (source) => source.replace("join drift_categories using (category)", "left join drift_categories using (category)") },
  { name: "PASS hardcodeado", mutate: (source) => source.replace(/case\n[\s\S]*?else 'PASS_POST_FAILURE_DRIFT_CAPTURED'\s+end as verdict/u, "'PASS_POST_FAILURE_DRIFT_CAPTURED' as verdict") },
  { name: "placeholder", mutate: (source) => source.replace(PROD_EXTRA_FUNCTION_ITEM_SHA256, "${PROD_EXTRA_FUNCTION_ITEM_SHA256}") },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(diagnostic);
  assert.notEqual(mutated, diagnostic, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertDiagnostic(mutated), `${mutation.name}: mutación eliminada`);
}

console.log(`PERF-06 PROD post-failure drift contract passed; ${mutations.length} mutation probes killed`);
