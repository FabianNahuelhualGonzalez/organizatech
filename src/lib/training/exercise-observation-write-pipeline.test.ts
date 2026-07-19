import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeExerciseObservation,
  toPersistedExerciseObservation,
} from "@/lib/data/repository";

const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const repositorySource = readFileSync("src/lib/data/repository.ts", "utf8");
const cycleScopedRepositorySource = readFileSync(
  "src/lib/training/cycle-scoped-training-repository.ts",
  "utf8",
);
const progressTypesSource = readFileSync("src/lib/progress/types.ts", "utf8");

// 1. Draft nuevo inicia con observation = "".
function testNewDraftStartsWithEmptyObservation() {
  assert.match(
    appSource,
    /function createExerciseDraft\(exercise: ExerciseTemplate\): ExerciseDraft \{\s*\n\s*return \{[\s\S]*?observation: "",\s*\n\s*\};/,
    "createExerciseDraft debe inicializar observation en \"\"",
  );
}

// 2. Draft antiguo sin observation restaura "".
function testOldDraftWithoutObservationRestoresEmptyString() {
  assert.equal(normalizeExerciseObservation(undefined), "");
  assert.match(
    appSource,
    /observation: normalizeExerciseObservation\(draft\.observation\),/,
    "normalizeExerciseDrafts debe normalizar observation con normalizeExerciseObservation al restaurar el draft",
  );
}

// 3. Draft con observation conserva el texto.
function testDraftWithObservationKeepsText() {
  assert.equal(normalizeExerciseObservation("Buena ejecucion"), "Buena ejecucion");
  assert.equal(normalizeExerciseObservation("   "), "   ", "normalize para draft no recorta, solo decide string vs \"\"");
}

// 6. Texto no vacío se recorta antes de persistir.
function testNonEmptyTextIsTrimmedBeforePersisting() {
  assert.equal(toPersistedExerciseObservation("  Buena ejecucion  "), "Buena ejecucion");
}

// 7. Vacío se omite.
function testEmptyIsOmitted() {
  assert.equal(toPersistedExerciseObservation(""), undefined);
}

// 8. Solo espacios se omite.
function testWhitespaceOnlyIsOmitted() {
  assert.equal(toPersistedExerciseObservation("   "), undefined);
}

// 9. Payload legacy incluye observation valida.
function testLegacyPayloadIncludesValidObservation() {
  assert.match(
    repositorySource,
    /const observation = toPersistedExerciseObservation\(entry\.observation\);\s*\n\s*return \{[\s\S]*?\.\.\.\(observation \? \{ observation \} : \{\}\),/,
    "saveTrainingSessionWithEntries debe incluir observation en p_entries solo cuando exista texto normalizado",
  );
}

// 10. Payload cycle-scoped incluye observation valida.
function testCycleScopedPayloadIncludesValidObservation() {
  assert.match(
    cycleScopedRepositorySource,
    /const observation = toPersistedExerciseObservation\(entry\.observation\);\s*\n\s*return \{[\s\S]*?\.\.\.\(observation \? \{ observation \} : \{\}\),/,
    "createTrainingSessionWithCycleEntries debe incluir observation en p_entries solo cuando exista texto normalizado",
  );
  assert.match(
    cycleScopedRepositorySource,
    /import \{ toPersistedExerciseObservation \} from "@\/lib\/data\/repository";/,
    "cycle-scoped debe reutilizar el mismo helper de normalizacion que legacy, no una implementacion propia",
  );
}

// 11. notes permanece intacto e independiente.
function testNotesRemainsIndependent() {
  assert.match(
    repositorySource,
    /notes: entry\.notes \?\? "",\s*\n\s*\.\.\.\(observation \? \{ observation \} : \{\}\),/,
    "el payload legacy conserva notes sin cambios, con observation como propiedad aparte",
  );
  assert.match(
    cycleScopedRepositorySource,
    /notes: entry\.notes \?\? "",\s*\n\s*\.\.\.\(observation \? \{ observation \} : \{\}\),/,
    "el payload cycle-scoped conserva notes sin cambios, con observation como propiedad aparte",
  );
}

// 12. El payload no introduce exercise_lineage_id cliente en legacy.
function testLegacyPayloadDoesNotIntroduceClientLineage() {
  const legacyRpcBlock = repositorySource.match(
    /await supabase\.rpc\("create_training_session_with_entries",[\s\S]*?\}\);/,
  );
  assert.ok(legacyRpcBlock, "no se encontro la construccion del payload legacy hacia la RPC");
  assert.doesNotMatch(
    legacyRpcBlock![0],
    /exercise_lineage_id/,
    "el payload legacy no debe construir ni enviar exercise_lineage_id desde el cliente",
  );
}

// 13. El registro sigue siendo valido sin observation.
function testRegistrationRemainsValidWithoutObservation() {
  assert.equal(toPersistedExerciseObservation(undefined), undefined);
  assert.equal(toPersistedExerciseObservation(null), undefined);

  const observation = toPersistedExerciseObservation(undefined);
  const entryWithoutObservation = {
    exerciseId: "exercise-1",
    weight: 100,
    reps: [10, 10, 10],
    ...(observation ? { observation } : {}),
  };
  assert.ok(
    !("observation" in entryWithoutObservation),
    "un entry sin observation queda valido y sin la propiedad, no bloquea el registro",
  );
}

// 14. Demo/local conserva observation.
function testDemoLocalPreservesObservation() {
  assert.match(
    repositorySource,
    /notes: entry\.notes,\s*\n\s*rir: entry\.rir,\s*\n\s*observation: toPersistedExerciseObservation\(entry\.observation\),/,
    "las entries locales/demo deben conservar observation al construirse en saveTrainingSessionWithEntries",
  );
  assert.match(
    progressTypesSource,
    /notes\?: string;\s*\n\s*observation\?: string;/,
    "ExerciseEntry debe declarar observation como campo opcional junto a notes",
  );
}

// 15. Source-contract confirma que aun no existe una casilla visual en esta fase.
function testNoVisualObservationInputYet() {
  assert.doesNotMatch(
    appSource,
    /<textarea/,
    "esta fase no debe introducir ningun <textarea> visual todavia",
  );
  assert.doesNotMatch(
    appSource,
    /value=\{draft\.observation\}/,
    "esta fase no debe enlazar observation a un input/textarea controlado todavia",
  );
  assert.doesNotMatch(
    appSource,
    /placeholder=(["'`]).*[Oo]bservaci/,
    "esta fase no debe agregar placeholder de observacion en JSX todavia",
  );
}

// 16. Drafts historicos siguen siendo compatibles.
function testHistoricalDraftsRemainCompatible() {
  assert.equal(normalizeExerciseObservation(undefined), "");
  assert.equal(normalizeExerciseObservation(null), "");
  assert.equal(normalizeExerciseObservation(42), "");
  assert.equal(normalizeExerciseObservation(true), "");
  assert.equal(normalizeExerciseObservation({}), "");
  assert.equal(normalizeExerciseObservation([]), "");
}

testNewDraftStartsWithEmptyObservation();
testOldDraftWithoutObservationRestoresEmptyString();
testDraftWithObservationKeepsText();
testNonEmptyTextIsTrimmedBeforePersisting();
testEmptyIsOmitted();
testWhitespaceOnlyIsOmitted();
testLegacyPayloadIncludesValidObservation();
testCycleScopedPayloadIncludesValidObservation();
testNotesRemainsIndependent();
testLegacyPayloadDoesNotIntroduceClientLineage();
testRegistrationRemainsValidWithoutObservation();
testDemoLocalPreservesObservation();
testNoVisualObservationInputYet();
testHistoricalDraftsRemainCompatible();

console.log("exercise-observation-write-pipeline tests passed");
