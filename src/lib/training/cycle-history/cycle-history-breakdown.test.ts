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

interface OrderedExerciseFixture {
  id: string;
  name: string;
  sortOrder: number;
  createdAt?: string | null;
  lineageId: string | null;
}

interface OrderedRoutineFixture {
  id: string;
  name: string;
  sortOrder: number;
  dayId: string;
  dayCode: CycleHistoryPlan["routines"][number]["days"][number]["dayCode"];
  daySortOrder: number;
  exercises: OrderedExerciseFixture[];
}

function planWithOrderedRoutines(
  cycleId: string,
  routines: OrderedRoutineFixture[],
): CycleHistoryPlan {
  return {
    cycleId,
    routines: routines.map((routine) => ({
      id: routine.id,
      name: routine.name,
      sortOrder: routine.sortOrder,
      days: [
        {
          id: routine.dayId,
          routineId: routine.id,
          weekIndex: 1,
          dayCode: routine.dayCode,
          sortOrder: routine.daySortOrder,
          exercises: routine.exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            targetSets: 3,
            targetReps: 10,
            baseWeight: 100,
            sortOrder: exercise.sortOrder,
            ...(exercise.createdAt === undefined
              ? {}
              : { createdAt: exercise.createdAt }),
            exerciseLineageId: exercise.lineageId,
          })),
        },
      ],
    })),
  };
}

function exerciseNamesForRoutine(
  breakdown: ReturnType<typeof buildCycleHistoryBreakdown>,
  routineId: string,
): string[] {
  return breakdown.routines
    .find((routine) => routine.routineId === routineId)
    ?.exercises.map((exercise) => exercise.name) ?? [];
}

function exerciseIdentityKeysForRoutine(
  breakdown: ReturnType<typeof buildCycleHistoryBreakdown>,
  routineId: string,
): string[] {
  return breakdown.routines
    .find((routine) => routine.routineId === routineId)
    ?.exercises.map((exercise) => exercise.identity.key) ?? [];
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
  assert.deepEqual(exercises.map((exercise) => exercise.identity.key), ["lineage-a", "lineage-b"]);
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

// H1-F.1 El orden historico persistido prevalece sobre nombre y orden de llegada.
function testHistoricalPlanOrderOverridesAlphabeticalAndEntryOrder() {
  const cycleId = "cycle-order";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: "routine-order",
      name: "Push",
      sortOrder: 0,
      dayId: "day-push",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-zeta", name: "Zeta Press", sortOrder: 0, lineageId: "lineage-zeta" },
        { id: "exercise-alfa", name: "Alfa Aperturas", sortOrder: 1, lineageId: "lineage-alfa" },
        { id: "exercise-medio", name: "Medio Inclinado", sortOrder: 2, lineageId: "lineage-medio" },
      ],
    },
  ]);
  const sessions = [
    session({ id: "session-order", cycleId, routineId: "routine-order", routineName: "Push" }),
  ];
  const entries = [
    entry({ id: "entry-alfa", sessionId: "session-order", exerciseLineageId: "lineage-alfa", exerciseName: "Alfa Aperturas" }),
    entry({ id: "entry-medio", sessionId: "session-order", exerciseLineageId: "lineage-medio", exerciseName: "Medio Inclinado" }),
    entry({ id: "entry-zeta", sessionId: "session-order", exerciseLineageId: "lineage-zeta", exerciseName: "Zeta Press" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-order"), [
    "Zeta Press",
    "Alfa Aperturas",
    "Medio Inclinado",
  ]);
}

// H1-F.2 El orden cambia entre respuestas semanales, pero nunca en el breakdown final.
function testHistoricalOrderIsStableAcrossShuffledWeeks() {
  const cycleId = "cycle-week-order";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: "routine-week-order",
      name: "Push",
      sortOrder: 0,
      dayId: "day-week-order",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-zeta", name: "Zeta Press", sortOrder: 0, lineageId: "lineage-zeta" },
        { id: "exercise-alfa", name: "Alfa Aperturas", sortOrder: 1, lineageId: "lineage-alfa" },
        { id: "exercise-medio", name: "Medio Inclinado", sortOrder: 2, lineageId: "lineage-medio" },
      ],
    },
  ]);
  const sessions = [
    session({ id: "session-week-1", cycleId, routineId: "routine-week-order", routineName: "Push", trainedDate: "2026-06-01" }),
    session({ id: "session-week-2", cycleId, routineId: "routine-week-order", routineName: "Push", trainedDate: "2026-06-08" }),
  ];
  const entries = [
    entry({ id: "week-1-alfa", sessionId: "session-week-1", exerciseLineageId: "lineage-alfa", exerciseName: "Alfa Aperturas" }),
    entry({ id: "week-1-zeta", sessionId: "session-week-1", exerciseLineageId: "lineage-zeta", exerciseName: "Zeta Press" }),
    entry({ id: "week-1-medio", sessionId: "session-week-1", exerciseLineageId: "lineage-medio", exerciseName: "Medio Inclinado" }),
    entry({ id: "week-2-medio", sessionId: "session-week-2", exerciseLineageId: "lineage-medio", exerciseName: "Medio Inclinado" }),
    entry({ id: "week-2-alfa", sessionId: "session-week-2", exerciseLineageId: "lineage-alfa", exerciseName: "Alfa Aperturas" }),
    entry({ id: "week-2-zeta", sessionId: "session-week-2", exerciseLineageId: "lineage-zeta", exerciseName: "Zeta Press" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-week-order"), [
    "Zeta Press",
    "Alfa Aperturas",
    "Medio Inclinado",
  ]);
  for (const exercise of breakdown.routines[0]?.exercises ?? []) {
    assert.deepEqual(Object.keys(exercise.weeks).map(Number).sort(), [1, 2]);
  }
}

// H1-F.3 Cada dia/rutina conserva su propio orden sin mezclar identidades.
function testMultipleRoutineDaysKeepIndependentHistoricalOrder() {
  const cycleId = "cycle-multiple-days";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: "routine-push",
      name: "Push",
      sortOrder: 0,
      dayId: "day-push",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-press", name: "Press banca", sortOrder: 0, lineageId: "lineage-press" },
        { id: "exercise-inclinado", name: "Press inclinado", sortOrder: 1, lineageId: "lineage-inclinado" },
      ],
    },
    {
      id: "routine-pull",
      name: "Pull",
      sortOrder: 1,
      dayId: "day-pull",
      dayCode: "wednesday",
      daySortOrder: 1,
      exercises: [
        { id: "exercise-dominadas", name: "Dominadas", sortOrder: 0, lineageId: "lineage-dominadas" },
        { id: "exercise-remo", name: "Remo", sortOrder: 1, lineageId: "lineage-remo" },
      ],
    },
  ]);
  const sessions = [
    session({ id: "session-push", cycleId, routineId: "routine-push", routineName: "Push" }),
    session({ id: "session-pull", cycleId, routineId: "routine-pull", routineName: "Pull" }),
  ];
  const entries = [
    entry({ id: "entry-remo", sessionId: "session-pull", exerciseLineageId: "lineage-remo", exerciseName: "Remo" }),
    entry({ id: "entry-inclinado", sessionId: "session-push", exerciseLineageId: "lineage-inclinado", exerciseName: "Press inclinado" }),
    entry({ id: "entry-dominadas", sessionId: "session-pull", exerciseLineageId: "lineage-dominadas", exerciseName: "Dominadas" }),
    entry({ id: "entry-press", sessionId: "session-push", exerciseLineageId: "lineage-press", exerciseName: "Press banca" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(breakdown.routines.map((routine) => routine.routineId), [
    "routine-push",
    "routine-pull",
  ]);
  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-push"), [
    "Press banca",
    "Press inclinado",
  ]);
  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-pull"), ["Dominadas", "Remo"]);
}

// H1-F.5 Una semana ausente no mueve la posicion persistida del ejercicio.
function testMissingWeekRegistrationDoesNotMovePlannedExercise() {
  const cycleId = "cycle-missing-week";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: "routine-missing-week",
      name: "Push",
      sortOrder: 0,
      dayId: "day-missing-week",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-first", name: "Primer ejercicio", sortOrder: 0, lineageId: "lineage-first" },
        { id: "exercise-middle", name: "Ejercicio intermedio", sortOrder: 1, lineageId: "lineage-middle" },
        { id: "exercise-last", name: "Ultimo ejercicio", sortOrder: 2, lineageId: "lineage-last" },
      ],
    },
  ]);
  const sessions = [
    session({ id: "session-missing-w1", cycleId, routineId: "routine-missing-week", routineName: "Push", trainedDate: "2026-06-01" }),
    session({ id: "session-missing-w2", cycleId, routineId: "routine-missing-week", routineName: "Push", trainedDate: "2026-06-08" }),
  ];
  const entries = [
    entry({ id: "entry-w1-last", sessionId: "session-missing-w1", exerciseLineageId: "lineage-last", exerciseName: "Ultimo ejercicio" }),
    entry({ id: "entry-w1-first", sessionId: "session-missing-w1", exerciseLineageId: "lineage-first", exerciseName: "Primer ejercicio" }),
    entry({ id: "entry-w2-middle", sessionId: "session-missing-w2", exerciseLineageId: "lineage-middle", exerciseName: "Ejercicio intermedio" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-missing-week"), [
    "Primer ejercicio",
    "Ejercicio intermedio",
    "Ultimo ejercicio",
  ]);
  assert.deepEqual(Object.keys(breakdown.routines[0]?.exercises[1]?.weeks ?? {}).map(Number), [2]);
}

// H1-F.6 Un ejercicio incorporado despues conserva el sortOrder persistido en el ciclo.
function testExerciseAddedToActiveCycleKeepsPersistedPosition() {
  const cycleId = "cycle-added-exercise";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: "routine-added-exercise",
      name: "Piernas",
      sortOrder: 0,
      dayId: "day-added-exercise",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-original-a", name: "Zeta original", sortOrder: 0, lineageId: "lineage-original-a" },
        { id: "exercise-original-b", name: "Medio original", sortOrder: 1, lineageId: "lineage-original-b" },
        { id: "exercise-added", name: "Alfa agregado", sortOrder: 2, lineageId: "lineage-added" },
      ],
    },
  ]);
  const sessions = [
    session({ id: "session-added", cycleId, routineId: "routine-added-exercise", routineName: "Piernas" }),
  ];
  const entries = [
    entry({ id: "entry-added", sessionId: "session-added", exerciseLineageId: "lineage-added", exerciseName: "Alfa agregado" }),
    entry({ id: "entry-original-b", sessionId: "session-added", exerciseLineageId: "lineage-original-b", exerciseName: "Medio original" }),
    entry({ id: "entry-original-a", sessionId: "session-added", exerciseLineageId: "lineage-original-a", exerciseName: "Zeta original" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-added-exercise"), [
    "Zeta original",
    "Medio original",
    "Alfa agregado",
  ]);
}

// H1-F.7 Registros sin posicion quedan al final y usan un fallback persistido estable.
function testUnresolvedExercisesStayAfterKnownPositionsDeterministically() {
  const cycleId = "cycle-unresolved-order";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: "routine-unresolved-order",
      name: "Torso",
      sortOrder: 0,
      dayId: "day-unresolved-order",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-known", name: "Ejercicio conocido", sortOrder: 0, lineageId: "lineage-known" },
      ],
    },
  ]);
  const sessions = [
    session({ id: "session-unresolved", cycleId, routineId: "routine-unresolved-order", routineName: "Torso" }),
  ];
  const entries = [
    entry({ id: "entry-z-unresolved", sessionId: "session-unresolved", exerciseLineageId: null, trainingCycleExerciseId: null, exerciseName: "Primero recibido" }),
    entry({ id: "entry-known", sessionId: "session-unresolved", exerciseLineageId: "lineage-known", exerciseName: "Ejercicio conocido" }),
    entry({ id: "entry-a-unresolved", sessionId: "session-unresolved", exerciseLineageId: null, trainingCycleExerciseId: null, exerciseName: "Ultimo recibido" }),
  ];

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions,
    entries,
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseNamesForRoutine(breakdown, "routine-unresolved-order"), [
    "Ejercicio conocido",
    "Ultimo recibido",
    "Primero recibido",
  ]);
}

// H1-F.8 Ciclos distintos pueden conservar ordenes diferentes para el mismo dia.
function testHistoricalOrderIsIsolatedByCycle() {
  const routineFixture = {
    id: "routine-shared",
    name: "Push",
    sortOrder: 0,
    dayId: "day-shared",
    dayCode: "monday" as const,
    daySortOrder: 0,
  };
  const cycleOnePlan = planWithOrderedRoutines("cycle-one", [
    {
      ...routineFixture,
      exercises: [
        { id: "cycle-one-zeta", name: "Zeta Press", sortOrder: 0, lineageId: "lineage-zeta" },
        { id: "cycle-one-alfa", name: "Alfa Aperturas", sortOrder: 1, lineageId: "lineage-alfa" },
      ],
    },
  ]);
  const cycleTwoPlan = planWithOrderedRoutines("cycle-two", [
    {
      ...routineFixture,
      exercises: [
        { id: "cycle-two-alfa", name: "Alfa Aperturas", sortOrder: 0, lineageId: "lineage-alfa" },
        { id: "cycle-two-zeta", name: "Zeta Press", sortOrder: 1, lineageId: "lineage-zeta" },
      ],
    },
  ]);
  const cycleOne = buildCycleHistoryBreakdown({
    selectedCycleId: "cycle-one",
    plan: cycleOnePlan,
    sessions: [session({ id: "session-cycle-one", cycleId: "cycle-one", routineId: "routine-shared", routineName: "Push" })],
    entries: [],
    plannedStartDate: PLANNED_START_DATE,
  });
  const cycleTwo = buildCycleHistoryBreakdown({
    selectedCycleId: "cycle-two",
    plan: cycleTwoPlan,
    sessions: [session({ id: "session-cycle-two", cycleId: "cycle-two", routineId: "routine-shared", routineName: "Push" })],
    entries: [],
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseNamesForRoutine(cycleOne, "routine-shared"), [
    "Zeta Press",
    "Alfa Aperturas",
  ]);
  assert.deepEqual(exerciseNamesForRoutine(cycleTwo, "routine-shared"), [
    "Alfa Aperturas",
    "Zeta Press",
  ]);
}

// H1-F.1A Un empate de posiciones usa createdAt y no el orden fisico del plan.
function testDuplicateSortOrderIsStableAcrossInvertedPlanInput() {
  const cycleId = "cycle-duplicate-sort";
  const routine = {
    id: "routine-duplicate-sort",
    name: "Torso",
    sortOrder: 0,
    dayId: "day-duplicate-sort",
    dayCode: "monday" as const,
    daySortOrder: 0,
  };
  const exerciseX: OrderedExerciseFixture = {
    id: "exercise-x",
    name: "Ejercicio X",
    sortOrder: 0,
    createdAt: "2026-06-01T10:00:00.000Z",
    lineageId: "lineage-x",
  };
  const exerciseY: OrderedExerciseFixture = {
    id: "exercise-y",
    name: "Ejercicio Y",
    sortOrder: 0,
    createdAt: "2026-06-02T10:00:00.000Z",
    lineageId: "lineage-y",
  };
  const planA = planWithOrderedRoutines(cycleId, [{ ...routine, exercises: [exerciseX, exerciseY] }]);
  const planB = planWithOrderedRoutines(cycleId, [{ ...routine, exercises: [exerciseY, exerciseX] }]);

  const resultA = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan: planA,
    sessions: [],
    entries: [],
    plannedStartDate: PLANNED_START_DATE,
  });
  const resultB = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan: planB,
    sessions: [],
    entries: [],
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(
    exerciseIdentityKeysForRoutine(resultA, routine.id),
    ["lineage-x", "lineage-y"],
  );
  assert.deepEqual(
    exerciseIdentityKeysForRoutine(resultB, routine.id),
    exerciseIdentityKeysForRoutine(resultA, routine.id),
  );
}

// H1-F.1B Nombre y posicion iguales caen en identidad persistida, no en nombre ni input.
function testDuplicateNameAndSortOrderUsePersistedIdentityFallback() {
  const cycleId = "cycle-identity-tie";
  const routine = {
    id: "routine-identity-tie",
    name: "Piernas",
    sortOrder: 0,
    dayId: "day-identity-tie",
    dayCode: "monday" as const,
    daySortOrder: 0,
  };
  const zeta: OrderedExerciseFixture = {
    id: "exercise-zeta",
    name: "Mismo ejercicio",
    sortOrder: 0,
    createdAt: "2026-06-01T10:00:00.000Z",
    lineageId: "lineage-zeta",
  };
  const alfa: OrderedExerciseFixture = {
    id: "exercise-alfa",
    name: "Mismo ejercicio",
    sortOrder: 0,
    createdAt: "2026-06-01T10:00:00.000Z",
    lineageId: "lineage-alfa",
  };
  const plan = planWithOrderedRoutines(cycleId, [{ ...routine, exercises: [zeta, alfa] }]);
  const invertedPlan = planWithOrderedRoutines(cycleId, [{ ...routine, exercises: [alfa, zeta] }]);

  const identityOrder = [plan, invertedPlan].map((candidate) => {
    const breakdown = buildCycleHistoryBreakdown({
      selectedCycleId: cycleId,
      plan: candidate,
      sessions: [],
      entries: [],
      plannedStartDate: PLANNED_START_DATE,
    });
    return exerciseIdentityKeysForRoutine(breakdown, routine.id);
  });

  assert.deepEqual(identityOrder[0], ["lineage-alfa", "lineage-zeta"]);
  assert.deepEqual(identityOrder[1], identityOrder[0]);
}

// H1-F.1C Permutaciones equivalentes producen la misma salida en ejecuciones repetidas.
function testEquivalentShuffledPlansRemainDeterministicAcrossRuns() {
  const cycleId = "cycle-repeated-tie";
  const routine = {
    id: "routine-repeated-tie",
    name: "Full body",
    sortOrder: 0,
    dayId: "day-repeated-tie",
    dayCode: "monday" as const,
    daySortOrder: 0,
  };
  const exercises: OrderedExerciseFixture[] = [
    { id: "exercise-c", name: "C", sortOrder: 0, createdAt: null, lineageId: "lineage-c" },
    { id: "exercise-a", name: "A", sortOrder: 0, createdAt: null, lineageId: "lineage-a" },
    { id: "exercise-b", name: "B", sortOrder: 0, createdAt: null, lineageId: "lineage-b" },
  ];
  const permutations = [
    exercises,
    [exercises[2], exercises[0], exercises[1]],
    [exercises[1], exercises[2], exercises[0]],
  ];
  const observedOrders: string[][] = [];

  for (let run = 0; run < 3; run += 1) {
    for (const permutation of permutations) {
      const plan = planWithOrderedRoutines(cycleId, [{ ...routine, exercises: permutation }]);
      const breakdown = buildCycleHistoryBreakdown({
        selectedCycleId: cycleId,
        plan,
        sessions: [],
        entries: [],
        plannedStartDate: PLANNED_START_DATE,
      });
      observedOrders.push(exerciseIdentityKeysForRoutine(breakdown, routine.id));
    }
  }

  for (const order of observedOrders) {
    assert.deepEqual(order, ["lineage-a", "lineage-b", "lineage-c"]);
  }
}

// H1-F.1D Posiciones no finitas quedan al final y usan un fallback persistido.
function testNonFinitePositionsAreUnresolvedAndDeterministic() {
  const cycleId = "cycle-non-finite-order";
  const routineId = "routine-non-finite-order";
  const plan = planWithOrderedRoutines(cycleId, [
    {
      id: routineId,
      name: "Torso",
      sortOrder: 0,
      dayId: "day-non-finite-order",
      dayCode: "monday",
      daySortOrder: 0,
      exercises: [
        { id: "exercise-infinity", name: "Infinity", sortOrder: Number.POSITIVE_INFINITY, createdAt: "2026-06-03T00:00:00.000Z", lineageId: "lineage-infinity" },
        { id: "exercise-valid", name: "Valido", sortOrder: 0, createdAt: "2026-06-04T00:00:00.000Z", lineageId: "lineage-valid" },
        { id: "exercise-nan", name: "NaN", sortOrder: Number.NaN, createdAt: "2026-06-02T00:00:00.000Z", lineageId: "lineage-nan" },
        { id: "exercise-negative-infinity", name: "-Infinity", sortOrder: Number.NEGATIVE_INFINITY, createdAt: "2026-06-01T00:00:00.000Z", lineageId: "lineage-negative-infinity" },
      ],
    },
  ]);

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions: [],
    entries: [],
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseIdentityKeysForRoutine(breakdown, routineId), [
    "lineage-valid",
    "lineage-negative-infinity",
    "lineage-nan",
    "lineage-infinity",
  ]);
}

// H1-F.1E Una rutina con dos dias respeta primero dia y luego ejercicio.
function testTwoDaysWithinOneRoutineKeepHistoricalDayAndExerciseOrder() {
  const cycleId = "cycle-two-days-one-routine";
  const routineId = "routine-two-days";
  const plan: CycleHistoryPlan = {
    cycleId,
    routines: [
      {
        id: routineId,
        name: "Full body",
        sortOrder: 0,
        days: [
          {
            id: "day-second",
            routineId,
            weekIndex: 1,
            dayCode: "wednesday",
            sortOrder: 1,
            exercises: [
              { id: "second-b", name: "Segundo B", targetSets: 3, targetReps: 10, baseWeight: 100, sortOrder: 1, exerciseLineageId: "lineage-second-b" },
              { id: "second-a", name: "Segundo A", targetSets: 3, targetReps: 10, baseWeight: 100, sortOrder: 0, exerciseLineageId: "lineage-second-a" },
            ],
          },
          {
            id: "day-first",
            routineId,
            weekIndex: 1,
            dayCode: "monday",
            sortOrder: 0,
            exercises: [
              { id: "first-b", name: "Primero B", targetSets: 3, targetReps: 10, baseWeight: 100, sortOrder: 1, exerciseLineageId: "lineage-first-b" },
              { id: "first-a", name: "Primero A", targetSets: 3, targetReps: 10, baseWeight: 100, sortOrder: 0, exerciseLineageId: "lineage-first-a" },
            ],
          },
        ],
      },
    ],
  };

  const breakdown = buildCycleHistoryBreakdown({
    selectedCycleId: cycleId,
    plan,
    sessions: [],
    entries: [],
    plannedStartDate: PLANNED_START_DATE,
  });

  assert.deepEqual(exerciseIdentityKeysForRoutine(breakdown, routineId), [
    "lineage-first-a",
    "lineage-first-b",
    "lineage-second-a",
    "lineage-second-b",
  ]);
  assert.equal(breakdown.routines[0]?.exercises.length, 4);
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
testHistoricalPlanOrderOverridesAlphabeticalAndEntryOrder();
testHistoricalOrderIsStableAcrossShuffledWeeks();
testMultipleRoutineDaysKeepIndependentHistoricalOrder();
testMissingWeekRegistrationDoesNotMovePlannedExercise();
testExerciseAddedToActiveCycleKeepsPersistedPosition();
testUnresolvedExercisesStayAfterKnownPositionsDeterministically();
testHistoricalOrderIsIsolatedByCycle();
testDuplicateSortOrderIsStableAcrossInvertedPlanInput();
testDuplicateNameAndSortOrderUsePersistedIdentityFallback();
testEquivalentShuffledPlansRemainDeterministicAcrossRuns();
testNonFinitePositionsAreUnresolvedAndDeterministic();
testTwoDaysWithinOneRoutineKeepHistoricalDayAndExerciseOrder();
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
