import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadRepositoryCycles,
  mapRepositoryCycle,
} from "@/lib/training/cycle-history/cycle-history-data-source";
import {
  countCycleScopedTrainingDays,
  createCycleScopedTrainingDayCountsLoader,
} from "@/lib/training/cycle-scoped-training-repository";
import type { TrainingCycle } from "@/lib/training/training-cycles-repository";

const USER_ID = "e936bd5c-11fb-43cf-b31c-67125a4caf54";
const OTHER_USER_ID = "04f53599-148f-4fb8-9b96-086be5c58dd2";
const CYCLE_A = "cycle-a";
const CYCLE_B = "cycle-b";

interface StoredTrainingDayRow {
  user_id: string;
  cycle_id: string;
  day_code: unknown;
  deleted_at: string | null;
}

interface TrainingDayQueryCalls {
  auth: number;
  from: string[];
  select: string[];
  eq: Array<{ column: string; value: unknown }>;
  in: Array<{ column: string; values: readonly string[] }>;
  is: Array<{ column: string; value: unknown }>;
}

function makeRepositoryCycle(
  id: string,
  source = "cycle-scoped",
  snapshotDayCodes: string[] = ["monday", "wednesday", "friday"],
): TrainingCycle {
  return {
    id,
    name: `Ciclo ${id}`,
    cycleNumber: id === CYCLE_A ? 1 : 2,
    cycleType: "strength",
    goal: null,
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: "2026-06-28T00:00:00.000Z",
    plannedStartDate: "2026-06-01",
    plannedEndDate: "2026-06-28",
    status: "completed",
    planSnapshot: {
      source,
      durationWeeks: 4,
      plan: {
        routines: [{ days: snapshotDayCodes.map((dayCode) => ({ day_code: dayCode })) }],
      },
    },
    summarySnapshot: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  };
}

function createTrainingDayClient(rows: readonly StoredTrainingDayRow[]) {
  const calls: TrainingDayQueryCalls = {
    auth: 0,
    from: [],
    select: [],
    eq: [],
    in: [],
    is: [],
  };
  let requestedUserId: string | null = null;
  let requestedCycleIds: readonly string[] = [];
  let requiresActiveRows = false;

  const query = {
    select(columns: string) {
      calls.select.push(columns);
      return query;
    },
    eq(column: string, value: unknown) {
      calls.eq.push({ column, value });
      if (column === "user_id" && typeof value === "string") requestedUserId = value;
      return query;
    },
    in(column: string, values: readonly string[]) {
      calls.in.push({ column, values: [...values] });
      if (column === "cycle_id") requestedCycleIds = [...values];
      return query;
    },
    is(column: string, value: unknown) {
      calls.is.push({ column, value });
      if (column === "deleted_at" && value === null) requiresActiveRows = true;

      const data = rows
        .filter((row) => requestedUserId === null || row.user_id === requestedUserId)
        .filter((row) => requestedCycleIds.includes(row.cycle_id))
        .filter((row) => !requiresActiveRows || row.deleted_at === null)
        .map((row) => ({ cycle_id: row.cycle_id, day_code: row.day_code }));
      return Promise.resolve({ data, error: null });
    },
  };

  const client = {
    auth: {
      getUser: async () => {
        calls.auth += 1;
        return { data: { user: { id: USER_ID } }, error: null };
      },
    },
    from(table: string) {
      calls.from.push(table);
      return query;
    },
  } as unknown as SupabaseClient;

  return { calls, client };
}

function testPureDayCountAggregation() {
  assert.equal(countCycleScopedTrainingDays([CYCLE_A], [
    { cycleId: CYCLE_A, dayCode: "monday" },
    { cycleId: CYCLE_A, dayCode: "wednesday" },
    { cycleId: CYCLE_A, dayCode: "friday" },
  ]).get(CYCLE_A), 3);

  assert.equal(countCycleScopedTrainingDays([CYCLE_A], [
    { cycleId: CYCLE_A, dayCode: "monday" },
    { cycleId: CYCLE_A, dayCode: "tuesday" },
    { cycleId: CYCLE_A, dayCode: "wednesday" },
    { cycleId: CYCLE_A, dayCode: "thursday" },
    { cycleId: CYCLE_A, dayCode: "friday" },
    { cycleId: CYCLE_A, dayCode: "saturday" },
    { cycleId: CYCLE_A, dayCode: "sunday" },
  ]).get(CYCLE_A), 7);

  const isolatedCounts = countCycleScopedTrainingDays([CYCLE_A, CYCLE_B], [
    { cycleId: CYCLE_A, dayCode: "monday" },
    { cycleId: CYCLE_A, dayCode: "monday" },
    { cycleId: CYCLE_A, dayCode: "invalid" },
    { cycleId: CYCLE_B, dayCode: "tuesday" },
    { cycleId: CYCLE_B, dayCode: "thursday" },
    { cycleId: "not-requested", dayCode: "sunday" },
  ]);
  assert.deepEqual(Array.from(isolatedCounts), [[CYCLE_A, 1], [CYCLE_B, 2]]);
}

async function testRepositoryLoaderUsesOneAuthenticatedBatchQuery() {
  const { calls, client } = createTrainingDayClient([
    { user_id: USER_ID, cycle_id: CYCLE_A, day_code: "monday", deleted_at: null },
    { user_id: USER_ID, cycle_id: CYCLE_A, day_code: "monday", deleted_at: null },
    { user_id: USER_ID, cycle_id: CYCLE_A, day_code: "saturday", deleted_at: "2026-07-01" },
    { user_id: USER_ID, cycle_id: CYCLE_A, day_code: "invalid", deleted_at: null },
    { user_id: USER_ID, cycle_id: CYCLE_B, day_code: "tuesday", deleted_at: null },
    { user_id: OTHER_USER_ID, cycle_id: CYCLE_B, day_code: "sunday", deleted_at: null },
  ]);
  let clientFactoryCalls = 0;
  const loader = createCycleScopedTrainingDayCountsLoader(() => {
    clientFactoryCalls += 1;
    return client;
  });

  const counts = await loader([CYCLE_A, CYCLE_B, CYCLE_A]);

  assert.deepEqual(Array.from(counts), [[CYCLE_A, 1], [CYCLE_B, 1]]);
  assert.equal(clientFactoryCalls, 1);
  assert.equal(calls.auth, 1);
  assert.deepEqual(calls.from, ["training_cycle_days"]);
  assert.deepEqual(calls.select, ["cycle_id,day_code"]);
  assert.deepEqual(calls.eq, [{ column: "user_id", value: USER_ID }]);
  assert.deepEqual(calls.in, [{ column: "cycle_id", values: [CYCLE_A, CYCLE_B] }]);
  assert.deepEqual(calls.is, [{ column: "deleted_at", value: null }]);
}

async function testEmptyCycleListSkipsAuthenticationAndQuery() {
  let clientFactoryCalls = 0;
  const loader = createCycleScopedTrainingDayCountsLoader(() => {
    clientFactoryCalls += 1;
    return null;
  });

  assert.deepEqual(Array.from(await loader([])), []);
  assert.equal(clientFactoryCalls, 0);
}

async function testDataSourceUsesPersistedCountsInsteadOfSnapshot() {
  const cycleA = makeRepositoryCycle(CYCLE_A);
  const cycleB = makeRepositoryCycle(CYCLE_B, "cycle-scoped-qa", ["monday"]);
  const legacyCycle = makeRepositoryCycle("legacy-cycle", "legacy", ["monday", "tuesday"]);
  const dayCountCalls: string[][] = [];

  const cycles = await loadRepositoryCycles({
    getActiveCycle: async () => cycleA,
    getHistoricalCycles: async () => [cycleB, legacyCycle],
    getTrainingDayCounts: async (cycleIds) => {
      dayCountCalls.push([...cycleIds]);
      return new Map([[CYCLE_A, 4], [CYCLE_B, 2]]);
    },
  });

  assert.deepEqual(dayCountCalls, [[CYCLE_A, CYCLE_B]]);
  assert.equal(cycles.find((cycle) => cycle.id === CYCLE_A)?.trainingDayCount, 4);
  assert.equal(cycles.find((cycle) => cycle.id === CYCLE_B)?.trainingDayCount, 2);
  assert.equal(cycles.find((cycle) => cycle.id === "legacy-cycle")?.trainingDayCount, null);
  assert.equal(mapRepositoryCycle(cycleA, null).trainingDayCount, null);
}

async function testEmptyRepositoryListSkipsDayCountBatch() {
  let dayCountCalls = 0;
  const cycles = await loadRepositoryCycles({
    getActiveCycle: async () => null,
    getHistoricalCycles: async () => [],
    getTrainingDayCounts: async () => {
      dayCountCalls += 1;
      return new Map();
    },
  });

  assert.deepEqual(cycles, []);
  assert.equal(dayCountCalls, 0);
}

function testCanonicalSourceContract() {
  const repositorySource = readFileSync(
    "src/lib/training/cycle-scoped-training-repository.ts",
    "utf8",
  );
  const loaderSource = repositorySource.match(
    /export function createCycleScopedTrainingDayCountsLoader[\s\S]*?export const getCycleScopedTrainingDayCounts/,
  )?.[0] ?? "";
  const dataSource = readFileSync(
    "src/lib/training/cycle-history/cycle-history-data-source.ts",
    "utf8",
  );

  assert.match(loaderSource, /\.from\("training_cycle_days"\)/);
  assert.match(loaderSource, /\.select\("cycle_id,day_code"\)/);
  assert.match(loaderSource, /\.eq\("user_id", userId\)/);
  assert.match(loaderSource, /\.in\("cycle_id", uniqueCycleIds\)/);
  assert.match(loaderSource, /\.is\("deleted_at", null\)/);
  assert.doesNotMatch(loaderSource, /training_sessions|exercise_entries|trained_date|planned_date/);
  assert.match(dataSource, /getCycleScopedTrainingDayCounts/);
  assert.match(dataSource, /trainingDayCount,/);
  assert.doesNotMatch(dataSource, /readTrainingDayCount/);
}

async function run() {
  testPureDayCountAggregation();
  await testRepositoryLoaderUsesOneAuthenticatedBatchQuery();
  await testEmptyCycleListSkipsAuthenticationAndQuery();
  await testDataSourceUsesPersistedCountsInsteadOfSnapshot();
  await testEmptyRepositoryListSkipsDayCountBatch();
  testCanonicalSourceContract();

  console.log("cycle-history-training-day-count tests passed");
}

void run();
