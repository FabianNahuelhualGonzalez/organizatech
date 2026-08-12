import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error The audited manifest helper is intentionally native ESM.
import { splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error The PROD diagnostic generator is intentionally native ESM.
import { PROD_POST_CAPTURE_FILE, PROD_POST_FAILURE_FILE, buildProdPostCaptureDiagnostic, buildProdPostFailureDiagnostic } from "../../../scripts/perf-06-prod-post-failure-diagnostic-bundle.mjs";
// @ts-expect-error The PROD rollback generator is intentionally native ESM.
import { PROD_BASELINE_FINGERPRINT, PROD_EXTRA_FUNCTION_DEFINITION_SHA256, PROD_EXTRA_FUNCTION_ITEM_SHA256, PROD_PROJECT_REF } from "../../../scripts/perf-06-prod-sql-editor-rollback-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/production/perf-06";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const expectedSha256 = "611e49f5ecdd3945d7018489b1c164e4f886216403cc16343b1e62ae0ee40906";
const expectedPostCaptureSha256 = "8315a130d93c5f22aa7d3d27a9fe12f4cd89ae60b345036d0bafea5acc24e18f";
const baselineFingerprint = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

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

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function maskSqlLiteralsAndComments(source: string): string {
  return stripSqlComments(source)
    .replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, (match) => " ".repeat(match.length))
    .replace(/'(?:''|[^'])*'/gu, (match) => " ".repeat(match.length));
}

function stripSqlComments(source: string): string {
  return source
    .replace(/--[^\n]*(?=\n|$)/gu, (match) => " ".repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => " ".repeat(match.length));
}

function assertDiagnostic(source: string, expectedVerdict = "PASS_POST_FAILURE_STATE_VERIFIED", expectedFingerprint = baselineFingerprint): void {
  const executable = maskSqlLiteralsAndComments(source);
  const semantic = stripSqlComments(source);
  assert.doesNotMatch(source, /\$\{[A-Z0-9_]+\}/u, "sin placeholders sin resolver");
  assert.match(source, new RegExp(`DESTINO EXCLUSIVO: organizatech PROD \\(${PROD_PROJECT_REF}\\)`, "u"), "destino PROD exacto");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI PostgreSQL");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, "sin secretos");
  assert.doesNotMatch(source, /^\\[^\n]+/mu, "sin metacomandos");

  const statements = splitAndTrim(source) as string[];
  const heads = statements.map((statement) => executableHead(statement).split(/\s+/u)[0]);
  assert.deepEqual(heads, ["begin", "set", "set", "set", "set", "with", "rollback"], "forma ejecutable exclusivamente read-only");
  assert.match(executableHead(statements[0] ?? ""), /^begin isolation level repeatable read read only$/u, "transacción REPEATABLE READ READ ONLY");
  assert.equal(executableHead(statements.at(-1) ?? ""), "rollback", "terminal ROLLBACK");
  assert.doesNotMatch(executable, /\bcommit\s*;/iu, "cero COMMIT");
  assert.doesNotMatch(executable, /\block\s+table\b/iu, "cero locks explícitos");
  assert.doesNotMatch(executable, /\b(?:insert\s+into|update\s+|delete\s+from|truncate\s+|merge\s+into)\b/iu, "cero DML");
  assert.doesNotMatch(executable, /\b(?:create|alter|drop|reindex|vacuum|analyze)\s+(?:table|schema|function|trigger|event|index|policy|role|extension)\b/iu, "cero DDL");
  assert.doesNotMatch(executable, /\bexecute\s+format\b|\bexecute\s+[^;]+/iu, "sin SQL dinámico");

  assert.equal(occurrences(source, `'${expectedVerdict}'`), 1, "PASS aparece una vez y sólo en CASE");
  assert.ok(source.includes(`case when valid then '${expectedVerdict}' else 'BLOCKED' end as verdict`), "PASS depende del estado completo");
  assert.match(semantic, /current_user = 'postgres'/u, "usuario postgres exigido");
  assert.match(semantic, /session_user = 'postgres'/u, "sesión postgres exigida");
  assert.match(semantic, /runtime\.isolation_level = 'repeatable read'/u, "aislamiento exigido");
  assert.match(semantic, /runtime\.read_only = 'on'/u, "read-only exigido");
  assert.match(semantic, /runtime\.server_version_num = 170006/u, "PostgreSQL 17.6 exigido");
  assert.match(semantic, /runtime\.database_name = 'postgres'/u, "base postgres exigida");
  assert.match(semantic, /and runtime\.tls_active/u, "TLS exigido");
  assert.match(semantic, new RegExp(`overall\\.item_count = 346[\\s\\S]+overall\\.sha256 = '${expectedFingerprint}'`, "u"), "baseline 346 exacto");
  assert.match(semantic, /and prod_guard\.valid/u, "guard PROD completo exigido");
  assert.match(semantic, new RegExp(`prod_guard\\.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'`, "u"), "hash del objeto extra exacto");
  assert.match(semantic, new RegExp(`prod_guard\\.definition_sha256 = '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'`, "u"), "hash de definición exacto");
  assert.match(semantic, /diagnostic_count\.diagnostic_count = 3/u, "tres registros diagnósticos exigidos");
  assert.match(semantic, /diagnostic_count\.diagnostic_executed_count = 3/u, "tres registros ejecutados exigidos");
  assert.match(semantic, /length\(coalesce\(diagnostic_hash\.diagnostic_hash, ''\)\) = 64/u, "hash diagnóstico exigido");

  for (const condition of [
    "partial_application.history_absent",
    "partial_application.identity_function_absent",
    "partial_application.invariant_function_absent",
    "partial_application.lineage_function_absent",
    "partial_application.perf_index_absent",
    "partial_application.perf_triggers_absent",
    "lineage.pending = 0",
    "lineage.markers = 0",
    "residual_sessions.session_count = 0",
    "residual_locks.lock_count = 0",
  ]) {
    assert.equal(occurrences(semantic, `and ${condition}`), 1, `gate exacto: ${condition}`);
  }
}

const generated = buildProdPostFailureDiagnostic(root);
const diagnostic = readFileSync(join(root, operationDirectory, PROD_POST_FAILURE_FILE), "utf8");

assert.equal(diagnostic, generated.sql, "diagnóstico generado determinísticamente");
assert.equal(sha256(diagnostic), expectedSha256, "SHA-256 aprobado");
assert.equal(generated.summary.projectRef, PROD_PROJECT_REF, "summary fija PROD");
assertDiagnostic(diagnostic);

const generatedPostCapture = buildProdPostCaptureDiagnostic(root);
const postCapture = readFileSync(join(root, operationDirectory, PROD_POST_CAPTURE_FILE), "utf8");
assert.equal(postCapture, generatedPostCapture.sql, "post-captura generado determinísticamente");
assert.equal(sha256(postCapture), expectedPostCaptureSha256, "SHA-256 post-captura aprobado");
assertDiagnostic(postCapture, "PASS_POST_CAPTURE_ROLLBACK_VERIFIED", PROD_BASELINE_FINGERPRINT);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "placeholder sin resolver", mutate: (source) => source.replace(PROD_EXTRA_FUNCTION_ITEM_SHA256, "${PROD_EXTRA_FUNCTION_ITEM_SHA256}") },
  { name: "ref QA", mutate: (source) => source.replaceAll(PROD_PROJECT_REF, qaProjectRef) },
  { name: "transacción read-write", mutate: (source) => source.replace("repeatable read read only", "repeatable read read write") },
  { name: "terminal COMMIT", mutate: (source) => source.replace("\nrollback;\n", "\ncommit;\n") },
  { name: "DML lateral", mutate: (source) => source.replace("rollback;", "delete from public.exercises where false;\n\nrollback;") },
  { name: "PASS hardcodeado", mutate: (source) => source.replace("case when valid then 'PASS_POST_FAILURE_STATE_VERIFIED' else 'BLOCKED' end", "'PASS_POST_FAILURE_STATE_VERIFIED'") },
  { name: "baseline final", mutate: (source) => source.replace("overall.item_count = 346", "overall.item_count = 377") },
  { name: "fingerprint permisivo", mutate: (source) => source.replace(`overall.sha256 = '${baselineFingerprint}'`, "overall.sha256 is not null") },
  { name: "guard PROD omitido", mutate: (source) => source.replace("and prod_guard.valid", "and true /* prod_guard.valid */") },
  { name: "hash extra omitido", mutate: (source) => source.replace(`prod_guard.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'`, "prod_guard.function_item_sha256 is not null") },
  { name: "diagnóstico reducido", mutate: (source) => source.replace("diagnostic_count.diagnostic_count = 3", "diagnostic_count.diagnostic_count >= 0") },
  { name: "ejecutados omitidos", mutate: (source) => source.replace("diagnostic_count.diagnostic_executed_count = 3", "diagnostic_count.diagnostic_executed_count >= 0") },
  { name: "historial tolerado", mutate: (source) => source.replace("and partial_application.history_absent", "and true /* partial_application.history_absent */") },
  { name: "función parcial tolerada", mutate: (source) => source.replace("and partial_application.invariant_function_absent", "and true /* partial_application.invariant_function_absent */") },
  { name: "índice parcial tolerado", mutate: (source) => source.replace("and partial_application.perf_index_absent", "and true /* partial_application.perf_index_absent */") },
  { name: "triggers parciales tolerados", mutate: (source) => source.replace("and partial_application.perf_triggers_absent", "and true /* partial_application.perf_triggers_absent */") },
  { name: "pendientes tolerados", mutate: (source) => source.replace("and lineage.pending = 0", "and lineage.pending >= 0") },
  { name: "markers tolerados", mutate: (source) => source.replace("and lineage.markers = 0", "and lineage.markers >= 0") },
  { name: "sesión residual tolerada", mutate: (source) => source.replace("and residual_sessions.session_count = 0", "and residual_sessions.session_count >= 0") },
  { name: "lock residual tolerado", mutate: (source) => source.replace("and residual_locks.lock_count = 0", "and residual_locks.lock_count >= 0") },
  { name: "TLS omitido", mutate: (source) => source.replace("and runtime.tls_active", "and true /* runtime.tls_active */") },
  { name: "identidad omitida", mutate: (source) => source.replace("runtime.current_user = 'postgres'", "true /* runtime.current_user = 'postgres' */") },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(diagnostic);
  assert.notEqual(mutated, diagnostic, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertDiagnostic(mutated), `${mutation.name}: contrato rechaza la mutación`);
}

console.log(`PERF-06 PROD post-failure diagnostic contract passed; ${mutations.length} mutation probes killed`);
