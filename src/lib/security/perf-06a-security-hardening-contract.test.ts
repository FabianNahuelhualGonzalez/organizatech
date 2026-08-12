import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const canonicalMigrationPath = "supabase/migrations/20260810225819_perf_06a_security_hardening.sql";
const migrationPath = process.env.PERF_06A_MIGRATION_PATH ?? canonicalMigrationPath;
const contractPath = "src/lib/security/perf-06a-security-hardening-contract.test.ts";
const migration = readFileSync(migrationPath, "utf8");
const contractSource = readFileSync(contractPath, "utf8");
const baselineSchema = readFileSync("supabase/schema.sql", "utf8");
const targetTables = ["profiles", "routines", "exercises"] as const;
type TargetTable = typeof targetTables[number];

const guardFunction = "prevent_exercise_identity_change";
const guardTrigger = "exercises_prevent_identity_change";
const revokedRoles = ["public", "anon", "authenticated"] as const;

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

const originalMigrationSha = sha256(migration);
const originalContractSha = sha256(contractSource);

/**
 * Masks comments, single-quoted literals and dollar-quoted bodies with spaces,
 * preserving byte offsets so the masked text can drive statement splitting while
 * the original text stays available for body inspection. Nothing hidden inside a
 * comment or a string can ever be read back as executable wiring.
 */
function maskSql(source: string): { masked: string; lexicalErrors: string[] } {
  let result = "";
  let index = 0;
  let blockDepth = 0;
  const lexicalErrors: string[] = [];

  const blank = (count: number) => " ".repeat(count);

  while (index < source.length) {
    if (blockDepth > 0) {
      if (source.startsWith("/*", index)) {
        blockDepth += 1;
        result += blank(2);
        index += 2;
      } else if (source.startsWith("*/", index)) {
        blockDepth -= 1;
        result += blank(2);
        index += 2;
      } else {
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }

    if (source.startsWith("--", index)) {
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }

    if (source.startsWith("/*", index)) {
      blockDepth = 1;
      result += blank(2);
      index += 2;
      continue;
    }

    const dollarOpen = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(source.slice(index));
    if (dollarOpen) {
      const tag = dollarOpen[0];
      const close = source.indexOf(tag, index + tag.length);
      const end = close === -1 ? source.length : close + tag.length;
      for (let cursor = index; cursor < end; cursor += 1) {
        result += source[cursor] === "\n" ? "\n" : " ";
      }
      index = end;
      if (close === -1) lexicalErrors.push(`dollar quote sin cierre: ${tag}`);
      continue;
    }

    if (source[index] === "'") {
      result += " ";
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          result += blank(2);
          index += 2;
        } else if (source[index] === "'") {
          result += " ";
          index += 1;
          closed = true;
          break;
        } else {
          result += source[index] === "\n" ? "\n" : " ";
          index += 1;
        }
      }
      if (!closed) lexicalErrors.push("literal SQL sin cierre");
      continue;
    }

    result += source[index];
    index += 1;
  }

  if (blockDepth > 0) lexicalErrors.push("comentario de bloque sin cierre");
  return { masked: result, lexicalErrors };
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

type Statement = { code: string; raw: string };

function splitStatements(source: string): { statements: Statement[]; unterminated: boolean } {
  const { masked, lexicalErrors } = maskSql(source);
  const statements: Statement[] = [];
  let start = 0;

  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== ";") continue;
    const code = collapse(masked.slice(start, index));
    if (code) statements.push({ code, raw: source.slice(start, index) });
    start = index + 1;
  }

  return {
    statements,
    unterminated: lexicalErrors.length > 0 || collapse(masked.slice(start)).length > 0,
  };
}

type ColumnSet = Set<string>;
const allColumns = "*";

type EffectiveState = {
  tableGrants: Map<string, Map<string, ColumnSet>>;
  functionExecute: Map<string, boolean>;
  functionSearchPath: Map<string, string>;
  functionSecurity: Map<string, string>;
  functionBody: Map<string, string>;
  functionDefinitions: Array<{ name: string; statement: number }>;
  triggers: Map<string, { timing: string; events: string; columns: string | null; level: string; fn: string }>;
  droppedTriggers: Set<string>;
  rlsChanges: Array<{ table: string; action: string }>;
  policyTouched: boolean;
  unrecognized: string[];
};

function emptyState(): EffectiveState {
  return {
    tableGrants: new Map(),
    functionExecute: new Map(),
    functionSearchPath: new Map(),
    functionSecurity: new Map(),
    functionBody: new Map(),
    functionDefinitions: [],
    triggers: new Map(),
    droppedTriggers: new Set(),
    rlsChanges: [],
    policyTouched: false,
    unrecognized: [],
  };
}

function grantKey(role: string, table: string) {
  return `${role}:${table}`;
}

function parsePrivileges(list: string): Array<{ privilege: string; columns: string[] | null }> | null {
  const parsed: Array<{ privilege: string; columns: string[] | null }> = [];
  const pattern = /(select|insert|update|delete)\s*(?:\(([^)]*)\))?/g;
  let consumed = 0;
  for (const match of list.matchAll(pattern)) {
    consumed += match[0].length;
    parsed.push({
      privilege: match[1],
      columns: match[2] === undefined
        ? null
        : match[2].split(",").map((column) => column.trim()).filter(Boolean),
    });
  }
  const separators = (list.match(/,\s*(?=select|insert|update|delete)/g) ?? []).length;
  if (parsed.length === 0) return null;
  if (consumed + separators * 2 < list.replace(/\s+/g, " ").length - 2) return null;
  return parsed;
}

function extractDollarBody(raw: string): string | null {
  const match = /\$([A-Za-z_][A-Za-z_0-9]*|)\$([\s\S]*?)\$\1\$/.exec(raw);
  return match ? match[2] : null;
}

/** Replays every statement in order and returns only the resulting final state. */
function replay(source: string): EffectiveState {
  const state = emptyState();
  const { statements, unterminated } = splitStatements(source);
  if (unterminated) state.unrecognized.push("<sentencia sin terminar>");

  for (const [statementIndex, { code, raw }] of statements.entries()) {
    let match: RegExpExecArray | null;

    const functionHeader = /^create (?:or replace )?function ([a-z_]+\.[a-z_]+)\s*\(/.exec(code);
    if (functionHeader) {
      state.functionDefinitions.push({ name: functionHeader[1], statement: statementIndex + 1 });
    }

    if ((match = /^revoke all(?: privileges)? on table ([a-z_]+\.[a-z_]+) from ([a-z_]+)$/.exec(code))) {
      state.tableGrants.delete(grantKey(match[2], match[1]));
      state.tableGrants.set(grantKey(match[2], match[1]), new Map());
      continue;
    }

    if ((match = /^grant (.+?) on table ([a-z_]+\.[a-z_]+) to ([a-z_]+)$/.exec(code))) {
      const privileges = parsePrivileges(match[1]);
      if (!privileges) {
        state.unrecognized.push(code);
        continue;
      }
      const key = grantKey(match[3], match[2]);
      const current = state.tableGrants.get(key) ?? new Map<string, ColumnSet>();
      for (const { privilege, columns } of privileges) {
        const existing = current.get(privilege) ?? new Set<string>();
        if (columns === null) existing.add(allColumns);
        else for (const column of columns) existing.add(column);
        current.set(privilege, existing);
      }
      state.tableGrants.set(key, current);
      continue;
    }

    if ((match = /^revoke (?:all(?: privileges)?|execute) on function ([a-z_]+\.[a-z_]+)\(\) from ([a-z_]+)$/.exec(code))) {
      state.functionExecute.set(`${match[2]}:${match[1]}`, false);
      continue;
    }

    if ((match = /^grant execute on function ([a-z_]+\.[a-z_]+)\(\) to ([a-z_]+)$/.exec(code))) {
      state.functionExecute.set(`${match[2]}:${match[1]}`, true);
      continue;
    }

    if ((match = /^alter function ([a-z_]+\.[a-z_]+)\(\) set search_path = (.+)$/.exec(code))) {
      state.functionSearchPath.set(match[1], match[2].trim());
      continue;
    }

    if ((match = /^create (?:or replace )?function ([a-z_]+\.[a-z_]+)\(\) returns trigger language plpgsql(?: security (invoker|definer))?(?: set search_path = ([a-z_0-9, ]+?))? as$/.exec(code))) {
      const name = match[1];
      state.functionSecurity.set(name, match[2] ?? "definer-default");
      if (match[3]) state.functionSearchPath.set(name, match[3].trim());
      const body = extractDollarBody(raw);
      if (body === null) {
        state.unrecognized.push(code);
        continue;
      }
      state.functionBody.set(name, body);
      continue;
    }

    // A statement whose executable portion is only SELECT plus masked literals
    // is inert test noise. Any executable expression after SELECT remains unknown.
    if (code === "select") continue;

    if ((match = /^create trigger ([a-z_]+) (before|after|instead of) ([a-z ,]+?)(?: of ([a-z_, ]+))? on ([a-z_]+\.[a-z_]+) for each (row|statement) execute (?:function|procedure) ([a-z_]+\.[a-z_]+)\(\)$/.exec(code))) {
      state.triggers.set(`${match[5]}:${match[1]}`, {
        timing: match[2],
        events: match[3].trim(),
        columns: match[4] ? match[4].trim() : null,
        level: match[6],
        fn: match[7],
      });
      state.droppedTriggers.delete(`${match[5]}:${match[1]}`);
      continue;
    }

    if ((match = /^drop trigger (?:if exists )?([a-z_]+) on ([a-z_]+\.[a-z_]+)$/.exec(code))) {
      state.triggers.delete(`${match[2]}:${match[1]}`);
      state.droppedTriggers.add(`${match[2]}:${match[1]}`);
      continue;
    }

    if ((match = /^drop function (?:if exists )?([a-z_]+\.[a-z_]+)\(\)(?: cascade| restrict)?$/.exec(code))) {
      state.functionBody.delete(match[1]);
      state.functionSecurity.delete(match[1]);
      state.functionSearchPath.delete(match[1]);
      continue;
    }

    if ((match = /^alter table ([a-z_]+\.[a-z_]+) (enable|disable|force|no force) row level security$/.exec(code))) {
      state.rlsChanges.push({ table: match[1], action: match[2] });
      continue;
    }

    if (/^(create|drop|alter) policy\b/.test(code)) {
      state.policyTouched = true;
      continue;
    }

    state.unrecognized.push(code);
  }

  return state;
}

const expectedAuthenticatedGrants: Record<TargetTable, Record<string, string[]>> = {
  profiles: {
    select: [allColumns],
    insert: ["id", "display_name", "email", "gender"],
    update: [
      "display_name",
      "email",
      "first_name",
      "last_name",
      "birth_date",
      "gender",
      "phone_number",
      "avatar_path",
      "avatar_updated_at",
    ],
  },
  routines: {
    select: [allColumns],
    insert: ["user_id", "name"],
  },
  exercises: {
    select: [allColumns],
    insert: [
      "id",
      "user_id",
      "routine_id",
      "name",
      "target_sets",
      "target_reps",
      "base_weight",
      "side_weight",
      "day",
      "notes",
    ],
    update: [
      "id",
      "user_id",
      "routine_id",
      "name",
      "target_sets",
      "target_reps",
      "base_weight",
      "side_weight",
      "day",
      "notes",
    ],
    delete: [allColumns],
  },
};

function serializeGrantMap(grants: Map<string, ColumnSet> | undefined): string {
  if (!grants) return "<sin estado>";
  return [...grants.entries()]
    .filter(([, columns]) => columns.size > 0)
    .map(([privilege, columns]) => `${privilege}(${[...columns].sort().join(",")})`)
    .sort()
    .join(" ");
}

function serializeExpected(expected: Record<string, string[]>): string {
  return Object.entries(expected)
    .map(([privilege, columns]) => `${privilege}(${[...columns].sort().join(",")})`)
    .sort()
    .join(" ");
}

function stripComments(source: string): string {
  return source.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function stripCommentsAndStrings(source: string): string {
  return stripComments(source).replace(/'(?:[^']|'')*'/g, " ");
}

function analyzeMigration(source: string): string[] {
  const violations: string[] = [];
  const state = replay(source);
  const masked = collapse(maskSql(source).masked);

  // --- Textual guards that must hold even inside comments -------------------
  if (/\bservice_role\b/i.test(source)) violations.push("SERVICE_ROLE_MENTION");
  if (/\bgrant\s+all(?:\s+privileges)?\b/.test(masked)) violations.push("GRANT_ALL");

  // --- Every statement must be understood by the replayer -------------------
  for (const statement of state.unrecognized) {
    violations.push(`UNRECOGNIZED_STATEMENT:${statement.slice(0, 60)}`);
  }

  // --- Function definitions: the migration creates one guard and nothing else
  const allowedFunction = `public.${guardFunction}`;
  for (const definition of state.functionDefinitions) {
    if (definition.name !== allowedFunction) {
      violations.push(`FUNCTION_DEFINITION_FORBIDDEN_${definition.name}@${definition.statement}`);
    }
  }
  if (state.functionDefinitions.filter(({ name }) => name === allowedFunction).length !== 1) {
    violations.push("IDENTITY_GUARD_DEFINITION_COUNT");
  }

  // --- Final table ACL state ------------------------------------------------
  for (const table of targetTables) {
    const anon = state.tableGrants.get(grantKey("anon", `public.${table}`));
    if (!anon) violations.push(`ANON_STATE_MISSING_${table}`);
    else if (serializeGrantMap(anon) !== "") violations.push(`ANON_PRIVILEGE_${table}`);

    const authenticated = state.tableGrants.get(grantKey("authenticated", `public.${table}`));
    if (serializeGrantMap(authenticated) !== serializeExpected(expectedAuthenticatedGrants[table])) {
      violations.push(`AUTHENTICATED_GRANTS_${table}`);
    }
  }

  for (const key of state.tableGrants.keys()) {
    const [role, table] = key.split(":");
    if (role === "public") violations.push("PUBLIC_TABLE_ACL_TOUCHED");
    else if (role !== "anon" && role !== "authenticated") violations.push(`UNEXPECTED_ROLE_${role}`);
    if (!targetTables.some((target) => `public.${target}` === table)) {
      violations.push(`UNEXPECTED_TABLE_${table}`);
    }
  }

  // --- Final EXECUTE state on the touched functions -------------------------
  for (const fn of [`public.${guardFunction}`, "public.handle_new_user"]) {
    for (const role of revokedRoles) {
      const effective = state.functionExecute.get(`${role}:${fn}`);
      if (effective !== false) violations.push(`FUNCTION_EXECUTE_${fn.replace("public.", "")}_${role}`);
    }
  }

  // --- Final search_path state ---------------------------------------------
  if (state.functionSearchPath.get("public.set_updated_at") !== "pg_catalog") {
    violations.push("SET_UPDATED_AT_SEARCH_PATH");
  }
  if (state.functionSearchPath.get(`public.${guardFunction}`) !== "pg_catalog") {
    violations.push("IDENTITY_GUARD_SEARCH_PATH");
  }
  if (state.functionSecurity.get(`public.${guardFunction}`) !== "invoker") {
    violations.push("IDENTITY_GUARD_SECURITY");
  }
  if (/\bsecurity\s+definer\b/.test(masked)) violations.push("NEW_SECURITY_DEFINER");

  // --- Final identity-guard body -------------------------------------------
  const body = state.functionBody.get(`public.${guardFunction}`);
  if (!body) {
    violations.push("IDENTITY_GUARD_MISSING");
  } else {
    const executable = collapse(stripCommentsAndStrings(body));
    const withStrings = collapse(stripComments(body));
    const protectsId = executable.includes("if new.id is distinct from old.id then raise exception using");
    const protectsOwner = executable.includes("if new.user_id is distinct from old.user_id then raise exception using");
    const controlledErrors = (withStrings.match(/errcode = '42501'/g) ?? []).length;
    if (!protectsId || !protectsOwner || controlledErrors < 2) violations.push("IDENTITY_GUARD_BODY");
  }

  // --- Final trigger wiring: exactly one canonical mechanism ----------------
  const exerciseTriggers = [...state.triggers.entries()].filter(([key]) => key.startsWith("public.exercises:"));
  if (exerciseTriggers.length !== 1) {
    violations.push("IDENTITY_TRIGGER_NOT_CANONICAL");
  }
  const canonical = state.triggers.get(`public.exercises:${guardTrigger}`);
  if (!canonical) {
    violations.push("IDENTITY_TRIGGER_MISSING");
  } else {
    if (canonical.timing !== "before") violations.push("IDENTITY_TRIGGER_TIMING");
    if (canonical.events !== "update") violations.push("IDENTITY_TRIGGER_EVENT");
    if (canonical.columns !== null) violations.push("IDENTITY_TRIGGER_COLUMN_SCOPED");
    if (canonical.level !== "row") violations.push("IDENTITY_TRIGGER_LEVEL");
    if (canonical.fn !== `public.${guardFunction}`) violations.push("IDENTITY_TRIGGER_FUNCTION");
  }

  // --- Untouched surfaces ---------------------------------------------------
  if (state.droppedTriggers.has("auth.users:on_auth_user_created")) violations.push("AUTH_TRIGGER_TOUCHED");
  if (/drop\s+function\s+(?:if\s+exists\s+)?public\.handle_new_user\b/.test(masked)) {
    violations.push("AUTH_TRIGGER_TOUCHED");
  }
  if (state.rlsChanges.some((change) => change.action === "disable")) violations.push("RLS_DISABLED");
  if (state.rlsChanges.length > 0) violations.push("RLS_TOUCHED");
  if (state.policyTouched) violations.push("POLICY_TOUCHED");
  if (/\bstorage\s*\./.test(masked)) violations.push("STORAGE_TOUCHED");
  if (/\b(?:training_sessions|exercise_entries)\b/.test(masked)) violations.push("PROTECTED_TRAINING_TABLE_TOUCHED");

  return [...new Set(violations)];
}

assert.deepEqual(analyzeMigration(migration), [], "la migración cumple el contrato PERF-06A");

for (const table of targetTables) {
  assert.match(
    baselineSchema,
    new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    `RLS permanece habilitado en ${table}`,
  );
}
assert.match(
  baselineSchema,
  /create trigger on_auth_user_created[\s\S]*?on auth\.users[\s\S]*?execute function public\.handle_new_user\(\)/i,
  "el trigger interno de handle_new_user permanece definido",
);
assert.doesNotMatch(migration, /create\s+policy|drop\s+policy|alter\s+policy/i, "las policies RLS no cambian");

// The identity guard must cover both columns the productive upsert can replay.
assert.ok(
  expectedAuthenticatedGrants.exercises.update.includes("id") &&
    expectedAuthenticatedGrants.exercises.update.includes("user_id"),
  "el UPSERT sigue siendo posible aunque PostgREST reproduzca id y user_id en ON CONFLICT DO UPDATE",
);

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listProductionTypeScriptFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [path];
  });
}

function findFromTable(expression: ts.Expression): string | null {
  if (ts.isCallExpression(expression)) {
    if (
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === "from" &&
      expression.arguments.length === 1 &&
      ts.isStringLiteral(expression.arguments[0])
    ) {
      return expression.arguments[0].text;
    }
    return findFromTable(expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) return findFromTable(expression.expression);
  if (ts.isParenthesizedExpression(expression)) return findFromTable(expression.expression);
  return null;
}

const frontendWrites: string[] = [];
for (const file of listProductionTypeScriptFiles("src")) {
  const sourceText = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["insert", "update", "upsert", "delete"].includes(node.expression.name.text)
    ) {
      const table = findFromTable(node.expression.expression);
      if (table && targetTables.includes(table as TargetTable)) {
        const argument = node.arguments[0]?.getText(sourceFile).replace(/\s+/g, " ") ?? "";
        frontendWrites.push([
          relative(".", file),
          table,
          node.expression.name.text,
          argument,
        ].join("|"));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

assert.deepEqual(frontendWrites.sort(), [
  "src/lib/data/repository.ts|exercises|delete|",
  "src/lib/data/repository.ts|exercises|update|{ notes: nextNotes }",
  "src/lib/data/repository.ts|exercises|upsert|payload",
  "src/lib/data/repository.ts|exercises|upsert|payloadWithoutDay",
  "src/lib/data/repository.ts|profiles|insert|decision.payload",
  "src/lib/data/repository.ts|profiles|update|{ email: decision.email }",
  "src/lib/data/repository.ts|routines|insert|{ user_id: userId, name: routine }",
  "src/lib/profile/profile-avatar-repository.ts|profiles|update|buildProfileAvatarDeletePayload()",
  "src/lib/profile/profile-avatar-repository.ts|profiles|update|updatePayload",
  "src/lib/profile/profile-repository.ts|profiles|update|validation.payload",
].sort(), "todas las escrituras frontend objetivo están inventariadas y usan payloads acotados");

function objectKeySets(path: string): string[][] {
  const sourceText = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const sets: string[][] = [];

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = node.properties.map((property) => {
        if (ts.isSpreadAssignment(property)) return "...spread";
        if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
          return property.name.text;
        }
        return "...unknown";
      }).sort();
      sets.push(keys);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return sets;
}

function assertContainsAllowlist(path: string, expected: string[], label: string) {
  const normalizedExpected = [...expected].sort();
  assert.ok(
    objectKeySets(path).some((keys) => JSON.stringify(keys) === JSON.stringify(normalizedExpected)),
    `${label}: payload explícito ${normalizedExpected.join(", ")}`,
  );
}

assertContainsAllowlist(
  "src/lib/data/repository.ts",
  ["id", "user_id", "routine_id", "name", "target_sets", "target_reps", "base_weight", "side_weight", "day", "notes"],
  "exercise upsert",
);
assertContainsAllowlist("src/lib/data/repository.ts", ["user_id", "name"], "routine insert");
assertContainsAllowlist(
  "src/lib/profile/profile-form.ts",
  ["first_name", "last_name", "birth_date", "gender", "phone_number", "display_name"],
  "profile personal update",
);
assertContainsAllowlist(
  "src/lib/profile/profile-form.ts",
  ["id", "email", "display_name", "gender"],
  "profile fallback insert",
);
assertContainsAllowlist(
  "src/lib/profile/profile-avatar.ts",
  ["avatar_path", "avatar_updated_at"],
  "profile avatar metadata update",
);

const userIdOnlyGuard = `
create or replace function public.${guardFunction}()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'exercise ownership cannot be changed';
  end if;
  return new;
end;
$function$;
`;

const handleNewUserEmptyDefinition = `
create function public.handle_new_user()
returns trigger
language plpgsql
as $function$
$function$;
`;

const handleNewUserInvokerRedefinition = `
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security invoker
as $function$
begin
  return new;
end;
$function$;
`;

const setUpdatedAtArbitraryRedefinition = `
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
begin
  new.updated_at = null;
  return new;
end;
$function$;
`;

const setUpdatedAtSafeLookingRedefinition = `
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$function$;
`;

function replaceExactlyOnce(source: string, anchor: string, replacement: string): string {
  const first = source.indexOf(anchor);
  assert.notEqual(first, -1, `ancla de mutación ausente: ${anchor.slice(0, 80)}`);
  assert.equal(
    source.indexOf(anchor, first + anchor.length),
    -1,
    `ancla de mutación repetida: ${anchor.slice(0, 80)}`,
  );
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

function freshProbeCopies(probeName: string): { migrationCopy: string; contractCopy: string } {
  const migrationCopy = Buffer.from(readFileSync(migrationPath)).toString("utf8");
  const contractCopy = Buffer.from(readFileSync(contractPath)).toString("utf8");
  assert.equal(sha256(migrationCopy), originalMigrationSha, `${probeName}: copia SHA-256 de migración original`);
  assert.equal(sha256(contractCopy), originalContractSha, `${probeName}: copia SHA-256 de contrato original`);
  return { migrationCopy, contractCopy };
}

function assertProbeSourcesRestored(probeName: string): void {
  assert.equal(
    sha256(readFileSync(migrationPath, "utf8")),
    originalMigrationSha,
    `${probeName}: restauración SHA-256 exacta de migración`,
  );
  assert.equal(
    sha256(readFileSync(contractPath, "utf8")),
    originalContractSha,
    `${probeName}: restauración SHA-256 exacta de contrato`,
  );
}

const mutationProbes: Array<{
  name: string;
  mutate: (source: string) => string;
  expectedViolation: string;
}> = [
  {
    name: "revoke anon convertido en comentario",
    mutate: (source) => replaceExactlyOnce(
      source,
      "revoke all privileges on table public.profiles from anon;",
      "-- revoke all privileges on table public.profiles from anon;",
    ),
    expectedViolation: "ANON_STATE_MISSING_profiles",
  },
  {
    name: "revoke handle_new_user falsificado dentro de string",
    mutate: (source) => replaceExactlyOnce(
      source,
      "revoke execute on function public.handle_new_user() from authenticated;",
      "select 'revoke execute on function public.handle_new_user() from authenticated;';",
    ),
    expectedViolation: "FUNCTION_EXECUTE_handle_new_user_authenticated",
  },
  {
    name: "search_path seguro falsificado dentro de bloque comentado",
    mutate: (source) => replaceExactlyOnce(
      source,
      "alter function public.set_updated_at() set search_path = pg_catalog;",
      "/* alter function public.set_updated_at() set search_path = pg_catalog; */\nalter function public.set_updated_at() set search_path = public;",
    ),
    expectedViolation: "SET_UPDATED_AT_SEARCH_PATH",
  },
  {
    name: "grant all a anon",
    mutate: (source) => `${source}\ngrant all privileges on table public.profiles to anon;\n`,
    expectedViolation: "GRANT_ALL",
  },
  {
    name: "guard de identidad neutralizado",
    mutate: (source) => replaceExactlyOnce(
      source,
      "if new.id is distinct from old.id then",
      "if false then",
    ),
    expectedViolation: "IDENTITY_GUARD_BODY",
  },
  {
    name: "guard de ownership neutralizado",
    mutate: (source) => replaceExactlyOnce(
      source,
      "if new.user_id is distinct from old.user_id then",
      "if false then",
    ),
    expectedViolation: "IDENTITY_GUARD_BODY",
  },
  {
    name: "trigger de auth eliminado con texto señuelo",
    mutate: (source) => `${source}\n-- trigger preserved\ndrop trigger on_auth_user_created on auth.users;\n`,
    expectedViolation: "AUTH_TRIGGER_TOUCHED",
  },
  {
    name: "RLS deshabilitado",
    mutate: (source) => `${source}\nalter table public.routines disable row level security;\n`,
    expectedViolation: "RLS_DISABLED",
  },
  {
    name: "mención de rol fuera de alcance incluso en comentario",
    mutate: (source) => `${source}\n-- service_role\n`,
    expectedViolation: "SERVICE_ROLE_MENTION",
  },
  {
    name: "ACL de tabla PUBLIC fuera de alcance",
    mutate: (source) => `${source}\nrevoke all privileges on table public.exercises from public;\n`,
    expectedViolation: "PUBLIC_TABLE_ACL_TOUCHED",
  },
  {
    name: "cambio de Storage",
    mutate: (source) => `${source}\nalter table storage.objects disable row level security;\n`,
    expectedViolation: "STORAGE_TOUCHED",
  },
  {
    name: "ownership agregado al allowlist de profiles update",
    mutate: (source) => replaceExactlyOnce(
      source,
      "grant update (\n  display_name,",
      "grant update (\n  id,\n  display_name,",
    ),
    expectedViolation: "AUTHENTICATED_GRANTS_profiles",
  },
  // --- Mutaciones de orden: el estado final es lo que importa ---------------
  {
    name: "GRANT EXECUTE de handle_new_user a anon agregado al final",
    mutate: (source) => `${source}\ngrant execute on function public.handle_new_user() to anon;\n`,
    expectedViolation: "FUNCTION_EXECUTE_handle_new_user_anon",
  },
  {
    name: "GRANT EXECUTE de handle_new_user a authenticated agregado al final",
    mutate: (source) => `${source}\ngrant execute on function public.handle_new_user() to authenticated;\n`,
    expectedViolation: "FUNCTION_EXECUTE_handle_new_user_authenticated",
  },
  {
    name: "GRANT EXECUTE de la función protectora agregado al final",
    mutate: (source) => `${source}\ngrant execute on function public.${guardFunction}() to authenticated;\n`,
    expectedViolation: `FUNCTION_EXECUTE_${guardFunction}_authenticated`,
  },
  {
    name: "ALTER FUNCTION set_updated_at con search_path inseguro al final",
    mutate: (source) => `${source}\nalter function public.set_updated_at() set search_path = public;\n`,
    expectedViolation: "SET_UPDATED_AT_SEARCH_PATH",
  },
  {
    name: "search_path del guard debilitado al final",
    mutate: (source) => `${source}\nalter function public.${guardFunction}() set search_path = public, pg_catalog;\n`,
    expectedViolation: "IDENTITY_GUARD_SEARCH_PATH",
  },
  {
    name: "DROP TRIGGER del mecanismo de identidad al final",
    mutate: (source) => `${source}\ndrop trigger ${guardTrigger} on public.exercises;\n`,
    expectedViolation: "IDENTITY_TRIGGER_MISSING",
  },
  {
    name: "reemplazo posterior por guard que sólo protege user_id",
    mutate: (source) => `${source}\n${userIdOnlyGuard}`,
    expectedViolation: "IDENTITY_GUARD_BODY",
  },
  {
    name: "reemplazo posterior por trigger acotado a user_id",
    mutate: (source) => `${source}\ndrop trigger ${guardTrigger} on public.exercises;\ncreate trigger ${guardTrigger}\n  before update of user_id on public.exercises\n  for each row execute function public.${guardFunction}();\n`,
    expectedViolation: "IDENTITY_TRIGGER_COLUMN_SCOPED",
  },
  {
    name: "segundo trigger paralelo sobre exercises",
    mutate: (source) => `${source}\ncreate trigger exercises_shadow_guard\n  before update on public.exercises\n  for each row execute function public.${guardFunction}();\n`,
    expectedViolation: "IDENTITY_TRIGGER_NOT_CANONICAL",
  },
  {
    name: "GRANT UPDATE ampliado al final",
    mutate: (source) => `${source}\ngrant update (created_at) on table public.exercises to authenticated;\n`,
    expectedViolation: "AUTHENTICATED_GRANTS_exercises",
  },
  {
    name: "re-grant de tabla a anon al final",
    mutate: (source) => `${source}\ngrant select on table public.exercises to anon;\n`,
    expectedViolation: "ANON_PRIVILEGE_exercises",
  },
  {
    name: "cambio de service_role al final",
    mutate: (source) => `${source}\ngrant select on table public.profiles to service_role;\n`,
    expectedViolation: "SERVICE_ROLE_MENTION",
  },
  {
    name: "sentencia desconocida fuera del modelo (default privileges)",
    mutate: (source) => `${source}\nalter default privileges in schema public grant select on tables to anon;\n`,
    expectedViolation: "UNRECOGNIZED_STATEMENT:alter default privileges",
  },
  {
    name: "id retirado del allowlist UPDATE de exercises",
    mutate: (source) => replaceExactlyOnce(
      source,
      "grant update (\n  id,\n  user_id,",
      "grant update (\n  user_id,",
    ),
    expectedViolation: "AUTHENTICATED_GRANTS_exercises",
  },
  // --- Redefiniciones tardías: nunca pueden sustituir rutinas preexistentes --
  {
    name: "redefinición posterior de handle_new_user con cuerpo vacío",
    mutate: (source) => `${source}\n${handleNewUserEmptyDefinition}`,
    expectedViolation: "FUNCTION_DEFINITION_FORBIDDEN_public.handle_new_user",
  },
  {
    name: "redefinición posterior de handle_new_user como SECURITY INVOKER",
    mutate: (source) => `${source}\n${handleNewUserInvokerRedefinition}`,
    expectedViolation: "FUNCTION_DEFINITION_FORBIDDEN_public.handle_new_user",
  },
  {
    name: "redefinición posterior de set_updated_at con cuerpo arbitrario",
    mutate: (source) => `${source}\n${setUpdatedAtArbitraryRedefinition}`,
    expectedViolation: "FUNCTION_DEFINITION_FORBIDDEN_public.set_updated_at",
  },
  {
    name: "redefinición posterior de set_updated_at con search_path aparentemente seguro",
    mutate: (source) => `${source}\n${setUpdatedAtSafeLookingRedefinition}`,
    expectedViolation: "FUNCTION_DEFINITION_FORBIDDEN_public.set_updated_at",
  },
];

for (const probe of mutationProbes) {
  const { migrationCopy } = freshProbeCopies(probe.name);
  const mutated = probe.mutate(migrationCopy);
  assert.notEqual(sha256(mutated), originalMigrationSha, `${probe.name}: la mutación cambia el SHA-256`);
  const actualViolations = analyzeMigration(mutated);
  assert.ok(
    actualViolations.some((violation) => violation.startsWith(probe.expectedViolation)),
    `${probe.name}: se esperaba ${probe.expectedViolation}; se obtuvo ${actualViolations.join(", ")}`,
  );
  assertProbeSourcesRestored(probe.name);
}

const survivalProbes: Array<{ name: string; mutate: (source: string) => string }> = [
  {
    name: "ruido histórico inocente en comentarios y literal",
    mutate: (source) => `${source}
-- grant all privileges on table public.profiles to anon;
-- grant execute on function public.handle_new_user() to anon;
/* drop trigger ${guardTrigger} on public.exercises; */
select 'create function public.handle_new_user();';
`,
  },
  {
    name: "redefinición vacía de handle_new_user sólo en comentario",
    mutate: (source) => `${source}\n/*${handleNewUserEmptyDefinition}*/\n`,
  },
  {
    name: "redefinición SECURITY INVOKER de handle_new_user sólo en string dollar-quoted",
    mutate: (source) => `${source}\nselect $innocent$${handleNewUserInvokerRedefinition}$innocent$;\n`,
  },
  {
    name: "redefinición arbitraria de set_updated_at sólo en comentario",
    mutate: (source) => `${source}\n/*${setUpdatedAtArbitraryRedefinition}*/\n`,
  },
  {
    name: "redefinición segura aparente de set_updated_at sólo en string dollar-quoted",
    mutate: (source) => `${source}\nselect $innocent$${setUpdatedAtSafeLookingRedefinition}$innocent$;\n`,
  },
];

for (const probe of survivalProbes) {
  const { migrationCopy } = freshProbeCopies(probe.name);
  const mutated = probe.mutate(migrationCopy);
  assert.notEqual(sha256(mutated), originalMigrationSha, `${probe.name}: el probe cambia el SHA-256`);
  assert.deepEqual(analyzeMigration(mutated), [], `${probe.name}: comentarios y strings son inocentes`);
  assertProbeSourcesRestored(probe.name);
}

console.log(
  `PERF-06A security hardening contract: ${mutationProbes.length} mutation probes killed; ` +
    `${survivalProbes.length} innocent probes survived`,
);
