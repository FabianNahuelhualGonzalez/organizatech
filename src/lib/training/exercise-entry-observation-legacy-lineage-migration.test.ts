import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260718_exercise_entries_observation_legacy_lineage.sql",
  "utf8",
);
const obs1Migration = readFileSync(
  "supabase/migrations/20260718_exercise_entries_observation.sql",
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

function testOnlyReplacesLegacyRpc() {
  assert.equal(
    countMatches(
      liveSection,
      /create or replace function public\.create_training_session_with_entries\(/,
    ),
    1,
    "debe reemplazar create_training_session_with_entries exactamente una vez",
  );
}

function testDoesNotTouchCycleScopedRpc() {
  assert.doesNotMatch(
    liveSection,
    /create or replace function public\.create_training_session_with_cycle_entries/,
    "no debe redefinir create_training_session_with_cycle_entries en la seccion vigente",
  );
  assert.doesNotMatch(
    rollbackSection,
    /create or replace function public\.create_training_session_with_cycle_entries/,
    "el rollback tampoco debe redefinir la RPC cycle-scoped",
  );
}

function testSignatureMatchesObs1() {
  const before = extractSignature(obs1Migration, "create_training_session_with_entries");
  const after = extractSignature(liveSection, "create_training_session_with_entries");
  assert.equal(after, before, "la firma top-level debe ser identica a la version vigente de OBS-1");
}

function testRemainsSecurityDefiner() {
  assert.equal(
    countMatches(liveSection, /^security definer$/m),
    1,
    "la RPC legacy debe seguir siendo security definer",
  );
  assert.doesNotMatch(liveSection, /security invoker/, "no debe degradar a security invoker");
}

function testPreservesSearchPath() {
  assert.equal(
    countMatches(liveSection, /^set search_path = public, pg_temp$/m),
    1,
    "debe fijar search_path = public, pg_temp",
  );
}

function testDerivesUserFromAuthUid() {
  assert.equal(
    countMatches(liveSection, /v_user_id uuid := auth\.uid\(\)/),
    1,
    "debe derivar el usuario internamente desde auth.uid()",
  );
}

function testDoesNotAcceptClientUserId() {
  assert.doesNotMatch(liveSection, /p_user_id/, "no debe aceptar un user_id provisto por el cliente");
}

function testDoesNotTrustClientLineage() {
  assert.doesNotMatch(
    liveSection,
    /v_entry->>'exercise_lineage_id'/,
    "no debe leer exercise_lineage_id del JSON del cliente en la ruta legacy",
  );
}

function testQueriesLineageByUserAndSourceLegacyExerciseId() {
  assert.match(
    liveSection,
    /from public\.training_exercise_lineages tel\s*\n\s*where tel\.user_id = v_user_id\s*\n\s*and tel\.source_legacy_exercise_id = v_exercise_id/,
    "debe resolver el lineage consultando training_exercise_lineages por user_id + source_legacy_exercise_id",
  );
}

function testAbortsWhenLineageMissing() {
  assert.match(
    liveSection,
    /if v_exercise_lineage_id is null then\s*\n\s*raise exception '[^']*';\s*\n\s*end if;/,
    "debe abortar con un error explicito si no existe lineage para el ejercicio legacy",
  );
}

function testInsertsExerciseLineageId() {
  assert.match(
    liveSection,
    /insert into public\.exercise_entries \([\s\S]*?exercise_lineage_id[\s\S]*?\)/,
    "el insert de exercise_entries debe incluir la columna exercise_lineage_id",
  );
  assert.match(
    liveSection,
    /values \([\s\S]*?v_exercise_lineage_id[\s\S]*?\)/,
    "el insert de exercise_entries debe usar v_exercise_lineage_id como valor",
  );
}

function testKeepsObservationNormalization() {
  assert.equal(
    countMatches(liveSection, /nullif\(btrim\(v_entry->>'observation'\), ''\)/),
    1,
    "debe seguir normalizando observation con nullif(btrim(...), '')",
  );
}

function testKeepsNotesIndependent() {
  assert.equal(
    countMatches(liveSection, /nullif\(v_entry->>'notes', ''\)/),
    1,
    "notes debe seguir presente e inalterado",
  );
}

function testDoesNotCreateSchemaObjects() {
  assert.doesNotMatch(liveSection, /create table/i, "no debe crear tablas");
  assert.doesNotMatch(liveSection, /create index/i, "no debe crear indices");
  assert.doesNotMatch(liveSection, /create unique index/i, "no debe crear indices unicos");
  assert.doesNotMatch(liveSection, /create policy/i, "no debe crear policies");
  assert.doesNotMatch(liveSection, /add constraint/i, "no debe agregar constraints");
}

function testDoesNotTouchReadiness() {
  assert.doesNotMatch(
    liveSection,
    /training_daily_readiness|training_workout_readiness/,
    "no debe tocar las tablas del dominio de readiness",
  );
}

function testRollbackIsDocumentedComment() {
  assert.ok(
    migration.trim().endsWith("*/"),
    "el archivo debe terminar con el cierre del bloque de rollback comentado",
  );
  assert.match(rollbackSection, /^\/\*/, "el rollback debe iniciar como bloque completamente comentado");
}

function testRollbackRestoresObs1Version() {
  const obs1Signature = extractSignature(obs1Migration, "create_training_session_with_entries");
  const rollbackPattern = new RegExp(
    "create or replace function public\\.create_training_session_with_entries\\(([\\s\\S]*?)\\)\\s*\\nreturns uuid\\s*\\nlanguage plpgsql\\s*\\nsecurity definer\\s*\\nset search_path = public, pg_temp",
  );
  const rollbackMatch = rollbackSection.match(rollbackPattern);
  assert.ok(rollbackMatch, "el rollback debe redefinir create_training_session_with_entries");
  assert.equal(
    rollbackMatch![1].trim(),
    obs1Signature,
    "el rollback debe restaurar exactamente la firma vigente de OBS-1",
  );

  assert.doesNotMatch(
    rollbackSection,
    /v_exercise_lineage_id/,
    "el rollback no debe resolver ni insertar exercise_lineage_id en la ruta legacy",
  );
  assert.match(
    rollbackSection,
    /nullif\(btrim\(v_entry->>'observation'\), ''\)/,
    "el rollback debe seguir guardando observation, igual que OBS-1",
  );
}

function testDoesNotDropObservationColumn() {
  assert.doesNotMatch(migration, /drop column/i, "no debe eliminar la columna observation en ningun bloque");
}

testOnlyReplacesLegacyRpc();
testDoesNotTouchCycleScopedRpc();
testSignatureMatchesObs1();
testRemainsSecurityDefiner();
testPreservesSearchPath();
testDerivesUserFromAuthUid();
testDoesNotAcceptClientUserId();
testDoesNotTrustClientLineage();
testQueriesLineageByUserAndSourceLegacyExerciseId();
testAbortsWhenLineageMissing();
testInsertsExerciseLineageId();
testKeepsObservationNormalization();
testKeepsNotesIndependent();
testDoesNotCreateSchemaObjects();
testDoesNotTouchReadiness();
testRollbackIsDocumentedComment();
testRollbackRestoresObs1Version();
testDoesNotDropObservationColumn();

console.log("exercise-entry-observation-legacy-lineage-migration tests passed");
