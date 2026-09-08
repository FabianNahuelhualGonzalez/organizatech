import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260829200846_cycle_redesign_schema.sql":
    "fc6b89d7f610a2a188a2b2f98b3971325aabdaaf8868c1dda7c9c7c1057aa681",
  "20260829200847_cycle_redesign_api.sql":
    "5a27383ded59ba3f54dfdda4fa01f92fea96f5b902939bff55d10a1ba1215141",
  "20260831213114_cycle_active_replacement.sql":
    "9f286e415cfaa431ba319365ac5f3669525419cca243148370167d5d03b592bd",
  "20260831230440_cycle_active_atomic_replacement.sql":
    "a535070b9cabc74e119fae09262d00ad8b12c1072c1ab1be431fdb6821033848",
  "20260831233757_cycle_active_replacement_snapshot_response.sql":
    "06b0d6cebc52d24a0099e8c24848709a4aa38c58f9b208fd0dcfa64837c1c372",
  "20260901002250_cycle_active_replacement_exercise_descriptors.sql":
    "7a2933c53a81d404af97a8108baf018bc28517e1cc772fddac92916323489c64",
  "20260905201420_cycle_legacy_compatibility_expiry_youtube.sql":
    "3368b40c2dcac88a484a3a826daa7f45c56d771324419f3e104400c82dbc6b65",
} as const;

const schemaPath =
  "supabase/migrations/20260829200846_cycle_redesign_schema.sql";
const apiPath =
  "supabase/migrations/20260829200847_cycle_redesign_api.sql";
const activeReplacementPath =
  "supabase/migrations/20260831213114_cycle_active_replacement.sql";
const activeReplacementDbTestPath =
  "supabase/tests/20260831213114_cycle_active_replacement_test.sql";
const activeAtomicReplacementPath =
  "supabase/migrations/20260831230440_cycle_active_atomic_replacement.sql";
const activeReplacementSnapshotPath =
  "supabase/migrations/20260831233757_cycle_active_replacement_snapshot_response.sql";
const activeReplacementDescriptorsPath =
  "supabase/migrations/20260901002250_cycle_active_replacement_exercise_descriptors.sql";
const legacyCompatibilityPath =
  "supabase/migrations/20260905201420_cycle_legacy_compatibility_expiry_youtube.sql";
const legacyCompatibilityDbTestPath =
  "supabase/tests/20260905201420_cycle_legacy_compatibility_expiry_youtube_test.sql";
const activeReplacementBootstrapPath =
  "supabase/tests/support/cycle_active_replacement_embedded_bootstrap.sql";
const activeReplacementRunnerPath =
  "supabase/tests/support/run_cycle_active_replacement_embedded_postgres.sh";
const coachContractPath =
  "src/features/coach-portal/coach-portal-integration-contract.ts";
const supabaseConfigPath = "supabase/config.toml";
const lifecycleWorkerPath =
  "supabase/functions/process-training-cycle-lifecycle/handler.ts";
const lifecycleWorkerIndexPath =
  "supabase/functions/process-training-cycle-lifecycle/index.ts";
const lifecycleTemplatePath =
  "supabase/functions/_shared/training-cycle-lifecycle/templates.ts";

const schema = readFileSync(schemaPath, "utf8");
const api = readFileSync(apiPath, "utf8");
const activeReplacement = readFileSync(activeReplacementPath, "utf8");
const activeReplacementDbTest = readFileSync(activeReplacementDbTestPath, "utf8");
const activeAtomicReplacement = readFileSync(activeAtomicReplacementPath, "utf8");
const activeReplacementSnapshot = readFileSync(activeReplacementSnapshotPath, "utf8");
const activeReplacementDescriptors = readFileSync(activeReplacementDescriptorsPath, "utf8");
const legacyCompatibility = readFileSync(legacyCompatibilityPath, "utf8");
const legacyCompatibilityDbTest = readFileSync(legacyCompatibilityDbTestPath, "utf8");
const activeReplacementBootstrap = readFileSync(activeReplacementBootstrapPath, "utf8");
const activeReplacementRunner = readFileSync(activeReplacementRunnerPath, "utf8");
const coachContract = readFileSync(coachContractPath, "utf8");
const supabaseConfig = readFileSync(supabaseConfigPath, "utf8");
const lifecycleWorker = readFileSync(lifecycleWorkerPath, "utf8");
const lifecycleWorkerIndex = readFileSync(lifecycleWorkerIndexPath, "utf8");
const lifecycleTemplate = readFileSync(lifecycleTemplatePath, "utf8");

const normalize = (source: string) =>
  source.toLowerCase().replaceAll(/\s+/g, " ").trim();

const schemaSql = normalize(schema);
const apiSql = normalize(api);
const activeReplacementSql = normalize(activeReplacement);
const activeReplacementDbTestSql = normalize(activeReplacementDbTest);
const activeAtomicReplacementSql = normalize(activeAtomicReplacement);
const activeReplacementSnapshotSql = normalize(activeReplacementSnapshot);
const legacyCompatibilitySql = normalize(legacyCompatibility);
const legacyCompatibilityDbTestSql = normalize(legacyCompatibilityDbTest);

const sha256 = (source: string) =>
  createHash("sha256").update(source).digest("hex");

const publicRpcNames = [
  "list_own_training_exercise_catalog",
  "create_own_training_custom_exercise",
  "create_own_training_cycle_draft",
  "get_own_training_cycle_draft",
  "save_own_training_cycle_draft",
  "discard_own_training_cycle_draft",
  "duplicate_own_training_cycle_to_draft",
  "renew_own_closed_training_cycle_to_draft",
  "activate_own_training_cycle_draft",
  "edit_own_active_training_cycle",
  "extend_own_active_training_cycle",
  "record_own_training_cycle_execution",
  "refresh_own_training_cycle_lifecycle",
  "get_own_training_cycle",
  "get_own_active_training_cycle",
  "list_own_training_cycles",
  "list_own_training_cycle_versions",
  "get_own_training_cycle_version",
  "list_own_training_cycle_notifications",
  "mark_own_training_cycle_notifications_read",
] as const;

const privateTables = [
  "training_exercise_catalog",
  "training_custom_exercises",
  "training_cycle_drafts",
  "training_cycle_draft_versions",
  "training_cycle_plan_versions",
  "training_cycle_plan_days",
  "training_cycle_plan_exercises",
  "training_cycle_plan_sets",
  "training_cycle_plan_drops",
  "training_cycle_notifications",
  "training_cycle_executions",
  "training_cycle_execution_exercises",
  "training_cycle_execution_sets",
  "training_cycle_execution_drops",
] as const;

const idempotentMutationFunctions = [
  ["private.create_training_cycle_draft_record", 2],
  ["public.create_own_training_custom_exercise", 2],
  ["public.save_own_training_cycle_draft", 2],
  ["public.discard_own_training_cycle_draft", 2],
  ["public.duplicate_own_training_cycle_to_draft", 1],
  ["public.renew_own_closed_training_cycle_to_draft", 1],
  ["public.activate_own_training_cycle_draft", 2],
  ["public.edit_own_active_training_cycle", 2],
  ["public.extend_own_active_training_cycle", 2],
  ["public.record_own_training_cycle_execution", 2],
  ["public.mark_own_training_cycle_notifications_read", 2],
] as const;

function extractFunction(source: string, qualifiedName: string): string {
  const lower = source.toLowerCase();
  const start = lower.indexOf(`create function ${qualifiedName.toLowerCase()}(`);
  assert.notEqual(start, -1, `missing function ${qualifiedName}`);

  const bodyStart = lower.indexOf("as $function$", start);
  assert.notEqual(bodyStart, -1, `missing body for ${qualifiedName}`);
  const end = lower.indexOf("$function$;", bodyStart + "as $function$".length);
  assert.notEqual(end, -1, `unterminated body for ${qualifiedName}`);
  return source.slice(start, end + "$function$;".length);
}

function countOccurrences(source: string, fragment: string): number {
  return source.split(fragment).length - 1;
}

function validateLegacyTrainingCycleWriteBoundary(candidateSchema: string) {
  const normalizedSchema = normalize(candidateSchema);
  const guard = normalize(
    extractFunction(candidateSchema, "private.guard_training_cycle_legacy_write"),
  );

  assert.match(guard, /security invoker/);
  assert.match(guard, /set search_path = ''/);
  assert.match(guard, /v_actor_id uuid := auth\.uid\(\)/);
  assert.match(
    guard,
    /v_is_direct_client boolean := current_user::pg_catalog\.text in \( 'anon', 'authenticated', 'service_role' \)/,
  );
  assert.match(
    guard,
    /if tg_op = 'insert' and v_actor_id is null then raise exception 'training cycle ownership denied'/,
  );
  assert.match(
    guard,
    /if v_is_direct_client then if v_actor_id is null or new\.user_id is distinct from v_actor_id then raise exception 'training cycle ownership denied'/,
  );
  assert.match(guard, /new\.user_id := v_actor_id/);
  assert.match(guard, /new\.portal_scope := 'usuario'/);
  assert.match(guard, /legacy training cycle writes require usuario portal/);
  assert.match(
    guard,
    /elsif v_actor_id is not null and new\.user_id is distinct from v_actor_id then raise exception 'training cycle ownership denied'/,
  );
  assert.match(
    guard,
    /char_length\(pg_catalog\.btrim\(new\.name\)\) not between 1 and 120/,
  );
  assert.match(guard, /new\.cycle_number not between 1 and 1000000/);
  assert.match(guard, /new\.duration_weeks not between 1 and 105/);
  assert.match(
    guard,
    /new\.planned_end_date - new\.planned_start_date > 730/,
  );
  assert.match(
    guard,
    /octet_length\(new\.plan_snapshot::pg_catalog\.text\) > 262144(?: or|\))/,
  );
  assert.match(
    guard,
    /octet_length\(new\.summary_snapshot::pg_catalog\.text\) > 262144(?: or| \))/,
  );
  assert.equal(
    countOccurrences(
      guard,
      "pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 262144",
    ),
    2,
  );
  assert.equal(
    countOccurrences(
      guard,
      "pg_catalog.octet_length(new.summary_snapshot::pg_catalog.text) > 262144",
    ),
    2,
  );
  assert.match(
    guard,
    /new\.plan_snapshot is distinct from old\.plan_snapshot/,
  );
  assert.match(
    guard,
    /new\.summary_snapshot is distinct from old\.summary_snapshot/,
  );

  const resourceBoundary = guard.slice(
    guard.indexOf("if pg_catalog.octet_length(new.plan_snapshot"),
  );
  assert.match(resourceBoundary, /if tg_op = 'insert' then/);
  assert.match(resourceBoundary, /pg_advisory_xact_lock/);
  assert.match(resourceBoundary, /'organizatech:cycle-redesign:'/);
  assert.match(resourceBoundary, /cycle\.user_id = new\.user_id/);
  assert.match(resourceBoundary, /cycle\.portal_scope = new\.portal_scope/);
  assert.match(resourceBoundary, /offset 999 limit 1/);
  assert.match(resourceBoundary, /training cycle limit reached/);

  assert.match(
    normalizedSchema,
    /create trigger training_cycles_guard_legacy_write before insert or update on public\.training_cycles/,
  );
  assert.match(
    normalizedSchema,
    /revoke all on function private\.guard_training_cycle_legacy_write\(\) from public, anon, authenticated, service_role/,
  );
  assert.match(
    normalizedSchema,
    /grant insert \( user_id, name, cycle_number,[\s\S]+?\) on table public\.training_cycles to authenticated/,
  );
  assert.match(
    normalizedSchema,
    /alter table public\.training_cycles force row level security/,
  );
}

function validateIdempotentMutationResults(candidateApi: string) {
  const normalizedApi = normalize(candidateApi);
  const operationResult = normalize(
    extractFunction(candidateApi, "private.training_cycle_operation_result"),
  );

  assert.match(operationResult, /language sql immutable security invoker/);
  assert.match(operationResult, /set search_path = ''/);
  assert.match(operationResult, /'responsekind', 'accepted_operation'/);
  assert.match(operationResult, /'requestid', p_request_id/);
  assert.match(operationResult, /'operationkind', p_operation_kind/);
  assert.match(operationResult, /'aggregateid', p_aggregate_id/);
  assert.match(operationResult, /'resultversion', p_result_version/);
  assert.doesNotMatch(
    operationResult,
    /clock_timestamp|statement_timestamp|\bnow\s*\(|from public\.|from private\./,
  );
  assert.match(
    normalizedApi,
    /revoke all on function private\.training_cycle_operation_result\( uuid, text, uuid, integer \) from public, anon, authenticated, service_role/,
  );

  for (const [qualifiedName, expectedResultCalls] of idempotentMutationFunctions) {
    const definition = normalize(extractFunction(candidateApi, qualifiedName));
    assert.equal(
      countOccurrences(definition, "private.training_cycle_operation_result("),
      expectedResultCalls,
      `${qualifiedName} has stable first-call/replay acknowledgements`,
    );
    assert.doesNotMatch(
      definition,
      /return private\.training_cycle_(?:draft_)?snapshot_json\(/,
      `${qualifiedName} cannot return mutable current state`,
    );
  }

  const replayContracts = [
    [
      "private.create_training_cycle_draft_record",
      /if v_draft_id is not null then return private\.training_cycle_operation_result\( p_request_id, p_receipt_operation, v_draft_id, v_receipt_version \); end if/,
    ],
    [
      "public.create_own_training_custom_exercise",
      /if v_custom_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'custom_exercise_create', v_custom_id, v_receipt_version \); end if/,
    ],
    [
      "public.save_own_training_cycle_draft",
      /if v_receipt_draft_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'draft_save', v_receipt_draft_id, v_receipt_version \); end if/,
    ],
    [
      "public.discard_own_training_cycle_draft",
      /if v_receipt_draft_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'draft_discard', v_receipt_draft_id, v_receipt_version \); end if/,
    ],
    [
      "public.duplicate_own_training_cycle_to_draft",
      /if v_receipt_draft_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'draft_duplicate', v_receipt_draft_id, v_receipt_version \); end if/,
    ],
    [
      "public.renew_own_closed_training_cycle_to_draft",
      /if v_receipt_draft_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'draft_renewal', v_receipt_draft_id, v_receipt_version \); end if/,
    ],
    [
      "public.activate_own_training_cycle_draft",
      /if v_receipt_cycle_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'cycle_activate', v_receipt_cycle_id, v_receipt_version \); end if/,
    ],
    [
      "public.edit_own_active_training_cycle",
      /if v_receipt_cycle_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'cycle_edit', v_receipt_cycle_id, v_receipt_version \); end if/,
    ],
    [
      "public.extend_own_active_training_cycle",
      /if v_receipt_cycle_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'cycle_extend', v_receipt_cycle_id, v_receipt_version \); end if/,
    ],
    [
      "public.record_own_training_cycle_execution",
      /if v_receipt_execution_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'cycle_execution_record', v_receipt_execution_id, v_receipt_version \); end if/,
    ],
    [
      "public.mark_own_training_cycle_notifications_read",
      /if v_receipt_id is not null then return private\.training_cycle_operation_result\( p_request_id, 'notifications_mark_read', v_receipt_id, v_receipt_version \); end if/,
    ],
  ] as const;

  for (const [qualifiedName, replayPattern] of replayContracts) {
    assert.match(normalize(extractFunction(candidateApi, qualifiedName)), replayPattern);
  }

  const firstCallContracts = [
    [
      "private.create_training_cycle_draft_record",
      /return private\.training_cycle_operation_result\( p_request_id, p_receipt_operation, v_draft_id, 1 \); end;/,
    ],
    [
      "public.create_own_training_custom_exercise",
      /return private\.training_cycle_operation_result\( p_request_id, 'custom_exercise_create', v_custom_id, null \); end;/,
    ],
    [
      "public.save_own_training_cycle_draft",
      /return private\.training_cycle_operation_result\( p_request_id, 'draft_save', v_draft\.id, v_new_version \); end;/,
    ],
    [
      "public.discard_own_training_cycle_draft",
      /return private\.training_cycle_operation_result\( p_request_id, 'draft_discard', v_draft\.id, v_draft\.current_version \); end;/,
    ],
    [
      "public.activate_own_training_cycle_draft",
      /return private\.training_cycle_operation_result\( p_request_id, 'cycle_activate', v_cycle_id, 1 \); end;/,
    ],
    [
      "public.edit_own_active_training_cycle",
      /return private\.training_cycle_operation_result\( p_request_id, 'cycle_edit', v_cycle\.id, v_new_version \); end;/,
    ],
    [
      "public.extend_own_active_training_cycle",
      /return private\.training_cycle_operation_result\( p_request_id, 'cycle_extend', v_cycle\.id, v_new_version \); end;/,
    ],
    [
      "public.record_own_training_cycle_execution",
      /return private\.training_cycle_operation_result\( p_request_id, 'cycle_execution_record', v_execution_id, v_plan_version\.version \); end;/,
    ],
    [
      "public.mark_own_training_cycle_notifications_read",
      /return private\.training_cycle_operation_result\( p_request_id, 'notifications_mark_read', p_request_id, null \); end;/,
    ],
  ] as const;

  for (const [qualifiedName, firstCallPattern] of firstCallContracts) {
    assert.match(normalize(extractFunction(candidateApi, qualifiedName)), firstCallPattern);
  }

  for (const [qualifiedName, operationKind] of [
    ["public.create_own_training_cycle_draft", "draft_create"],
    ["public.duplicate_own_training_cycle_to_draft", "draft_duplicate"],
    ["public.renew_own_closed_training_cycle_to_draft", "draft_renewal"],
  ] as const) {
    const definition = normalize(extractFunction(candidateApi, qualifiedName));
    assert.match(definition, /return private\.create_training_cycle_draft_record\(/);
    assert.match(definition, new RegExp(`'${operationKind}'`));
  }

  for (const qualifiedName of [
    "public.duplicate_own_training_cycle_to_draft",
    "public.renew_own_closed_training_cycle_to_draft",
  ]) {
    const definition = normalize(extractFunction(candidateApi, qualifiedName));
    assert.ok(
      definition.indexOf("from private.find_training_cycle_receipt(")
        < definition.indexOf("select version.*"),
      `${qualifiedName} resolves replay before re-reading a mutable source`,
    );
    assert.ok(
      definition.indexOf("private.lock_training_cycle_portal(")
        < definition.indexOf("from private.find_training_cycle_receipt("),
      `${qualifiedName} preserves portal-to-request lock ordering`,
    );
  }
}

function validateCoachMigrationAllowlist(candidateCoachContract: string) {
  const normalized = normalize(candidateCoachContract);
  const schemaMigration =
    "supabase/migrations/20260829200846_cycle_redesign_schema.sql";
  const apiMigration =
    "supabase/migrations/20260829200847_cycle_redesign_api.sql";
  const activeReplacementMigration =
    "supabase/migrations/20260831213114_cycle_active_replacement.sql";
  const activeAtomicReplacementMigration =
    "supabase/migrations/20260831230440_cycle_active_atomic_replacement.sql";
  const activeReplacementSnapshotMigration =
    "supabase/migrations/20260831233757_cycle_active_replacement_snapshot_response.sql";
  const activeReplacementDescriptorsMigration =
    "supabase/migrations/20260901002250_cycle_active_replacement_exercise_descriptors.sql";
  const legacyCompatibilityMigration =
    "supabase/migrations/20260905201420_cycle_legacy_compatibility_expiry_youtube.sql";

  assert.equal(countOccurrences(candidateCoachContract, schemaMigration), 1);
  assert.equal(countOccurrences(candidateCoachContract, apiMigration), 1);
  assert.equal(countOccurrences(candidateCoachContract, activeReplacementMigration), 1);
  assert.equal(countOccurrences(candidateCoachContract, activeAtomicReplacementMigration), 1);
  assert.equal(countOccurrences(candidateCoachContract, activeReplacementSnapshotMigration), 1);
  assert.equal(countOccurrences(candidateCoachContract, activeReplacementDescriptorsMigration), 1);
  assert.equal(countOccurrences(candidateCoachContract, legacyCompatibilityMigration), 1);
  assert.match(
    normalized,
    /const cycle_redesign_schema_migration_path = "supabase\/migrations\/20260829200846_cycle_redesign_schema\.sql"/,
  );
  assert.match(
    normalized,
    /const cycle_redesign_api_migration_path = "supabase\/migrations\/20260829200847_cycle_redesign_api\.sql"/,
  );
  assert.match(
    normalized,
    /const cycle_active_replacement_migration_path = "supabase\/migrations\/20260831213114_cycle_active_replacement\.sql"/,
  );
  assert.match(
    normalized,
    /const cycle_active_atomic_replacement_migration_path = "supabase\/migrations\/20260831230440_cycle_active_atomic_replacement\.sql"/,
  );
  assert.match(
    normalized,
    /const cycle_active_replacement_snapshot_migration_path = "supabase\/migrations\/20260831233757_cycle_active_replacement_snapshot_response\.sql"/,
  );
  assert.match(
    normalized,
    /const cycle_active_replacement_descriptors_migration_path = "supabase\/migrations\/20260901002250_cycle_active_replacement_exercise_descriptors\.sql"/,
  );
  assert.match(
    normalized,
    /const cycle_legacy_compatibility_migration_path = "supabase\/migrations\/20260905201420_cycle_legacy_compatibility_expiry_youtube\.sql"/,
  );
  assert.match(
    normalized,
    /path !== cycle_redesign_schema_migration_path && path !== cycle_redesign_api_migration_path && path !== cycle_active_replacement_migration_path && path !== cycle_active_atomic_replacement_migration_path && path !== cycle_active_replacement_snapshot_migration_path && path !== cycle_active_replacement_descriptors_migration_path && path !== cycle_legacy_compatibility_migration_path/,
  );
  assert.doesNotMatch(
    normalized,
    /path\.(?:includes|endswith|match)\([^)]*cycle[_-]redesign|cycle[_-]redesign[^)]*\*|path\.startswith\("supabase\/migrations\/20260829/,
  );
}

function validateSecurityContract(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);

  assert.match(
    normalizedSchema,
    /create unique index training_cycles_one_active_per_identity_portal_idx on public\.training_cycles\(user_id, portal_scope\) where status = 'active' and deleted_at is null/,
  );
  assert.match(
    normalizedSchema,
    /revoke insert, update on table public\.training_cycles from authenticated/,
  );
  assert.match(
    normalizedSchema,
    /create trigger training_exercise_lineages_guard_redesign_source_write before insert or update or delete on public\.training_exercise_lineages/,
  );
  assert.match(
    normalizedSchema,
    /training exercise redesign source is server assigned/,
  );

  for (const table of privateTables) {
    assert.match(
      normalizedSchema,
      new RegExp(`alter table public\\.${table} enable row level security`),
      `${table} enables RLS`,
    );
    assert.match(
      normalizedSchema,
      new RegExp(`alter table public\\.${table} force row level security`),
      `${table} forces RLS`,
    );
    assert.match(
      normalizedSchema,
      new RegExp(
        `revoke all privileges on table public\\.${table} from public, anon, authenticated, service_role`,
      ),
      `${table} has no direct application grants`,
    );
  }

  for (const rpcName of publicRpcNames) {
    const definition = normalize(
      extractFunction(candidateApi, `public.${rpcName}`),
    );
    assert.match(definition, /security definer/, `${rpcName} is definer`);
    assert.match(definition, /set search_path = ''/, `${rpcName} pins search_path`);
    assert.match(definition, /auth\.uid\(\)/, `${rpcName} derives ownership`);
    assert.match(
      normalizedApi,
      new RegExp(
        `grant execute on function public\\.${rpcName}\\([^;]+\\) to authenticated`,
      ),
      `${rpcName} is authenticated-only`,
    );
    assert.match(
      normalizedApi,
      new RegExp(
        `revoke all on function public\\.${rpcName}\\([^;]+\\) from public, anon, authenticated, service_role`,
      ),
      `${rpcName} revokes default and privileged application execution`,
    );
  }

  assert.match(
    normalizedApi,
    /p_user_id is null or p_user_id is distinct from auth\.uid\(\)/,
  );
  assert.match(normalizedApi, /or p_portal_scope is null or p_portal_scope not in/);
  assert.match(normalizedApi, /from public\.user_registrations as registration/);
  assert.match(normalizedApi, /from public\.coach_registrations as registration/);
  assert.match(normalizedApi, /cycle-redesign rows require the versioned api/);
  assert.match(normalizedApi, /v_old_cycle_id := old\.cycle_id/);
  assert.match(normalizedApi, /v_new_cycle_id := new\.cycle_id/);
  assert.match(
    normalizedApi,
    /before update or delete on public\.training_cycles/,
  );
  for (const table of [
    "training_cycle_routines",
    "training_cycle_days",
    "training_cycle_exercises",
  ]) {
    assert.match(
      normalizedApi,
      new RegExp(`before insert or update or delete on public\\.${table}`),
    );
  }
}

function validatePayloadContract(candidateApi: string) {
  const normalizedApi = normalize(candidateApi);
  const normalized = normalize(
    extractFunction(candidateApi, "private.validate_training_cycle_plan"),
  );

  assert.match(normalized, /octet_length\(p_plan::pg_catalog\.text\) > 262144/);
  assert.match(normalized, /jsonb_array_length\(p_plan->'days'\) not between 1 and 7/);
  assert.match(normalized, /jsonb_array_length\(v_day->'exercises'\) > 50/);
  assert.match(normalized, /v_total_exercises > 200/);
  assert.match(normalized, /jsonb_array_length\(v_exercise->'sets'\) not between 1 and 20/);
  assert.match(normalized, /v_total_sets > 2000/);
  assert.match(normalized, /jsonb_array_length\(v_set->'drops'\) > 8/);
  assert.match(normalized, /v_total_drops > 4000 or/);
  assert.match(normalized, /exactly one training exercise source is required/);
  assert.match(normalized, /drops require drop_set technique/);
  assert.match(normalized, /drop_set requires at least one drop/);

  assert.match(
    normalized,
    /v_day - array\['day', 'name', 'order', 'exercises'\]::text\[\] <> '\{\}'::jsonb/,
  );
  assert.match(
    normalized,
    /v_exercise - array\[ 'catalogexerciseid', 'customexerciseid', 'order', 'technique', 'videourl', 'sets' \]::text\[\] <> '\{\}'::jsonb/,
  );
  assert.match(
    normalized,
    /v_set - array\['order', 'targetreps', 'targetkg', 'tofailure', 'drops'\]::text\[\] <> '\{\}'::jsonb/,
  );
  assert.match(
    normalized,
    /v_drop - array\['order', 'kg', 'reps'\]::text\[\] <> '\{\}'::jsonb/,
  );

  for (const goal of ["strength", "volume", "definition", "deload"]) {
    assert.match(normalizedApi, new RegExp(`'${goal}'`));
  }
  for (const weekday of [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]) {
    assert.match(normalized, new RegExp(`'${weekday}'`));
  }
  for (const technique of [
    "linear",
    "ascending",
    "descending",
    "drop_set",
    "failure",
  ]) {
    assert.match(normalized, new RegExp(`'${technique}'`));
  }
}

function validateConcurrencyContract(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);

  assert.match(normalizedApi, /extensions\.digest\(/);
  assert.match(normalizedApi, /'sha256'/);
  assert.match(normalizedApi, /request_id payload mismatch/);
  assert.match(normalizedApi, /pg_advisory_xact_lock/);
  assert.match(normalizedApi, /cycle-redesign:request:/);
  assert.match(normalizedApi, /offset 4095 limit 1/);
  assert.match(normalizedApi, /offset 511 limit 1/);
  assert.match(normalizedApi, /offset 199 limit 1/);
  assert.match(normalizedApi, /offset 999 limit 1/);
  assert.match(normalizedApi, /current_version >= 256/);
  assert.match(normalizedApi, /current_plan_version >= 256/);
  assert.match(normalizedApi, /current_plan_version is distinct from p_expected_version/);
  assert.match(normalizedApi, /current_version is distinct from p_expected_version/);

  assert.match(
    normalizedSchema,
    /primary key \(user_id, request_id\)/,
  );
  assert.match(normalizedSchema, /check \(octet_length\(payload_hash\) = 32\)/);
  assert.match(
    normalizedSchema,
    /training_cycle_drafts_one_open_per_identity_portal_idx/,
  );
  assert.match(
    normalizedSchema,
    /training_cycle_plan_versions_cycle_version_key unique \(cycle_id, version\)/,
  );
}

function validateLifecycleContract(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);
  const combined = `${candidateSchema}\n${candidateApi}`;

  for (const event of [
    "expires_t3",
    "expires_t2",
    "expires_t1",
    "expires_t0",
    "closed_t1",
  ]) {
    assert.match(normalizedSchema, new RegExp(`'${event}'`));
    assert.match(normalizedApi, new RegExp(`'${event}'`));
  }
  assert.match(normalizedSchema, /scheduled_on = end_date_snapshot - 3/);
  assert.match(normalizedSchema, /scheduled_on = end_date_snapshot - 2/);
  assert.match(normalizedSchema, /scheduled_on = end_date_snapshot - 1/);
  assert.match(normalizedSchema, /scheduled_on = end_date_snapshot\)/);
  assert.match(normalizedSchema, /scheduled_on = end_date_snapshot \+ 1/);

  assert.match(normalizedApi, /from public\.training_workout_readiness as readiness/);
  assert.match(
    normalizedApi,
    /before insert on public\.training_workout_readiness/,
  );
  assert.match(normalizedApi, /training readiness ownership denied/);
  assert.match(normalizedApi, /private\.lock_training_cycle_portal\(new\.user_id, v_portal_scope\)/);
  assert.match(normalizedApi, /v_cycle\.planned_end_date < v_today/);
  assert.match(normalizedApi, /readiness\.training_session_id is null/);
  assert.match(normalizedApi, /readiness\.payload->>'skipped' = 'false'/);
  assert.match(normalizedApi, /p_now - interval '36 hours'/);
  assert.match(normalizedApi, /v_cycle\.planned_end_date >= v_today/);
  assert.match(normalizedApi, /status = 'completed'/);
  assert.match(normalizedApi, /closed_reason = 'expired'/);

  assert.doesNotMatch(
    combined,
    /\b(?:alter\s+table|insert\s+into|update|delete\s+from)\s+public\.(?:training_sessions|exercise_entries)\b/i,
  );
}

function validateSnapshotContract(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);

  for (const table of [
    "training_cycle_plan_versions",
    "training_cycle_plan_days",
    "training_cycle_plan_exercises",
    "training_cycle_plan_sets",
    "training_cycle_plan_drops",
  ]) {
    assert.match(normalizedSchema, new RegExp(`create table public\\.${table}`));
  }
  assert.match(normalizedSchema, /source_version_id uuid null/);
  assert.match(normalizedSchema, /name_snapshot text not null/);
  assert.match(normalizedSchema, /muscle_group_snapshot text not null/);
  assert.match(normalizedSchema, /video_url_snapshot text null/);
  assert.match(normalizedSchema, /target_reps smallint not null/);
  assert.match(normalizedSchema, /to_failure boolean not null/);
  assert.match(normalizedSchema, /training_cycle_plan_drops_set_version_exercise_owner_fk/);
  assert.match(normalizedSchema, /training_cycle_plan_exercises_source_shape/);
  assert.match(normalizedApi, /\[organizatech:future-plan-retired\]/);
  assert.match(normalizedApi, /private\.training_cycle_plan_snapshot_json/);

  assert.doesNotMatch(
    normalizedApi,
    /(?:update|delete from) public\.training_cycle_plan_(?:versions|days|exercises|sets|drops)/,
  );
}

function validatePortalLineageIsolation(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const resolver = normalize(
    extractFunction(candidateApi, "private.resolve_training_cycle_exercise_source"),
  );
  const customCreate = normalize(
    extractFunction(candidateApi, "public.create_own_training_custom_exercise"),
  );

  assert.match(
    normalizedSchema,
    /alter table public\.training_exercise_lineages add column portal_scope text null/,
  );
  assert.match(
    normalizedSchema,
    /training_exercise_lineages_owner_portal_catalog_idx on public\.training_exercise_lineages\(user_id, portal_scope, catalog_exercise_id\)/,
  );
  assert.match(
    normalizedSchema,
    /training_exercise_lineages_owner_portal_custom_idx on public\.training_exercise_lineages\(user_id, portal_scope, custom_exercise_id\)/,
  );
  assert.match(
    normalizedSchema,
    /training_custom_exercises_owner_lineage_fk foreign key \(lineage_id, user_id, portal_scope\) references public\.training_exercise_lineages\(id, user_id, portal_scope\)/,
  );
  assert.match(
    normalizedSchema,
    /training_cycle_plan_exercises_catalog_lineage_resolution_fk foreign key \( exercise_lineage_id, user_id, portal_scope, catalog_exercise_id \) references public\.training_exercise_lineages\( id, user_id, portal_scope, catalog_exercise_id \)/,
  );
  assert.match(
    normalizedSchema,
    /training_cycle_plan_exercises_custom_lineage_resolution_fk foreign key \( exercise_lineage_id, user_id, portal_scope, custom_exercise_id \) references public\.training_exercise_lineages\( id, user_id, portal_scope, custom_exercise_id \)/,
  );
  assert.match(
    normalizedSchema,
    /create constraint trigger training_exercise_lineages_enforce_portal_source[\s\S]+?deferrable initially deferred/,
  );
  assert.match(
    normalizedSchema,
    /create trigger training_exercise_lineages_guard_redesign_source_write before insert or update or delete on public\.training_exercise_lineages/,
  );
  assert.match(
    normalizedSchema,
    /create policy "lineages own rows select" on public\.training_exercise_lineages for select to authenticated using \( user_id = \(select auth\.uid\(\)\) and portal_scope is null/,
  );
  assert.match(
    normalizedSchema,
    /create policy "lineages own rows insert" on public\.training_exercise_lineages for insert to authenticated with check \( user_id = \(select auth\.uid\(\)\) and portal_scope is null/,
  );
  assert.match(
    normalizedSchema,
    /create policy "lineages own rows update" on public\.training_exercise_lineages for update to authenticated using \( user_id = \(select auth\.uid\(\)\) and portal_scope is null/,
  );
  assert.equal(
    countOccurrences(normalizedSchema, "and portal_scope is null"),
    4,
    "all legacy lineage USING/WITH CHECK clauses exclude portal lineages",
  );

  assert.match(
    resolver,
    /on conflict \(user_id, portal_scope, catalog_exercise_id\)/,
  );
  assert.match(resolver, /lineage\.portal_scope = p_portal_scope/);
  assert.match(
    resolver,
    /lineage\.custom_exercise_id = custom\.id/,
  );
  assert.match(
    resolver,
    /custom\.portal_scope = p_portal_scope/,
  );
  assert.match(
    customCreate,
    /insert into public\.training_exercise_lineages \( user_id, portal_scope, origin_kind, metadata \)/,
  );
  assert.match(customCreate, /v_user_id, p_portal_scope, 'scoped'/);
  assert.match(customCreate, /lineage\.portal_scope = p_portal_scope/);
}

function validateServerOwnedWriteBoundary(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);
  const genericGuard = normalize(
    extractFunction(candidateSchema, "private.guard_cycle_redesign_server_owned_write"),
  );
  const lineageGuard = normalize(
    extractFunction(
      candidateSchema,
      "private.guard_training_exercise_lineage_redesign_source_write",
    ),
  );
  const compatibilityGuard = normalize(
    extractFunction(candidateApi, "private.guard_cycle_redesign_direct_write"),
  );

  assert.match(
    genericGuard,
    /current_user::pg_catalog\.text in \('anon', 'authenticated', 'service_role'\)/,
  );
  assert.match(genericGuard, /cycle redesign direct write denied/);
  assert.match(lineageGuard, /current_user::pg_catalog\.text = 'service_role'/);
  assert.match(lineageGuard, /training exercise lineage direct service role write denied/);
  assert.match(lineageGuard, /tg_op = 'delete' and pg_catalog\.pg_trigger_depth\(\) > 1/);
  assert.match(lineageGuard, /v_actor_id uuid := auth\.uid\(\)/);
  assert.match(lineageGuard, /if v_actor_id is null then/);
  assert.match(lineageGuard, /if tg_op = 'delete' then raise exception 'training exercise lineage direct delete denied'/);
  assert.match(lineageGuard, /new\.user_id is distinct from v_actor_id/);
  assert.match(lineageGuard, /new\.portal_scope is not null/);
  assert.match(
    normalizedSchema,
    /revoke insert, update, delete on public\.training_exercise_lineages from service_role/,
  );
  assert.match(
    normalizedSchema,
    /create trigger training_exercise_lineages_guard_redesign_source_write before insert or update or delete on public\.training_exercise_lineages/,
  );

  const legacyGuard = normalize(
    extractFunction(candidateSchema, "private.guard_training_cycle_legacy_write"),
  );
  assert.match(legacyGuard, /current_user::pg_catalog\.text = 'service_role'/);
  assert.match(legacyGuard, /training cycle direct service role write denied/);
  assert.match(
    normalizedApi,
    /current_user::pg_catalog\.text not in \('anon', 'authenticated', 'service_role'\)/,
  );
  assert.match(
    genericGuard,
    /tg_op = 'delete' and pg_catalog\.pg_trigger_depth\(\) > 1/,
  );
  assert.match(
    compatibilityGuard,
    /tg_op = 'delete' and pg_catalog\.pg_trigger_depth\(\) > 1/,
  );

  for (const table of [
    "training_exercise_catalog",
    "training_custom_exercises",
    "training_cycle_draft_versions",
    "training_cycle_plan_versions",
    "training_cycle_plan_days",
    "training_cycle_plan_exercises",
    "training_cycle_plan_sets",
    "training_cycle_plan_drops",
    "training_cycle_notifications",
    "training_cycle_executions",
    "training_cycle_execution_exercises",
    "training_cycle_execution_sets",
    "training_cycle_execution_drops",
  ]) {
    assert.match(
      normalizedSchema,
      new RegExp(
        `create trigger ${table}_guard_server_owned_write before insert or update or delete on public\\.${table}`,
      ),
      `${table} blocks direct service_role/application writes`,
    );
  }
}

function validateProgrammedLifecycle(
  candidateSchema: string,
  candidateApi: string,
  candidateConfig: string,
  candidateWorker: string,
  candidateWorkerIndex: string,
  candidateTemplate: string,
) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);
  const normalizedConfig = normalize(candidateConfig);
  const normalizedWorker = normalize(candidateWorker);
  const normalizedWorkerIndex = normalize(candidateWorkerIndex);
  const claim = normalize(
    extractFunction(
      candidateApi,
      "public.claim_due_training_cycle_lifecycle_deliveries",
    ),
  );
  const complete = normalize(
    extractFunction(
      candidateApi,
      "public.complete_training_cycle_lifecycle_delivery",
    ),
  );

  assert.match(normalizedSchema, /create table private\.training_cycle_notification_deliveries/);
  assert.match(normalizedSchema, /create table private\.training_cycle_lifecycle_checks/);
  for (const table of [
    "training_cycle_notification_deliveries",
    "training_cycle_lifecycle_checks",
  ]) {
    assert.match(
      normalizedSchema,
      new RegExp(`alter table private\\.${table} enable row level security`),
    );
    assert.match(
      normalizedSchema,
      new RegExp(`alter table private\\.${table} force row level security`),
    );
    assert.match(
      normalizedSchema,
      new RegExp(
        `revoke all privileges on table private\\.${table} from public, anon, authenticated, service_role`,
      ),
    );
  }
  assert.match(normalizedSchema, /status in \('pending', 'sending', 'sent', 'failed', 'rejected', 'ambiguous'\)/);
  assert.match(normalizedSchema, /unique \(notification_id\)/);
  assert.match(normalizedSchema, /idempotency_key uuid not null unique/);
  assert.match(normalizedSchema, /training_cycle_notification_deliveries_terminal_shape/);

  assert.match(claim, /security definer/);
  assert.match(claim, /set search_path = ''/);
  assert.match(claim, /set lock_timeout = '2s'/);
  assert.match(claim, /set statement_timeout = '8s'/);
  assert.match(claim, /if auth\.uid\(\) is not null/);
  assert.match(claim, /private\.verify_training_cycle_lifecycle_capability/);
  assert.match(claim, /p_limit not between 1 and 25/);
  assert.match(claim, /limit 100 for update of notification skip locked/);
  assert.match(claim, /limit 50 for update of lifecycle_check skip locked/);
  assert.match(claim, /limit p_limit for update of delivery skip locked/);
  assert.match(claim, /v_now \+ interval '15 minutes'/);
  assert.match(
    claim,
    /on conflict on constraint training_cycle_lifecycle_checks_pkey do update set/,
  );
  assert.match(claim, /status = 'ambiguous'/);
  assert.match(claim, /provider_error_code = 'stale_sending'/);
  assert.match(claim, /private\.transactional_email_idempotency_uuid/);
  assert.match(claim, /attempt_count < 3/);
  assert.match(normalizedApi, /from public\.training_workout_readiness as readiness/);
  assert.match(normalizedApi, /readiness\.training_session_id is null/);
  assert.match(complete, /delivery\.attempt_token = p_attempt_token/);
  assert.match(complete, /p_outcome not in \('sent', 'failed', 'rejected', 'ambiguous'\)/);

  assert.match(
    normalizedApi,
    /from vault\.decrypted_secrets as secret where secret\.name = 'organizatech_training_cycle_lifecycle_rpc_secret'/,
  );
  assert.match(normalizedApi, /transactional_email_constant_time_equal/);
  assert.match(
    normalizedApi,
    /revoke all on function public\.claim_due_training_cycle_lifecycle_deliveries\(text, integer\) from public, anon, authenticated, service_role/,
  );
  assert.match(
    normalizedApi,
    /grant execute on function public\.claim_due_training_cycle_lifecycle_deliveries\(text, integer\) to anon/,
  );
  assert.doesNotMatch(
    `${candidateWorker}\n${candidateWorkerIndex}`,
    /service[_-]?role/i,
  );
  assert.match(normalizedWorker, /max_parallel_deliveries = 5/);
  assert.match(normalizedWorker, /claim_limit = 25/);
  assert.match(normalizedWorker, /rpc_timeout_milliseconds = 10_000/);
  assert.match(normalizedWorker, /max_rpc_response_bytes = 262_144/);
  assert.match(normalizedWorker, /response\.body\.getreader\(\)/);
  assert.match(normalizedWorker, /totalbytes > max_rpc_response_bytes/);
  assert.match(normalizedWorker, /validsingleline\(environment\.brevoapikey, 4_096\)/);
  assert.match(normalizedWorker, /email\.test\(environment\.senderemail\)/);
  assert.match(normalizedWorker, /validsingleline\(environment\.sendername, 160\)/);
  assert.match(normalizedWorker, /appurl\.protocol !== "https:"/);
  assert.match(
    normalizedWorker,
    /if \(!validdeliveryconfiguration\(environment\)\) \{ return jsonresponse\(503/,
  );
  assert.ok(
    normalizedWorker.indexOf("if (!validdeliveryconfiguration(environment))")
      < normalizedWorker.indexOf(
        'functionname: "claim_due_training_cycle_lifecycle_deliveries"',
      ),
    "delivery configuration is validated before claiming rows",
  );
  assert.match(normalizedWorker, /constanttimeequal/);
  assert.match(normalizedWorker, /new set\(deliveries\.map/);
  assert.match(normalizedWorker, /p_capability: environment\.lifecyclerpcsecret/);
  assert.match(normalizedWorker, /p_outcome: outcome/);
  assert.match(normalizedWorker, /timeoutmilliseconds: 3_500/);
  assert.match(normalizedWorkerIndex, /supabase_anon_key/);
  assert.match(normalizedWorkerIndex, /training_cycle_lifecycle_rpc_secret/);
  assert.match(normalizedWorkerIndex, /training_cycle_lifecycle_scheduler_secret/);
  assert.match(
    normalizedConfig,
    /\[functions\.process-training-cycle-lifecycle\] verify_jwt = false/,
  );
  assert.match(normalize(candidateTemplate), /campana de organizatech/);
}

function validateExecutionContract(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const execution = normalize(
    extractFunction(candidateApi, "public.record_own_training_cycle_execution"),
  );

  for (const table of [
    "training_cycle_executions",
    "training_cycle_execution_exercises",
    "training_cycle_execution_sets",
    "training_cycle_execution_drops",
  ]) {
    assert.match(normalizedSchema, new RegExp(`create table public\\.${table}`));
    assert.match(
      normalizedSchema,
      new RegExp(`create trigger ${table}_guard_immutable before update or delete`),
    );
  }
  assert.match(normalizedSchema, /week_started_on date not null/);
  assert.match(normalizedSchema, /exercise_lineage_id uuid not null/);
  assert.match(normalizedSchema, /name_snapshot text not null/);
  assert.match(normalizedSchema, /technique_snapshot text not null/);
  assert.match(normalizedSchema, /reached_failure boolean not null/);
  assert.match(normalizedSchema, /target_reps_snapshot smallint not null/);
  assert.match(normalizedSchema, /training cycle execution rows are append only/);

  assert.match(execution, /security definer/);
  assert.match(execution, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(execution, /private\.assert_training_cycle_portal_access/);
  assert.match(execution, /octet_length\(p_execution::pg_catalog\.text\) > 262144/);
  assert.match(execution, /jsonb_array_length\(p_execution->'exercises'\) not between 1 and 200/);
  assert.match(execution, /v_total_sets > 2000\b/);
  assert.match(execution, /v_total_drops > 4000\b/);
  assert.match(execution, /cycle_execution_record/);
  assert.match(execution, /private\.find_training_cycle_receipt/);
  assert.match(execution, /private\.record_training_cycle_receipt/);
  assert.match(execution, /v_plan_exercise\.name_snapshot/);
  assert.match(execution, /v_plan_exercise\.technique/);
  assert.match(execution, /v_plan_set\.target_reps/);
  assert.match(execution, /v_plan_drop\.reps/);
  assert.match(execution, /offset 4095 limit 1/);
  assert.match(execution, /p_performed_at > v_now \+ interval '5 minutes'/);
  assert.match(execution, /p_performed_at < v_now - interval '730 days'/);
  assert.ok(
    execution.indexOf("private.find_training_cycle_receipt(")
      < execution.indexOf("p_performed_at > v_now + interval '5 minutes'"),
    "exact execution replays resolve before time-dependent validation",
  );
  assert.doesNotMatch(
    execution,
    /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:training_sessions|exercise_entries)\b/,
  );
}

function validateKeysetPagination(candidateApi: string) {
  const catalog = normalize(
    extractFunction(candidateApi, "public.list_own_training_exercise_catalog"),
  );
  const cycles = normalize(
    extractFunction(candidateApi, "public.list_own_training_cycles"),
  );
  const versions = normalize(
    extractFunction(candidateApi, "public.list_own_training_cycle_versions"),
  );
  const notifications = normalize(
    extractFunction(candidateApi, "public.list_own_training_cycle_notifications"),
  );

  assert.match(catalog, /p_after_source_kind text default null/);
  assert.match(catalog, /p_after_sort_order integer default null/);
  assert.match(catalog, /p_after_name text default null/);
  assert.match(catalog, /p_after_source_id uuid default null/);
  assert.match(
    catalog,
    /\( source\.source_rank, source\.sort_order, source\.sort_name, source\.source_id \) > \( v_cursor_rank, p_after_sort_order, p_after_name, p_after_source_id \)/,
  );
  assert.match(catalog, /limit p_limit \+ 1/);
  assert.match(catalog, /'aftersourcekind', item\.source_kind/);
  assert.match(catalog, /'aftersortorder', item\.sort_order/);
  assert.match(catalog, /'aftername', item\.sort_name/);
  assert.match(catalog, /'aftersourceid', item\.source_id/);

  assert.match(cycles, /p_before_created_at timestamptz default null/);
  assert.match(cycles, /p_before_id uuid default null/);
  assert.match(cycles, /\(p_before_created_at is null\) <> \(p_before_id is null\)/);
  assert.match(cycles, /\(cycle\.created_at, cycle\.id\) < \(p_before_created_at, p_before_id\)/);
  assert.match(cycles, /limit p_limit \+ 1/);
  assert.match(cycles, /'nextcursor'/);
  assert.match(cycles, /'beforecreatedat', item\.created_at/);
  assert.match(cycles, /'beforeid', item\.id/);

  assert.match(versions, /p_before_version integer default null/);
  assert.match(versions, /version\.version < p_before_version/);
  assert.match(versions, /limit p_limit \+ 1/);
  assert.match(versions, /'beforeversion', item\.version/);

  assert.match(notifications, /p_before_materialized_at timestamptz default null/);
  assert.match(notifications, /p_before_id uuid default null/);
  assert.match(
    notifications,
    /\(p_before_materialized_at is null\) <> \(p_before_id is null\)/,
  );
  assert.match(
    notifications,
    /\(notification\.materialized_at, notification\.id\) < \(p_before_materialized_at, p_before_id\)/,
  );
  assert.match(notifications, /limit p_limit \+ 1/);
  assert.match(notifications, /'beforematerializedat', item\.materialized_at/);
  assert.match(notifications, /'beforeid', item\.id/);
}

function validateMigrationBudgets(candidateSchema: string, candidateApi: string) {
  const normalizedSchema = normalize(candidateSchema);
  const normalizedApi = normalize(candidateApi);
  assert.match(normalizedSchema, /^-- cycle-redesign-backend-01[\s\S]*?begin;[\s\S]*?set local lock_timeout = '5s'; set local statement_timeout = '120s'/);
  assert.match(normalizedApi, /^-- cycle-redesign-backend-01[\s\S]*?begin;[\s\S]*?set local lock_timeout = '5s'; set local statement_timeout = '120s'/);
  assert.match(normalizedSchema, /do \$postcheck\$ begin/);
  assert.match(normalizedApi, /do \$postcheck\$ declare/);
  assert.match(normalizedSchema, /service_role write privilege/);
  assert.match(normalizedApi, /cycle redesign api postcheck failed: rpc grants/);
}

test("cycle redesign schema is forward-only, relationally scoped, and private", () => {
  assert.match(schemaSql, /^-- cycle-redesign-backend-01/);
  assert.match(schemaSql, /begin;/);
  assert.match(schemaSql, /commit;$/);

  for (const table of privateTables) {
    assert.match(schemaSql, new RegExp(`create table public\\.${table}`));
  }
  assert.match(schemaSql, /create table private\.training_cycle_operation_receipts/);
  assert.match(schemaSql, /training_cycles_id_owner_portal_key/);
  assert.match(schemaSql, /training_cycles_current_plan_version_owner_portal_fk/);
  assert.match(schemaSql, /training_cycle_drafts_source_cycle_owner_portal_fk/);
  assert.match(schemaSql, /training_cycle_notifications_cycle_owner_portal_fk/);
  assert.match(
    schemaSql,
    /training_cycles_current_plan_version_owner_portal_fk[\s\S]+?deferrable initially deferred/,
  );
  assert.match(
    schemaSql,
    /training_custom_exercises_owner_lineage_fk[\s\S]+?deferrable initially deferred/,
  );

  validateSecurityContract(schema, api);
});

test("migration ownership hashes match the seven exact forward-only files", () => {
  assert.equal(
    sha256(schema),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260829200846_cycle_redesign_schema.sql"],
  );
  assert.equal(
    sha256(api),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260829200847_cycle_redesign_api.sql"],
  );
  assert.equal(
    sha256(activeReplacement),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260831213114_cycle_active_replacement.sql"],
  );
  assert.equal(
    sha256(activeAtomicReplacement),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260831230440_cycle_active_atomic_replacement.sql"],
  );
  assert.equal(
    sha256(activeReplacementSnapshot),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260831233757_cycle_active_replacement_snapshot_response.sql"],
  );
  assert.equal(
    sha256(activeReplacementDescriptors),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260901002250_cycle_active_replacement_exercise_descriptors.sql"],
  );
  assert.equal(
    sha256(legacyCompatibility),
    POST_PERF_06_MIGRATION_OWNERSHIP["20260905201420_cycle_legacy_compatibility_expiry_youtube.sql"],
  );
});

test("embedded replacement harness applies exact owned migrations over a pre-846 baseline", () => {
  const ordered = [
    "20260829200846_cycle_redesign_schema.sql",
    "20260829200847_cycle_redesign_api.sql",
    "20260831213114_cycle_active_replacement.sql",
    "20260831230440_cycle_active_atomic_replacement.sql",
    "20260831233757_cycle_active_replacement_snapshot_response.sql",
    "20260901002250_cycle_active_replacement_exercise_descriptors.sql",
    "20260905201420_cycle_legacy_compatibility_expiry_youtube.sql",
  ];
  let previous = -1;
  for (const migration of ordered) {
    const position = activeReplacementRunner.indexOf(`supabase/migrations/${migration}`);
    assert.ok(position > previous, `${migration} must be applied exactly and in order`);
    previous = position;
  }
  for (const ownedDefinition of [
    "create table public.training_exercise_catalog",
    "create table public.training_custom_exercises",
    "create table public.training_cycle_drafts",
    "create table public.training_cycle_draft_versions",
    "create table public.training_cycle_plan_versions",
    "create function private.assert_training_cycle_portal_access",
    "create function private.lock_training_cycle_portal",
    "create function private.training_cycle_draft_snapshot_json",
  ]) {
    assert.doesNotMatch(normalize(activeReplacementBootstrap), new RegExp(ownedDefinition.replaceAll(".", "\\.")));
  }
  assert.match(activeReplacementRunner, /grep -Eq '\^\(not ok\|Bail out!\)'/);
  assert.match(activeReplacementRunner, /grep -Ec '\^ok \[0-9\]\+'/);
  assert.match(activeReplacementSnapshotSql, /'responsekind', 'prepared_draft'/);
  assert.match(activeReplacementSnapshotSql, /'draft', v_draft/);
});

test("atomic replacement creates the new draft before closing and covers legacy safely", () => {
  assert.match(activeAtomicReplacementSql, /^-- cycle-redesign-active-atomic-replacement-02/);
  const replace = normalize(extractFunction(
    activeAtomicReplacement,
    "public.replace_own_active_training_cycle_to_draft",
  ));
  assert.match(replace, /private\.lock_training_cycle_portal\(v_user_id, p_portal_scope\)/);
  assert.match(replace, /private\.training_cycle_replacement_source/);
  assert.ok(replace.indexOf("state = 'discarded'") < replace.indexOf("private.create_training_cycle_draft_record("));
  assert.ok(replace.indexOf("private.create_training_cycle_draft_record(") < replace.indexOf("status = 'completed'"));
  assert.match(replace, /from public\.training_workout_readiness as readiness/);
  assert.match(activeAtomicReplacementSql, /legacy training cycle cannot be converted safely/);
  assert.match(activeAtomicReplacementSql, /day\.week_index <> 1/);
  assert.match(activeAtomicReplacementSql, /pg_catalog\.count\(\*\) not between 1 and 50/);
  assert.match(activeAtomicReplacementSql, /\) > 200 then raise exception 'legacy training cycle cannot be converted safely'/);
  assert.match(activeAtomicReplacementSql, /revoke execute on function public\.complete_own_active_training_cycle_manually/);
});

test("active-cycle replacement migration closes only the confirmed owned cycle", () => {
  assert.match(activeReplacementSql, /^-- cycle-redesign-active-replacement-01/);
  assert.match(activeReplacementSql, /begin;/);
  assert.match(activeReplacementSql, /commit;$/);
  assert.match(activeReplacementSql, /operation_kind in \([\s\S]*?'cycle_close'/);

  const guard = normalize(extractFunction(
    activeReplacement,
    "public.get_own_active_training_cycle_guard",
  ));
  assert.match(guard, /security definer/);
  assert.match(guard, /set search_path = ''/);
  assert.match(guard, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(guard, /private\.assert_training_cycle_portal_access\(v_user_id, p_portal_scope\)/);
  assert.match(guard, /cycle\.user_id = v_user_id/);
  assert.match(guard, /cycle\.portal_scope = p_portal_scope/);
  assert.match(guard, /cycle\.status = 'active'/);
  assert.doesNotMatch(guard, /and cycle\.current_plan_version_id is not null/);
  assert.match(guard, /'hascanonicalplan', v_cycle\.current_plan_version_id is not null/);

  const close = normalize(extractFunction(
    activeReplacement,
    "public.complete_own_active_training_cycle_manually",
  ));
  assert.match(close, /security definer/);
  assert.match(close, /set search_path = ''/);
  assert.match(close, /private\.lock_training_cycle_portal\(v_user_id, p_portal_scope\)/);
  assert.ok(
    close.indexOf("from private.find_training_cycle_receipt(")
      < close.indexOf("from public.training_cycles as cycle"),
    "an exact retry resolves before mutable active-cycle state",
  );
  assert.match(close, /cycle\.id = p_expected_active_cycle_id/);
  assert.match(close, /cycle\.user_id = v_user_id/);
  assert.match(close, /cycle\.portal_scope = p_portal_scope/);
  assert.match(close, /for update/);
  assert.match(close, /from public\.training_workout_readiness as readiness/);
  assert.match(close, /readiness\.training_session_id is null/);
  assert.match(close, /status = 'completed'/);
  assert.match(close, /closed_reason = 'manual'/);
  assert.match(close, /private\.record_training_cycle_receipt\([\s\S]*?'cycle_close'/);
  assert.doesNotMatch(close, /activate_own_training_cycle_draft/);
  assert.doesNotMatch(
    activeReplacement,
    /\b(?:alter\s+table|insert\s+into|update|delete\s+from)\s+public\.(?:training_sessions|exercise_entries)\b/i,
  );
  assert.match(activeReplacementSql, /grant execute on function public\.get_own_active_training_cycle_guard\(text\) to authenticated/);
  assert.doesNotMatch(activeReplacementSql, /grant execute on function public\.complete_own_active_training_cycle_manually\( uuid, text, uuid \) to authenticated/);
  assert.match(activeReplacementSql, /revoke all on function public\.complete_own_active_training_cycle_manually\( uuid, text, uuid \) from public, anon, authenticated, service_role/);
  assert.match(activeReplacementSql, /service_role[\s\S]*guard grants/);
  assert.match(activeReplacementSql, /service_role[\s\S]*mutation grants/);
});

test("legacy compatibility preserves active cycles, canonicalizes YouTube, and schedules T-7 safely", () => {
  assert.match(legacyCompatibilitySql, /^-- cycle-redesign-legacy-compatibility-05/);
  assert.match(legacyCompatibilitySql, /begin;/);
  assert.match(legacyCompatibilitySql, /commit;$/);

  const youtubeCanonical = normalize(extractFunction(
    legacyCompatibility,
    "private.canonical_training_youtube_url",
  ));
  assert.match(youtubeCanonical, /language plpgsql immutable strict security invoker/);
  assert.match(youtubeCanonical, /set search_path = ''/);
  assert.match(youtubeCanonical, /\{11\}/);
  assert.match(youtubeCanonical, /embed\|shorts\|live/);
  assert.match(youtubeCanonical, /regexp_count\(p_value, '\[\?&\]v='\) = 1/);
  assert.match(youtubeCanonical, /https:\/\/www\.youtube\.com\/watch\?v=/);

  const youtube = normalize(extractFunction(
    legacyCompatibility.replace(
      "create or replace function private.is_valid_training_youtube_url(",
      "create function private.is_valid_training_youtube_url(",
    ),
    "private.is_valid_training_youtube_url",
  ));
  assert.match(youtube, /language sql immutable strict security invoker/);
  assert.match(youtube, /set search_path = ''/);
  assert.match(youtube, /p_value = private\.canonical_training_youtube_url\(p_value\)/);
  assert.match(legacyCompatibilitySql, /update public\.training_exercise_catalog set default_video_url = private\.canonical_training_youtube_url/);
  assert.match(legacyCompatibilitySql, /update public\.training_custom_exercises set video_url = private\.canonical_training_youtube_url/);
  assert.match(legacyCompatibilitySql, /update public\.training_cycle_plan_exercises set video_url_snapshot = private\.canonical_training_youtube_url/);
  assert.match(legacyCompatibilitySql, /training_cycle_draft_versions_youtube_urls_canonical/);
  assert.match(legacyCompatibilitySql, /training_cycle_plan_versions_youtube_urls_canonical/);

  const adapt = normalize(extractFunction(
    legacyCompatibility,
    "public.adapt_own_active_legacy_training_cycle",
  ));
  assert.match(adapt, /security definer/);
  assert.match(adapt, /set search_path = ''/);
  assert.match(adapt, /set lock_timeout = '3s'/);
  assert.match(adapt, /set statement_timeout = '12s'/);
  assert.match(adapt, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(adapt, /private\.assert_training_cycle_portal_access\(v_user_id, p_portal_scope\)/);
  assert.match(adapt, /private\.lock_training_cycle_portal\(v_user_id, p_portal_scope\)/);
  assert.match(adapt, /cycle\.id = p_expected_cycle_id/);
  assert.match(adapt, /cycle\.user_id = v_user_id/);
  assert.match(adapt, /cycle\.portal_scope = p_portal_scope/);
  assert.match(adapt, /for update/);
  assert.match(adapt, /v_start_date \+ \(v_duration_weeks \* 7\) - 1/);
  assert.match(adapt, /when sqlstate '55000'/);
  assert.match(adapt, /'status', 'legacy_fallback'/);
  assert.match(adapt, /current_plan_version_id = v_version_id/);
  assert.match(adapt, /private\.schedule_training_cycle_notifications/);
  assert.doesNotMatch(
    legacyCompatibility,
    /\b(?:alter\s+table|insert\s+into|update|delete\s+from)\s+public\.(?:training_sessions|exercise_entries)\b/i,
  );
  assert.match(legacyCompatibilitySql, /'expires_t7'/);
  assert.doesNotMatch(legacyCompatibilitySql, /\('expires_t2'::text/);
  assert.match(legacyCompatibilitySql, /grant execute on function public\.adapt_own_active_legacy_training_cycle\( uuid, text, uuid \) to authenticated/);
  assert.match(legacyCompatibilitySql, /service_role[\s\S]*legacy cycle compatibility postcheck failed/);

  assert.match(legacyCompatibilityDbTestSql, /select extensions\.plan\(30\)/);
  assert.match(legacyCompatibilityDbTestSql, /four legacy weeks use an inclusive start plus 27 day end date/);
  assert.match(legacyCompatibilityDbTestSql, /multi-week legacy data fails safely without truncation/);
  assert.match(legacyCompatibilityDbTestSql, /concurrent adaptations with different requests serialize/);
  assert.match(legacyCompatibilityDbTestSql, /adaptation does not duplicate legacy exercises/);
});

test("active-cycle replacement has a transactional local pgTAP harness", () => {
  assert.match(activeReplacementDbTestSql, /^-- local-only pgtap coverage/);
  assert.match(activeReplacementDbTestSql, /select extensions\.plan\(25\)/);
  assert.match(activeReplacementDbTestSql, /legacy active cycle is visible/);
  assert.match(activeReplacementDbTestSql, /canonical active cycle is visible/);
  assert.match(activeReplacementDbTestSql, /owner cannot close another owner cycle/);
  assert.match(activeReplacementDbTestSql, /portal scope requires its authoritative membership/);
  assert.match(activeReplacementDbTestSql, /in-progress workout blocks manual replacement/);
  assert.match(activeReplacementDbTestSql, /same request is idempotent/);
  assert.match(activeReplacementDbTestSql, /atomic replacement returns the prepared draft in the same response/);
  assert.match(activeReplacementDbTestSql, /idempotent replay returns the same complete prepared-draft response/);
  assert.match(activeReplacementDbTestSql, /incompatible prior remote draft is retired instead of overwritten/);
  assert.match(activeReplacementDbTestSql, /legacy exercise without catalog becomes an owner-scoped custom identity/);
  assert.match(activeReplacementDbTestSql, /legacy replacement returns the newly materialized custom source inline/);
  assert.match(activeReplacementDbTestSql, /extensions\.dblink_send_query/);
  assert.match(activeReplacementDbTestSql, /concurrent replay waits/);
  assert.match(activeReplacementDbTestSql, /serialized concurrent replay records one receipt/);
  assert.match(activeReplacementDbTestSql, /select \* from extensions\.finish\(\); rollback;/);
  assert.doesNotMatch(activeReplacementDbTestSql, /supabase\.co|fjjebhaqtrdbpxzxztmh|lzycxltqbrtsnwfdotqw/);
});

test("API migration uses parser-safe string search and locking clause order", () => {
  assert.doesNotMatch(
    apiSql,
    /pg_catalog\.(?:coalesce|nullif|greatest|least|position)\s*\(/,
  );
  assert.match(
    apiSql,
    /pg_catalog\.strpos\(coalesce\(exercise\.notes, ''\), v_retired_marker\) > 0/,
  );
  assert.match(
    apiSql,
    /pg_catalog\.strpos\(pg_catalog\.lower\(source\.name\), v_query\) > 0/,
  );
  assert.match(
    apiSql,
    /pg_catalog\.strpos\(pg_catalog\.lower\(source\.muscle_group\), v_query\) > 0/,
  );
  assert.doesNotMatch(apiSql, /for update of [a-z_]+ skip locked limit/);
});

test("cycle plan payload has exact allowlists and hard resource bounds", () => {
  validatePayloadContract(api);
});

test("legacy cycle writes preserve compatibility behind strict database bounds", () => {
  validateLegacyTrainingCycleWriteBoundary(schema);
});

test("writes are idempotent, serialized, quota-limited, and optimistic", () => {
  validateConcurrencyContract(schema, api);
  validateIdempotentMutationResults(api);
});

test("version snapshots are append-only and preserve the legacy workout bridge", () => {
  validateSnapshotContract(schema, api);
});

test("catalog and custom lineages are isolated by identity and portal", () => {
  validatePortalLineageIsolation(schema, api);
});

test("service_role and unauthenticated direct writes fail closed", () => {
  validateServerOwnedWriteBoundary(schema, api);
});

test("advanced set/drop execution is owner-scoped, idempotent, and append-only", () => {
  validateExecutionContract(schema, api);
});

test("cycle and version lists use bounded keyset pagination", () => {
  validateKeysetPagination(api);
});

test("catalog and notification keysets reach fixtures beyond the first 100", () => {
  const catalog = Array.from({ length: 217 }, (_, index) => ({
    key: `1:00000:custom-${index.toString().padStart(3, "0")}`,
    id: index,
  }));
  const catalogPages: number[] = [];
  const catalogSeen: number[] = [];
  let after: string | null = null;
  while (true) {
    const page = catalog
      .filter((row) => after === null || row.key > after)
      .slice(0, 100);
    catalogPages.push(page.length);
    catalogSeen.push(...page.map((row) => row.id));
    if (page.length < 100) break;
    after = page.at(-1)!.key;
  }
  assert.deepEqual(catalogPages, [100, 100, 17]);
  assert.equal(new Set(catalogSeen).size, 217);

  const notifications = Array.from({ length: 175 }, (_, index) => ({
    key: (10_000 - index).toString().padStart(5, "0"),
    id: index,
  }));
  const notificationPages: number[] = [];
  const notificationSeen: number[] = [];
  let before: string | null = null;
  while (true) {
    const page = notifications
      .filter((row) => before === null || row.key < before)
      .slice(0, 100);
    notificationPages.push(page.length);
    notificationSeen.push(...page.map((row) => row.id));
    if (page.length < 100) break;
    before = page.at(-1)!.key;
  }
  assert.deepEqual(notificationPages, [100, 75]);
  assert.equal(new Set(notificationSeen).size, 175);
});

test("T-7 through T+1 lifecycle protects an active workout without mutating it", () => {
  validateLifecycleContract(schema, api);
  validateProgrammedLifecycle(
    schema,
    api,
    supabaseConfig,
    lifecycleWorker,
    lifecycleWorkerIndex,
    lifecycleTemplate,
  );
});

test("DDL, scheduler RPCs, and postchecks have bounded transaction budgets", () => {
  validateMigrationBudgets(schema, api);
});

test("all required lifecycle operations are exposed through bounded RPCs", () => {
  for (const operation of [
    "custom_exercise_create",
    "draft_create",
    "draft_save",
    "draft_duplicate",
    "draft_renewal",
    "draft_discard",
    "cycle_activate",
    "cycle_edit",
    "cycle_extend",
    "cycle_execution_record",
    "notifications_mark_read",
  ]) {
    assert.match(schemaSql, new RegExp(`'${operation}'`));
    assert.match(apiSql, new RegExp(`'${operation}'`));
  }
  assert.match(apiSql, /set statement_timeout = '5s'/);
  assert.match(apiSql, /set statement_timeout = '8s'/);
  assert.match(apiSql, /p_limit not between 1 and 100/);
  assert.match(apiSql, /cardinality\(p_notification_ids\) not between 1 and 50/);
});

test("Coach contract allowlists only the seven owned redesign migrations", () => {
  validateCoachMigrationAllowlist(coachContract);
});

test("mutation probes prove the contract rejects weakened controls", () => {
  assert.throws(() =>
    validateSecurityContract(
      schema.replace(
        "training_cycles_one_active_per_identity_portal_idx",
        "removed_active_cycle_index",
      ),
      api,
    ),
  );

  assert.throws(() =>
    validateSecurityContract(
      schema,
      api.replace("v_user_id uuid := auth.uid();", "v_user_id uuid := null;"),
    ),
  );

  assert.throws(() =>
    validateSecurityContract(
      schema,
      api.replace("    or p_portal_scope is null\n", ""),
    ),
  );

  assert.throws(() =>
    validatePayloadContract(api.replace("v_total_drops > 4000", "v_total_drops > 40000")),
  );

  assert.throws(() =>
    validateLegacyTrainingCycleWriteBoundary(
      schema.replace(
        "      if v_actor_id is null or new.user_id is distinct from v_actor_id then",
        "      if v_actor_id is null then",
      ),
    ),
  );

  assert.throws(() =>
    validateLegacyTrainingCycleWriteBoundary(
      schema.replace(
        "  if tg_op = 'INSERT' and v_actor_id is null then\n"
          + "    raise exception 'training cycle ownership denied' using errcode = '42501';\n"
          + "  end if;\n\n",
        "",
      ),
    ),
  );

  assert.throws(() =>
    validateLegacyTrainingCycleWriteBoundary(
      schema.replace(
        "pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 262144",
        "pg_catalog.octet_length(new.plan_snapshot::pg_catalog.text) > 2621440",
      ),
    ),
  );

  assert.throws(() =>
    validateLegacyTrainingCycleWriteBoundary(
      schema.replace(
        "new.duration_weeks not between 1 and 105",
        "new.duration_weeks > 0",
      ),
    ),
  );

  assert.throws(() =>
    validateLegacyTrainingCycleWriteBoundary(
      schema.replace("      offset 999\n", "      offset 9999\n"),
    ),
  );

  assert.throws(() =>
    validateLegacyTrainingCycleWriteBoundary(
      schema.replace(
        "    new.plan_snapshot is distinct from old.plan_snapshot\n",
        "    true\n",
      ),
    ),
  );

  assert.throws(() =>
    validateIdempotentMutationResults(
      api.replace(
        "    return private.training_cycle_operation_result(\n"
          + "      p_request_id, 'cycle_edit', v_receipt_cycle_id, v_receipt_version\n"
          + "    );",
        "    return private.training_cycle_snapshot_json(\n"
          + "      v_user_id, p_portal_scope, v_receipt_cycle_id, v_now\n"
          + "    );",
      ),
    ),
  );

  assert.throws(() =>
    validateIdempotentMutationResults(
      api.replace(
        "  if v_receipt_id is not null then\n"
          + "    return private.training_cycle_operation_result(\n"
          + "      p_request_id,\n"
          + "      'notifications_mark_read',\n"
          + "      v_receipt_id,\n"
          + "      v_receipt_version\n"
          + "    );\n"
          + "  end if;",
        "  if v_receipt_id is not null then\n"
          + "    return pg_catalog.jsonb_build_object('readAt', pg_catalog.clock_timestamp());\n"
          + "  end if;",
      ),
    ),
  );

  assert.throws(() =>
    validateIdempotentMutationResults(
      api.replace(
        "    'requestId', p_request_id,",
        "    'requestId', pg_catalog.gen_random_uuid(),",
      ),
    ),
  );

  assert.throws(() =>
    validateIdempotentMutationResults(
      api.replace(
        "    p_request_id, 'cycle_edit', v_cycle.id, v_new_version\n",
        "    p_request_id, 'cycle_edit', v_cycle.id, v_new_version + 1\n",
      ),
    ),
  );

  assert.throws(() =>
    validateCoachMigrationAllowlist(
      coachContract.replace(
        "        && path !== CYCLE_REDESIGN_API_MIGRATION_PATH\n",
        "",
      ),
    ),
  );

  assert.throws(() =>
    validateLifecycleContract(
      schema,
      api.replace("and readiness.training_session_id is null", ""),
    ),
  );

  assert.throws(() =>
    validateLifecycleContract(
      schema,
      `${api}\nupdate public.training_sessions set status = 'completed';`,
    ),
  );

  assert.throws(() =>
    validateSnapshotContract(
      schema,
      `${api}\nupdate public.training_cycle_plan_sets set target_reps = 1;`,
    ),
  );

  assert.throws(() =>
    validatePortalLineageIsolation(
      schema.replace(
        "training_exercise_lineages_owner_portal_catalog_idx",
        "training_exercise_lineages_owner_catalog_idx",
      ),
      api,
    ),
  );

  assert.throws(() =>
    validatePortalLineageIsolation(
      schema,
      api.replace(
        "on conflict (user_id, portal_scope, catalog_exercise_id)",
        "on conflict (user_id, catalog_exercise_id)",
      ),
    ),
  );

  assert.throws(() =>
    validatePortalLineageIsolation(
      schema.replace(
        "    and portal_scope is null\n",
        "",
      ),
      api,
    ),
  );

  assert.throws(() =>
    validateServerOwnedWriteBoundary(
      schema.replace(
        "current_user::pg_catalog.text in ('anon', 'authenticated', 'service_role')",
        "current_user::pg_catalog.text in ('anon', 'authenticated')",
      ),
      api,
    ),
  );

  assert.throws(() =>
    validateServerOwnedWriteBoundary(
      schema.replace(
        "create trigger training_exercise_lineages_guard_redesign_source_write\n"
          + "  before insert or update or delete on public.training_exercise_lineages",
        "create trigger training_exercise_lineages_guard_redesign_source_write\n"
          + "  before insert or update on public.training_exercise_lineages",
      ),
      api,
    ),
  );

  assert.throws(() =>
    validateProgrammedLifecycle(
      schema,
      api.replace(
        "organizatech_training_cycle_lifecycle_rpc_secret",
        "missing_cycle_lifecycle_capability",
      ),
      supabaseConfig,
      lifecycleWorker,
      lifecycleWorkerIndex,
      lifecycleTemplate,
    ),
  );

  assert.throws(() =>
    validateProgrammedLifecycle(
      schema,
      api,
      supabaseConfig,
      lifecycleWorker.replace(
        "if (!validDeliveryConfiguration(environment))",
        "if (false)",
      ),
      lifecycleWorkerIndex,
      lifecycleTemplate,
    ),
  );

  assert.throws(() =>
    validateProgrammedLifecycle(
      schema,
      api,
      supabaseConfig,
      lifecycleWorker.replace(
        "const MAX_RPC_RESPONSE_BYTES = 262_144;",
        "const MAX_RPC_RESPONSE_BYTES = 2_621_440;",
      ),
      lifecycleWorkerIndex,
      lifecycleTemplate,
    ),
  );

  assert.throws(() =>
    validateProgrammedLifecycle(
      schema,
      api.replace(
        "on conflict on constraint training_cycle_lifecycle_checks_pkey do update set",
        "on conflict (cycle_id) do update set",
      ),
      supabaseConfig,
      lifecycleWorker,
      lifecycleWorkerIndex,
      lifecycleTemplate,
    ),
  );

  assert.throws(() =>
    validateProgrammedLifecycle(
      schema,
      api,
      supabaseConfig.replace(
        "[functions.process-training-cycle-lifecycle]\nverify_jwt = false",
        "[functions.process-training-cycle-lifecycle]\nverify_jwt = true",
      ),
      lifecycleWorker,
      lifecycleWorkerIndex,
      lifecycleTemplate,
    ),
  );

  assert.throws(() =>
    validateExecutionContract(
      schema.replace(
        "training cycle execution rows are append only",
        "execution rows may be updated",
      ),
      api,
    ),
  );

  assert.throws(() =>
    validateExecutionContract(
      schema,
      api.replaceAll("v_total_sets > 2000", "v_total_sets > 20000"),
    ),
  );

  assert.throws(() =>
    validateKeysetPagination(
      api.replace("limit p_limit + 1", "limit p_limit"),
    ),
  );

  assert.throws(() =>
    validateKeysetPagination(
      api.replace(
        "or (notification.materialized_at, notification.id)\n"
          + "          < (p_before_materialized_at, p_before_id)",
        "or true",
      ),
    ),
  );

  assert.throws(() =>
    validateMigrationBudgets(
      schema.replace("set local lock_timeout = '5s';", ""),
      api,
    ),
  );
});
