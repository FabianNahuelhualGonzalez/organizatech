import assert from "node:assert/strict";

import { buildCycleHistoryBreakdown } from "@/lib/training/cycle-history/cycle-history-breakdown";
import {
  buildCycleHistoryMetricsSummary,
  describeCycleHistoryVolumeProgress,
} from "@/lib/training/cycle-history/cycle-history-metrics";
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
  trainingDayCount: 3,
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
  trainingDayCount: null,
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

function buildDetailFrom(
  metadata: CycleHistoryCycleMetadata,
  plan: CycleHistoryPlan,
  sessions: CycleHistorySessionRow[],
  entries: CycleHistoryEntryRow[],
): CycleHistoryDetail {
  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: metadata.cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: metadata.plannedStartDate,
  });
  const metrics = buildCycleHistoryMetricsSummary(breakdown);
  return {
    metadata,
    plan,
    breakdown,
    metrics,
    pdfModel: buildCycleHistoryPdfModel({
      cycle: metadata,
      breakdown,
      personalData: PERSONAL_DATA,
      generatedAt: "2026-07-21T12:00:00.000Z",
    }),
    sessionCount: sessions.length,
    entryCount: entries.length,
  };
}

function buildDetail(): CycleHistoryDetail {
  return buildDetailFrom(CYCLE_WITH_METADATA, PLAN, SESSIONS, ENTRIES);
}

// 1. Mapper de barra de ciclo contraído/seleccionado (diseño H1-C.2), con semanas + días reales.
function testCardViewModelMapsRealFields() {
  const card = buildCycleHistoryCardViewModel(CYCLE_WITH_METADATA);
  assert.equal(card.cycleId, "cycle-3");
  assert.equal(card.barLabel, "Ciclo de entrenamiento 3: Mesociclo | 4 semanas | 3 días de entrenamiento");
  assert.equal(card.dateRowLabel, "01-06-2026 | 28-06-2026");
}

function testListViewModelsPreserveOrderAndDoNotMutateInput() {
  const cycles = [CYCLE_WITH_METADATA, CYCLE_WITHOUT_METADATA];
  const snapshot = JSON.parse(JSON.stringify(cycles));
  const cards = buildCycleHistoryListViewModels(cycles);

  assert.deepEqual(cards.map((card) => card.cycleId), ["cycle-3", "cycle-active"]);
  assert.deepEqual(cycles, snapshot, "el array/objetos de entrada no deben mutarse");
}

// 2. Mapper de detalle: exactamente las 3 métricas reales del diseño aprobado.
function testDetailViewModelMapsRealMetrics() {
  const detail = buildDetail();
  const viewModel = buildCycleHistoryDetailViewModel(detail);

  assert.equal(viewModel.cycleId, "cycle-3");
  assert.equal(viewModel.metricCards.length, 3);
  assert.equal(viewModel.metricCards[0]?.label, "Volumen registrado");
  assert.equal(viewModel.metricCards[1]?.label, "Total volumen progreso");
  assert.equal(viewModel.metricCards[2]?.label, "Ejercicios registrados");
  assert.equal(viewModel.metricCards[2]?.value, String(detail.metrics.registeredExerciseCount));
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

// 21. Expansión controlada: un único expandedCycleId, y contracción del ciclo actual.
function testExpansionRuleTogglesSingleCycle() {
  assert.equal(resolveNextExpandedCycleId(null, "cycle-1"), "cycle-1");
  assert.equal(resolveNextExpandedCycleId("cycle-1", "cycle-2"), "cycle-2", "expandir otro ciclo reemplaza al unico expandido");
  assert.equal(resolveNextExpandedCycleId("cycle-1", "cycle-1"), null, "pulsar el mismo ciclo expandido lo contrae");
}

// Botón PDF deshabilitado durante loading o sin detalle.
function testPdfActionDisabledLogic() {
  assert.equal(isCycleHistoryPdfActionDisabled("idle"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("disabled"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("loading"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("empty"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("error"), true);
  assert.equal(isCycleHistoryPdfActionDisabled("ready"), false);
  assert.equal(isCycleHistoryPdfActionDisabled("ready", true), true, "una descarga en curso deshabilita el boton aunque el detalle este listo");
}

// 17. Métricas sin valores inventados: los valores mostrados provienen exactamente de metrics.*.
function testMetricsAreNotInvented() {
  const detail = buildDetail();
  const viewModel = buildCycleHistoryDetailViewModel(detail);
  const expectedVolumeLabel = `${Math.round(detail.metrics.totalVolumeKg).toLocaleString("es-CL")} kg`;
  const expectedProgressSign = (detail.metrics.volumeProgress.differenceKg ?? 0) >= 0 ? "+" : "-";
  const expectedProgressValue = `${expectedProgressSign}${Math.round(Math.abs(detail.metrics.volumeProgress.differenceKg ?? 0)).toLocaleString("es-CL")} kg`;

  assert.equal(viewModel.metricCards[0]?.value, expectedVolumeLabel);
  assert.equal(viewModel.metricCards[1]?.value, expectedProgressValue);
  assert.equal(viewModel.metricCards[2]?.value, String(detail.metrics.registeredExerciseCount));
}

// La métrica de progreso usa ausencia neutral real (no inventada) cuando faltan datos suficientes.
function testProgressMetricUsesNeutralAbsenceWithInsufficientData() {
  const detail = buildDetailFrom(
    CYCLE_WITH_METADATA,
    PLAN,
    [SESSIONS[0]!],
    [{ id: "entry-1", sessionId: "session-1", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 100, reps: [10] }],
  );
  const viewModel = buildCycleHistoryDetailViewModel(detail);
  assert.equal(viewModel.metricCards[1]?.value, NEUTRAL_MISSING_VALUE_LABEL);
  assert.equal(viewModel.volumeProgress.highlight, null, "sin datos suficientes no hay valor numerico que destacar");
}

// 10, 11, 12 (mensaje de progreso positivo/negativo/neutro) — el valor numérico real se separa
// para destacarlo, sin alterar el texto exacto aprobado de describeCycleHistoryVolumeProgress (H1-A).
function testProgressMessageHighlightsRealValueByTone() {
  const increaseDetail = buildDetail();
  const increaseViewModel = buildCycleHistoryDetailViewModel(increaseDetail);
  const expectedIncreaseText = describeCycleHistoryVolumeProgress(increaseDetail.metrics.volumeProgress);
  assert.equal(increaseViewModel.volumeProgress.tone, "positive");
  assert.match(increaseViewModel.volumeProgress.highlight ?? "", /kg/);
  assert.equal(
    `${increaseViewModel.volumeProgress.prefix}${increaseViewModel.volumeProgress.highlight}${increaseViewModel.volumeProgress.suffix}`,
    expectedIncreaseText,
    "la segmentación prefix/highlight/suffix debe reconstruir exactamente el texto aprobado de H1-A, sin alterarlo",
  );

  const decreaseDetail = buildDetailFrom(
    CYCLE_WITH_METADATA,
    PLAN,
    SESSIONS,
    [
      { id: "entry-1", sessionId: "session-1", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 100, reps: [10, 10, 10, 10] },
      { id: "entry-2", sessionId: "session-2", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 50, reps: [10, 10, 10, 10] },
    ],
  );
  const decreaseViewModel = buildCycleHistoryDetailViewModel(decreaseDetail);
  assert.equal(decreaseViewModel.volumeProgress.tone, "negative");
  assert.match(decreaseViewModel.volumeProgress.prefix, /^Disminuiste/);

  const unchangedDetail = buildDetailFrom(
    CYCLE_WITH_METADATA,
    PLAN,
    SESSIONS,
    [
      { id: "entry-1", sessionId: "session-1", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 100, reps: [10, 10, 10, 10] },
      { id: "entry-2", sessionId: "session-2", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 100, reps: [10, 10, 10, 10] },
    ],
  );
  const unchangedViewModel = buildCycleHistoryDetailViewModel(unchangedDetail);
  assert.equal(unchangedViewModel.volumeProgress.tone, "neutral");
  assert.equal(unchangedViewModel.volumeProgress.highlight, null, "el estado 'unchanged' no tiene un numero que destacar");
}

// 15. trainingDayCount null omite el segmento por completo (y también semanas si falta durationWeeks) —
// nunca "Sin información días de entrenamiento" ni "0 días" ni "null días".
function testBarLabelOmitsBothSegmentsWhenBothAbsent() {
  const card = buildCycleHistoryCardViewModel(CYCLE_WITHOUT_METADATA);
  assert.equal(card.barLabel, "Ciclo de entrenamiento 4: Macrociclo");
  assert.doesNotMatch(card.barLabel, /\|/, "16. sin separadores finales sobrantes cuando ambos segmentos faltan");
  assert.doesNotMatch(card.barLabel, /Sin información|null|0 días/);
}

// 16. Solo semanas (trainingDayCount null): sin separador final sobrante.
function testBarLabelShowsOnlyWeeksWhenTrainingDayCountIsNull() {
  const card = buildCycleHistoryCardViewModel({ ...CYCLE_WITHOUT_METADATA, durationWeeks: 6 });
  assert.equal(card.barLabel, "Ciclo de entrenamiento 4: Macrociclo | 6 semanas");
  assert.doesNotMatch(card.barLabel, /días/);
}

// 15. Solo días (durationWeeks null): el segmento de semanas se omite, no se reemplaza por texto neutro.
function testBarLabelShowsOnlyTrainingDaysWhenDurationWeeksIsNull() {
  const card = buildCycleHistoryCardViewModel({ ...CYCLE_WITHOUT_METADATA, trainingDayCount: 4 });
  assert.equal(card.barLabel, "Ciclo de entrenamiento 4: Macrociclo | 4 días de entrenamiento");
  assert.doesNotMatch(card.barLabel, /semanas/);
}

// 13. trainingDayCount 1 usa singular ("1 día de entrenamiento").
function testBarLabelUsesSingularForOneTrainingDay() {
  const card = buildCycleHistoryCardViewModel({ ...CYCLE_WITH_METADATA, trainingDayCount: 1 });
  assert.match(card.barLabel, /\| 1 día de entrenamiento$/);
}

// 14. trainingDayCount 2 a 7 usa plural ("N días de entrenamiento").
function testBarLabelUsesPluralForTwoToSevenTrainingDays() {
  for (const trainingDayCount of [2, 3, 4, 5, 6, 7]) {
    const card = buildCycleHistoryCardViewModel({ ...CYCLE_WITH_METADATA, trainingDayCount });
    assert.match(card.barLabel, new RegExp(`\\| ${trainingDayCount} días de entrenamiento$`));
  }
}

// 18. trainingDayCount se consume tal cual desde metadata, nunca se recalcula desde plan/breakdown/sessions.
function testBarLabelDoesNotRecalculateTrainingDayCountFromOtherSources() {
  const card = buildCycleHistoryCardViewModel(CYCLE_WITH_METADATA);
  assert.match(card.barLabel, /3 días de entrenamiento/, "usa cycle.trainingDayCount tal cual (3), no un conteo derivado del plan/breakdown");
}

// 17. Ausencia neutral de fecha faltante (fila "Fecha: ..."), sin repetir el rótulo neutro dos veces.
function testMissingMetadataUsesNeutralLabel() {
  const card = buildCycleHistoryCardViewModel(CYCLE_WITHOUT_METADATA);
  assert.equal(card.dateRowLabel, NEUTRAL_MISSING_VALUE_LABEL);
}

// Ausencia neutral parcial: cuando falta solo un extremo de la fecha, usa "desde"/"hasta" en vez de
// repetir "Sin información" dos veces.
function testPartialDateRangeUsesCleanVariantInsteadOfRepeatingNeutralLabel() {
  const startOnly = buildCycleHistoryCardViewModel({
    ...CYCLE_WITHOUT_METADATA,
    plannedStartDate: "2026-07-01",
    plannedEndDate: null,
  });
  assert.equal(startOnly.dateRowLabel, "desde 01-07-2026");
  assert.doesNotMatch(startOnly.dateRowLabel, new RegExp(NEUTRAL_MISSING_VALUE_LABEL));

  const endOnly = buildCycleHistoryCardViewModel({
    ...CYCLE_WITHOUT_METADATA,
    plannedStartDate: null,
    plannedEndDate: "2026-07-28",
  });
  assert.equal(endOnly.dateRowLabel, "hasta 28-07-2026");
}

// H1-C.1 — sanitizeCycleHistoryDomId: determinismo y estabilidad para el mismo valor.
function testSanitizeDomIdIsDeterministicAndStable() {
  const uuid = "6f1a9b3e-2c4d-4a5b-8e9f-1234567890ab";
  const first = sanitizeCycleHistoryDomId(uuid);
  const second = sanitizeCycleHistoryDomId(uuid);
  assert.equal(first, second, "el mismo cycleId debe producir siempre el mismo id DOM");
  assert.equal(sanitizeCycleHistoryDomId("cycle-3"), sanitizeCycleHistoryDomId("cycle-3"));
}

// 20. sin espacios ni caracteres problemáticos para selectores/atributos.
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

// 20. Los helpers de id de detalle/encabezado usan el mismo fragmento sanitizado, por lo que
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

// 19. El cycleId real de dominio nunca se altera: solo el id DOM se normaliza.
function testSanitizingDomIdNeverMutatesTheRealCycleId() {
  const cycleId = "cycle/with spaces?and#symbols";
  const cardViewModel = buildCycleHistoryCardViewModel({ ...CYCLE_WITH_METADATA, cycleId });
  assert.equal(cardViewModel.cycleId, cycleId, "el cycleId expuesto a callbacks debe seguir siendo el original, sin sanitizar");
}

testCardViewModelMapsRealFields();
testListViewModelsPreserveOrderAndDoNotMutateInput();
testDetailViewModelMapsRealMetrics();
testDetailViewModelDoesNotMutateInput();
testErrorViewModelExposesOnlySanitizedFields();
testExpansionRuleTogglesSingleCycle();
testPdfActionDisabledLogic();
testMetricsAreNotInvented();
testProgressMetricUsesNeutralAbsenceWithInsufficientData();
testProgressMessageHighlightsRealValueByTone();
testBarLabelOmitsBothSegmentsWhenBothAbsent();
testBarLabelShowsOnlyWeeksWhenTrainingDayCountIsNull();
testBarLabelShowsOnlyTrainingDaysWhenDurationWeeksIsNull();
testBarLabelUsesSingularForOneTrainingDay();
testBarLabelUsesPluralForTwoToSevenTrainingDays();
testBarLabelDoesNotRecalculateTrainingDayCountFromOtherSources();
testMissingMetadataUsesNeutralLabel();
testPartialDateRangeUsesCleanVariantInsteadOfRepeatingNeutralLabel();
testSanitizeDomIdIsDeterministicAndStable();
testSanitizeDomIdRemovesUnsafeCharacters();
testSanitizeDomIdAvoidsTrivialCollisions();
testSanitizeDomIdHandlesEmptyOrFullyRemovableInput();
testDetailAndHeadingDomIdsAreConsistentPerCycle();
testSanitizingDomIdNeverMutatesTheRealCycleId();

console.log("cycle-history-view-model tests passed");
