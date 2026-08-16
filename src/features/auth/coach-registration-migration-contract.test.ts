import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql";
export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260816020743_auth_coach_multiportal_authorization.sql": "8ef85c23c91b84f420366522200b1d65f22b4e0897989817c6423a2afd7405c7",
} as const;
const INSERT_COLUMNS = [
  "first_name",
  "last_name",
  "birth_date",
  "gender",
  "phone_number",
  "professional_title",
] as const;

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
        } else {
          cursor += 1;
        }
      }
      assert.equal(depth, 0, "[AUTH-COACH-01.sql.syntax] comentario SQL balanceado");
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
  assert.equal(singleQuoted, false, "[AUTH-COACH-01.sql.syntax] string SQL balanceado");
  assert.equal(doubleQuoted, false, "[AUTH-COACH-01.sql.syntax] identificador SQL balanceado");
  assert.equal(dollarTag, null, "[AUTH-COACH-01.sql.syntax] cuerpo dollar-quoted balanceado");
  assert.equal(sql.slice(start).trim(), "", "[AUTH-COACH-01.sql.syntax] toda sentencia termina en punto y coma");
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

function auditMigration(source: string) {
  const executableSql = maskSqlComments(source);
  const statements = splitSqlStatements(source);
  const normalized = statements.map(normalizeSql);
  assert.doesNotMatch(
    executableSql,
    /\bsecurity\s+definer\b/i,
    "[AUTH-COACH-01.sql.no-security-definer] no se admite código privilegiado",
  );
  assert.doesNotMatch(
    executableSql,
    /raw_user_meta_data|user_metadata|app_metadata/i,
    "[AUTH-COACH-01.sql.no-metadata-authority] metadata no autoriza Coach",
  );
  assert.match(source, /create table public\.coach_registrations \(/i);
  assert.match(
    source,
    /user_id uuid primary key/i,
    "[AUTH-COACH-01.sql.owner-primary-key] user_id conserva unicidad",
  );
  assert.match(
    source,
    /user_id uuid primary key default auth\.uid\(\)/i,
    "[AUTH-COACH-01.sql.authoritative-owner-default] user_id deriva de auth.uid()",
  );
  assert.match(
    source,
    /user_id uuid primary key default auth\.uid\(\)[\s\S]*references auth\.users\(id\) on delete cascade/i,
  );
  assert.equal(
    normalized.some((statement) => /alter table public\.coach_registrations disable row level security;/.test(statement)),
    false,
    "[AUTH-COACH-01.sql.E3.rls-final-enabled] ninguna sentencia puede deshabilitar RLS",
  );
  assert.equal(
    normalized.some((statement) => /alter table public\.coach_registrations no force row level security;/.test(statement)),
    false,
    "[AUTH-COACH-01.sql.E4.rls-final-forced] ninguna sentencia puede revertir FORCE RLS",
  );
  const rlsTransitions = normalized.filter((statement) => (
    /^alter table public\.coach_registrations (?:enable|disable|force|no force) row level security;$/.test(statement)
  ));
  assert.deepEqual(
    rlsTransitions,
    [
      "alter table public.coach_registrations enable row level security;",
      "alter table public.coach_registrations force row level security;",
    ],
    "[AUTH-COACH-01.sql.rls-effective-state] RLS y FORCE RLS terminan habilitados exactamente una vez",
  );

  const policies = normalized.filter((statement) => statement.startsWith("create policy "));
  assert.equal(
    policies.length,
    2,
    "[AUTH-COACH-01.sql.policies-exact] existen únicamente las policies SELECT e INSERT aprobadas",
  );
  const selectPolicy = policies.find((statement) => (
    statement.startsWith('create policy "coach registrations select own row"')
  )) ?? "";
  assert.match(
    selectPolicy,
    /on public\.coach_registrations for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\);/i,
    "[AUTH-COACH-01.sql.select-own] SELECT exige ownership auth.uid()",
  );
  const insertPolicy = policies.find((statement) => (
    statement.startsWith('create policy "coach registrations insert own row"')
  )) ?? "";
  assert.match(
    insertPolicy,
    /on public\.coach_registrations for insert to authenticated with check \(\(select auth\.uid\(\)\) = user_id\);/i,
    "[AUTH-COACH-01.sql.insert-own] INSERT exige ownership auth.uid()",
  );
  assert.doesNotMatch(
    normalized.join("\n"),
    /\bgrant (?:update|delete)\b|\bfor (?:update|delete)\b/,
    "[AUTH-COACH-01.sql.no-update-delete] no existen policies ni grants UPDATE/DELETE",
  );

  const tablePrivileges = normalized.filter((statement) => (
    /\bon table public\.coach_registrations\b/.test(statement)
  ));
  const insertGrants = tablePrivileges.filter((statement) => statement.startsWith("grant insert "));
  assert.equal(
    insertGrants.length,
    1,
    "[AUTH-COACH-01.sql.E2.insert-grants-exact] existe un único GRANT INSERT por columnas",
  );
  const insertGrant = /grant insert \((.*?)\) on table public\.coach_registrations to authenticated;/.exec(
    insertGrants[0] ?? "",
  );
  assert.ok(insertGrant, "falta el GRANT INSERT por columnas");
  const columns = insertGrant[1].split(",").map((column) => column.trim());
  assert.deepEqual(
    columns,
    INSERT_COLUMNS,
    "[AUTH-COACH-01.sql.insert-allowlist] GRANT INSERT conserva seis campos exactos",
  );

  for (const forbiddenColumn of [
    "user_id",
    "owner_id",
    "profile_id",
    "role",
    "roles",
    "privileges",
    "account_type",
    "age",
    "email",
    "password",
    "created_at",
  ] as const) {
    assert.equal(columns.includes(forbiddenColumn), false, `${forbiddenColumn} no puede ser escribible`);
  }

  assert.deepEqual(
    tablePrivileges,
    [
      "revoke all privileges on table public.coach_registrations from public;",
      "revoke all privileges on table public.coach_registrations from anon;",
      "revoke all privileges on table public.coach_registrations from authenticated;",
      "grant select on table public.coach_registrations to authenticated;",
      `grant insert (${INSERT_COLUMNS.join(", ")}) on table public.coach_registrations to authenticated;`,
    ],
    "[AUTH-COACH-01.sql.table-privileges-exact] ningún grant posterior revierte las revocaciones",
  );

  const functions = normalized.filter((statement) => statement.startsWith("create function "));
  assert.equal(functions.length, 1, "[AUTH-COACH-01.sql.function-exact] existe una única función atómica");
  const registrationFunction = functions[0];
  assert.match(registrationFunction, /^create function public\.register_own_coach\(/);
  assert.match(registrationFunction, /security invoker set search_path = ''/);
  assert.match(
    registrationFunction,
    /v_authenticated_user_id uuid := auth\.uid\(\);[\s\S]*v_authenticated_user_id <> p_expected_user_id/,
    "[AUTH-COACH-01.sql.atomic-identity] expectedUserId se compara con auth.uid() dentro de la RPC",
  );
  const functionInsert = /insert into public\.coach_registrations \((.*?)\) values/.exec(registrationFunction);
  assert.ok(functionInsert, "[AUTH-COACH-01.sql.function-insert] RPC contiene INSERT explícito");
  assert.deepEqual(
    functionInsert[1].split(",").map((column) => column.trim()),
    INSERT_COLUMNS,
    "[AUTH-COACH-01.sql.function-allowlist] RPC inserta sólo los seis campos aprobados",
  );
  assert.match(registrationFunction, /on conflict \(user_id\) do nothing/);
  assert.match(registrationFunction, /where registration\.user_id = v_authenticated_user_id/);

  const functionPrivileges = normalized.filter((statement) => (
    /on function public\.register_own_coach\(/.test(statement)
  ));
  const functionSignature = "public.register_own_coach(uuid, text, text, date, text, text, text)";
  assert.deepEqual(
    functionPrivileges,
    [
      `revoke all on function ${functionSignature} from public;`,
      `revoke all on function ${functionSignature} from anon;`,
      `revoke all on function ${functionSignature} from authenticated;`,
      `grant execute on function ${functionSignature} to authenticated;`,
    ],
    "[AUTH-COACH-01.sql.function-privileges-exact] EXECUTE queda sólo en authenticated",
  );

}

function replaceExactlyOnce(source: string, target: string, replacement: string, name: string) {
  assert.equal(source.split(target).length - 1, 1, `${name}: target único`);
  return source.replace(target, replacement);
}

test("migración Coach aplica ownership, RLS y ACL cerrada", () => {
  const source = readFileSync(MIGRATION_PATH, "utf8");
  assert.equal(
    sha256(source),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260816020743_auth_coach_multiportal_authorization.sql"],
    "[AUTH-COACH-01.sql.owned-migration-hash] la migración registrada conserva su SHA-256",
  );
  auditMigration(source);
});

test("tokens SECURITY DEFINER y metadata dentro de comentarios no cuentan como mutación", () => {
  const source = readFileSync(MIGRATION_PATH, "utf8");
  auditMigration(`${source}\n-- SECURITY DEFINER user_metadata app_metadata\n`);
});

const securityDefinerFunction = `
create function public.auth_coach_01_security_definer_probe()
returns boolean
language sql
security definer
set search_path = pg_catalog
as $auth_coach_01$
  select true;
$auth_coach_01$;
`;

const metadataAuthorizationPolicy = `
create policy "auth coach 01 metadata probe"
  on public.coach_registrations
  for select
  to authenticated
  using (
    coalesce((select auth.jwt()) -> 'user_metadata' ->> 'role', '') = 'coach'
  );
`;

const mutations = [
  {
    name: "user_id controlable sin default auth.uid()",
    expectedFailure: "[AUTH-COACH-01.sql.authoritative-owner-default]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      " default auth.uid()",
      "",
      "user_id controlable sin default auth.uid()",
    ),
  },
  {
    name: "duplicados al quitar primary key",
    expectedFailure: "[AUTH-COACH-01.sql.owner-primary-key]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "user_id uuid primary key",
      "user_id uuid not null",
      "duplicados al quitar primary key",
    ),
  },
  {
    name: "RLS deshabilitada",
    expectedFailure: "[AUTH-COACH-01.sql.E3.rls-final-enabled]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "enable row level security",
      "disable row level security",
      "RLS deshabilitada",
    ),
  },
  {
    name: "WITH CHECK permisivo",
    expectedFailure: "[AUTH-COACH-01.sql.insert-own]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "with check ((select auth.uid()) = user_id);",
      "with check (true);",
      "WITH CHECK permisivo",
    ),
  },
  {
    name: "SELECT permite ownership cruzado",
    expectedFailure: "[AUTH-COACH-01.sql.select-own]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "using ((select auth.uid()) = user_id);",
      "using (true);",
      "SELECT permite ownership cruzado",
    ),
  },
  {
    name: "mass assignment de user_id",
    expectedFailure: "[AUTH-COACH-01.sql.insert-allowlist]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "grant insert (\n  first_name,",
      "grant insert (\n  user_id,\n  first_name,",
      "mass assignment de user_id",
    ),
  },
  {
    name: "rol cliente agregado como columna escribible",
    expectedFailure: "[AUTH-COACH-01.sql.insert-allowlist]",
    apply: (source: string) => replaceExactlyOnce(
      replaceExactlyOnce(
        source,
        "  professional_title text not null,",
        "  professional_title text not null,\n  role text not null default 'coach',",
        "rol cliente agregado como columna escribible",
      ),
      "grant insert (\n  first_name,",
      "grant insert (\n  role,\n  first_name,",
      "rol cliente agregado como columna escribible",
    ),
  },
  {
    name: "policy expuesta a anon",
    expectedFailure: "[AUTH-COACH-01.sql.select-own]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "for select\n  to authenticated",
      "for select\n  to anon",
      "policy expuesta a anon",
    ),
  },
  {
    name: "UPDATE sin contrato",
    expectedFailure: "[AUTH-COACH-01.sql.no-update-delete]",
    apply: (source: string) => `${source}\ngrant update on table public.coach_registrations to authenticated;\n`,
  },
  {
    name: "policy ejecutable autoriza desde user_metadata",
    expectedFailure: "[AUTH-COACH-01.sql.no-metadata-authority]",
    validateExecutableMutation: (mutated: string) => {
      assert.match(mutated, /create policy "auth coach 01 metadata probe"[\s\S]*auth\.jwt\(\)[\s\S]*user_metadata/);
    },
    apply: (source: string) => `${source}${metadataAuthorizationPolicy}`,
  },
  {
    name: "función ejecutable SECURITY DEFINER",
    expectedFailure: "[AUTH-COACH-01.sql.no-security-definer]",
    validateExecutableMutation: (mutated: string) => {
      assert.match(
        mutated,
        /create function public\.auth_coach_01_security_definer_probe\(\)[\s\S]*returns boolean[\s\S]*language sql[\s\S]*security definer[\s\S]*set search_path = pg_catalog[\s\S]*select true;/i,
      );
    },
    apply: (source: string) => `${source}${securityDefinerFunction}`,
  },
  {
    name: "E2 · GRANT INSERT adicional sobre user_id",
    expectedFailure: "[AUTH-COACH-01.sql.E2.insert-grants-exact]",
    validateExecutableMutation: (mutated: string) => {
      assert.match(mutated, /grant insert \(user_id\) on table public\.coach_registrations to authenticated;/i);
    },
    apply: (source: string) => `${source}\ngrant insert (user_id) on table public.coach_registrations to authenticated;\n`,
  },
  {
    name: "E3 · DISABLE RLS posterior",
    expectedFailure: "[AUTH-COACH-01.sql.E3.rls-final-enabled]",
    validateExecutableMutation: (mutated: string) => {
      assert.match(mutated, /alter table public\.coach_registrations disable row level security;/i);
    },
    apply: (source: string) => `${source}\nalter table public.coach_registrations disable row level security;\n`,
  },
  {
    name: "E4 · NO FORCE RLS posterior",
    expectedFailure: "[AUTH-COACH-01.sql.E4.rls-final-forced]",
    validateExecutableMutation: (mutated: string) => {
      assert.match(mutated, /alter table public\.coach_registrations no force row level security;/i);
    },
    apply: (source: string) => `${source}\nalter table public.coach_registrations no force row level security;\n`,
  },
] as const;

const EXPECTED_SQL_MUTATION_PROBE_COUNT = 14;
const EXPECTED_EXECUTABLE_SQL_PROBE_COUNT = 5;

assert.equal(mutations.length, EXPECTED_SQL_MUTATION_PROBE_COUNT);
assert.equal(
  mutations.filter((mutation) => "validateExecutableMutation" in mutation).length,
  EXPECTED_EXECUTABLE_SQL_PROBE_COUNT,
);

for (const mutation of mutations) {
  test(`mutation probe SQL: ${mutation.name}`, () => {
    const source = readFileSync(MIGRATION_PATH, "utf8");
    const sourceHash = sha256(source);
    const mutated = mutation.apply(source);
    assert.notEqual(mutated, source, `probe efectivo: ${mutation.name}`);
    if ("validateExecutableMutation" in mutation) {
      mutation.validateExecutableMutation(mutated);
    }
    assert.throws(
      () => auditMigration(mutated),
      (error: unknown) => (
        error instanceof assert.AssertionError
        && error.message.includes(mutation.expectedFailure)
      ),
      `la mutación debe morir por su aserción específica: ${mutation.name}`,
    );
    assert.equal(
      sha256(readFileSync(MIGRATION_PATH, "utf8")),
      sourceHash,
      `migración productiva restaurada byte a byte: ${mutation.name}`,
    );
  });
}

console.log(
  `AUTH-COACH-01 SQL mutation probes: ${mutations.length}/${EXPECTED_SQL_MUTATION_PROBE_COUNT}; SQL ejecutable sensible: ${EXPECTED_EXECUTABLE_SQL_PROBE_COUNT}/${EXPECTED_EXECUTABLE_SQL_PROBE_COUNT}`,
);
