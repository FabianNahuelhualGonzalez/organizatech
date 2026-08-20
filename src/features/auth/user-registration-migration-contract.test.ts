import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const MIGRATION_PATH =
  "supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql";
const CONTRACT_PATH = "src/features/auth/user-registration-migration-contract.test.ts";
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260816073510_auth_user_multiportal_authorization.sql": "f43979bcf93195cac158c89a869d1e3a4fbb88c03796aea9626ff7e4a6dbe29e",
} as const;
const EXTERNAL_MUTATION_AUDIT_ENV = "AUTH_COACH_01_USER_SQL_EXTERNAL_MUTATION";
const IS_EXTERNAL_MUTATION_AUDIT = process.env[EXTERNAL_MUTATION_AUDIT_ENV] === "1";
const H4_EXACT_COLUMNS_FAILURE = "[AUTH-COACH-01.USER.H4.exact-columns]";

function sha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function maskSqlComments(source: string) {
  const output = [...source];
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
    }
  };
  let index = 0;
  while (index < source.length) {
    if (source[index] === "'") {
      index += 1;
      while (index < source.length) {
        if (source[index] !== "'") {
          index += 1;
          continue;
        }
        if (source[index + 1] === "'") {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      continue;
    }
    if (source[index] === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        const close = source.indexOf(tag, index + tag.length);
        index = close === -1 ? source.length : close + tag.length;
        continue;
      }
    }
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      const limit = end === -1 ? source.length : end;
      blank(index, limit);
      index = limit;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < source.length && depth > 0) {
        if (source.startsWith("/*", cursor)) {
          depth += 1;
          cursor += 2;
        } else if (source.startsWith("*/", cursor)) {
          depth -= 1;
          cursor += 2;
        } else cursor += 1;
      }
      assert.equal(depth, 0, "[AUTH-COACH-01.USER.sql.syntax] comentario SQL balanceado");
      blank(index, cursor);
      index = cursor;
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function splitSqlStatements(source: string) {
  const sql = maskSqlComments(source);
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag: string | null = null;
  while (index < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
      } else index += 1;
      continue;
    }
    if (singleQuoted) {
      if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
      else if (sql[index] === "'") {
        singleQuoted = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (doubleQuoted) {
      if (sql[index] === '"' && sql[index + 1] === '"') index += 2;
      else if (sql[index] === '"') {
        doubleQuoted = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (sql[index] === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (sql[index] === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (sql[index] === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length;
        continue;
      }
    }
    if (sql[index] === ";") {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  assert.equal(singleQuoted, false, "[AUTH-COACH-01.USER.sql.syntax] string SQL balanceado");
  assert.equal(doubleQuoted, false, "[AUTH-COACH-01.USER.sql.syntax] identificador SQL balanceado");
  assert.equal(dollarTag, null, "[AUTH-COACH-01.USER.sql.syntax] cuerpo dollar-quoted balanceado");
  assert.equal(
    sql.slice(start).trim(),
    "",
    "[AUTH-COACH-01.USER.sql.syntax] toda sentencia termina en punto y coma",
  );
  return statements;
}

function normalizeSql(statement: string) {
  return statement
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/,\s*/g, ", ")
    .trim()
    .toLowerCase();
}

function findMatchingSqlParenthesis(source: string, openingIndex: number) {
  assert.equal(source[openingIndex], "(", "[AUTH-COACH-01.USER.sql.syntax] apertura estructural");
  let depth = 1;
  let index = openingIndex + 1;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag: string | null = null;
  while (index < source.length) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
      } else index += 1;
      continue;
    }
    if (singleQuoted) {
      if (source[index] === "'" && source[index + 1] === "'") index += 2;
      else if (source[index] === "'") {
        singleQuoted = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (doubleQuoted) {
      if (source[index] === '"' && source[index + 1] === '"') index += 2;
      else if (source[index] === '"') {
        doubleQuoted = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (source[index] === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (source[index] === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (source[index] === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length;
        continue;
      }
    }
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  assert.fail("[AUTH-COACH-01.USER.sql.syntax] paréntesis SQL balanceados");
}

function splitTopLevelSqlList(source: string) {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag: string | null = null;
  while (index < source.length) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
      } else index += 1;
      continue;
    }
    if (singleQuoted) {
      if (source[index] === "'" && source[index + 1] === "'") index += 2;
      else if (source[index] === "'") {
        singleQuoted = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (doubleQuoted) {
      if (source[index] === '"' && source[index + 1] === '"') index += 2;
      else if (source[index] === '"') {
        doubleQuoted = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (source[index] === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (source[index] === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (source[index] === "$") {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        dollarTag = tag;
        index += tag.length;
        continue;
      }
    }
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
    else if (source[index] === "," && depth === 0) {
      items.push(source.slice(start, index).trim());
      start = index + 1;
    }
    index += 1;
  }
  assert.equal(depth, 0, "[AUTH-COACH-01.USER.sql.syntax] lista de columnas balanceada");
  assert.equal(singleQuoted, false, "[AUTH-COACH-01.USER.sql.syntax] string de columna balanceado");
  assert.equal(doubleQuoted, false, "[AUTH-COACH-01.USER.sql.syntax] identificador de columna balanceado");
  assert.equal(dollarTag, null, "[AUTH-COACH-01.USER.sql.syntax] default dollar-quoted balanceado");
  const finalItem = source.slice(start).trim();
  if (finalItem) items.push(finalItem);
  return items;
}

function extractCreateTableColumns(statement: string, tableName: string) {
  const prefix = new RegExp(`^create table ${escapeRegExp(tableName)} \\(`).exec(statement);
  assert.ok(prefix, "[AUTH-COACH-01.USER.sql.syntax] CREATE TABLE estructural identificable");
  const openingIndex = prefix.index + prefix[0].lastIndexOf("(");
  const closingIndex = findMatchingSqlParenthesis(statement, openingIndex);
  assert.equal(
    statement.slice(closingIndex + 1).trim(),
    ";",
    "[AUTH-COACH-01.USER.sql.syntax] CREATE TABLE termina tras su cuerpo real",
  );
  return splitTopLevelSqlList(statement.slice(openingIndex + 1, closingIndex));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function auditMigration(source: string) {
  const executable = maskSqlComments(source);
  const statements = splitSqlStatements(source);
  const normalized = statements.map(normalizeSql);

  assert.doesNotMatch(
    executable,
    /raw_user_meta_data|user_metadata|app_metadata|auth\.jwt\(\)/i,
    "[AUTH-COACH-01.USER.sql.no-untrusted-authority] metadata o claims no autorizan Usuario",
  );
  assert.doesNotMatch(
    executable,
    /insert\s+into\s+public\.coach_registrations|register_own_coach/i,
    "[AUTH-COACH-01.USER.sql.no-coach-membership] la migración Usuario no crea Coach",
  );
  assert.doesNotMatch(
    executable,
    /create\s+(?:or\s+replace\s+)?trigger|insert\s+into\s+public\.profiles/i,
    "[AUTH-COACH-01.USER.sql.profiles-remain-common] no se crea una ruta profiles -> membresía futura",
  );

  const table = normalized.filter((statement) => (
    statement.startsWith("create table public.user_registrations (")
  ));
  assert.equal(table.length, 1, "[AUTH-COACH-01.USER.sql.table-exact] existe una tabla autoritativa");
  assert.match(
    table[0],
    /user_id uuid primary key default auth\.uid\(\) references auth\.users\(id\) on delete cascade/,
    "[AUTH-COACH-01.USER.sql.authoritative-owner] ownership deriva de auth.uid() y referencia Auth",
  );
  assert.match(
    table[0],
    /created_at timestamptz not null default now\(\)/,
    "[AUTH-COACH-01.USER.sql.created-at] auditoría mínima obligatoria",
  );
  assert.deepEqual(
    extractCreateTableColumns(table[0], "public.user_registrations"),
    [
      "user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade",
      "created_at timestamptz not null default now()",
    ],
    H4_EXACT_COLUMNS_FAILURE,
  );

  const rlsTransitions = normalized.filter((statement) => (
    /^alter table public\.user_registrations (?:enable|disable|force|no force) row level security;$/.test(statement)
  ));
  assert.equal(
    rlsTransitions.some((statement) => statement.includes("disable row level security")),
    false,
    "[AUTH-COACH-01.USER.sql.rls-enabled] RLS nunca termina deshabilitada",
  );
  assert.equal(
    rlsTransitions.some((statement) => statement.includes("no force row level security")),
    false,
    "[AUTH-COACH-01.USER.sql.rls-forced] FORCE RLS nunca se revierte",
  );
  assert.deepEqual(
    rlsTransitions,
    [
      "alter table public.user_registrations enable row level security;",
      "alter table public.user_registrations force row level security;",
    ],
    "[AUTH-COACH-01.USER.sql.rls-state-exact] RLS y FORCE se habilitan exactamente una vez",
  );

  const policies = normalized.filter((statement) => statement.startsWith("create policy "));
  assert.equal(
    policies.length,
    1,
    "[AUTH-COACH-01.USER.sql.policy-exact] sólo existe SELECT own-only",
  );
  assert.match(
    policies[0],
    /on public\.user_registrations for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\);$/,
    "[AUTH-COACH-01.USER.sql.select-own] SELECT exige auth.uid() propio",
  );

  assert.doesNotMatch(
    normalized.join("\n"),
    /\bgrant insert\b|\bfor insert\b/,
    "[AUTH-COACH-01.USER.sql.no-client-insert] sólo la RPC cerrada puede crear membresía",
  );
  assert.doesNotMatch(
    normalized.join("\n"),
    /\bgrant (?:update|delete)\b|\bfor (?:update|delete)\b/,
    "[AUTH-COACH-01.USER.sql.no-update-delete] no existen UPDATE ni DELETE",
  );

  const tablePrivileges = normalized.filter((statement) => (
    /on table public\.user_registrations\b/.test(statement)
  ));
  assert.deepEqual(
    tablePrivileges,
    [
      "revoke all privileges on table public.user_registrations from public;",
      "revoke all privileges on table public.user_registrations from anon;",
      "revoke all privileges on table public.user_registrations from authenticated;",
      "grant select on table public.user_registrations to authenticated;",
    ],
    "[AUTH-COACH-01.USER.sql.table-acl-exact] ACL mínima sin reaperturas posteriores",
  );

  const functions = normalized.filter((statement) => statement.startsWith("create function "));
  assert.equal(functions.length, 1, "[AUTH-COACH-01.USER.sql.function-exact] existe una RPC única");
  const registrationFunction = functions[0] ?? "";
  assert.match(
    registrationFunction,
    /^create function public\.register_own_user\(\) returns public\.user_registrations/,
    "[AUTH-COACH-01.USER.sql.no-client-owner] RPC no acepta user_id ni parámetros",
  );
  assert.match(
    registrationFunction,
    /language plpgsql security definer set search_path = ''/,
    "[AUTH-COACH-01.USER.sql.hardened-definer] función privilegiada fija search_path vacío",
  );
  const authBinding = /([a-z_][a-z0-9_]*) uuid := auth\.uid\(\);/.exec(registrationFunction)?.[1];
  assert.ok(authBinding, "[AUTH-COACH-01.USER.sql.auth-uid-derived] RPC captura auth.uid()");
  const authVariable = escapeRegExp(authBinding!);
  assert.match(
    registrationFunction,
    new RegExp(`if ${authVariable} is null then[\\s\\S]*errcode = '42501'`),
    "[AUTH-COACH-01.USER.sql.auth-required] RPC rechaza llamadas sin identidad",
  );
  assert.match(
    registrationFunction,
    /insert into public\.user_registrations default values on conflict \(user_id\) do nothing/,
    "[AUTH-COACH-01.USER.sql.default-owner-write] INSERT deriva ownership y es idempotente",
  );
  assert.match(
    registrationFunction,
    new RegExp(`where registration\\.user_id = ${authVariable}`),
    "[AUTH-COACH-01.USER.sql.confirm-own] confirmación sólo relee la fila autenticada",
  );
  assert.match(
    registrationFunction,
    new RegExp(`v_registration\\.user_id <> ${authVariable}`),
    "[AUTH-COACH-01.USER.sql.confirm-own] respuesta cruzada falla cerrada",
  );

  const functionPrivileges = normalized.filter((statement) => (
    /on function public\.register_own_user\(\)/.test(statement)
  ));
  assert.deepEqual(
    functionPrivileges,
    [
      "revoke all on function public.register_own_user() from public;",
      "revoke all on function public.register_own_user() from anon;",
      "revoke all on function public.register_own_user() from authenticated;",
      "grant execute on function public.register_own_user() to authenticated;",
    ],
    "[AUTH-COACH-01.USER.sql.function-acl-exact] EXECUTE queda sólo en authenticated",
  );

  const backfills = normalized.filter((statement) => (
    statement.startsWith("insert into public.user_registrations (user_id) select ")
  ));
  assert.equal(
    backfills.length,
    1,
    "[AUTH-COACH-01.USER.sql.legacy-backfill-present] existe un backfill explícito único",
  );
  const backfill = backfills[0] ?? "";
  const alias = /select ([a-z_][a-z0-9_]*)\.id from public\.profiles as \1/.exec(backfill)?.[1];
  assert.ok(alias, "[AUTH-COACH-01.USER.sql.legacy-backfill-source] legacy deriva sólo de profiles");
  const profileAlias = escapeRegExp(alias!);
  assert.match(
    backfill,
    new RegExp(`where ${profileAlias}\\.created_at <= transaction_timestamp\\(\\)`),
    "[AUTH-COACH-01.USER.sql.legacy-backfill-bounded] sólo identidades previas a la migración",
  );
  assert.match(
    backfill,
    /on conflict \(user_id\) do nothing;$/,
    "[AUTH-COACH-01.USER.sql.legacy-backfill-idempotent] reintentos no duplican membresía",
  );
}

function replaceExactlyOnce(source: string, target: string, replacement: string, name: string) {
  assert.equal(source.split(target).length - 1, 1, `${name}: target único`);
  return source.replace(target, replacement);
}

function addColumnToActualUserRegistrationTable(source: string, columnDefinition: string) {
  const executable = maskSqlComments(source);
  const matches = [...executable.matchAll(
    /(?:^|;)\s*create\s+table\s+public\.user_registrations\s*\(/gi,
  )];
  assert.equal(matches.length, 1, "mutante H4 localiza un CREATE TABLE real");
  const openingIndex = matches[0].index + matches[0][0].lastIndexOf("(");
  const closingIndex = findMatchingSqlParenthesis(executable, openingIndex);
  let insertionIndex = closingIndex;
  while (/\s/.test(source[insertionIndex - 1] ?? "")) insertionIndex -= 1;
  return `${source.slice(0, insertionIndex)},\n  ${columnDefinition}${source.slice(insertionIndex)}`;
}

test("migración Usuario aplica membresía independiente, backfill acotado y ACL cerrada", () => {
  const source = readFileSync(MIGRATION_PATH, "utf8");
  assert.equal(
    sha256(source),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260816073510_auth_user_multiportal_authorization.sql"],
    "[AUTH-COACH-01.USER.sql.owned-migration-hash] migración Usuario conserva su SHA-256",
  );
  auditMigration(source);
});

const innocentControls = [
  {
    name: "comentarios no son SQL ejecutable",
    apply: (source: string) => `${source}\n-- grant update; user_metadata; register_own_coach\n`,
  },
  {
    name: "espaciado SQL equivalente",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "grant select on table public.user_registrations to authenticated;",
      "grant   select   on table public.user_registrations to authenticated;",
      "control de espaciado",
    ),
  },
  {
    name: "nombre local inocente",
    apply: (source: string) => source.replaceAll(
      "v_authenticated_user_id",
      "v_current_auth_identity",
    ),
  },
  {
    name: "comentarios, strings y bloque señuelo no agregan columnas reales",
    apply: (source: string) => `${source}
-- create table public.user_registrations (role text not null default 'user');
select 'create table public.user_registrations (role text not null default ''user'');';
do $user_table_decoy$
begin
  perform 'create table public.user_registrations (role text not null default ''user'')';
end;
$user_table_decoy$;
`,
  },
] as const;
const EXPECTED_INNOCENT_CONTROL_COUNT = 4;
assert.equal(innocentControls.length, EXPECTED_INNOCENT_CONTROL_COUNT);

if (!IS_EXTERNAL_MUTATION_AUDIT) {
  for (const control of innocentControls) {
    test(`control inocente SQL: ${control.name}`, () => {
      const source = readFileSync(MIGRATION_PATH, "utf8");
      const controlled = control.apply(source);
      assert.notEqual(controlled, source);
      auditMigration(controlled);
    });
  }
}

const permissivePolicy = `
create policy "user registrations permissive probe"
  on public.user_registrations
  for select
  to authenticated
  using (true);
`;

const metadataPolicy = `
create policy "user registrations metadata probe"
  on public.user_registrations
  for select
  to authenticated
  using (coalesce((select auth.jwt()) -> 'user_metadata' ->> 'role', '') = 'usuario');
`;

const mutations = [
  {
    name: "ownership sin default auth.uid()",
    expectedFailure: "[AUTH-COACH-01.USER.sql.authoritative-owner]",
    apply: (source: string) => replaceExactlyOnce(source, " default auth.uid()", "", "owner default"),
  },
  {
    name: "user_id deja de ser primary key",
    expectedFailure: "[AUTH-COACH-01.USER.sql.authoritative-owner]",
    apply: (source: string) => replaceExactlyOnce(source, "user_id uuid primary key", "user_id uuid not null", "owner PK"),
  },
  {
    name: "RLS deshabilitada",
    expectedFailure: "[AUTH-COACH-01.USER.sql.rls-enabled]",
    apply: (source: string) => replaceExactlyOnce(source, "enable row level security", "disable row level security", "disable RLS"),
  },
  {
    name: "NO FORCE RLS posterior",
    expectedFailure: "[AUTH-COACH-01.USER.sql.rls-forced]",
    apply: (source: string) => `${source}\nalter table public.user_registrations no force row level security;\n`,
  },
  {
    name: "SELECT own-only se vuelve permisivo",
    expectedFailure: "[AUTH-COACH-01.USER.sql.select-own]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "using ((select auth.uid()) = user_id);",
      "using (true);",
      "SELECT permisivo",
    ),
  },
  {
    name: "policy permisiva adicional",
    expectedFailure: "[AUTH-COACH-01.USER.sql.policy-exact]",
    apply: (source: string) => `${source}${permissivePolicy}`,
  },
  {
    name: "metadata concede Usuario",
    expectedFailure: "[AUTH-COACH-01.USER.sql.no-untrusted-authority]",
    apply: (source: string) => `${source}${metadataPolicy}`,
  },
  {
    name: "GRANT INSERT directo",
    expectedFailure: "[AUTH-COACH-01.USER.sql.no-client-insert]",
    apply: (source: string) => `${source}\ngrant insert on table public.user_registrations to authenticated;\n`,
  },
  {
    name: "GRANT UPDATE directo",
    expectedFailure: "[AUTH-COACH-01.USER.sql.no-update-delete]",
    apply: (source: string) => `${source}\ngrant update on table public.user_registrations to authenticated;\n`,
  },
  {
    name: "GRANT DELETE directo",
    expectedFailure: "[AUTH-COACH-01.USER.sql.no-update-delete]",
    apply: (source: string) => `${source}\ngrant delete on table public.user_registrations to authenticated;\n`,
  },
  {
    name: "falta backfill legacy",
    expectedFailure: "[AUTH-COACH-01.USER.sql.legacy-backfill-present]",
    apply: (source: string) => source.replace(
      /insert into public\.user_registrations \(user_id\)\nselect profile\.id\nfrom public\.profiles as profile\nwhere profile\.created_at <= transaction_timestamp\(\)\non conflict \(user_id\) do nothing;\n/,
      "",
    ),
  },
  {
    name: "backfill sin límite temporal",
    expectedFailure: "[AUTH-COACH-01.USER.sql.legacy-backfill-bounded]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "where profile.created_at <= transaction_timestamp()\n",
      "",
      "backfill temporal",
    ),
  },
  {
    name: "RPC acepta ownership cliente",
    expectedFailure: "[AUTH-COACH-01.USER.sql.no-client-owner]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "create function public.register_own_user()",
      "create function public.register_own_user(p_user_id uuid)",
      "RPC con user_id",
    ),
  },
  {
    name: "RPC pierde SECURITY DEFINER",
    expectedFailure: "[AUTH-COACH-01.USER.sql.hardened-definer]",
    apply: (source: string) => replaceExactlyOnce(source, "security definer", "security invoker", "RPC invoker"),
  },
  {
    name: "Registro Usuario crea Coach",
    expectedFailure: "[AUTH-COACH-01.USER.sql.no-coach-membership]",
    apply: (source: string) => `${source}\ninsert into public.coach_registrations default values;\n`,
  },
  {
    name: "trigger futuro desde profiles",
    expectedFailure: "[AUTH-COACH-01.USER.sql.profiles-remain-common]",
    apply: (source: string) => `${source}\ncreate trigger user_from_profile after insert on public.profiles execute function public.register_own_user();\n`,
  },
  {
    name: "H4 · user_registrations agrega columna role",
    expectedFailure: H4_EXACT_COLUMNS_FAILURE,
    exactFailureLine: true,
    externalAuthSuite: true,
    apply: (source: string) => addColumnToActualUserRegistrationTable(
      source,
      "role text not null default 'user'",
    ),
  },
] as const;

const EXPECTED_SQL_MUTATION_PROBE_COUNT = 17;
const EXPECTED_EXTERNAL_AUTH_SUITE_MUTATION_PROBE_COUNT = 1;
assert.equal(mutations.length, EXPECTED_SQL_MUTATION_PROBE_COUNT);
assert.equal(
  mutations.filter((mutation) => "externalAuthSuite" in mutation).length,
  EXPECTED_EXTERNAL_AUTH_SUITE_MUTATION_PROBE_COUNT,
  "AUTH-COACH-01 Usuario fija un probe SQL externo H4",
);

function assertMutationContract(
  original: string,
  mutated: string,
  name: string,
  expectedFailure: string,
  exactFailureLine = false,
) {
  const directory = mkdtempSync(join(tmpdir(), "organizatech-user-registration-sql-"));
  const temporaryPath = join(directory, "migration.sql");
  const originalHash = sha256(original);
  const mutatedHash = sha256(mutated);
  writeFileSync(temporaryPath, original, "utf8");
  try {
    writeFileSync(temporaryPath, mutated, "utf8");
    const materialized = readFileSync(temporaryPath, "utf8");
    assert.equal(materialized, mutated, `source SQL mutado materializado: ${name}`);
    assert.notEqual(mutatedHash, originalHash, `SHA cambia realmente: ${name}`);
    splitSqlStatements(materialized);
    assert.throws(
      () => auditMigration(materialized),
      (error: unknown) => {
        if (!(error instanceof assert.AssertionError)) return false;
        return exactFailureLine
          ? error.message.split(/\r?\n/, 1)[0] === expectedFailure
          : error.message.includes(expectedFailure);
      },
      `la mutación debe fallar por ${expectedFailure}: ${name}`,
    );
  } finally {
    try {
      if (existsSync(temporaryPath)) {
        writeFileSync(temporaryPath, original, "utf8");
        const restored = readFileSync(temporaryPath, "utf8");
        assert.equal(restored, original, `restauración byte a byte en finally: ${name}`);
        assert.equal(sha256(restored), originalHash, `restauración SHA en finally: ${name}`);
      }
      assert.equal(
        sha256(readFileSync(MIGRATION_PATH, "utf8")),
        originalHash,
        `migración productiva intacta: ${name}`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

function assertExternalAuthSuiteMutation(
  original: string,
  mutated: string,
  expectedFailure: string,
) {
  const directory = mkdtempSync(join(tmpdir(), "organizatech-user-registration-auth-suite-"));
  const copiedMigrationPath = join(directory, MIGRATION_PATH);
  const copiedContractPath = join(directory, CONTRACT_PATH);
  const originalHash = sha256(original);
  const mutatedHash = sha256(mutated);
  const originalContract = readFileSync(CONTRACT_PATH, "utf8");
  const originalContractHash = sha256(originalContract);
  assert.notEqual(mutatedHash, originalHash, "H4 externo cambia realmente el SHA");
  try {
    cpSync("src", join(directory, "src"), { recursive: true });
    cpSync("supabase", join(directory, "supabase"), { recursive: true });
    cpSync("tsconfig.json", join(directory, "tsconfig.json"));
    cpSync("package.json", join(directory, "package.json"));
    symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
    writeFileSync(copiedMigrationPath, mutated, "utf8");
    const externalContract = replaceExactlyOnce(
      originalContract,
      originalHash,
      mutatedHash,
      "H4 ajusta sólo el pin de la copia temporal",
    );
    writeFileSync(copiedContractPath, externalContract, "utf8");
    assert.equal(
      sha256(readFileSync(copiedMigrationPath, "utf8")),
      mutatedHash,
      "H4 externo materializa source y SHA mutados",
    );
    assert.equal(
      readFileSync(copiedContractPath, "utf8"),
      externalContract,
      "H4 externo materializa el harness temporal sin alterar producto",
    );

    const childEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      [EXTERNAL_MUTATION_AUDIT_ENV]: "1",
    };
    delete childEnvironment.NODE_TEST_CONTEXT;
    const execution = spawnSync(
      resolve("node_modules/.bin/tsx"),
      ["--test", "--test-concurrency=1", CONTRACT_PATH],
      {
        cwd: directory,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        env: childEnvironment,
      },
    );
    const output = `${execution.stdout ?? ""}\n${execution.stderr ?? ""}`;
    assert.notEqual(execution.status, 0, `la suite Auth SQL debe matar ${expectedFailure}\n${output}`);
    const firstSecurityFailure = output.match(
      /\[AUTH-COACH-01\.USER\.H4[^\]]*\]/,
    )?.[0] ?? null;
    assert.equal(
      firstSecurityFailure,
      expectedFailure,
      `la primera causa SQL debe ser exactamente ${expectedFailure}\n${output}`,
    );
    assert.doesNotMatch(output, /owned-migration-hash|SyntaxError|Transform failed|TypeScript compilation/i);
  } finally {
    try {
      if (existsSync(copiedMigrationPath)) {
        writeFileSync(copiedMigrationPath, original, "utf8");
        const restored = readFileSync(copiedMigrationPath, "utf8");
        assert.equal(restored, original, "H4 externo restaura bytes en finally");
        assert.equal(sha256(restored), originalHash, "H4 externo restaura SHA en finally");
      }
      if (existsSync(copiedContractPath)) {
        writeFileSync(copiedContractPath, originalContract, "utf8");
        const restoredContract = readFileSync(copiedContractPath, "utf8");
        assert.equal(restoredContract, originalContract, "H4 externo restaura harness en finally");
        assert.equal(
          sha256(restoredContract),
          originalContractHash,
          "H4 externo restaura SHA del harness en finally",
        );
      }
      assert.equal(
        sha256(readFileSync(MIGRATION_PATH, "utf8")),
        originalHash,
        "H4 externo conserva la migración productiva byte-idéntica",
      );
      assert.equal(
        sha256(readFileSync(CONTRACT_PATH, "utf8")),
        originalContractHash,
        "H4 externo conserva el contrato productivo byte-idéntico",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

if (!IS_EXTERNAL_MUTATION_AUDIT) {
  for (const mutation of mutations) {
    test(`mutation probe SQL Usuario: ${mutation.name}`, () => {
      const source = readFileSync(MIGRATION_PATH, "utf8");
      const mutated = mutation.apply(source);
      assert.notEqual(mutated, source, `probe modifica realmente source: ${mutation.name}`);
      assertMutationContract(
        source,
        mutated,
        mutation.name,
        mutation.expectedFailure,
        "exactFailureLine" in mutation,
      );
      if ("externalAuthSuite" in mutation) {
        assertExternalAuthSuiteMutation(source, mutated, mutation.expectedFailure);
      }
    });
  }

  console.log(
    `AUTH-COACH-01 Usuario SQL mutation probes: ${mutations.length}/${EXPECTED_SQL_MUTATION_PROBE_COUNT}; suite Auth externa H4: ${EXPECTED_EXTERNAL_AUTH_SUITE_MUTATION_PROBE_COUNT}/${EXPECTED_EXTERNAL_AUTH_SUITE_MUTATION_PROBE_COUNT}; controles inocentes: ${innocentControls.length}/${EXPECTED_INNOCENT_CONTROL_COUNT}`,
  );
}
