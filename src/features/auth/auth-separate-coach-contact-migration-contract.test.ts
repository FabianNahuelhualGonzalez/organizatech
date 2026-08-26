import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260825043212_auth_separate_coach_contact_email.sql":
    "ee0eaad255a622358270bf40877734f42d4a8bfd6abc9fb1d328c7ecefb23c10",
} as const;

const MIGRATION_PATH =
  "supabase/migrations/20260825043212_auth_separate_coach_contact_email.sql";

const FAILURE = {
  scope: "[AUTH-HYBRID-01.SQL.scope]",
  transaction: "[AUTH-HYBRID-01.SQL.transaction]",
  contact: "[AUTH-HYBRID-01.SQL.contact]",
  pending: "[AUTH-HYBRID-01.SQL.pending]",
  rls: "[AUTH-HYBRID-01.SQL.rls]",
  directWrite: "[AUTH-HYBRID-01.SQL.direct-write]",
  coachSignature: "[AUTH-HYBRID-01.SQL.coach-signature]",
  coachSecurity: "[AUTH-HYBRID-01.SQL.coach-security]",
  coachOwnership: "[AUTH-HYBRID-01.SQL.coach-ownership]",
  userMembership: "[AUTH-HYBRID-01.SQL.user-membership]",
  coachAllowlist: "[AUTH-HYBRID-01.SQL.coach-allowlist]",
  coachIdempotence: "[AUTH-HYBRID-01.SQL.coach-idempotence]",
  coachGrant: "[AUTH-HYBRID-01.SQL.coach-grant]",
  userSecurity: "[AUTH-HYBRID-01.SQL.user-security]",
  captureAllowlist: "[AUTH-HYBRID-01.SQL.capture-allowlist]",
  finalizerOwnership: "[AUTH-HYBRID-01.SQL.finalizer-ownership]",
  redaction: "[AUTH-HYBRID-01.SQL.redaction]",
} as const;

function normalizeSql(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function splitSqlList(source: string) {
  const items: string[] = [];
  let depth = 0;
  let itemStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;

    if (character === "," && depth === 0) {
      items.push(source.slice(itemStart, index).trim());
      itemStart = index + 1;
    }
  }

  items.push(source.slice(itemStart).trim());
  return items;
}

function grantsForbiddenCoachTableWrite(sql: string) {
  const forbiddenPrivileges = new Set([
    "all",
    "all privileges",
    "insert",
    "update",
    "delete",
    "truncate",
    "references",
    "trigger",
  ]);

  return sql.split(";").some((rawStatement) => {
    const grant = /^grant\s+(.+?)\s+on\s+(?:table\s+)?(.+?)\s+to\s+/.exec(
      rawStatement.trim(),
    );

    if (!grant) return false;

    const targetsCoachRegistrations = splitSqlList(grant[2] ?? "").includes(
      "public.coach_registrations",
    );
    if (!targetsCoachRegistrations) return false;

    return splitSqlList(grant[1] ?? "").some((privilege) => {
      const privilegeName = privilege.replace(/\s*\([^)]*\)\s*$/, "").trim();
      return forbiddenPrivileges.has(privilegeName);
    });
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireContract(condition: unknown, failure: string): asserts condition {
  if (!condition) throw new Error(failure);
}

function functionDefinition(
  source: string,
  name: string,
  dollarTag: string,
) {
  const expression = new RegExp(
    `create(?: or replace)? function ${escapeRegExp(name)}\\(([\\s\\S]*?)\\)\\s*returns[\\s\\S]*?as \\$${dollarTag}\\$([\\s\\S]*?)\\$${dollarTag}\\$;`,
    "i",
  );
  const match = expression.exec(source);
  requireContract(Boolean(match), FAILURE.scope);
  return {
    args: normalizeSql(match![1]!),
    definition: normalizeSql(match![0]!),
    body: normalizeSql(match![2]!),
  };
}

function auditMigration(source: string) {
  const sql = normalizeSql(source);
  const publicFunctionDefinitions = sql.match(
    /create(?: or replace)? function public\.[a-z0-9_]+\(/g,
  ) ?? [];
  requireContract(
    !/\b(?:service_role|supabase_service_role|private_key|training_sessions|exercise_entries)\b/.test(sql)
      && !/\b(?:insert into|update|delete from) auth\.users\b/.test(sql)
      && publicFunctionDefinitions.length === 2
      && publicFunctionDefinitions.includes("create function public.register_own_coach(")
      && publicFunctionDefinitions.includes("create or replace function public.register_own_user("),
    FAILURE.scope,
  );
  requireContract(
    sql.startsWith("begin;")
      && sql.endsWith("commit;")
      && (sql.match(/\bbegin;/g) ?? []).length === 1
      && (sql.match(/\bcommit;/g) ?? []).length === 1,
    FAILURE.transaction,
  );

  requireContract(
    /alter table public\.coach_registrations add column contact_email text;/.test(sql)
      && /alter table public\.coach_registrations alter column contact_email set not null, add constraint coach_registrations_contact_email_format check/.test(sql)
      && /update public\.coach_registrations as registration set contact_email = lower\(btrim\(auth_user\.email\)\) from auth\.users as auth_user where auth_user\.id = registration\.user_id/.test(sql)
      && /raise exception 'coach contact email backfill could not be validated'/.test(sql)
      && !/\bunique\s*\(\s*contact_email\s*\)/.test(sql),
    FAILURE.contact,
  );
  requireContract(
    /alter table private\.auth_registration_pending_memberships add column contact_email text;/.test(sql)
      && /auth_registration_pending_memberships_contact_email_scope check/.test(sql)
      && /consumed_at is null and portal = 'usuario' and contact_email is null/.test(sql)
      && /consumed_at is null and portal = 'coach' and contact_email is not null/.test(sql),
    FAILURE.pending,
  );
  requireContract(
    /alter table public\.coach_registrations enable row level security;/.test(sql)
      && /alter table public\.coach_registrations force row level security;/.test(sql)
      && !/alter table public\.coach_registrations disable row level security;/.test(sql)
      && !/alter table public\.coach_registrations no force row level security;/.test(sql),
    FAILURE.rls,
  );
  requireContract(
    /drop policy if exists "coach registrations insert own row" on public\.coach_registrations;/.test(sql)
      && /revoke all privileges on table public\.coach_registrations from public;/.test(sql)
      && /revoke all privileges on table public\.coach_registrations from anon;/.test(sql)
      && /revoke all privileges on table public\.coach_registrations from authenticated;/.test(sql)
      && /grant select on table public\.coach_registrations to authenticated;/.test(sql)
      && !grantsForbiddenCoachTableWrite(sql)
      && !/create policy[\s\S]*?on public\.coach_registrations[\s\S]*?for (?:all|insert|update|delete)/.test(sql),
    FAILURE.directWrite,
  );

  const coach = functionDefinition(source, "public.register_own_coach", "register_own_coach");
  const coachSignature = "p_first_name text, p_last_name text, p_birth_date date, p_gender text, p_phone_number text, p_professional_title text, p_contact_email text";
  requireContract(
    coach.args === coachSignature
      && !/(?:user_id|owner_id|profile_id|role)/.test(coach.args)
      && /drop function if exists public\.register_own_coach\( uuid, text, text, date, text, text, text \);/.test(sql)
      && !/create(?: or replace)? function public\.register_own_coach\(\s*(?:p_)?(?:expected_)?user_id/.test(sql),
    FAILURE.coachSignature,
  );
  requireContract(
    /language plpgsql security definer set search_path = ''/.test(coach.definition)
      && !/set search_path = (?:'public'|public)/.test(coach.definition),
    FAILURE.coachSecurity,
  );
  const authGuard = coach.body.indexOf(
    "if v_authenticated_user_id is null then raise exception 'coach activation requires authentication' using errcode = '42501'; end if;",
  );
  const userMembershipGuard = coach.body.indexOf(
    "if not exists ( select 1 from public.user_registrations as user_registration where user_registration.user_id = v_authenticated_user_id ) then raise exception 'coach activation requires user membership' using errcode = '42501'; end if;",
  );
  const existingCoachRead = coach.body.indexOf(
    "select registration.* into v_registration from public.coach_registrations as registration where registration.user_id = v_authenticated_user_id;",
  );
  const coachInsert = coach.body.indexOf("insert into public.coach_registrations (");
  requireContract(
    /v_authenticated_user_id uuid := auth\.uid\(\)/.test(coach.body)
      && authGuard >= 0
      && coachInsert > authGuard
      && /where registration\.user_id = v_authenticated_user_id/.test(coach.body)
      && !/\bauth\.users\b/.test(coach.body),
    FAILURE.coachOwnership,
  );
  requireContract(
    userMembershipGuard >= 0
      && existingCoachRead > userMembershipGuard
      && coachInsert > userMembershipGuard,
    FAILURE.userMembership,
  );
  const explicitCoachInsert = /insert into public\.coach_registrations \( user_id, first_name, last_name, birth_date, gender, phone_number, professional_title, contact_email \) values \( v_authenticated_user_id, v_first_name, v_last_name, p_birth_date, p_gender, v_phone_number, v_professional_title, v_contact_email \) on conflict \(user_id\) do nothing returning \* into v_registration;/.test(coach.body);
  requireContract(
    explicitCoachInsert
      && (coach.body.match(/insert into public\.coach_registrations/g) ?? []).length === 1
      && !/(?:jsonb_populate_record|json_populate_record|populate_record|record_to_json|\.\*)\s*(?:from|\))/.test(coach.body)
      && !/p_(?:user_id|owner_id|profile_id|role)/.test(coach.body),
    FAILURE.coachAllowlist,
  );
  const existingReturn = coach.body.indexOf(
    "if v_registration.user_id is not null then return v_registration; end if;",
  );
  requireContract(
    existingCoachRead >= 0
      && existingReturn > existingCoachRead
      && existingReturn < coachInsert
      && /if v_registration\.user_id is null then select registration\.\* into v_registration from public\.coach_registrations as registration where registration\.user_id = v_authenticated_user_id; end if;/.test(coach.body)
      && /if v_registration\.user_id is null or v_registration\.user_id <> v_authenticated_user_id then raise exception 'coach activation could not be confirmed'/.test(coach.body),
    FAILURE.coachIdempotence,
  );
  const coachGrantSignature =
    "public\\.register_own_coach\\(\\s*text, text, date, text, text, text, text\\s*\\)";
  requireContract(
    new RegExp(`revoke all on function ${coachGrantSignature} from public;`).test(sql)
      && new RegExp(`revoke all on function ${coachGrantSignature} from anon;`).test(sql)
      && new RegExp(`revoke all on function ${coachGrantSignature} from authenticated;`).test(sql)
      && new RegExp(`grant execute on function ${coachGrantSignature} to authenticated;`).test(sql)
      && !new RegExp(`grant execute on function ${coachGrantSignature} to (?:public|anon);`).test(sql),
    FAILURE.coachGrant,
  );

  const registerUser = functionDefinition(source, "public.register_own_user", "register_own_user");
  const existingUserReturn = registerUser.body.indexOf(
    "if v_registration.user_id is not null then return v_registration; end if;",
  );
  const coachOnlyGuard = registerUser.body.indexOf(
    "if exists ( select 1 from public.coach_registrations as registration where registration.user_id = v_authenticated_user_id ) then raise exception 'user registration requires a separate auth identity' using errcode = '42501'; end if;",
  );
  requireContract(
    registerUser.args === ""
      && /language plpgsql security definer set search_path = ''/.test(registerUser.definition)
      && !/set search_path = (?:'public'|public)/.test(registerUser.definition)
      && /v_authenticated_user_id uuid := auth\.uid\(\)/.test(registerUser.body)
      && existingUserReturn >= 0
      && coachOnlyGuard > existingUserReturn
      && /grant execute on function public\.register_own_user\(\) to authenticated;/.test(sql)
      && !/grant execute on function public\.register_own_user\(\) to (?:public|anon);/.test(sql),
    FAILURE.userSecurity,
  );

  const capture = functionDefinition(
    source,
    "private.capture_auth_registration_pending_membership",
    "capture_auth_registration_pending_membership",
  );
  requireContract(
    /v_contact_email := nullif\( lower\(btrim\(coalesce\(v_metadata ->> 'contact_email', ''\)\)\), '' \);/.test(capture.body)
      && /if v_portal = 'coach' and not \(v_metadata \? 'contact_email'\) then v_contact_email := nullif\(lower\(btrim\(new\.email\)\), ''\); end if;/.test(capture.body)
      && /v_portal = 'usuario' and \( v_metadata \? 'professional_title' or v_metadata \? 'contact_email' \)/.test(capture.body)
      && /insert into private\.auth_registration_pending_memberships \( user_id, portal, first_name, last_name, birth_date, gender, phone_number, professional_title, contact_email \)/.test(capture.body)
      && !/v_metadata ->> '(?:user_id|owner_id|profile_id|role)'/.test(capture.body),
    FAILURE.captureAllowlist,
  );

  const finalizer = functionDefinition(
    source,
    "private.finalize_auth_registration_pending_membership",
    "finalize_auth_registration_pending_membership",
  );
  requireContract(
    /elsif v_pending\.portal = 'coach' then insert into public\.coach_registrations \( user_id, first_name, last_name, birth_date, gender, phone_number, professional_title, contact_email \) values \( new\.id, v_pending\.first_name, v_pending\.last_name, v_pending\.birth_date, v_pending\.gender, v_pending\.phone_number, v_pending\.professional_title, v_pending\.contact_email \) on conflict \(user_id\) do nothing/.test(finalizer.body)
      && !/(?:new\.raw_user_meta_data|new\.email\b|auth\.uid\(\)).*contact_email/.test(finalizer.body)
      && /where pending\.user_id = new\.id and pending\.consumed_at is null/.test(finalizer.body),
    FAILURE.finalizerOwnership,
  );
  requireContract(
    /contact_email = null, consumed_at = statement_timestamp\(\)/.test(finalizer.body)
      && (finalizer.body.match(/on conflict \(user_id\) do nothing/g) ?? []).length === 2
      && /if not found or v_pending\.consumed_at is not null then return new; end if;/.test(finalizer.body),
    FAILURE.redaction,
  );
}

function replaceExactlyOnce(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length - 1, 1, `target único: ${target}`);
  return source.replace(target, replacement);
}

function addCoachTableGrant(source: string, grant: string) {
  const selectGrant =
    "grant select on table public.coach_registrations to authenticated;";
  return replaceExactlyOnce(source, selectGrant, `${selectGrant}\n${grant}`);
}

const source = readFileSync(MIGRATION_PATH, "utf8");

test("AUTH-HYBRID-01 · contrato semántico de migración", () => {
  auditMigration(source);
});

const mutations = [
  {
    name: "DISABLE RLS en coach_registrations",
    failure: FAILURE.rls,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "alter table public.coach_registrations enable row level security;",
      "alter table public.coach_registrations disable row level security;",
    ),
  },
  {
    name: "NO FORCE RLS en coach_registrations",
    failure: FAILURE.rls,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "alter table public.coach_registrations force row level security;",
      "alter table public.coach_registrations no force row level security;",
    ),
  },
  {
    name: "tabla Coach concede INSERT directo",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant insert on table public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "tabla Coach concede INSERT columnar sin espacio",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant insert(first_name, contact_email) on table public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "tabla Coach concede INSERT columnar con espacio",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant insert (first_name, contact_email) on table public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "tabla Coach concede INSERT columnar con saltos de línea",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant\n  insert\n  (first_name, contact_email)\n  on table\n  public.coach_registrations\n  to authenticated;",
    ),
  },
  {
    name: "tabla Coach combina SELECT e INSERT",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant select, insert on table public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "tabla Coach combina privilegios columnares con INSERT",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant select(first_name), insert (contact_email) on table public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "tabla Coach concede ALL PRIVILEGES columnar",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant all privileges (contact_email) on table public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "tabla Coach concede INSERT sin keyword TABLE",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant insert on public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "lista de tablas concede INSERT a Coach",
    failure: FAILURE.directWrite,
    apply: (current: string) => addCoachTableGrant(
      current,
      "grant insert on table public.user_registrations, public.coach_registrations to authenticated;",
    ),
  },
  {
    name: "register_own_user usa search_path public",
    failure: FAILURE.userSecurity,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "security definer\nset search_path = ''\nas $register_own_user$",
      "security definer\nset search_path = 'public'\nas $register_own_user$",
    ),
  },
  {
    name: "RPC Coach pierde search_path vacío",
    failure: FAILURE.coachSecurity,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "set search_path = ''\nas $register_own_coach$",
      "set search_path = 'public'\nas $register_own_coach$",
    ),
  },
  {
    name: "RPC Coach acepta user_id cliente",
    failure: FAILURE.coachSignature,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "create function public.register_own_coach(\n  p_first_name text,",
      "create function public.register_own_coach(\n  p_user_id uuid,\n  p_first_name text,",
    ),
  },
  {
    name: "RPC Coach omite auth.uid",
    failure: FAILURE.coachOwnership,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "  v_authenticated_user_id uuid := auth.uid();\n  v_registration public.coach_registrations;\n  v_first_name text",
      "  v_authenticated_user_id uuid := null;\n  v_registration public.coach_registrations;\n  v_first_name text",
    ),
  },
  {
    name: "RPC Coach concede ejecución a anon",
    failure: FAILURE.coachGrant,
    apply: (current: string) => current.replace(
      "\n-- Password registrations cannot create a new dual identity",
      "\ngrant execute on function public.register_own_coach(text, text, date, text, text, text, text) to anon;\n\n-- Password registrations cannot create a new dual identity",
    ),
  },
  {
    name: "RPC Coach reabre mass assignment",
    failure: FAILURE.coachAllowlist,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "  insert into public.coach_registrations (\n    user_id,",
      "  insert into public.coach_registrations select (jsonb_populate_record(null::public.coach_registrations, '{}'::jsonb)).*;\n\n  insert into public.coach_registrations (\n    user_id,",
    ),
  },
  {
    name: "activación compartida omite membresía Usuario",
    failure: FAILURE.userMembership,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "  if not exists (\n    select 1\n    from public.user_registrations as user_registration\n    where user_registration.user_id = v_authenticated_user_id\n  ) then",
      "  if false then",
    ),
  },
  {
    name: "activación Coach escribe otra identidad",
    failure: FAILURE.coachAllowlist,
    apply: (current: string) => replaceExactlyOnce(
      current,
      "    v_authenticated_user_id,\n    v_first_name,",
      "    gen_random_uuid(),\n    v_first_name,",
    ),
  },
] as const;

test("AUTH-HYBRID-01 · mutantes críticos mueren por barreras semánticas", () => {
  for (const mutation of mutations) {
    const mutated = mutation.apply(source);
    assert.notEqual(mutated, source, `${mutation.name}: mutación efectiva`);
    assert.throws(
      () => auditMigration(mutated),
      new RegExp(escapeRegExp(mutation.failure)),
      mutation.name,
    );
  }
});

test("AUTH-HYBRID-01 · controles inocentes sobreviven", () => {
  auditMigration(`-- comentario inocente de auditoría\n${source}`);
  auditMigration(source.replace(
    "grant select on table public.coach_registrations to authenticated;",
    "grant   select on table public.coach_registrations to authenticated;",
  ));
  auditMigration(addCoachTableGrant(
    source,
    "grant select (first_name, contact_email) on table public.coach_registrations to authenticated;",
  ));
  auditMigration(addCoachTableGrant(
    source,
    "grant insert on table public.user_registrations to authenticated;",
  ));
});
