import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260718_exercise_entries_observation.sql",
  "utf8",
);
const previousMigration = readFileSync(
  "supabase/migrations/20260709_p0_d1_harden_training_session_entries_writes.sql",
  "utf8",
);

const commentStart = migration.indexOf("/*");
assert.ok(commentStart > -1, "la migracion debe incluir un bloque de rollback documental");
const liveSection = migration.slice(0, commentStart);
const rollbackSection = migration.slice(commentStart);

function countMatches(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].length;
}

function extractSignature(source: string, functionName: string): string {
  const pattern = new RegExp(
    `create or replace function public\\.${functionName}\\(([\\s\\S]*?)\\)\\s*\\nreturns uuid\\s*\\nlanguage plpgsql\\s*\\nsecurity definer\\s*\\nset search_path = public, pg_temp`,
  );
  const match = source.match(pattern);
  assert.ok(match, `no se encontro la firma vigente de ${functionName} en la fuente inspeccionada`);
  return match![1].trim();
}

function testAddsObservationColumn() {
  assert.match(
    liveSection,
    /alter table public\.exercise_entries\s*\n\s*add column if not exists observation text null;/,
    "debe agregar exercise_entries.observation como text null usando el patron if not exists del proyecto",
  );
}

function testDoesNotCreateNewTable() {
  assert.doesNotMatch(liveSection, /create table/i, "no debe crear ninguna tabla nueva");
}

function testDoesNotAddUniqueOrIndexConstraints() {
  assert.doesNotMatch(liveSection, /create unique index/i, "no debe agregar indices unicos nuevos");
  assert.doesNotMatch(liveSection, /create index/i, "no debe agregar indices nuevos");
  assert.doesNotMatch(
    liveSection,
    /unique\s*\(\s*session_id\s*,\s*exercise_lineage_id\s*\)/i,
    "no debe agregar un unique compuesto por session_id + exercise_lineage_id",
  );
}

function testPreservesCurrentRpcSignatures() {
  const entriesSignatureBefore = extractSignature(previousMigration, "create_training_session_with_entries");
  const entriesSignatureAfter = extractSignature(liveSection, "create_training_session_with_entries");
  assert.equal(
    entriesSignatureAfter,
    entriesSignatureBefore,
    "create_training_session_with_entries debe conservar exactamente la misma firma top-level",
  );

  const cycleSignatureBefore = extractSignature(
    previousMigration,
    "create_training_session_with_cycle_entries",
  );
  const cycleSignatureAfter = extractSignature(liveSection, "create_training_session_with_cycle_entries");
  assert.equal(
    cycleSignatureAfter,
    cycleSignatureBefore,
    "create_training_session_with_cycle_entries debe conservar exactamente la misma firma top-level",
  );
}

function testBothFunctionsRemainSecurityDefiner() {
  assert.equal(
    countMatches(liveSection, /^security definer$/m),
    2,
    "ambas funciones vigentes deben seguir siendo security definer",
  );
  assert.doesNotMatch(liveSection, /security invoker/, "la seccion vigente no debe degradar a security invoker");
}

function testBothFunctionsPreserveSearchPath() {
  assert.equal(
    countMatches(liveSection, /^set search_path = public, pg_temp$/m),
    2,
    "ambas funciones vigentes deben fijar search_path = public, pg_temp",
  );
}

function testBothFunctionsDeriveUserFromAuthUid() {
  assert.equal(
    countMatches(liveSection, /v_user_id uuid := auth\.uid\(\)/),
    2,
    "ambas funciones deben derivar el usuario internamente desde auth.uid()",
  );
}

function testNeitherFunctionAcceptsClientSuppliedUserId() {
  assert.doesNotMatch(liveSection, /p_user_id/, "ninguna RPC debe aceptar un user_id provisto por el cliente");
}

function testBothFunctionsInsertObservationNormalized() {
  assert.equal(
    countMatches(liveSection, /nullif\(btrim\(v_entry->>'observation'\), ''\)/),
    2,
    "ambas funciones deben normalizar observation con nullif(btrim(...), '')",
  );
  assert.equal(
    countMatches(liveSection, /^\s*observation$/m),
    2,
    "ambas funciones deben incluir la columna observation en su lista de columnas del insert",
  );
}

function testNotesRemainsPresentAndIndependent() {
  assert.equal(
    countMatches(liveSection, /nullif\(v_entry->>'notes', ''\)/),
    2,
    "notes debe seguir presente e inalterado en ambos inserts",
  );
  assert.doesNotMatch(
    liveSection,
    /nullif\(v_entry->>'notes', ''\),\s*\n\s*nullif\(btrim\(v_entry->>'observation'\), ''\)\)/,
    "notes no debe fusionarse con observation en una sola expresion",
  );
}

function testDocumentedRollbackExists() {
  assert.match(rollbackSection, /Rollback OBS-1/, "debe existir un bloque de rollback documental identificado");
  assert.match(
    rollbackSection,
    /alter table public\.exercise_entries\s*\n\s*drop column if exists observation;/,
    "el rollback debe eliminar unicamente la columna observation",
  );
  assert.equal(
    countMatches(rollbackSection, /create or replace function public\.create_training_session_with/),
    2,
    "el rollback debe restaurar ambas funciones a su version previa sin observation",
  );
  assert.doesNotMatch(
    rollbackSection,
    /nullif\(btrim\(v_entry->>'observation'\), ''\)/,
    "las funciones restauradas en el rollback no deben insertar observation",
  );
}

function testDoesNotTouchReadinessTables() {
  assert.doesNotMatch(
    liveSection,
    /training_daily_readiness|training_workout_readiness/,
    "esta migracion no debe tocar las tablas del dominio de readiness",
  );
}

testAddsObservationColumn();
testDoesNotCreateNewTable();
testDoesNotAddUniqueOrIndexConstraints();
testPreservesCurrentRpcSignatures();
testBothFunctionsRemainSecurityDefiner();
testBothFunctionsPreserveSearchPath();
testBothFunctionsDeriveUserFromAuthUid();
testNeitherFunctionAcceptsClientSuppliedUserId();
testBothFunctionsInsertObservationNormalized();
testNotesRemainsPresentAndIndependent();
testDocumentedRollbackExists();
testDoesNotTouchReadinessTables();

console.log("exercise-entry-observation-migration tests passed");
