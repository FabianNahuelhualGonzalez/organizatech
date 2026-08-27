import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "supabase/migrations/20260827000000_email_onboarding_transactional_email.sql";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260827000000_email_onboarding_transactional_email.sql":
    "9f40ec7fc99c75f79b9fdf97c2741962e904cad53a2698d6560e1932c048fad0",
} as const;

type Violation =
  | "ledger-private"
  | "ledger-force-rls"
  | "ledger-acl"
  | "ledger-no-plaintext-recipient"
  | "idempotency"
  | "ambiguous-retry-boundary"
  | "function-boundaries"
  | "function-public-execute"
  | "function-uniqueness"
  | "welcome-acl"
  | "welcome-bola"
  | "welcome-membership-source"
  | "welcome-no-client-routing"
  | "auth-proof"
  | "auth-global-actions"
  | "auth-precommit-snapshot"
  | "portal-presentation"
  | "secret-surface";

const EXPECTED_SECURITY_DEFINER_FUNCTIONS = [
  "private.capture_auth_registration_pending_membership",
  "private.enqueue_membership_welcome_email",
  "private.delete_transactional_email_deliveries_for_auth_user",
  "private.verify_transactional_email_capability",
  "public.claim_own_transactional_welcome_emails",
  "public.complete_own_transactional_welcome_email",
  "public.claim_auth_transactional_email",
  "public.complete_auth_transactional_email",
] as const;

interface SqlFunctionDefinition {
  name: string;
  header: string;
}

function withoutSqlComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ");
}

function normalized(source: string) {
  return withoutSqlComments(source).replace(/\s+/g, " ").trim().toLowerCase();
}

function withoutSqlQuotedText(source: string) {
  const output = [...source];
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (!quote) {
      if (character === "'" || character === '"') {
        quote = character;
        output[index] = " ";
      }
      continue;
    }

    output[index] = " ";
    if (character !== quote) continue;
    if (source[index + 1] === quote) {
      output[index + 1] = " ";
      index += 1;
    } else {
      quote = null;
    }
  }

  return output.join("");
}

function discoverFunctionDefinitions(source: string): SqlFunctionDefinition[] {
  const executable = withoutSqlComments(source);
  const declaration = /\bcreate\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_$]*(?:\s*\.\s*[a-z_][a-z0-9_$]*)?)\s*\(/gi;
  const definitions: SqlFunctionDefinition[] = [];

  for (let match = declaration.exec(executable); match; match = declaration.exec(executable)) {
    const start = match.index;
    const remainder = executable.slice(start);
    const opening = remainder.match(/\bas\s+(\$[a-z_][a-z0-9_]*\$|\$\$)/i);
    if (!opening || opening.index === undefined) continue;

    const tag = opening[1]!;
    const bodyStart = opening.index + opening[0].length;
    const bodyEnd = remainder.indexOf(tag, bodyStart);
    if (bodyEnd < 0) continue;

    definitions.push({
      name: match[1]!.replace(/\s+/g, "").toLowerCase(),
      header: normalized(remainder.slice(0, opening.index)),
    });
    declaration.lastIndex = start + bodyEnd + tag.length;
  }

  return definitions;
}

function grantsFunctionExecutionToPublic(source: string) {
  const executable = withoutSqlComments(source);
  const statements = [...executable.matchAll(/\bgrant\b[\s\S]*?(?:;|$)/gi)];

  return statements.some((candidate) => {
    const statement = normalized(candidate[0]);
    const grant = /^grant\s+(.+?)\s+on\s+(.+?)\s+to\s+(.+?);?$/.exec(statement);
    if (!grant) return false;

    const privileges = grant[1]!.split(",").map((privilege) => privilege.trim());
    const objectScope = grant[2]!;
    const grantees = grant[3]!
      .replace(/\s+with\s+grant\s+option\s*$/, "")
      .split(",")
      .map((grantee) => grantee.trim().replace(/^"|"$/g, ""));

    return privileges.some((privilege) => (
      privilege === "execute" || privilege === "all" || privilege === "all privileges"
    ))
      && /\b(?:function|functions|procedure|procedures|routine|routines)\b/.test(objectScope)
      && grantees.includes("public");
  });
}

function functionSource(source: string, qualifiedName: string) {
  const lower = source.toLowerCase();
  const markers = [
    `create function ${qualifiedName.toLowerCase()}(`,
    `create or replace function ${qualifiedName.toLowerCase()}(`,
  ];
  const start = markers
    .map((marker) => lower.indexOf(marker))
    .filter((offset) => offset >= 0)
    .sort((left, right) => left - right)[0];
  if (start === undefined) return "";

  const header = source.slice(start);
  const opening = header.match(/\bas\s+(\$[a-z_][a-z0-9_]*\$|\$\$)/i);
  if (!opening?.index) return "";
  const tag = opening[1]!;
  const bodyStart = start + opening.index + opening[0].length;
  const bodyEnd = source.indexOf(tag, bodyStart);
  if (bodyEnd < 0) return "";
  return source.slice(start, bodyEnd + tag.length);
}

function hasAll(source: string, fragments: readonly string[]) {
  return fragments.every((fragment) => source.includes(fragment));
}

function inspectMigration(source: string): Set<Violation> {
  const sql = normalized(source);
  const violations = new Set<Violation>();
  const tableStart = source.toLowerCase().indexOf(
    "create table private.transactional_email_deliveries",
  );
  const tableEnd = source.toLowerCase().indexOf(
    "create index transactional_email_deliveries_own_claim_idx",
    tableStart,
  );
  const ledger = tableStart >= 0 && tableEnd > tableStart
    ? normalized(source.slice(tableStart, tableEnd))
    : "";
  const authClaim = normalized(functionSource(source, "public.claim_auth_transactional_email"));
  const authComplete = normalized(functionSource(source, "public.complete_auth_transactional_email"));
  const welcomeClaim = normalized(
    functionSource(source, "public.claim_own_transactional_welcome_emails"),
  );
  const welcomeComplete = normalized(
    functionSource(source, "public.complete_own_transactional_welcome_email"),
  );
  const enqueueWelcome = normalized(
    functionSource(source, "private.enqueue_membership_welcome_email"),
  );
  const verifyCapability = normalized(
    functionSource(source, "private.verify_transactional_email_capability"),
  );
  const constantTimeEqual = normalized(
    functionSource(source, "private.transactional_email_constant_time_equal"),
  );
  const capture = normalized(
    functionSource(source, "private.capture_auth_registration_pending_membership"),
  );
  const protectPresentation = normalized(
    functionSource(source, "private.protect_auth_email_presentation_metadata"),
  );
  const functionDefinitions = discoverFunctionDefinitions(source);
  const securityDefinerFunctions = functionDefinitions.filter((definition) => (
    /\bsecurity\s+definer\b/.test(withoutSqlQuotedText(definition.header))
  ));

  if (!sql.includes("create table private.transactional_email_deliveries")) {
    violations.add("ledger-private");
  }
  if (!hasAll(sql, [
    "alter table private.transactional_email_deliveries enable row level security",
    "alter table private.transactional_email_deliveries force row level security",
  ])) {
    violations.add("ledger-force-rls");
  }
  if (!hasAll(sql, [
    "revoke all privileges on table private.transactional_email_deliveries from public",
    "revoke all privileges on table private.transactional_email_deliveries from anon",
    "revoke all privileges on table private.transactional_email_deliveries from authenticated",
    "revoke all on schema private from public",
    "revoke all on schema private from anon",
    "revoke all on schema private from authenticated",
  ]) || /grant\s+[^;]*\s+on\s+(?:table\s+)?private\.transactional_email_deliveries\b/.test(sql)) {
    violations.add("ledger-acl");
  }
  if (!ledger.includes("recipient_fingerprint text")
    || ledger.includes("recipient_email")
    || !ledger.includes("transactional_email_deliveries_recipient_fingerprint_format")) {
    violations.add("ledger-no-plaintext-recipient");
  }

  if (!hasAll(sql, [
    "idempotency_key uuid not null",
    "constraint transactional_email_deliveries_event_unique unique ( user_id, delivery_kind, event_key )",
    "create function private.transactional_email_idempotency_uuid(p_value text)",
    "on conflict (user_id, delivery_kind, event_key) do nothing",
    "on conflict (user_id, delivery_kind, event_key) do update",
  ]) || !enqueueWelcome.includes("private.transactional_email_idempotency_uuid(v_material)")
    || !authClaim.includes("private.transactional_email_idempotency_uuid(v_material)")
    || !authClaim.includes("case when v_token_hash = '' then p_event_id else v_token_hash end")
    || !authClaim.includes("p_event_id text")) {
    violations.add("idempotency");
  }

  if (!welcomeClaim.includes(
    "and ( delivery.status = 'failed' or ( delivery.status = 'pending' and delivery.attempt_count = 0 ) ) order by delivery.created_at",
  ) || !authClaim.includes(
    "where private.transactional_email_deliveries.status = 'failed' returning private.transactional_email_deliveries.*",
  ) || welcomeClaim.includes("interval '25 minutes'")
    || welcomeClaim.includes("interval '60 seconds'")
    || authClaim.includes("private.transactional_email_deliveries.status = 'pending'")
    || authClaim.includes("interval '25 minutes'")
    || authClaim.includes("interval '60 seconds'")) {
    violations.add("ambiguous-retry-boundary");
  }

  const expectedSecurityDefinerNames = [...EXPECTED_SECURITY_DEFINER_FUNCTIONS].sort();
  const actualSecurityDefinerNames = securityDefinerFunctions
    .map((definition) => definition.name)
    .sort();
  const securityDefinerOccurrences = normalized(
    withoutSqlQuotedText(withoutSqlComments(source)),
  ).match(/\bsecurity definer\b/g)?.length ?? 0;
  if (securityDefinerOccurrences !== securityDefinerFunctions.length
    || actualSecurityDefinerNames.length !== expectedSecurityDefinerNames.length
    || actualSecurityDefinerNames.some((name, index) => name !== expectedSecurityDefinerNames[index])
    || securityDefinerFunctions.some((definition) => (
      !/^(?:private|public)\.[a-z_][a-z0-9_$]*$/.test(definition.name)
      || !/\bset\s+search_path\s*=\s*''$/.test(definition.header)
    ))) {
    violations.add("function-boundaries");
  }
  if (grantsFunctionExecutionToPublic(source)) {
    violations.add("function-public-execute");
  }
  if (sql.split("create function private.transactional_email_constant_time_equal(").length - 1 !== 1
    || sql.split("create function private.verify_transactional_email_capability(").length - 1 !== 1) {
    violations.add("function-uniqueness");
  }

  if (!hasAll(sql, [
    "grant execute on function public.claim_own_transactional_welcome_emails(text) to authenticated",
    "grant execute on function public.complete_own_transactional_welcome_email(text, uuid, uuid, text, text, text) to authenticated",
    "grant execute on function public.claim_auth_transactional_email(text, text, text, text) to anon",
    "grant execute on function public.complete_auth_transactional_email(text, text, uuid, uuid, text, text, text) to anon",
  ]) || /grant execute on function public\.(?:claim_own_transactional_welcome_emails|complete_own_transactional_welcome_email)\([^;]*\) to anon\b/.test(sql)
    || /grant execute on function public\.(?:claim_auth_transactional_email|complete_auth_transactional_email)\([^;]*\) to authenticated\b/.test(sql)) {
    violations.add("welcome-acl");
  }

  if (!hasAll(welcomeClaim, [
    "v_authenticated_user_id uuid := auth.uid()",
    "where auth_user.id = v_authenticated_user_id",
    "delivery.user_id = v_authenticated_user_id",
    "registration.user_id = v_authenticated_user_id",
  ]) || !hasAll(welcomeComplete, [
    "v_authenticated_user_id uuid := auth.uid()",
    "delivery.user_id = v_authenticated_user_id",
    "delivery.attempt_token = p_attempt_token",
  ])) {
    violations.add("welcome-bola");
  }

  if (!hasAll(sql, [
    "create trigger on_user_registration_enqueue_welcome_email after insert on public.user_registrations",
    "create trigger on_coach_registration_enqueue_welcome_email after insert on public.coach_registrations",
  ]) || !hasAll(enqueueWelcome, [
    "tg_table_name = 'user_registrations'",
    "tg_table_name = 'coach_registrations'",
    "new.user_id",
    "v_delivery_kind := 'welcome_user'",
    "v_delivery_kind := 'welcome_coach'",
  ])) {
    violations.add("welcome-membership-source");
  }

  if (!sql.includes("create function public.claim_own_transactional_welcome_emails(p_capability text)")
    || !sql.includes("create function public.complete_own_transactional_welcome_email( p_capability text, p_delivery_id uuid")
    || /\bp_(?:user_id|email|recipient|portal|template|delivery_kind)\b/.test(welcomeClaim)
    || /\bp_(?:user_id|email|recipient|portal|template|delivery_kind)\b/.test(welcomeComplete)) {
    violations.add("welcome-no-client-routing");
  }

  if (!hasAll(verifyCapability, [
    "from vault.decrypted_secrets",
    "secret.name = 'organizatech_email_ledger_rpc_secret'",
    "private.transactional_email_constant_time_equal(",
    "extensions.digest(",
  ]) || !hasAll(constantTimeEqual, [
    "for v_index in 0..31 loop",
    "pg_catalog.get_byte(p_left, v_index) # pg_catalog.get_byte(p_right, v_index)",
  ]) || !authClaim.includes("private.verify_transactional_email_capability(p_capability)")
    || !authComplete.includes("private.verify_transactional_email_capability(p_capability)")
    || !welcomeClaim.includes("private.verify_transactional_email_capability(p_capability)")
    || !welcomeComplete.includes("private.verify_transactional_email_capability(p_capability)")) {
    violations.add("auth-proof");
  }

  if (!hasAll(authClaim, [
    "'password_changed_notification'",
    "'email_changed_notification'",
    "'phone_changed_notification'",
    "'identity_linked_notification'",
    "'identity_unlinked_notification'",
    "'mfa_factor_enrolled_notification'",
    "'mfa_factor_unenrolled_notification'",
    "{email_data,old_email}",
  ])) {
    violations.add("auth-global-actions");
  }

  if (!hasAll(authClaim, [
    "v_event := p_payload::jsonb",
    "v_user_id := (v_event #>> '{user,id}')::uuid",
    "v_event #>> '{user,email}'",
  ]) || /\bfrom\s+auth\.users\b/.test(authClaim)
    || /\bfrom\s+private\.auth_registration_pending_memberships\b/.test(authClaim)) {
    violations.add("auth-precommit-snapshot");
  }

  if (!hasAll(authClaim, [
    "{user,user_metadata,organizatech_email_presentation,portal}",
    "{user,user_metadata,display_name}",
  ]) || authClaim.includes("{user,user_metadata,organizatech_registration_portal}")
    || authClaim.includes("{user,user_metadata,organizatech_email_presentation,first_name}")
    || authClaim.includes("{user,user_metadata,organizatech_email_presentation,last_name}")
    || !hasAll(capture, [
      "new.raw_user_meta_data := v_metadata - 'organizatech_email_presentation'",
      "'display_name', pg_catalog.concat_ws(' ', v_first_name, v_last_name)",
      "'organizatech_email_presentation', jsonb_build_object('portal', v_portal)",
    ])
    || !hasAll(protectPresentation, [
      "- 'organizatech_email_presentation'",
      "v_previous -> 'organizatech_email_presentation'",
    ])) {
    violations.add("portal-presentation");
  }

  const executable = withoutSqlComments(source);
  if (/\bservice_role\b/i.test(executable)
    || /\bwhsec_[a-z0-9+/=_-]{12,}\b/i.test(executable)
    || /\bxkeysib-[a-z0-9_-]{8,}\b/i.test(executable)
    || /\beyj[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/i.test(executable)) {
    violations.add("secret-surface");
  }

  return violations;
}

function replaceOnce(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length - 1, 1, `precondición de mutación única: ${target}`);
  return source.replace(target, replacement);
}

function replaceOnceInsideFunction(
  source: string,
  qualifiedName: string,
  target: string,
  replacement: string,
) {
  const block = functionSource(source, qualifiedName);
  assert.ok(block, `precondición: función ${qualifiedName} presente`);
  const mutatedBlock = replaceOnce(block, target, replacement);
  const blockOffset = source.indexOf(block);
  assert.ok(blockOffset >= 0, `precondición: offset de ${qualifiedName} presente`);
  return `${source.slice(0, blockOffset)}${mutatedBlock}${source.slice(blockOffset + block.length)}`;
}

const source = readFileSync(MIGRATION_PATH, "utf8");

test("EMAIL-ONBOARDING-01 SQL conserva ledger privado, RLS, ACL e idempotencia", () => {
  assert.deepEqual([...inspectMigration(source)], []);
});

test("mutation probes detectan debilitamientos relevantes del boundary SQL", async (t) => {
  const mutations: ReadonlyArray<{
    name: string;
    violation: Violation;
    mutate(source: string): string;
  }> = [
    {
      name: "RLS deja de ser forzado",
      violation: "ledger-force-rls",
      mutate: (sql) => replaceOnce(
        sql,
        "alter table private.transactional_email_deliveries force row level security;",
        "alter table private.transactional_email_deliveries no force row level security;",
      ),
    },
    {
      name: "anon obtiene el claim de bienvenida",
      violation: "welcome-acl",
      mutate: (sql) => replaceOnce(
        sql,
        "grant execute on function public.claim_own_transactional_welcome_emails(text) to authenticated;",
        "grant execute on function public.claim_own_transactional_welcome_emails(text) to anon;",
      ),
    },
    {
      name: "PUBLIC obtiene EXECUTE con mayúsculas, multilinea y múltiples funciones",
      violation: "function-public-execute",
      mutate: (sql) => `${sql}\nGRANT\n  EXECUTE\nON FUNCTION\n  private.enqueue_membership_welcome_email(),\n  public.claim_own_transactional_welcome_emails(text)\nTO\n  PUBLIC;\n`,
    },
    {
      name: "PUBLIC aparece después de otros privilegios y grantees",
      violation: "function-public-execute",
      mutate: (sql) => `${sql}\nGrAnT USAGE, ExEcUtE\n  ON ROUTINE private.enqueue_membership_welcome_email()\n  TO authenticated, PuBlIc;\n`,
    },
    {
      name: "PUBLIC obtiene ALL sobre todas las funciones privadas",
      violation: "function-public-execute",
      mutate: (sql) => `${sql}\nGRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA private TO PUBLIC;\n`,
    },
    {
      name: "PUBLIC obtiene EXECUTE en la última sentencia sin terminador",
      violation: "function-public-execute",
      mutate: (sql) => `${sql}\nGRANT EXECUTE ON FUNCTION private.enqueue_membership_welcome_email() TO PUBLIC`,
    },
    {
      name: "el claim deja de filtrar la fila por auth.uid",
      violation: "welcome-bola",
      mutate: (sql) => replaceOnce(
        sql,
        "where delivery.user_id = v_authenticated_user_id\n      and delivery.delivery_kind",
        "where delivery.user_id is not null\n      and delivery.delivery_kind",
      ),
    },
    {
      name: "bienvenida se encola antes de materializar membership",
      violation: "welcome-membership-source",
      mutate: (sql) => replaceOnce(
        sql,
        "after insert on public.user_registrations",
        "before insert on public.user_registrations",
      ),
    },
    {
      name: "ledger pierde unicidad lógica",
      violation: "idempotency",
      mutate: (sql) => replaceOnce(
        sql,
        "constraint transactional_email_deliveries_event_unique unique (",
        "constraint transactional_email_deliveries_event_unique check (",
      ),
    },
    {
      name: "welcome vuelve a reclamar un pending ya intentado",
      violation: "ambiguous-retry-boundary",
      mutate: (sql) => replaceOnce(
        sql,
        "delivery.status = 'pending'\n          and delivery.attempt_count = 0",
        "delivery.status = 'pending'\n          and delivery.attempt_count >= 0",
      ),
    },
    {
      name: "Auth vuelve a reclamar un resultado pending ambiguo",
      violation: "ambiguous-retry-boundary",
      mutate: (sql) => replaceOnce(
        sql,
        "where private.transactional_email_deliveries.status = 'failed'\n    returning private.transactional_email_deliveries.*",
        "where private.transactional_email_deliveries.status in ('failed', 'pending')\n    returning private.transactional_email_deliveries.*",
      ),
    },
    {
      name: "cliente elige el portal de bienvenida",
      violation: "welcome-no-client-routing",
      mutate: (sql) => replaceOnce(
        sql,
        "create function public.claim_own_transactional_welcome_emails(p_capability text)",
        "create function public.claim_own_transactional_welcome_emails(p_capability text, p_portal text)",
      ),
    },
    {
      name: "claim Auth omite capability Edge",
      violation: "auth-proof",
      mutate: (sql) => {
        const block = functionSource(sql, "public.claim_auth_transactional_email");
        assert.ok(block);
        const mutatedBlock = replaceOnce(
          block,
          "  if not private.verify_transactional_email_capability(p_capability)\n",
          "  if false\n",
        );
        const blockOffset = sql.indexOf(block);
        assert.ok(blockOffset >= 0);
        const mutatedSql = `${sql.slice(0, blockOffset)}${mutatedBlock}${sql.slice(blockOffset + block.length)}`;
        assert.equal(
          normalized(functionSource(mutatedSql, "public.claim_auth_transactional_email"))
            .includes("private.verify_transactional_email_capability(p_capability)"),
          false,
          "precondición: la mutación debe eliminar capability del claim Auth",
        );
        return mutatedSql;
      },
    },
    {
      name: "ledger vuelve a persistir destinatario plaintext",
      violation: "ledger-no-plaintext-recipient",
      mutate: (sql) => replaceOnce(
        sql,
        "  recipient_fingerprint text,",
        "  recipient_email text,",
      ),
    },
    {
      name: "helper de capability se duplica",
      violation: "function-uniqueness",
      mutate: (sql) => `${sql}\n${functionSource(
        sql,
        "private.verify_transactional_email_capability",
      )};\n`,
    },
    ...EXPECTED_SECURITY_DEFINER_FUNCTIONS.map((qualifiedName) => ({
      name: `${qualifiedName} pierde search_path vacío`,
      violation: "function-boundaries" as const,
      mutate: (sql: string) => replaceOnceInsideFunction(
        sql,
        qualifiedName,
        "set search_path = ''",
        "set search_path = public",
      ),
    })),
    {
      name: "search_path vacío no acepta schemas adicionales",
      violation: "function-boundaries",
      mutate: (sql) => replaceOnceInsideFunction(
        sql,
        "private.enqueue_membership_welcome_email",
        "set search_path = ''",
        "set search_path = '', public",
      ),
    },
    {
      name: "un literal no suplanta SECURITY DEFINER",
      violation: "function-boundaries",
      mutate: (sql) => replaceOnceInsideFunction(
        sql,
        "public.claim_own_transactional_welcome_emails",
        "security definer\nset search_path = ''",
        "security invoker\nset application_name = 'security definer'\nset search_path = ''",
      ),
    },
    {
      name: "SECURITY DEFINER privado pierde nombre calificado",
      violation: "function-boundaries",
      mutate: (sql) => replaceOnce(
        sql,
        "create function private.enqueue_membership_welcome_email()",
        "create function enqueue_membership_welcome_email()",
      ),
    },
    {
      name: "SECURITY DEFINER público pierde nombre calificado",
      violation: "function-boundaries",
      mutate: (sql) => replaceOnce(
        sql,
        "create function public.complete_auth_transactional_email(",
        "create function complete_auth_transactional_email(",
      ),
    },
    {
      name: "claim Auth consulta la transacción GoTrue aún no confirmada",
      violation: "auth-precommit-snapshot",
      mutate: (sql) => replaceOnce(
        sql,
        "  v_signed_email := pg_catalog.lower",
        "  perform 1 from auth.users;\n  v_signed_email := pg_catalog.lower",
      ),
    },
    {
      name: "portal crudo reemplaza el hint reservado validado",
      violation: "portal-presentation",
      mutate: (sql) => replaceOnce(
        sql,
        "{user,user_metadata,organizatech_email_presentation,portal}",
        "{user,user_metadata,organizatech_registration_portal}",
      ),
    },
    {
      name: "service role aparece en superficie versionada",
      violation: "secret-surface",
      mutate: (sql) => `${sql}\nselect 'service_role';\n`,
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const violations = inspectMigration(mutation.mutate(source));
      assert.equal(
        violations.has(mutation.violation),
        true,
        `${mutation.name} debe disparar ${mutation.violation}; obtuvo ${[...violations].join(", ")}`,
      );
    });
  }
});
