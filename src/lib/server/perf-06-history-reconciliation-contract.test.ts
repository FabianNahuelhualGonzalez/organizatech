import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const repositoryRoot = process.cwd();
const migrationsDirectory = "supabase/migrations";
const diagnosticsDirectory = "supabase/diagnostics";
const diagnosticArtifact = "20260527_legacy_training_diagnostics.sql";
const diagnosticSha256 = "bc08b6a49b01d1643d0ef99be45e2e5d88ca5ef913911baab4f144f943b206b9";
const fingerprintArtifact = "perf-06-schema-fingerprint.sql";
const fingerprintSha256 = "7da1bb6830207da2c8346a058854dd0c978468c2b8191168b6efabf28b2a58fa";
const baselineFingerprintSha256 = "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1";
const finalFingerprintSha256 = "833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9";
const supersededFinalFingerprintSha256 = "1659325becce455f6e042cc4cb34c113552cc7b2562293a7f265f1162b578914";
const schemaBaseline = "supabase/schema.sql";
const legacyBaselineAcl = "supabase/baseline/perf-06-history-reconciliation-acl.sql";
const normalizationDocument = "docs/perf-06-migration-history-normalization.md";
const runnerPath = "scripts/perf-06-atomic-runner.mjs";
const runnerManifestLibrary = "scripts/perf-06-migration-manifest.mjs";
const runnerOperationDirectory = "supabase/operations/qa/perf-06-atomic";
const runnerArtifacts = [
  runnerPath,
  runnerManifestLibrary,
  `${runnerOperationDirectory}/manifest.json`,
  `${runnerOperationDirectory}/README.md`,
  `${runnerOperationDirectory}/prechecks.sql`,
  `${runnerOperationDirectory}/scenarios.sql`,
  `${runnerOperationDirectory}/postchecks.sql`,
  `${runnerOperationDirectory}/local-validation-bootstrap.sql`,
  "scripts/perf-06-local-bootstrap.mjs",
] as const;
const runnerManifestSha256 = "2955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848";
const invariantSuffix = "_ensure_legacy_exercise_lineage_invariant.sql";
const compensationSuffix = "_reconcile_legacy_exercise_lineages.sql";
const invariantMigration = "20260811035538_ensure_legacy_exercise_lineage_invariant.sql";
const compensationMigration = "20260811035542_reconcile_legacy_exercise_lineages.sql";
const aclMigration = "20260811190144_perf_06r_daily_readiness_acl_normalization.sql";
const aclMigrationSha256 = "3e49a2328f87bd09ad620287af801f71d82330aad2546aef324d4d50c1852749";
const productRepository = "src/lib/data/repository.ts";
const cycleScopedRepository = "src/lib/training/cycle-scoped-training-repository.ts";
const lineageModel = "src/lib/training/training-exercise-lineage.ts";
const productRepositorySha256 = "2b0bfad78ecfada878e93cd70ae331a282c3630e7e488a6491c349f2cc764de4";
const packageLockSha256 = "3651f947e7f6d9c7fc2079b73c863d8a71728adae24ab857b60be2e5b43dedc5";

const historicalMappings = [
  ["20260513_add_exercise_day.sql", "20260513000001_add_exercise_day.sql", "9e817d4aced1dade0b57ac942b67a4c06cf4cc937c6fc26f440c79d40bd24c27"],
  ["20260527_training_sessions_source_of_truth.sql", "20260527000002_training_sessions_source_of_truth.sql", "c8ec5b93657f399026a8725f4ce0787f09c1f04d94bbcc8e9636c710bc4b0c00"],
  ["20260531_training_cycles.sql", "20260531000001_training_cycles.sql", "457a52c1a99275b1e83482f5dc147a2809e79f14ecd474036a7e3260d5798d33"],
  ["20260604_training_cycle_scoped_model.sql", "20260604000001_training_cycle_scoped_model.sql", "9edfb5128a997300b9b2b295180429d2e2ce71c7ee95ed75c4dc005b0834420b"],
  ["20260604_training_cycle_scoped_policy_fix.sql", "20260604000002_training_cycle_scoped_policy_fix.sql", "ed1713d581aaedbedd437ac687d0949020a8ad516b870eee7de32e8b0adce0bf"],
  ["20260605_training_cycle_scoped_session_entries_contract.sql", "20260605000001_training_cycle_scoped_session_entries_contract.sql", "6b5ef4b13798574d7d723bda849fe0cd790f69eeb7f0470d4d3d20d5484cb55c"],
  ["20260607_training_cycle_scoped_snapshot_source.sql", "20260607000001_training_cycle_scoped_snapshot_source.sql", "5b62073b820d1c974f0792ee816cba2b4a76a1041b53b76f21f350184045e915"],
  ["20260608_training_daily_readiness.sql", "20260608000001_training_daily_readiness.sql", "a06186a518f35c423d583c537a2839c0a545a66f62da40c2c0d5d6768e413839"],
  ["20260609_fix_training_daily_readiness_rpc_ambiguity.sql", "20260609000001_fix_training_daily_readiness_rpc_ambiguity.sql", "600aab78a4b23571e1e54ef067d5865272e8b50bcc0feb43feba3944fcb16c36"],
  ["20260610_training_exercise_lineage.sql", "20260610000001_training_exercise_lineage.sql", "45c45cd1e715e1a4209282eaa380c45f34fdb8a4aa1642cfb52f6e064aa11b51"],
  ["20260620_training_workout_readiness.sql", "20260620000001_training_workout_readiness.sql", "4ad2f70a144d998956951214fa775fc8b47d1211efcab771599a9149df63fe54"],
  ["20260706_profile_avatar_fields.sql", "20260706000001_profile_avatar_fields.sql", "7f2c03b02c0cfbec6c2f8dc275b02fa8080a97ff373e4b431d80e7984c634e8e"],
  ["20260706_profile_personal_fields.sql", "20260706000002_profile_personal_fields.sql", "13cce5cdaa82daf8b88983017e945a3ad8c5d48dfcdebd1fc8176fd6596b9327"],
  ["20260707_profile_phone_number.sql", "20260707000001_profile_phone_number.sql", "73af18a35ab3d0ac2cc53343c08eb60b7e645a830c479c8d734484756577d03b"],
  ["20260709_p0_d1_harden_training_session_entries_writes.sql", "20260709000001_p0_d1_harden_training_session_entries_writes.sql", "24506ca0fe49f9e11a37749dd5ad16ea87eb67d851c7652cdeff2b199ca795c1"],
  ["20260713_p0_h_profile_avatar_hardening.sql", "20260713000001_p0_h_profile_avatar_hardening.sql", "75ecc3e7687589140afb98f771aa92d7727ba410950784c1d9ff9fdc56f45d2c"],
  ["20260718_exercise_entries_observation.sql", "20260718000001_exercise_entries_observation.sql", "1ee0f019d4eb9f2417693322a6da84c36a1b3250b928181bc7298fd0231ee270"],
  ["20260718_exercise_entries_observation_legacy_lineage.sql", "20260718000002_exercise_entries_observation_legacy_lineage.sql", "4d577ead2d9f19629b1a963b128c2f9307660853b72e46d0b69c87b00abdd3b9"],
] as const;

const protectedPerfMigrations = [
  ["20260810225819_perf_06a_security_hardening.sql", "53f9338a5599546ff439cfb2b296069c859aa52581fb8fc25fe5444793b127b1"],
  ["20260810230014_perf_06c_rls_initplan.sql", "5848f53f3026f9e6aee33427765bdd2a06e0780323503c1cddb760c17dd50d29"],
  ["20260810230028_perf_06b_exercise_entries_user_session_created_id_index.sql", "ebddfe5324c6223af9c5f85e7567d067792fd1a9a65b651235bdb8ce0d0a5eaf"],
] as const;

const protectedPerf06RMigrations = [
  [invariantMigration, "85f43eb2e415b45866f8693779cda9da62b70ac960d42edb5c72f84316c6920a"],
  [compensationMigration, "a62b9a41bfaa1a20fe1c594dca081618477ba467a56ed8b85969a23d2cbe0708"],
] as const;

type ProfileConstraint =
  | {
    kind: "primary-key";
    name: string | null;
    deferrable: boolean;
    initiallyDeferred: boolean;
    validated: true;
  }
  | {
    kind: "foreign-key";
    name: string | null;
    referencedRelation: string;
    referencedColumns: string[];
    match: "simple" | "full" | "partial";
    onUpdate: "no action" | "restrict" | "cascade" | "set null" | "set default";
    onDelete: "no action" | "restrict" | "cascade" | "set null" | "set default";
    deferrable: boolean;
    initiallyDeferred: boolean;
    validated: true;
  }
  | {
    kind: "unique";
    name: string | null;
    deferrable: boolean;
    initiallyDeferred: boolean;
    validated: true;
  }
  | {
    kind: "check";
    name: string | null;
    expression: string;
    noInherit: boolean;
    validated: true;
  };

type ProfileColumn = {
  position: number;
  name: string;
  sqlType: string;
  nullable: boolean;
  defaultExpression: string | null;
  identity: "always" | "by-default" | null;
  generated: { expression: string; storage: "stored" } | null;
  constraints: ProfileConstraint[];
};

type ProfileTableConstraint = {
  columns: string[];
  constraint: ProfileConstraint;
};

const profileGenderConstraint: ProfileConstraint = {
  kind: "check",
  name: "profiles_gender_allowed",
  expression: "gender is null or gender in ('male', 'female', 'non_binary', 'prefer_not_to_say', 'not_specified')",
  noInherit: false,
  validated: true,
};

const expectedProfileColumns: ProfileColumn[] = [
  {
    position: 1,
    name: "id",
    sqlType: "uuid",
    nullable: false,
    defaultExpression: null,
    identity: null,
    generated: null,
    constraints: [
      { kind: "primary-key", name: null, deferrable: false, initiallyDeferred: false, validated: true },
      {
        kind: "foreign-key",
        name: null,
        referencedRelation: "auth.users",
        referencedColumns: ["id"],
        match: "simple",
        onUpdate: "no action",
        onDelete: "cascade",
        deferrable: false,
        initiallyDeferred: false,
        validated: true,
      },
    ],
  },
  { position: 2, name: "display_name", sqlType: "text", nullable: false, defaultExpression: null, identity: null, generated: null, constraints: [] },
  { position: 3, name: "email", sqlType: "text", nullable: false, defaultExpression: null, identity: null, generated: null, constraints: [] },
  {
    position: 4,
    name: "current_streak",
    sqlType: "integer",
    nullable: false,
    defaultExpression: "0",
    identity: null,
    generated: null,
    constraints: [{ kind: "check", name: null, expression: "current_streak >= 0", noInherit: false, validated: true }],
  },
  { position: 5, name: "updated_at", sqlType: "timestamp with time zone", nullable: false, defaultExpression: "now()", identity: null, generated: null, constraints: [] },
  { position: 6, name: "created_at", sqlType: "timestamp with time zone", nullable: false, defaultExpression: "now()", identity: null, generated: null, constraints: [] },
  { position: 7, name: "first_name", sqlType: "text", nullable: true, defaultExpression: null, identity: null, generated: null, constraints: [] },
  { position: 8, name: "last_name", sqlType: "text", nullable: true, defaultExpression: null, identity: null, generated: null, constraints: [] },
  { position: 9, name: "birth_date", sqlType: "date", nullable: true, defaultExpression: null, identity: null, generated: null, constraints: [] },
  { position: 10, name: "gender", sqlType: "text", nullable: true, defaultExpression: "'not_specified'::text", identity: null, generated: null, constraints: [profileGenderConstraint] },
  { position: 11, name: "avatar_path", sqlType: "text", nullable: true, defaultExpression: null, identity: null, generated: null, constraints: [] },
  { position: 12, name: "avatar_updated_at", sqlType: "timestamp with time zone", nullable: true, defaultExpression: null, identity: null, generated: null, constraints: [] },
  { position: 13, name: "phone_number", sqlType: "text", nullable: true, defaultExpression: null, identity: null, generated: null, constraints: [] },
];

const expectedProfileTableConstraints: ProfileTableConstraint[] = [
  { columns: ["gender"], constraint: profileGenderConstraint },
];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function migrationFiles(root: string): string[] {
  return readdirSync(join(root, migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

const postPerfOwnershipMarker = "POST_PERF_06_MIGRATION_OWNERSHIP";

type PostPerfMigrationOwnership = {
  migration: string;
  sha256: string;
  contractPath: string;
};

type PostPerfMigrationOwnershipInventory = {
  byMigration: Map<string, PostPerfMigrationOwnership>;
  contractPaths: string[];
};

function sourceTestFiles(root: string): string[] {
  const sourceRoot = join(root, "src");
  if (!existsSync(sourceRoot)) return [];
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(entry)) files.push(relative(root, path));
    }
  };
  walk(sourceRoot);
  return files.sort();
}

function unwrapOwnershipExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function ownershipEntriesFromContract(
  root: string,
  contractPath: string,
): PostPerfMigrationOwnership[] | null {
  const source = read(root, contractPath);
  const sourceFile = ts.createSourceFile(
    contractPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    contractPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const declarations: Array<{
    statement: ts.VariableStatement;
    declaration: ts.VariableDeclaration;
  }> = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === postPerfOwnershipMarker) {
        declarations.push({ statement, declaration });
      }
    }
  }
  if (declarations.length === 0) return null;
  assert.equal(
    declarations.length,
    1,
    `[PERF-06.post-cutoff.owner-contract] ${contractPath} declara el marker una sola vez`,
  );

  const [{ statement, declaration }] = declarations;
  assert.ok(
    statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword),
    `[PERF-06.post-cutoff.owner-contract] ${contractPath} exporta ${postPerfOwnershipMarker}`,
  );
  assert.ok(
    (statement.declarationList.flags & ts.NodeFlags.Const) !== 0,
    `[PERF-06.post-cutoff.owner-contract] ${contractPath} declara ownership inmutable`,
  );
  assert.ok(
    declaration.initializer,
    `[PERF-06.post-cutoff.owner-contract] ${contractPath} inicializa ownership`,
  );
  const initializer = unwrapOwnershipExpression(declaration.initializer);
  assert.ok(
    ts.isObjectLiteralExpression(initializer),
    `[PERF-06.post-cutoff.owner-contract] ${contractPath} usa un mapa literal nombre → SHA-256`,
  );
  assert.ok(
    initializer.properties.length > 0,
    `[PERF-06.post-cutoff.owner-contract] ${contractPath} registra al menos una migración`,
  );

  const owned = new Set<string>();
  return initializer.properties.map((property) => {
    assert.ok(
      ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name),
      `[PERF-06.post-cutoff.owner-contract] ${contractPath} usa nombres literales de migración`,
    );
    const value = unwrapOwnershipExpression(property.initializer);
    assert.ok(
      ts.isStringLiteral(value),
      `[PERF-06.post-cutoff.owner-contract] ${contractPath} usa hashes literales`,
    );
    const migration = property.name.text;
    const expectedSha256 = value.text;
    assert.match(
      migration,
      /^\d{14}_.+\.sql$/,
      `[PERF-06.post-cutoff.owner-contract] nombre CLI válido en ${contractPath}`,
    );
    assert.match(
      expectedSha256,
      /^[0-9a-f]{64}$/,
      `[PERF-06.post-cutoff.owner-contract] SHA-256 válido para ${migration}`,
    );
    assert.equal(
      owned.has(migration),
      false,
      `[PERF-06.post-cutoff.owner-contract] ${migration} aparece una sola vez en ${contractPath}`,
    );
    owned.add(migration);
    return { migration, sha256: expectedSha256, contractPath };
  });
}

function discoverPostPerfMigrationOwnership(root: string): PostPerfMigrationOwnershipInventory {
  const byMigration = new Map<string, PostPerfMigrationOwnership>();
  const contractPaths: string[] = [];
  for (const contractPath of sourceTestFiles(root)) {
    const entries = ownershipEntriesFromContract(root, contractPath);
    if (!entries) continue;
    contractPaths.push(contractPath);
    for (const entry of entries) {
      assert.equal(
        byMigration.has(entry.migration),
        false,
        `[PERF-06.post-cutoff.owner-contract] ${entry.migration} tiene un único contrato responsable`,
      );
      byMigration.set(entry.migration, entry);
    }
  }
  return { byMigration, contractPaths: contractPaths.sort() };
}

function postPerfMigrationFiles(root: string): string[] {
  const cutoffVersion = aclMigration.slice(0, 14);
  return migrationFiles(root).filter((file) => file.slice(0, 14) > cutoffVersion);
}

function validatePostPerfMigrationOwnership(root: string): void {
  const postCutoffMigrations = postPerfMigrationFiles(root);
  const ownership = discoverPostPerfMigrationOwnership(root);
  assert.deepEqual(
    [...ownership.byMigration.keys()].sort(),
    postCutoffMigrations,
    "[PERF-06.post-cutoff.ownership-inventory] toda migración posterior al cutoff tiene ownership contractual exacto",
  );
  for (const migration of postCutoffMigrations) {
    const registration = ownership.byMigration.get(migration);
    assert.ok(registration, `[PERF-06.post-cutoff.ownership-inventory] ${migration} tiene contrato responsable`);
    assert.equal(
      sha256(readFileSync(join(root, migrationsDirectory, migration))),
      registration.sha256,
      `[PERF-06.post-cutoff.ownership-hash] ${migration} conserva el hash de ${registration.contractPath}`,
    );
  }
}

type SqlMaskOptions = {
  comments: boolean;
  strings: boolean;
  dollarBodies: boolean;
};

function maskSqlPreservingOffsets(
  source: string,
  options: SqlMaskOptions = { comments: true, strings: true, dollarBodies: true },
): string {
  const output = [...source];
  const blank = (start: number, end: number) => {
    for (let cursor = start; cursor < end; cursor += 1) {
      if (output[cursor] !== "\n" && output[cursor] !== "\r") output[cursor] = " ";
    }
  };
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index + 2);
      const limit = end === -1 ? source.length : end;
      if (options.comments) blank(index, limit);
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
      assert.equal(depth, 0, "comentario SQL de bloque balanceado");
      if (options.comments) blank(index, cursor);
      index = cursor;
      continue;
    }
    if (source[index] === "'") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "'" && source[cursor + 1] === "'") cursor += 2;
        else if (source[cursor] === "'") {
          cursor += 1;
          break;
        } else cursor += 1;
      }
      assert.equal(source[cursor - 1], "'", "literal SQL simple balanceado");
      if (options.strings) blank(index, cursor);
      index = cursor;
      continue;
    }
    if (source[index] === '"') {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === '"' && source[cursor + 1] === '"') cursor += 2;
        else if (source[cursor] === '"') {
          cursor += 1;
          break;
        } else cursor += 1;
      }
      assert.equal(source[cursor - 1], '"', "identificador SQL citado balanceado");
      index = cursor;
      continue;
    }
    if (source[index] === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(source.slice(index))?.[0];
      if (tag) {
        const closing = source.indexOf(tag, index + tag.length);
        assert.ok(closing >= 0, `dollar quote ${tag} balanceado`);
        const end = closing + tag.length;
        if (options.dollarBodies) blank(index, end);
        index = end;
        continue;
      }
    }
    index += 1;
  }
  return output.join("");
}

type SqlStatement = { original: string; code: string; offset: number };

function executableStatements(source: string): SqlStatement[] {
  const masked = maskSqlPreservingOffsets(source);
  const statements: SqlStatement[] = [];
  let start = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== ";") continue;
    const original = source.slice(start, index + 1);
    const code = masked.slice(start, index + 1).replace(/\s+/g, " ").trim().toLowerCase();
    if (code) statements.push({ original, code, offset: start });
    start = index + 1;
  }
  const tail = masked.slice(start).replace(/\s+/g, " ").trim();
  assert.equal(tail, "", "toda sentencia SQL ejecutable termina en punto y coma");
  return statements;
}

type ProfileSqlToken = {
  raw: string;
  normalized: string;
  kind: "word" | "number" | "string" | "quoted-identifier" | "symbol";
};

type ProfileDefinitionSpan = {
  start: number;
  end: number;
  source: string;
  tokens: ProfileSqlToken[];
  kind: "column" | "constraint";
  name: string;
};

type ProfileTableLayout = {
  entries: ProfileDefinitionSpan[];
};

function tokenizeProfileSql(source: string): ProfileSqlToken[] {
  const tokens: ProfileSqlToken[] = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
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
      assert.equal(depth, 0, "profiles: comentario SQL de bloque balanceado");
      index = cursor;
      continue;
    }
    if (source[index] === "'") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "'" && source[cursor + 1] === "'") cursor += 2;
        else if (source[cursor] === "'") {
          cursor += 1;
          break;
        } else cursor += 1;
      }
      assert.equal(source[cursor - 1], "'", "profiles: literal SQL balanceado");
      const raw = source.slice(index, cursor);
      tokens.push({ raw, normalized: raw, kind: "string" });
      index = cursor;
      continue;
    }
    if (source[index] === '"') {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === '"' && source[cursor + 1] === '"') cursor += 2;
        else if (source[cursor] === '"') {
          cursor += 1;
          break;
        } else cursor += 1;
      }
      assert.equal(source[cursor - 1], '"', "profiles: identificador SQL citado balanceado");
      const raw = source.slice(index, cursor);
      tokens.push({ raw, normalized: raw, kind: "quoted-identifier" });
      index = cursor;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(source.slice(index))?.[0];
    if (word) {
      tokens.push({ raw: word, normalized: word.toLowerCase(), kind: "word" });
      index += word.length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(index))?.[0];
    if (number) {
      tokens.push({ raw: number, normalized: number, kind: "number" });
      index += number.length;
      continue;
    }
    const operator = ["::", ">=", "<=", "<>", "!=", "||"].find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ raw: operator, normalized: operator, kind: "symbol" });
      index += operator.length;
      continue;
    }
    assert.match(source[index], /^[()[\],.;+*/=<>-]$/, `profiles: token SQL soportado en offset ${index}`);
    tokens.push({ raw: source[index], normalized: source[index], kind: "symbol" });
    index += 1;
  }
  return tokens;
}

function profileTokensSql(tokens: readonly ProfileSqlToken[]): string {
  let result = "";
  let previous: string | null = null;
  for (const token of tokens) {
    const value = token.normalized;
    if (value === "." || value === "::" || value === ")" || value === "]" || value === ",") {
      result = result.trimEnd();
      result += value === "," ? ", " : value;
    } else if (value === "(" || value === "[") {
      const spacedKeyword = value === "(" && previous !== null && ["in", "exists"].includes(previous);
      if (spacedKeyword && result && !result.endsWith(" ")) result += " ";
      else result = result.trimEnd();
      result += value;
    } else {
      const previousJoins = previous === "(" || previous === "[" || previous === "." || previous === "::";
      if (result && !result.endsWith(" ") && !previousJoins) result += " ";
      result += value;
    }
    previous = value;
  }
  return result.trim();
}

function matchingProfileTokenParen(tokens: readonly ProfileSqlToken[], opening: number): number {
  assert.equal(tokens[opening]?.normalized, "(", "profiles: apertura de paréntesis esperada");
  let depth = 0;
  for (let index = opening; index < tokens.length; index += 1) {
    if (tokens[index].normalized === "(") depth += 1;
    else if (tokens[index].normalized === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  assert.fail("profiles: paréntesis de definición balanceados");
}

function trimProfileSpan(source: string, start: number, end: number): { start: number; end: number } {
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  return { start, end };
}

function profileTableLayout(source: string): ProfileTableLayout {
  const tableStatements = executableStatements(source).filter(({ code }) =>
    /^create table public\.profiles\s*\(/.test(code)
  );
  assert.equal(tableStatements.length, 1, "profiles: existe un único CREATE TABLE public.profiles ejecutable");
  const statement = tableStatements[0];
  const masked = maskSqlPreservingOffsets(statement.original);
  const header = /create\s+table\s+public\.profiles\s*\(/i.exec(masked);
  assert.ok(header, "profiles: cabecera CREATE TABLE reconocible");
  const opening = header.index + header[0].lastIndexOf("(");
  let depth = 0;
  let closing = -1;
  for (let index = opening; index < masked.length; index += 1) {
    if (masked[index] === "(") depth += 1;
    else if (masked[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        closing = index;
        break;
      }
    }
  }
  assert.ok(closing > opening, "profiles: cuerpo CREATE TABLE balanceado");
  assert.equal(masked.slice(closing + 1).trim(), ";", "profiles: CREATE TABLE no contiene SQL ejecutable residual");

  const entries: ProfileDefinitionSpan[] = [];
  let entryStart = opening + 1;
  depth = 0;
  for (let index = opening + 1; index <= closing; index += 1) {
    const character = masked[index];
    if (character === "(") depth += 1;
    else if (character === ")" && index < closing) depth -= 1;
    const boundary = (character === "," && depth === 0) || index === closing;
    if (!boundary) continue;
    const local = trimProfileSpan(statement.original, entryStart, index);
    assert.ok(local.end > local.start, "profiles: definición no vacía entre comas top-level");
    const start = statement.offset + local.start;
    const end = statement.offset + local.end;
    const definition = source.slice(start, end);
    const tokens = tokenizeProfileSql(definition);
    assert.ok(tokens.length >= 2, "profiles: definición contiene nombre y cuerpo");
    const first = tokens[0].normalized;
    const isConstraint = ["constraint", "check", "primary", "unique", "foreign", "exclude"].includes(first);
    const name = isConstraint
      ? (first === "constraint" ? tokens[1]?.normalized : `<${first}>`)
      : first;
    assert.ok(name, "profiles: definición tiene identificador");
    entries.push({ start, end, source: definition, tokens, kind: isConstraint ? "constraint" : "column", name });
    entryStart = index + 1;
  }
  return { entries };
}

const profileColumnClauseStarts = new Set([
  "collate",
  "constraint",
  "not",
  "null",
  "default",
  "generated",
  "primary",
  "unique",
  "check",
  "references",
]);

function nextProfileColumnClause(tokens: readonly ProfileSqlToken[], start: number): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].normalized === "(") depth += 1;
    else if (tokens[index].normalized === ")") depth -= 1;
    else if (depth === 0 && profileColumnClauseStarts.has(tokens[index].normalized)) return index;
  }
  return tokens.length;
}

function normalizeProfileType(tokens: readonly ProfileSqlToken[]): string {
  const type = profileTokensSql(tokens);
  const aliases: Record<string, string> = {
    int: "integer",
    int4: "integer",
    timestamptz: "timestamp with time zone",
  };
  return aliases[type] ?? type;
}

function normalizeProfileDefault(tokens: readonly ProfileSqlToken[], sqlType: string): string {
  const expression = profileTokensSql(tokens);
  if (sqlType === "text" && /^'(?:''|[^'])*'$/.test(expression)) return `${expression}::text`;
  return expression;
}

function parseConstraintDeferrability(tokens: readonly ProfileSqlToken[]): {
  deferrable: boolean;
  initiallyDeferred: boolean;
} {
  let deferrable = false;
  let initiallyDeferred = false;
  let index = 0;
  while (index < tokens.length) {
    if (tokens[index].normalized === "deferrable") {
      deferrable = true;
      index += 1;
    } else if (tokens[index].normalized === "not" && tokens[index + 1]?.normalized === "deferrable") {
      deferrable = false;
      index += 2;
    } else if (tokens[index].normalized === "initially" && ["immediate", "deferred"].includes(tokens[index + 1]?.normalized)) {
      initiallyDeferred = tokens[index + 1].normalized === "deferred";
      index += 2;
    } else assert.fail(`profiles: opción de constraint no soportada: ${profileTokensSql(tokens.slice(index))}`);
  }
  return { deferrable, initiallyDeferred };
}

function parseProfileForeignKey(
  tokens: readonly ProfileSqlToken[],
  name: string | null,
): ProfileConstraint {
  const opening = tokens.findIndex(({ normalized }) => normalized === "(");
  assert.ok(opening > 0, "profiles: REFERENCES declara relación y columnas");
  const closing = matchingProfileTokenParen(tokens, opening);
  const referencedRelation = profileTokensSql(tokens.slice(0, opening));
  const referencedColumns = profileTokensSql(tokens.slice(opening + 1, closing))
    .split(",")
    .map((column) => column.trim());
  assert.ok(referencedColumns.every(Boolean), "profiles: REFERENCES contiene columnas válidas");

  let match: "simple" | "full" | "partial" = "simple";
  let onUpdate: "no action" | "restrict" | "cascade" | "set null" | "set default" = "no action";
  let onDelete: "no action" | "restrict" | "cascade" | "set null" | "set default" = "no action";
  let deferrable = false;
  let initiallyDeferred = false;
  let index = closing + 1;
  const readAction = (): typeof onUpdate => {
    const first = tokens[index]?.normalized;
    const second = tokens[index + 1]?.normalized;
    if (first === "no" && second === "action") {
      index += 2;
      return "no action";
    }
    if (first === "set" && second === "null") {
      index += 2;
      return "set null";
    }
    if (first === "set" && second === "default") {
      index += 2;
      return "set default";
    }
    assert.ok(first === "restrict" || first === "cascade", "profiles: acción REFERENCES reconocible");
    index += 1;
    return first;
  };
  while (index < tokens.length) {
    if (tokens[index].normalized === "match") {
      const value = tokens[index + 1]?.normalized;
      assert.ok(value === "simple" || value === "full" || value === "partial", "profiles: MATCH de FK reconocido");
      match = value;
      index += 2;
    } else if (tokens[index].normalized === "on") {
      const event = tokens[index + 1]?.normalized;
      assert.ok(event === "update" || event === "delete", "profiles: evento REFERENCES reconocido");
      index += 2;
      const action = readAction();
      if (event === "update") onUpdate = action;
      else onDelete = action;
    } else if (tokens[index].normalized === "deferrable") {
      deferrable = true;
      index += 1;
    } else if (tokens[index].normalized === "not" && tokens[index + 1]?.normalized === "deferrable") {
      deferrable = false;
      index += 2;
    } else if (tokens[index].normalized === "initially" && ["immediate", "deferred"].includes(tokens[index + 1]?.normalized)) {
      initiallyDeferred = tokens[index + 1].normalized === "deferred";
      index += 2;
    } else assert.fail(`profiles: opción REFERENCES no soportada: ${profileTokensSql(tokens.slice(index))}`);
  }
  return {
    kind: "foreign-key",
    name,
    referencedRelation,
    referencedColumns,
    match,
    onUpdate,
    onDelete,
    deferrable,
    initiallyDeferred,
    validated: true,
  };
}

function parseProfileCheck(
  tokens: readonly ProfileSqlToken[],
  name: string | null,
): ProfileConstraint {
  assert.equal(tokens[0]?.normalized, "(", "profiles: CHECK contiene expresión parentizada");
  const closing = matchingProfileTokenParen(tokens, 0);
  let noInherit = false;
  let index = closing + 1;
  if (tokens[index]?.normalized === "no" && tokens[index + 1]?.normalized === "inherit") {
    noInherit = true;
    index += 2;
  }
  assert.equal(index, tokens.length, "profiles: CHECK consume todas sus opciones");
  return {
    kind: "check",
    name,
    expression: profileTokensSql(tokens.slice(1, closing)),
    noInherit,
    validated: true,
  };
}

function parseProfileColumn(entry: ProfileDefinitionSpan, position: number): ProfileColumn {
  const tokens = entry.tokens;
  const name = tokens[0].normalized;
  const firstClause = nextProfileColumnClause(tokens, 1);
  assert.ok(firstClause > 1, `profiles.${name}: tipo SQL presente`);
  const sqlType = normalizeProfileType(tokens.slice(1, firstClause));
  let explicitNullable: boolean | null = null;
  let defaultExpression: string | null = null;
  let identity: ProfileColumn["identity"] = null;
  let generated: ProfileColumn["generated"] = null;
  const constraints: ProfileConstraint[] = [];
  let pendingConstraintName: string | null = null;
  let index = firstClause;

  while (index < tokens.length) {
    const keyword = tokens[index].normalized;
    if (keyword === "constraint") {
      assert.equal(pendingConstraintName, null, `profiles.${name}: nombre de constraint no duplicado`);
      assert.ok(tokens[index + 1], `profiles.${name}: CONSTRAINT declara nombre`);
      pendingConstraintName = tokens[index + 1].normalized;
      index += 2;
    } else if (keyword === "not" && tokens[index + 1]?.normalized === "null") {
      assert.equal(explicitNullable, null, `profiles.${name}: nulabilidad declarada una vez`);
      explicitNullable = false;
      index += 2;
    } else if (keyword === "null") {
      assert.equal(explicitNullable, null, `profiles.${name}: nulabilidad declarada una vez`);
      explicitNullable = true;
      index += 1;
    } else if (keyword === "default") {
      assert.equal(defaultExpression, null, `profiles.${name}: default declarado una vez`);
      const expressionStart = index + 1;
      let expressionEnd = nextProfileColumnClause(tokens, expressionStart);
      if (tokens[expressionStart]?.normalized === "null") expressionEnd = Math.max(expressionEnd, expressionStart + 1);
      assert.ok(expressionEnd > expressionStart, `profiles.${name}: DEFAULT contiene expresión`);
      defaultExpression = normalizeProfileDefault(tokens.slice(expressionStart, expressionEnd), sqlType);
      index = expressionEnd;
    } else if (keyword === "generated") {
      assert.equal(identity, null, `profiles.${name}: identity declarada una vez`);
      assert.equal(generated, null, `profiles.${name}: generated declarado una vez`);
      if (tokens[index + 1]?.normalized === "always" && tokens[index + 2]?.normalized === "as" && tokens[index + 3]?.normalized === "identity") {
        identity = "always";
        index += 4;
      } else if (
        tokens[index + 1]?.normalized === "by"
        && tokens[index + 2]?.normalized === "default"
        && tokens[index + 3]?.normalized === "as"
        && tokens[index + 4]?.normalized === "identity"
      ) {
        identity = "by-default";
        index += 5;
      } else {
        assert.equal(tokens[index + 1]?.normalized, "always", `profiles.${name}: GENERATED usa ALWAYS`);
        assert.equal(tokens[index + 2]?.normalized, "as", `profiles.${name}: GENERATED usa AS`);
        assert.equal(tokens[index + 3]?.normalized, "(", `profiles.${name}: GENERATED contiene expresión`);
        const closing = matchingProfileTokenParen(tokens, index + 3);
        assert.equal(tokens[closing + 1]?.normalized, "stored", `profiles.${name}: GENERATED es STORED en PostgreSQL 17`);
        generated = { expression: profileTokensSql(tokens.slice(index + 4, closing)), storage: "stored" };
        index = closing + 2;
      }
    } else if (keyword === "primary" && tokens[index + 1]?.normalized === "key") {
      const end = nextProfileColumnClause(tokens, index + 2);
      const options = parseConstraintDeferrability(tokens.slice(index + 2, end));
      constraints.push({ kind: "primary-key", name: pendingConstraintName, ...options, validated: true });
      pendingConstraintName = null;
      index = end;
    } else if (keyword === "unique") {
      const end = nextProfileColumnClause(tokens, index + 1);
      const options = parseConstraintDeferrability(tokens.slice(index + 1, end));
      constraints.push({ kind: "unique", name: pendingConstraintName, ...options, validated: true });
      pendingConstraintName = null;
      index = end;
    } else if (keyword === "check") {
      assert.equal(tokens[index + 1]?.normalized, "(", `profiles.${name}: CHECK contiene expresión`);
      const closing = matchingProfileTokenParen(tokens, index + 1);
      let end = closing + 1;
      if (tokens[end]?.normalized === "no" && tokens[end + 1]?.normalized === "inherit") end += 2;
      constraints.push(parseProfileCheck(tokens.slice(index + 1, end), pendingConstraintName));
      pendingConstraintName = null;
      index = end;
    } else if (keyword === "references") {
      const end = nextProfileColumnClause(tokens, index + 1);
      constraints.push(parseProfileForeignKey(tokens.slice(index + 1, end), pendingConstraintName));
      pendingConstraintName = null;
      index = end;
    } else assert.fail(`profiles.${name}: cláusula no soportada o residual: ${profileTokensSql(tokens.slice(index))}`);
  }
  assert.equal(pendingConstraintName, null, `profiles.${name}: CONSTRAINT siempre se asocia a una cláusula`);
  const nullable = explicitNullable === false
    ? false
    : !(identity !== null || constraints.some(({ kind }) => kind === "primary-key"));
  return { position, name, sqlType, nullable, defaultExpression, identity, generated, constraints };
}

function parseProfileTableConstraint(entry: ProfileDefinitionSpan, columnNames: readonly string[]): ProfileTableConstraint {
  const tokens = entry.tokens;
  let index = 0;
  let name: string | null = null;
  if (tokens[index].normalized === "constraint") {
    name = tokens[index + 1]?.normalized ?? null;
    assert.ok(name, "profiles: constraint de tabla declara nombre");
    index += 2;
  }
  assert.equal(tokens[index]?.normalized, "check", "profiles: sólo CHECK de tabla esperado en baseline");
  const constraint = parseProfileCheck(tokens.slice(index + 1), name);
  const columnSet = new Set(columnNames);
  const referenced = new Set(
    tokens
      .filter(({ kind, normalized }) => kind === "word" && columnSet.has(normalized))
      .map(({ normalized }) => normalized),
  );
  const columns = columnNames.filter((column) => referenced.has(column));
  return { columns, constraint };
}

function profileSchemaSemantics(source: string): {
  columns: ProfileColumn[];
  tableConstraints: ProfileTableConstraint[];
} {
  const layout = profileTableLayout(source);
  const columnEntries = layout.entries.filter(({ kind }) => kind === "column");
  const columns = columnEntries.map((entry, index) => parseProfileColumn(entry, index + 1));
  assert.equal(new Set(columns.map(({ name }) => name)).size, columns.length, "profiles: nombres de columna únicos");
  const columnNames = columns.map(({ name }) => name);
  const tableConstraints = layout.entries
    .filter(({ kind }) => kind === "constraint")
    .map((entry) => parseProfileTableConstraint(entry, columnNames));
  for (const tableConstraint of tableConstraints) {
    for (const columnName of tableConstraint.columns) {
      const column = columns.find(({ name }) => name === columnName);
      assert.ok(column, `profiles: constraint referencia columna existente ${columnName}`);
      column.constraints.push(tableConstraint.constraint);
    }
  }
  return { columns, tableConstraints };
}

function validateProfileSchema(source: string): void {
  const actual = profileSchemaSemantics(source);
  assert.equal(actual.columns.length, expectedProfileColumns.length, "profiles: cantidad exacta de columnas");
  for (let index = 0; index < expectedProfileColumns.length; index += 1) {
    const expected = expectedProfileColumns[index];
    const column = actual.columns[index];
    assert.equal(column.position, expected.position, `profiles ordinal ${index + 1}: posición física`);
    assert.equal(column.name, expected.name, `profiles ordinal ${index + 1}: nombre`);
    assert.equal(column.sqlType, expected.sqlType, `profiles.${expected.name}: tipo SQL completo`);
    assert.equal(column.nullable, expected.nullable, `profiles.${expected.name}: nulabilidad`);
    assert.equal(column.identity, expected.identity, `profiles.${expected.name}: identity`);
    assert.deepEqual(column.generated, expected.generated, `profiles.${expected.name}: generated`);
    assert.equal(column.defaultExpression, expected.defaultExpression, `profiles.${expected.name}: default normalizado`);
    assert.deepEqual(column.constraints, expected.constraints, `profiles.${expected.name}: constraints asociadas`);
  }
  assert.deepEqual(actual.tableConstraints, expectedProfileTableConstraints, "profiles: constraints de tabla exactas");
}

function executableBody(statement: SqlStatement): string {
  const match = /\bas\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*)\1\s*;\s*$/i.exec(statement.original);
  assert.ok(match, "función contiene un cuerpo dollar-quoted reconocible");
  return maskSqlPreservingOffsets(match[2]).replace(/\s+/g, " ").trim().toLowerCase();
}

function commentFreeSql(source: string): string {
  return maskSqlPreservingOffsets(source, { comments: true, strings: false, dollarBodies: false });
}

function stripSqlComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n\r]*/g, " ");
}

function structuralSql(source: string): string {
  return stripSqlComments(source)
    .replace(/\$(?:perf_06r|function)\$/gi, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function invariantFile(root: string): string {
  const matches = migrationFiles(root).filter((file) => file.endsWith(invariantSuffix));
  assert.equal(matches.length, 1, "la migración del invariant existe exactamente una vez");
  assert.match(matches[0], /^\d{14}_ensure_legacy_exercise_lineage_invariant\.sql$/);
  return matches[0];
}

function assertLexicallyValidSql(source: string, label: string): void {
  let index = 0;
  let blockDepth = 0;
  let singleQuoted = false;
  let dollarTag: string | null = null;

  while (index < source.length) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = null;
      } else {
        index += 1;
      }
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
    if (blockDepth > 0) {
      if (source.startsWith("/*", index)) {
        blockDepth += 1;
        index += 2;
      } else if (source.startsWith("*/", index)) {
        blockDepth -= 1;
        index += 2;
      } else index += 1;
      continue;
    }
    if (source.startsWith("--", index)) {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      blockDepth = 1;
      index += 2;
      continue;
    }
    if (source[index] === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (source[index] === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(source.slice(index));
      if (match) {
        dollarTag = match[0];
        index += match[0].length;
        continue;
      }
    }
    index += 1;
  }

  assert.equal(blockDepth, 0, `${label}: comentario de bloque balanceado`);
  assert.equal(singleQuoted, false, `${label}: literal simple balanceado`);
  assert.equal(dollarTag, null, `${label}: dollar quote balanceado`);
}

function compensationFile(root: string): string {
  const matches = migrationFiles(root).filter((file) => file.endsWith(compensationSuffix));
  assert.equal(matches.length, 1, "la compensatoria existe exactamente una vez");
  assert.match(matches[0], /^\d{14}_reconcile_legacy_exercise_lineages\.sql$/);
  return matches[0];
}

function validateInvariant(source: string): void {
  assertLexicallyValidSql(source, "invariant");
  const uncommented = commentFreeSql(source);
  const code = structuralSql(source);
  const statements = executableStatements(source);

  assert.match(code, /set local statement_timeout = '';/, "invariant fija statement_timeout LOCAL");
  assert.match(code, /set local lock_timeout = '';/, "invariant fija lock_timeout LOCAL");
  const exerciseLockIndex = statements.findIndex(({ code: statement }) => statement === "lock table public.exercises in share row exclusive mode;");
  assert.ok(exerciseLockIndex >= 0, "instalación bloquea writes de exercises antes de DDL");

  const invariantFunctions = statements.filter(({ code: statement }) =>
    statement.startsWith("create function public.ensure_legacy_exercise_lineage_invariant() ")
  );
  assert.equal(invariantFunctions.length, 1, "función canónica única en SQL ejecutable");
  assert.match(
    invariantFunctions[0].code,
    /^create function public\.ensure_legacy_exercise_lineage_invariant\(\) returns trigger language plpgsql security invoker set search_path = pg_catalog as\s*;$/,
    "función trigger SECURITY INVOKER con search_path fijo",
  );
  assert.doesNotMatch(code, /security definer/, "invariant nunca usa SECURITY DEFINER");
  assert.match(uncommented, /v_actor_id\s+uuid\s*:=\s*auth\.uid\(\)/i, "captura auth.uid() totalmente calificado");
  assert.match(code, /if new\.user_id is null then/, "NEW.user_id es obligatorio");
  const invariantBody = executableBody(invariantFunctions[0]);
  assert.match(
    invariantBody,
    /if v_actor_id is null or v_actor_id <> new\.user_id then/,
    "actor NULL o distinto aborta sin camino permisivo",
  );
  assert.equal((invariantBody.match(/v_actor_id is null/g) ?? []).length, 1, "rechazo de actor NULL único y ejecutable");
  assert.match(code, /from public\.routines r where r\.id = new\.routine_id and r\.user_id = new\.user_id/, "rutina parent existe y comparte owner");
  assert.match(code, /tel\.source_legacy_exercise_id = new\.id and \( tel\.user_id <> new\.user_id or tel\.origin_kind <> '' or tel\.origin_training_cycle_exercise_id is not null \)/, "lineage incompatible aborta");

  const insertMatches = [...uncommented.matchAll(/insert\s+into\s+public\.training_exercise_lineages\s*\(([\s\S]*?)\)\s*values/gi)];
  assert.equal(insertMatches.length, 1, "invariant contiene un único INSERT de lineage");
  assert.deepEqual(
    insertMatches[0][1].split(",").map((column) => column.trim()),
    ["user_id", "source_legacy_exercise_id", "origin_kind", "metadata"],
    "allowlist invariant exacta",
  );
  assert.match(uncommented, /values\s*\(\s*new\.user_id\s*,\s*new\.id\s*,\s*'legacy'\s*,\s*pg_catalog\.jsonb_build_object/i, "INSERT deriva identidad exclusivamente de NEW y fija legacy");
  assert.match(uncommented, /'invariant'\s*,\s*'legacy-exercise-lineage-trigger'/, "marker invariant estable y propio");
  assert.match(uncommented, /'version'\s*,\s*1/, "marker invariant versionado");
  assert.match(code, /on conflict \(user_id, source_legacy_exercise_id\) where source_legacy_exercise_id is not null do nothing;/, "ON CONFLICT coincide con índice único parcial");
  assert.ok((code.match(/select pg_catalog\.count\(\*\)/g) ?? []).length >= 2, "cuenta antes y después del INSERT/no-op");
  assert.equal((code.match(/v_compatible_count <> 1 then/g) ?? []).length, 2, "precheck y postcondición rechazan cardinalidad mayor que uno");
  assert.match(
    uncommented,
    /if\s+v_compatible_count\s*<>\s*1\s+then\s+raise exception using\s+errcode\s*=\s*'23514',\s+message\s*=\s*'PERF-06R invariant: exactly one compatible lineage is required';/i,
    "postcondición exige exactamente un lineage compatible",
  );
  assert.match(code, /return new; end;/, "función retorna NEW");

  const exerciseTriggerCreates = statements
    .map(({ code: statement }, index) => ({ statement, index }))
    .filter(({ statement }) => /execute function public\.ensure_legacy_exercise_lineage_invariant\(\)/.test(statement));
  assert.equal(exerciseTriggerCreates.length, 1, "una sola conexión ejecutable a la función canónica");
  assert.equal(
    exerciseTriggerCreates[0].statement,
    "create trigger exercises_ensure_legacy_lineage after insert or update on public.exercises for each row execute function public.ensure_legacy_exercise_lineage_invariant();",
    "trigger exacto AFTER INSERT OR UPDATE FOR EACH ROW",
  );
  assert.ok(exerciseLockIndex < exerciseTriggerCreates[0].index, "lock de exercises precede la creación del trigger");
  const destructiveExerciseTriggerDdl = statements.filter(({ code: statement }) =>
    /^(drop trigger|alter table public\.exercises (?:disable|enable)|alter trigger)/.test(statement)
    && /exercises_ensure_legacy_lineage/.test(statement)
  );
  assert.deepEqual(destructiveExerciseTriggerDdl, [], "estado final rechaza DROP, DISABLE, ENABLE o sustitución del trigger");

  const identityFunctions = statements.filter(({ code: statement }) =>
    statement.startsWith("create function public.validate_training_exercise_lineage_identity_update() ")
  );
  assert.equal(identityFunctions.length, 1, "validador UPDATE de identidad único");
  assert.match(
    identityFunctions[0].code,
    /^create function public\.validate_training_exercise_lineage_identity_update\(\) returns trigger language plpgsql security invoker set search_path = pg_catalog as\s*;$/,
    "validador de identidad es SECURITY INVOKER con search_path fijo",
  );
  const identityBody = executableBody(identityFunctions[0]);
  assert.match(identityBody, /new\.user_id is distinct from old\.user_id/, "user_id es inmutable");
  assert.match(identityBody, /new\.origin_kind is distinct from old\.origin_kind/, "origin_kind es inmutable");
  assert.match(identityBody, /new\.source_legacy_exercise_id is distinct from old\.source_legacy_exercise_id/, "source legacy es inmutable");
  assert.match(identityBody, /new\.origin_training_cycle_exercise_id is distinct from old\.origin_training_cycle_exercise_id/, "origin scoped sólo cambia bajo validación");
  assert.match(identityBody, /old\.origin_training_cycle_exercise_id is not null or new\.origin_training_cycle_exercise_id is null or new\.origin_kind <>\s+or not exists/, "origin scoped sólo admite binding inicial no nulo");
  assert.match(identityBody, /tce\.id = new\.origin_training_cycle_exercise_id and tce\.user_id = new\.user_id and tce\.exercise_lineage_id = new\.id/, "binding scoped exige relación bidireccional del owner");
  const identityTriggerCreates = statements.filter(({ code: statement }) =>
    /execute function public\.validate_training_exercise_lineage_identity_update\(\)/.test(statement)
  );
  assert.equal(identityTriggerCreates.length, 1, "trigger de identidad único");
  assert.equal(
    identityTriggerCreates[0].code,
    "create trigger training_exercise_lineages_validate_identity_update before update on public.training_exercise_lineages for each row execute function public.validate_training_exercise_lineage_identity_update();",
    "trigger UPDATE de identidad exacto",
  );
  assert.deepEqual(
    statements.filter(({ code: statement }) => /^(drop trigger|alter table public\.training_exercise_lineages (?:disable|enable)|alter trigger)/.test(statement)
      && /training_exercise_lineages_validate_identity_update/.test(statement)),
    [],
    "trigger de identidad queda creado y habilitado",
  );
  const hardenedPolicies = statements.filter(({ code: statement }) =>
    statement.startsWith("create policy ") && statement.includes("on public.training_exercise_lineages")
  );
  assert.equal(hardenedPolicies.length, 3, "invariant recrea exactamente tres policies lineage");
  for (const policy of hardenedPolicies) {
    if (policy.code.includes(" for select ")) {
      assertRelationalLineagePredicate(clauseExpression(policy, "using"), "invariant SELECT USING");
    } else if (policy.code.includes(" for insert ")) {
      assertRelationalLineagePredicate(clauseExpression(policy, "with check"), "invariant INSERT WITH CHECK");
    } else if (policy.code.includes(" for update ")) {
      assertRelationalLineagePredicate(clauseExpression(policy, "using"), "invariant UPDATE USING");
      assertRelationalLineagePredicate(clauseExpression(policy, "with check"), "invariant UPDATE WITH CHECK");
    } else assert.fail("policy lineage con comando no reconocido");
  }
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(code, new RegExp(`revoke execute on function public\\.ensure_legacy_exercise_lineage_invariant\\(\\) from ${role};`), `EXECUTE revocado a ${role}`);
    assert.match(code, new RegExp(`revoke execute on function public\\.validate_training_exercise_lineage_identity_update\\(\\) from ${role};`), `validador de identidad no es RPC para ${role}`);
  }
  assert.doesNotMatch(
    code,
    /grant execute on function public\.(?:ensure_legacy_exercise_lineage_invariant|validate_training_exercise_lineage_identity_update)\(\)/,
    "ninguna función trigger queda expuesta por GRANT EXECUTE",
  );
  assert.doesNotMatch(code, /\b(update|delete)\s+public\./, "función no ejecuta UPDATE/DELETE");
  assert.doesNotMatch(code, /insert into public\.(exercises|exercise_entries|training_cycle_exercises)\b/, "invariant sólo escribe lineages");
  assert.doesNotMatch(source, /training_session_consolidation_audit/i, "invariant excluye tabla diagnóstica");
  assert.match(source, /If the write rolls back, its lineage INSERT rolls back with it/, "rollback del write conserva atomicidad");
}

function validateCompensation(source: string): void {
  assertLexicallyValidSql(source, "compensatoria");
  const uncommented = commentFreeSql(source);
  const code = structuralSql(source);
  const statements = executableStatements(source);

  assert.match(code, /set local statement_timeout = '';/, "statement_timeout es LOCAL");
  assert.match(code, /set local lock_timeout = '';/, "lock_timeout es LOCAL");
  assert.match(uncommented, /do\s+\$perf_06r\$[\s\S]*?end;\s*\$perf_06r\$;/i, "la lógica está dentro de un DO seguro y sintácticamente cerrada");
  const doStatement = statements.find(({ code: statement }) => statement.startsWith("do "));
  assert.ok(doStatement, "compensatoria contiene un único bloque DO ejecutable");
  const doBodyMatch = /do\s+(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)([\s\S]*)\1\s*;\s*$/i.exec(doStatement.original);
  assert.ok(doBodyMatch, "cuerpo DO compensatorio reconocible");
  const bodyStatements = executableStatements(doBodyMatch[2]);
  const exercisesLockIndex = bodyStatements.findIndex(({ code: statement }) =>
    statement.includes("lock table public.exercises in share row exclusive mode;")
  );
  const remainingLocksIndex = bodyStatements.findIndex(({ code: statement }) =>
    statement.includes("lock table public.routines, public.exercise_entries, public.training_cycle_exercises, public.training_exercise_lineages in share row exclusive mode;")
  );
  const catalogIndex = bodyStatements.findIndex(({ code: statement }) =>
    statement.includes("from pg_catalog.pg_proc p join pg_catalog.pg_namespace n")
  );
  const firstDataPrecheckIndex = bodyStatements.findIndex(({ code: statement }) =>
    statement.includes("from public.training_exercise_lineages tel join public.exercises e")
  );
  const writeIndex = bodyStatements.findIndex(({ code: statement }) =>
    statement.includes("insert into public.training_exercise_lineages")
  );
  let postcheckIndex = -1;
  bodyStatements.forEach(({ code: statement }, index) => {
    if (
      statement.includes("from public.exercises e where not exists")
      && statement.includes("tel.origin_training_cycle_exercise_id is null")
    ) postcheckIndex = index;
  });
  assert.ok(exercisesLockIndex >= 0, "primer lock operativo es public.exercises");
  assert.ok(remainingLocksIndex > exercisesLockIndex, "locks restantes siguen a exercises");
  assert.ok(catalogIndex > remainingLocksIndex, "catálogo se verifica sólo después de todos los locks");
  assert.ok(firstDataPrecheckIndex > catalogIndex, "prechecks de datos siguen al catálogo");
  assert.ok(writeIndex > firstDataPrecheckIndex, "write compensatorio sigue a prechecks");
  assert.ok(postcheckIndex > writeIndex, "postcheck sigue al write compensatorio");
  assert.match(code, /from pg_catalog\.pg_proc p join pg_catalog\.pg_namespace n on n\.oid = p\.pronamespace join pg_catalog\.pg_trigger t on t\.tgfoid = p\.oid/, "precheck consulta función y trigger reales en catálogo");
  assert.match(code, /p\.proname = '' .* p\.prosecdef is false .* p\.proconfig = array\[''\]::pg_catalog\.text\[\] .* t\.tgname = '' .* t\.tgrelid = ''::pg_catalog\.regclass .* t\.tgtype = 21 .* t\.tgenabled = '' .* t\.tgisinternal is false/, "precheck exige nombre, invoker, search_path, target, AFTER INSERT+UPDATE ROW y enabled");
  assert.match(uncommented, /p\.proname\s*=\s*'ensure_legacy_exercise_lineage_invariant'/, "precheck fija función exacta");
  assert.match(uncommented, /t\.tgname\s*=\s*'exercises_ensure_legacy_lineage'/, "precheck fija trigger exacto");
  assert.match(code, /if v_invariant_count <> 1 then raise exception using errcode = ''/, "compensatoria aborta sin invariant único");
  assert.match(code, /lock table public\.exercises in share row exclusive mode;/, "lock de exercises es explícito y primero");
  assert.match(code, /if v_pending_count not in \(0, 2\) then/, "cardinalidad fail-closed exacta 0/2");
  assert.doesNotMatch(code, /not in \(0, 2,/, "no acepta cardinalidades adicionales");
  assert.match(code, /from auth\.users u where u\.id = e\.user_id/, "valida existencia de usuario");
  assert.match(code, /from public\.routines r where r\.id = e\.routine_id/, "valida rutina parent");
  assert.match(code, /join public\.routines r on r\.id = e\.routine_id .* r\.user_id <> e\.user_id/, "valida ownership rutina/ejercicio");
  assert.match(code, /tel\.user_id <> e\.user_id or tel\.origin_kind <> '' or tel\.origin_training_cycle_exercise_id is not null/, "aborta ante lineage incompatible");
  assert.match(code, /join public\.exercise_entries ee on ee\.exercise_id = e\.id/, "aborta ante referencias desde entries");
  assert.match(code, /join public\.training_cycle_exercises tce on tce\.source_legacy_exercise_id = e\.id/, "aborta ante referencias desde ejercicios de ciclo");
  assert.match(code, /if v_pending_count = 2 then insert into/, "cero es no-op y dos habilita el único INSERT");

  const insertMatches = [...uncommented.matchAll(/insert\s+into\s+public\.training_exercise_lineages\s*\(([\s\S]*?)\)\s*select/gi)];
  assert.equal(insertMatches.length, 1, "existe un único INSERT y apunta a training_exercise_lineages");
  const columns = insertMatches[0][1].split(",").map((column) => column.trim());
  assert.deepEqual(columns, ["user_id", "source_legacy_exercise_id", "origin_kind", "metadata"], "allowlist INSERT exacta");
  assert.match(
    uncommented,
    /insert\s+into\s+public\.training_exercise_lineages[\s\S]*?select\s+e\.user_id\s*,\s*e\.id\s*,\s*'legacy'\s*,\s*pg_catalog\.jsonb_build_object\(/i,
    "el único INSERT fija origin_kind=legacy en su proyección",
  );
  assert.equal((code.match(/\binsert into\b/g) ?? []).length, 1, "no hay inserts laterales");
  assert.doesNotMatch(code, /\b(update|delete)\b/, "no hay UPDATE ni DELETE ejecutable");
  assert.doesNotMatch(code, /\b(alter|drop|truncate|create)\s+(table|index|policy|function|trigger)\b/, "no hay DDL ejecutable");
  assert.doesNotMatch(code, /insert into public\.(exercises|exercise_entries|training_cycle_exercises)\b/, "no escribe tablas excluidas");
  assert.doesNotMatch(source, /training_session_consolidation_audit/i, "la migración no menciona la tabla diagnóstica");

  assert.match(uncommented, /'legacy'/, "origin_kind queda fijado en legacy");
  assert.match(uncommented, /'reconciliation'\s*,\s*'PERF-06R'/, "marker PERF-06R estable");
  assert.match(uncommented, /'source'\s*,\s*'migration-history-normalization'/, "marker source estable");
  assert.match(uncommented, /'version'\s*,\s*1/, "marker versionado");
  assert.match(code, /on conflict \(user_id, source_legacy_exercise_id\) where source_legacy_exercise_id is not null do nothing;/, "idempotencia usa el índice único parcial");
  assert.match(code, /get diagnostics v_inserted_count = row_count;/, "verifica inserción exacta");
  assert.match(code, /if v_inserted_count <> 2 then/, "dos pendientes deben producir dos inserts");
  assert.match(code, /tel\.origin_kind = '' and tel\.origin_training_cycle_exercise_id is null .* raise exception using errcode = ''/, "postcheck exige cero legacy sin lineage compatible");
  assert.match(source, /Proposed rollback \(documentation only; never automatic\)/, "rollback sólo comentado");
}

function validateAclMigration(root: string): void {
  assert.equal(existsSync(join(root, legacyBaselineAcl)), false, "ACL suelto/no versionado permanece ausente");
  const path = join(root, migrationsDirectory, aclMigration);
  assert.ok(existsSync(path), "migración ACL versionada presente en migrations");
  const source = readFileSync(path, "utf8");
  assertLexicallyValidSql(source, aclMigration);
  const statements = executableStatements(source).map(({ code }) => code);
  assert.deepEqual(statements, [
    "revoke all on function public.save_daily_training_readiness(jsonb) from public;",
    "revoke all on function public.save_daily_training_readiness(jsonb) from anon;",
    "revoke all on function public.save_daily_training_readiness(jsonb) from service_role;",
    "grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;",
    "grant execute on function public.save_daily_training_readiness(jsonb) to postgres;",
  ], "migración ACL exacta: sólo authenticated y postgres conservan EXECUTE");
  assert.equal(sha256(source), aclMigrationSha256, "migración ACL conserva su SHA-256 aprobado");
}

function validateFingerprintArtifact(root: string): void {
  const path = join(root, diagnosticsDirectory, fingerprintArtifact);
  assert.ok(existsSync(path), "fingerprint v1 presente en diagnostics");
  assert.equal(
    migrationFiles(root).some((file) => /schema[-_]fingerprint/i.test(file)),
    false,
    "fingerprint diagnóstico ausente de migrations",
  );

  const source = readFileSync(path, "utf8");
  assertLexicallyValidSql(source, fingerprintArtifact);
  const withLiterals = commentFreeSql(source).replace(/\s+/g, " ").trim();
  const structural = maskSqlPreservingOffsets(source).replace(/\s+/g, " ").trim().toLowerCase();
  assert.doesNotMatch(withLiterals, /\b[a-f0-9]{64}\b/i, "fingerprint no contiene hashes resultado hardcodeados");

  const statements = executableStatements(source);
  assert.equal(statements.length, 1, "fingerprint contiene una única consulta SQL");
  assert.match(statements[0].code, /^with\b/, "fingerprint es una consulta CTE read-only");
  assert.doesNotMatch(
    structural,
    /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|copy|call|do)\b/,
    "fingerprint no contiene DML, DDL ni cambios de privilegios",
  );
  assert.doesNotMatch(
    structural,
    /\b(?:from|join)\s+(?:public|auth|storage)\./,
    "fingerprint no lee filas de public, auth ni storage",
  );

  assert.match(
    withLiterals,
    /^with excluded_relation\(schema_name, relation_name\) as \( values \('public'::name, 'training_session_consolidation_audit'::name\) \), target_rel as \(/i,
    "fingerprint declara una única exclusión explícita y dedicada",
  );
  assert.equal(
    (withLiterals.match(/'training_session_consolidation_audit'/g) ?? []).length,
    1,
    "fingerprint menciona exactamente una relación excluida",
  );
  assert.equal(
    (withLiterals.match(/from excluded_relation as excluded/gi) ?? []).length,
    5,
    "la única exclusión se aplica a relaciones, constraints, índices, policies y triggers",
  );

  const categories = [
    "relation",
    "column",
    "constraint",
    "index",
    "policy",
    "function",
    "trigger",
    "table_acl",
    "column_acl",
  ] as const;
  for (const category of categories) {
    assert.equal(
      (withLiterals.match(new RegExp(`'${category}'`, "g")) ?? []).length,
      1,
      `fingerprint contiene una única categoría ${category}`,
    );
  }
  assert.equal((withLiterals.match(/'OVERALL'/g) ?? []).length, 1, "fingerprint emite un único total OVERALL");
  assert.equal(
    (withLiterals.match(/pg_catalog\.concat_ws\( '\|'/g) ?? []).length,
    categories.length,
    "fingerprint serializa las nueve categorías con separador pipe",
  );
  assert.match(
    withLiterals,
    /pg_catalog\.string_agg\(line, E'\\n' order by line\)/,
    "fingerprint ordena y serializa cada categoría con LF",
  );
  assert.match(
    withLiterals,
    /pg_catalog\.string_agg\( category \|\| '\|' \|\| line, E'\\n' order by category, line \)/,
    "fingerprint ordena y serializa OVERALL con categoría, pipe y LF",
  );
  assert.equal(
    (withLiterals.match(/pg_catalog\.sha256\(/g) ?? []).length,
    2,
    "fingerprint usa SHA-256 para categoría y OVERALL",
  );
  assert.equal(
    (withLiterals.match(/pg_catalog\.convert_to\(/g) ?? []).length,
    2,
    "fingerprint fija serialización UTF-8 en ambos hashes",
  );
  assert.equal((withLiterals.match(/'UTF8'/g) ?? []).length, 2, "fingerprint fija UTF8 exactamente dos veces");

  assert.match(withLiterals, /attribute\.attnum::text/, "column incorpora posición física attnum");
  assert.match(withLiterals, /attribute\.attidentity::text/, "column incorpora identity");
  assert.match(withLiterals, /attribute\.attgenerated::text/, "column incorpora generated");
  assert.match(
    withLiterals,
    /namespace\.nspname = 'storage' and relation\.relname = 'objects'/,
    "policy incluye storage.objects",
  );
  assert.match(
    withLiterals,
    /namespace\.nspname = 'auth' and relation\.relname = 'users'/,
    "trigger incluye auth.users",
  );
  assert.match(withLiterals, /procedure\.proacl/, "function incorpora ACL ejecutable");
  assert.match(withLiterals, /target\.relacl/, "table_acl incorpora ACL de relaciones");
  assert.match(withLiterals, /attribute\.attacl is not null/, "column_acl incorpora sólo ACL explícito");
  assert.match(
    withLiterals,
    /select category, item_count, sha256 from category_hashes union all select 'OVERALL', item_count, sha256 from overall order by category;/,
    "fingerprint emite únicamente categoría, conteo y SHA-256",
  );
  assert.equal(sha256(source), fingerprintSha256, "consulta fingerprint conserva su SHA-256 aprobado");
}

function validateBaselineArtifacts(root: string): void {
  const diagnosticPath = join(diagnosticsDirectory, diagnosticArtifact);
  assert.equal(
    sha256(readFileSync(join(root, diagnosticPath))),
    diagnosticSha256,
    "diagnóstico operativo conserva su SHA-256 byte-idéntico",
  );
  assert.equal(
    migrationFiles(root).some((file) => /legacy_training_diagnostics/i.test(file)),
    false,
    "diagnóstico ausente de migrations",
  );

  const expectedMigrationFiles = [
    ...historicalMappings.map(([, newName]) => newName),
    ...protectedPerfMigrations.map(([file]) => file),
    ...protectedPerf06RMigrations.map(([file]) => file),
    aclMigration,
  ].sort();
  assert.equal(expectedMigrationFiles.length, 24, "inventario esperado: 18 históricas + 6 PERF-06");
  const actualMigrationFiles = migrationFiles(root);
  assert.ok(
    actualMigrationFiles.every((file) => /^\d{14}_.+\.sql$/.test(file)),
    "todas las migraciones usan versiones CLI de 14 dígitos",
  );
  const perf06CutoffVersion = aclMigration.slice(0, 14);
  const perf06MigrationFiles = actualMigrationFiles.filter((file) => file.slice(0, 14) <= perf06CutoffVersion);
  assert.deepEqual(
    perf06MigrationFiles,
    expectedMigrationFiles,
    "inventario exacto de 24 versiones hasta el cierre PERF-06, sin diagnóstico ni versión inventada",
  );
  assert.equal(
    new Set(actualMigrationFiles.map((file) => file.slice(0, 14))).size,
    actualMigrationFiles.length,
    "todas las versiones de migración son únicas",
  );
  validatePostPerfMigrationOwnership(root);

  validateProfileSchema(read(root, schemaBaseline));
  validateAclMigration(root);
  validateFingerprintArtifact(root);
}

function validateDocumentation(root: string): void {
  const document = read(root, normalizationDocument);
  for (const [oldName, newName, hash] of historicalMappings) {
    assert.ok(document.includes(oldName), `documenta origen ${oldName}`);
    assert.ok(document.includes(newName), `documenta destino ${newName}`);
    assert.ok(document.includes(hash), `documenta SHA-256 de ${newName}`);
  }
  assert.match(document, /ordinales[\s\S]*no representan una hora histórica/i);
  assert.match(document, /18 migraciones históricas materiales/i);
  assert.match(document, /6 versiones PERF-06/i);
  assert.match(document, /24 versiones totales/i);
  assert.doesNotMatch(
    document,
    /19 migraciones históricas|19 históricas|5 versiones PERF-06|23 versiones totales|25 versiones totales/i,
    "sin conteos residuales 19/5/23/25",
  );
  assert.match(document, /supabase\/diagnostics\/20260527_legacy_training_diagnostics\.sql/);
  assert.match(document, /no es migración material[\s\S]*no recibe versión[\s\S]*no se registra/i);
  assert.doesNotMatch(document, /\d{14}_legacy_training_diagnostics\.sql/i, "diagnóstico sin versión de historial inventada");
  assert.match(document, new RegExp(aclMigration.replaceAll(".", "\\.")));
  assert.ok(document.includes(aclMigrationSha256), "documenta SHA-256 de la migración ACL");
  assert.match(document, /ACL suelto|baseline[\s\S]*no existe/i, "documenta ausencia del ACL no versionado");
  assert.doesNotMatch(document, /ACL declarativo no versionado/i, "no prescribe un ACL manual fuera de migrations");
  assert.match(document, /supabase\/diagnostics\/perf-06-schema-fingerprint\.sql/);
  assert.ok(document.includes(fingerprintSha256), "documenta SHA-256 de la consulta fingerprint");
  assert.match(document, /perf-06-schema-fingerprint\/v1/);
  assert.match(document, /concat_ws\('\|'/);
  assert.match(document, /346 elementos/);
  assert.match(document, /377 elementos/);
  assert.ok(document.includes(baselineFingerprintSha256), "documenta fingerprint baseline reproducible");
  assert.ok(document.includes(finalFingerprintSha256), "documenta fingerprint final autorizado reproducible");
  assert.ok(document.includes(supersededFinalFingerprintSha256), "explica el fingerprint final previo supersedido");
  assert.match(document, /EXECUTE residual[\s\S]*service_role|service_role[\s\S]*EXECUTE residual/i, "explica deriva ACL previa");
  assert.match(document, /attnum[\s\S]*profiles|orden físico[\s\S]*profiles|profiles[\s\S]*attnum/i, "explica deriva previa de profiles");
  assert.match(document, /QA no conserva actualmente filas de historial/i);
  assert.match(document, /No se permite asumir que PROD sea equivalente a QA/i);
  assert.match(document, /schema_paths = \[\]/);
  assert.match(document, /schema\.sql` → 18 históricas → PERF-06A → PERF-06C → PERF-06B → invariant → compensatoria → ACL versionado/);
  assert.match(document, /22 policies/);
  assert.match(document, /carrera|race/i, "documenta la carrera detectada");
  assert.match(document, /invariant permanente/i, "documenta la solución permanente");
  assert.match(document, /20260811035538_ensure_legacy_exercise_lineage_invariant\.sql/);
  assert.match(document, /20260811035542_reconcile_legacy_exercise_lineages\.sql/);
  assert.match(document, /no se modificó código productivo/i);
  assert.match(document, /training_session_consolidation_audit/);
  assert.match(document, /Rollback propuesto/);
}

function clauseExpression(statement: SqlStatement, clause: "using" | "with check"): string {
  const masked = maskSqlPreservingOffsets(statement.original).toLowerCase();
  const clauseIndex = masked.indexOf(clause);
  assert.ok(clauseIndex >= 0, `policy contiene ${clause}`);
  const open = masked.indexOf("(", clauseIndex + clause.length);
  assert.ok(open >= 0, `${clause} abre expresión`);
  let depth = 0;
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === "(") depth += 1;
    else if (masked[index] === ")") {
      depth -= 1;
      if (depth === 0) return statement.original.slice(open + 1, index);
    }
  }
  assert.fail(`${clause} cierra expresión`);
}

function assertRelationalLineagePredicate(expression: string, label: string): void {
  const code = maskSqlPreservingOffsets(expression).replace(/\s+/g, " ").trim().toLowerCase();
  const withLiterals = commentFreeSql(expression).replace(/\s+/g, " ").trim().toLowerCase();
  assert.match(code, /user_id = \(select auth\.uid\(\)\)/, `${label}: owner autenticado`);
  assert.match(code, /origin_kind =/, `${label}: evalúa origin_kind ejecutable`);
  assert.match(withLiterals, /origin_kind = 'legacy'/, `${label}: rama legacy real`);
  assert.match(code, /source_legacy_exercise_id is not null/, `${label}: legacy exige source`);
  assert.match(code, /origin_training_cycle_exercise_id is null/, `${label}: legacy excluye origin scoped`);
  assert.match(code, /from public\.exercises e/, `${label}: consulta exercise real`);
  assert.match(code, /\be\.id = source_legacy_exercise_id/, `${label}: source legacy relacional`);
  assert.match(code, /\be\.user_id = \(select auth\.uid\(\)\)/, `${label}: exercise pertenece al actor`);
  assert.match(withLiterals, /origin_kind = 'scoped'/, `${label}: rama scoped real`);
  assert.match(code, /source_legacy_exercise_id is null/, `${label}: scoped excluye source legacy`);
  assert.match(code, /from public\.training_cycle_exercises tce/, `${label}: consulta origin scoped real`);
  assert.match(code, /tce\.id = origin_training_cycle_exercise_id/, `${label}: origin scoped relacional`);
  assert.match(code, /tce\.user_id = \(select auth\.uid\(\)\)/, `${label}: origin scoped pertenece al actor`);
  assert.match(code, /tce\.exercise_lineage_id = training_exercise_lineages\.id/, `${label}: vínculo scoped bidireccional`);
}

type PolicyState = { command: string; roles: string[]; statement: SqlStatement };
type GrantState = { table: Set<string>; columns: Map<string, Set<string>> };

function splitSqlList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function validateEffectiveLineageAccess(root: string): void {
  const policies = new Map<string, PolicyState>();
  const grants = new Map<string, GrantState>(
    ["public", "anon", "authenticated"].map((role) => [role, { table: new Set(), columns: new Map() }]),
  );
  for (const file of migrationFiles(root)) {
    for (const statement of executableStatements(read(root, join(migrationsDirectory, file)))) {
      const { code } = statement;
      if (/^(grant|revoke) /.test(code) && code.includes("on table public.training_exercise_lineages")) {
        const revoke = /^revoke all on table public\.training_exercise_lineages from (public|anon|authenticated);$/.exec(code);
        if (revoke) {
          grants.set(revoke[1], { table: new Set(), columns: new Map() });
          continue;
        }
        const grant = /^grant (.+) on table public\.training_exercise_lineages to (public|anon|authenticated);$/.exec(code);
        assert.ok(grant, `${file}: grant/revoke de lineages reconocido`);
        const state = grants.get(grant[2])!;
        for (const privilege of splitSqlList(grant[1])) {
          const columnGrant = /^(select|insert|update|delete) \(([^)]+)\)$/.exec(privilege);
          if (columnGrant) {
            const columns = state.columns.get(columnGrant[1]) ?? new Set<string>();
            splitSqlList(columnGrant[2]).forEach((column) => columns.add(column));
            state.columns.set(columnGrant[1], columns);
          } else {
            assert.match(privilege, /^(select|insert|update|delete|all)$/i, `${file}: privilegio reconocido`);
            state.table.add(privilege.toLowerCase());
          }
        }
        continue;
      }
      if (/^(create|drop|alter) policy /.test(code) && code.includes("on public.training_exercise_lineages")) {
        const drop = /^drop policy if exists "([^"]+)" on public\.training_exercise_lineages;$/.exec(code);
        if (drop) {
          policies.delete(drop[1]);
          continue;
        }
        const create = /^create policy "([^"]+)" on public\.training_exercise_lineages for (select|insert|update|delete) to ([a-z_, ]+?)(?= using| with check)/.exec(code);
        if (create) {
          policies.set(create[1], {
            command: create[2],
            roles: create[3].split(",").map((role) => role.trim()).sort(),
            statement,
          });
          continue;
        }
        const alter = /^alter policy "([^"]+)" on public\.training_exercise_lineages /.exec(code);
        if (alter) {
          policies.set(alter[1], { command: "altered", roles: [], statement });
          continue;
        }
        assert.fail(`${file}: DDL de policy lineage no reconocido`);
      }
    }
  }

  assert.deepEqual([...grants.get("authenticated")!.table].sort(), ["insert", "select"], "authenticated sólo conserva SELECT e INSERT de tabla");
  assert.deepEqual(
    [...(grants.get("authenticated")!.columns.get("update") ?? new Set())].sort(),
    ["origin_training_cycle_exercise_id", "updated_at"],
    "UPDATE authenticated queda allowlisted a los dos writes RPC legítimos",
  );
  assert.equal(grants.get("authenticated")!.columns.size, 1, "no existen otros grants de columna authenticated");
  assert.deepEqual([...grants.get("anon")!.table], [], "anon sin grants de tabla");
  assert.equal(grants.get("anon")!.columns.size, 0, "anon sin grants de columna");
  assert.deepEqual([...grants.get("public")!.table], [], "PUBLIC sin grants de tabla");
  assert.equal(grants.get("public")!.columns.size, 0, "PUBLIC sin grants de columna");

  assert.deepEqual([...policies.keys()].sort(), [
    "lineages own rows insert",
    "lineages own rows select",
    "lineages own rows update",
  ], "estado final contiene sólo las tres policies esperadas y ninguna DELETE");
  for (const [name, command] of [
    ["lineages own rows select", "select"],
    ["lineages own rows insert", "insert"],
    ["lineages own rows update", "update"],
  ] as const) {
    const policy = policies.get(name)!;
    assert.equal(policy.command, command, `${name}: comando final`);
    assert.deepEqual(policy.roles, ["authenticated"], `${name}: TO authenticated explícito`);
    if (command !== "insert") assertRelationalLineagePredicate(clauseExpression(policy.statement, "using"), `${name} USING`);
    if (command !== "select") assertRelationalLineagePredicate(clauseExpression(policy.statement, "with check"), `${name} WITH CHECK`);
  }
}

function validateProductAndAccess(root: string): void {
  const repository = read(root, productRepository);
  assert.equal(sha256(repository), productRepositorySha256, "repository.ts productivo permanece byte-idéntico");
  assert.equal((repository.match(/\.from\("exercises"\)\.upsert\(/g) ?? []).length, 2, "detecta los dos upserts directos normal/fallback que obligan al trigger");
  assert.doesNotMatch(repository, /\.from\("training_exercise_lineages"\)[\s\S]{0,160}?\.delete\(/, "producto no borra lineages");

  const cycleRepository = read(root, cycleScopedRepository);
  const lineagePayload = read(root, lineageModel);
  assert.equal((cycleRepository.match(/\.from\("training_exercise_lineages"\)/g) ?? []).length, 0, "producto delega altas y vinculación lineage a la RPC atómica por día");
  assert.match(cycleRepository, /\.rpc\("apply_training_cycle_day_exercise_changes"/, "producto usa la RPC atómica para cambios de ejercicios");
  assert.doesNotMatch(cycleRepository, /\.from\("training_exercise_lineages"\)[\s\S]{0,180}?\.(?:insert|update|upsert|delete)\(/, "producto no escribe lineages directamente");
  assert.match(lineagePayload, /return \{\s*user_id: input\.userId,\s*source_legacy_exercise_id: input\.sourceLegacyExerciseId \?\? null,\s*origin_kind: input\.sourceLegacyExerciseId \? "legacy" : "scoped",\s*\};/, "payload INSERT productivo allowlisted a identidad lineage");

  const lineageMigration = read(root, join(migrationsDirectory, "20260610000001_training_exercise_lineage.sql"));
  const lineageCode = commentFreeSql(lineageMigration).replace(/\s+/g, " ");
  assert.equal((lineageCode.match(/update public\.training_exercise_lineages/gi) ?? []).length, 1, "SQL legítimo sólo actualiza una vez el lineage scoped");
  assert.equal((lineageCode.match(/do update set updated_at = public\.training_exercise_lineages\.updated_at/gi) ?? []).length, 1, "RPC conserva el no-op UPDATE requerido para recuperar lineage legacy");
  assert.match(lineageCode, /update public\.training_exercise_lineages set origin_training_cycle_exercise_id = coalesce\(origin_training_cycle_exercise_id, v_new_cycle_exercise_id\)/i, "RPC invoker sólo vincula origin scoped");

  const allExecutableMigrations = migrationFiles(root)
    .map((file) => structuralSql(read(root, join(migrationsDirectory, file))))
    .join(" ");
  assert.doesNotMatch(allExecutableMigrations, /delete from public\.training_exercise_lineages/, "ninguna migración efectiva ofrece DELETE de lineages");
  assert.doesNotMatch(allExecutableMigrations, /grant [^;]*delete[^;]*training_exercise_lineages|grant all[^;]*training_exercise_lineages/, "ninguna migración efectiva concede DELETE de lineages");
  validateEffectiveLineageAccess(root);
}

function validateContractRegistration(root: string): void {
  const packageJson = JSON.parse(read(root, "package.json")) as { scripts: Record<string, string> };
  const scripts = Object.entries(packageJson.scripts)
    .filter(([name]) => name === "test" || name === "pretest" || name.startsWith("test:"))
    .map(([, script]) => script)
    .join(" ");
  const contractPath = "src/lib/server/perf-06-history-reconciliation-contract.test.ts";
  assert.equal(scripts.split(contractPath).length - 1, 1, "contrato PERF-06R conectado exactamente una vez a npm test");
}

function validateAtomicRunner(root: string): void {
  for (const artifact of runnerArtifacts) assert.ok(existsSync(join(root, artifact)), `runner artifact presente: ${artifact}`);
  const runner = read(root, runnerPath);
  const manifestLibrary = read(root, runnerManifestLibrary);
  const localBootstrap = read(root, "scripts/perf-06-local-bootstrap.mjs");
  const localBootstrapSql = read(root, `${runnerOperationDirectory}/local-validation-bootstrap.sql`);
  const scenarios = read(root, `${runnerOperationDirectory}/scenarios.sql`);
  const prechecks = read(root, `${runnerOperationDirectory}/prechecks.sql`);
  const postchecks = read(root, `${runnerOperationDirectory}/postchecks.sql`);
  const readme = read(root, `${runnerOperationDirectory}/README.md`);
  const packageJson = JSON.parse(read(root, "package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const manifest = JSON.parse(read(root, `${runnerOperationDirectory}/manifest.json`)) as {
    sha256: string;
    historicalVersions: number;
    historicalStatements: number;
    perf06Versions: number;
    perf06Statements: number;
    totalVersions: number;
    totalStatements: number;
    migrations: Array<{ version: string; statements: number }>;
  };

  assert.deepEqual(
    [manifest.historicalVersions, manifest.historicalStatements, manifest.perf06Versions, manifest.perf06Statements, manifest.totalVersions, manifest.totalStatements],
    [18, 255, 6, 81, 24, 336],
    "manifiesto runner exacto 18/255 + 6/81 = 24/336",
  );
  assert.equal(manifest.sha256, runnerManifestSha256, "hash de manifiesto runner exacto");
  assert.equal(manifest.migrations.length, 24, "manifiesto enumera 24 versiones");
  assert.equal(manifest.migrations.reduce((sum, row) => sum + row.statements, 0), 336, "manifiesto enumera 336 statements");
  assert.equal(new Set(manifest.migrations.map((row) => row.version)).size, 24, "versiones runner 1:1");

  assert.equal(packageJson.devDependencies?.pg, "8.23.0", "pg es devDependency exacta");
  assert.equal(packageJson.dependencies?.pg, undefined, "pg no entra en dependencies productivas");
  assert.doesNotMatch(runner, /node:child_process|\b(?:spawn|exec|execFile|fork)\s*\(|\bpsql\b|PGPASSWORD|stdin|stdout marker/iu, "runner sin procesos ni cliente SQL externos");
  assert.doesNotMatch(`${prechecks}\n${scenarios}\n${postchecks}\n${localBootstrapSql}`, /^\\[^\n]+/mu, "SQL sin metacomandos de cliente");
  assert.doesNotMatch(runner, /\bPool\b|new\s+pg\.Pool/u, "Pool prohibido");
  assert.equal((runner.match(/this\.client = new PgClient\(connection\)/g) ?? []).length, 1, "una sola instancia principal pg.Client");
  assert.equal((runner.match(/const verifier = dependencies\.verifier \?\? new PgClient\(/g) ?? []).length, 1, "única conexión verificadora declarada");
  assert.equal((runner.match(/new PgClient\(/g) ?? []).length, 2, "sólo cliente principal y verificador de incidentes");
  assert.match(runner, /await this\.closeMain\(\);[\s\S]*verifyIncidentOutcome\(/, "verificador sólo después de cerrar el cliente principal");
  assert.match(runner, /host: url\.hostname,[\s\S]*port,[\s\S]*user: username,[\s\S]*database,[\s\S]*ssl: options\.localValidation \? false : \{ rejectUnauthorized: true, servername: qaHost \}/, "conexión QA fija TLS y SNI estrictos");
  assert.doesNotMatch(runner, /rejectUnauthorized:\s*false|ssl:\s*true/, "sin TLS permisivo");
  assert.match(runner, /url\.hostname === qaHost && port === 5432 && database === "postgres"/, "QA usa host directo, 5432 y base postgres");
  assert.match(runner, /url\.searchParams\.get\("sslmode"\) === "verify-full"/, "QA rechaza todo modo TLS distinto de verify-full");
  assert.match(runner, /username === "postgres" && password/, "rol principal owner-capable postgres");
  assert.match(runner, /BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE/, "una transacción READ COMMITTED READ WRITE");
  assert.match(runner, /options\.execute !== options\.generateOnly/, "ejecución o generación explícita y exclusiva");
  assert.match(runner, /options\.confirmation === expected/, "COMMIT requiere flag y literal separado");
  assert.match(runner, /if \(!this\.options\.commit\) \{[\s\S]*this\.query\("ROLLBACK"\)/, "ROLLBACK es terminal predeterminado");
  assert.match(runner, /this\.transition\("commit_requested"\)[\s\S]*await this\.query\("COMMIT"\)[\s\S]*this\.transition\("commit_confirmed"\)/, "COMMIT protegido por lifecycle explícito");
  assert.doesNotMatch(runner, /console\.log|process\.stdout\.write\([^\n]*(?:raw|password|connection)/i, "secreto no impreso");
  assert.doesNotMatch(runner, /if \(false|false && setTimeout/, "gates ejecutables no pueden neutralizarse");
  assert.match(runner, /process\.once\("SIGINT"[\s\S]*process\.once\("SIGTERM"[\s\S]*process\.removeListener\("SIGTERM"/, "señales controladas y handlers retirados");
  assert.match(runner, /setTimeout\(\(\) => operation\.gate\.request\("timeout"\)/, "timeout global solicita interrupción");
  assert.match(runner, /invariant\(!options\.injection \|\| options\.localValidation/, "inyecciones imposibles contra QA");
  assert.doesNotMatch(runner, /\b(?:retry|retries|attempts)\b/i, "sin reintento automático");
  assert.equal((runner.match(/await operation\.run\(\)/g) ?? []).length, 1, "operación principal se invoca una sola vez");
  assert.doesNotMatch(runner, /db push|migration repair|postgrest|mcp/i, "sin caminos SQL fragmentados alternativos");
  assert.match(runner, /historical: manifest\.slice\(0, HISTORICAL_MIGRATIONS\.length\)/, "bootstrap toma sólo 18 históricas");
  assert.match(runner, /for \(let statementIndex[\s\S]*await this\.query\(row\.statements\[statementIndex\]\)[\s\S]*insert into supabase_migrations\.schema_migrations/, "registro PERF ocurre después del SQL");
  assert.match(runner, /create table if not exists supabase_migrations\.schema_migrations \(version text not null primary key\)[\s\S]*add column if not exists statements text\[\][\s\S]*add column if not exists name text/, "historial Supabase exacto y transaccional");
  const perfList = /export const PERF_06_MIGRATIONS = \[([\s\S]*?)\];/.exec(manifestLibrary)?.[1] ?? "";
  assert.match(perfList, /20260811190144_perf_06r_daily_readiness_acl_normalization\.sql/, "ACL incluido como sexta PERF");
  assert.match(manifestLibrary, new RegExp(runnerManifestSha256), "hash canónico fijado en generador");
  assert.match(manifestLibrary, /historicalCount !== 255 \|\| perfCount !== 81 \|\| manifest\.length !== 24/, "cardinalidades derivadas fail-closed");
  assert.match(manifestLibrary, /export function splitAndTrim/, "parser SplitAndTrim versionado");

  for (const scenario of "ABCDEFGHI") {
    assert.match(runner, new RegExp(`this\\.withScenario\\("${scenario}"`), `escenario ${scenario} tiene savepoint administrado`);
  }
  assert.match(runner, /async withScenario[\s\S]*SAVEPOINT_SQL[\s\S]*finally[\s\S]*sql\.rollback[\s\S]*sql\.release/, "savepoints se limpian mediante finally");
  assert.match(runner, /observed !== expectedCode/, "SQLSTATE se compara exactamente");
  assert.match(runner, /perf06_f_rebind_expected", rebindSql, rebindValues, "23514"/, "Scenario F acepta sólo SQLSTATE 23514 para rebind");
  assert.doesNotMatch(runner, /\[\s*["']23514["']\s*,\s*["']42501["']\s*\]/, "Scenario F no permite SQLSTATE alternativo");
  assert.match(runner, /await this\.query\(query\.insert_cycle[\s\S]*await this\.query\(query\.insert_cycle_routine[\s\S]*await this\.query\(query\.insert_cycle_day/, "Scenario G espera cada escritura antes de la siguiente");
  assert.ok((scenarios.match(/\$\d+/g) ?? []).length >= 30, "fixtures variables usan parámetros PostgreSQL");
  assert.match(scenarios, /values \(\$1::uuid, \$2::uuid, \$3::uuid, \$4::text, 1, 1, 0\)/, "fixture exercise completamente parametrizado");
  assert.doesNotMatch(runner, /query\.[a-z_]+\.(?:replace|concat)\(/, "runner no concatena fixtures dentro del SQL");
  assert.match(scenarios, /not exists \(select 1 from public\.exercises where name like '__perf06_fixture_%'\)/, "limpieza de fixtures entre escenarios");
  assert.match(postchecks, /not exists \(select 1 from public\.training_exercise_lineages where metadata \? 'fixture'\)/, "cero fixtures al final");
  assert.match(manifestLibrary, new RegExp(finalFingerprintSha256), "fingerprint final fijado en gate");
  assert.match(`${runner}\n${manifestLibrary}`, new RegExp(baselineFingerprintSha256), "fingerprint baseline fijado");
  assert.match(prechecks, /training_session_consolidation_audit/, "diagnóstico prevalidado");
  assert.match(prechecks, /lock table public\.training_session_consolidation_audit in share mode;/i, "diagnóstico bloqueado SHARE hasta el cierre");
  assert.match(prechecks, /select count\(\*\)::integer as marker_count\s+from public\.training_exercise_lineages\s+where metadata @>/i, "marker inicial contado globalmente, incluso huérfano");
  assertUniqueOrderedRunnerStatements(runner);
  assert.match(postchecks, /training_session_consolidation_audit/, "diagnóstico postvalidado");
  assert.doesNotMatch(`${runner}\n${prechecks}\n${scenarios}\n${postchecks}`, /drop\s+table[\s\S]{0,80}training_session_consolidation_audit/i, "diagnóstico nunca eliminado");
  assert.match(runner, /historyMatchesManifest\(snapshot\.historyRows, plan\.manifest\)/, "snapshot final usa manifiesto completo");
  assert.match(runner, /row\.version === manifest\[index\]\.version[\s\S]*row\.name === manifest\[index\]\.name[\s\S]*exactJson\(row\.statements, manifest\[index\]\.statements\)/, "historial final compara versión, nombre y statements completos");
  assert.match(runner, /await this\.postchecks\(\);\s*await this\.terminalAction\(\);/, "postchecks completos preceden toda decisión terminal");
  assert.match(runner, /async query[\s\S]*invariant\(!this\.blocked,[\s\S]*if \(!expectedError\) this\.blocked = true/, "un error inesperado bloquea nuevas queries ordinarias");
  assert.match(runner, /this\.blocked = true[\s\S]*rollbackAfterFailure/, "fallo solicita rollback controlado");
  assert.match(runner, /state === "commit_requested"[\s\S]*verifyIncidentOutcome/, "resultado incierto después de COMMIT se verifica sin PASS nominal");
  assert.match(runner, /result\.classification === "INDETERMINATE" \? "INDETERMINATE" : "INTERRUPTED"/, "commit incierto se rotula INDETERMINATE, no FAIL definitivo");
  assert.match(runner, /BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY[\s\S]*select exists\(select 1 from pg_catalog\.pg_stat_activity[\s\S]*collectStateSnapshot[\s\S]*"ROLLBACK"/, "verificador limitado a postcheck read-only");
  assert.match(runner, /pg_catalog\.pg_stat_clear_snapshot\(\)[\s\S]*pg_catalog\.pg_stat_activity/, "verificador refresca stats antes de decidir que el backend sigue activo");
  const verifierBody = /async function verifyIncidentOutcome[\s\S]*?\n}\n\nfunction classifySnapshot/.exec(runner)?.[0] ?? "";
  assert.doesNotMatch(verifierBody, /\b(?:insert|update|delete|create|alter|drop|truncate|grant|revoke)\b\s+(?:into|from|table|schema|function|on)/iu, "verificador no contiene writes");
  assert.match(runner, /boundedVerifierOperation\(\(\) => verifier\.end\(\), timeoutMs, "end"\)[\s\S]*destroyClientSocket\(verifier\)/, "cierre verificador acotado y fail-closed");
  assert.match(runner, /this\.assertMilestones\(true\);\s*const mainClosed = await this\.closeMain\(\);\s*if \(!mainClosed\) throw new IncidentError/, "cliente principal nominal exige cierre confirmado antes de retornar");
  assert.match(runner, /const mainClosed = await this\.closeMain\(\);\s*incident \|\|= !mainClosed;[\s\S]*verifyIncidentOutcome/, "cierre principal no confirmado fuerza verificación");
  assert.match(runner, /async function waitForPrincipalBackendToClose[\s\S]*while \(true\)[\s\S]*result\.rows\[0\]\.residual === false\) return/, "backend principal se espera sin escape global");
  const backendWaitBody = /async function waitForPrincipalBackendToClose[\s\S]*?\n}\n\nasync function closeVerifier/.exec(runner)?.[0] ?? "";
  assert.doesNotMatch(backendWaitBody, /deadline|Date\.now|BACKEND_CLOSE_TIMEOUT/, "polling del backend no tiene deadline permisivo");
  assert.match(runner, /if \(!backendGone && Number\.isInteger\(backendPid\)\) await remainPendingWhenBackendCannotBeConfirmed\(\)/, "fallo del verificador tampoco permite terminar con PID sin confirmar");
  const pendingBody = /async function remainPendingWhenBackendCannotBeConfirmed\(\)[\s\S]*?\n}\n\nfunction parseArguments/.exec(runner)?.[0] ?? "";
  assert.equal((runner.match(/PERF06 runner INDETERMINATE backend_status=unconfirmed; process remains pending/g) ?? []).length, 1, "no-silent-exit: aviso estático exacto y único");
  assert.match(pendingBody, /process\.exitCode = 1;[\s\S]*process\.stderr\.write\([\s\S]*const keepAlive = setInterval\([\s\S]*keepAlive\.ref\(\);[\s\S]*await new Promise\(\(\) => \{\}\);/, "no-silent-exit: exitCode, aviso, timer ref y espera eterna en orden");
  assert.doesNotMatch(pendingBody, /process\.exit\s*\(|\breturn\b/, "no-silent-exit: camino indeterminado no retorna ni fuerza process.exit");
  assert.match(runner, /options\.localValidation && new Set\(\["backend-close-hold", "connection-during-commit"\]\)\.has\(options\.injection\)/, "verificador inaccesible sólo se inyecta en los dos incidentes locales aprobados");
  assert.match(runner, /options\.localValidation && \(options\.injection === "timeout" \|\| options\.verifierUnreachable\)[\s\S]*\? 750/, "probes no-silent-exit reducen sólo el timeout local");
  assert.match(runner, /if \(!closed\.timedOut && closed\.value\.confirmed === true\) \{\s*this\.transition\("connection_closed"\)/, "connection_closed exige client.end confirmado");
  assert.match(runner, /this\.destroySocket\(\);[\s\S]*this\.transition\("outcome_unknown"\);[\s\S]*return false;/, "cierre principal no confirmado destruye socket y queda incierto");
  assert.match(runner, /const initial = await this\.collectPrecheck\(\)[\s\S]*const locked = await this\.collectPrecheck\(\)[\s\S]*this\.precheck = Object\.freeze\(\{ \.\.\.locked, complete: true \}\)/, "precheck sólo queda completo tras relectura bajo locks");
  assert.match(runner, /completePrecheck\(precheck\)[\s\S]*snapshot\.diagnosticHash === precheck\.diagnosticHash[\s\S]*dataCountsEqual\(snapshot\.dataCounts, precheck\.dataCounts\)/, "rollback exige baseline completo y estado lateral exacto");
  assert.match(runner, /snapshot\.markerCount === precheck\.pending[\s\S]*finalDataCountsMatch\(snapshot\.dataCounts, precheck\.dataCounts, precheck\.pending\)[\s\S]*snapshot\.completeStateValid === true/, "commit exige marker, allowlist lateral y postestado completo");
  assert.match(runner, /snapshot\?\.backendGone !== true\) return "INDETERMINATE"/, "clasificación prohibida antes de desaparición material del backend");
  assert.match(runner, /if \(!incident\) return \{ incident: false, classification: "INDETERMINATE" \}/, "rollback ordinario no suplanta verificación material del snapshot");
  assert.equal((runner.match(/completePrecheck\(precheck\)/g) ?? []).length, 3, "captura, rollback y commit exigen precheck completo");
  assert.match(runner, /snapshot\.markerCount === 0/, "rollback rechaza marker huérfano");
  assert.equal((runner.match(/snapshot\.fixtureFree === true/g) ?? []).length, 2, "rollback y commit rechazan fixtures");
  assert.equal((runner.match(/snapshot\.diagnosticCount === 0/g) ?? []).length, 2, "rollback y commit exigen diagnóstico vacío");
  assert.equal((runner.match(/snapshot\.diagnosticHash === precheck\.diagnosticHash/g) ?? []).length, 2, "rollback y commit exigen hash diagnóstico exacto");
  assert.equal((runner.match(/snapshot\.diagnosticConsumers === 0/g) ?? []).length, 2, "rollback y commit exigen cero consumidores diagnósticos");
  assert.match(runner, /snapshot\.markerCount === precheck\.pending/, "commit exige marker derivado del precheck");
  assert.match(runner, /finalDataCountsMatch\(snapshot\.dataCounts, precheck\.dataCounts, precheck\.pending\)/, "commit limita cambios laterales a lineage autorizado");
  assert.equal((runner.match(/snapshot\?\.backendGone !== true\) return "INDETERMINATE"/g) ?? []).length, 1, "guard backend ejecutable único");
  assert.match(runner, /const connectionTimeoutMs = dependencies\.connectionTimeoutMs \?\? VERIFIER_CONNECTION_TIMEOUT_MS;[\s\S]*connectionTimeoutMillis: connectionTimeoutMs,[\s\S]*query_timeout: VERIFIER_QUERY_TIMEOUT_MS/, "verificador tiene timeout de conexión inyectable sólo para prueba local y query timeout fijo");
  assert.match(runner, /return boundedVerifierOperation\([\s\S]*verifier\.query\(\{ text, values, query_timeout: timeoutMs \}\)/, "cada query verificadora está acotada por cliente y wrapper");
  assert.match(runner, /verifier\.query\(\{ text, values, query_timeout: timeoutMs \}\),\s*timeoutMs \+ 250,/, "timeout wrapper acompaña query_timeout del cliente");
  assert.match(runner, /SET LOCAL statement_timeout[\s\S]*SET LOCAL lock_timeout[\s\S]*SET LOCAL idle_in_transaction_session_timeout/, "verificador tiene defensa server-side triple");
  const verifierTransactionBody = /async function startVerifierTransaction[\s\S]*?\n}\n\nasync function waitForPrincipalBackendToClose/.exec(runner)?.[0] ?? "";
  assert.match(verifierTransactionBody, /`SET LOCAL statement_timeout = '\$\{timeoutMs\}ms'`/, "statement_timeout local pertenece al verificador");
  assert.match(verifierTransactionBody, /`SET LOCAL lock_timeout = '\$\{Math\.min\(VERIFIER_LOCK_TIMEOUT_MS, timeoutMs\)\}ms'`/, "lock_timeout local pertenece al verificador");
  assert.match(verifierTransactionBody, /`SET LOCAL idle_in_transaction_session_timeout = '\$\{Math\.max\(VERIFIER_IDLE_TIMEOUT_MS, timeoutMs \* 2\)\}ms'`/, "idle transaction timeout local pertenece al verificador");
  for (const label of [
    "connect", "begin", "statement_timeout", "lock_timeout", "idle_in_transaction_session_timeout",
    "pg_stat_clear_snapshot", "pg_stat_activity", "fingerprint", "history", "lineage_state",
    "fixtures", "diagnostic", "diagnostic_hash", "diagnostic_consumers", "data_counts", "rollback", "end",
  ]) assert.match(runner, new RegExp(`"${label}"`), `operación verificadora acotada: ${label}`);
  assert.match(postchecks, /select version, name, statements\s+from supabase_migrations\.schema_migrations\s+order by version;/, "query historial conserva arrays completos y orden exacto");
  assert.match(runner, /const verifierClosed = await closeVerifier\(verifier, queryTimeoutMs\);\s*if \(!verifierClosed\) classification = "INDETERMINATE";/, "fallo de cierre verificador invalida toda clasificación definitiva");
  assert.match(localBootstrap, /new pg\.Client[\s\S]*HISTORICAL_MIGRATIONS[\s\S]*EXPECTED_BASELINE_FINGERPRINT/, "bootstrap local también usa cliente nativo y valida baseline");
  assert.match(readme, /reparación de historial equivalente en\s+efecto a `migration repair`/i, "bootstrap clasificado correctamente");
  assert.match(readme, /No existe prelock global `ACCESS EXCLUSIVE`/, "locks mínimos documentados");
  assert.doesNotMatch(`${runner}\n${prechecks}\n${scenarios}\n${postchecks}`, /serializable/i, "runner no usa SERIALIZABLE");
}

function validateRunnerExternalCliProbes(root: string): void {
  const base = [
    join(root, runnerPath),
    "--mode", "qa",
    "--project-ref", "fjjebhaqtrdbpxzxztmh",
  ];
  const secret = "never-forward-this-secret";
  const invoke = (extra: string[]) => spawnSync(process.execPath, [...base, ...extra], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PERF_06_DATABASE_URL: `postgresql://postgres:${secret}@127.0.0.1:1/perf06_probe?sslmode=disable` },
  });

  const removedClientArgument = invoke(["--execute", "--local-validation", "--psql", "/usr/bin/true"]);
  assert.notEqual(removedClientArgument.status, 0, "probe externo: argumento de cliente eliminado");
  assert.match(removedClientArgument.stderr, /Unknown argument: --psql/, "probe externo: no existe selección de ejecutable");
  assert.doesNotMatch(`${removedClientArgument.stdout}${removedClientArgument.stderr}`, new RegExp(secret), "probe externo: secreto no impreso");

  const arbitraryOutput = invoke(["--generate-only", "--output", "/tmp/perf06-forbidden.sql"]);
  assert.notEqual(arbitraryOutput.status, 0, "probe externo: --output arbitrario rechazado");
  assert.match(arbitraryOutput.stderr, /Unknown argument: --output/, "probe externo: no existe ruta de escritura CLI");

  const badHost = spawnSync(process.execPath, [...base, "--execute"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PERF_06_DATABASE_URL: `postgresql://postgres:${secret}@example.invalid:5432/postgres?sslmode=verify-full` },
  });
  assert.notEqual(badHost.status, 0, "probe externo: host no aprobado rechazado antes de conectar");
  assert.match(badHost.stderr, /exact direct project database endpoint/, "probe externo: destino QA fail-closed");
  assert.doesNotMatch(`${badHost.stdout}${badHost.stderr}`, new RegExp(secret), "probe externo: credencial no impresa");
}

function validateIncidentVerifierBehavior(root: string): void {
  const runnerAbsolute = join(root, runnerPath);
  const pendingChildProbe = `
    import { pathToFileURL } from "node:url";
    const { remainPendingWhenBackendCannotBeConfirmed } = await import(pathToFileURL(${JSON.stringify(runnerAbsolute)}).href);
    await remainPendingWhenBackendCannotBeConfirmed();
  `;
  const probe = String.raw`
    import assert from "node:assert/strict";
    import { spawn } from "node:child_process";
    import { pathToFileURL } from "node:url";
    const {
      AtomicOperation,
      buildPlan,
      classifySnapshot,
      remainPendingWhenBackendCannotBeConfirmed,
      verifyIncidentOutcome,
      waitForPrincipalBackendToClose,
    } = await import(pathToFileURL(${JSON.stringify(runnerAbsolute)}).href);
    const plan = buildPlan();
    const relations = [
      "exercise_entries", "exercises", "profiles", "routines", "training_cycle_days",
      "training_cycle_exercises", "training_cycle_routines", "training_cycles",
      "training_daily_readiness", "training_exercise_lineages", "training_sessions",
      "training_workout_readiness",
    ];
    const baselineCounts = Object.fromEntries(relations.map((name, index) => [name, index + 10]));
    const partial = (value) => ({
      history_absent: value,
      identity_function_absent: value,
      invariant_function_absent: value,
      lineage_function_absent: value,
      perf_index_absent: value,
      perf_triggers_absent: value,
    });
    const diagnosticHash = "a".repeat(64);
    const precheck = {
      complete: true,
      fingerprint: { count: 346, hash: "ebd6b8bb930d222700d7af69c0a9c69236bc9135ee123e5f7129599c8d7105f1" },
      pending: 2,
      exerciseCount: 19,
      markerCount: 0,
      incompatibleCount: 0,
      ownerId: "owner",
      routineId: "routine",
      fixtureFree: true,
      diagnosticPresent: true,
      diagnosticCount: 0,
      diagnosticHash,
      diagnosticConsumers: 0,
      partialApplication: partial(true),
      dataCounts: baselineCounts,
    };
    const baseline = {
      backendGone: true,
      fingerprint: precheck.fingerprint,
      partialApplication: partial(true),
      historyPresent: false,
      historyRows: [],
      historyStatements: 0,
      pending: 2,
      markerCount: 0,
      exerciseCount: 19,
      incompatibleCount: 0,
      fixtureFree: true,
      diagnosticPresent: true,
      diagnosticCount: 0,
      diagnosticHash,
      diagnosticConsumers: 0,
      dataCounts: baselineCounts,
      catalogValid: false,
      completeStateValid: false,
    };
    const finalCounts = { ...baselineCounts, training_exercise_lineages: baselineCounts.training_exercise_lineages + 2 };
    const final = {
      ...baseline,
      fingerprint: { count: 377, hash: "833c2db78f0caeb776bf04b54d05e9c52c2adb0ee1e03cdbc0f479fe2ea76bc9" },
      partialApplication: partial(false),
      historyPresent: true,
      historyRows: plan.manifest.map((row) => ({ version: row.version, name: row.name, statements: [...row.statements] })),
      historyStatements: 336,
      pending: 0,
      markerCount: 2,
      dataCounts: finalCounts,
      catalogValid: true,
      completeStateValid: true,
    };
    const clone = (value) => structuredClone(value);
    assert.equal(classifySnapshot(baseline, precheck, plan), "ROLLED_BACK_VERIFIED", "baseline exacto clasifica rollback");
    assert.equal(classifySnapshot(final, precheck, plan), "COMMITTED_VERIFIED_AFTER_INTERRUPTION", "final exacto clasifica commit");
    const adversarial = [];
    let value = clone(baseline); value.markerCount = 1; adversarial.push(["baseline marker huérfano", value, precheck]);
    value = clone(baseline); value.fixtureFree = false; adversarial.push(["baseline fixture", value, precheck]);
    value = clone(baseline); value.diagnosticCount = 1; adversarial.push(["baseline diagnóstico no vacío", value, precheck]);
    value = clone(baseline); value.diagnosticHash = "b".repeat(64); adversarial.push(["baseline hash diagnóstico", value, precheck]);
    adversarial.push(["baseline sin precheck", clone(baseline), null]);
    value = clone(final); value.historyRows[3].version = "20990101000000"; adversarial.push(["versión sustituida", value, precheck]);
    value = clone(final); value.historyRows[3].name += "_wrong"; adversarial.push(["nombre sustituido", value, precheck]);
    value = clone(final); value.historyRows[3].statements[0] += " -- changed"; adversarial.push(["statements distintos", value, precheck]);
    value = clone(final); value.markerCount = 1; adversarial.push(["marker final", value, precheck]);
    value = clone(final); value.fixtureFree = false; adversarial.push(["fixture final", value, precheck]);
    value = clone(final); value.diagnosticCount = 1; adversarial.push(["diagnóstico final no vacío", value, precheck]);
    value = clone(final); value.diagnosticHash = "b".repeat(64); adversarial.push(["diagnóstico final alterado", value, precheck]);
    value = clone(final); value.dataCounts.profiles += 1; adversarial.push(["conteo lateral", value, precheck]);
    value = clone(final); value.historyRows.reverse(); adversarial.push(["orden historial", value, precheck]);
    value = clone(final); value.historyRows.push(clone(value.historyRows[0])); adversarial.push(["historial adicional", value, precheck]);
    value = clone(final); value.backendGone = false; adversarial.push(["backend presente", value, precheck]);
    for (const [name, snapshot, captured] of adversarial) {
      assert.equal(classifySnapshot(snapshot, captured, plan), "INDETERMINATE", name);
    }

    let residual = true;
    let waitFinished = false;
    const pollingVerifier = {
      query: async ({ text }) => text.includes("pg_stat_activity")
        ? { rows: [{ residual }] }
        : { rows: [{}] },
    };
    const backendWait = waitForPrincipalBackendToClose(pollingVerifier, 42, { queryTimeoutMs: 50, pollIntervalMs: 10 })
      .then(() => { waitFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 5_100));
    assert.equal(waitFinished, false, "PID residual sigue pendiente después del antiguo límite de cinco segundos");
    residual = false;
    await Promise.race([
      backendWait,
      new Promise((_, reject) => setTimeout(() => reject(new Error("PID no liberó polling")), 1_000)),
    ]);
    assert.equal(waitFinished, true, "polling continúa sólo tras desaparecer el PID");

    let mainSocketDestroyed = false;
    const operation = Object.create(AtomicOperation.prototype);
    Object.assign(operation, {
      state: "rollback_confirmed",
      stateHistory: ["rollback_confirmed"],
      mainCloseAttempted: false,
      client: {
        end: () => new Promise(() => {}),
        connection: { stream: { destroy: () => { mainSocketDestroyed = true; } } },
      },
    });
    const closeConfirmed = await operation.closeMain();
    assert.equal(closeConfirmed, false, "client.end colgado no confirma cierre principal");
    assert.equal(operation.state, "outcome_unknown", "cierre principal no confirmado queda incierto");
    assert.equal(operation.stateHistory.includes("connection_closed"), false, "no se emite connection_closed falso");
    assert.equal(mainSocketDestroyed, true, "socket principal se destruye");

    const fakeConnection = {};
    let querySocketDestroyed = false;
    const hungQueryVerifier = {
      connect: async () => {},
      end: async () => {},
      connection: { stream: { destroy: () => { querySocketDestroyed = true; } } },
      query: ({ text }) => {
        if (text === plan.fingerprintSql) return new Promise(() => {});
        if (text.includes("pg_stat_activity")) return Promise.resolve({ rows: [{ residual: false }] });
        return Promise.resolve({ rows: [{}] });
      },
    };
    const queryTimeoutResult = await verifyIncidentOutcome(fakeConnection, 42, plan, precheck, {
      verifier: hungQueryVerifier,
      queryTimeoutMs: 25,
      pollIntervalMs: 1,
    });
    assert.equal(queryTimeoutResult.classification, "INDETERMINATE", "query verificadora colgada es indeterminada");
    assert.equal(querySocketDestroyed, true, "query verificadora colgada destruye socket");

    let endSocketDestroyed = false;
    const completedVerifier = {
      connect: async () => {},
      end: () => new Promise(() => {}),
      connection: { stream: { destroy: () => { endSocketDestroyed = true; } } },
      query: async ({ text }) => {
        if (text.includes("pg_stat_activity")) return { rows: [{ residual: false }] };
        if (text === plan.prechecks.partial_application) return { rows: [partial(false)] };
        if (text === plan.fingerprintSql) return { rows: [{ category: "OVERALL", item_count: 377, sha256: final.fingerprint.hash }] };
        if (text === plan.postchecks.history) return { rows: final.historyRows };
        if (text === plan.postchecks.lineage_state) return { rows: [{ pending: 0, markers: 2 }] };
        if (text === plan.prechecks.lineage_counts) return { rows: [{ pending: 0, exercise_count: 19 }] };
        if (text === plan.postchecks.fixtures) return { rows: [{ valid: true }] };
        if (text === plan.postchecks.diagnostic) return { rows: [{ present: true, row_count: 0 }] };
        if (text === plan.prechecks.diagnostic_hash) return { rows: [{ diagnostic_hash: diagnosticHash }] };
        if (text === plan.prechecks.diagnostic_consumers) return { rows: [{ consumer_count: 0 }] };
        if (text === plan.prechecks.incompatible_lineages) return { rows: [{ incompatible_count: 0 }] };
        if (text === plan.prechecks.data_counts) return { rows: [{ counts: finalCounts }] };
        if (text === plan.scenarios.catalog || text === plan.scenarios.complete_state) return { rows: [{ valid: true }] };
        return { rows: [{}] };
      },
    };
    const hungEndResult = await verifyIncidentOutcome(fakeConnection, 42, plan, precheck, {
      verifier: completedVerifier,
      queryTimeoutMs: 25,
      pollIntervalMs: 1,
    });
    assert.equal(hungEndResult.classification, "INDETERMINATE", "end verificador colgado degrada resultado definitivo");
    assert.equal(hungEndResult.verifierClosed, false, "end verificador no se declara cerrado");
    assert.equal(endSocketDestroyed, true, "end verificador colgado destruye socket");

    const pendingChildSource = ${JSON.stringify(pendingChildProbe)};
    const pendingChild = spawn(process.execPath, ["--input-type=module", "--eval", pendingChildSource], {
      cwd: ${JSON.stringify(root)},
      stdio: ["ignore", "pipe", "pipe"],
    });
    let pendingStdout = "";
    let pendingStderr = "";
    pendingChild.stdout.setEncoding("utf8");
    pendingChild.stderr.setEncoding("utf8");
    pendingChild.stdout.on("data", (chunk) => { pendingStdout += chunk; });
    pendingChild.stderr.on("data", (chunk) => { pendingStderr += chunk; });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(pendingChild.exitCode, null, "no-silent-exit: proceso sigue vivo tras el umbral reducido anterior");
    assert.equal(pendingChild.signalCode, null, "no-silent-exit: proceso no se autotermina por señal");
    assert.doesNotThrow(() => process.kill(pendingChild.pid, 0), "no-silent-exit: timer referenciado conserva el proceso");
    assert.equal(
      pendingStderr,
      "PERF06 runner INDETERMINATE backend_status=unconfirmed; process remains pending\n",
      "no-silent-exit: aviso sanitizado exactamente una vez",
    );
    assert.equal(pendingStdout, "", "no-silent-exit: no emite PASS ni clasificación terminal");
    const forcedClose = new Promise((resolve) => pendingChild.once("close", (code, signal) => resolve({ code, signal })));
    pendingChild.kill("SIGKILL");
    const forcedResult = await forcedClose;
    assert.equal(forcedResult.code, null, "no-silent-exit: terminación forzada no produce código cero");
    assert.equal(forcedResult.signal, "SIGKILL", "no-silent-exit: terminación controlada y no exit(0)");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `probes conductuales del verificador: ${result.stderr || result.stdout}`);
}

function validateFixture(root: string): void {
  assert.equal(historicalMappings.length, 18, "mapping exacto de 18 históricos materiales");
  assert.equal(
    protectedPerfMigrations.length + protectedPerf06RMigrations.length + 1,
    6,
    "inventario PERF-06 exacto: A, C, B, invariant, compensatoria y ACL",
  );
  const normalizedNames = historicalMappings.map(([, newName]) => newName);
  const versions = normalizedNames.map((name) => name.slice(0, 14));
  assert.ok(normalizedNames.every((name) => /^\d{14}_.+\.sql$/.test(name)), "las 18 rutas usan 14 dígitos");
  assert.equal(new Set(versions).size, 18, "las 18 versiones son únicas");
  assert.deepEqual([...normalizedNames].sort(), normalizedNames, "orden lógico exacto");

  for (const [oldName, newName, expectedHash] of historicalMappings) {
    assert.equal(existsSync(join(root, migrationsDirectory, oldName)), false, `ruta anterior ausente: ${oldName}`);
    const normalizedPath = join(root, migrationsDirectory, newName);
    assert.ok(existsSync(normalizedPath), `ruta normalizada presente: ${newName}`);
    assert.equal(sha256(readFileSync(normalizedPath)), expectedHash, `contenido histórico intacto: ${newName}`);
  }

  for (const [file, expectedHash] of protectedPerfMigrations) {
    assert.equal(sha256(readFileSync(join(root, migrationsDirectory, file))), expectedHash, `${file} byte-idéntico`);
  }
  for (const [file, expectedHash] of protectedPerf06RMigrations) {
    assert.equal(sha256(readFileSync(join(root, migrationsDirectory, file))), expectedHash, `${file} byte-idéntico`);
  }

  const perf06rFiles = migrationFiles(root).filter((file) =>
    file.endsWith(invariantSuffix) || file.endsWith(compensationSuffix)
  );
  assert.deepEqual(
    perf06rFiles,
    [invariantMigration, compensationMigration],
    "inventario estructural PERF-06R contiene sólo timestamps y orden vigentes",
  );
  const invariant = invariantFile(root);
  const compensation = compensationFile(root);
  const invariantVersion = invariant.slice(0, 14);
  const compensationVersion = compensation.slice(0, 14);
  const aclVersion = aclMigration.slice(0, 14);
  const latestProtectedVersion = protectedPerfMigrations.at(-1)![0].slice(0, 14);
  assert.ok(invariantVersion > latestProtectedVersion, "invariant es posterior a PERF-06A/C/B");
  assert.ok(compensationVersion > invariantVersion, "invariant queda estrictamente antes de compensatoria");
  assert.ok(compensationVersion > latestProtectedVersion, "la compensatoria es posterior a PERF-06A/C/B");
  assert.ok(aclVersion > compensationVersion, "ACL versionado queda estrictamente después de compensatoria");
  validateInvariant(read(root, join(migrationsDirectory, invariant)));
  validateCompensation(read(root, join(migrationsDirectory, compensation)));
  validateProductAndAccess(root);
  validateContractRegistration(root);
  validateBaselineArtifacts(root);
  validateDocumentation(root);
  validateAtomicRunner(root);
}

function walkTestFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) result.push(...walkTestFiles(path));
    else if (/\.test\.tsx?$/.test(entry)) result.push(relative(repositoryRoot, path));
  }
  return result.sort();
}

function validateGlobalTestRegistry(): void {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const scripts = Object.entries(packageJson.scripts)
    .filter(([name]) => name === "test" || name === "pretest" || name.startsWith("test:"))
    .map(([, script]) => script)
    .join(" ");
  const references = [...scripts.matchAll(/(?:^|\s)(src\/[\w./-]+\.test\.tsx?)/g)].map((match) => match[1]);
  const disk = walkTestFiles(join(repositoryRoot, "src"));
  const unique = new Set(references);
  assert.equal(references.length, disk.length, "inventario global derivado: referencias = tests en disco");
  assert.equal(unique.size, disk.length, "inventario global derivado: referencias únicas = tests en disco");
  assert.deepEqual([...unique].sort(), disk, "cero tests duplicados, omitidos o inexistentes");
  const contractPath = "src/lib/server/perf-06-history-reconciliation-contract.test.ts";
  assert.equal(references.filter((path) => path === contractPath).length, 1, "contrato PERF-06R registrado exactamente una vez");
  assert.equal(sha256(readFileSync(join(repositoryRoot, "package-lock.json"))), packageLockSha256, "package-lock.json byte-idéntico");
}

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "perf-06r-contract-"));
  const paths = [...new Set([
    ...historicalMappings.map(([, newName]) => join(migrationsDirectory, newName)),
    ...protectedPerfMigrations.map(([file]) => join(migrationsDirectory, file)),
    join(migrationsDirectory, invariantFile(repositoryRoot)),
    join(migrationsDirectory, compensationFile(repositoryRoot)),
    join(migrationsDirectory, aclMigration),
    ...postPerfMigrationFiles(repositoryRoot).map((file) => join(migrationsDirectory, file)),
    ...discoverPostPerfMigrationOwnership(repositoryRoot).contractPaths,
    join(diagnosticsDirectory, diagnosticArtifact),
    join(diagnosticsDirectory, fingerprintArtifact),
    schemaBaseline,
    normalizationDocument,
    ...runnerArtifacts,
    productRepository,
    cycleScopedRepository,
    lineageModel,
    "package.json",
  ])];
  for (const path of paths) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repositoryRoot, path), destination);
  }
  return root;
}

function fixtureSha(root: string): string {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  return sha256(files.sort().map((path) => `${relative(root, path)}:${sha256(readFileSync(path))}`).join("\n"));
}

function canonicalSourcesSha(): string {
  const paths = [...new Set([
    ...historicalMappings.map(([, newName]) => join(migrationsDirectory, newName)),
    ...protectedPerfMigrations.map(([file]) => join(migrationsDirectory, file)),
    join(migrationsDirectory, invariantFile(repositoryRoot)),
    join(migrationsDirectory, compensationFile(repositoryRoot)),
    join(migrationsDirectory, aclMigration),
    ...postPerfMigrationFiles(repositoryRoot).map((file) => join(migrationsDirectory, file)),
    ...discoverPostPerfMigrationOwnership(repositoryRoot).contractPaths,
    join(diagnosticsDirectory, diagnosticArtifact),
    join(diagnosticsDirectory, fingerprintArtifact),
    schemaBaseline,
    normalizationDocument,
    ...runnerArtifacts,
    productRepository,
    cycleScopedRepository,
    lineageModel,
    "package.json",
  ])];
  return sha256(paths.map((path) => `${path}:${sha256(readFileSync(join(repositoryRoot, path)))}`).join("\n"));
}

function mutateInvariant(root: string, mutate: (source: string) => string): void {
  const path = join(root, migrationsDirectory, invariantFile(root));
  const source = readFileSync(path, "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "mutation probe invariant efectivo");
  writeFileSync(path, mutated);
}

function mutateCompensation(root: string, mutate: (source: string) => string): void {
  const path = join(root, migrationsDirectory, compensationFile(root));
  const source = readFileSync(path, "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "mutation probe efectivo");
  writeFileSync(path, mutated);
}

function mutateAclMigration(root: string, mutate: (source: string) => string): void {
  const path = join(root, migrationsDirectory, aclMigration);
  const source = readFileSync(path, "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "mutation probe ACL efectivo");
  writeFileSync(path, mutated);
}

function mutateFingerprint(root: string, mutate: (source: string) => string): void {
  const path = join(root, diagnosticsDirectory, fingerprintArtifact);
  const source = readFileSync(path, "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "mutation probe fingerprint efectivo");
  writeFileSync(path, mutated);
}

function mutateInvariantPolicy(
  root: string,
  policyName: string,
  mutate: (policy: string) => string,
): void {
  mutateInvariant(root, (source) => {
    const marker = `create policy "${policyName}"`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `policy presente para mutar: ${policyName}`);
    const end = source.indexOf(";", start);
    assert.ok(end >= 0, `policy terminada para mutar: ${policyName}`);
    const policy = source.slice(start, end + 1);
    const mutated = mutate(policy);
    assert.notEqual(mutated, policy, `mutación efectiva de policy: ${policyName}`);
    return `${source.slice(0, start)}${mutated}${source.slice(end + 1)}`;
  });
}

function replacePolicyClause(policy: string, clause: "using" | "with check", replacement: string): string {
  const statement = executableStatements(policy)[0];
  const expression = clauseExpression(statement, clause);
  const start = policy.indexOf(expression);
  assert.ok(start >= 0, `expresión ${clause} localizada para mutar`);
  return `${policy.slice(0, start)}${replacement}${policy.slice(start + expression.length)}`;
}

function replaceExactlyOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length - 1, 1, `fragmento único para mutar: ${before}`);
  return source.replace(before, after);
}

function replaceLast(source: string, before: string, after: string): string {
  const index = source.lastIndexOf(before);
  assert.ok(index >= 0, `fragmento final para mutar: ${before}`);
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`;
}

function assertUniqueOrderedRunnerStatements(source: string): void {
  const sourceFile = ts.createSourceFile(runnerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  assert.equal(parseDiagnostics.length, 0, "orden precheck/locks: runner JavaScript parseable");
  const classes: ts.ClassDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name?.text === "AtomicOperation") classes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(classes.length, 1, "orden precheck/locks: clase AtomicOperation única");
  const methods = classes[0].members.filter(
    (member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member)
      && ts.isIdentifier(member.name)
      && member.name.text === "prechecksAndLocks",
  );
  assert.equal(methods.length, 1, "orden precheck/locks: método prechecksAndLocks único");
  assert.ok(methods[0].body, "orden precheck/locks: método prechecksAndLocks con cuerpo");
  const statements = methods[0].body!.statements.map((statement) => statement.getText(sourceFile).replace(/\s+/gu, " ").trim());
  const expected = [
    "const initial = await this.collectPrecheck();",
    "await this.query(this.plan.prechecks.lock_diagnostic);",
    "await this.query(this.plan.prechecks.lock_auth_users);",
    "await this.query(this.plan.prechecks.lock_exercises);",
    "await this.query(this.plan.prechecks.lock_dependents);",
    "const locked = await this.collectPrecheck();",
    'invariant(exactJson(locked, initial), "Prechecks changed while locks were acquired");',
    "this.precheck = Object.freeze({ ...locked, complete: true });",
  ];
  let previous = -1;
  for (const anchor of expected) {
    const matches = statements.flatMap((statement, index) => statement === anchor ? [index] : []);
    assert.equal(matches.length, 1, `orden precheck/locks: ancla ejecutable única: ${anchor}`);
    assert.ok(matches[0] > previous, `orden precheck/locks: secuencia exacta: ${anchor}`);
    previous = matches[0];
  }
}

function removeCompensationPostcheck(source: string): string {
  const marker = "message = 'PERF-06R aborted: legacy exercises remain without compatible lineage';";
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, "postcheck compensatorio presente para mutar");
  const start = source.lastIndexOf("\n  if exists (", markerIndex);
  const endStart = source.indexOf("\n  end if;", markerIndex);
  assert.ok(start >= 0 && endStart >= 0, "bloque postcheck compensatorio delimitado");
  const end = endStart + "\n  end if;".length;
  return `${source.slice(0, start)}\n  perform 1;${source.slice(end)}`;
}

function mutateProfileDefinition(
  root: string,
  selector: { kind: ProfileDefinitionSpan["kind"]; name: string },
  replacement: string,
): void {
  const path = join(root, schemaBaseline);
  const source = readFileSync(path, "utf8");
  const before = profileTableLayout(source);
  const matches = before.entries.filter(({ kind, name }) => kind === selector.kind && name === selector.name);
  assert.equal(matches.length, 1, `profile probe: selector estructural único ${selector.kind}.${selector.name}`);
  const target = matches[0];
  assert.notEqual(replacement, target.source, `profile probe: mutación efectiva ${selector.kind}.${selector.name}`);
  const mutated = `${source.slice(0, target.start)}${replacement}${source.slice(target.end)}`;
  writeFileSync(path, mutated);

  const after = profileTableLayout(mutated);
  const unaffectedBefore = before.entries
    .filter(({ kind, name }) => kind !== selector.kind || name !== selector.name)
    .map(({ kind, name, source: definition }) => ({ kind, name, definition }));
  const unaffectedAfter = after.entries
    .filter(({ kind, name }) => kind !== selector.kind || name !== selector.name)
    .map(({ kind, name, source: definition }) => ({ kind, name, definition }));
  assert.deepEqual(unaffectedAfter, unaffectedBefore, `profile probe: sólo muta nodo ${selector.kind}.${selector.name}`);
}

function mutateProfileColumn(root: string, name: string, replacement: string): void {
  mutateProfileDefinition(root, { kind: "column", name }, replacement);
}

function mutateProfileConstraint(root: string, name: string, replacement: string): void {
  mutateProfileDefinition(root, { kind: "constraint", name }, replacement);
}

function swapProfileColumns(root: string, firstName: string, secondName: string): void {
  const path = join(root, schemaBaseline);
  const source = readFileSync(path, "utf8");
  const layout = profileTableLayout(source);
  const firstMatches = layout.entries.filter(({ kind, name }) => kind === "column" && name === firstName);
  const secondMatches = layout.entries.filter(({ kind, name }) => kind === "column" && name === secondName);
  assert.equal(firstMatches.length, 1, `profile probe: primera columna única ${firstName}`);
  assert.equal(secondMatches.length, 1, `profile probe: segunda columna única ${secondName}`);
  const [left, right] = [firstMatches[0], secondMatches[0]].sort((a, b) => a.start - b.start);
  const between = source.slice(left.end, right.start);
  const mutated = `${source.slice(0, left.start)}${right.source}${between}${left.source}${source.slice(right.end)}`;
  assert.notEqual(mutated, source, "profile probe: swap estructural efectivo");
  writeFileSync(path, mutated);
}

function addUnexpectedProfileColumn(root: string): void {
  const path = join(root, schemaBaseline);
  const source = readFileSync(path, "utf8");
  const layout = profileTableLayout(source);
  const firstTableConstraint = layout.entries.find(({ kind }) => kind === "constraint");
  assert.ok(firstTableConstraint, "profile probe: constraint de tabla delimita inserción estructural");
  const mutated = `${source.slice(0, firstTableConstraint.start)}unexpected_profile_column text,\n  ${source.slice(firstTableConstraint.start)}`;
  writeFileSync(path, mutated);
  assert.equal(
    profileTableLayout(mutated).entries.filter(({ kind }) => kind === "column").length,
    expectedProfileColumns.length + 1,
    "profile probe: columna inesperada añadida exactamente una vez",
  );
}

function mutateRunnerArtifact(root: string, artifact: string, mutate: (source: string) => string): void {
  const path = join(root, artifact);
  const source = readFileSync(path, "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, `mutation probe runner efectivo: ${artifact}`);
  writeFileSync(path, mutated);
}

type MutationProbe = {
  name: string;
  apply: (root: string) => void;
  expectedFailure?: RegExp;
};

const mutationProbes: MutationProbe[] = [
  {
    name: "M26: todos los locks se adelantan al precheck inicial",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      `    const initial = await this.collectPrecheck();
    if (this.options.injection === "precheck") throw new Error("Injected precheck failure");
    this.mark("prechecks_read_only");
    await this.query(this.plan.prechecks.lock_diagnostic);
    await this.query(this.plan.prechecks.lock_auth_users);
    await this.query(this.plan.prechecks.lock_exercises);
    await this.query(this.plan.prechecks.lock_dependents);`,
      `    await this.query(this.plan.prechecks.lock_diagnostic);
    await this.query(this.plan.prechecks.lock_auth_users);
    await this.query(this.plan.prechecks.lock_exercises);
    await this.query(this.plan.prechecks.lock_dependents);
    const initial = await this.collectPrecheck();
    if (this.options.injection === "precheck") throw new Error("Injected precheck failure");
    this.mark("prechecks_read_only");`,
    )),
    expectedFailure: /orden precheck\/locks/,
  },
  {
    name: "precheck inicial eliminado",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    const initial = await this.collectPrecheck();",
      "    const initial = Object.freeze({});",
    )),
    expectedFailure: /orden precheck\/locks/,
  },
  {
    name: "precheck inicial sólo en comentario y string",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    const initial = await this.collectPrecheck();",
      `    // const initial = await this.collectPrecheck();
    void "const initial = await this.collectPrecheck();";
    const initial = Object.freeze({});`,
    )),
    expectedFailure: /orden precheck\/locks/,
  },
  {
    name: "segundo precheck bajo locks eliminado",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    const locked = await this.collectPrecheck();",
      "    const locked = initial;",
    )),
    expectedFailure: /orden precheck\/locks/,
  },
  {
    name: "precheck complete true antes de locks",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      replaceExactlyOnce(
        source,
        "    const initial = await this.collectPrecheck();",
        "    const initial = await this.collectPrecheck();\n    this.precheck = Object.freeze({ ...locked, complete: true });",
      ),
      "    this.precheck = Object.freeze({ ...locked, complete: true });\n    invariant(completePrecheck(this.precheck),",
      "    void this.precheck;\n    invariant(completePrecheck(this.precheck),",
    )),
    expectedFailure: /orden precheck\/locks/,
  },
  {
    name: "reorden parcial de locks diagnóstico y auth",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      `    await this.query(this.plan.prechecks.lock_diagnostic);
    await this.query(this.plan.prechecks.lock_auth_users);`,
      `    await this.query(this.plan.prechecks.lock_auth_users);
    await this.query(this.plan.prechecks.lock_diagnostic);`,
    )),
    expectedFailure: /orden precheck\/locks/,
  },
  {
    name: "verificador rollback tolera marker huérfano",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    && snapshot.markerCount === 0", "    && true")),
  },
  {
    name: "verificador rollback tolera fixture residual",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => source.replace("    && snapshot.fixtureFree === true", "    && true")),
  },
  {
    name: "verificador rollback tolera diagnóstico no vacío",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => source.replace("    && snapshot.diagnosticCount === 0", "    && true")),
  },
  {
    name: "verificador rollback tolera hash diagnóstico distinto",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => source.replace("    && snapshot.diagnosticHash === precheck.diagnosticHash", "    && true")),
  },
  {
    name: "verificador rollback acepta precheck incompleto",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => source.replace("  return completePrecheck(precheck)", "  return precheck != null")),
  },
  {
    name: "verificador final tolera versión sustituida",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "return historyRows.every((row, index) => row.version === manifest[index].version", "return historyRows.every((row, index) => true")),
  },
  {
    name: "verificador final tolera nombre incorrecto",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    && row.name === manifest[index].name", "    && true")),
  },
  {
    name: "verificador final tolera statements distintos",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    && exactJson(row.statements, manifest[index].statements));", "    && row.statements.length === manifest[index].statements.length);")),
  },
  {
    name: "verificador final tolera marker incorrecto",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    && snapshot.markerCount === precheck.pending", "    && true")),
  },
  {
    name: "verificador final tolera fixture residual",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceLast(source, "    && snapshot.fixtureFree === true", "    && true")),
  },
  {
    name: "verificador final tolera diagnóstico no vacío",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceLast(source, "    && snapshot.diagnosticCount === 0", "    && true")),
  },
  {
    name: "verificador final tolera estructura diagnóstica alterada",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceLast(source, "    && snapshot.diagnosticHash === precheck.diagnosticHash", "    && true")),
  },
  {
    name: "verificador final tolera conteo lateral",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    && finalDataCountsMatch(snapshot.dataCounts, precheck.dataCounts, precheck.pending)", "    && true")),
  },
  {
    name: "verificador escapa con backend residual permanente",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "  while (true) {", "  for (let polls = 0; polls < 2; polls += 1) {")),
  },
  {
    name: "verificador termina si no puede confirmar desaparición del backend",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "  if (!backendGone && Number.isInteger(backendPid)) await remainPendingWhenBackendCannotBeConfirmed();",
      "  if (!backendGone && Number.isInteger(backendPid)) classification = \"INDETERMINATE\";",
    )),
  },
  {
    name: "verificador continúa antes de desaparecer backend temporal",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    if (result.rows[0].residual === false) return;", "    return;")),
  },
  {
    name: "closeMain declara cierre no confirmado",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    if (!closed.timedOut && closed.value.confirmed === true) {", "    if (closed.timedOut || closed.value.confirmed === true) {")),
  },
  {
    name: "query verificadora pierde timeout efectivo",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    timeoutMs + 250,", "    Number.MAX_SAFE_INTEGER,")),
  },
  {
    name: "end verificador colgado conserva resultado definitivo",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "  if (!verifierClosed) classification = \"INDETERMINATE\";", "  if (!verifierClosed) classification = classification;")),
  },
  {
    name: "garantía backend sólo en comentario y string",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => `${replaceExactlyOnce(
      source,
      '  if (snapshot?.backendGone !== true) return "INDETERMINATE";',
      '  if (snapshot == null) return "INDETERMINATE";',
    )}\n// if (snapshot?.backendGone !== true) return "INDETERMINATE";\n'if (snapshot?.backendGone !== true) return "INDETERMINATE";';\n`),
  },
  {
    name: "verificador elimina connectionTimeoutMillis",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    connectionTimeoutMillis: connectionTimeoutMs,", "    keepAlive: true,")),
  },
  {
    name: "verificador elimina query_timeout cliente",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "    query_timeout: VERIFIER_QUERY_TIMEOUT_MS,", "    keepAlive: true,")),
  },
  {
    name: "verificador elimina statement_timeout local",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "`SET LOCAL statement_timeout = '${timeoutMs}ms'`", '"select 1"')),
  },
  {
    name: "verificador elimina lock_timeout local",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "`SET LOCAL lock_timeout = '${Math.min(VERIFIER_LOCK_TIMEOUT_MS, timeoutMs)}ms'`", '"select 1"')),
  },
  {
    name: "verificador elimina idle_in_transaction_session_timeout local",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(source, "`SET LOCAL idle_in_transaction_session_timeout = '${Math.max(VERIFIER_IDLE_TIMEOUT_MS, timeoutMs * 2)}ms'`", '"select 1"')),
  },
  {
    name: "runner ausente",
    apply: (root) => rmSync(join(root, runnerPath)),
  },
  {
    name: "runner agrega proceso SQL externo",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => `${source}\nspawn("sql-client", []);\n`),
  },
  {
    name: "runner introduce Pool",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => `${source}\nnew pg.Pool();\n`),
  },
  {
    name: "runner abre segundo cliente principal",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    this.client = new PgClient(connection);",
      "    this.client = new PgClient(connection);\n    this.shadowClient = new PgClient(connection);",
    )),
  },
  {
    name: "runner cae en autocommit",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    await this.query("BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE");',
      '    await this.query("select 1");',
    )),
  },
  {
    name: "runner permite COMMIT sin literal",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    invariant(options.confirmation === expected, "Persistent mode requires the exact literal confirmation");',
      '    invariant(true, "confirmation disabled");',
    )),
  },
  {
    name: "runner inserta 24 filas inicialmente",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    historical: manifest.slice(0, HISTORICAL_MIGRATIONS.length),",
      "    historical: manifest,",
    )),
  },
  {
    name: "runner registra migración antes de ejecutarla",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "      const row = this.plan.perf[migrationIndex];\n      for (let statementIndex",
      "      const row = this.plan.perf[migrationIndex];\n      await this.query(\"insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3::text[])\", [row.version, row.name, row.statements]);\n      for (let statementIndex",
    ).replace(
      '      await this.query(\n        "insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3::text[])",\n        [row.version, row.name, row.statements],\n      );\n      this.mark(`migration_${row.version}`);',
      '      this.mark(`migration_${row.version}`);',
    )),
  },
  {
    name: "runner omite ACL PERF-06R",
    apply: (root) => mutateRunnerArtifact(root, runnerManifestLibrary, (source) => replaceExactlyOnce(
      source,
      '  "20260811190144_perf_06r_daily_readiness_acl_normalization.sql",',
      '  "20260811190145_perf_06r_acl_omitted.sql",',
    )),
  },
  {
    name: "runner omite escenario A",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    await this.withScenario("A", async () => {',
      '    await this.withScenario("B", async () => {',
    )),
  },
  {
    name: "runner omite savepoint administrado",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    const sql = SAVEPOINT_SQL[letter];",
      '    const sql = { create: "select 1", rollback: "select 1", release: "select 1" };',
    )),
  },
  {
    name: "runner no valida SQLSTATE exacto",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    if (observed !== expectedCode) {",
      "    if (false) {",
    )),
  },
  {
    name: "runner permite query posterior a error",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    invariant(!this.blocked, "Query attempted after an unexpected error");',
      '    invariant(true, "query guard disabled");',
    )),
  },
  {
    name: "runner concatena valor de fixture en SQL",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "      await this.query(query.insert_exercise, [exercise, owner, routine, \"__perf06_fixture_c__\"]);",
      "      await this.query(query.insert_exercise.replace(\"$4\", \"'fixture'\"), [exercise, owner, routine]);",
    )),
  },
  {
    name: "runner tolera fixture persistente",
    apply: (root) => mutateRunnerArtifact(root, `${runnerOperationDirectory}/postchecks.sql`, (source) => replaceExactlyOnce(
      source,
      "  and not exists (select 1 from public.training_exercise_lineages where metadata ? 'fixture')",
      "  and true",
    )),
  },
  {
    name: "runner elimina diagnóstico",
    apply: (root) => mutateRunnerArtifact(root, `${runnerOperationDirectory}/postchecks.sql`, (source) => `${source}\ndrop table public.training_session_consolidation_audit;\n`),
  },
  {
    name: "runner altera fingerprint final",
    apply: (root) => mutateRunnerArtifact(root, runnerManifestLibrary, (source) => replaceExactlyOnce(
      source,
      finalFingerprintSha256,
      supersededFinalFingerprintSha256,
    )),
  },
  {
    name: "runner agrega reintento automático",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    const result = await operation.run();",
      "    await operation.run();\n    const result = await operation.run();",
    )),
  },
  {
    name: "runner imprime secreto",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => `${source}\nconsole.log(process.env.PERF_06_DATABASE_URL);\n`),
  },
  {
    name: "runner permite COMMIT antes de postchecks",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    await this.postchecks();\n    await this.terminalAction();",
      "    await this.terminalAction();\n    await this.postchecks();",
    )),
  },
  {
    name: "runner clasifica commit incierto como FAIL definitivo",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    const prefix = result.classification === "INDETERMINATE" ? "INDETERMINATE" : "INTERRUPTED";',
      '    const prefix = result.classification === "INDETERMINATE" ? "FAIL" : "INTERRUPTED";',
    )),
  },
  {
    name: "verificador de incidente ejecuta writes",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    await boundedVerifierOperation(() => verifier.connect(), connectionTimeoutMs, "connect");',
      '    await boundedVerifierOperation(() => verifier.connect(), connectionTimeoutMs, "connect");\n    await verifierQuery(verifier, "write", "delete from public.exercises", [], queryTimeoutMs);',
    )),
  },
  {
    name: "verificador conserva snapshot obsoleto de pg_stat_activity",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '    await verifierQuery(verifier, "pg_stat_clear_snapshot", "select pg_catalog.pg_stat_clear_snapshot()", [], timeoutMs);',
      "    // snapshot refresh removed",
    )),
  },
  {
    name: "runner no cierra cliente principal nominal",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "    this.assertMilestones(true);\n    const mainClosed = await this.closeMain();",
      "    this.assertMilestones(true);\n    const mainClosed = true;",
    )),
  },
  {
    name: "runner elimina handler SIGINT",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '  process.once("SIGINT", onSigint);',
      "  onSigint;",
    )),
  },
  {
    name: "runner elimina timeout global",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '  const timeout = setTimeout(() => operation.gate.request("timeout"), timeoutMs);',
      '  const timeout = false && setTimeout(() => operation.gate.request("timeout"), timeoutMs);',
    )),
  },
  {
    name: "runner degrada TLS QA a require",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => source.replaceAll('"verify-full"', '"require"')),
  },
  {
    name: "runner omite SNI verificado",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "ssl: options.localValidation ? false : { rejectUnauthorized: true, servername: qaHost },",
      "ssl: options.localValidation ? false : { rejectUnauthorized: true },",
    )),
  },
  {
    name: "runner omite lock diagnóstico",
    apply: (root) => mutateRunnerArtifact(root, `${runnerOperationDirectory}/prechecks.sql`, (source) => replaceExactlyOnce(
      source,
      "lock table public.training_session_consolidation_audit in share mode;",
      "select true;",
    )),
  },
  {
    name: "runner ignora marker huérfano",
    apply: (root) => mutateRunnerArtifact(root, `${runnerOperationDirectory}/prechecks.sql`, (source) => replaceExactlyOnce(
      source,
      "from public.training_exercise_lineages\nwhere metadata @>",
      "from public.training_exercise_lineages tel join public.exercises e on e.id = tel.source_legacy_exercise_id\nwhere tel.metadata @>",
    )),
  },
  {
    name: "Scenario F vuelve a aceptar 42501",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      '      await this.expectSqlState("perf06_f_rebind_expected", rebindSql, rebindValues, "23514");',
      '      await this.expectSqlState("perf06_f_rebind_expected", rebindSql, rebindValues, "42501");',
    )),
  },
  {
    name: "Scenario G continúa tras fallo intermedio",
    apply: (root) => mutateRunnerArtifact(root, runnerPath, (source) => replaceExactlyOnce(
      source,
      "      await this.query(query.insert_cycle_routine, [fixture.cycleRoutine, owner, fixture.cycle, \"__perf06_fixture_g_routine__\"]);",
      "      this.query(query.insert_cycle_routine, [fixture.cycleRoutine, owner, fixture.cycle, \"__perf06_fixture_g_routine__\"]);",
    )),
  },
  {
    name: "bootstrap local reintroduce metacomando",
    apply: (root) => mutateRunnerArtifact(root, `${runnerOperationDirectory}/local-validation-bootstrap.sql`, (source) => replaceExactlyOnce(
      source,
      "-- PERF06_BOOTSTRAP_PHASE before_schema",
      "\\set ON_ERROR_STOP on\n-- PERF06_BOOTSTRAP_PHASE before_schema",
    )),
  },
  {
    name: "runner altera hash de manifiesto",
    apply: (root) => mutateRunnerArtifact(root, `${runnerOperationDirectory}/manifest.json`, (source) => replaceExactlyOnce(
      source,
      runnerManifestSha256,
      "0955e5eeb0e4b08060970803ac27c4811f76a304f75d99fded65642847a39848",
    )),
  },
  {
    name: "devolver diagnóstico a migrations",
    apply: (root) => copyFileSync(
      join(root, diagnosticsDirectory, diagnosticArtifact),
      join(root, migrationsDirectory, "20260527000001_legacy_training_diagnostics.sql"),
    ),
  },
  {
    name: "registrar diagnóstico con versión inventada en historial",
    apply: (root) => {
      const path = join(root, normalizationDocument);
      writeFileSync(path, `${readFileSync(path, "utf8")}\nschema_migrations: 20260527000001_legacy_training_diagnostics.sql\n`);
    },
  },
  ...[
    "19 migraciones históricas",
    "5 versiones PERF-06",
    "23 versiones totales",
    "25 versiones totales",
  ].map((residualCount): MutationProbe => ({
    name: `reintroducir conteo residual: ${residualCount}`,
    apply: (root) => {
      const path = join(root, normalizationDocument);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n${residualCount}.\n`);
    },
    expectedFailure: /sin conteos residuales 19\/5\/23\/25/,
  })),
  {
    name: "alterar bytes del diagnóstico operativo",
    apply: (root) => {
      const path = join(root, diagnosticsDirectory, diagnosticArtifact);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n-- mutation\n`);
    },
  },
  {
    name: "profiles: cambiar tipo UUID",
    apply: (root) => mutateProfileColumn(root, "id", "id text primary key"),
    expectedFailure: /profiles\.id: tipo SQL completo/,
  },
  {
    name: "profiles: cambiar tipo text",
    apply: (root) => mutateProfileColumn(root, "display_name", "display_name varchar(255) not null"),
    expectedFailure: /profiles\.display_name: tipo SQL completo/,
  },
  {
    name: "profiles: cambiar tipo integer",
    apply: (root) => mutateProfileColumn(
      root,
      "current_streak",
      "current_streak bigint not null default 0 check (current_streak >= 0)",
    ),
    expectedFailure: /profiles\.current_streak: tipo SQL completo/,
  },
  {
    name: "profiles: cambiar tipo timestamptz",
    apply: (root) => mutateProfileColumn(root, "avatar_updated_at", "avatar_updated_at timestamp"),
    expectedFailure: /profiles\.avatar_updated_at: tipo SQL completo/,
  },
  {
    name: "profiles: cambiar tipo date",
    apply: (root) => mutateProfileColumn(root, "birth_date", "birth_date timestamptz"),
    expectedFailure: /profiles\.birth_date: tipo SQL completo/,
  },
  {
    name: "profiles: cambiar default numérico",
    apply: (root) => mutateProfileColumn(
      root,
      "current_streak",
      "current_streak integer not null default 1 check (current_streak >= 0)",
    ),
    expectedFailure: /profiles\.current_streak: default normalizado/,
  },
  {
    name: "profiles: eliminar default de timestamp",
    apply: (root) => mutateProfileColumn(root, "updated_at", "updated_at timestamptz not null"),
    expectedFailure: /profiles\.updated_at: default normalizado/,
  },
  {
    name: "profiles: cambiar default de timestamp",
    apply: (root) => mutateProfileColumn(root, "created_at", "created_at timestamptz not null default clock_timestamp()"),
    expectedFailure: /profiles\.created_at: default normalizado/,
  },
  {
    name: "profiles: cambiar default literal",
    apply: (root) => mutateProfileColumn(root, "gender", "gender text default 'male'"),
    expectedFailure: /profiles\.gender: default normalizado/,
  },
  {
    name: "profiles: eliminar default literal",
    apply: (root) => mutateProfileColumn(root, "gender", "gender text"),
    expectedFailure: /profiles\.gender: default normalizado/,
  },
  {
    name: "profiles: retirar NOT NULL",
    apply: (root) => mutateProfileColumn(root, "display_name", "display_name text"),
    expectedFailure: /profiles\.display_name: nulabilidad/,
  },
  {
    name: "profiles: agregar NOT NULL",
    apply: (root) => mutateProfileColumn(root, "first_name", "first_name text not null"),
    expectedFailure: /profiles\.first_name: nulabilidad/,
  },
  {
    name: "profiles: eliminar PRIMARY KEY conservando nulabilidad",
    apply: (root) => mutateProfileColumn(root, "id", "id uuid not null references auth.users(id) on delete cascade"),
    expectedFailure: /profiles\.id: constraints asociadas/,
  },
  {
    name: "profiles: alterar acción de FK",
    apply: (root) => mutateProfileColumn(root, "id", "id uuid primary key references auth.users(id) on delete restrict"),
    expectedFailure: /profiles\.id: constraints asociadas/,
  },
  {
    name: "profiles: eliminar CHECK inline",
    apply: (root) => mutateProfileColumn(root, "current_streak", "current_streak integer not null default 0"),
    expectedFailure: /profiles\.current_streak: constraints asociadas/,
  },
  {
    name: "profiles: alterar CHECK nombrado",
    apply: (root) => mutateProfileConstraint(
      root,
      "profiles_gender_allowed",
      "constraint profiles_gender_allowed check (gender is null or gender in ('male', 'female', 'non_binary', 'prefer_not_to_say'))",
    ),
    expectedFailure: /profiles\.gender: constraints asociadas/,
  },
  {
    name: "profiles: agregar GENERATED inesperado",
    apply: (root) => mutateProfileColumn(root, "first_name", "first_name text generated always as (last_name) stored"),
    expectedFailure: /profiles\.first_name: generated/,
  },
  {
    name: "profiles: agregar identity inesperada",
    apply: (root) => mutateProfileColumn(
      root,
      "current_streak",
      "current_streak integer generated by default as identity check (current_streak >= 0)",
    ),
    expectedFailure: /profiles\.current_streak: identity/,
  },
  {
    name: "profiles: desordenar físicamente columnas",
    apply: (root) => swapProfileColumns(root, "current_streak", "updated_at"),
    expectedFailure: /profiles ordinal 4: nombre/,
  },
  {
    name: "profiles: agregar columna inesperada",
    apply: addUnexpectedProfileColumn,
    expectedFailure: /profiles: cantidad exacta de columnas/,
  },
  {
    name: "profiles: definición correcta sólo en comentario y string",
    apply: (root) => {
      mutateProfileColumn(root, "display_name", "display_name varchar(255) not null");
      const path = join(root, schemaBaseline);
      writeFileSync(
        path,
        `${readFileSync(path, "utf8")}\n-- display_name text not null\nselect 'display_name text not null';\n`,
      );
    },
    expectedFailure: /profiles\.display_name: tipo SQL completo/,
  },
  ...(["public", "anon", "service_role"] as const).map((role): MutationProbe => ({
    name: `reintroducir EXECUTE de ${role}`,
    apply: (root) => mutateAclMigration(root, (source) => replaceExactlyOnce(
        source,
        `revoke all on function public.save_daily_training_readiness(jsonb) from ${role};`,
        `grant execute on function public.save_daily_training_readiness(jsonb) to ${role};`,
    )),
    expectedFailure: /migración ACL exacta/,
  })),
  {
    name: "retirar EXECUTE de authenticated",
    apply: (root) => mutateAclMigration(root, (source) => replaceExactlyOnce(
        source,
        "grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;",
        "revoke all on function public.save_daily_training_readiness(jsonb) from authenticated;",
    )),
    expectedFailure: /migración ACL exacta/,
  },
  {
    name: "retirar EXECUTE de postgres",
    apply: (root) => mutateAclMigration(root, (source) => replaceExactlyOnce(
      source,
      "grant execute on function public.save_daily_training_readiness(jsonb) to postgres;",
      "revoke all on function public.save_daily_training_readiness(jsonb) from postgres;",
    )),
    expectedFailure: /migración ACL exacta/,
  },
  {
    name: "agregar grant ACL adicional",
    apply: (root) => mutateAclMigration(
      root,
      (source) => `${source}\ngrant execute on function public.save_daily_training_readiness(jsonb) to anon;\n`,
    ),
    expectedFailure: /migración ACL exacta/,
  },
  {
    name: "cambiar firma del ACL",
    apply: (root) => mutateAclMigration(
      root,
      (source) => replaceExactlyOnce(
        source,
        "revoke all on function public.save_daily_training_readiness(jsonb) from public;",
        "revoke all on function public.save_daily_training_readiness(json) from public;",
      ),
    ),
    expectedFailure: /migración ACL exacta/,
  },
  {
    name: "cambiar objeto del ACL",
    apply: (root) => mutateAclMigration(
      root,
      (source) => replaceExactlyOnce(
        source,
        "revoke all on function public.save_daily_training_readiness(jsonb) from public;",
        "revoke all on function public.save_training_workout_readiness_v2(jsonb) from public;",
      ),
    ),
    expectedFailure: /migración ACL exacta/,
  },
  {
    name: "ACL correcto sólo en comentario y string",
    apply: (root) => mutateAclMigration(root, (source) => `${replaceExactlyOnce(
      source,
      "grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;",
      "revoke all on function public.save_daily_training_readiness(jsonb) from authenticated;",
    )}\n-- grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;\nselect 'grant execute on function public.save_daily_training_readiness(jsonb) to authenticated;';\n`),
    expectedFailure: /migración ACL exacta/,
  },
  {
    name: "alterar bytes de migración ACL",
    apply: (root) => mutateAclMigration(root, (source) => `${source}\n-- mutation\n`),
    expectedFailure: /migración ACL conserva su SHA-256 aprobado/,
  },
  {
    name: "omitir migración ACL",
    apply: (root) => rmSync(join(root, migrationsDirectory, aclMigration)),
    expectedFailure: /inventario exacto de 24 versiones/,
  },
  {
    name: "desregistrar migración ACL fuera de migrations",
    apply: (root) => renameSync(
      join(root, migrationsDirectory, aclMigration),
      join(root, diagnosticsDirectory, aclMigration),
    ),
    expectedFailure: /inventario exacto de 24 versiones/,
  },
  {
    name: "recrear ACL suelto no versionado",
    apply: (root) => {
      const destination = join(root, legacyBaselineAcl);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, migrationsDirectory, aclMigration), destination);
    },
    expectedFailure: /ACL suelto\/no versionado permanece ausente/,
  },
  {
    name: "omitir consulta fingerprint",
    apply: (root) => rmSync(join(root, diagnosticsDirectory, fingerprintArtifact)),
    expectedFailure: /fingerprint v1 presente en diagnostics/,
  },
  {
    name: "alterar bytes de consulta fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => `${source}\n-- mutation\n`),
    expectedFailure: /consulta fingerprint conserva su SHA-256 aprobado/,
  },
  {
    name: "agregar exclusión al fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => replaceExactlyOnce(
      source,
      "values ('public'::name, 'training_session_consolidation_audit'::name)",
      "values ('public'::name, 'training_session_consolidation_audit'::name), ('public'::name, 'profiles'::name)",
    )),
    expectedFailure: /única exclusión explícita y dedicada/,
  },
  {
    name: "quitar categoría policy del fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => replaceExactlyOnce(source, "    'policy',", "    'policy_shadow',")),
    expectedFailure: /única categoría policy/,
  },
  {
    name: "alterar orden de categoría fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => replaceExactlyOnce(
      source,
      "pg_catalog.string_agg(line, E'\\n' order by line)",
      "pg_catalog.string_agg(line, E'\\n' order by line desc)",
    )),
    expectedFailure: /ordena y serializa cada categoría con LF/,
  },
  {
    name: "alterar serialización pipe del fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => {
      assert.equal((source.match(/      '\|',/g) ?? []).length, 9, "probe fingerprint encuentra nueve delimitadores");
      return source.replace("      '|',", "      ':',");
    }),
    expectedFailure: /serializa las nueve categorías con separador pipe/,
  },
  {
    name: "sustituir SHA-256 del fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => source.replaceAll("pg_catalog.sha256(", "pg_catalog.md5(")),
    expectedFailure: /usa SHA-256 para categoría y OVERALL/,
  },
  {
    name: "SHA-256 correcto sólo en comentario del fingerprint",
    apply: (root) => mutateFingerprint(
      root,
      (source) => `${source.replaceAll("pg_catalog.sha256(", "pg_catalog.md5(")}\n-- pg_catalog.sha256(\n`,
    ),
    expectedFailure: /usa SHA-256 para categoría y OVERALL/,
  },
  {
    name: "hardcodear resultado fingerprint",
    apply: (root) => mutateFingerprint(root, (source) => `${source}\nselect '${baselineFingerprintSha256}';\n`),
    expectedFailure: /no contiene hashes resultado hardcodeados/,
  },
  {
    name: "quitar storage.objects del fingerprint",
    apply: (root) => mutateFingerprint(
      root,
      (source) => replaceExactlyOnce(source, "namespace.nspname = 'storage'", "namespace.nspname = 'storage_shadow'"),
    ),
    expectedFailure: /policy incluye storage\.objects/,
  },
  {
    name: "quitar auth.users del fingerprint",
    apply: (root) => mutateFingerprint(
      root,
      (source) => replaceExactlyOnce(source, "namespace.nspname = 'auth'", "namespace.nspname = 'auth_shadow'"),
    ),
    expectedFailure: /trigger incluye auth\.users/,
  },
  ...historicalMappings.map(([, file]): MutationProbe => ({
    name: `alterar SQL histórico material ${file}`,
    apply: (root) => {
      const path = join(root, migrationsDirectory, file);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n-- mutation\n`);
    },
  })),
  ...[...protectedPerfMigrations, ...protectedPerf06RMigrations].map(([file]): MutationProbe => ({
    name: `alterar bytes PERF-06 ${file}`,
    apply: (root) => {
      const path = join(root, migrationsDirectory, file);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n-- mutation\n`);
    },
  })),
  {
    name: "agregar migración post-PERF-06 sin ownership contractual",
    apply: (root) => {
      writeFileSync(
        join(root, migrationsDirectory, "20260816020744_unregistered_post_perf.sql"),
        "select 1;\n",
      );
    },
    expectedFailure: /\[PERF-06\.post-cutoff\.ownership-inventory\]/,
  },
  {
    name: "alterar migración post-PERF-06 registrada",
    apply: (root) => {
      const [migration] = postPerfMigrationFiles(root);
      assert.ok(migration, "probe requiere una migración post-PERF-06 registrada");
      const path = join(root, migrationsDirectory, migration);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n-- mutation\n`);
    },
    expectedFailure: /\[PERF-06\.post-cutoff\.ownership-hash\]/,
  },
  {
    name: "restaurar timestamp duplicado",
    apply: (root) => renameSync(
      join(root, migrationsDirectory, "20260527000002_training_sessions_source_of_truth.sql"),
      join(root, migrationsDirectory, "20260527000001_training_sessions_source_of_truth.sql"),
    ),
  },
  {
    name: "intercambiar orden dentro de una fecha",
    apply: (root) => {
      const first = join(root, migrationsDirectory, "20260706000001_profile_avatar_fields.sql");
      const second = join(root, migrationsDirectory, "20260706000002_profile_personal_fields.sql");
      const temporary = join(root, migrationsDirectory, "swap.tmp");
      renameSync(first, temporary);
      renameSync(second, first);
      renameSync(temporary, second);
    },
  },
  {
    name: "alterar contenido histórico",
    apply: (root) => {
      const path = join(root, migrationsDirectory, historicalMappings[0][1]);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n-- mutation\n`);
    },
  },
  {
    name: "omitir un mapping",
    apply: (root) => rmSync(join(root, migrationsDirectory, historicalMappings[3][1])),
  },
  {
    name: "quitar ownership y dejarlo sólo en string/comentario",
    apply: (root) => mutateCompensation(root, (source) => `${replaceExactlyOnce(source, "and r.user_id <> e.user_id", "and false")}\nselect 'and r.user_id <> e.user_id'; -- ownership aparente\n`),
  },
  {
    name: "quitar checks de referencias",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(
      replaceExactlyOnce(source, "join public.exercise_entries ee on ee.exercise_id = e.id", "join public.exercise_entries ee on false"),
      "on tce.source_legacy_exercise_id = e.id",
      "on false",
    )),
  },
  {
    name: "aceptar más de dos filas",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "not in (0, 2)", "not in (0, 2, 3)")),
  },
  {
    name: "agregar UPDATE",
    apply: (root) => mutateCompensation(root, (source) => `${source}\nupdate public.training_exercise_lineages set metadata = metadata;\n`),
  },
  {
    name: "agregar DELETE",
    apply: (root) => mutateCompensation(root, (source) => `${source}\ndelete from public.training_exercise_lineages where false;\n`),
  },
  {
    name: "modificar exercises entries y cycle exercises",
    apply: (root) => mutateCompensation(root, (source) => `${source}\nupdate public.exercises set name = name;\nupdate public.exercise_entries set notes = notes;\nupdate public.training_cycle_exercises set name = name;\n`),
  },
  {
    name: "quitar marker",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "'reconciliation', 'PERF-06R'", "'reconciliation', 'PERF-06X'")),
  },
  {
    name: "quitar postcheck",
    apply: (root) => mutateCompensation(root, removeCompensationPostcheck),
  },
  {
    name: "eliminar ON CONFLICT",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(
      source,
      "    on conflict (user_id, source_legacy_exercise_id)\n      where source_legacy_exercise_id is not null\n    do nothing;",
      "    ;",
    )),
  },
  {
    name: "introducir DROP de tabla diagnóstica",
    apply: (root) => mutateCompensation(root, (source) => `${source}\ndrop table public.training_session_consolidation_audit;\n`),
  },
  {
    name: "modificar PERF-06A/B/C",
    apply: (root) => {
      for (const [file] of protectedPerfMigrations) {
        const path = join(root, migrationsDirectory, file);
        writeFileSync(path, `${readFileSync(path, "utf8")}\n-- mutation\n`);
      }
    },
  },
  {
    name: "retirar rechazo de actor NULL",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "if v_actor_id is null or v_actor_id <> new.user_id then",
      "if v_actor_id <> new.user_id then",
    )),
  },
  {
    name: "aceptar actor NULL mediante condición adicional",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "if v_actor_id is null or v_actor_id <> new.user_id then",
      "if (v_actor_id is null or v_actor_id <> new.user_id) and v_actor_id is not null then",
    )),
  },
  {
    name: "rechazo de actor correcto sólo en comentario y string",
    apply: (root) => mutateInvariant(root, (source) => `${replaceExactlyOnce(
      source,
      "if v_actor_id is null or v_actor_id <> new.user_id then",
      "if false then",
    )}\n-- if v_actor_id is null or v_actor_id <> new.user_id then\nselect 'if v_actor_id is null or v_actor_id <> new.user_id then';\n`),
  },
  {
    name: "sustituir rechazo de actor por condición permisiva",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "if v_actor_id is null or v_actor_id <> new.user_id then",
      "if v_actor_id is not null and v_actor_id <> new.user_id then",
    )),
  },
  {
    name: "INSERT legacy con ownership cruzado",
    apply: (root) => mutateInvariantPolicy(root, "lineages own rows insert", (policy) => replaceExactlyOnce(
      policy,
      "and e.user_id = (select auth.uid())",
      "and true",
    )),
  },
  {
    name: "INSERT scoped con ownership cruzado",
    apply: (root) => mutateInvariantPolicy(root, "lineages own rows insert", (policy) => replaceExactlyOnce(
      policy,
      "and tce.user_id = (select auth.uid())",
      "and true",
    )),
  },
  {
    name: "permitir UPDATE de origin_kind",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      replaceExactlyOnce(
        source,
        "grant update (origin_training_cycle_exercise_id, updated_at)",
        "grant update (origin_training_cycle_exercise_id, updated_at, origin_kind)",
      ),
      "or new.origin_kind is distinct from old.origin_kind",
      "or false",
    )),
  },
  {
    name: "permitir UPDATE de source legacy",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      replaceExactlyOnce(
        source,
        "grant update (origin_training_cycle_exercise_id, updated_at)",
        "grant update (origin_training_cycle_exercise_id, updated_at, source_legacy_exercise_id)",
      ),
      "or new.source_legacy_exercise_id is distinct from old.source_legacy_exercise_id",
      "or false",
    )),
  },
  {
    name: "permitir cambiar origin scoped ya vinculado",
    apply: (root) => {
      mutateInvariantPolicy(root, "lineages own rows update", (policy) => replacePolicyClause(
        policy,
        "with check",
        "user_id = (select auth.uid())",
      ));
      mutateInvariant(root, (source) => replaceExactlyOnce(
        replaceExactlyOnce(source, "if old.origin_training_cycle_exercise_id is not null", "if old.origin_training_cycle_exercise_id is null"),
        "or not exists (",
        "or false and exists (",
      ));
    },
  },
  {
    name: "ampliar UPDATE a todas las columnas",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "grant update (origin_training_cycle_exercise_id, updated_at)",
      "grant update",
    )),
  },
  {
    name: "quitar WITH CHECK explícito de UPDATE",
    apply: (root) => mutateInvariantPolicy(root, "lineages own rows update", (policy) => {
      const mutated = policy.replace(/\n  with check \([\s\S]*\)\s*;$/, ";");
      assert.notEqual(mutated, policy, "WITH CHECK UPDATE retirado");
      return mutated;
    }),
  },
  {
    name: "reducir INSERT policy sólo a user_id auth.uid",
    apply: (root) => mutateInvariantPolicy(root, "lineages own rows insert", (policy) => replacePolicyClause(
      policy,
      "with check",
      "user_id = (select auth.uid())",
    )),
  },
  {
    name: "reintroducir grants completos",
    apply: (root) => mutateInvariant(root, (source) => `${source}\ngrant select, insert, update on table public.training_exercise_lineages to authenticated;\n`),
  },
  {
    name: "RLS relacional correcto sólo en comentario y string",
    apply: (root) => {
      mutateInvariantPolicy(root, "lineages own rows insert", (policy) => replacePolicyClause(policy, "with check", "true"));
      mutateInvariant(root, (source) => `${source}\n-- with check relacional para exercises y training_cycle_exercises\nselect 'origin_kind legacy scoped source_legacy_exercise_id origin_training_cycle_exercise_id auth.uid';\n`);
    },
  },
  {
    name: "crear trigger invariant antes del lock",
    apply: (root) => mutateInvariant(root, (source) => {
      const trigger = "create trigger exercises_ensure_legacy_lineage\n  after insert or update on public.exercises\n  for each row execute function public.ensure_legacy_exercise_lineage_invariant();";
      const withoutTrigger = replaceExactlyOnce(source, trigger, "");
      return replaceExactlyOnce(
        withoutTrigger,
        "lock table public.exercises in share row exclusive mode;",
        `${trigger}\n\nlock table public.exercises in share row exclusive mode;`,
      );
    }),
  },
  {
    name: "deshabilitar trigger invariant después de crearlo",
    apply: (root) => mutateInvariant(root, (source) => `${source}\nalter table public.exercises disable trigger exercises_ensure_legacy_lineage;\n`),
  },
  {
    name: "eliminar trigger invariant después de crearlo",
    apply: (root) => mutateInvariant(root, (source) => `${source}\ndrop trigger exercises_ensure_legacy_lineage on public.exercises;\n`),
  },
  {
    name: "mover precheck de catálogo antes del lock",
    apply: (root) => mutateCompensation(root, (source) => {
      const lock = "  lock table public.exercises in share row exclusive mode;\n";
      const withoutLock = replaceExactlyOnce(source, lock, "");
      return replaceExactlyOnce(
        withoutLock,
        "  if v_invariant_count <> 1 then",
        `${lock}\n  if v_invariant_count <> 1 then`,
      );
    }),
  },
  {
    name: "aceptar trigger deshabilitado en catálogo",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "and t.tgenabled = 'O'", "and t.tgenabled in ('O', 'D')")),
  },
  {
    name: "eliminar identidad del trigger en catálogo",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "and t.tgname = 'exercises_ensure_legacy_lineage'", "and t.tgname = t.tgname")),
  },
  {
    name: "cambiar función canónica en catálogo",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "and p.proname = 'ensure_legacy_exercise_lineage_invariant'", "and p.proname = 'shadow_lineage_invariant'")),
  },
  {
    name: "aceptar eventos timing o nivel incorrectos",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "and t.tgtype = 21", "and t.tgtype in (21, 5, 17)")),
  },
  {
    name: "precheck correcto sólo en comentario y string",
    apply: (root) => mutateCompensation(root, (source) => `${replaceExactlyOnce(
      source,
      "and t.tgname = 'exercises_ensure_legacy_lineage'",
      "and false",
    )}\n-- and t.tgname = 'exercises_ensure_legacy_lineage'\nselect 't.tgtype = 21 and t.tgenabled = O';\n`),
  },
  {
    name: "alterar hash de repository.ts",
    apply: (root) => {
      const path = join(root, productRepository);
      writeFileSync(path, `${readFileSync(path, "utf8")}\n// mutation\n`);
    },
  },
  {
    name: "eliminar trigger invariant",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "create trigger exercises_ensure_legacy_lineage\n  after insert or update on public.exercises\n  for each row execute function public.ensure_legacy_exercise_lineage_invariant();",
      "-- trigger invariant removed",
    )),
  },
  {
    name: "mover trigger después de compensatoria",
    apply: (root) => {
      const current = invariantFile(root);
      renameSync(
        join(root, migrationsDirectory, current),
        join(root, migrationsDirectory, "20260811035543_ensure_legacy_exercise_lineage_invariant.sql"),
      );
    },
  },
  {
    name: "trigger sólo AFTER UPDATE",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(source, "after insert or update on public.exercises", "after update on public.exercises")),
  },
  {
    name: "trigger sólo AFTER INSERT",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(source, "after insert or update on public.exercises", "after insert on public.exercises")),
  },
  {
    name: "convertir trigger a BEFORE",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(source, "after insert or update on public.exercises", "before insert or update on public.exercises")),
  },
  {
    name: "convertir función a SECURITY DEFINER",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "create function public.ensure_legacy_exercise_lineage_invariant()\nreturns trigger\nlanguage plpgsql\nsecurity invoker",
      "create function public.ensure_legacy_exercise_lineage_invariant()\nreturns trigger\nlanguage plpgsql\nsecurity definer",
    )),
  },
  {
    name: "eliminar search_path fijo",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "create function public.ensure_legacy_exercise_lineage_invariant()\nreturns trigger\nlanguage plpgsql\nsecurity invoker\nset search_path = pg_catalog",
      "create function public.ensure_legacy_exercise_lineage_invariant()\nreturns trigger\nlanguage plpgsql\nsecurity invoker\n-- search_path removed",
    )),
  },
  {
    name: "aceptar actor distinto",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(
      source,
      "if v_actor_id is null or v_actor_id <> new.user_id then",
      "if v_actor_id is null then",
    )),
  },
  {
    name: "eliminar ownership de rutina",
    apply: (root) => mutateInvariant(root, (source) => replaceExactlyOnce(source, "and r.user_id = new.user_id", "and true")),
  },
  {
    name: "conceder EXECUTE directo",
    apply: (root) => mutateInvariant(root, (source) => `${source}\ngrant execute on function public.ensure_legacy_exercise_lineage_invariant() to authenticated;\n`),
  },
  {
    name: "permitir más de un lineage compatible",
    apply: (root) => mutateInvariant(root, (source) => replaceLast(
      source,
      "  if v_compatible_count <> 1 then",
      "  if v_compatible_count < 1 then",
    )),
  },
  {
    name: "retirar postcondición invariant",
    apply: (root) => mutateInvariant(root, (source) => replaceLast(
      source,
      "  if v_compatible_count <> 1 then",
      "  if false and v_compatible_count <> 1 then",
    )),
  },
  {
    name: "compensatoria sin precheck invariant",
    apply: (root) => mutateCompensation(root, (source) => replaceExactlyOnce(source, "if v_invariant_count <> 1 then", "if false then")),
  },
  {
    name: "trigger correcto sólo en comentario y string",
    apply: (root) => mutateInvariant(root, (source) => `${replaceExactlyOnce(
      source,
      "create trigger exercises_ensure_legacy_lineage",
      "create trigger exercises_shadow_lineage",
    )}\n-- create trigger exercises_ensure_legacy_lineage after insert or update on public.exercises\nselect 'create trigger exercises_ensure_legacy_lineage after insert or update on public.exercises for each row';\n`),
  },
  {
    name: "desconectar contrato de npm test",
    apply: (root) => {
      const path = join(root, "package.json");
      const source = readFileSync(path, "utf8");
      writeFileSync(path, replaceExactlyOnce(
        source,
        "src/lib/server/perf-06-history-reconciliation-contract.test.ts",
        "src/lib/server/perf-06-history-reconciliation-contract.disabled.ts",
      ));
    },
  },
];

validateFixture(repositoryRoot);
validateGlobalTestRegistry();
validateRunnerExternalCliProbes(repositoryRoot);
validateIncidentVerifierBehavior(repositoryRoot);

const canonicalSha = canonicalSourcesSha();
for (const probe of mutationProbes) {
  const fixture = copyFixture();
  try {
    validateFixture(fixture);
    const baselineSha = fixtureSha(fixture);
    probe.apply(fixture);
    assert.notEqual(fixtureSha(fixture), baselineSha, `${probe.name}: mutación efectiva sobre baseline nuevo`);
    for (const file of migrationFiles(fixture)) {
      assertLexicallyValidSql(read(fixture, join(migrationsDirectory, file)), `${probe.name}: ${file}`);
    }
    if (probe.expectedFailure) {
      assert.throws(
        () => validateFixture(fixture),
        probe.expectedFailure,
        `${probe.name}: debe morir por su aserción semántica propia`,
      );
    } else assert.throws(() => validateFixture(fixture), `${probe.name}: fallo semántico obligatorio`);
  } finally {
    assert.equal(canonicalSourcesSha(), canonicalSha, `${probe.name}: SHA-256 canónico restaurado/intacto`);
    rmSync(fixture, { recursive: true, force: true });
    assert.equal(existsSync(fixture), false, `${probe.name}: temporales eliminados`);
  }
}

console.log(`PERF-06R history reconciliation contract passed: ${historicalMappings.length} mappings; ${mutationProbes.length} mutation probes killed`);
