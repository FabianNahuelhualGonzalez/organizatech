import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error The audited manifest library is intentionally native ESM.
import { splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";

const root = resolve(process.cwd());
const classificationPath = resolve(
  root,
  "supabase/operations/production/perf-06/03_rls_auto_enable_classification_readonly.sql",
);
const prodProjectRef = "lzycxltqbrtsnwfdotqw";
const qaProjectRef = "fjjebhaqtrdbpxzxztmh";
const expectedSha256 = "91911af716fecf39777042f70bcb220827df1d0474ed87b1bc819dc8fb6b6a81";

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

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function assertClassification(source: string): void {
  const statements = splitAndTrim(source) as string[];
  const heads = statements.map((statement) => executableHead(statement).split(/\s+/u)[0]);
  assert.deepEqual(heads, ["begin", "set", "set", "set", "set", "with", "rollback"], "forma top-level READ-ONLY exacta");
  assert.equal(normalizeExecutableSql(statements[0]), "begin isolation level repeatable read read only", "transacción REPEATABLE READ READ ONLY");
  assert.equal(heads.filter((head) => head === "commit").length, 0, "cero COMMIT");
  assert.equal(heads.filter((head) => head === "rollback").length, 1, "ROLLBACK final único");

  const executable = maskSqlLiteralsAndComments(source);
  assert.doesNotMatch(executable, /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke|lock|vacuum|analyze)\b/iu, "sin DDL/DML/locks");
  assert.doesNotMatch(executable, /\bexecute\b/iu, "sin SQL dinámico");
  assert.doesNotMatch(executable, /(?:\bfrom|\bjoin|,)\s+(?:public|auth|storage)\s*\./iu, "sin lecturas de filas de aplicación/Auth/Storage");
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, "sin URI PostgreSQL");
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, "sin secretos");

  const query = normalizeExecutableSql(statements[5]);
  assert.match(query, /where namespace\.nspname = 'public' and procedure\.proname = 'rls_auto_enable' and pg_catalog\.pg_get_function_identity_arguments\(procedure\.oid\) = ''/u, "función objetivo exacta y sin argumentos");
  assert.match(query, /pg_catalog\.bool_and\(prosecdef\)/u, "clasifica SECURITY DEFINER desde catálogo");
  assert.match(query, /proconfig, '\{\}'::text\[\]\) @> array\['search_path=pg_catalog'\]::text\[\]/u, "clasifica search_path seguro");
  assert.match(query, /return_type = 'event_trigger'/u, "clasifica retorno EVENT_TRIGGER");
  assert.match(query, /pg_catalog\.sha256\(pg_catalog\.convert_to\(normalized_definition, 'utf8'\)\)/u, "devuelve hash de definición");
  assert.match(query, /reads_event_trigger_commands/u, "comprueba lectura de comandos DDL");
  assert.match(query, /limits_schema_to_public/u, "comprueba límite al schema public");
  assert.match(query, /enables_row_level_security/u, "comprueba habilitación de RLS");

  for (const role of ["public", "anon", "authenticated", "service_role", "postgres"]) {
    assert.match(query, new RegExp(`${role}_execute_direct`, "u"), `${role}: ACL directo clasificado`);
  }
  assert.match(query, /from pg_catalog\.pg_event_trigger as event_trigger/u, "lee event triggers por catálogo");
  assert.match(query, /event_trigger\.evtname = 'ensure_rls'/u, "event trigger canónico identificado");
  assert.match(
    query,
    /pg_catalog\.bool_and\(evtfoid = target_function_oid\) filter \(where evtname = 'ensure_rls'\)/u,
    "verifica wiring del event trigger canónico hacia la función exacta",
  );
  assert.match(query, /evttags @> array\['create table', 'create table as', 'select into'\]::text\[\] and evttags <@ array\['create table', 'create table as', 'select into'\]::text\[\]/u, "tags exactos sin ampliación");
  assert.match(query, /dependency\.refclassid = 'pg_catalog\.pg_proc'::pg_catalog\.regclass/u, "dependencias inbound agregadas");
  assert.match(query, /dependency\.classid = 'pg_catalog\.pg_proc'::pg_catalog\.regclass/u, "dependencias outbound agregadas");

  assert.match(
    query,
    /evaluation as \( select case when runtime\.current_user <> 'postgres' or runtime\.session_user <> 'postgres' or runtime\.read_only <> 'on' or runtime\.isolation_level <> 'repeatable read' then 'blocked_identity_or_transaction' when function_summary\.function_count <> 1 then 'blocked_function_cardinality' else 'pass_rls_auto_enable_classification_captured' end as verdict/u,
    "veredicto fail-closed usa identidad, transacción y cardinalidad",
  );
  assert.equal((query.match(/'pass_rls_auto_enable_classification_captured'/gu) ?? []).length, 1, "rama PASS única");
  assert.match(query, /select evaluation\.verdict, 'lzycxltqbrtsnwfdotqw'::text as expected_project_ref, true as visual_project_confirmation_required/u, "proyección publica veredicto calculado y ref PROD");
  assert.match(query, /pg_catalog\.to_jsonb\(function_summary\) as function_summary/u, "resumen de función publicado");
  assert.match(query, /pg_catalog\.to_jsonb\(function_acl_summary\) as function_acl/u, "resumen ACL publicado");
  assert.match(query, /pg_catalog\.to_jsonb\(event_trigger_summary\) as event_trigger_summary/u, "resumen event trigger publicado");
  assert.doesNotMatch(query, /normalized_definition\s+as\s+/u, "no proyecta definición normalizada");
  assert.doesNotMatch(query, /pg_get_functiondef\([^)]*\)\s+as\s+(?:definition|body|source)/u, "no proyecta cuerpo de función");

  assert.match(source, new RegExp(prodProjectRef, "u"), "ref PROD explícita");
  assert.doesNotMatch(source, new RegExp(qaProjectRef, "u"), "ref QA ausente");
  assert.doesNotMatch(source, /\b(?:email|phone_number|display_name|avatar_path|access_token|refresh_token)\b/iu, "sin datos personales o tokens");
}

const classification = readFileSync(classificationPath, "utf8");
assert.equal(sha256(classification), expectedSha256, "SHA-256 de clasificación aprobado");
assertClassification(classification);

const mutations: Array<{ name: string; mutate: (source: string) => string }> = [
  { name: "READ WRITE", mutate: (source) => source.replace("repeatable read read only", "repeatable read read write") },
  { name: "COMMIT", mutate: (source) => source.replace("\nrollback;\n", "\ncommit;\n") },
  { name: "DML", mutate: (source) => source.replace("\nrollback;\n", "\nupdate public.profiles set id = id;\nrollback;\n") },
  { name: "DDL", mutate: (source) => source.replace("\nrollback;\n", "\ncreate temp table classification_probe(id integer);\nrollback;\n") },
  { name: "lectura de filas", mutate: (source) => source.replace("from runtime", "from runtime, public.profiles") },
  { name: "session_user retirado", mutate: (source) => source.replace("      or runtime.session_user <> 'postgres'\n", "") },
  { name: "read_only retirado", mutate: (source) => source.replace("      or runtime.read_only <> 'on'\n", "") },
  { name: "isolation retirado", mutate: (source) => source.replace("      or runtime.isolation_level <> 'repeatable read'\n", "") },
  { name: "cardinalidad neutralizada", mutate: (source) => source.replace("when function_summary.function_count <> 1", "when false /* function_summary.function_count <> 1 */") },
  { name: "SECURITY DEFINER omitido", mutate: (source) => source.replace("pg_catalog.bool_and(prosecdef)", "pg_catalog.bool_and(true)") },
  { name: "search_path omitido", mutate: (source) => source.replace("coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog']::text[]", "true") },
  { name: "definición sin hash", mutate: (source) => source.replace("pg_catalog.sha256(pg_catalog.convert_to(normalized_definition, 'UTF8'))", "pg_catalog.convert_to(normalized_definition, 'UTF8')") },
  { name: "cuerpo proyectado", mutate: (source) => source.replace("pg_catalog.to_jsonb(function_summary) as function_summary,", "target_function.normalized_definition as function_definition,") },
  { name: "ACL PUBLIC omitido", mutate: (source) => source.replace("public_execute_direct", "public_execute_unchecked") },
  { name: "event trigger desconectado", mutate: (source) => source.replace("evtfoid = target_function_oid", "true") },
  { name: "tags ampliados", mutate: (source) => source.replace("and evttags <@ array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]", "") },
  { name: "dependencias inbound omitidas", mutate: (source) => source.replace("dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass", "true") },
  { name: "PASS hardcodeado", mutate: (source) => source.replace("evaluation.verdict,", "'PASS_RLS_AUTO_ENABLE_CLASSIFICATION_CAPTURED'::text as verdict,") },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(classification);
  assert.notEqual(mutated, classification, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertClassification(mutated), `${mutation.name}: contrato la rechaza`);
}

process.stdout.write(`PERF-06 PROD rls_auto_enable classification contract passed; ${mutations.length} mutation probes killed\n`);
