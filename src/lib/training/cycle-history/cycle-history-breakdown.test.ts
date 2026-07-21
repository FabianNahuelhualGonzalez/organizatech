import assert from "node:assert/strict";

import {
  CYCLE_HISTORY_PLAN_MISMATCH_MESSAGE,
  CycleHistoryBreakdownError,
  UNASSIGNED_ROUTINE_ID,
  UNASSIGNED_ROUTINE_NAME,
  buildCycleHistoryBreakdown,
  calculateEntryVolume,
  calculateSeriesVolume,
  joinCycleHistoryEntriesWithSessions,
  resolveExerciseIdentity,
  sanitizeCycleHistoryReps,
} from "@/lib/training/cycle-history/cycle-history-breakdown";
import type {
  CycleHistoryEntryRow,
  CycleHistoryPlan,
  CycleHistorySessionRow,
} from "@/lib/training/cycle-history/cycle-history-types";

const PLANNED_START_DATE = "2026-06-01"; // Monday

function session(overrides: Partial<CycleHistorySessionRow> & Pick<CycleHistorySessionRow, "id" | "cycleId">): CycleHistorySessionRow {
  return {
    routineId: "routine-1",
    routineName: "Torso Fuerza",
    trainedDate: "2026-06-01",
    ...overrides,
  };
}

function entry(overrides: Partial<CycleHistoryEntryRow> & Pick<CycleHistoryEntryRow, "id" | "sessionId">): CycleHistoryEntryRow {
  return {
    exerciseLineageId: "lineage-press-militar",
    trainingCycleExerciseId: null,
    exerciseName: "Press militar",
    weight: 100,
    reps: [10, 10, 10, 10],
    ...overrides,
  };
}

function planWithOneExercise(cycleId = "cycle-3", overrides: Partial<{ lineageId: string | null; targetSets: number; targetReps: number; baseWeight: number }> = {}): CycleHistoryPlan {
  return {
    cycleId,
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
                targetSets: overrides.targetSets ?? 4,
                targetReps: overrides.targetReps ?? 10,
                baseWeight: overrides.baseWeight ?? 100,
                sortOrder: 0,
                exerciseLineageId: overrides.lineageId === undefined ? "lineage-press-militar" : overrides.lineageId,
              },
            ],
          },
        ],
      },
    ],
  };
}

// A. Contaminacion cruzada: sessions/entries mezcladas de cycle-3 y cycle-5, solo cycle-3 debe aparecer.
function testCrossCycleContaminationIsExcluded() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [
    session({ id: "session-3-w1", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
    session({ id: "session-5-w1", cycleId: "cycle-5", trainedDate: "2026-06-01", routineId: "routine-5", routineName: "Rutina ciclo 5" }),
  ];
  const entries = [
    entry({ id: "entry-cycle-3", sessionId: "session-3-w1", exerciseName: "Press militar" }),
    entry({ id: "entry-cycle-5", sessionId: "session-5-w1", exerciseLineageId: "lineage-ciclo-5", exerciseName: "Ejercicio ciclo 5", weight: 999 }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: "cycle-3",
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.equal(breakdown.cycleId, "cycle-3");
  const serialized = JSON.stringify(breakdown);
  assert.doesNotMatch(serialized, /cycle-5|session-5-w1|entry-cycle-5|lineage-ciclo-5|Ejercicio ciclo 5|Rutina ciclo 5|999/);
}

// B. Plan incorrecto: plan.cycleId distinto de selectedCycleId debe fallar explicitamente.
function testFailsExplicitlyWhenPlanCycleIdMismatches() {
  const plan = planWithOneExercise("cycle-5");

  assert.throws(
    () => buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions: [], entries: [], plannedStartDate: PLANNED_START_DATE }),
    (error: unknown) => {
      assert.ok(error instanceof CycleHistoryBreakdownError);
      assert.equal(error.message, CYCLE_HISTORY_PLAN_MISMATCH_MESSAGE);
      return true;
    },
  );
}

// C. Rutina derivada desde la sesion, no desde el entry.
function testRoutineIsDerivedFromSession() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-1", cycleId: "cycle-3", routineId: "routine-1", routineName: "Torso Fuerza" })];
  const entries = [entry({ id: "entry-1", sessionId: "session-1" })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.equal(breakdown.routines[0]?.routineId, "routine-1");
  assert.equal(breakdown.routines[0]?.routineName, "Torso Fuerza");
}

// D. Entry con sesion inexistente debe excluirse.
function testEntryWithNonExistentSessionIsExcluded() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-1", cycleId: "cycle-3" })];
  const entries = [entry({ id: "entry-orphan-session", sessionId: "session-does-not-exist" })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.deepEqual(breakdown.weeksWithData, []);
  assert.deepEqual(breakdown.routines[0]?.exercises[0]?.weeks, {});
}

// E. Session de otro ciclo: el entry que la referencia debe excluirse.
function testEntryReferencingSessionFromAnotherCycleIsExcluded() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-5", cycleId: "cycle-5" })];
  const entries = [entry({ id: "entry-1", sessionId: "session-5" })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.deepEqual(breakdown.weeksWithData, []);
}

// F. Unassigned real: sesion valida sin routineId reconocido agrupa en un unico bucket determinista.
function testUnassignedBucketIsSingleAndDeterministic() {
  const plan: CycleHistoryPlan = { cycleId: "cycle-3", routines: [] };
  const sessions = [
    session({ id: "session-w1", cycleId: "cycle-3", routineId: null, routineName: "", trainedDate: "2026-06-01" }),
    session({ id: "session-w2", cycleId: "cycle-3", routineId: "routine-desconocida", routineName: "Rutina eliminada", trainedDate: "2026-06-08" }),
  ];
  const entries = [
    entry({ id: "entry-w1", sessionId: "session-w1", exerciseLineageId: "lineage-huerfano" }),
    entry({ id: "entry-w2", sessionId: "session-w2", exerciseLineageId: "lineage-huerfano" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.equal(breakdown.routines.length, 1);
  assert.equal(breakdown.routines[0]?.routineId, UNASSIGNED_ROUTINE_ID);
  assert.equal(breakdown.routines[0]?.routineName, UNASSIGNED_ROUTINE_NAME);
  assert.equal(breakdown.routines[0]?.exercises.length, 1, "ambos entries huerfanos con el mismo lineage deben ser el mismo ejercicio historico");
  assert.deepEqual(Object.keys(breakdown.routines[0]?.exercises[0]?.weeks ?? {}).map(Number).sort(), [1, 2]);
}

// G. Registros vacios: reps invalidas no cuentan como registro.
function testEmptyOrInvalidRepsDoNotCountAsRegistration() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [
    session({ id: "session-empty", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
    session({ id: "session-zero", cycleId: "cycle-3", trainedDate: "2026-06-08" }),
    session({ id: "session-invalid", cycleId: "cycle-3", trainedDate: "2026-06-15" }),
  ];
  const entries = [
    entry({ id: "entry-empty", sessionId: "session-empty", reps: [] }),
    entry({ id: "entry-zero", sessionId: "session-zero", reps: [0] }),
    entry({ id: "entry-invalid", sessionId: "session-invalid", reps: [Number.NaN, -2] }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.deepEqual(breakdown.weeksWithData, []);
  assert.deepEqual(breakdown.routines[0]?.exercises[0]?.weeks, {});
}

// H. Peso cero valido: reps positivas + peso cero cuentan como registro con volumen cero.
function testZeroWeightWithValidRepsCountsAsRegistrationWithZeroVolume() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" })];
  const entries = [entry({ id: "entry-1", sessionId: "session-1", weight: 0, reps: [10] })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.deepEqual(breakdown.weeksWithData, [1]);
  const week = breakdown.routines[0]?.exercises[0]?.weeks[1];
  assert.ok(week);
  assert.equal(week?.volume, 0);
  assert.equal(week?.totalReps, 10);
}

// I.1 Identidad: mismo nombre y distinto lineage no se mezclan.
function testSameNameDifferentLineageStayIsolated() {
  const plan: CycleHistoryPlan = {
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
              { id: "cycle-exercise-1", name: "Press militar", targetSets: 4, targetReps: 10, baseWeight: 100, sortOrder: 0, exerciseLineageId: "lineage-a" },
              { id: "cycle-exercise-2", name: "Press militar", targetSets: 4, targetReps: 10, baseWeight: 90, sortOrder: 1, exerciseLineageId: "lineage-b" },
            ],
          },
        ],
      },
    ],
  };
  const sessions = [session({ id: "session-1", cycleId: "cycle-3" })];
  const entries = [
    entry({ id: "entry-a", sessionId: "session-1", exerciseLineageId: "lineage-a", weight: 100 }),
    entry({ id: "entry-b", sessionId: "session-1", exerciseLineageId: "lineage-b", weight: 90 }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  const exercises = breakdown.routines[0]?.exercises ?? [];
  assert.equal(exercises.length, 2);
  assert.notEqual(exercises[0]?.identity.key, exercises[1]?.identity.key);
}

// I.2 Identidad: mismo lineage con nombre historico distinto se mantiene como un solo ejercicio.
function testSameLineageWithDifferentHistoricalNameStaysOneExercise() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [
    session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
    session({ id: "session-2", cycleId: "cycle-3", trainedDate: "2026-06-08" }),
  ];
  const entries = [
    entry({ id: "entry-1", sessionId: "session-1", exerciseName: "Press militar" }),
    entry({ id: "entry-2", sessionId: "session-2", exerciseName: "Press militar (variante)" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.equal(breakdown.routines[0]?.exercises.length, 1);
  assert.deepEqual(Object.keys(breakdown.routines[0]?.exercises[0]?.weeks ?? {}).map(Number).sort(), [1, 2]);
}

// I.3 Identidad: mismo trainingCycleExerciseId (sin lineage) se agrupa correctamente.
function testSameTrainingCycleExerciseIdGroupsTogether() {
  const plan = planWithOneExercise("cycle-3", { lineageId: null });
  const sessions = [
    session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
    session({ id: "session-2", cycleId: "cycle-3", trainedDate: "2026-06-08" }),
  ];
  const entries = [
    entry({ id: "entry-1", sessionId: "session-1", exerciseLineageId: null, trainingCycleExerciseId: "cycle-exercise-1" }),
    entry({ id: "entry-2", sessionId: "session-2", exerciseLineageId: null, trainingCycleExerciseId: "cycle-exercise-1" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.equal(breakdown.routines[0]?.exercises.length, 1);
  assert.equal(breakdown.routines[0]?.exercises[0]?.identity.kind, "trainingCycleExercise");
}

// I.4 Identidad: unmatched aislado (sin lineage ni trainingCycleExerciseId coincidente).
function testUnmatchedEntriesStayIsolated() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-1", cycleId: "cycle-3" })];
  const entries = [
    entry({ id: "entry-orphan-1", sessionId: "session-1", exerciseLineageId: null, trainingCycleExerciseId: null, exerciseName: "Ejercicio retirado" }),
    entry({ id: "entry-orphan-2", sessionId: "session-1", exerciseLineageId: null, trainingCycleExerciseId: null, exerciseName: "Otro ejercicio retirado" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  const orphanExercises = breakdown.routines
    .flatMap((routine) => routine.exercises)
    .filter((exercise) => exercise.identity.kind === "unmatched");
  assert.equal(orphanExercises.length, 2, "cada entry unmatched sin relacion entre si debe permanecer aislado, no fusionarse por nombre");
}

// J. No mutacion de inputs.
function testDoesNotMutateInputs() {
  const plan = planWithOneExercise("cycle-3");
  const planSnapshot = JSON.parse(JSON.stringify(plan));
  const sessions = [session({ id: "session-1", cycleId: "cycle-3" })];
  const sessionsSnapshot = JSON.parse(JSON.stringify(sessions));
  const entries = [entry({ id: "entry-1", sessionId: "session-1" })];
  const entriesSnapshot = JSON.parse(JSON.stringify(entries));

  buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.deepEqual(plan, planSnapshot);
  assert.deepEqual(sessions, sessionsSnapshot);
  assert.deepEqual(entries, entriesSnapshot);
}

// J. Salida determinista.
function testDeterministicOutput() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [
    session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
    session({ id: "session-2", cycleId: "cycle-3", trainedDate: "2026-06-08" }),
  ];
  const entries = [
    entry({ id: "entry-1", sessionId: "session-1" }),
    entry({ id: "entry-2", sessionId: "session-2", weight: 105 }),
  ];

  const first = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  const second = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });

  assert.deepEqual(first, second);
}

// Una semana / veinte semanas / semana incompleta / sesion sin registros (mantenidos de la version previa).
function testSingleWeek() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" })];
  const entries = [entry({ id: "entry-1", sessionId: "session-1" })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  assert.deepEqual(breakdown.weeksWithData, [1]);
}

function testTwentyWeeks() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = Array.from({ length: 20 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 5, 1 + index * 7));
    return session({ id: `session-${index + 1}`, cycleId: "cycle-3", trainedDate: date.toISOString().slice(0, 10) });
  });
  const entries = sessions.map((s, index) => entry({ id: `entry-${index + 1}`, sessionId: s.id }));

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  assert.deepEqual(breakdown.weeksWithData, Array.from({ length: 20 }, (_, i) => i + 1));
}

function testIncompleteWeek() {
  const plan = planWithOneExercise("cycle-3", { targetSets: 4 });
  const sessions = [session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" })];
  const entries = [entry({ id: "entry-1", sessionId: "session-1", reps: [10] })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  const exercise = breakdown.routines[0]?.exercises[0];
  assert.equal(exercise?.weeks[1]?.series[0]?.reps.length, 1);
  assert.equal(exercise?.weeks[1]?.volume, 1000);
}

function testSessionWithoutEntries() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [
    session({ id: "session-1", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
    session({ id: "session-empty", cycleId: "cycle-3", trainedDate: "2026-06-08" }),
  ];
  const entries = [entry({ id: "entry-1", sessionId: "session-1" })];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  assert.deepEqual(breakdown.weeksWithData, [1]);
}

function testPlannedExerciseWithoutRegistrations() {
  const plan = planWithOneExercise("cycle-3");
  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions: [], entries: [], plannedStartDate: PLANNED_START_DATE });

  const exercise = breakdown.routines[0]?.exercises[0];
  assert.ok(exercise);
  assert.deepEqual(exercise?.weeks, {});
  assert.equal(exercise?.plan?.targetSets, 4);
}

function testRegisteredExerciseWithoutAvailablePlan() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [session({ id: "session-1", cycleId: "cycle-3" })];
  const entries = [
    entry({ id: "entry-orphan", sessionId: "session-1", exerciseLineageId: null, trainingCycleExerciseId: null, exerciseName: "Ejercicio retirado" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  const exercises = breakdown.routines.flatMap((routine) => routine.exercises);
  const orphan = exercises.find((exercise) => exercise.name === "Ejercicio retirado");
  assert.ok(orphan);
  assert.equal(orphan?.plan, null);
}

function testChronologicalOrder() {
  const plan = planWithOneExercise("cycle-3");
  const sessions = [
    session({ id: "session-later", cycleId: "cycle-3", trainedDate: "2026-06-15" }),
    session({ id: "session-earlier", cycleId: "cycle-3", trainedDate: "2026-06-01" }),
  ];
  const entries = [
    entry({ id: "entry-later", sessionId: "session-later" }),
    entry({ id: "entry-earlier", sessionId: "session-earlier" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({ selectedCycleId: "cycle-3", plan, sessions, entries, plannedStartDate: PLANNED_START_DATE });
  assert.deepEqual(breakdown.weeksWithData, [1, 3]);
}

// Volumen: peso cero, reps variables, valores invalidos.
function testVolumeEdgeCases() {
  assert.equal(calculateSeriesVolume(0, 10), 0);
  assert.equal(calculateSeriesVolume(100, 0), 0, "una repeticion de valor 0 no es una serie valida");
  assert.equal(calculateEntryVolume(100, [10, 8, 12]), 3000);
  assert.equal(calculateEntryVolume(100, [Number.NaN, -5, 10]), 1000);
  assert.equal(calculateEntryVolume(-50, [10]), 0);
  assert.equal(calculateEntryVolume(100, []), 0);
  assert.deepEqual(sanitizeCycleHistoryReps([]), []);
  assert.deepEqual(sanitizeCycleHistoryReps([0]), []);
  assert.deepEqual(sanitizeCycleHistoryReps([Number.NaN, -2]), []);
  assert.deepEqual(sanitizeCycleHistoryReps([10, Number.NaN, 8, -1, 0]), [10, 8]);
}

// Identidad: prioridad lineage sobre trainingCycleExerciseId, y unmatched cuando falta todo.
function testExerciseIdentityResolution() {
  assert.deepEqual(
    resolveExerciseIdentity(entry({ id: "e1", sessionId: "s1", exerciseLineageId: "lineage-x", trainingCycleExerciseId: "tce-x" })),
    { kind: "lineage", key: "lineage-x" },
  );
  assert.deepEqual(
    resolveExerciseIdentity(entry({ id: "e2", sessionId: "s1", exerciseLineageId: null, trainingCycleExerciseId: "tce-y" })),
    { kind: "trainingCycleExercise", key: "tce-y" },
  );
  assert.deepEqual(
    resolveExerciseIdentity(entry({ id: "e3", sessionId: "s1", exerciseLineageId: null, trainingCycleExerciseId: null })),
    { kind: "unmatched", key: "entry:e3" },
  );
}

// joinCycleHistoryEntriesWithSessions: semana no derivable cuando no hay plannedStartDate.
function testJoinReturnsEmptyWithoutPlannedStartDate() {
  const sessions = [session({ id: "session-1", cycleId: "cycle-3" })];
  const entries = [entry({ id: "entry-1", sessionId: "session-1" })];

  const joined = joinCycleHistoryEntriesWithSessions({ selectedCycleId: "cycle-3", sessions, entries, plannedStartDate: null });
  assert.deepEqual(joined, []);
}

testCrossCycleContaminationIsExcluded();
testFailsExplicitlyWhenPlanCycleIdMismatches();
testRoutineIsDerivedFromSession();
testEntryWithNonExistentSessionIsExcluded();
testEntryReferencingSessionFromAnotherCycleIsExcluded();
testUnassignedBucketIsSingleAndDeterministic();
testEmptyOrInvalidRepsDoNotCountAsRegistration();
testZeroWeightWithValidRepsCountsAsRegistrationWithZeroVolume();
testSameNameDifferentLineageStayIsolated();
testSameLineageWithDifferentHistoricalNameStaysOneExercise();
testSameTrainingCycleExerciseIdGroupsTogether();
testUnmatchedEntriesStayIsolated();
testDoesNotMutateInputs();
testDeterministicOutput();
testSingleWeek();
testTwentyWeeks();
testIncompleteWeek();
testSessionWithoutEntries();
testPlannedExerciseWithoutRegistrations();
testRegisteredExerciseWithoutAvailablePlan();
testChronologicalOrder();
testVolumeEdgeCases();
testExerciseIdentityResolution();
testJoinReturnsEmptyWithoutPlannedStartDate();

console.log("cycle-history-breakdown tests passed");
