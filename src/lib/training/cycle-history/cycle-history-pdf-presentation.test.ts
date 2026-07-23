import assert from "node:assert/strict";

import { buildCycleHistoryPdfPresentation } from "@/lib/training/cycle-history/cycle-history-pdf-presentation";
import { buildCycleHistoryPdfTestModel } from "@/lib/training/cycle-history/cycle-history-pdf-test-fixtures";

function testPersonalDataIsOmittedWhenAbsent() {
  const model = buildCycleHistoryPdfTestModel();
  model.personalData = {
    fullName: null,
    email: null,
    birthDate: null,
    age: null,
    gender: "not_specified",
    phoneNumber: null,
  };

  assert.deepEqual(buildCycleHistoryPdfPresentation(model).personalFields, []);
}

function testOnlyExistingPersonalDataIsIncluded() {
  const model = buildCycleHistoryPdfTestModel();
  model.personalData = {
    fullName: "Persona QA",
    email: null,
    birthDate: null,
    age: null,
    gender: null,
    phoneNumber: "+56 9 1111 2222",
  };

  assert.deepEqual(buildCycleHistoryPdfPresentation(model).personalFields, [
    { label: "Nombre", value: "Persona QA" },
    { label: "Teléfono", value: "+56 9 1111 2222" },
  ]);
}

function testDatesStatusesMetricsAndFilenameUseTheModel() {
  const presentation = buildCycleHistoryPdfPresentation(buildCycleHistoryPdfTestModel());

  assert.ok(presentation.cycleFields.some((field) => field.label === "Estado" && field.value === "Completado"));
  assert.ok(presentation.cycleFields.some((field) => field.label === "Fecha de inicio" && field.value === "01/06/2026"));
  assert.ok(presentation.cycleFields.some((field) => field.label === "Fecha de término" && field.value === "28/06/2026"));
  assert.deepEqual(presentation.metricFields.slice(0, 3), [
    { label: "Volumen total registrado", value: "14.520,5 kg" },
    { label: "Ejercicios registrados", value: "3" },
    {
      label: "Progreso de volumen",
      value: "Tu volumen aumentó 1.250 kg entre la primera y la última semana registrada.",
    },
  ]);
  assert.equal(presentation.filename, "organizatech-ciclo-7-2026-07-21.pdf");
  assert.equal(presentation.generatedAtLabel, "21/07/2026");
}

function testEmptyModelGeneratesSummaryWithoutTables() {
  const model = buildCycleHistoryPdfTestModel();
  model.routines = [];
  model.cycle.weeksWithDataCount = 0;

  const presentation = buildCycleHistoryPdfPresentation(model);
  assert.deepEqual(presentation.routines, []);
  assert.equal(presentation.emptyMessage, "Este ciclo no tiene semanas registradas.");
  assert.ok(presentation.cycleFields.length > 0);
  assert.ok(presentation.metricFields.length > 0);
}

function testWeekBlocksPreserveRoutineAndWeekOrder() {
  const presentation = buildCycleHistoryPdfPresentation(buildCycleHistoryPdfTestModel());

  assert.deepEqual(presentation.routines.map((routine) => routine.routineName), [
    "Piernas y glúteos",
    "Torso",
  ]);
  assert.deepEqual(presentation.routines[0]?.tables.map((table) => table.weeks), [[1, 2], [3]]);
  assert.deepEqual(presentation.routines[1]?.tables.map((table) => table.weeks), [[2]]);
  assert.deepEqual(presentation.routines[0]?.tables[0]?.head, [
    "Ejercicio",
    "Objetivo",
    "Semana 1",
    "Semana 2",
  ]);
  assert.deepEqual(presentation.routines[0]?.tables[1]?.head, [
    "Ejercicio",
    "Objetivo",
    "Semana 3",
  ]);
  for (const routine of presentation.routines) {
    for (const table of routine.tables) assert.ok(table.weeks.length <= 2);
  }
}

function testExercisePlanRegistrationsAndMissingWeeksAreExplicit() {
  const table = buildCycleHistoryPdfPresentation(buildCycleHistoryPdfTestModel()).routines[0]?.tables[0];
  assert.ok(table);
  const plannedRow = table.rows[0];
  const unplannedRow = table.rows[1];

  assert.equal(plannedRow?.[0], "Sentadilla búlgara");
  assert.equal(plannedRow?.[1], "3 series · 10 reps · 40 kg");

  const weekCell = plannedRow?.[2];
  assert.ok(weekCell && typeof weekCell === "object", "la celda de una semana con registros debe ser un objeto estructurado, no texto plano");
  assert.equal(weekCell.kind, "registration");
  // Dos registros (series) esa semana: cada uno aporta un par de filas "Series registradas/Peso" y
  // "Repeticiones/Total reps" — el total de repeticiones de la semana solo se muestra en el último registro.
  assert.deepEqual(weekCell.rows, [
    { left: "Series registradas: 3", right: "Peso: 40 kg" },
    { left: "Repeticiones: 10/10/9", right: null },
    { left: "Series registradas: 3", right: "Peso: 42,5 kg" },
    { left: "Repeticiones: 10/9/9", right: "Total reps: 57" },
  ]);
  assert.equal(weekCell.totalLine, "Volumen total: 2.350 kg");

  assert.equal(unplannedRow?.[1], "Sin objetivo registrado");
  assert.equal(unplannedRow?.[2], "Sin registro");
}

// Semana con un único registro: el par "Repeticiones/Total reps" comparte la misma fila,
// reproduciendo exactamente el diseño aprobado (sin "Registro N ·" ni una línea de volumen por registro).
function testSingleEntryWeekPairsRepsWithTotalOnTheSameRow() {
  const table = buildCycleHistoryPdfPresentation(buildCycleHistoryPdfTestModel()).routines[0]?.tables[1];
  assert.ok(table);
  const weekCell = table.rows[0]?.[2];
  assert.ok(weekCell && typeof weekCell === "object");
  assert.deepEqual(weekCell.rows, [
    { left: "Series registradas: 3", right: "Peso: 47,5 kg" },
    { left: "Repeticiones: 10/10/9", right: "Total reps: 29" },
  ]);
  assert.equal(weekCell.totalLine, "Volumen total: 1.377,5 kg");
  assert.doesNotMatch(JSON.stringify(weekCell), /Registro \d|Volumen: /, "no debe quedar rastro del formato anterior (Registro N / Volumen por registro)");
}

function testEveryWeekBlockPreservesTheDomainExerciseOrder() {
  const model = buildCycleHistoryPdfTestModel();
  const routine = model.routines[0]!;
  const sourceExercise = routine.exercises[0]!;
  routine.exercises = [
    {
      ...sourceExercise,
      identity: { kind: "lineage", key: "lineage-zeta" },
      name: "Zeta Press",
    },
    {
      ...sourceExercise,
      identity: { kind: "lineage", key: "lineage-alfa" },
      name: "Alfa Aperturas",
    },
    {
      ...sourceExercise,
      identity: { kind: "lineage", key: "lineage-medio" },
      name: "Medio Inclinado",
    },
  ];
  routine.weekBlocks = [[1, 2], [3, 4], [5, 6], [7, 8]];

  const presentation = buildCycleHistoryPdfPresentation(model);
  const expectedOrder = ["Zeta Press", "Alfa Aperturas", "Medio Inclinado"];
  assert.deepEqual(presentation.routines[0]?.tables.map((table) => table.weeks), [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
  ]);
  for (const table of presentation.routines[0]?.tables ?? []) {
    assert.deepEqual(table.rows.map((row) => row[0]), expectedOrder);
  }
}

function testInvalidWeekBlockFailsClosed() {
  const model = buildCycleHistoryPdfTestModel();
  model.routines[0]!.weekBlocks = [[1, 2, 3]];
  assert.throws(
    () => buildCycleHistoryPdfPresentation(model),
    /Cada bloque PDF debe contener una o dos semanas/,
  );
}

testPersonalDataIsOmittedWhenAbsent();
testOnlyExistingPersonalDataIsIncluded();
testDatesStatusesMetricsAndFilenameUseTheModel();
testEmptyModelGeneratesSummaryWithoutTables();
testWeekBlocksPreserveRoutineAndWeekOrder();
testExercisePlanRegistrationsAndMissingWeeksAreExplicit();
testSingleEntryWeekPairsRepsWithTotalOnTheSameRow();
testEveryWeekBlockPreservesTheDomainExerciseOrder();
testInvalidWeekBlockFailsClosed();

console.log("cycle-history-pdf-presentation tests passed");
