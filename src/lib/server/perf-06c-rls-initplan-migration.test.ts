import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_PATH =
  "supabase/migrations/20260810230014_perf_06c_rls_initplan.sql";
const MIGRATIONS_DIRECTORY = "supabase/migrations";
const MIGRATION_FILE = MIGRATION_PATH.slice(MIGRATION_PATH.lastIndexOf("/") + 1);

type PolicyCommand = "all" | "select" | "insert" | "update" | "delete";

type PolicyDefinition = {
  schema: "public";
  table: string;
  name: string;
  command: PolicyCommand;
  roles: string[];
  using: string | null;
  withCheck: string | null;
};

const expectedMetadata = [
  ["profiles", "profiles own rows", "all", "public"],
  ["routines", "routines own rows", "all", "public"],
  ["exercises", "exercises own rows", "all", "public"],
  ["training_cycles", "training cycles select own rows", "select", "authenticated"],
  ["training_cycles", "training cycles insert own rows", "insert", "authenticated"],
  ["training_cycles", "training cycles update own rows", "update", "authenticated"],
  ["training_cycle_routines", "training cycle routines select own rows", "select", "public"],
  ["training_cycle_routines", "training cycle routines insert own rows", "insert", "public"],
  ["training_cycle_routines", "training cycle routines update own rows", "update", "public"],
  ["training_cycle_days", "training cycle days select own rows", "select", "authenticated"],
  ["training_cycle_days", "training cycle days insert own rows", "insert", "authenticated"],
  ["training_cycle_days", "training cycle days update own rows", "update", "authenticated"],
  ["training_cycle_exercises", "training cycle exercises select own rows", "select", "authenticated"],
  ["training_cycle_exercises", "training cycle exercises insert own rows", "insert", "authenticated"],
  ["training_cycle_exercises", "training cycle exercises update own rows", "update", "authenticated"],
  ["training_sessions", "sessions own rows", "all", "authenticated"],
  ["exercise_entries", "entries own rows", "all", "authenticated"],
  ["training_daily_readiness", "daily readiness own select", "select", "authenticated"],
  ["training_exercise_lineages", "lineages own rows select", "select", "authenticated"],
  ["training_exercise_lineages", "lineages own rows insert", "insert", "authenticated"],
  ["training_exercise_lineages", "lineages own rows update", "update", "authenticated"],
  ["training_workout_readiness", "workout readiness own select", "select", "authenticated"],
] as const;

function stripSqlComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ");
}

function stripCommentsAndStrings(source: string): string {
  return stripSqlComments(source)
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\$([a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, "$$$$");
}

function normalizeExpression(expression: string | null): string | null {
  return expression?.replace(/\s+/g, "").toLowerCase() ?? null;
}

function extractParenthesizedClause(statement: string, clause: "using" | "with check"): string | null {
  const lower = statement.toLowerCase();
  const clauseIndex = lower.indexOf(clause);
  if (clauseIndex < 0) return null;

  const openIndex = statement.indexOf("(", clauseIndex + clause.length);
  assert.ok(openIndex >= 0, `${clause} debe abrir una expresion parentizada`);

  let depth = 0;
  let inSingleQuote = false;
  for (let index = openIndex; index < statement.length; index += 1) {
    const character = statement[index];
    if (character === "'" && statement[index + 1] === "'" && inSingleQuote) {
      index += 1;
      continue;
    }
    if (character === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (inSingleQuote) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0) return statement.slice(openIndex + 1, index);
  }

  assert.fail(`${clause} debe cerrar su expresion parentizada`);
}

function extractPolicyStatements(source: string, verb: "create" | "alter"): string[] {
  const executable = stripSqlComments(source);
  return executable.match(new RegExp(`${verb}\\s+policy[\\s\\S]*?;`, "gi")) ?? [];
}

function parseRoles(statement: string): string[] {
  const bodyBeforePredicates = statement.split(/\busing\b|\bwith\s+check\b/i, 1)[0];
  const match = bodyBeforePredicates.match(/\bto\s+([\s\S]+)$/i);
  if (!match) return ["public"];
  return match[1]
    .split(",")
    .map((role) => role.trim().replace(/^"|"$/g, "").toLowerCase())
    .filter(Boolean)
    .sort();
}

function parseCreatedPolicy(statement: string): PolicyDefinition | null {
  const identity = statement.match(
    /create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-zA-Z0-9_]+)/i,
  );
  if (!identity) return null;

  const command = statement.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1]
    ?.toLowerCase() as PolicyCommand | undefined;
  assert.ok(command, `comando ausente en ${identity[1]}`);

  return {
    schema: "public",
    table: identity[2].toLowerCase(),
    name: identity[1],
    command,
    roles: parseRoles(statement),
    using: extractParenthesizedClause(statement, "using"),
    withCheck: extractParenthesizedClause(statement, "with check"),
  };
}

function policyKey(policy: Pick<PolicyDefinition, "table" | "name">): string {
  return `${policy.table}:${policy.name}`;
}

function loadEffectivePolicies(): Map<string, PolicyDefinition> {
  const sources = [
    "supabase/schema.sql",
    ...readdirSync(MIGRATIONS_DIRECTORY)
      .filter((file) => file.endsWith(".sql") && file.localeCompare(MIGRATION_FILE) < 0)
      .sort()
      .map((file) => `${MIGRATIONS_DIRECTORY}/${file}`),
  ];

  const effective = new Map<string, PolicyDefinition>();
  for (const sourcePath of sources) {
    const source = readFileSync(sourcePath, "utf8");
    for (const statement of extractPolicyStatements(source, "create")) {
      const policy = parseCreatedPolicy(statement);
      if (policy) effective.set(policyKey(policy), policy);
    }
  }

  const expectedKeys = new Set(expectedMetadata.map(([table, name]) => `${table}:${name}`));
  return new Map([...effective].filter(([key]) => expectedKeys.has(key)));
}

function transformAuthUid(expression: string | null): string | null {
  return expression?.replace(/auth\.uid\s*\(\s*\)/gi, "(select auth.uid())") ?? null;
}

function validateMigration(source: string): void {
  const executable = stripCommentsAndStrings(source);
  const effective = loadEffectivePolicies();
  const metadata = [...effective.values()]
    .map((policy) => [policy.table, policy.name, policy.command, policy.roles.join(",")] as const)
    .sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));
  const expectedSorted = [...expectedMetadata]
    .map(([table, name, command, role]) => [table, name, command, role] as const)
    .sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));

  assert.equal(effective.size, 22, "deben inventariarse exactamente 22 policies publicas efectivas");
  assert.deepEqual(metadata, expectedSorted, "nombre, tabla, comando y roles deben coincidir con las fuentes efectivas");

  const alterStatements = extractPolicyStatements(source, "alter");
  assert.equal(alterStatements.length, 22, "la migracion debe alterar exactamente las 22 policies inventariadas");

  const seen = new Set<string>();
  for (const statement of alterStatements) {
    const identity = statement.match(
      /alter\s+policy\s+"([^"]+)"\s+on\s+public\.([a-zA-Z0-9_]+)/i,
    );
    assert.ok(identity, "cada ALTER POLICY debe apuntar a una tabla del esquema public");
    const key = `${identity![2].toLowerCase()}:${identity![1]}`;
    assert.ok(!seen.has(key), `policy duplicada en la migracion: ${key}`);
    seen.add(key);

    const before = effective.get(key);
    assert.ok(before, `policy no inventariada: ${key}`);
    assert.doesNotMatch(
      statement,
      /\bto\b|\bfor\s+(all|select|insert|update|delete)\b|\brename\s+to\b/i,
      `${key} no puede modificar roles, comando ni nombre`,
    );

    const afterUsing = extractParenthesizedClause(statement, "using");
    const afterWithCheck = extractParenthesizedClause(statement, "with check");
    assert.equal(
      normalizeExpression(afterUsing),
      normalizeExpression(transformAuthUid(before!.using)),
      `USING debe preservar estructuralmente ownership y predicados en ${key}`,
    );
    assert.equal(
      normalizeExpression(afterWithCheck),
      normalizeExpression(transformAuthUid(before!.withCheck)),
      `WITH CHECK debe preservar estructuralmente ownership y predicados en ${key}`,
    );
  }

  assert.deepEqual(seen, new Set(effective.keys()), "la cobertura de policies debe ser exacta");

  const withoutInitplans = executable.replace(
    /\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)/gi,
    "INITPLAN_AUTH_UID",
  );
  assert.doesNotMatch(withoutInitplans, /auth\.uid\s*\(\s*\)/i, "no puede quedar auth.uid() directo");
  assert.doesNotMatch(executable, /auth\.role\s*\(/i, "no puede usar auth.role()");
  assert.doesNotMatch(executable, /security\s+definer/i, "no puede agregar SECURITY DEFINER");
  assert.doesNotMatch(executable, /disable\s+row\s+level\s+security/i, "no puede deshabilitar RLS");
  assert.doesNotMatch(executable, /\bstorage\s*\./i, "no puede modificar policies de Storage");
  assert.doesNotMatch(executable, /\b(create|drop|alter)\s+(unique\s+)?index\b/i, "no puede modificar indices");
  assert.doesNotMatch(executable, /\b(create|drop|alter)\s+table\b/i, "no puede modificar tablas o constraints");
  assert.doesNotMatch(executable, /\b(create|drop)\s+policy\b/i, "debe usar ALTER POLICY controlado");
  assert.doesNotMatch(executable, /\b(grant|revoke|create\s+function|create\s+or\s+replace\s+function)\b/i, "no puede tocar grants ni funciones");

  const executableStatements = executable
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(executableStatements.length, 22, "solo se permiten los 22 ALTER POLICY ejecutables");
  for (const statement of executableStatements) {
    assert.match(statement, /^alter\s+policy\b/i, "cada sentencia ejecutable debe ser ALTER POLICY");
  }
}

function assertMutationRejected(label: string, mutate: (source: string) => string): void {
  let rejected = false;
  try {
    validateMigration(mutate(migration));
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `mutation probe debe fallar: ${label}`);
}

const migration = readFileSync(MIGRATION_PATH, "utf8");

validateMigration(migration);

assertMutationRejected("volver a auth.uid() directo", (source) =>
  source.replace("(select auth.uid())", "auth.uid()"),
);
assertMutationRejected("eliminar ownership", (source) =>
  source.replace("(select auth.uid()) = id", "true"),
);
assertMutationRejected("eliminar WITH CHECK", (source) =>
  source.replace("\n  with check ((select auth.uid()) = id)", ""),
);
assertMutationRejected("cambiar roles", (source) =>
  source.replace("on public.profiles\n  using", "on public.profiles\n  to authenticated\n  using"),
);
assertMutationRejected("convertir a FOR ALL", (source) =>
  source.replace("on public.training_cycles\n  using", "on public.training_cycles\n  for all\n  using"),
);
assertMutationRejected("agregar condicion permisiva", (source) =>
  source.replace("(select auth.uid()) = id", "((select auth.uid()) = id or true)"),
);
assertMutationRejected("deshabilitar RLS", (source) =>
  `${source}\nalter table public.profiles disable row level security;\n`,
);
assertMutationRejected("aceptar initplan solo en comentario o string", (source) => {
  const directAuthUid = source.replace(/\(\s*select\s+auth\.uid\s*\(\s*\)\s*\)/gi, "auth.uid()");
  return `-- (select auth.uid())\nselect '(select auth.uid())';\n${directAuthUid}`;
});

console.log("PERF-06C RLS initplan migration contract and mutation probes passed");
