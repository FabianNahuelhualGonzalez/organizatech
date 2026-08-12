#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { HISTORICAL_MIGRATIONS, splitAndTrim } from "./perf-06-migration-manifest.mjs";
import { parseConnection } from "./perf-06-atomic-runner.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bootstrapPath = resolve(repositoryRoot, "supabase/operations/qa/perf-06-atomic/local-validation-bootstrap.sql");
const fingerprintPath = resolve(repositoryRoot, "supabase/diagnostics/perf-06-schema-fingerprint.sql");
const EXPECTED_BASELINE_COUNT = 346;
const EXPECTED_BASELINE_FINGERPRINT = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function phases(source) {
  invariant(!/^\\[^\n]+/mu.test(source), "Bootstrap contains a forbidden client metacommand");
  const matches = [...source.matchAll(/^-- PERF06_BOOTSTRAP_PHASE ([a-z_]+)\n([\s\S]*?)(?=^-- PERF06_BOOTSTRAP_PHASE [a-z_]+\n|(?![\s\S]))/gmu)];
  const result = Object.fromEntries(matches.map(([, name, sql]) => [name, splitAndTrim(sql)]));
  invariant(result.before_schema?.length > 0 && result.after_history?.length > 0, "Bootstrap phases are incomplete");
  return result;
}

async function executeStatements(client, statements) {
  for (const statement of statements) await client.query(statement);
}

async function main() {
  invariant(process.argv.length === 2, "The local bootstrap accepts no arguments");
  const connection = parseConnection({ localValidation: true });
  const client = new pg.Client({ ...connection, application_name: "organizatech-perf-06-local-bootstrap" });
  try {
    await client.connect();
    const bootstrap = phases(readFileSync(bootstrapPath, "utf8"));
    await executeStatements(client, bootstrap.before_schema);
    await executeStatements(client, splitAndTrim(readFileSync(resolve(repositoryRoot, "supabase/schema.sql"), "utf8")));
    for (const filename of HISTORICAL_MIGRATIONS) {
      await executeStatements(client, splitAndTrim(readFileSync(resolve(repositoryRoot, "supabase/migrations", filename), "utf8")));
    }
    await executeStatements(client, bootstrap.after_history);
    const fingerprintSql = splitAndTrim(readFileSync(fingerprintPath, "utf8"));
    invariant(fingerprintSql.length === 1, "Fingerprint query cardinality failed");
    const result = await client.query(fingerprintSql[0]);
    const overall = result.rows.find((row) => row.category === "OVERALL");
    invariant(Number(overall?.item_count) === EXPECTED_BASELINE_COUNT, "Local baseline item count differs");
    invariant(overall?.sha256 === EXPECTED_BASELINE_FINGERPRINT, "Local baseline fingerprint differs");
    process.stdout.write(`PERF06 local bootstrap PASS fingerprint=${EXPECTED_BASELINE_FINGERPRINT}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`PERF06 local bootstrap FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
