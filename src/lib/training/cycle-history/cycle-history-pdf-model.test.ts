import assert from "node:assert/strict";

import { buildCycleHistoryBreakdown } from "@/lib/training/cycle-history/cycle-history-breakdown";
import { buildCycleHistoryMetricsSummary } from "@/lib/training/cycle-history/cycle-history-metrics";
import { calculateAgeAtDate, buildCycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryEntryRow,
  CycleHistoryPersonalData,
  CycleHistoryPlan,
  CycleHistorySessionRow,
} from "@/lib/training/cycle-history/cycle-history-types";

const CYCLE_3_METADATA: CycleHistoryCycleMetadata = {
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
            { id: "cycle-exercise-1", name: "Press militar", targetSets: 4, targetReps: 10, baseWeight: 100, sortOrder: 0, exerciseLineageId: "lineage-1" },
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
  { id: "entry-1", sessionId: "session-1", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 100, reps: [10, 10, 10, 10] },
  { id: "entry-2", sessionId: "session-2", exerciseLineageId: "lineage-1", trainingCycleExerciseId: "cycle-exercise-1", exerciseName: "Press militar", weight: 105, reps: [10, 10, 10, 10] },
];

function buildBreakdown() {
  return buildCycleHistoryBreakdown({
    selectedCycleId: CYCLE_3_METADATA.cycleId,
    plan: PLAN,
    sessions: SESSIONS,
    entries: ENTRIES,
    plannedStartDate: CYCLE_3_METADATA.plannedStartDate,
  });
}

function fullPersonalData(): CycleHistoryPersonalData {
  return {
    firstName: "Fabián",
    lastName: "Nahuelhual",
    email: "nahuelhual66@gmail.com",
    birthDate: "1990-07-21",
    gender: "male",
    phoneNumber: "+56911111111",
  };
}

function emptyPersonalData(): CycleHistoryPersonalData {
  return { firstName: null, lastName: null, email: null, birthDate: null, gender: null, phoneNumber: null };
}

// Edad calculada a la fecha de generacion.
function testCalculatesAgeAtGenerationDate() {
  assert.equal(calculateAgeAtDate("1990-07-21", "2026-07-21"), 36);
  assert.equal(calculateAgeAtDate("1990-07-22", "2026-07-21"), 35, "aun no cumple anios en la fecha de generacion");
  assert.equal(calculateAgeAtDate(null, "2026-07-21"), null);
}

// Datos personales opcionales ausentes: el modelo representa la ausencia explicitamente (null), sin inventar placeholders.
function testHandlesMissingOptionalPersonalData() {
  const model = buildCycleHistoryPdfModel({
    cycle: CYCLE_3_METADATA,
    breakdown: buildBreakdown(),
    personalData: emptyPersonalData(),
    generatedAt: "2026-07-21",
  });

  assert.equal(model.personalData.fullName, null);
  assert.equal(model.personalData.email, null);
  assert.equal(model.personalData.birthDate, null);
  assert.equal(model.personalData.age, null);
  assert.equal(model.personalData.gender, null);
  assert.equal(model.personalData.phoneNumber, null);
}

// Con datos completos, el modelo compone nombre completo y edad correctamente.
function testComposesFullPersonalData() {
  const model = buildCycleHistoryPdfModel({
    cycle: CYCLE_3_METADATA,
    breakdown: buildBreakdown(),
    personalData: fullPersonalData(),
    generatedAt: "2026-07-21",
  });

  assert.equal(model.personalData.fullName, "Fabián Nahuelhual");
  assert.equal(model.personalData.age, 36);
  assert.equal(model.personalData.email, "nahuelhual66@gmail.com");
}

// El filename se deriva del numero de ciclo y la fecha de generacion.
function testFilenameIsDerivedFromCycleAndDate() {
  const model = buildCycleHistoryPdfModel({
    cycle: CYCLE_3_METADATA,
    breakdown: buildBreakdown(),
    personalData: emptyPersonalData(),
    generatedAt: "2026-07-21",
  });

  assert.equal(model.filename, "organizatech-ciclo-3-2026-07-21.pdf");
}

// Metricas del modelo PDF son identicas a las calculadas directamente sobre el breakdown (pantalla y PDF comparten fuente).
function testMetricsMatchBreakdownDirectly() {
  const breakdown = buildBreakdown();
  const directSummary = buildCycleHistoryMetricsSummary(breakdown);
  const model = buildCycleHistoryPdfModel({
    cycle: CYCLE_3_METADATA,
    breakdown,
    personalData: emptyPersonalData(),
    generatedAt: "2026-07-21",
  });

  assert.equal(model.metrics.totalVolumeKg, directSummary.totalVolumeKg);
  assert.equal(model.metrics.registeredExerciseCount, directSummary.registeredExerciseCount);
  assert.deepEqual(model.metrics.weeklyVolumeKg, directSummary.weeklyVolumeKg);
  assert.deepEqual(model.metrics.volumeProgress, directSummary.volumeProgress);
}

// El modelo agrupa las semanas de cada rutina en bloques paginados, sin duplicar ni omitir.
function testRoutinesIncludePaginatedWeekBlocks() {
  const model = buildCycleHistoryPdfModel({
    cycle: CYCLE_3_METADATA,
    breakdown: buildBreakdown(),
    personalData: emptyPersonalData(),
    generatedAt: "2026-07-21",
  });

  assert.equal(model.routines.length, 1);
  assert.deepEqual(model.routines[0]?.weekBlocks, [[1, 2]]);
}

// Aislamiento: el modelo del ciclo 3 nunca referencia metadata de otros ciclos conceptuales.
function testDoesNotReferenceOtherCycles() {
  const model = buildCycleHistoryPdfModel({
    cycle: CYCLE_3_METADATA,
    breakdown: buildBreakdown(),
    personalData: emptyPersonalData(),
    generatedAt: "2026-07-21",
  });

  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /cycle-5|cycle-1\b|cycle-2\b|cycle-4\b/);
  assert.equal(model.cycle.cycleId, "cycle-3");
}

testCalculatesAgeAtGenerationDate();
testHandlesMissingOptionalPersonalData();
testComposesFullPersonalData();
testFilenameIsDerivedFromCycleAndDate();
testMetricsMatchBreakdownDirectly();
testRoutinesIncludePaginatedWeekBlocks();
testDoesNotReferenceOtherCycles();

console.log("cycle-history-pdf-model tests passed");
