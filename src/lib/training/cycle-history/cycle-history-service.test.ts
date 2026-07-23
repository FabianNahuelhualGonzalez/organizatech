import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type {
  CycleHistoryDataSource,
  CycleHistorySourceCycle,
  CycleHistorySourceCycleData,
} from "@/lib/training/cycle-history/cycle-history-data-source";
import { createCycleHistoryService } from "@/lib/training/cycle-history/cycle-history-service";
import type { CycleHistoryPersonalData } from "@/lib/training/cycle-history/cycle-history-types";

const CYCLE_A = "cycle-a";
const CYCLE_B = "cycle-b";

interface FakeSourceControl {
  source: CycleHistoryDataSource;
  calls: { list: number; cycle: number; data: number; personal: number };
  requestedCycleIds: { cycle: string[]; data: string[] };
}

function makeCycle(
  id = CYCLE_A,
  overrides: Partial<CycleHistorySourceCycle> = {},
): CycleHistorySourceCycle {
  return {
    id,
    name: `Ciclo ${id}`,
    cycleNumber: id === CYCLE_A ? 1 : 2,
    cycleType: "strength",
    status: "completed",
    plannedStartDate: "2026-06-01",
    plannedEndDate: "2026-06-28",
    startedAt: "2026-06-01T10:00:00.000Z",
    endedAt: "2026-06-28T10:00:00.000Z",
    planSource: "cycle-scoped",
    durationWeeks: 4,
    trainingDayCount: 3,
    ...overrides,
  };
}

function makeCycleData(cycleId = CYCLE_A): CycleHistorySourceCycleData {
  return {
    plan: {
      routines: [
        {
          id: `routine-${cycleId}`,
          cycleId,
          name: "Piernas",
          sortOrder: 0,
          days: [
            {
              id: `day-${cycleId}`,
              cycleId,
              routineId: `routine-${cycleId}`,
              weekIndex: 1,
              dayCode: "monday",
              sortOrder: 0,
              exercises: [
                {
                  id: `exercise-${cycleId}`,
                  cycleId,
                  dayId: `day-${cycleId}`,
                  name: "Sentadilla",
                  targetSets: 3,
                  targetReps: 10,
                  baseWeight: 100,
                  sortOrder: 0,
                  exerciseLineageId: `lineage-${cycleId}`,
                },
              ],
            },
          ],
        },
      ],
    },
    sessions: [
      {
        id: `session-${cycleId}`,
        cycleId,
        routineId: `routine-${cycleId}`,
        routineName: "Piernas",
        calendarWeekStart: "2026-06-01",
        trainedDate: "2026-06-01",
        plannedDate: "2026-06-01",
        trainedAt: "2026-06-01T10:00:00.000Z",
      },
    ],
    entries: [
      {
        id: `entry-${cycleId}`,
        sessionId: `session-${cycleId}`,
        cycleId,
        exerciseLineageId: `lineage-${cycleId}`,
        trainingCycleExerciseId: `exercise-${cycleId}`,
        exerciseName: "Sentadilla",
        weight: 100,
        reps: [10, 10, 10],
      },
    ],
  };
}

function personalData(): CycleHistoryPersonalData {
  return {
    firstName: "Fabian",
    lastName: "QA",
    email: "qa@example.com",
    birthDate: "1997-12-18",
    gender: "male",
    phoneNumber: null,
  };
}

function createFakeSource(options: {
  cycles?: CycleHistorySourceCycle[];
  cycle?: CycleHistorySourceCycle | null;
  data?: CycleHistorySourceCycleData;
  error?: unknown;
} = {}): FakeSourceControl {
  const calls = { list: 0, cycle: 0, data: 0, personal: 0 };
  const requestedCycleIds = { cycle: [] as string[], data: [] as string[] };
  const cycles = options.cycles ?? [makeCycle()];
  const cycle = options.cycle === undefined ? makeCycle() : options.cycle;
  const data = options.data ?? makeCycleData();

  return {
    calls,
    requestedCycleIds,
    source: {
      async listCycles() {
        calls.list += 1;
        if (options.error) throw options.error;
        return cycles;
      },
      async loadCycle(selectedCycleId) {
        calls.cycle += 1;
        requestedCycleIds.cycle.push(selectedCycleId);
        if (options.error) throw options.error;
        return cycle;
      },
      async loadCycleData(selectedCycleId) {
        calls.data += 1;
        requestedCycleIds.data.push(selectedCycleId);
        if (options.error) throw options.error;
        return data;
      },
      async loadPersonalData() {
        calls.personal += 1;
        if (options.error) throw options.error;
        return personalData();
      },
    },
  };
}

function createService(control: FakeSourceControl, enabled = true) {
  return createCycleHistoryService({
    trainingCyclesRepositoryEnabled: enabled,
    dataSource: control.source,
    now: () => "2026-07-21T12:00:00.000Z",
  });
}

async function testEmptyList() {
  const control = createFakeSource({ cycles: [] });
  assert.deepEqual(await createService(control).listCycles(), { status: "empty", cycles: [] });
}

async function testDeterministicListOrderAndLegacyExclusion() {
  const control = createFakeSource({
    cycles: [
      makeCycle("cycle-z", { endedAt: null, startedAt: null, plannedStartDate: null }),
      makeCycle("cycle-b", { endedAt: "2026-07-01T00:00:00.000Z" }),
      makeCycle("cycle-a", { endedAt: "2026-07-01T00:00:00.000Z" }),
      makeCycle("legacy", { planSource: "legacy", endedAt: "2027-01-01T00:00:00.000Z" }),
    ],
  });
  const result = await createService(control).listCycles();
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.deepEqual(result.cycles.map((cycle) => cycle.cycleId), ["cycle-a", "cycle-b", "cycle-z"]);
  assert.deepEqual(control.calls, { list: 1, cycle: 0, data: 0, personal: 0 });
}

async function testTrainingDayCountPropagatesEquallyToListAndDetail() {
  const cycle = makeCycle(CYCLE_A, { trainingDayCount: 5 });
  const control = createFakeSource({ cycles: [cycle], cycle });
  const service = createService(control);

  const listResult = await service.listCycles();
  assert.equal(listResult.status, "ready");
  if (listResult.status !== "ready") return;
  assert.equal(listResult.cycles[0]?.trainingDayCount, 5);
  assert.deepEqual(control.calls, { list: 1, cycle: 0, data: 0, personal: 0 });

  const detailResult = await service.loadCycleDetail(CYCLE_A);
  assert.equal(detailResult.status, "ready");
  if (detailResult.status !== "ready") return;
  assert.equal(detailResult.data.metadata.trainingDayCount, 5);
  assert.equal(
    detailResult.data.metadata.trainingDayCount,
    listResult.cycles[0]?.trainingDayCount,
  );
}

async function testMissingPersistedDayCountRemainsNullable() {
  const cycle = makeCycle(CYCLE_A, { trainingDayCount: null });
  const control = createFakeSource({ cycles: [cycle], cycle });
  const service = createService(control);

  const listResult = await service.listCycles();
  assert.equal(listResult.status, "ready");
  if (listResult.status !== "ready") return;
  assert.equal(listResult.cycles[0]?.trainingDayCount, null);

  const detailResult = await service.loadCycleDetail(CYCLE_A);
  assert.equal(detailResult.status, "ready");
  if (detailResult.status !== "ready") return;
  assert.equal(detailResult.data.metadata.trainingDayCount, null);
}

async function testLoadsSelectedCycleAndBuildsPdfBase() {
  const control = createFakeSource();
  const result = await createService(control).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.data.metadata.cycleId, CYCLE_A);
  assert.equal(result.data.sessionCount, 1);
  assert.equal(result.data.entryCount, 1);
  assert.equal(result.data.metrics.totalVolumeKg, 3000);
  assert.equal(result.data.pdfModel.cycle.cycleId, CYCLE_A);
  assert.equal(result.data.pdfModel.generatedAt, "2026-07-21T12:00:00.000Z");
  assert.deepEqual(control.requestedCycleIds, { cycle: [CYCLE_A], data: [CYCLE_A] });
}

async function testAdaptsPlanSessionsAndEntries() {
  const result = await createService(createFakeSource()).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const routine = result.data.breakdown.routines[0];
  const exercise = routine?.exercises[0];
  assert.equal(result.data.plan.routines[0]?.days[0]?.exercises[0]?.id, `exercise-${CYCLE_A}`);
  assert.equal(routine?.routineName, "Piernas");
  assert.equal(exercise?.weeks[1]?.series[0]?.entryId, `entry-${CYCLE_A}`);
}

async function testRejectsPlanFromAnotherCycle() {
  const data = makeCycleData(CYCLE_A);
  data.plan.routines[0]!.cycleId = CYCLE_B;
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "plan_mismatch");
  assert.doesNotMatch(result.error.message, /supabase|postgres|select/i);
}

async function testFiltersSessionFromAnotherCycle() {
  const data = makeCycleData(CYCLE_A);
  data.sessions.push({ ...data.sessions[0]!, id: "foreign-session", cycleId: CYCLE_B });
  data.entries.push({ ...data.entries[0]!, id: "foreign-entry", sessionId: "foreign-session", cycleId: CYCLE_B });
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.data.sessionCount, 1);
  assert.equal(result.data.entryCount, 1);
  assert.doesNotMatch(JSON.stringify(result.data), /foreign-entry|foreign-session/);
}

async function testFiltersEntryWithMissingSession() {
  const data = makeCycleData(CYCLE_A);
  data.entries.push({ ...data.entries[0]!, id: "orphan", sessionId: "missing-session" });
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.data.entryCount, 1);
  assert.doesNotMatch(JSON.stringify(result.data), /orphan/);
}

async function testFiltersEntryWithDirectForeignCycle() {
  const data = makeCycleData(CYCLE_A);
  data.entries.push({ ...data.entries[0]!, id: "foreign-direct", cycleId: CYCLE_B });
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.data.entryCount, 1);
  assert.doesNotMatch(JSON.stringify(result.data), /foreign-direct/);
}

async function testMixedCyclesCannotContaminateResult() {
  const data = makeCycleData(CYCLE_A);
  const foreign = makeCycleData(CYCLE_B);
  data.sessions.push(...foreign.sessions);
  data.entries.push(...foreign.entries);
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const serialized = JSON.stringify(result.data);
  assert.doesNotMatch(serialized, /session-cycle-b|entry-cycle-b|lineage-cycle-b/);
  assert.equal(result.data.metadata.cycleId, CYCLE_A);
}

async function testIdentityPriorityAndRoutineComeFromSession() {
  const data = makeCycleData(CYCLE_A);
  data.entries[0]!.exerciseName = "Nombre historico";
  data.entries[0]!.trainingCycleExerciseId = "different-plan-id";
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const routine = result.data.breakdown.routines[0];
  const exercise = routine?.exercises.find((item) => item.identity.key === `lineage-${CYCLE_A}`);
  assert.equal(routine?.routineId, `routine-${CYCLE_A}`);
  assert.equal(routine?.routineName, "Piernas");
  assert.equal(exercise?.identity.kind, "lineage");
}

async function testExerciseIdentityFallsBackToTrainingCycleExerciseAndEntry() {
  const data = makeCycleData(CYCLE_A);
  data.entries = [
    { ...data.entries[0]!, id: "tce-entry", exerciseLineageId: null },
    {
      ...data.entries[0]!,
      id: "unmatched-entry",
      exerciseLineageId: null,
      trainingCycleExerciseId: null,
    },
  ];
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  const identities = result.data.breakdown.routines
    .flatMap((routine) => routine.exercises)
    .map((exercise) => `${exercise.identity.kind}:${exercise.identity.key}`);
  assert.ok(identities.includes(`trainingCycleExercise:exercise-${CYCLE_A}`));
  assert.ok(identities.includes("unmatched:entry:unmatched-entry"));
}

async function testServiceSharesHistoricalExerciseOrderWithPdfModel() {
  const data = makeCycleData(CYCLE_A);
  const routine = data.plan.routines[0]!;
  const day = routine.days[0]!;
  day.exercises = [
    {
      id: "exercise-zeta",
      cycleId: CYCLE_A,
      dayId: day.id,
      name: "Zeta Press",
      targetSets: 3,
      targetReps: 10,
      baseWeight: 100,
      sortOrder: 0,
      exerciseLineageId: "lineage-zeta",
    },
    {
      id: "exercise-alfa",
      cycleId: CYCLE_A,
      dayId: day.id,
      name: "Alfa Aperturas",
      targetSets: 3,
      targetReps: 10,
      baseWeight: 80,
      sortOrder: 1,
      exerciseLineageId: "lineage-alfa",
    },
    {
      id: "exercise-medio",
      cycleId: CYCLE_A,
      dayId: day.id,
      name: "Medio Inclinado",
      targetSets: 3,
      targetReps: 10,
      baseWeight: 90,
      sortOrder: 2,
      exerciseLineageId: "lineage-medio",
    },
  ];
  const sourceEntry = data.entries[0]!;
  data.entries = [
    {
      ...sourceEntry,
      id: "entry-alfa",
      exerciseLineageId: "lineage-alfa",
      trainingCycleExerciseId: "exercise-alfa",
      exerciseName: "Alfa Aperturas",
    },
    {
      ...sourceEntry,
      id: "entry-medio",
      exerciseLineageId: "lineage-medio",
      trainingCycleExerciseId: "exercise-medio",
      exerciseName: "Medio Inclinado",
    },
    {
      ...sourceEntry,
      id: "entry-zeta",
      exerciseLineageId: "lineage-zeta",
      trainingCycleExerciseId: "exercise-zeta",
      exerciseName: "Zeta Press",
    },
  ];

  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  const detailExercises = result.data.breakdown.routines[0]?.exercises;
  const pdfExercises = result.data.pdfModel.routines[0]?.exercises;
  const expectedOrder = ["Zeta Press", "Alfa Aperturas", "Medio Inclinado"];
  assert.deepEqual(detailExercises?.map((exercise) => exercise.name), expectedOrder);
  assert.deepEqual(pdfExercises?.map((exercise) => exercise.name), expectedOrder);
  assert.equal(
    pdfExercises,
    detailExercises,
    "CycleHistoryDetail y CycleHistoryPdfModel deben compartir el arreglo ya ordenado",
  );
}

async function testDisabledFlagMakesNoRepositoryCalls() {
  const control = createFakeSource();
  const service = createService(control, false);
  assert.deepEqual(await service.listCycles(), { status: "disabled" });
  assert.deepEqual(await service.loadCycleDetail(CYCLE_A), { status: "disabled" });
  assert.deepEqual(control.calls, { list: 0, cycle: 0, data: 0, personal: 0 });
}

async function testRepositoryErrorIsSanitized() {
  const rawMessage = "select * from profiles where secret_token = abc";
  const result = await createService(createFakeSource({ error: new Error(rawMessage) })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "unexpected");
  assert.equal(result.error.message, "No pudimos cargar el detalle de este ciclo.");
  assert.doesNotMatch(JSON.stringify(result), /secret_token|select \*/i);
}

async function testUnknownCycleReturnsTypedErrorWithoutLoadingData() {
  const control = createFakeSource({ cycle: null });
  const result = await createService(control).loadCycleDetail("missing-cycle");
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "cycle_not_found");
  assert.equal(control.calls.data, 0);
  assert.equal(control.calls.personal, 0);
}

async function testLoadedCycleMustMatchSelectedId() {
  const result = await createService(createFakeSource({ cycle: makeCycle(CYCLE_B) })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "cycle_mismatch");
}

async function testLegacyCycleIsNotReinterpretedOrQueried() {
  const control = createFakeSource({ cycle: makeCycle(CYCLE_A, { planSource: "legacy" }) });
  const result = await createService(control).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "error");
  if (result.status !== "error") return;
  assert.equal(result.error.code, "cycle_not_available");
  assert.equal(control.calls.data, 0);
  assert.equal(control.calls.personal, 0);
}

async function testNoRegistrationsReturnsEmptyDetail() {
  const data = makeCycleData(CYCLE_A);
  data.sessions = [];
  data.entries = [];
  const result = await createService(createFakeSource({ data })).loadCycleDetail(CYCLE_A);
  assert.equal(result.status, "empty");
  if (result.status !== "empty") return;
  assert.equal(result.data.metrics.totalVolumeKg, 0);
  assert.equal(result.data.sessionCount, 0);
  assert.equal(result.data.entryCount, 0);
}

async function testInputsAreNotMutatedAndResultsAreDeterministic() {
  const data = makeCycleData(CYCLE_A);
  const before = JSON.stringify(data);
  const control = createFakeSource({ data });
  const service = createService(control);
  const first = await service.loadCycleDetail(CYCLE_A);
  const second = await service.loadCycleDetail(CYCLE_A);
  assert.equal(JSON.stringify(data), before);
  assert.deepEqual(first, second);
}

function testProductionDataSourceHasNoLegacyQueries() {
  const source = readFileSync(
    "src/lib/training/cycle-history/cycle-history-data-source.ts",
    "utf8",
  );
  assert.match(source, /getCycleScopedTrainingPlan/);
  assert.match(source, /getCycleScopedTrainingSessionData/);
  assert.match(source, /getCycleScopedTrainingDayCounts/);
  assert.match(source, /trainingDayCount,/);
  assert.doesNotMatch(source, /readTrainingDayCount/);
  assert.doesNotMatch(source, /fetchEntries|fetchSessions|getRoutines|getExercises|loadAppData/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|window\.|document\.|react/i);
}

async function run() {
  await testEmptyList();
  await testDeterministicListOrderAndLegacyExclusion();
  await testTrainingDayCountPropagatesEquallyToListAndDetail();
  await testMissingPersistedDayCountRemainsNullable();
  await testLoadsSelectedCycleAndBuildsPdfBase();
  await testAdaptsPlanSessionsAndEntries();
  await testRejectsPlanFromAnotherCycle();
  await testFiltersSessionFromAnotherCycle();
  await testFiltersEntryWithMissingSession();
  await testFiltersEntryWithDirectForeignCycle();
  await testMixedCyclesCannotContaminateResult();
  await testIdentityPriorityAndRoutineComeFromSession();
  await testExerciseIdentityFallsBackToTrainingCycleExerciseAndEntry();
  await testServiceSharesHistoricalExerciseOrderWithPdfModel();
  await testDisabledFlagMakesNoRepositoryCalls();
  await testRepositoryErrorIsSanitized();
  await testUnknownCycleReturnsTypedErrorWithoutLoadingData();
  await testLoadedCycleMustMatchSelectedId();
  await testLegacyCycleIsNotReinterpretedOrQueried();
  await testNoRegistrationsReturnsEmptyDetail();
  await testInputsAreNotMutatedAndResultsAreDeterministic();
  testProductionDataSourceHasNoLegacyQueries();

  console.log("cycle-history-service tests passed");
}

void run();
