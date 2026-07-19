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

// 15. [OBS-2B2] La casilla visual de observacion ya existe y esta conectada a draft.observation.
function testVisualObservationInputExistsAndIsConnectedToDraft() {
  assert.match(
    appSource,
    /<textarea\s*\n\s*id=\{observationFieldId\}/,
    "debe existir un <textarea> identificado por observationFieldId dentro del panel de referencia",
  );
  assert.match(
    appSource,
    /observationValue=\{draft\.observation\}/,
    "el valor pasado al panel debe provenir de draft.observation",
  );
  assert.match(
    appSource,
    /value=\{observationValue\}/,
    "el textarea debe estar controlado por observationValue (que a su vez viene de draft.observation)",
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

// [OBS-2B2 / PASO 7 caso 13-14] onChange actualiza exclusivamente el draft del ejercicio activo.
function testOnChangeUpdatesOnlyTheActiveExerciseDraft() {
  assert.match(
    appSource,
    /onObservationChange=\{\(value\) => updateDraft\(activeExercise, \{ observation: value \}\)\}/,
    "el cambio en el textarea debe llamar updateDraft con activeExercise y solo el campo observation",
  );
}

// [OBS-2B2 / PASO 7 caso 15] El draft activo se recalcula por exercise.id, aislando el texto al cambiar de ejercicio.
function testDraftIsRecomputedPerActiveExerciseId() {
  assert.match(
    appSource,
    /const draft = activeExercise \? normalizeExerciseDraft\(activeExercise, drafts\[activeExercise\.id\]\) : null;/,
    "el draft mostrado debe derivarse siempre de drafts[activeExercise.id], nunca de un valor compartido entre ejercicios",
  );
}

// [OBS-2B2 / PASO 7 caso 16] El historico nunca se copia al draft actual.
function testHistoryNeverAutofillsDraft() {
  assert.doesNotMatch(
    appSource,
    /updateDraft\([^)]*latestExerciseObservation/,
    "updateDraft nunca debe recibir latestExerciseObservation como fuente de datos",
  );
  assert.doesNotMatch(
    appSource,
    /updateDraft\([^)]*observationPresentation/,
    "updateDraft nunca debe recibir observationPresentation como fuente de datos",
  );
  assert.doesNotMatch(
    appSource,
    /observation:\s*observationPresentation/,
    "ningun draft debe inicializarse leyendo el texto historico de observationPresentation",
  );
}

// [OBS-2B2 / PASO 7 caso 17] El historico no se usa como placeholder del textarea.
function testHistoryIsNotUsedAsPlaceholder() {
  const textareaBlock = appSource.match(/<textarea[\s\S]*?\/>/);
  assert.ok(textareaBlock, "no se encontro el bloque JSX del textarea de observacion");
  assert.doesNotMatch(
    textareaBlock![0],
    /placeholder/,
    "el textarea de observacion no debe usar placeholder para mostrar el historico",
  );
}

// [OBS-2B2 / PASO 7 caso 18] El bloque de observacion no reutiliza notes.
function testObservationBlockDoesNotUseNotes() {
  const observationBlock = appSource.match(
    /<details className="exercise-reference-block observation"[\s\S]*?<\/details>/,
  );
  assert.ok(observationBlock, "no se encontro el bloque JSX de la observacion del ejercicio");
  assert.doesNotMatch(
    observationBlock![0],
    /\.notes\b/,
    "el bloque visual de observacion no debe leer ni mostrar notes",
  );
}

// [OBS-2B2 / PASO 7 caso 20] El texto se renderiza como texto plano, sin HTML/Markdown interpretado.
function testObservationTextRendersAsPlainText() {
  assert.doesNotMatch(
    appSource,
    /dangerouslySetInnerHTML/,
    "la funcionalidad de observacion no debe introducir dangerouslySetInnerHTML en ningun punto",
  );
}

// [OBS-2B2 / PASO 7 caso 22] El input de observacion vive a nivel ejercicio, no dentro del map de series.
function testObservationInputIsNotInsideSeriesMap() {
  const seriesRepGridBlock = appSource.match(/<div className="series-rep-grid">[\s\S]*?<\/div>\s*\n\s*<\/div>/);
  assert.ok(seriesRepGridBlock, "no se encontro el bloque series-rep-grid");
  assert.doesNotMatch(
    seriesRepGridBlock![0],
    /<textarea|exercise-observation/,
    "el textarea de observacion no debe estar dentro del grid/map de series",
  );
  assert.match(
    appSource,
    /function ExerciseLastPerformancePanel\(\{[\s\S]*?<textarea/,
    "el textarea de observacion debe vivir dentro de ExerciseLastPerformancePanel, a nivel ejercicio",
  );
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
testVisualObservationInputExistsAndIsConnectedToDraft();
testHistoricalDraftsRemainCompatible();
testOnChangeUpdatesOnlyTheActiveExerciseDraft();
testDraftIsRecomputedPerActiveExerciseId();
testHistoryNeverAutofillsDraft();
testHistoryIsNotUsedAsPlaceholder();
testObservationBlockDoesNotUseNotes();
testObservationTextRendersAsPlainText();
testObservationInputIsNotInsideSeriesMap();

console.log("exercise-observation-write-pipeline tests passed");
