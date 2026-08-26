import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  normalizeExerciseObservation,
  toPersistedExerciseObservation,
} from "@/lib/data/repository";
import { normalizeExerciseDrafts } from "@/lib/training/training-exercise-draft";

// Las lecturas source-based siguientes son contratos estaticos; no renderizan React ni sustituyen tests runtime.
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const exerciseDraftSource = readFileSync("src/lib/training/training-exercise-draft.ts", "utf8");
const exercisePanelSource = readFileSync("src/features/active-workout/components/ExerciseLastPerformancePanel.tsx", "utf8");
const guidedScreenSource = readFileSync("src/features/active-workout/components/GuidedTrainingScreen.tsx", "utf8");
const sheetBoundarySource = readFileSync(
  "src/features/active-workout/components/ActiveWorkoutSheetBoundary.tsx",
  "utf8",
);
const registrationSheetSource = readFileSync(
  "src/features/active-workout/components/ExerciseRegistrationSheet.tsx",
  "utf8",
);
const activeWorkoutStylesSource = readFileSync(
  "src/features/active-workout/active-workout.module.css",
  "utf8",
);
const activeWorkoutSources = [
  appSource,
  guidedScreenSource,
  sheetBoundarySource,
  registrationSheetSource,
  exercisePanelSource,
].join("\n");
const repositorySource = readFileSync("src/lib/data/repository.ts", "utf8");
const cycleScopedRepositorySource = readFileSync(
  "src/lib/training/cycle-scoped-training-repository.ts",
  "utf8",
);
const progressTypesSource = readFileSync("src/lib/progress/types.ts", "utf8");

// 1. Draft nuevo inicia con observation = "".
function testNewDraftStartsWithEmptyObservation() {
  assert.match(
    exerciseDraftSource,
    /export function createExerciseDraft\(exercise: ExerciseTemplate\): ExerciseDraft \{\s*\n\s*return \{[\s\S]*?observation: "",\s*\n\s*\};/,
    "createExerciseDraft debe inicializar observation en \"\"",
  );
}

// 2. Draft antiguo sin observation restaura "".
function testOldDraftWithoutObservationRestoresEmptyString() {
  assert.equal(normalizeExerciseObservation(undefined), "");
  const normalized = normalizeExerciseDrafts({
    "exercise-1": { weight: "80", rir: "2", reps: [10], registered: false },
  });
  assert.equal(normalized["exercise-1"]?.observation, "");
  assert.match(exerciseDraftSource, /observation: normalizeDraftObservation\(draft\.observation\),/);
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
    exercisePanelSource,
    /<textarea\s*\n\s*id=\{observationFieldId\}/,
    "debe existir un <textarea> identificado por observationFieldId dentro del panel de referencia",
  );
  assert.match(
    sheetBoundarySource,
    /observationValue=\{draft\.observation\}/,
    "el valor pasado al panel debe provenir de draft.observation",
  );
  assert.match(
    exercisePanelSource,
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
    sheetBoundarySource,
    /onObservationChange=\{\(value\) => updateSelectedExerciseDraft\(\{ observation: value \}\)\}/,
    "el cambio del textarea debe entrar por la allowlist del draft con solo observation",
  );
  assert.match(
    sheetBoundarySource,
    /function updateSelectedExerciseDraft\(patch: EditableExerciseDraftPatch\)[\s\S]*?updateDraft\(activeExercise, patch\);/,
    "la allowlist debe actualizar exclusivamente el draft del ejercicio activo",
  );
}

// [OBS-2B2 / PASO 7 caso 15] El draft activo se recalcula por exercise.id, aislando el texto al cambiar de ejercicio.
function testDraftIsRecomputedPerActiveExerciseId() {
  assert.match(
    sheetBoundarySource,
    /const draft = activeExercise[\s\S]*?normalizeExerciseDraft\(activeExercise, drafts\[activeExercise\.id\]\)[\s\S]*?: null;/,
    "el draft mostrado debe derivarse siempre de drafts[activeExercise.id], nunca de un valor compartido entre ejercicios",
  );
}

// [OBS-2B2 / PASO 7 caso 16] El historico nunca se copia al draft actual.
function testHistoryNeverAutofillsDraft() {
  assert.doesNotMatch(
    activeWorkoutSources,
    /updateDraft\([^)]*latestExerciseObservation/,
    "updateDraft nunca debe recibir latestExerciseObservation como fuente de datos",
  );
  assert.doesNotMatch(
    activeWorkoutSources,
    /updateDraft\([^)]*observationPresentation/,
    "updateDraft nunca debe recibir observationPresentation como fuente de datos",
  );
  assert.doesNotMatch(
    activeWorkoutSources,
    /observation:\s*observationPresentation/,
    "ningun draft debe inicializarse leyendo el texto historico de observationPresentation",
  );
}

// [OBS-2B2 / PASO 7 caso 17] El historico no se usa como placeholder del textarea.
function testHistoryIsNotUsedAsPlaceholder() {
  const textareaBlock = exercisePanelSource.match(/<textarea[\s\S]*?\/>/);
  assert.ok(textareaBlock, "no se encontro el bloque JSX del textarea de observacion");
  assert.doesNotMatch(
    textareaBlock![0],
    /placeholder/,
    "el textarea de observacion no debe usar placeholder para mostrar el historico",
  );
}

// [OBS-2B2 / PASO 7 caso 18] El bloque de observacion no reutiliza notes.
function testObservationBlockDoesNotUseNotes() {
  const observationBlock = exercisePanelSource.match(
    /<section[\s\S]*?id=\{commentPanelId\}[\s\S]*?aria-label="Comentario del ejercicio"[\s\S]*?<\/section>/,
  );
  assert.ok(observationBlock, "no se encontro la seccion productiva de observacion del ejercicio");
  assert.doesNotMatch(
    observationBlock![0],
    /\.notes\b/,
    "el bloque visual de observacion no debe leer ni mostrar notes",
  );
  assert.doesNotMatch(
    observationBlock![0],
    /<details|<summary|exercise-reference-block|exercise-observation-content/,
    "la seccion productiva no debe conservar wrappers disclosure ni clases globales legacy",
  );
}

// [OBS-2B2 / PASO 7 caso 20] El texto se renderiza como texto plano, sin HTML/Markdown interpretado.
function testObservationTextRendersAsPlainText() {
  assert.doesNotMatch(
    activeWorkoutSources,
    /dangerouslySetInnerHTML/,
    "la funcionalidad de observacion no debe introducir dangerouslySetInnerHTML en ningun punto",
  );
  assert.match(
    activeWorkoutStylesSource,
    /\.sheetObservationText \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: pre-wrap;/,
    "el comentario histórico productivo debe conservar saltos y cortar texto largo sin HTML",
  );
}

// [OBS-2B2 / PASO 7 caso 22] El input de observacion vive a nivel ejercicio, no dentro del map de series.
function testObservationInputIsNotInsideSeriesMap() {
  const seriesFieldset = registrationSheetSource.match(
    /<fieldset className=\{styles\.workoutSeriesField\}>[\s\S]*?<\/fieldset>/,
  );
  assert.ok(seriesFieldset, "no se encontro el fieldset productivo de series");
  assert.match(
    seriesFieldset[0],
    /\{draft\.reps\.map\(/,
    "el fieldset productivo debe renderizar las series desde el draft",
  );
  assert.doesNotMatch(
    seriesFieldset[0],
    /<textarea|observationValue|onObservationChange/,
    "el textarea de observacion no debe estar dentro del fieldset/map de series",
  );
  const panelUsage = registrationSheetSource.match(
    /<ExerciseLastPerformancePanel[\s\S]*?\/>/,
  );
  assert.ok(panelUsage, "no se encontro el panel productivo de historial/observacion");
  assert.match(panelUsage[0], /observationValue=\{observationValue\}/);
  assert.match(panelUsage[0], /onObservationChange=\{onObservationChange\}/);
  assert.doesNotMatch(
    activeWorkoutSources,
    /series-rep-grid/,
    "no debe existir un marcador DOM/CSS legacy para simular el grid productivo",
  );
  assert.match(
    exercisePanelSource,
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
