import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260902163716_sec_training_rpc_resource_bounds.sql":
    "95b7821dae127f59f11cbd5458a1f36cd1380e0b5be2411fa424fb874afd5a04",
} as const;

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260902163716_sec_training_rpc_resource_bounds.sql",
);
const migration = readFileSync(migrationPath, "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readFunctionBody(source: string, qualifiedName: string) {
  const expression = new RegExp(
    `create or replace function ${escapeRegExp(qualifiedName)}\\([\\s\\S]*?as \\$function\\$\\n([\\s\\S]*?)\\n\\$function\\$;`,
  );
  const match = source.match(expression);
  assert.ok(match, `No se encontro ${qualifiedName}`);
  return match[1];
}

function assertCoreResourceBoundary(source: string) {
  const sessionBounds = readFunctionBody(
    source,
    "private.assert_training_session_entries_resource_bounds",
  );
  const planBounds = readFunctionBody(
    source,
    "private.assert_training_cycle_plan_resource_bounds",
  );
  const legacyRpc = readFunctionBody(source, "public.create_training_session_with_entries");
  const cycleRpc = readFunctionBody(
    source,
    "public.create_training_session_with_cycle_entries",
  );
  const dayChangeRpc = readFunctionBody(
    source,
    "public.apply_training_cycle_day_exercise_changes",
  );

  assert.match(sessionBounds, /jsonb_array_length\(p_entries\) > 20/);
  assert.match(sessionBounds, /jsonb_array_length\(v_reps\) > 64/);
  assert.match(sessionBounds, /octet_length\(p_entries::pg_catalog\.text\) > 524288/);
  assert.match(sessionBounds, /p_status = 'skipped'[\s\S]*jsonb_array_length\(p_entries\) <> 0/);
  assert.match(sessionBounds, /v_identity_id = any\(v_seen_identity_ids\)/);
  assert.match(planBounds, /jsonb_array_length\(v_exercises\) > 20/);
  assert.match(planBounds, /v_total_exercises > 512/);
  assert.match(planBounds, /octet_length\(p_plan::pg_catalog\.text\) > 2097152/);

  for (const body of [legacyRpc, cycleRpc]) {
    const guardIndex = body.indexOf(
      "perform private.assert_training_session_entries_resource_bounds",
    );
    const insertIndex = body.indexOf("insert into public.training_sessions");
    const loopIndex = body.indexOf("for v_entry in select * from jsonb_array_elements");
    assert.ok(guardIndex >= 0, "La RPC debe invocar el guard de recursos");
    assert.ok(guardIndex < insertIndex, "El guard debe ejecutarse antes del primer write");
    assert.ok(guardIndex < loopIndex, "El guard debe ejecutarse antes del loop controlado");
  }

  assert.match(source, /before insert or update of plan_snapshot on public\.training_cycles/);
  assert.match(source, /create trigger training_cycles_resource_bounds/);
  assert.match(source, /before insert or update\s+on public\.training_cycle_exercises/);
  assert.match(source, /create trigger training_cycle_exercises_resource_bounds/);
  assert.match(source, /new\.source_legacy_exercise_id is distinct from old\.source_legacy_exercise_id/);
  assert.match(source, /new\.exercise_lineage_id is distinct from old\.exercise_lineage_id/);
  assert.match(source, /new\.exercise_lineage_id is null[\s\S]*El ejercicio activo requiere identidad historica/);
  assert.match(source, /cycle_day\.user_id = new\.user_id/);
  assert.match(source, /lineage\.user_id = new\.user_id/);
  assert.match(source, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(new\.day_id::pg_catalog\.text, 0\)\)/);
  assert.match(source, /v_active_count >= 20/);
  assert.match(source, /v_total_count >= 256/);
  assert.match(source, /\[organizatech:future-plan-retired\]/);
  assert.match(source, /previous_exercise\.exercise_lineage_id = new\.exercise_lineage_id/);
  assert.match(source, /before insert or update\s+on public\.exercise_entries/);
  assert.match(source, /create trigger exercise_entries_resource_bounds/);
  assert.match(source, /new\.training_cycle_exercise_id is distinct from old\.training_cycle_exercise_id/);
  assert.match(source, /cycle_exercise\.exercise_lineage_id = new\.exercise_lineage_id/);
  assert.match(source, /lineage\.source_legacy_exercise_id = new\.exercise_id/);
  assert.match(source, /v_entry_count >= 20/);

  assert.match(dayChangeRpc, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(p_day_id::pg_catalog\.text, 0\)\)/);
  assert.match(dayChangeRpc, /v_active_count - pg_catalog\.cardinality\(v_retire_ids\)[\s\S]*\+ pg_catalog\.jsonb_array_length\(v_insertions\) > 20/);
  assert.match(dayChangeRpc, /v_total_count \+ pg_catalog\.jsonb_array_length\(v_insertions\) > 256/);
  assert.match(dayChangeRpc, /from public\.exercise_entries as entry[\s\S]*entry\.training_cycle_exercise_id = exercise\.id/);
  assert.match(dayChangeRpc, /update public\.training_cycle_exercises as exercise\s+set\s+notes = case/);
  const retireIndex = dayChangeRpc.indexOf("update public.training_cycle_exercises as exercise");
  const lineageIndex = dayChangeRpc.indexOf("insert into public.training_exercise_lineages");
  const insertIndex = dayChangeRpc.indexOf("insert into public.training_cycle_exercises");
  assert.ok(retireIndex >= 0 && retireIndex < lineageIndex && lineageIndex < insertIndex);
}

test("la migracion aplica los limites antes de expandir o persistir payloads", () => {
  assertCoreResourceBoundary(migration);
});

test("los payloads usan allowlists exactas y conservan observation opcional", () => {
  const sessionBounds = readFunctionBody(
    migration,
    "private.assert_training_session_entries_resource_bounds",
  );
  const planBounds = readFunctionBody(
    migration,
    "private.assert_training_cycle_plan_resource_bounds",
  );

  assert.match(sessionBounds, /jsonb_object_keys\(v_entry\)/);
  assert.match(sessionBounds, /'id', 'exercise_id', 'weight', 'previous_weight', 'reps'/);
  assert.match(sessionBounds, /'training_cycle_exercise_id', 'exercise_id'/);
  assert.match(sessionBounds, /'rir', 'notes', 'observation'/);
  assert.match(planBounds, /array\['source', 'trainingDays', 'exerciseCount', 'routines'\]/);
  assert.match(planBounds, /jsonb_object_keys\(v_routine\)/);
  assert.match(planBounds, /jsonb_object_keys\(v_day\)/);
  assert.match(planBounds, /jsonb_object_keys\(v_exercise\)/);
  assert.match(planBounds, /v_numeric_value <> v_total_exercises/);
});

test("preserva lineage, observation, atomicidad y firmas publicas vigentes", () => {
  const legacyRpc = readFunctionBody(migration, "public.create_training_session_with_entries");
  const cycleRpc = readFunctionBody(
    migration,
    "public.create_training_session_with_cycle_entries",
  );

  assert.match(legacyRpc, /from public\.training_exercise_lineages tel/);
  assert.match(legacyRpc, /exercise_lineage_id,/);
  assert.match(legacyRpc, /nullif\(btrim\(v_entry->>'observation'\), ''\)/);
  assert.match(cycleRpc, /select tce\.exercise_lineage_id/);
  assert.match(cycleRpc, /when unique_violation then/);
  assert.match(cycleRpc, /nullif\(btrim\(v_entry->>'observation'\), ''\)/);
  assert.match(migration, /create or replace function public\.create_training_session_with_entries\(\s*p_routine_id uuid,/);
  assert.match(migration, /create or replace function public\.create_training_session_with_cycle_entries\(\s*p_cycle_id uuid,/);
});

test("los helpers y triggers no son una nueva API publica", () => {
  for (const name of [
    "private.assert_training_session_entries_resource_bounds(jsonb, text, text, text)",
    "private.assert_training_cycle_plan_resource_bounds(jsonb)",
    "private.enforce_training_cycle_snapshot_resource_bounds()",
    "private.enforce_training_cycle_exercise_resource_bounds()",
    "private.enforce_exercise_entry_resource_bounds()",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function ${escapeRegExp(name)}[\\s\\S]*?from public, anon, authenticated, service_role;`),
    );
  }

  assert.match(migration, /revoke all on function public\.create_training_session_with_entries\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute[\s\S]*?to authenticated;/);
  assert.match(migration, /revoke all on function public\.create_training_session_with_cycle_entries\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute[\s\S]*?to authenticated;/);
  assert.match(migration, /revoke all on function public\.create_training_cycle_with_plan\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute[\s\S]*?to authenticated;/);
  assert.match(migration, /revoke all on function public\.apply_training_cycle_day_exercise_changes\([\s\S]*?from public, anon, authenticated, service_role;[\s\S]*?grant execute[\s\S]*?to authenticated;/);
  assert.doesNotMatch(migration, /grant execute on function private\./);
});

test("los mutantes de limite, trigger, lock y guard son rechazados", () => {
  const mutants = [
    ["session limit", migration.replace("jsonb_array_length(p_entries) > 20", "jsonb_array_length(p_entries) > 21")],
    ["active limit", migration.replace("v_active_count >= 20", "v_active_count >= 21")],
    ["entry limit", migration.replace("v_entry_count >= 20", "v_entry_count >= 21")],
    ["day lock", migration.replace("perform pg_catalog.pg_advisory_xact_lock", "perform pg_catalog.pg_sleep")],
    ["session guard", migration.replace(
      "perform private.assert_training_session_entries_resource_bounds",
      "perform private.assert_training_session_entries_unbounded",
    )],
    ["exercise trigger", migration.replace("create trigger training_cycle_exercises_resource_bounds", "-- trigger removed")],
    ["atomic final count", migration.replace(
      "v_active_count - pg_catalog.cardinality(v_retire_ids)",
      "v_active_count + pg_catalog.cardinality(v_retire_ids)",
    )],
    ["retire before insert", migration.replace(
      "update public.training_cycle_exercises as exercise\n  set\n    notes = case",
      "delete from public.training_cycle_exercises as exercise\n  where false;\n  select case",
    )],
  ] as const;

  for (const [name, mutant] of mutants) {
    assert.throws(() => assertCoreResourceBoundary(mutant), name);
  }
});
