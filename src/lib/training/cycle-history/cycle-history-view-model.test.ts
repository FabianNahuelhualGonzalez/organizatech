import assert from "node:assert/strict";

import { buildCycleHistoryBreakdown } from "@/lib/training/cycle-history/cycle-history-breakdown";
import { buildCycleHistoryMetricsSummary } from "@/lib/training/cycle-history/cycle-history-metrics";
import { buildCycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type { CycleHistoryDetail } from "@/lib/training/cycle-history/cycle-history-service";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryEntryRow,
  CycleHistoryPersonalData,
  CycleHistoryPlan,
  CycleHistorySessionRow,
} from "@/lib/training/cycle-history/cycle-history-types";
import {
  NEUTRAL_MISSING_VALUE_LABEL,
  buildCycleHistoryCardViewModel,
  buildCycleHistoryDetailDomId,
  buildCycleHistoryDetailViewModel,
  buildCycleHistoryErrorViewModel,
  buildCycleHistoryHeadingDomId,
  buildCycleHistoryListViewModels,
  isCycleHistoryPdfActionDisabled,
  resolveNextExpandedCycleId,
  sanitizeCycleHistoryDomId,
} from "@/lib/training/cycle-history/cycle-history-view-model";

const CYCLE_WITH_METADATA: CycleHistoryCycleMetadata = {
  cycleId: "cycle-3",
  name: "Mesociclo",
  cycleNumber: 3,
  cycleType: "Hipertrofia",
  status: "completed",
  plannedStartDate: "2026-06-01",
  plannedEndDate: "2026-06-28",
  startedAt: "2026-06-01T12:00:00.000Z",
  endedAt: "2026-06-28T12:00:00.000Z",
  durationWeeks: 4,
};

const CYCLE_WITHOUT_METADATA: CycleHistoryCycleMetadata = {
  cycleId: "cycle-active",
  name: "Macrociclo",
  cycleNumber: 4,
  cycleType: null,
  status: "active",
  plannedStartDate: null,
  plannedEndDate: null,
  startedAt: "2026-07-01T12:00:00.000Z",
  endedAt: null,
  durationWeeks: null,
};

const PLAN: CycleHistoryPlan = {
  cycleId: "cycle-3",
  routines: [
    {
      id: "routine-1",
      name: "Torso Fuerza",
      sortOrder: 0,
      days: [
        {
          id: "day-1",
          routineId: "routine-1",
          weekIndex: 1,
          dayCode: "monday",
          sortOrder: 0,
          exercises: [
            {
              id: "cycle-exercise-1",
              name: "Press militar",
              targetSets: 4,
              targetReps: 10,
              baseWeight: 100,
              sortOrder: 0,
              exerciseLineageId: "lineage-1",
            },
          ],
        },
      ],
    },
  ],
};

const SESSIONS: CycleHistorySessionRow[] = [
  { id: "session-1", cycleId: "cycle-3", routineId: "routine-1", routineName: "Torso Fuerza", trainedDate: "2026-06-01" },
  { id: "session-2", cycleId: "cycle-3", routineId: "routine-1", routineName: "Torso Fuerza", trainedDate: "2026-06-08" },
];

const ENTRIES: CycleHistoryEntryRow[] = [
  { id: "entry-1", sessionId: "session-1", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 100, reps: [10, 10, 10, 8] },
  { id: "entry-2", sessionId: "session-2", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 105, reps: [10, 10, 10, 10] },
];

const PERSONAL_DATA: CycleHistoryPersonalData = {
  firstName: "Ana",
  lastName: "Soto",
  email: "ana@example.com",
  birthDate: "1995-05-05",
  gender: "female",
  phoneNumber: "+56900000000",
};

function buildDetail(): CycleHistoryDetail {
  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: CYCLE_WITH_METADATA.cycleId,
    plan: PLAN,
    sessions: SESSIONS,
    entries: ENTRIES,
    plannedStartDate: CYCLE_WITH_METADATA.plannedStartDate,
  });
  const metrics = buildCycleHistoryMetricsSummary(breakdown);
  return {
    metadata: CYCLE_WITH_METADATA,
    plan: PLAN,
    breakdown,
    metrics,
    pdfModel: buildCycleHistoryPdfModel({
      cycle: CYCLE_WITH_METADATA,
      breakdown,
      personalData: PERSONAL_DATA,
      generatedAt: "2026-07-21T12:00:00.000Z",
    }),
    sessionCount: SESSIONS.length,
    entryCount: ENTRIES.length,
  };
}

// 1. Mapper de ciclo contraído.
function testCardViewModelMapsRealFields() {
  const card = buildCycleHistoryCardViewModel(CYCLE_WITH_METADATA);
  assert.equal(card.cycleId, "cycle-3");
  assert.equal(card.title, "Mesociclo");
  assert.equal(card.eyebrowLabel, "Ciclo 3");
  assert.equal(card.cycleTypeLabel, "Hipertrofia");
  assert.equal(card.statusLabel, "Completado");
  assert.equal(card.dateRangeLabel, "01-06-2026 — 28-06-2026");
  assert.equal(card.durationLabel, "4 semanas");
}

function testListViewModelsPreserveOrderAndDoNotMutateInput() {
  const cycles = [CYCLE_WITH_METADATA, CYCLE_WITHOUT_METADATA];
  const snapshot = JSON.parse(JSON.stringify(cycles));
  const cards = buildCycleHistoryListViewModels(cycles);

  assert.deepEqual(cards.map((card) => card.cycleId), ["cycle-3", "cycle-active"]);
  assert.deepEqual(cycles, snapshot, "el array/objetos de entrada no deben mutarse");
}

// 2. Mapper de detalle.
function testDetailViewModelMapsRealMetricsAndBreakdown() {
  const detail = buildDetail();
  const viewModel = buildCycleHistoryDetailViewModel(detail);

  assert.equal(viewModel.cycleId, "cycle-3");
  assert.equal(viewModel.metricCards.length, 2);
  assert.equal(viewModel.metricCards[0]?.label, "Volumen total registrado");
  assert.equal(viewModel.metricCards[1]?.label, "Ejercicios registrados");
  assert.equal(viewModel.metricCards[1]?.value, String(detail.metrics.registeredExerciseCount));
  assert.equal(viewModel.routines.length, 1);
  assert.equal(viewModel.routines[0]?.name, "Torso Fuerza");
  assert.equal(viewModel.routines[0]?.exercises[0]?.name, "Press militar");
  assert.deepEqual(
    viewModel.routines[0]?.exercises[0]?.weeks.map((week) => week.week),
    [1, 2],
  );
}

// 3. No mutación de entradas H1-B.
function testDetailViewModelDoesNotMutateInput() {
  const detail = buildDetail();
  const snapshot = JSON.parse(JSON.stringify(detail));
  buildCycleHistoryDetailViewModel(detail);
  assert.deepEqual(detail, snapshot, "buildCycleHistoryDetailViewModel no debe mutar breakdown/metrics/plan/pdfModel");
}

function testErrorViewModelExposesOnlySanitizedFields() {
  const viewModel = buildCycleHistoryErrorViewModel({ code: "unexpected", message: "No pudimos cargar el detalle de este ciclo." });
  assert.deepEqual(viewModel, { message: "No pudimos cargar el detalle de este ciclo.", code: "unexpected" });
}

// 11 y 12. Expansión controlada: un único expandedCycleId, y contracción del ciclo actual.
function testExpansionRuleTogglesSingleCycle() {
  assert.equal(resolveNextExpandedCycleId(null, "cycle-1"), "cycle-1");
  assert.equal(resolveNextExpandedCycleId("cycle-1", "cycle-2"), "cycle-2", "expandir otro ciclo reemplaza al unico expandido");
  assert.equal(resolveNextExpandedCycleId("cycle-1", "cycle-1"), null, "pulsar el mismo ciclo expandido lo contrae");
}

// 15. Botón PDF deshabilitado durante loading o sin detalle.
function testPdfActionDisabledLogic() {
  assert.equal(isCycleHistoryPdfActionDisabled("idle"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("disabled"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("loading"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("empty"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("error"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("ready"), false);
  assert.equal(isCycleHistoryPdfActionDisabled("ready", true), true, "una descarga en curso deshabilita el boton aunque el detalle este listo");
}

// 16. Métricas sin valores inventados: el valor mostrado proviene exactamente de metrics.totalVolumeKg/registeredExerciseCount.
function testMetricsAreNotInvented() {
  const detail = buildDetail();
  const viewModel = buildCycleHistoryDetailViewModel(detail);
  const expectedVolumeLabel = `${Math.round(detail.metrics.totalVolumeKg).toLocaleString("es-CL")} kg`;

  assert.equal(viewModel.metricCards[0]?.value, expectedVolumeLabel);
  assert.equal(viewModel.metricCards[1]?.value, String(detail.metrics.registeredExerciseCount));
  assert.equal(viewModel.volumeProgress.text.length > 0, true);
}

// 17. Ausencia neutral de metadata faltante (fechas y duración nulas).
function testMissingMetadataUsesNeutralLabel() {
  const card = buildCycleHistoryCardViewModel(CYCLE_WITHOUT_METADATA);
  assert.equal(card.dateRangeLabel, NEUTRAL_MISSING_VALUE_LABEL);
  assert.equal(card.durationLabel, NEUTRAL_MISSING_VALUE_LABEL);
  assert.equal(card.cycleTypeLabel, null, "cycleType ausente se mantiene null, no se inventa texto");
}

// Ausencia neutral parcial: un solo lado del rango presente.
function testPartialDateRangeShowsRealValueAndNeutralForMissingSide() {
  const card = buildCycleHistoryCardViewModel({
    ...CYCLE_WITHOUT_METADATA,
    plannedStartDate: "2026-07-01",
    plannedEndDate: null,
  });
  assert.equal(card.dateRangeLabel, `01-07-2026 — ${NEUTRAL_MISSING_VALUE_LABEL}`);
}

// Ejercicio sin pauta disponible: planLabel debe ser null (la UI decide mostrar "Sin información"), no inventado.
function testExercisePlanLabelIsNullWithoutPlan() {
  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: "cycle-3",
    plan: { cycleId: "cycle-3", routines: [] },
    sessions: SESSIONS,
    entries: [
      { id: "entry-orphan", sessionId: "session-1", exerciseLineageId: null, trainingCycleExerciseId: null, exerciseName: "Ejercicio retirado", weight: 50, reps: [10] },
    ],
    plannedStartDate: "2026-06-01",
  });
  const metrics = buildCycleHistoryMetricsSummary(breakdown);
  const detail: CycleHistoryDetail = {
    metadata: CYCLE_WITH_METADATA,
    plan: { cycleId: "cycle-3", routines: [] },
    breakdown,
    metrics,
    pdfModel: buildCycleHistoryPdfModel({ cycle: CYCLE_WITH_METADATA, breakdown, personalData: PERSONAL_DATA, generatedAt: "2026-07-21T12:00:00.000Z" }),
    sessionCount: SESSIONS.length,
    entryCount: 1,
  };

  const viewModel = buildCycleHistoryDetailViewModel(detail);
  const orphanExercise = viewModel.routines.flatMap((routine) => routine.exercises).find((exercise) => exercise.name === "Ejercicio retirado");
  assert.ok(orphanExercise);
  assert.equal(orphanExercise?.planLabel, null);
}

// H1-C.1 — sanitizeCycleHistoryDomId: determinismo y estabilidad para el mismo valor.
function testSanitizeDomIdIsDeterministicAndStable() {
  const uuid = "6f1a9b3e-2c4d-4a5b-8e9f-1234567890ab";
  const first = sanitizeCycleHistoryDomId(uuid);
  const second = sanitizeCycleHistoryDomId(uuid);
  assert.equal(first, second, "el mismo cycleId debe producir siempre el mismo id DOM");
  assert.equal(sanitizeCycleHistoryDomId("cycle-3"), sanitizeCycleHistoryDomId("cycle-3"));
}

// H1-C.1 — sin espacios ni caracteres problemáticos para selectores/atributos.
function testSanitizeDomIdRemovesUnsafeCharacters() {
  const withSpaces = sanitizeCycleHistoryDomId("cycle with spaces");
  const withSymbols = sanitizeCycleHistoryDomId('a/b?c#d:e"fñé');
  for (const value of [withSpaces, withSymbols]) {
    assert.doesNotMatch(value, /\s/);
    assert.doesNotMatch(value, /[/?#:"]/);
    assert.match(value, /^[a-zA-Z0-9_-]+$/, "solo debe contener caracteres seguros para un id DOM");
  }
}

// H1-C.1 — evita colisiones triviales entre valores distintos que comparten el mismo fragmento base.
function testSanitizeDomIdAvoidsTrivialCollisions() {
  const a = sanitizeCycleHistoryDomId("a/b");
  const b = sanitizeCycleHistoryDomId("a?b");
  const c = sanitizeCycleHistoryDomId("a b");
  assert.notEqual(a, b, "cycleIds distintos no deben producir el mismo id DOM aunque compartan el mismo fragmento base");
  assert.notEqual(a, c);
  assert.notEqual(b, c);
}

// H1-C.1 — string vacío o compuesto solo por caracteres removibles produce un id válido y no vacío.
function testSanitizeDomIdHandlesEmptyOrFullyRemovableInput() {
  const empty = sanitizeCycleHistoryDomId("");
  const onlySymbols = sanitizeCycleHistoryDomId("???");
  assert.ok(empty.length > 0);
  assert.match(empty, /^[a-zA-Z0-9_-]+$/);
  assert.ok(onlySymbols.length > 0);
  assert.match(onlySymbols, /^[a-zA-Z0-9_-]+$/);
  assert.notEqual(empty, onlySymbols, "entradas distintas (aunque ambas queden vacías tras sanitizar) no deben colisionar");
}

// H1-C.1 — los helpers de id de detalle/encabezado usan el mismo fragmento sanitizado, por lo que
// aria-controls (detailId) y aria-labelledby (headingId) referencian ids generados consistentemente
// para el mismo cycleId, y ambos difieren entre cycleIds distintos.
function testDetailAndHeadingDomIdsAreConsistentPerCycle() {
  const cycleId = "cycle with / weird? chars#1";
  const detailId = buildCycleHistoryDetailDomId(cycleId);
  const headingId = buildCycleHistoryHeadingDomId(cycleId);

  assert.equal(detailId, `cycle-history-detail-${sanitizeCycleHistoryDomId(cycleId)}`);
  assert.equal(headingId, `cycle-history-heading-${sanitizeCycleHistoryDomId(cycleId)}`);
  assert.notEqual(detailId, headingId);

  const otherCycleId = "cycle with / weird? chars#2";
  assert.notEqual(buildCycleHistoryDetailDomId(cycleId), buildCycleHistoryDetailDomId(otherCycleId));
  assert.notEqual(buildCycleHistoryHeadingDomId(cycleId), buildCycleHistoryHeadingDomId(otherCycleId));
}

// H1-C.1 — el cycleId real de dominio nunca se altera: solo el id DOM se normaliza.
function testSanitizingDomIdNeverMutatesTheRealCycleId() {
  const cycleId = "cycle/with spaces?and#symbols";
  const cardViewModel = buildCycleHistoryCardViewModel({ ...CYCLE_WITH_METADATA, cycleId });
  assert.equal(cardViewModel.cycleId, cycleId, "el cycleId expuesto a callbacks debe seguir siendo el original, sin sanitizar");
}

testCardViewModelMapsRealFields();
testListViewModelsPreserveOrderAndDoNotMutateInput();
testDetailViewModelMapsRealMetricsAndBreakdown();
testDetailViewModelDoesNotMutateInput();
testErrorViewModelExposesOnlySanitizedFields();
testExpansionRuleTogglesSingleCycle();
testPdfActionDisabledLogic();
testMetricsAreNotInvented();
testMissingMetadataUsesNeutralLabel();
testPartialDateRangeShowsRealValueAndNeutralForMissingSide();
testExercisePlanLabelIsNullWithoutPlan();
testSanitizeDomIdIsDeterministicAndStable();
testSanitizeDomIdRemovesUnsafeCharacters();
testSanitizeDomIdAvoidsTrivialCollisions();
testSanitizeDomIdHandlesEmptyOrFullyRemovableInput();
testDetailAndHeadingDomIdsAreConsistentPerCycle();
testSanitizingDomIdNeverMutatesTheRealCycleId();

console.log("cycle-history-view-model tests passed");
