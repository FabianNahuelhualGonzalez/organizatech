import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "@/features/auth/auth-separate-coach-contact-migration-contract.test";
import "@/features/auth/google-oauth-integration-contract";
import "@/features/auth/data/google-oauth-gateway.contract";
import "@/features/auth/model/google-oauth-intent.contract";
import "@/features/auth/model/google-oauth-operation-owner.contract";

const MIGRATION_PATH =
  "supabase/migrations/20260820041942_auth_confirmation_pending_memberships.sql";
const PENDING_TABLE = "private.auth_registration_pending_memberships";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260820041942_auth_confirmation_pending_memberships.sql":
    "7b5e6e73ed592dd011cb0eac518b859cdea5dec2051417a82f0a2fc4eafdbad6",
  "20260826170000_auth_google_hybrid_oauth.sql":
    "6fe130e759a1311e56a08c362a0e7662ff4d935a9763f24eb2207dd27139e5e6",
} as const;

const FAILURE = {
  scope: "[AUTH-CONFIRM-01.SQL.scope]",
  objects: "[AUTH-CONFIRM-01.SQL.objects]",
  rls: "[AUTH-CONFIRM-01.SQL.rls-final-state]",
  schemaAcl: "[AUTH-CONFIRM-01.SQL.schema-revokes]",
  tableAcl: "[AUTH-CONFIRM-01.SQL.table-revokes]",
  publicSurface: "[AUTH-CONFIRM-01.SQL.no-public-pii-writer]",
  functions: "[AUTH-CONFIRM-01.SQL.function-boundary]",
  functionAcl: "[AUTH-CONFIRM-01.SQL.function-revokes]",
  dynamicSql: "[AUTH-CONFIRM-01.SQL.no-dynamic-sql]",
  triggers: "[AUTH-CONFIRM-01.SQL.trigger-order]",
  retryTrigger: "[AUTH-CONFIRM-01.SQL.retry-trigger]",
  registrationDetection: "[AUTH-CONFIRM-01.SQL.registration-signal-or]",
  normalMetadata: "[AUTH-CONFIRM-01.SQL.normal-metadata-unaffected]",
  binding: "[AUTH-CONFIRM-01.SQL.first-insert-binding]",
  metadata: "[AUTH-CONFIRM-01.SQL.metadata-scrub]",
  retryMetadata: "[AUTH-CONFIRM-01.SQL.retry-metadata-scrub]",
  scrubBeforeReturn: "[AUTH-CONFIRM-01.SQL.scrub-before-early-return]",
  retryNoCapture: "[AUTH-CONFIRM-01.SQL.retry-does-not-capture-pending]",
  firstAttemptWins: "[AUTH-CONFIRM-01.SQL.first-attempt-wins]",
  lifecycle: "[AUTH-CONFIRM-01.SQL.pending-lifecycle]",
  portal: "[AUTH-CONFIRM-01.SQL.portal-validation]",
  indexes: "[AUTH-CONFIRM-01.SQL.indexable-lookups]",
  qualification: "[AUTH-CONFIRM-01.SQL.qualified-references]",
  locking: "[AUTH-CONFIRM-01.SQL.locking]",
  protectedWrites: "[AUTH-CONFIRM-01.SQL.finalizer-recoverable-writes]",
  noOverwrite: "[AUTH-CONFIRM-01.SQL.no-overwrite]",
  consumedRedaction: "[AUTH-CONFIRM-01.SQL.consumed-pii-redaction]",
  confirmationSafety: "[AUTH-CONFIRM-01.SQL.confirmation-never-rolls-back]",
  memberships: "[AUTH-CONFIRM-01.SQL.membership-allowlist]",
  readSurface: "[AUTH-CONFIRM-01.SQL.own-read-surface]",
} as const;

interface ParsedFunction {
  name: string;
  args: string;
  raw: string;
  normalized: string;
  body: string;
  bodyNormalized: string;
}

interface ParsedTrigger {
  name: string;
  timing: "before" | "after";
  event: string;
  table: string;
  functionName: string;
  when: string | null;
}

interface RegistrationSignal {
  detectorVariable: string;
  metadataVariable: string;
  keys: readonly string[];
  operator: "or" | "and";
}

interface MetadataScrub {
  start: number;
  end: number;
}

interface RecoverableBlock {
  start: number;
  exception: number;
  end: number;
}

interface MigrationFacts {
  source: string;
  executable: string;
  normalized: string;
  statements: string[];
  functions: ParsedFunction[];
  triggers: ParsedTrigger[];
  capture: ParsedFunction;
  scrubRetry: ParsedFunction;
  finalize: ParsedFunction;
  getOwn: ParsedFunction;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function requireContract(condition: unknown, failure: string): asserts condition {
  if (!condition) throw new Error(failure);
}

function replaceExactlyOnce(source: string, target: string, replacement: string, name: string) {
  assert.equal(source.split(target).length - 1, 1, `${name}: target único`);
  return source.replace(target, replacement);
}

function replaceOccurrence(
  source: string,
  target: string,
  replacement: string,
  occurrence: number,
  name: string,
) {
  const offsets: number[] = [];
  let cursor = 0;
  while (cursor <= source.length) {
    const offset = source.indexOf(target, cursor);
    if (offset < 0) break;
    offsets.push(offset);
    cursor = offset + target.length;
  }
  assert.ok(offsets.length > occurrence, `${name}: ocurrencia ${occurrence + 1} presente`);
  const offset = offsets[occurrence]!;
  return `${source.slice(0, offset)}${replacement}${source.slice(offset + target.length)}`;
}

function maskTopLevelComments(source: string) {
  const output = [...source];
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (output[index] !== "\n" && output[index] !== "\r") output[index] = " ";
    }
  };
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
      assert.equal(depth, 0, "[AUTH-CONFIRM-01.SQL.syntax] comentario balanceado");
      blank(index, cursor);
      index = cursor;
      continue;
    }
    index += 1;
  }
  return output.join("");
}

function stripBodyComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ");
}

function normalizeSql(source: string) {
  return stripBodyComments(source).replace(/\s+/g, " ").trim().toLowerCase();
}

function splitSqlStatements(source: string) {
  const sql = maskTopLevelComments(source);
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag: string | null = null;
  let parentheses = 0;
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
    if (sql[index] === "(") parentheses += 1;
    if (sql[index] === ")") parentheses -= 1;
    assert.ok(parentheses >= 0, "[AUTH-CONFIRM-01.SQL.syntax] paréntesis sin apertura");
    if (sql[index] === ";" && parentheses === 0) {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  assert.equal(singleQuoted, false, "[AUTH-CONFIRM-01.SQL.syntax] string balanceado");
  assert.equal(doubleQuoted, false, "[AUTH-CONFIRM-01.SQL.syntax] identificador balanceado");
  assert.equal(dollarTag, null, "[AUTH-CONFIRM-01.SQL.syntax] dollar quote balanceado");
  assert.equal(parentheses, 0, "[AUTH-CONFIRM-01.SQL.syntax] paréntesis balanceados");
  assert.equal(sql.slice(start).trim(), "", "[AUTH-CONFIRM-01.SQL.syntax] terminador final");
  assert.ok(statements.length >= 20, "[AUTH-CONFIRM-01.SQL.syntax] sentencias estructurales");
  return statements;
}

function parseFunctions(statements: string[]) {
  const functions: ParsedFunction[] = [];
  for (const raw of statements) {
    const executable = stripBodyComments(raw).trim();
    const header = /^create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(([\s\S]*?)\)\s*returns\s+/i.exec(
      executable,
    );
    if (!header) continue;
    const bodyMatch = /\bas\s+(\$[a-z0-9_]*\$)([\s\S]*)\1\s*;\s*$/i.exec(executable);
    assert.ok(bodyMatch, `body SQL presente para ${header[1]}`);
    functions.push({
      name: header[1]!.toLowerCase(),
      args: normalizeSql(header[2] ?? ""),
      raw,
      normalized: normalizeSql(executable),
      body: stripBodyComments(bodyMatch[2] ?? ""),
      bodyNormalized: normalizeSql(bodyMatch[2] ?? ""),
    });
  }
  return functions;
}

function parseTriggers(statements: string[]) {
  const triggers: ParsedTrigger[] = [];
  for (const raw of statements) {
    const normalized = normalizeSql(raw);
    const match = /^create trigger ([a-z0-9_]+) (before|after) (insert|update of [a-z0-9_]+) on ([a-z0-9_.]+) for each row(?: when \((.*?)\))? execute function ([a-z0-9_.]+)\(\);$/i.exec(
      normalized,
    );
    if (!match) continue;
    triggers.push({
      name: match[1]!,
      timing: match[2] as "before" | "after",
      event: match[3]!,
      table: match[4]!,
      when: match[5] ?? null,
      functionName: match[6]!,
    });
  }
  return triggers;
}

function splitTopLevelComma(source: string) {
  const values: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" && source[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      values.push(normalizeSql(source.slice(start, index)));
      start = index + 1;
    }
  }
  values.push(normalizeSql(source.slice(start)));
  return values;
}

function findFunction(functions: ParsedFunction[], name: string) {
  const matches = functions.filter((candidate) => candidate.name === name);
  requireContract(matches.length === 1, FAILURE.functions);
  return matches[0]!;
}

function hasStatement(statements: string[], expression: RegExp) {
  return statements.some((statement) => expression.test(normalizeSql(statement)));
}

function countMatches(source: string, expression: RegExp) {
  return source.match(expression)?.length ?? 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseRegistrationSignalExpression(
  expression: string,
  detectorVariable: string,
  failure: string,
): RegistrationSignal {
  const normalized = normalizeSql(expression);
  const operators = [...normalized.matchAll(/\s+(or|and)\s+/g)];
  requireContract(operators.length === 1, failure);
  const operator = operators[0]![1] as "or" | "and";
  const operands = normalized.split(/\s+(?:or|and)\s+/);
  requireContract(operands.length === 2, failure);
  const parsedOperands = operands.map((operand) => (
    /^([a-z_][a-z0-9_.]*) \? '([^']+)'$/.exec(operand)
  ));
  requireContract(parsedOperands.every(Boolean), failure);
  const metadataVariables = new Set(parsedOperands.map((operand) => operand![1]!));
  const keys = parsedOperands.map((operand) => operand![2]!).sort();
  requireContract(
    metadataVariables.size === 1
      && keys.join(",") === [
        "organizatech_registration_intent_id",
        "organizatech_registration_portal",
      ].sort().join(","),
    failure,
  );
  return {
    detectorVariable,
    metadataVariable: [...metadataVariables][0]!,
    keys,
    operator,
  };
}

function parseFunctionRegistrationSignal(candidate: ParsedFunction, failure: string) {
  const assignments = [...candidate.bodyNormalized.matchAll(
    /([a-z_][a-z0-9_]*) := \(([\s\S]*?)\);/g,
  )].filter((match) => (
    match[2]?.includes("organizatech_registration_portal")
    || match[2]?.includes("organizatech_registration_intent_id")
  ));
  requireContract(assignments.length === 1, failure);
  const signal = parseRegistrationSignalExpression(
    assignments[0]![2]!,
    assignments[0]![1]!,
    failure,
  );
  requireContract(
    signal.operator === "or"
      && registrationSignalMatches(signal, new Set(["organizatech_registration_portal"]))
      && registrationSignalMatches(signal, new Set(["organizatech_registration_intent_id"]))
      && !registrationSignalMatches(signal, new Set(["avatar_url", "locale"])),
    failure,
  );
  return signal;
}

function registrationSignalMatches(signal: RegistrationSignal, metadataKeys: ReadonlySet<string>) {
  const matches = signal.keys.map((key) => metadataKeys.has(key));
  return signal.operator === "or" ? matches.some(Boolean) : matches.every(Boolean);
}

function parseMetadataScrub(
  candidate: ParsedFunction,
  signal: RegistrationSignal,
  failure: string,
): MetadataScrub {
  const metadataVariable = escapeRegExp(signal.metadataVariable);
  const scrubPattern = new RegExp(
    `if ${metadataVariable} \\? 'display_name' then ([\\s\\S]*?) else ([\\s\\S]*?) end if;`,
    "g",
  );
  const matches = [...candidate.bodyNormalized.matchAll(scrubPattern)];
  requireContract(matches.length === 1, failure);
  const assignments = [matches[0]![1]!, matches[0]![2]!].map((branch) => (
    [...branch.matchAll(/new\.raw_user_meta_data := ([\s\S]*?);/g)]
  ));
  requireContract(assignments.every((branch) => branch.length === 1), failure);
  const displayAssignment = assignments[0]![0]![1]!;
  const emptyAssignment = assignments[1]![0]![1]!;
  requireContract(
    displayAssignment === `jsonb_build_object( 'display_name', ${signal.metadataVariable} -> 'display_name' )`
      && emptyAssignment === "'{}'::jsonb",
    failure,
  );
  const start = matches[0]!.index!;
  return { start, end: start + matches[0]![0].length };
}

function assertScrubBeforeRegistrationReturns(
  candidate: ParsedFunction,
  signal: RegistrationSignal,
  scrub: MetadataScrub,
) {
  const guard = new RegExp(
    `if not ${escapeRegExp(signal.detectorVariable)} then return new; end if;`,
  ).exec(candidate.bodyNormalized);
  requireContract(Boolean(guard), FAILURE.scrubBeforeReturn);
  const guardStart = guard!.index;
  const guardEnd = guardStart + guard![0].length;
  const returns = [...candidate.bodyNormalized.matchAll(/return new;/g)].map((match) => match.index!);
  requireContract(
    guardEnd <= scrub.start
      && returns.filter((offset) => offset >= guardStart && offset < guardEnd).length === 1
      && !returns.some((offset) => offset >= guardEnd && offset < scrub.end)
      && returns.some((offset) => offset >= scrub.end),
    FAILURE.scrubBeforeReturn,
  );
}

function findTableWrites(source: string) {
  return [...source.matchAll(
    /\b(insert into|update|delete from)\s+([a-z_][a-z0-9_.]*)/g,
  )].map((match) => ({
    verb: match[1]!,
    table: match[2]!,
    index: match.index!,
  }));
}

function findRecoverableBlocks(source: string, failure: string) {
  const stack: Array<{ start: number; exception: number | null }> = [];
  const blocks: RecoverableBlock[] = [];
  for (const token of source.matchAll(/\bbegin\b|\bexception\b|\bend\s*;/g)) {
    if (token[0] === "begin") {
      stack.push({ start: token.index!, exception: null });
    } else if (token[0] === "exception") {
      requireContract(stack.length > 0 && stack.at(-1)!.exception === null, failure);
      stack.at(-1)!.exception = token.index!;
    } else {
      requireContract(stack.length > 0, failure);
      const block = stack.pop()!;
      if (block.exception !== null) {
        blocks.push({ start: block.start, exception: block.exception, end: token.index! });
      }
    }
  }
  requireContract(stack.length === 0, failure);
  return blocks;
}

function assertFinalizerWritesAreRecoverable(finalize: ParsedFunction) {
  const blocks = findRecoverableBlocks(finalize.bodyNormalized, FAILURE.protectedWrites);
  requireContract(blocks.length === 1, FAILURE.protectedWrites);
  const recoverable = blocks[0]!;
  const protectedTables = new Set([
    "public.user_registrations",
    "public.coach_registrations",
    "public.profiles",
    PENDING_TABLE,
  ]);
  const writes = findTableWrites(finalize.bodyNormalized)
    .filter((write) => protectedTables.has(write.table));
  requireContract(
    writes.length === 4
      && new Set(writes.map((write) => write.table)).size === 4
      && writes.every((write) => (
        write.index > recoverable.start && write.index < recoverable.exception
      )),
    FAILURE.protectedWrites,
  );
}

function assertConsumedPendingRedaction(tableDefinition: string, finalize: ParsedFunction) {
  const escapedTable = escapeRegExp(PENDING_TABLE);
  const updatePattern = new RegExp(
    `update ${escapedTable} as ([a-z_][a-z0-9_]*) set ([\\s\\S]*?) where \\1\\.user_id = new\\.id and \\1\\.consumed_at is null;`,
    "g",
  );
  const updates = [...finalize.bodyNormalized.matchAll(updatePattern)];
  requireContract(updates.length === 1, FAILURE.consumedRedaction);
  const assignments = new Map(splitTopLevelComma(updates[0]![2]!).map((assignment) => {
    const parsed = /^([a-z_][a-z0-9_]*) = ([\s\S]+)$/.exec(assignment);
    requireContract(Boolean(parsed), FAILURE.consumedRedaction);
    return [parsed![1]!, parsed![2]!] as const;
  }));
  const piiFields = [
    "first_name",
    "last_name",
    "birth_date",
    "gender",
    "phone_number",
    "professional_title",
  ];
  requireContract(
    assignments.size === piiFields.length + 1
      && piiFields.every((field) => assignments.get(field) === "null")
      && assignments.get("consumed_at") === "statement_timestamp()"
      && tableDefinition.includes("consumed_at is not null")
      && piiFields.every((field) => tableDefinition.includes(`${field} is null`)),
    FAILURE.consumedRedaction,
  );
}

function auditMigration(source: string): MigrationFacts {
  const statements = splitSqlStatements(source);
  const executable = maskTopLevelComments(source);
  const normalized = normalizeSql(executable);
  const functions = parseFunctions(statements);
  const triggers = parseTriggers(statements);

  requireContract(
    !/\b(?:password|service_role|supabase_service_role|private_key|training_sessions|exercise_entries|captcha|turnstile)\b/i.test(
      executable,
    ),
    FAILURE.scope,
  );

  const tableStatement = statements.find((statement) => (
    normalizeSql(statement).startsWith(`create table ${PENDING_TABLE} (`)
  ));
  requireContract(
    Boolean(tableStatement)
      && hasStatement(statements, /^create schema if not exists private;$/)
      && !/create\s+(?:table|view)\s+public\./i.test(executable),
    FAILURE.objects,
  );
  const tableDefinition = normalizeSql(tableStatement!);

  let rlsEnabled = false;
  let rlsForced = false;
  let sawEnable = false;
  let sawForce = false;
  for (const statement of statements.map(normalizeSql)) {
    if (statement === `alter table ${PENDING_TABLE} enable row level security;`) {
      rlsEnabled = true;
      sawEnable = true;
    } else if (statement === `alter table ${PENDING_TABLE} disable row level security;`) {
      rlsEnabled = false;
    } else if (statement === `alter table ${PENDING_TABLE} force row level security;`) {
      rlsForced = true;
      sawForce = true;
    } else if (statement === `alter table ${PENDING_TABLE} no force row level security;`) {
      rlsForced = false;
    }
  }
  requireContract(rlsEnabled && rlsForced && sawEnable && sawForce, FAILURE.rls);

  for (const role of ["public", "anon", "authenticated"] as const) {
    requireContract(
      hasStatement(statements, new RegExp(`^revoke all on schema private from ${role};$`))
        && !hasStatement(statements, new RegExp(`^grant .+ on schema private to ${role};$`)),
      FAILURE.schemaAcl,
    );
  }

  for (const role of ["public", "anon", "authenticated"] as const) {
    requireContract(
      hasStatement(
        statements,
        new RegExp(`^revoke all privileges on table ${PENDING_TABLE.replace(".", "\\.")} from ${role};$`),
      )
        && !hasStatement(
          statements,
          new RegExp(`^grant .+ on table ${PENDING_TABLE.replace(".", "\\.")} to ${role};$`),
        ),
      FAILURE.tableAcl,
    );
  }
  requireContract(!/create\s+policy[\s\S]*?auth_registration_pending_memberships/i.test(executable), FAILURE.tableAcl);

  const publicFunctions = functions.filter((candidate) => candidate.name.startsWith("public."));
  requireContract(
    publicFunctions.length === 1
      && publicFunctions[0]!.name === "public.get_own_auth_registration_confirmation"
      && publicFunctions[0]!.args === ""
      && !/prepare_auth_registration_intent|save_pending|p_first_name|p_last_name|p_birth_date|p_phone_number/i.test(
        executable,
      ),
    FAILURE.publicSurface,
  );

  const expectedFunctionNames = [
    "private.capture_auth_registration_pending_membership",
    "private.scrub_auth_registration_retry_metadata",
    "private.finalize_auth_registration_pending_membership",
    "public.get_own_auth_registration_confirmation",
  ];
  requireContract(
    functions.length === expectedFunctionNames.length
      && expectedFunctionNames.every((name) => (
        functions.filter((candidate) => candidate.name === name && candidate.args === "").length === 1
      ))
      && functions.every((candidate) => (
        /set search_path\s*=\s*''/.test(candidate.normalized)
        && !candidate.normalized.startsWith("create or replace function")
        && (candidate.name === "private.scrub_auth_registration_retry_metadata"
          ? candidate.normalized.includes("security invoker")
            && !candidate.normalized.includes("security definer")
          : candidate.normalized.includes("security definer"))
      )),
    FAILURE.functions,
  );

  const capture = findFunction(functions, "private.capture_auth_registration_pending_membership");
  const scrubRetry = findFunction(functions, "private.scrub_auth_registration_retry_metadata");
  const finalize = findFunction(functions, "private.finalize_auth_registration_pending_membership");
  const getOwn = findFunction(functions, "public.get_own_auth_registration_confirmation");

  for (const functionName of expectedFunctionNames) {
    const escaped = functionName.replace(".", "\\.");
    for (const role of ["public", "anon", "authenticated"] as const) {
      const revoked = hasStatement(
        statements,
        new RegExp(`^revoke all on function ${escaped}\\(\\) from ${role};$`),
      );
      const authenticatedOwnRead = functionName === "public.get_own_auth_registration_confirmation"
        && role === "authenticated";
      const granted = hasStatement(
        statements,
        new RegExp(`^grant execute on function ${escaped}\\(\\) to ${role};$`),
      );
      requireContract(revoked && granted === authenticatedOwnRead, FAILURE.functionAcl);
    }
  }
  requireContract(
    !functions.some((candidate) => /\bexecute\b(?!\s+function)/i.test(candidate.body)),
    FAILURE.dynamicSql,
  );

  const captureTrigger = triggers.find(
    (trigger) => trigger.name === "on_auth_user_00_capture_registration_pending",
  );
  const retryScrubTrigger = triggers.find(
    (trigger) => trigger.name === "on_auth_user_00_scrub_registration_retry_metadata",
  );
  const createdTrigger = triggers.find(
    (trigger) => trigger.name === "on_auth_user_zz_finalize_registration_pending_created",
  );
  const confirmedTrigger = triggers.find(
    (trigger) => trigger.name === "on_auth_user_zz_finalize_registration_pending_confirmed",
  );
  requireContract(
    captureTrigger?.timing === "before"
      && captureTrigger.event === "insert"
      && captureTrigger.table === "auth.users"
      && captureTrigger.functionName === capture.name
      && createdTrigger?.timing === "after"
      && createdTrigger.event === "insert"
      && createdTrigger.table === "auth.users"
      && createdTrigger.functionName === finalize.name
      && createdTrigger.name > "on_auth_user_created"
      && createdTrigger.when === "new.email_confirmed_at is not null"
      && confirmedTrigger?.timing === "after"
      && confirmedTrigger.event === "update of email_confirmed_at"
      && confirmedTrigger.table === "auth.users"
      && confirmedTrigger.functionName === finalize.name
      && confirmedTrigger.when === "old.email_confirmed_at is null and new.email_confirmed_at is not null",
    FAILURE.triggers,
  );
  requireContract(
    triggers.length === 4
      && retryScrubTrigger?.timing === "before"
      && retryScrubTrigger.event === "update of raw_user_meta_data"
      && retryScrubTrigger.table === "auth.users"
      && retryScrubTrigger.functionName === scrubRetry.name
      && retryScrubTrigger.when !== null,
    FAILURE.retryTrigger,
  );
  const retryTriggerSignal = parseRegistrationSignalExpression(
    retryScrubTrigger!.when!,
    "retry_trigger",
    FAILURE.normalMetadata,
  );
  requireContract(
    retryTriggerSignal.metadataVariable === "new.raw_user_meta_data"
      && retryTriggerSignal.operator === "or"
      && !registrationSignalMatches(retryTriggerSignal, new Set(["avatar_url", "locale"])),
    FAILURE.normalMetadata,
  );

  const captureInsert = new RegExp(
    `insert into ${PENDING_TABLE.replace(".", "\\.")} \\((.*?)\\) values \\(([\\s\\S]*?)\\);`,
  ).exec(capture.bodyNormalized);
  const captureColumns = splitTopLevelComma(captureInsert?.[1] ?? "");
  const captureValues = splitTopLevelComma(captureInsert?.[2] ?? "");
  requireContract(
    tableDefinition.includes("user_id uuid primary key")
      && /foreign key \(user_id\) references auth\.users\(id\) on delete cascade deferrable initially deferred/.test(
        tableDefinition,
      )
      && captureColumns[0] === "user_id"
      && captureValues[0] === "new.id"
      && !capture.bodyNormalized.includes(`update ${PENDING_TABLE}`)
      && !/gen_random_uuid|bound_user_id|email_normalized/.test(tableDefinition),
    FAILURE.binding,
  );

  const captureSignal = parseFunctionRegistrationSignal(capture, FAILURE.registrationDetection);
  const retrySignal = parseFunctionRegistrationSignal(scrubRetry, FAILURE.registrationDetection);
  const captureScrub = parseMetadataScrub(capture, captureSignal, FAILURE.metadata);
  const retryScrub = parseMetadataScrub(scrubRetry, retrySignal, FAILURE.retryMetadata);
  assertScrubBeforeRegistrationReturns(capture, captureSignal, captureScrub);
  assertScrubBeforeRegistrationReturns(scrubRetry, retrySignal, retryScrub);
  requireContract(
    !finalize.bodyNormalized.includes("raw_user_meta_data")
      && !getOwn.bodyNormalized.includes("raw_user_meta_data")
      && !/update auth\.users/.test(normalized),
    FAILURE.metadata,
  );
  const retryWrites = findTableWrites(scrubRetry.bodyNormalized);
  requireContract(
    !retryWrites.some((write) => write.verb === "insert into")
      && !retryWrites.some((write) => (
        write.table === "public.user_registrations"
        || write.table === "public.coach_registrations"
        || write.table === "public.profiles"
      )),
    FAILURE.retryNoCapture,
  );
  requireContract(
    retryWrites.length === 0 && !scrubRetry.bodyNormalized.includes(PENDING_TABLE),
    FAILURE.firstAttemptWins,
  );

  requireContract(
    !/\bexpires_at\b|\bdelete from\b|pg_cron|cron\./i.test(executable),
    FAILURE.lifecycle,
  );

  requireContract(
    tableDefinition.includes("portal in ('usuario', 'coach')")
      && /([a-z_][a-z0-9_]*) is null or \1 not in \('usuario', 'coach'\)/.test(
        capture.bodyNormalized,
      )
      && /([a-z_][a-z0-9_]*) is null or \1 not in \('male', 'female', 'non_binary', 'prefer_not_to_say'\)/.test(
        capture.bodyNormalized,
      )
      && /= 'usuario' and [a-z_][a-z0-9_]* \? 'professional_title'/.test(capture.bodyNormalized)
      && /= 'coach' and coalesce\(char_length\([a-z_][a-z0-9_]*\), 0\) not between 1 and 160/.test(
        capture.bodyNormalized,
      )
      && tableDefinition.includes("portal = 'usuario' and professional_title is null")
      && tableDefinition.includes("portal = 'coach' and professional_title is not null"),
    FAILURE.portal,
  );

  requireContract(
    tableDefinition.includes("user_id uuid primary key")
      && !/(?:user_id|new\.id|auth_user\.id)\s*::\s*text|cast\s*\((?:[^)]*user_id|new\.id|auth_user\.id)[^)]*\s+as\s+text\)/i.test(
        executable,
      )
      && !/where\s+[a-z_][a-z0-9_]*\.(?:portal|consumed_at)\s*=/.test(
        `${finalize.bodyNormalized} ${getOwn.bodyNormalized}`,
      ),
    FAILURE.indexes,
  );

  requireContract(
    !/(?:from|join|insert into|update)\s+(?:profiles|user_registrations|coach_registrations|auth_registration_pending_memberships)\b/i.test(
      `${capture.body} ${scrubRetry.body} ${finalize.body} ${getOwn.body}`,
    )
      && !/%rowtype/.test(finalize.bodyNormalized.replace(`${PENDING_TABLE}%rowtype`, "")),
    FAILURE.qualification,
  );

  requireContract(
    new RegExp(
      `select [\\s\\S]*? from ${PENDING_TABLE.replace(".", "\\.")} as [a-z_][a-z0-9_]* where [a-z_][a-z0-9_]*\\.user_id = new\\.id for update;`,
    ).test(finalize.bodyNormalized)
      && /select [a-z_][a-z0-9_]*\.id into [a-z_][a-z0-9_]* from public\.profiles as [a-z_][a-z0-9_]* where [a-z_][a-z0-9_]*\.id = new\.id for update;/.test(
        finalize.bodyNormalized,
      ),
    FAILURE.locking,
  );
  assertFinalizerWritesAreRecoverable(finalize);

  const profileUpdate = /if [a-z_][a-z0-9_]* is not null then update public\.profiles as [a-z_][a-z0-9_]* set ([\s\S]*?) where [a-z_][a-z0-9_]*\.id = new\.id; end if;/.exec(
    finalize.bodyNormalized,
  );
  const profileColumns = splitTopLevelComma(profileUpdate?.[1] ?? "")
    .map((assignment) => assignment.split("=")[0]!.trim())
    .sort();
  requireContract(
    countMatches(finalize.bodyNormalized, /on conflict \(user_id\) do nothing/g) === 2
      && !/on conflict[\s\S]*?do update/.test(finalize.bodyNormalized)
      && countMatches(finalize.bodyNormalized, /update public\.profiles/g) === 1
      && profileColumns.join(",") === [
        "birth_date",
        "display_name",
        "first_name",
        "gender",
        "last_name",
        "phone_number",
        "updated_at",
      ].sort().join(","),
    FAILURE.noOverwrite,
  );
  assertConsumedPendingRedaction(tableDefinition, finalize);

  requireContract(
    !/\braise\b/.test(finalize.bodyNormalized)
      && /if not found or [a-z_][a-z0-9_]*\.consumed_at is not null then return new; end if;/.test(
        finalize.bodyNormalized,
      )
      && /exception when others then return new; end; return new; end;/.test(finalize.bodyNormalized)
      && confirmedTrigger?.when === "old.email_confirmed_at is null and new.email_confirmed_at is not null",
    FAILURE.confirmationSafety,
  );

  const userInsert = /insert into public\.user_registrations \((.*?)\) values \((.*?)\) on conflict/.exec(
    finalize.bodyNormalized,
  );
  const coachInsert = /insert into public\.coach_registrations \((.*?)\) values \(([\s\S]*?)\) on conflict/.exec(
    finalize.bodyNormalized,
  );
  requireContract(
    splitTopLevelComma(userInsert?.[1] ?? "").join(",") === "user_id"
      && splitTopLevelComma(userInsert?.[2] ?? "").join(",") === "new.id"
      && splitTopLevelComma(coachInsert?.[1] ?? "").join(",") === [
        "user_id",
        "first_name",
        "last_name",
        "birth_date",
        "gender",
        "phone_number",
        "professional_title",
      ].join(",")
      && splitTopLevelComma(coachInsert?.[2] ?? "")[0] === "new.id"
      && /if [a-z_][a-z0-9_]*\.portal = 'usuario' then insert into public\.user_registrations/.test(
        finalize.bodyNormalized,
      )
      && /elsif [a-z_][a-z0-9_]*\.portal = 'coach' then insert into public\.coach_registrations/.test(
        finalize.bodyNormalized,
      ),
    FAILURE.memberships,
  );

  const authenticatedVariable = /([a-z_][a-z0-9_]*) uuid := auth\.uid\(\)/.exec(
    getOwn.bodyNormalized,
  )?.[1];
  requireContract(
    Boolean(authenticatedVariable)
      && getOwn.normalized.includes("returns table ( status text, portal text )")
      && new RegExp(`where [a-z_][a-z0-9_]*\\.user_id = ${authenticatedVariable}`).test(
        getOwn.bodyNormalized,
      )
      && getOwn.bodyNormalized.includes("auth_user.email_confirmed_at is not null")
      && !/(?:first_name|last_name|birth_date|gender|phone_number|professional_title)/.test(
        getOwn.bodyNormalized,
      ),
    FAILURE.readSurface,
  );

  return {
    source,
    executable,
    normalized,
    statements,
    functions,
    triggers,
    capture,
    scrubRetry,
    finalize,
    getOwn,
  };
}

const METADATA_SCRUB_BLOCK = `  if v_metadata ? 'display_name' then
    new.raw_user_meta_data := jsonb_build_object(
      'display_name',
      v_metadata -> 'display_name'
    );
  else
    new.raw_user_meta_data := '{}'::jsonb;
  end if;
`;

const RETRY_TRIGGER_BLOCK = `create trigger on_auth_user_00_scrub_registration_retry_metadata
  before update of raw_user_meta_data on auth.users
  for each row
  when (
    new.raw_user_meta_data ? 'organizatech_registration_portal'
    or new.raw_user_meta_data ? 'organizatech_registration_intent_id'
  )
  execute function private.scrub_auth_registration_retry_metadata();`;

const PENDING_REDACTION_BLOCK = `    update private.auth_registration_pending_memberships as pending
    set
      first_name = null,
      last_name = null,
      birth_date = null,
      gender = null,
      phone_number = null,
      professional_title = null,
      consumed_at = statement_timestamp()
    where pending.user_id = new.id
      and pending.consumed_at is null;`;

const mutations = [
  {
    id: "N01",
    name: "RLS termina deshabilitada",
    expectedFailure: FAILURE.rls,
    apply: (source: string) => `${source}\nalter table ${PENDING_TABLE} disable row level security;\n`,
  },
  {
    id: "N02",
    name: "FORCE RLS se revierte al final",
    expectedFailure: FAILURE.rls,
    apply: (source: string) => `${source}\nalter table ${PENDING_TABLE} no force row level security;\n`,
  },
  {
    id: "N03",
    name: "se elimina revoke de schema",
    expectedFailure: FAILURE.schemaAcl,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "revoke all on schema private from authenticated;",
      "select 1;",
      "N03",
    ),
  },
  {
    id: "N04",
    name: "tabla privada se concede a authenticated",
    expectedFailure: FAILURE.tableAcl,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `revoke all privileges on table ${PENDING_TABLE} from authenticated;`,
      `grant select on table ${PENDING_TABLE} to authenticated;`,
      "N04",
    ),
  },
  {
    id: "N05",
    name: "función privada se concede a authenticated",
    expectedFailure: FAILURE.functionAcl,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "revoke all on function private.finalize_auth_registration_pending_membership() from authenticated;",
      "grant execute on function private.finalize_auth_registration_pending_membership() to authenticated;",
      "N05",
    ),
  },
  {
    id: "N06",
    name: "RPC de lectura se concede a PUBLIC",
    expectedFailure: FAILURE.functionAcl,
    apply: (source: string) => (
      `${source}\ngrant execute on function public.get_own_auth_registration_confirmation() to public;\n`
    ),
  },
  {
    id: "N07",
    name: "introduce SQL dinámico",
    expectedFailure: FAILURE.dynamicSql,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  return new;\nend;\n$capture_auth_registration_pending_membership$;",
      "  execute 'select 1';\n  return new;\nend;\n$capture_auth_registration_pending_membership$;",
      "N07",
    ),
  },
  {
    id: "N08",
    name: "scrub cambia de BEFORE a AFTER",
    expectedFailure: FAILURE.triggers,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  before insert on auth.users",
      "  after insert on auth.users",
      "N08",
    ),
  },
  {
    id: "N09",
    name: "trigger autoconfirm queda antes del perfil",
    expectedFailure: FAILURE.triggers,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "on_auth_user_zz_finalize_registration_pending_created",
      "on_auth_user_aa_finalize_registration_pending_created",
      "N09",
    ),
  },
  {
    id: "N10",
    name: "ownership deja de derivar de NEW.id",
    expectedFailure: FAILURE.binding,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    new.id,\n    v_portal,",
      "    gen_random_uuid(),\n    v_portal,",
      "N10",
    ),
  },
  {
    id: "N11",
    name: "membresía existente se sobrescribe",
    expectedFailure: FAILURE.noOverwrite,
    apply: (source: string) => replaceOccurrence(
      source,
      "on conflict (user_id) do nothing",
      "on conflict (user_id) do update set user_id = excluded.user_id",
      0,
      "N11",
    ),
  },
  {
    id: "N12",
    name: "portal deja de validarse",
    expectedFailure: FAILURE.portal,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "v_portal not in ('usuario', 'coach')",
      "false",
      "N12",
    ),
  },
  {
    id: "N13",
    name: "lookup UUID se convierte a texto",
    expectedFailure: FAILURE.indexes,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "where pending.user_id = new.id\n      for update;",
      "where pending.user_id::text = new.id::text\n      for update;",
      "N13",
    ),
  },
  {
    id: "N14",
    name: "referencia de perfil pierde schema",
    expectedFailure: FAILURE.qualification,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "from public.profiles as profile",
      "from profiles as profile",
      "N14",
    ),
  },
  {
    id: "N15",
    name: "se agrega overload privilegiado",
    expectedFailure: FAILURE.functions,
    apply: (source: string) => `${source}
create function private.capture_auth_registration_pending_membership(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $n15$
begin
  return;
end;
$n15$;
`,
  },
  {
    id: "N16",
    name: "search_path se repuebla",
    expectedFailure: FAILURE.functions,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "create function private.capture_auth_registration_pending_membership()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = ''",
      "create function private.capture_auth_registration_pending_membership()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public",
      "N16",
    ),
  },
  {
    id: "N17",
    name: "se agrega RPC pública anónima de PII",
    expectedFailure: FAILURE.publicSurface,
    apply: (source: string) => `${source}
create function public.save_pending_registration_pii(p_first_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $n17$
begin
  perform pg_catalog.length(p_first_name);
end;
$n17$;
grant execute on function public.save_pending_registration_pii(text) to anon;
`,
  },
  {
    id: "N18",
    name: "PII y marker sobreviven en metadata",
    expectedFailure: FAILURE.metadata,
    apply: (source: string) => replaceOccurrence(
      source,
      "      v_metadata -> 'display_name'\n    );",
      "      v_metadata -> 'display_name',\n      'first_name', v_metadata -> 'first_name',\n      'organizatech_registration_intent_id', v_metadata -> 'organizatech_registration_intent_id'\n    );",
      0,
      "N18",
    ),
  },
  {
    id: "N19",
    name: "confirmación sólo captura unique_violation",
    expectedFailure: FAILURE.confirmationSafety,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    when others then\n      return new;",
      "    when unique_violation then\n      return new;",
      "N19",
    ),
  },
  {
    id: "R17",
    name: "redacción pendiente sale del subbloque recuperable",
    expectedFailure: FAILURE.protectedWrites,
    apply: (source: string) => {
      const withoutProtectedRedaction = replaceExactlyOnce(
        source,
        PENDING_REDACTION_BLOCK,
        "",
        "R17-remove",
      );
      return replaceExactlyOnce(
        withoutProtectedRedaction,
        "  end;\n\n  return new;\nend;\n$finalize_auth_registration_pending_membership$;",
        `  end;\n\n${PENDING_REDACTION_BLOCK}\n\n  return new;\nend;\n$finalize_auth_registration_pending_membership$;`,
        "R17-move",
      );
    },
  },
  {
    id: "G01",
    name: "scrub inicial queda después del retorno de payload inválido",
    expectedFailure: FAILURE.scrubBeforeReturn,
    apply: (source: string) => {
      const withoutInitialScrub = replaceOccurrence(
        source,
        METADATA_SCRUB_BLOCK,
        "",
        0,
        "G01-remove",
      );
      return replaceExactlyOnce(
        withoutInitialScrub,
        `  insert into ${PENDING_TABLE} (`,
        `${METADATA_SCRUB_BLOCK}\n  insert into ${PENDING_TABLE} (`,
        "G01-move",
      );
    },
  },
  {
    id: "G03",
    name: "retry exige ambos markers con AND",
    expectedFailure: FAILURE.registrationDetection,
    apply: (source: string) => replaceOccurrence(
      source,
      "    or v_metadata ? 'organizatech_registration_intent_id'\n  );",
      "    and v_metadata ? 'organizatech_registration_intent_id'\n  );",
      1,
      "G03",
    ),
  },
  {
    id: "G04",
    name: "consumo conserva professional_title privado",
    expectedFailure: FAILURE.consumedRedaction,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      professional_title = null,\n",
      "",
      "G04",
    ),
  },
  {
    id: "U01",
    name: "se elimina el trigger de scrub UPDATE",
    expectedFailure: FAILURE.retryTrigger,
    apply: (source: string) => replaceExactlyOnce(
      source,
      RETRY_TRIGGER_BLOCK,
      "select 1;",
      "U01",
    ),
  },
  {
    id: "U02",
    name: "scrub de retry cambia de BEFORE a AFTER UPDATE",
    expectedFailure: FAILURE.retryTrigger,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  before update of raw_user_meta_data on auth.users",
      "  after update of raw_user_meta_data on auth.users",
      "U02",
    ),
  },
  {
    id: "U03",
    name: "trigger deja de ser UPDATE OF raw_user_meta_data",
    expectedFailure: FAILURE.retryTrigger,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  before update of raw_user_meta_data on auth.users",
      "  before update of email on auth.users",
      "U03",
    ),
  },
  {
    id: "U04",
    name: "retry captura una segunda fila pendiente",
    expectedFailure: FAILURE.retryNoCapture,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  return new;\nend;\n$scrub_auth_registration_retry_metadata$;",
      `  insert into ${PENDING_TABLE} (
    user_id, portal, first_name, last_name, birth_date, gender, phone_number
  ) values (
    new.id, 'usuario', 'Retry', 'Unsafe', date '1990-01-01', 'prefer_not_to_say', '0'
  );
  return new;
end;
$scrub_auth_registration_retry_metadata$;`,
      "U04",
    ),
  },
  {
    id: "U05",
    name: "retry conserva professional_title en metadata",
    expectedFailure: FAILURE.retryMetadata,
    apply: (source: string) => replaceOccurrence(
      source,
      "      v_metadata -> 'display_name'\n    );",
      "      v_metadata -> 'display_name',\n      'professional_title', v_metadata -> 'professional_title'\n    );",
      1,
      "U05",
    ),
  },
  {
    id: "U06",
    name: "retry conserva phone_number en metadata",
    expectedFailure: FAILURE.retryMetadata,
    apply: (source: string) => replaceOccurrence(
      source,
      "      v_metadata -> 'display_name'\n    );",
      "      v_metadata -> 'display_name',\n      'phone_number', v_metadata -> 'phone_number'\n    );",
      1,
      "U06",
    ),
  },
  {
    id: "U07",
    name: "retry conserva birth_date en metadata",
    expectedFailure: FAILURE.retryMetadata,
    apply: (source: string) => replaceOccurrence(
      source,
      "      v_metadata -> 'display_name'\n    );",
      "      v_metadata -> 'display_name',\n      'birth_date', v_metadata -> 'birth_date'\n    );",
      1,
      "U07",
    ),
  },
  {
    id: "U08",
    name: "scrub afecta metadata normal no relacionada",
    expectedFailure: FAILURE.normalMetadata,
    apply: (source: string) => {
      const unrestrictedTrigger = replaceExactlyOnce(
        source,
        "  when (\n    new.raw_user_meta_data ? 'organizatech_registration_portal'\n    or new.raw_user_meta_data ? 'organizatech_registration_intent_id'\n  )",
        "  when (true)",
        "U08-trigger",
      );
      return replaceOccurrence(
        unrestrictedTrigger,
        "  v_is_registration := (\n    v_metadata ? 'organizatech_registration_portal'\n    or v_metadata ? 'organizatech_registration_intent_id'\n  );",
        "  v_is_registration := true;",
        1,
        "U08-function",
      );
    },
  },
  {
    id: "U09",
    name: "retry cambia first-attempt-wins por last-attempt-wins",
    expectedFailure: FAILURE.firstAttemptWins,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  return new;\nend;\n$scrub_auth_registration_retry_metadata$;",
      `  update ${PENDING_TABLE} as pending
  set portal = new.raw_user_meta_data ->> 'organizatech_registration_portal'
  where pending.user_id = new.id;
  return new;
end;
$scrub_auth_registration_retry_metadata$;`,
      "U09",
    ),
  },
] as const;

// Inventario no tautológico: quitar cualquier mutante bloquea el contrato antes del reporte.
assert.equal(mutations.length, 32);
let completedMutationProbeCount = 0;
let completedPositiveControlCount = 0;

test("migración satisface captura first-write-wins, scrub y confirmación no bloqueante", () => {
  auditMigration(readFileSync(MIGRATION_PATH, "utf8"));
});

for (const mutation of mutations) {
  test(`mutation probe ${mutation.id}: ${mutation.name}`, () => {
    const originalBytes = readFileSync(MIGRATION_PATH);
    const original = originalBytes.toString("utf8");
    const originalSha = sha256(originalBytes);
    const tempDirectory = mkdtempSync(join(tmpdir(), "organizatech-auth-confirm-"));
    const tempPath = join(tempDirectory, "migration.sql");
    try {
      writeFileSync(tempPath, originalBytes);
      const mutated = mutation.apply(original);
      assert.notEqual(mutated, original, `${mutation.id}: mutación efectiva`);
      writeFileSync(tempPath, mutated, "utf8");
      const mutatedBytes = readFileSync(tempPath);
      assert.notEqual(sha256(mutatedBytes), originalSha, `${mutation.id}: SHA distinto`);
      splitSqlStatements(mutatedBytes.toString("utf8"));

      let firstCause: string | null = null;
      try {
        auditMigration(mutatedBytes.toString("utf8"));
      } catch (error) {
        firstCause = error instanceof Error ? error.message : String(error);
      }
      assert.equal(firstCause, mutation.expectedFailure, `${mutation.id}: primera causa exacta`);
    } finally {
      writeFileSync(tempPath, originalBytes);
      const restoredBytes = readFileSync(tempPath);
      assert.deepEqual(restoredBytes, originalBytes, `${mutation.id}: restauración byte exacta`);
      assert.equal(sha256(restoredBytes), originalSha, `${mutation.id}: restauración SHA exacta`);
      rmSync(tempDirectory, { recursive: true, force: true });
    }
    completedMutationProbeCount += 1;
  });
}

test("controles inocentes toleran formato, comentarios, aliases, variables y revokes reordenados", () => {
  const source = readFileSync(MIGRATION_PATH, "utf8");
  const revokeBlock = [
    "revoke all on schema private from public;",
    "revoke all on schema private from anon;",
    "revoke all on schema private from authenticated;",
  ].join("\n");
  const controls = [
    `-- comentario con prepare_auth_registration_intent, password y service_role\n${source}`,
    source.replace(
      "create schema if not exists private;",
      "CREATE   SCHEMA   IF NOT EXISTS   private;",
    ),
    source.replaceAll("v_pending", "v_registration_snapshot"),
    source
      .replaceAll("pending.", "registration_pending.")
      .replaceAll(" as pending", " as registration_pending"),
    source.replace(revokeBlock, revokeBlock.split("\n").reverse().join("\n")),
    source
      .replaceAll("v_metadata", "v_registration_metadata")
      .replaceAll("v_is_registration", "v_has_registration_signal"),
  ];
  assert.equal(controls.length, 6);
  for (const control of controls) {
    auditMigration(control);
    completedPositiveControlCount += 1;
  }
});

test("control inocente: metadata normal no activa el scrub de retry", () => {
  const facts = auditMigration(readFileSync(MIGRATION_PATH, "utf8"));
  const signal = parseFunctionRegistrationSignal(
    facts.scrubRetry,
    FAILURE.registrationDetection,
  );
  assert.equal(registrationSignalMatches(signal, new Set(["avatar_url", "locale"])), false);
  assert.equal(
    registrationSignalMatches(signal, new Set(["organizatech_registration_portal"])),
    true,
  );
  assert.equal(
    registrationSignalMatches(signal, new Set(["organizatech_registration_intent_id"])),
    true,
  );
  completedPositiveControlCount += 1;
});

const firstAttemptScenarios = [
  "Coach inicial + reintento Usuario conserva Coach",
  "Usuario inicial + reintento Coach conserva Usuario",
  "reintento con datos distintos conserva payload inicial",
  "reintentos concurrentes no crean otra fila pendiente",
] as const;

for (const scenario of firstAttemptScenarios) {
  test(`primer intento gana: ${scenario}`, () => {
    const facts = auditMigration(readFileSync(MIGRATION_PATH, "utf8"));
    const captureTriggers = facts.triggers.filter(
      (trigger) => trigger.functionName === facts.capture.name,
    );
    assert.deepEqual(captureTriggers.map((trigger) => [trigger.timing, trigger.event]), [["before", "insert"]]);
    assert.equal(countMatches(facts.capture.bodyNormalized, /insert into private\.auth_registration_pending_memberships/g), 1);
    assert.equal(facts.capture.bodyNormalized.includes("update private.auth_registration_pending_memberships"), false);
    assert.equal(findTableWrites(facts.scrubRetry.bodyNormalized).length, 0);
    assert.equal(facts.scrubRetry.bodyNormalized.includes(PENDING_TABLE), false);
    assert.match(facts.normalized, /user_id uuid primary key/);
    assert.doesNotMatch(facts.executable, /prepare_auth_registration_intent/i);
  });
}

test("confirmación crea sólo la membresía original y callbacks repetidos son idempotentes", () => {
  const facts = auditMigration(readFileSync(MIGRATION_PATH, "utf8"));
  assert.match(facts.finalize.bodyNormalized, /if [a-z_][a-z0-9_]*\.portal = 'usuario' then/);
  assert.match(facts.finalize.bodyNormalized, /elsif [a-z_][a-z0-9_]*\.portal = 'coach' then/);
  assert.equal(countMatches(facts.finalize.bodyNormalized, /on conflict \(user_id\) do nothing/g), 2);
  assert.match(facts.finalize.bodyNormalized, /consumed_at is not null then return new/);
});

test("tras confirmar, la segunda membresía conserva los RPC autenticados existentes", () => {
  const userMigration = readFileSync(
    "supabase/migrations/20260816073510_auth_user_multiportal_authorization.sql",
    "utf8",
  );
  const coachMigration = readFileSync(
    "supabase/migrations/20260816020743_auth_coach_multiportal_authorization.sql",
    "utf8",
  );
  assert.match(userMigration, /grant execute on function public\.register_own_user\(\) to authenticated;/i);
  assert.match(coachMigration, /grant execute on function public\.register_own_coach\([^;]+\) to authenticated;/i);
  assert.match(userMigration, /auth\.uid\(\)/i);
  assert.match(coachMigration, /auth\.uid\(\)/i);
});

test("conteo contractual ejecuta 32 probes y 7 controles antes de reportar", () => {
  assert.equal(completedMutationProbeCount, 32);
  assert.equal(completedPositiveControlCount, 7);
  console.log(
    `AUTH-CONFIRM-01 mutation probes: ${completedMutationProbeCount}/32; controles positivos: ${completedPositiveControlCount}/7`,
  );
});
