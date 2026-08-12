import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error The audited manifest library is intentionally native ESM.
import { splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error The PROD diagnostic generator is intentionally native ESM.
import { OBSERVED_PROD_FINGERPRINT, OBSERVED_PROD_ITEMS, PROD_DRIFT_DIAGNOSTIC_FILE, PROD_PROJECT_REF, buildProdDriftDiagnostic, objectKeySql } from "../../../scripts/perf-06-prod-drift-diagnostic-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/production/perf-06";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const diagnosticSha256 = "64d33ba5d00b598551be3a4c68b9e21ce99cd98a3c34ef8ebe856c7b16250f25";

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

function normalizeExecutableSql(source: string): string {
  return stripSqlComments(source).replace(/\s+/gu, " ").trim().toLowerCase();
}

function assertNoSecrets(source: string): void {
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI PostgreSQL");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, "sin secretos");
  assert.doesNotMatch(source, /^\\[^\n]+/mu, "sin metacomandos");
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function expectedObjectReportBranch(): string {
  return normalizeExecutableSql(`
    select
      3,
      'OBJECT',
      manifest.category,
      null,
      null,
      null,
      ${objectKeySql()},
      pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(manifest.category || '|' || manifest.line, 'UTF8')),
        'hex'
      ),
      null
    from manifest
    join drift_categories using (category)
  `);
}

function extractObjectReportBranch(query: string): string {
  const start = query.indexOf("select 3, 'object', manifest.category");
  const end = query.indexOf(" union all select 4,", start);
  assert.notEqual(start, -1, "fila OBJECT presente exactamente en report");
  assert.notEqual(end, -1, "fila OBJECT termina antes de EXCLUDED_DIAGNOSTIC");
  return query.slice(start, end);
}

function assertDriftDiagnostic(source: string): void {
  const statements = splitAndTrim(source) as string[];
  const heads = statements.map((statement) => executableHead(statement).split(/\s+/u)[0]);
  assert.deepEqual(heads, ["begin", "set", "set", "set", "set", "with", "rollback"], "forma top-level read-only exacta");
  assert.equal(normalizeExecutableSql(statements[0]), "begin isolation level repeatable read read only", "READ ONLY ejecutable exacto");
  assert.equal(heads.filter((head) => head === "commit").length, 0, "cero COMMIT");
  assert.equal(heads.filter((head) => head === "rollback").length, 1, "ROLLBACK final único");

  const executable = maskSqlLiteralsAndComments(source);
  assert.doesNotMatch(executable, /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|lock|vacuum|analyze)\b/iu, "sin DDL/DML/locks ejecutables");
  assert.doesNotMatch(executable, /\bexecute\b/iu, "sin SQL dinámico");
  assert.doesNotMatch(executable, /(?:\bfrom|\bjoin|,)\s+(?:public|auth|storage)\s*\./iu, "no lee filas de aplicación/Auth/Storage, incluso mediante join por coma");
  assert.doesNotMatch(source, /\bpg_advisory_(?:xact_)?lock\b/iu, "sin advisory locks");

  const query = normalizeExecutableSql(statements[5]);
  assert.match(
    query,
    /evaluation as \( select case when runtime\.current_user <> 'postgres' or runtime\.session_user <> 'postgres' or runtime\.read_only <> 'on' or runtime\.isolation_level <> 'repeatable read' then 'blocked_identity_or_transaction' when overall\.item_count/u,
    "identidad y transacción fail-closed usan los cuatro operandos antes de cualquier otro gate",
  );
  assert.match(query, new RegExp(`when overall\\.item_count <> ${OBSERVED_PROD_ITEMS} or overall\\.sha256 <> '${OBSERVED_PROD_FINGERPRINT}' then 'drift_snapshot_changed'`, "u"), "fotografía observada congelada");
  assert.match(query, /when not exists \(select 1 from drift_categories\) then 'blocked_no_count_drift_found' else 'pass_drift_diagnostic_complete' end as verdict/u, "diagnóstico sólo pasa cuando existe drift de conteo");
  assert.equal(occurrences(query, "'pass_drift_diagnostic_complete'"), 1, "existe una única rama PASS ejecutable");
  assert.match(query, /\) select evaluation\.verdict,/u, "la proyección publica exclusivamente el veredicto calculado");
  assert.match(query, /drift_categories as \( select category from category_deltas where count_differs \)/u, "drift_categories contiene exclusivamente categorías con conteo divergente");
  assert.match(query, /from manifest join drift_categories using \(category\)/u, "objetos limitados a categorías con conteo divergente");
  assert.match(query, /pg_catalog\.sha256\(pg_catalog\.convert_to\(manifest\.category \|\| '\|' \|\| manifest\.line, 'utf8'\)\)/u, "definiciones sólo salen como hash individual");
  assert.equal(occurrences(query, "select 3, 'object', manifest.category"), 1, "existe una única fila OBJECT");
  const objectBranch = extractObjectReportBranch(query);
  const expectedObjectBranch = expectedObjectReportBranch();
  assert.equal(objectBranch, expectedObjectBranch, "OBJECT expone sólo claves allowlisted por categoría, hash individual y detail nulo");
  assert.equal(
    occurrences(objectBranch, "manifest.line"),
    occurrences(expectedObjectBranch, "manifest.line"),
    "OBJECT no añade otra exposición de manifest.line",
  );
  assert.doesNotMatch(objectBranch, /pg_get_(?:function|index|constraint|trigger)def|polqual|polwithcheck|relacl|attacl/u, "OBJECT no expone definiciones, predicados ni ACL completas");

  for (const [category, count] of Object.entries({ relation: 12, column: 140, constraint: 87, index: 48, policy: 26, function: 8, trigger: 13, table_acl: 12, column_acl: 0 })) {
    assert.match(query, new RegExp(`\\('${category}'::text, ${count}::bigint\\)`, "u"), `${category}: conteo baseline fijado`);
  }

  assert.match(source, new RegExp(PROD_PROJECT_REF, "u"), "ref PROD explícita");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.match(query, /visual_project_confirmation_required/u, "confirmación visual requerida");
  assert.match(query, /public\.training_session_consolidation_audit/u, "diagnóstico excluido se identifica sólo por catálogo");
  assert.match(query, /'view_consumers'/u, "dependencias de vistas agregadas");
  assert.doesNotMatch(source, /\b(?:email|phone_number|display_name|avatar_path|access_token|refresh_token)\b/iu, "sin datos personales o tokens");
  assertNoSecrets(source);
}

const generated = buildProdDriftDiagnostic(root);
const diagnostic = readFileSync(join(root, operationDirectory, PROD_DRIFT_DIAGNOSTIC_FILE), "utf8");

assert.equal(diagnostic, generated.sql, "diagnóstico generado determinísticamente");
assert.equal(generated.summary.projectRef, PROD_PROJECT_REF, "summary fija PROD");
assert.equal(generated.summary.observedItems, 347, "fotografía fija 347 elementos");
assert.equal(generated.summary.observedFingerprint, OBSERVED_PROD_FINGERPRINT, "fotografía fija fingerprint observado");
assert.equal(generated.summary.diagnosticSha256, diagnosticSha256, "SHA-256 aprobado");
assertDriftDiagnostic(diagnostic);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "READ WRITE", mutate: (source) => source.replace("repeatable read read only", "repeatable read read write") },
  { name: "COMMIT", mutate: (source) => source.replace("\nrollback;\n", "\ncommit;\n") },
  { name: "DML", mutate: (source) => source.replace("\nrollback;\n", "\nupdate public.profiles set id = id;\nrollback;\n") },
  { name: "DDL", mutate: (source) => source.replace("\nrollback;\n", "\ncreate temp table drift_probe(id integer);\nrollback;\n") },
  { name: "lock", mutate: (source) => source.replace("\nrollback;\n", "\nlock table public.profiles;\nrollback;\n") },
  { name: "ref QA", mutate: (source) => source.replaceAll(PROD_PROJECT_REF, qaProjectRef) },
  { name: "snapshot sin conteo", mutate: (source) => source.replace(`overall.item_count <> ${OBSERVED_PROD_ITEMS}`, "false") },
  { name: "snapshot sin fingerprint", mutate: (source) => source.replace(`overall.sha256 <> '${OBSERVED_PROD_FINGERPRINT}'`, "false") },
  { name: "identidad neutralizada", mutate: (source) => source.replace("when runtime.current_user <> 'postgres'", "when false /* runtime.current_user <> 'postgres' */") },
  { name: "session_user retirado", mutate: (source) => source.replace("      or runtime.session_user <> 'postgres'\n", "") },
  { name: "read_only retirado", mutate: (source) => source.replace("      or runtime.read_only <> 'on'\n", "") },
  { name: "isolation_level retirado", mutate: (source) => source.replace("      or runtime.isolation_level <> 'repeatable read'\n", "") },
  { name: "todos los objetos", mutate: (source) => source.replace("join drift_categories using (category)", "left join drift_categories using (category)") },
  { name: "drift_categories sin filtro", mutate: (source) => source.replace("select category from category_deltas where count_differs", "select category from category_deltas") },
  { name: "fila de aplicación", mutate: (source) => source.replace("from diagnostic_relation as diagnostic", "from diagnostic_relation as diagnostic cross join public.profiles") },
  { name: "fila de aplicación mediante coma", mutate: (source) => source.replace("from diagnostic_relation as diagnostic", "from diagnostic_relation as diagnostic, public.profiles") },
  { name: "object_key expone función", mutate: (source) => source.replace("when 'function' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))", "when 'function' then manifest.line") },
  { name: "object_key expone índice", mutate: (source) => source.replace("when 'index' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))", "when 'index' then manifest.line") },
  { name: "object_key expone policy", mutate: (source) => source.replace("when 'policy' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))", "when 'policy' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3), pg_catalog.split_part(manifest.line, '|', 4), pg_catalog.split_part(manifest.line, '|', 5), pg_catalog.split_part(manifest.line, '|', 6), pg_catalog.split_part(manifest.line, '|', 7), pg_catalog.split_part(manifest.line, '|', 8))") },
  { name: "object_key expone constraint", mutate: (source) => source.replace("when 'constraint' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))", "when 'constraint' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3), pg_catalog.split_part(manifest.line, '|', 4), pg_catalog.split_part(manifest.line, '|', 5), pg_catalog.split_part(manifest.line, '|', 6))") },
  { name: "object_key expone ACL", mutate: (source) => source.replace("when 'table_acl' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2))", "when 'table_acl' then pg_catalog.concat_ws('|', pg_catalog.split_part(manifest.line, '|', 1), pg_catalog.split_part(manifest.line, '|', 2), pg_catalog.split_part(manifest.line, '|', 3))") },
  { name: "item_sha expone línea", mutate: (source) => source.replace("    pg_catalog.encode(\n      pg_catalog.sha256(pg_catalog.convert_to(manifest.category || '|' || manifest.line, 'UTF8')),\n      'hex'\n    ),", "    manifest.line,") },
  { name: "OBJECT detail expone línea", mutate: (source) => source.replace("      'hex'\n    ),\n    null\n  from manifest", "      'hex'\n    ),\n    pg_catalog.jsonb_build_object('line', manifest.line)\n  from manifest") },
  { name: "conteo baseline alterado", mutate: (source) => source.replace("('relation'::text, 12::bigint)", "('relation'::text, 13::bigint)") },
  { name: "SQL dinámico", mutate: (source) => source.replace("rollback;", "do $x$ begin execute 'select 1'; end $x$;\nrollback;") },
  { name: "PASS hardcodeado", mutate: (source) => source.replace("evaluation.verdict,", "'PASS_DRIFT_DIAGNOSTIC_COMPLETE'::text as verdict,") },
  { name: "PASS sin drift", mutate: (source) => source.replace("then 'BLOCKED_NO_COUNT_DRIFT_FOUND'", "then 'PASS_DRIFT_DIAGNOSTIC_COMPLETE'") },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(diagnostic);
  assert.notEqual(mutated, diagnostic, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertDriftDiagnostic(mutated), `${mutation.name}: contrato la rechaza`);
}

process.stdout.write(`PERF-06 PROD drift diagnostic contract passed; ${mutations.length} mutation probes killed\n`);
