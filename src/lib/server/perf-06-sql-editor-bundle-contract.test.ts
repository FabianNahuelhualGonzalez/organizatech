import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// @ts-expect-error The audited manifest library is intentionally native ESM.
import { PERF_06_MIGRATIONS, splitAndTrim } from "../../../scripts/perf-06-migration-manifest.mjs";
// @ts-expect-error The SQL Editor generator is intentionally native ESM.
import { SQL_EDITOR_FILES, buildSqlEditorArtifacts } from "../../../scripts/perf-06-sql-editor-bundle.mjs";

const root = resolve(process.cwd());
const operationDirectory = "supabase/operations/qa/perf-06-sql-editor";
const projectRef = "fjjebhaqtrdbpxzxztmh";
const manifestSha256 = "2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848";
const baselineFingerprint = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";
const finalFingerprint = "833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9";
const expectedArtifactHashes = Object.freeze({
  rollback: "062fe2be1e2cea1850e1ddbbbc42d601bbb32f703d9b948d53fc81aa495ea4ae",
  commit: "8288f7788cafba709d4dbf686223e281bb83c44f7ef82f1bad50be17f346972d",
  postcheck: "671084ee1d64c057984a471976b9b10f2b0dd7d931ade8dd0936ffacab7e5c76",
});

type ArtifactSet = {
  rollback: string;
  commit: string;
  postcheck: string;
};

function readArtifact(key: keyof ArtifactSet): string {
  return readFileSync(join(root, operationDirectory, SQL_EDITOR_FILES[key]), "utf8");
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

function commandCount(source: string, command: string): number {
  return splitAndTrim(source).filter((statement: string) => (
    executableHead(statement).startsWith(`${command.toLowerCase()} `)
    || executableHead(statement) === command.toLowerCase()
  )).length;
}

function mainTransaction(source: string, terminal: "commit" | "rollback"): string {
  const start = source.indexOf("begin isolation level read committed read write;");
  assert.ok(start >= 0, "bundle contiene transacción principal READ WRITE");
  const ready = source.indexOf("'READY_FOR_TERMINAL'::text as phase", start);
  assert.ok(ready > start, "bundle completa gates antes del terminal principal");
  const terminalNeedle = `\n${terminal};\n`;
  const end = source.indexOf(terminalNeedle, ready);
  assert.ok(end > start, `bundle contiene terminal principal ${terminal.toUpperCase()}`);
  return source.slice(start, end);
}

function assertOrdered(source: string, anchors: string[], label: string): void {
  let cursor = -1;
  for (const anchor of anchors) {
    const matches = source.split(anchor).length - 1;
    assert.ok(matches >= 1, `${label}: ancla presente: ${anchor}`);
    const next = source.indexOf(anchor, cursor + 1);
    assert.ok(next > cursor, `${label}: orden correcto: ${anchor}`);
    cursor = next;
  }
}

function assertNoSecrets(source: string, label: string): void {
  assert.doesNotMatch(source, /postgres(?:ql)?:\/\//iu, `${label}: sin URI PostgreSQL`);
  assert.doesNotMatch(source, /\b(?:password|passwd|secret|jwt|anon_key|service_role_key)\s*=/iu, `${label}: sin secreto`);
  assert.doesNotMatch(source, /^\\[^\n]+/mu, `${label}: sin metacomandos de cliente`);
}

function assertMigrationOrder(source: string, label: string): void {
  let cursor = source.indexOf("$perf06_history_gate$;");
  assert.ok(cursor >= 0, `${label}: bootstrap histórico protegido`);
  for (const filename of PERF_06_MIGRATIONS as string[]) {
    const match = /^(\d{14})_(.+)\.sql$/u.exec(filename);
    assert.ok(match, `${filename}: nombre válido`);
    const [, version, name] = match;
    const apply = `-- PERF06_SQL_EDITOR_MIGRATION APPLY ${version} ${name}`;
    const history = `-- PERF06_SQL_EDITOR_HISTORY ${version} ${name}`;
    const applyIndex = source.indexOf(apply, cursor + 1);
    const historyIndex = source.indexOf(history, applyIndex + 1);
    assert.ok(applyIndex > cursor, `${label}: aplica ${version} en orden`);
    assert.ok(historyIndex > applyIndex, `${label}: registra ${version} después de ejecutar SQL`);
    assert.equal(source.indexOf(apply, applyIndex + 1), -1, `${label}: aplica ${version} una vez`);
    assert.equal(source.indexOf(history, historyIndex + 1), -1, `${label}: registra ${version} una vez`);
    cursor = historyIndex;
  }
  const secondCompensation = "-- PERF06_SQL_EDITOR_MIGRATION SECOND_COMPENSATION_NOOP 20260811035542 reconcile_legacy_exercise_lineages";
  assert.ok(source.indexOf(secondCompensation, cursor + 1) > cursor, `${label}: segunda compensatoria no-op posterior`);
}

function assertSharedTransaction(source: string, terminal: "commit" | "rollback", label: string): void {
  const body = mainTransaction(source, terminal);
  assertOrdered(body, [
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
    "-- PERF06_SQL_EDITOR_MIGRATION SECOND_COMPENSATION_NOOP 20260811035542 reconcile_legacy_exercise_lineages",
    "set final_snapshot = (",
    "do $perf06_final_gate$",
    "'READY_FOR_TERMINAL'::text as phase",
  ], label);
  assertMigrationOrder(body, label);
  assert.match(body, new RegExp(manifestSha256, "u"), `${label}: manifiesto fijado`);
  assert.match(body, new RegExp(baselineFingerprint, "u"), `${label}: fingerprint baseline fijado`);
  assert.match(body, new RegExp(finalFingerprint, "u"), `${label}: fingerprint final fijado`);
  assert.doesNotMatch(body, /\b(?:drop|alter|truncate)\s+table\s+public\.training_session_consolidation_audit\b/iu, `${label}: diagnóstico no alterado`);
  assert.doesNotMatch(body, /\b(?:insert\s+into|update|delete\s+from)\s+public\.training_session_consolidation_audit\b/iu, `${label}: diagnóstico sin DML`);
}

function assertSemanticContract(artifacts: ArtifactSet): void {
  for (const [key, source] of Object.entries(artifacts)) {
    assert.match(source, new RegExp(projectRef, "u"), `${key}: ref QA explícita`);
    assert.match(source, /PROHIBIDO ejecutar este archivo en PROD/u, `${key}: exclusión PROD explícita`);
    assertNoSecrets(source, key);
  }

  assertSharedTransaction(artifacts.rollback, "rollback", "rollback");
  assertSharedTransaction(artifacts.commit, "commit", "commit");
  assert.equal(mainTransaction(artifacts.rollback, "rollback"), mainTransaction(artifacts.commit, "commit"), "ROLLBACK y COMMIT comparten byte a byte la operación principal");

  assert.equal(commandCount(artifacts.rollback, "commit"), 0, "rollback: cero COMMIT ejecutables");
  assert.equal(commandCount(artifacts.rollback, "rollback"), 2, "rollback: terminal principal y cierre read-only");
  assert.equal(commandCount(artifacts.commit, "commit"), 1, "commit: un único COMMIT ejecutable");
  assert.equal(commandCount(artifacts.commit, "rollback"), 1, "commit: postcheck read-only termina en ROLLBACK");
  assert.equal(commandCount(artifacts.postcheck, "begin"), 1, "postcheck: una transacción");
  assert.equal(commandCount(artifacts.postcheck, "commit"), 0, "postcheck: cero COMMIT");
  assert.equal(commandCount(artifacts.postcheck, "rollback"), 1, "postcheck: ROLLBACK final");
  assert.match(artifacts.postcheck, /begin isolation level read committed read only;/u, "postcheck: READ ONLY explícito");
  const postcheckCommands = splitAndTrim(artifacts.postcheck).map((statement: string) => executableHead(statement).split(/\s+/u)[0]);
  assert.deepEqual(postcheckCommands, ["begin", "set", "set", "with", "rollback"], "postcheck sólo ejecuta BEGIN/SET/SELECT CTE/ROLLBACK");
  assert.match(artifacts.postcheck, /then 'PASS'\s+else 'FAIL'/u, "postcheck publica veredicto explícito");
  assert.match(artifacts.postcheck, /history_versions/u, "postcheck reporta historial");
  assert.match(artifacts.postcheck, /pending_lineages/u, "postcheck reporta lineages");
  assert.match(artifacts.postcheck, /catalog_valid/u, "postcheck reporta catálogo");
}

const generated = buildSqlEditorArtifacts(root);
const artifacts: ArtifactSet = {
  rollback: readArtifact("rollback"),
  commit: readArtifact("commit"),
  postcheck: readArtifact("postcheck"),
};

assert.equal(artifacts.rollback, generated.rollback, "rollback generado determinísticamente");
assert.equal(artifacts.commit, generated.commit, "commit generado determinísticamente");
assert.equal(artifacts.postcheck, generated.postcheck, "postcheck generado determinísticamente");
assert.deepEqual({
  rollback: generated.summary.rollbackSha256,
  commit: generated.summary.commitSha256,
  postcheck: generated.summary.postcheckSha256,
}, expectedArtifactHashes, "hashes de bundles aprobados");
assert.equal(generated.summary.migrations, 24, "24 migraciones");
assert.equal(generated.summary.statements, 336, "336 statements");
assertSemanticContract(artifacts);

const mutations: Array<{ name: string; mutate: (baseline: ArtifactSet) => ArtifactSet }> = [
  {
    name: "rollback cambia terminal principal a COMMIT",
    mutate: (baseline) => ({ ...baseline, rollback: baseline.rollback.replace("\nrollback;\n\nbegin isolation level read committed read only;", "\ncommit;\n\nbegin isolation level read committed read only;") }),
  },
  {
    name: "commit cambia terminal principal a ROLLBACK",
    mutate: (baseline) => ({ ...baseline, commit: baseline.commit.replace("\ncommit;\n\nbegin isolation level read committed read only;", "\nrollback;\n\nbegin isolation level read committed read only;") }),
  },
  {
    name: "elimina primer precheck",
    mutate: (baseline) => ({ ...baseline, rollback: baseline.rollback.replace("insert into pg_temp.perf06_sql_editor_context (initial_snapshot)", "insert into pg_temp.perf06_sql_editor_context (locked_snapshot)") }),
  },
  {
    name: "intercambia locks",
    mutate: (baseline) => ({ ...baseline, rollback: baseline.rollback.replace(
      "lock table auth.users in share mode;\n\nlock table public.exercises in share row exclusive mode;",
      "lock table public.exercises in share row exclusive mode;\n\nlock table auth.users in share mode;",
    ) }),
  },
  {
    name: "registra A antes de ejecutarla",
    mutate: (baseline) => {
      const apply = "-- PERF06_SQL_EDITOR_MIGRATION APPLY 20260810225819 perf_06a_security_hardening";
      const history = "-- PERF06_SQL_EDITOR_HISTORY 20260810225819 perf_06a_security_hardening";
      return {
        ...baseline,
        rollback: baseline.rollback
          .replace(apply, "__PERF06_APPLY_SENTINEL__")
          .replace(history, apply)
          .replace("__PERF06_APPLY_SENTINEL__", history),
      };
    },
  },
  {
    name: "omite gate final",
    mutate: (baseline) => ({ ...baseline, commit: baseline.commit.replace("do $perf06_final_gate$", "do $perf06_final_gate_removed$") }),
  },
  {
    name: "altera fingerprint baseline",
    mutate: (baseline) => ({ ...baseline, rollback: baseline.rollback.replace(baselineFingerprint, "0".repeat(64)) }),
  },
  {
    name: "agrega DROP diagnóstico",
    mutate: (baseline) => ({ ...baseline, commit: baseline.commit.replace("do $perf06_final_gate$", "drop table public.training_session_consolidation_audit;\n\ndo $perf06_final_gate$") }),
  },
  {
    name: "postcheck agrega DML",
    mutate: (baseline) => ({ ...baseline, postcheck: baseline.postcheck.replace("rollback;", "delete from public.profiles;\n\nrollback;") }),
  },
  {
    name: "omite ref QA",
    mutate: (baseline) => ({ ...baseline, postcheck: baseline.postcheck.replaceAll(projectRef, "wrong-project-ref") }),
  },
];

for (const mutation of mutations) {
  const mutated = mutation.mutate(artifacts);
  assert.notDeepEqual(mutated, artifacts, `${mutation.name}: mutación efectiva`);
  assert.throws(() => assertSemanticContract(mutated), `${mutation.name}: contrato la rechaza`);
}

const readme = readFileSync(join(root, operationDirectory, "README.md"), "utf8");
assert.match(readme, new RegExp(projectRef, "u"), "README fija QA");
assert.match(readme, /ROLLBACK_VERIFIED/u, "README exige resultado ROLLBACK");
assert.match(readme, /24 versiones/u, "README documenta historial");
assert.match(readme, /no se reintenta/u, "README detiene ante error");
assert.match(readme, /PROD/u, "README excluye PROD");

process.stdout.write(`PERF-06 SQL Editor bundle contract passed; ${mutations.length} mutation probes killed\n`);
