import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  hydrateLegacyExerciseTemplatesWithLineage,
  type LegacyExerciseLineageRow,
} from "@/lib/training/legacy-exercise-lineage-hydration";
import type { ExerciseTemplate } from "@/lib/progress/types";

const helperSource = readFileSync(
  "src/lib/training/legacy-exercise-lineage-hydration.ts",
  "utf8",
);
const repositorySource = readFileSync("src/lib/data/repository.ts", "utf8");
const cycleScopedRepositorySource = readFileSync(
  "src/lib/training/cycle-scoped-training-repository.ts",
  "utf8",
);

function createExercise(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    id: "exercise-1",
    routine: "Pecho Hombro Tríceps",
    name: "Press militar",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 100,
    ...overrides,
  };
}

function createLineage(overrides: Partial<LegacyExerciseLineageRow> = {}): LegacyExerciseLineageRow {
  return {
    id: "lineage-1",
    source_legacy_exercise_id: "exercise-1",
    ...overrides,
  };
}

// 1. Un ejercicio recibe el lineage correspondiente.
function testSingleExerciseReceivesMatchingLineage() {
  const [hydrated] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1" })],
    [createLineage({ id: "lineage-1", source_legacy_exercise_id: "exercise-1" })],
  );
  assert.equal(hydrated.exerciseLineageId, "lineage-1");
}

// 2. Dos ejercicios reciben lineages distintos.
function testTwoExercisesReceiveDistinctLineages() {
  const [first, second] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1" }), createExercise({ id: "exercise-2" })],
    [
      createLineage({ id: "lineage-1", source_legacy_exercise_id: "exercise-1" }),
      createLineage({ id: "lineage-2", source_legacy_exercise_id: "exercise-2" }),
    ],
  );
  assert.equal(first.exerciseLineageId, "lineage-1");
  assert.equal(second.exerciseLineageId, "lineage-2");
}

// 3. Dos ejercicios con el mismo nombre y distintos IDs no se mezclan.
function testSameNameDifferentIdsStayIsolated() {
  const [first, second] = hydrateLegacyExerciseTemplatesWithLineage(
    [
      createExercise({ id: "exercise-1", name: "Press militar" }),
      createExercise({ id: "exercise-2", name: "Press militar" }),
    ],
    [
      createLineage({ id: "lineage-1", source_legacy_exercise_id: "exercise-1" }),
      createLineage({ id: "lineage-2", source_legacy_exercise_id: "exercise-2" }),
    ],
  );
  assert.equal(first.name, second.name, "fixture: mismo nombre visible");
  assert.equal(first.exerciseLineageId, "lineage-1");
  assert.equal(second.exerciseLineageId, "lineage-2");
  assert.notEqual(first.exerciseLineageId, second.exerciseLineageId);
}

// 4. Falta mapping -> exerciseLineageId null.
function testMissingMappingYieldsNull() {
  const [hydrated] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1" })],
    [],
  );
  assert.equal(hydrated.exerciseLineageId, null);
}

// 5. sourceLegacyExerciseId queda igual a exercise.id.
function testSourceLegacyExerciseIdEqualsExerciseId() {
  const [hydrated] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-7" })],
    [],
  );
  assert.equal(hydrated.sourceLegacyExerciseId, "exercise-7");
}

// 6. Una fila lineage ajena se ignora.
function testUnrelatedLineageRowIsIgnored() {
  const [hydrated] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1" })],
    [createLineage({ id: "lineage-other", source_legacy_exercise_id: "exercise-other" })],
  );
  assert.equal(hydrated.exerciseLineageId, null);
}

// 7. No existe fallback por nombre.
function testNoFallbackByName() {
  const [hydrated] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1", name: "Press militar" })],
    [createLineage({ id: "lineage-name-collision", source_legacy_exercise_id: "exercise-other" })],
  );
  assert.equal(hydrated.exerciseLineageId, null, "un nombre igual no debe producir match sin id igual");
  assert.doesNotMatch(helperSource, /exercise\.name|\.name ===/);
}

// 8. No existe fallback por rutina.
function testNoFallbackByRoutine() {
  const [hydrated] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1", routine: "Pecho Hombro Tríceps" })],
    [createLineage({ id: "lineage-routine-collision", source_legacy_exercise_id: "exercise-other" })],
  );
  assert.equal(hydrated.exerciseLineageId, null, "una rutina igual no debe producir match sin id igual");
  assert.doesNotMatch(helperSource, /exercise\.routine/);
}

// 9. El array original no se muta.
function testOriginalArrayIsNotMutated() {
  const original = [createExercise({ id: "exercise-1" })];
  const snapshotIds = original.map((exercise) => exercise.id);
  hydrateLegacyExerciseTemplatesWithLineage(original, [createLineage()]);
  assert.deepEqual(original.map((exercise) => exercise.id), snapshotIds);
  assert.equal(original[0].exerciseLineageId, undefined, "el objeto original no debe adquirir exerciseLineageId");
}

// 10. Los objetos originales no se mutan.
function testOriginalObjectsAreNotMutated() {
  const exercise = createExercise({ id: "exercise-1" });
  const snapshot = { ...exercise };
  hydrateLegacyExerciseTemplatesWithLineage(
    [exercise],
    [createLineage({ source_legacy_exercise_id: "exercise-1" })],
  );
  assert.deepEqual(exercise, snapshot);
}

// 11. Lista vacia retorna lista vacia.
function testEmptyListReturnsEmptyList() {
  assert.deepEqual(hydrateLegacyExerciseTemplatesWithLineage([], []), []);
  assert.deepEqual(hydrateLegacyExerciseTemplatesWithLineage([], [createLineage()]), []);
}

// 12. Lineages vacios producen null para cada ejercicio.
function testEmptyLineagesProduceNullForEveryExercise() {
  const hydrated = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "exercise-1" }), createExercise({ id: "exercise-2" })],
    [],
  );
  assert.equal(hydrated[0].exerciseLineageId, null);
  assert.equal(hydrated[1].exerciseLineageId, null);
}

// --- Source-contract sobre repository.ts ---

// 13. Consulta training_exercise_lineages.
function testRepositoryQueriesTrainingExerciseLineages() {
  assert.match(repositorySource, /\.from\("training_exercise_lineages"\)/);
}

// 14. Filtra por user_id.
function testRepositoryFiltersByUserId() {
  assert.match(
    repositorySource,
    /\.from\("training_exercise_lineages"\)\s*\n\s*\.select\("id,source_legacy_exercise_id"\)\s*\n\s*\.eq\("user_id", userId\)/,
    "la consulta de lineages debe filtrar explicitamente por user_id ademas de RLS",
  );
}

// 15. Filtra por source_legacy_exercise_id.
function testRepositoryFiltersBySourceLegacyExerciseId() {
  assert.match(
    repositorySource,
    /\.in\("source_legacy_exercise_id", legacyExercises\.map\(\(exercise\) => exercise\.id\)\)/,
    "la consulta de lineages debe limitarse a los exercise ids ya cargados",
  );
}

// 16. No consulta por name.
function testRepositoryDoesNotQueryLineagesByName() {
  const lineageBlock = repositorySource.match(/\.from\("training_exercise_lineages"\)[\s\S]*?;/);
  assert.ok(lineageBlock, "no se encontro la construccion de la consulta de lineages");
  assert.doesNotMatch(lineageBlock![0], /\bname\b/);
}

// 17. No ejecuta la consulta lineage cuando exercises esta vacio.
function testRepositorySkipsLineageQueryWhenNoExercises() {
  assert.match(
    repositorySource,
    /if \(legacyExercises\.length === 0\) return legacyExercises;/,
    "debe retornar temprano sin consultar training_exercise_lineages si no hay ejercicios",
  );
}

// 18. Usa el helper puro.
function testRepositoryUsesPureHelper() {
  assert.match(repositorySource, /import \{\s*hydrateLegacyExerciseTemplatesWithLineage,/);
  assert.match(repositorySource, /return hydrateLegacyExerciseTemplatesWithLineage\(/);
}

// 19. No modifica cycle-scoped.
function testCycleScopedRepositoryUntouched() {
  assert.doesNotMatch(cycleScopedRepositorySource, /legacy-exercise-lineage-hydration/);
  assert.doesNotMatch(cycleScopedRepositorySource, /hydrateLegacyExerciseTemplatesWithLineage/);
}

// 20. No introduce fallback por exerciseName.
function testNoExerciseNameFallbackIntroduced() {
  const fetchExercisesBlock = repositorySource.match(/async function fetchExercises\([\s\S]*?\n\}\n/);
  assert.ok(fetchExercisesBlock, "no se encontro el cuerpo completo de fetchExercises");
  assert.doesNotMatch(fetchExercisesBlock![0], /exerciseName/);
}

testSingleExerciseReceivesMatchingLineage();
testTwoExercisesReceiveDistinctLineages();
testSameNameDifferentIdsStayIsolated();
testMissingMappingYieldsNull();
testSourceLegacyExerciseIdEqualsExerciseId();
testUnrelatedLineageRowIsIgnored();
testNoFallbackByName();
testNoFallbackByRoutine();
testOriginalArrayIsNotMutated();
testOriginalObjectsAreNotMutated();
testEmptyListReturnsEmptyList();
testEmptyLineagesProduceNullForEveryExercise();
testRepositoryQueriesTrainingExerciseLineages();
testRepositoryFiltersByUserId();
testRepositoryFiltersBySourceLegacyExerciseId();
testRepositoryDoesNotQueryLineagesByName();
testRepositorySkipsLineageQueryWhenNoExercises();
testRepositoryUsesPureHelper();
testCycleScopedRepositoryUntouched();
testNoExerciseNameFallbackIntroduced();

console.log("legacy-exercise-lineage-hydration tests passed");
