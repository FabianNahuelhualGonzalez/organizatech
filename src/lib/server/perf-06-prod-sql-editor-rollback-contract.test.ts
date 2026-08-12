import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error The audited manifest library is intentionally native ESM.
import { PERF_06_MIGRATIONS, splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error The PROD rollback generator is intentionally native ESM.
import { PROD_BASELINE_FINGERPRINT, PROD_COMMIT_FILE, PROD_DIAGNOSTIC_SHA256, PROD_ERROR_CAPTURE_FILE, PROD_EXTRA_FUNCTION_DEFINITION_SHA256, PROD_EXTRA_FUNCTION_ITEM_SHA256, PROD_FINAL_FINGERPRINT, PROD_HISTORY_SHA256, PROD_POSTCOMMIT_FILE, PROD_PROJECT_REF, PROD_ROLLBACK_FILE, buildProdCommitArtifact, buildProdErrorCaptureArtifact, buildProdRollbackArtifact } from "../../../scripts/perf-06-prod-sql-editor-rollback-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/production/perf-06";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const expectedRollbackSha256 = "296873493bf2a38c60ee02fb455485d2a302b4f0ced4035052e7392de103f6ce";
const expectedCaptureSha256 = "6af10ef15cebc26e598d796345cfb30ec07a58ae7b08c36fd7b75c7d0cececea";
const expectedCommitSha256 = "7c7c6c539622fba550ea40faf2a78f14ce7d0b9d97d441461c31b881cfe4a81c";
const expectedPostcommitSha256 = "82a4cabeceee6906e3ca53d46c1aa7ff570cd3c898d3259798c89fe2517a5b57";
const baselineFingerprint = PROD_BASELINE_FINGERPRINT;

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

function stripSqlComments(source: string): string {
  return source
    .replace(/--[^\n]*(?=\n|$)/gu, (match) => " ".repeat(match.length))
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => " ".repeat(match.length));
}

function maskSqlLiteralsAndComments(source: string): string {
  return stripSqlComments(source)
    .replace(/\$([a-z0-9_]*)\$[\s\S]*?\$\1\$/giu, (match) => " ".repeat(match.length))
    .replace(/'(?:''|[^'])*'/gu, (match) => " ".repeat(match.length));
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function assertOrdered(source: string, anchors: string[], label: string): void {
  let cursor = -1;
  for (const anchor of anchors) {
    assert.ok(occurrences(source, anchor) >= 1, `${label}: ancla ejecutable presente: ${anchor}`);
    const next = source.indexOf(anchor, cursor + 1);
    assert.ok(next > cursor, `${label}: orden correcto: ${anchor}`);
    cursor = next;
  }
}

function mainTransaction(source: string): string {
  const start = source.indexOf("begin isolation level read committed read write;");
  assert.ok(start >= 0, "bundle contiene transacción principal READ WRITE");
  const ready = source.indexOf("'READY_FOR_TERMINAL'::text as phase", start);
  assert.ok(ready > start, "bundle completa gates antes del terminal");
  const end = source.indexOf("\n\nrollback;\n\nbegin isolation level repeatable read read only;", ready);
  assert.ok(end > ready, "bundle termina operación principal con ROLLBACK antes del postcheck");
  return source.slice(start, end);
}

function assertNoDiagnosticWrites(source: string): void {
  const executable = maskSqlLiteralsAndComments(source);
  assert.doesNotMatch(
    executable,
    /\b(?:insert\s+into|update|delete\s+from|truncate|drop\s+table|alter\s+table|create\s+table)\s+(?:if\s+(?:not\s+)?exists\s+)?public\.training_session_consolidation_audit\b/iu,
    "diagnóstico nunca recibe DML ni DDL",
  );
}

function assertNoProdGuardMutation(source: string): void {
  const executable = maskSqlLiteralsAndComments(source);
  assert.doesNotMatch(
    executable,
    /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?function\s+public\.rls_auto_enable\b/iu,
    "función PROD propia nunca se modifica",
  );
  assert.doesNotMatch(
    executable,
    /\b(?:create|alter|drop)\s+event\s+trigger\s+ensure_rls\b/iu,
    "event trigger PROD propio nunca se modifica",
  );
}

function assertMigrationOrder(source: string): void {
  let cursor = source.indexOf("$perf06_history_gate$;");
  assert.ok(cursor >= 0, "bootstrap histórico protegido");
  for (const filename of PERF_06_MIGRATIONS as string[]) {
    const match = /^(\d{14})_(.+)\.sql$/u.exec(filename);
    assert.ok(match, `${filename}: nombre válido`);
    const [, version, name] = match;
    const apply = `-- PERF06_SQL_EDITOR_MIGRATION APPLY ${version} ${name}`;
    const history = `-- PERF06_SQL_EDITOR_HISTORY ${version} ${name}`;
    const applyIndex = source.indexOf(apply, cursor + 1);
    const historyIndex = source.indexOf(history, applyIndex + 1);
    assert.ok(applyIndex > cursor, `${version}: SQL aplicado en orden`);
    assert.ok(historyIndex > applyIndex, `${version}: historial posterior al SQL`);
    assert.equal(source.indexOf(apply, applyIndex + 1), -1, `${version}: aplicación única`);
    assert.equal(source.indexOf(history, historyIndex + 1), -1, `${version}: registro único`);
    cursor = historyIndex;
  }
}

function assertProdRollback(source: string): void {
  const executableWithoutComments = stripSqlComments(source);
  assert.match(source, /DESTINO EXCLUSIVO: organizatech PROD \(lzycxltqbrtsnwfdotqw\)/u, "cabecera fija PROD");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI PostgreSQL");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, "sin secretos");
  assert.doesNotMatch(source, /^\\[^\n]+/mu, "sin metacomandos de cliente");
  assert.doesNotMatch(source, /\$\{[A-Z0-9_]+\}/u, "sin placeholders de plantilla sin resolver");

  const statements = splitAndTrim(source) as string[];
  const heads = statements.map((statement) => executableHead(statement).split(/\s+/u)[0]);
  assert.equal(heads.filter((head) => head === "commit").length, 0, "cero COMMIT ejecutables");
  assert.equal(heads.filter((head) => head === "rollback").length, 2, "ROLLBACK principal y postcheck");
  assert.equal(heads.at(-1), "rollback", "última sentencia ejecutable es ROLLBACK");

  const main = mainTransaction(source);
  assertOrdered(main, [
    "insert into pg_temp.perf06_sql_editor_context (initial_snapshot)",
    "do $perf06_initial$",
    "lock table public.training_session_consolidation_audit in share mode",
    "lock table auth.users in share mode",
    "lock table public.exercises in share row exclusive mode",
    "lock table public.routines, public.exercise_entries, public.training_cycle_exercises, public.training_exercise_lineages in share row exclusive mode",
    "set locked_snapshot = (",
    "do $perf06_locked$",
    "do $perf06_same_precheck$",
    "create schema if not exists supabase_migrations",
    "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810225819 perf_06a_security_hardening",
    "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810230014 perf_06c_rls_initplan",
    "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810230028 perf_06b_exercise_entries_user_session_created_id_index",
    "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260811035538 ensure_legacy_exercise_lineage_invariant",
    "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260811035542 reconcile_legacy_exercise_lineages",
    "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260811190144 perf_06r_daily_readiness_acl_normalization",
    "set final_snapshot = (",
    "do $perf06_final_gate$",
    "'READY_FOR_TERMINAL'::text as phase",
  ], "operación principal");
  assertMigrationOrder(main);

  assert.equal(occurrences(source, "procedure.proname = 'rls_auto_enable'\n      and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = ''"), 4, "fingerprint canónico excluye exactamente la función PROD en cuatro snapshots");
  assert.equal(occurrences(source, `function_snapshot.function_item_sha256 = '${PROD_EXTRA_FUNCTION_ITEM_SHA256}'`), 4, "hash completo de función fijado en cuatro guards");
  assert.equal(occurrences(source, `function_snapshot.definition_sha256 = '${PROD_EXTRA_FUNCTION_DEFINITION_SHA256}'`), 4, "hash de definición fijado en cuatro guards");
  assert.equal(occurrences(source, PROD_EXTRA_FUNCTION_ITEM_SHA256), 8, "hash completo real fijado en guards, gates y postcheck");
  assert.equal(occurrences(source, PROD_EXTRA_FUNCTION_DEFINITION_SHA256), 8, "hash de definición real fijado en guards, gates y postcheck");
  for (const condition of [
    "function_snapshot.function_count = 1",
    "function_snapshot.owner_is_postgres",
    "function_snapshot.language_is_plpgsql",
    "function_snapshot.security_definer",
    "function_snapshot.search_path_pg_catalog",
    "function_snapshot.returns_event_trigger",
    "function_snapshot.zero_arguments",
    "event_snapshot.owner_is_postgres",
    "event_snapshot.event_is_ddl_command_end",
    "event_snapshot.enabled_for_origin",
    "event_snapshot.calls_target_function",
    "event_snapshot.tags_exact",
  ]) {
    assert.equal(occurrences(executableWithoutComments, condition), 4, `guard PROD exige cuatro veces: ${condition}`);
  }
  assert.equal(occurrences(executableWithoutComments, "event_snapshot.ensure_rls_count = 1"), 4, "ensure_rls exacto en cuatro guards");
  assert.equal(occurrences(executableWithoutComments, "event_snapshot.triggers_using_function = 1"), 4, "wiring exacto en cuatro guards");
  assert.equal(occurrences(source, "dependency_snapshot.dependencies = '[{\"count\":1,\"catalog\":\"pg_event_trigger\""), 4, "dependencias exactas fijadas");

  assert.equal(occurrences(main, "diagnostic.diagnostic_count = 3"), 0, "gate principal usa snapshots, no bypass directo");
  assert.equal(occurrences(main, "'diagnostic_count', (select diagnostic_count from diagnostic_count)"), 3, "tres snapshots inventarían diagnóstico");
  assert.equal(occurrences(main, "'diagnostic_executed_count', (select diagnostic_executed_count from diagnostic_count)"), 3, "tres snapshots exigen estados ejecutados");
  assert.equal(occurrences(main, "diagnostic_count')::integer <> 3"), 2, "prechecks inicial y bloqueado exigen tres registros");
  assert.equal(occurrences(main, "diagnostic_executed_count')::integer <> 3"), 3, "prechecks y gate final exigen tres estados ejecutados");
  assert.equal(occurrences(main, "from public.training_session_consolidation_audit as diagnostic"), 3, "tres snapshots incluyen hash de filas");
  assert.equal(occurrences(main, "select 'row|' || pg_catalog.to_jsonb(diagnostic)::text"), 3, "hash incluye serialización canónica de las tres filas");
  assert.match(main, /v_final ->> 'diagnostic_hash' <> v_initial ->> 'diagnostic_hash'/u, "hash de filas/esquema preservado antes/después");
  assert.match(main, /v_final ->> 'prod_guard_hash' <> v_initial ->> 'prod_guard_hash'/u, "guard PROD preservado antes/después");
  assert.match(main, /\(v_final ->> 'diagnostic_final_count'\)::integer <> 3/u, "gate final exige tres registros");
  assert.match(main, /\(v_final ->> 'diagnostic_executed_count'\)::integer <> 3/u, "gate final exige tres ejecutados");

  assert.match(main, new RegExp(`fingerprint_count'\\)::integer <> 346[\\s\\S]+${baselineFingerprint}`, "u"), "baseline canónico exacto");
  assert.match(main, /fingerprint_count'\)::integer <> 377[\s\S]+pg_catalog\.length\(coalesce\(v_final ->> 'fingerprint_hash', ''\)\) <> 64/u, "captura final exige conteo y SHA-256 completo");
  assert.match(main, /select final_snapshot ->> 'fingerprint_hash' from pg_temp\.perf06_sql_editor_context/u, "publica el fingerprint final capturado dentro de la transacción");
  assert.match(source, /'ROLLBACK_VERIFIED'::text as terminal/u, "postcheck publica terminal verificado");
  assert.match(source, /diagnostic\.diagnostic_count = 3/u, "post-rollback exige tres registros");
  assert.match(source, /diagnostic\.diagnostic_executed_count = 3/u, "post-rollback exige tres ejecutados");
  assert.match(source, /partial_application\.history_absent/u, "post-rollback exige historial ausente");
  assert.match(source, /prod_guard\.valid/u, "post-rollback exige función/event trigger intactos");

  const postcheckStart = source.indexOf("begin isolation level repeatable read read only;");
  assert.ok(postcheckStart > 0, "postcheck READ ONLY presente");
  const postcheck = source.slice(postcheckStart);
  assert.match(postcheck, new RegExp(`overall\\.item_count = 346[\\s\\S]+overall\\.sha256 = '${baselineFingerprint}'`, "u"), "postcheck fija baseline canónico exacto");
  assert.match(postcheck, /and prod_guard\.valid/u, "postcheck exige guard PROD válido");
  for (const condition of [
    "partial_application.history_absent",
    "partial_application.identity_function_absent",
    "partial_application.invariant_function_absent",
    "partial_application.lineage_function_absent",
    "partial_application.perf_index_absent",
    "partial_application.perf_triggers_absent",
  ]) {
    assert.equal(occurrences(stripSqlComments(postcheck), condition), 1, `postcheck exige: ${condition}`);
  }

  assertNoDiagnosticWrites(source);
  assertNoProdGuardMutation(source);
}

const generated = buildProdRollbackArtifact(root);
const rollback = readFileSync(join(root, operationDirectory, PROD_ROLLBACK_FILE), "utf8");

assert.equal(rollback, generated.sql, "bundle PROD generado determinísticamente");
assert.equal(sha256(rollback), expectedRollbackSha256, "SHA-256 del rollback aprobado");
assert.equal(generated.summary.projectRef, PROD_PROJECT_REF, "summary fija PROD");
assert.equal(generated.summary.migrations, 24, "24 migraciones");
assert.equal(generated.summary.statements, 336, "336 statements");
assert.equal(generated.summary.diagnosticRows, 3, "tres registros diagnósticos preservados");
assertProdRollback(rollback);

const generatedCapture = buildProdErrorCaptureArtifact(root);
const capture = readFileSync(join(root, operationDirectory, PROD_ERROR_CAPTURE_FILE), "utf8");
assert.equal(capture, generatedCapture.sql, "captura generada determinísticamente");
assert.equal(sha256(capture), expectedCaptureSha256, "SHA-256 de captura aprobado");
assert.match(capture, /do \$perf06_final_gate\$[\s\S]+do \$perf06_capture_final\$/u, "captura ocurre después del gate final");
assert.match(capture, /errcode = 'P0001'[\s\S]+PERF06_EXPECTED_ROLLBACK final_fingerprint=/u, "error controlado publica el fingerprint");
assert.match(capture, /length\(coalesce\(v_final_fingerprint, ''\)\) <> 64/u, "captura exige SHA-256 completo");
const captureTopLevel = (splitAndTrim(capture) as string[]).map((statement) => executableHead(statement));
assert.ok(!captureTopLevel.includes("commit"), "captura no contiene COMMIT superior");
assert.ok(!captureTopLevel.includes("rollback"), "captura revierte mediante excepción esperada");
assert.doesNotMatch(capture, /ROLLBACK_VERIFIED/u, "captura no publica un PASS nominal");

const generatedCommit = buildProdCommitArtifact(root);
const commit = readFileSync(join(root, operationDirectory, PROD_COMMIT_FILE), "utf8");
const postcommit = readFileSync(join(root, operationDirectory, PROD_POSTCOMMIT_FILE), "utf8");
assert.equal(commit, generatedCommit.sql, "bundle COMMIT generado determinísticamente");
assert.equal(postcommit, `${generatedCommit.postcommit}\n`, "postcheck separado generado determinísticamente");
assert.equal(sha256(commit), expectedCommitSha256, "SHA-256 COMMIT aprobado");
assert.equal(sha256(postcommit), expectedPostcommitSha256, "SHA-256 postcheck aprobado");
const commitTopLevel = (splitAndTrim(commit) as string[]).map((statement) => executableHead(statement));
assert.equal(commitTopLevel.filter((statement) => statement === "commit").length, 1, "un único COMMIT superior");
assert.equal(commitTopLevel.at(-1), "rollback", "postcheck embebido termina con ROLLBACK");
assertOrdered(commit, [
  "do $perf06_final_gate$",
  `'${PROD_FINAL_FINGERPRINT}'::text as final_fingerprint`,
  "\n\ncommit;\n\n",
  "begin isolation level repeatable read read only;",
  "case when valid then 'PASS_PROD_APPLIED' else 'BLOCKED' end as verdict",
  "\nrollback;",
], "COMMIT y postcheck");
assert.match(commit, new RegExp(`v_final ->> 'fingerprint_hash' <> '${PROD_FINAL_FINGERPRINT}'`, "u"), "gate pre-COMMIT fija fingerprint PROD exacto");
assert.match(postcommit, new RegExp(`overall\\.sha256 = '${PROD_FINAL_FINGERPRINT}'`, "u"), "postcheck fija fingerprint final exacto");
assert.match(postcommit, new RegExp(`history\\.sha256 = '${PROD_HISTORY_SHA256}'`, "u"), "postcheck fija historial exacto");
assert.match(postcommit, new RegExp(`diagnostic_hash\\.diagnostic_hash = '${PROD_DIAGNOSTIC_SHA256}'`, "u"), "postcheck preserva diagnóstico exacto");
assert.match(postcommit, /lineage\.pending = 0[\s\S]+lineage\.markers = 0/u, "postcheck exige reconciliación completa sin marker PROD");
assert.match(postcommit, /and catalog\.valid/u, "postcheck exige catálogo y privilegios finales");
assertNoDiagnosticWrites(commit);
assertNoProdGuardMutation(commit);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "terminal COMMIT", mutate: (source) => source.replace("\n\nrollback;\n\nbegin isolation level repeatable read read only;", "\n\ncommit;\n\nbegin isolation level repeatable read read only;") },
  { name: "ref QA", mutate: (source) => source.replaceAll(PROD_PROJECT_REF, qaProjectRef) },
  { name: "elimina primer precheck", mutate: (source) => source.replace("insert into pg_temp.perf06_sql_editor_context (initial_snapshot)", "insert into pg_temp.perf06_sql_editor_context (locked_snapshot)") },
  { name: "intercambia locks", mutate: (source) => source.replace("lock table auth.users in share mode;\n\nlock table public.exercises in share row exclusive mode;", "lock table public.exercises in share row exclusive mode;\n\nlock table auth.users in share mode;") },
  { name: "diagnóstico reducido a dos", mutate: (source) => source.replaceAll("diagnostic_count')::integer <> 3", "diagnostic_count')::integer <> 2") },
  { name: "estados ejecutados omitidos", mutate: (source) => source.replaceAll("diagnostic_executed_count", "diagnostic_ignored_count") },
  { name: "hash de filas retirado", mutate: (source) => source.replaceAll("select 'row|' || pg_catalog.to_jsonb(diagnostic)::text", "select 'row|ignored'") },
  { name: "DROP diagnóstico", mutate: (source) => source.replace("do $perf06_final_gate$", "drop table public.training_session_consolidation_audit;\n\ndo $perf06_final_gate$") },
  { name: "función extra no excluida", mutate: (source) => source.replaceAll("and not (\n      procedure.proname = 'rls_auto_enable'", "and not (\n      procedure.proname = 'wrong_function'") },
  { name: "hash función puenteado", mutate: (source) => source.replaceAll(PROD_EXTRA_FUNCTION_ITEM_SHA256, "0".repeat(64)) },
  { name: "placeholder sin resolver", mutate: (source) => source.replace(PROD_EXTRA_FUNCTION_ITEM_SHA256, "${PROD_EXTRA_FUNCTION_ITEM_SHA256}") },
  { name: "ensure_rls no exigido", mutate: (source) => source.replaceAll("event_snapshot.ensure_rls_count = 1", "event_snapshot.ensure_rls_count >= 0") },
  { name: "security definer no exigido", mutate: (source) => source.replaceAll("function_snapshot.security_definer", "true /* function_snapshot.security_definer */") },
  { name: "wiring no exigido", mutate: (source) => source.replaceAll("event_snapshot.calls_target_function", "true /* event_snapshot.calls_target_function */") },
  { name: "tags no exigidos", mutate: (source) => source.replaceAll("event_snapshot.tags_exact", "true /* event_snapshot.tags_exact */") },
  { name: "dependencias permisivas", mutate: (source) => source.replaceAll("and dependency_snapshot.dependencies = '[{\"count\":1", "and dependency_snapshot.dependencies @> '[{\"count\":1") },
  { name: "postcheck no exige índice ausente", mutate: (source) => source.replace("and partial_application.perf_index_absent", "and true /* partial_application.perf_index_absent */") },
  { name: "postcheck acepta fingerprint final", mutate: (source) => source.replace("when overall.item_count = 346", "when overall.item_count = 377") },
  { name: "altera función PROD", mutate: (source) => source.replace("do $perf06_final_gate$", "alter function public.rls_auto_enable() security invoker;\n\ndo $perf06_final_gate$") },
  { name: "historial antes de A", mutate: (source) => {
    const apply = "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810225819 perf_06a_security_hardening";
    const history = "-- PERF06_SQL_EDITOR_HISTORY 20260810225819 perf_06a_security_hardening";
    return source.replace(apply, "__APPLY_A__").replace(history, apply).replace("__APPLY_A__", history);
  } },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(rollback);
  assert.notEqual(mutated, rollback, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertProdRollback(mutated), `${mutation.name}: contrato la rechaza`);
}

const readme = readFileSync(join(root, operationDirectory, "README.md"), "utf8");
assert.match(readme, /08_prod_rollback_capture\.sql/u, "README documenta rollback PROD corregido");
assert.match(readme, /public\.rls_auto_enable\(\)/u, "README preserva función PROD");
assert.match(readme, /ensure_rls/u, "README preserva event trigger PROD");
assert.match(readme, /tres registros/iu, "README preserva tres registros diagnósticos");
assert.match(readme, /no ejecutarlo/iu, "README prohíbe ejecución antes de auditoría/autorización");

process.stdout.write(`PERF-06 PROD SQL Editor rollback contract passed; ${mutations.length} mutation probes killed\n`);
