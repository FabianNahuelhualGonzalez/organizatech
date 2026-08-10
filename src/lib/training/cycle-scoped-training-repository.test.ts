import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assembleCycleScopedTrainingSessionData,
  CycleScopedTrainingRepositoryError,
  getCycleScopedTrainingPlan,
  getCycleScopedTrainingSessionRawData,
  type CycleScopedTrainingPlan,
} from "@/lib/training/cycle-scoped-training-repository";

const USER_ID = "e936bd5c-11fb-43cf-b31c-67125a4caf54";
const OTHER_USER_ID = "04f53599-148f-4fb8-9b96-086be5c58dd2";
const CYCLE_ID = "cycle-a";
const OTHER_CYCLE_ID = "cycle-b";
const TEST_PATH = "src/lib/training/cycle-scoped-training-repository.test.ts";
const TEST_REGISTRATION = `tsx --test ${TEST_PATH}`;

const TABLES = [
  "training_cycle_routines",
  "training_cycle_days",
  "training_cycle_exercises",
] as const;

const HISTORICAL_EXERCISE_ID = "exercise-historical";

function createHistoricalPlan(): CycleScopedTrainingPlan {
  return {
    routines: [{
      id: "routine-a",
      cycleId: CYCLE_ID,
      name: "Rutina A",
      sortOrder: 1,
      notes: null,
      days: [{
        id: "day-a",
        cycleId: CYCLE_ID,
        routineId: "routine-a",
        weekIndex: 1,
        dayCode: "monday",
        sortOrder: 1,
        notes: null,
        exercises: [{
          id: "exercise-current",
          cycleId: CYCLE_ID,
          dayId: "day-a",
          name: "Sentadilla actual",
          targetSets: 4,
          targetReps: 6,
          baseWeight: 90,
          sideWeight: null,
          sortOrder: 1,
          createdAt: "2026-08-02T00:00:00.000Z",
          notes: null,
          sourceLegacyExerciseId: null,
          exerciseLineageId: "lineage-a",
        }],
      }],
    }],
  };
}

interface HistoricalQueryCall {
  table: "training_sessions" | "exercise_entries";
  select: string;
  eq: Array<{ column: string; value: unknown }>;
  is: Array<{ column: string; value: unknown }>;
  order: Array<{ column: string; ascending: boolean }>;
}

function createHistoricalJoinClient(options: {
  relatedUserId?: string;
  relatedCycleId?: string;
  relatedName?: string;
} = {}) {
  const calls: HistoricalQueryCall[] = [];
  const historicalExercise = {
    id: HISTORICAL_EXERCISE_ID,
    user_id: options.relatedUserId ?? USER_ID,
    cycle_id: options.relatedCycleId ?? CYCLE_ID,
    day_id: "day-a",
    name: options.relatedName ?? "Sentadilla histórica",
    target_sets: 3,
    target_reps: 8,
    base_weight: 80,
    side_weight: null,
    sort_order: 0,
    created_at: "2026-08-01T00:00:00.000Z",
    deleted_at: null,
    notes: null,
    source_legacy_exercise_id: null,
    exercise_lineage_id: "lineage-a",
  };
  const rows = {
    training_sessions: [
      {
        id: "session-new", cycle_id: CYCLE_ID, cycle_day_id: "day-a", week_number: 2,
        trained_at: "2026-08-09T10:00:00.000Z", calendar_week_start: "2026-08-03",
        planned_day: "monday", planned_date: "2026-08-09", trained_date: "2026-08-09",
        status: "completed", completed_at: "2026-08-09T11:00:00.000Z", deleted_at: null,
        notes: null, created_at: "2026-08-09T10:00:00.000Z",
      },
      {
        id: "session-old", cycle_id: CYCLE_ID, cycle_day_id: "day-a", week_number: 1,
        trained_at: "2026-08-02T10:00:00.000Z", calendar_week_start: "2026-07-27",
        planned_day: "monday", planned_date: "2026-08-02", trained_date: "2026-08-02",
        status: "completed", completed_at: "2026-08-02T11:00:00.000Z", deleted_at: null,
        notes: null, created_at: "2026-08-02T10:00:00.000Z",
      },
    ],
    exercise_entries: [
      {
        id: "entry-old", session_id: "session-old", exercise_id: null,
        training_cycle_exercise_id: HISTORICAL_EXERCISE_ID, exercise_lineage_id: "lineage-a",
        weight: 80, previous_weight: 75, reps: [8, 8, 7], rir: "2", notes: null,
        created_at: "2026-08-02T10:10:00.000Z",
        training_cycle_exercises: [historicalExercise, { ...historicalExercise }],
      },
      {
        id: "entry-new", session_id: "session-new", exercise_id: null,
        training_cycle_exercise_id: "exercise-current", exercise_lineage_id: "lineage-a",
        weight: 90, previous_weight: 80, reps: [6, 6, 6], rir: "1", notes: null,
        created_at: "2026-08-09T10:10:00.000Z", training_cycle_exercises: null,
      },
      {
        id: "entry-orphan", session_id: "session-other", exercise_id: null,
        training_cycle_exercise_id: HISTORICAL_EXERCISE_ID, exercise_lineage_id: "lineage-a",
        weight: 1, previous_weight: 1, reps: [1], rir: null, notes: null,
        created_at: "2026-08-10T10:10:00.000Z", training_cycle_exercises: historicalExercise,
      },
    ],
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from(table: HistoricalQueryCall["table"]) {
      const call: HistoricalQueryCall = { table, select: "", eq: [], is: [], order: [] };
      calls.push(call);
      const query = {
        select(columns: string) { call.select = columns; return query; },
        eq(column: string, value: unknown) { call.eq.push({ column, value }); return query; },
        is(column: string, value: unknown) { call.is.push({ column, value }); return query; },
        order(column: string, order: { ascending?: boolean }) {
          call.order.push({ column, ascending: order.ascending !== false });
          return query;
        },
        then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
          onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve({ data: rows[table], error: null }).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

type PlanTable = (typeof TABLES)[number];
type StoredRow = Record<string, unknown>;

test("PERF-05D está registrado exactamente una vez en la suite global", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    packageManifest.scripts.test.split(TEST_REGISTRATION).length - 1,
    1,
    "el test aparece una vez en npm test",
  );
  assert.equal(
    Object.values(packageManifest.scripts).join("\n").split(TEST_REGISTRATION).length - 1,
    1,
    "el registro no se duplica en otros scripts",
  );
  assert.equal(existsSync(TEST_PATH), true, "el archivo registrado existe");
});

interface QueryCall {
  table: PlanTable;
  select: string;
  eq: Array<{ column: string; value: unknown }>;
  is: Array<{ column: string; value: unknown }>;
  order: Array<{ column: string; ascending: boolean }>;
}

interface QueryResult {
  data: StoredRow[] | null;
  error: unknown;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function compareValues(left: unknown, right: unknown) {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return String(left).localeCompare(String(right));
}

function createDeferredPlanClient(options?: {
  errors?: Partial<Record<PlanTable, unknown>>;
}) {
  const identity = createDeferred<void>();
  const rows: Record<PlanTable, StoredRow[]> = {
    training_cycle_routines: [
      {
        id: "routine-b",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        name: "Rutina B",
        sort_order: 2,
        created_at: "2026-08-02T00:00:00.000Z",
        deleted_at: null,
        notes: null,
      },
      {
        id: "routine-a",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        name: "Rutina A",
        sort_order: 1,
        created_at: "2026-08-01T00:00:00.000Z",
        deleted_at: null,
        notes: "principal",
      },
      {
        id: "routine-other-cycle",
        user_id: USER_ID,
        cycle_id: OTHER_CYCLE_ID,
        name: "Otro ciclo",
        sort_order: 0,
        created_at: "2026-07-01T00:00:00.000Z",
        deleted_at: null,
        notes: null,
      },
      {
        id: "routine-other-user",
        user_id: OTHER_USER_ID,
        cycle_id: CYCLE_ID,
        name: "Otro usuario",
        sort_order: 0,
        created_at: "2026-07-01T00:00:00.000Z",
        deleted_at: null,
        notes: null,
      },
      {
        id: "routine-deleted",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        name: "Eliminada",
        sort_order: 0,
        created_at: "2026-07-01T00:00:00.000Z",
        deleted_at: "2026-08-03T00:00:00.000Z",
        notes: null,
      },
    ],
    training_cycle_days: [
      {
        id: "day-b",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        routine_id: "routine-b",
        week_index: 2,
        day_code: "friday",
        sort_order: 2,
        deleted_at: null,
        notes: null,
      },
      {
        id: "day-a",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        routine_id: "routine-a",
        week_index: 1,
        day_code: "invalid-day",
        sort_order: 1,
        deleted_at: null,
        notes: "día base",
      },
      {
        id: "day-other-cycle",
        user_id: USER_ID,
        cycle_id: OTHER_CYCLE_ID,
        routine_id: "routine-a",
        week_index: 0,
        day_code: "sunday",
        sort_order: 0,
        deleted_at: null,
        notes: null,
      },
    ],
    training_cycle_exercises: [
      {
        id: "exercise-b",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        day_id: "day-b",
        name: "Peso muerto",
        target_sets: 3,
        target_reps: 5,
        base_weight: "100",
        side_weight: "20",
        sort_order: 2,
        created_at: "2026-08-02T00:00:00.000Z",
        deleted_at: null,
        notes: null,
        source_legacy_exercise_id: null,
        exercise_lineage_id: "lineage-b",
      },
      {
        id: "exercise-a",
        user_id: USER_ID,
        cycle_id: CYCLE_ID,
        day_id: "day-a",
        name: "Sentadilla",
        target_sets: 4,
        target_reps: 6,
        base_weight: "80",
        side_weight: null,
        sort_order: 1,
        created_at: "2026-08-01T00:00:00.000Z",
        deleted_at: null,
        notes: "control",
        source_legacy_exercise_id: "legacy-a",
        exercise_lineage_id: "lineage-a",
      },
      {
        id: "exercise-other-cycle",
        user_id: USER_ID,
        cycle_id: OTHER_CYCLE_ID,
        day_id: "day-a",
        name: "Mezcla inválida",
        target_sets: 1,
        target_reps: 1,
        base_weight: 1,
        side_weight: null,
        sort_order: 0,
        created_at: "2026-07-01T00:00:00.000Z",
        deleted_at: null,
        notes: null,
        source_legacy_exercise_id: null,
        exercise_lineage_id: null,
      },
    ],
  };
  const calls: QueryCall[] = [];
  const started: PlanTable[] = [];
  const pending = new Map<PlanTable, Deferred<QueryResult>>();
  const resolved = new Set<PlanTable>();
  let authCalls = 0;

  function from(tableName: string) {
    assert.ok(TABLES.includes(tableName as PlanTable), `tabla inesperada: ${tableName}`);
    const table = tableName as PlanTable;
    const call: QueryCall = { table, select: "", eq: [], is: [], order: [] };
    calls.push(call);

    const query = {
      select(columns: string) {
        call.select = columns;
        return query;
      },
      eq(column: string, value: unknown) {
        call.eq.push({ column, value });
        return query;
      },
      is(column: string, value: unknown) {
        call.is.push({ column, value });
        return query;
      },
      order(column: string, order: { ascending?: boolean }) {
        call.order.push({ column, ascending: order.ascending !== false });
        return query;
      },
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        started.push(table);
        const deferred = createDeferred<QueryResult>();
        pending.set(table, deferred);
        return deferred.promise.then(onfulfilled, onrejected);
      },
    };

    return query;
  }

  const client = {
    auth: {
      async getUser() {
        authCalls += 1;
        if (authCalls === 1) await identity.promise;
        return {
          data: {
            user: { id: USER_ID },
          },
          error: null,
        };
      },
    },
    from,
  } as unknown as SupabaseClient;

  function resolve(table: PlanTable) {
    const deferred = pending.get(table);
    assert.ok(deferred, `la lectura ${table} todavía no comenzó`);
    const call = calls.find((candidate) => candidate.table === table);
    assert.ok(call);

    let data = rows[table].filter((row) => (
      call.eq.every(({ column, value }) => row[column] === value) &&
      call.is.every(({ column, value }) => row[column] === value)
    ));
    for (const { column, ascending } of [...call.order].reverse()) {
      data = [...data].sort((left, right) => (
        compareValues(left[column], right[column]) * (ascending ? 1 : -1)
      ));
    }

    resolved.add(table);
    deferred.resolve({ data, error: options?.errors?.[table] ?? null });
  }

  return {
    calls,
    client,
    get authCalls() {
      return authCalls;
    },
    get pendingTables() {
      return started.filter((table) => !resolved.has(table));
    },
    resolve,
    resolveIdentity() {
      identity.resolve();
    },
    started,
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function measureReadWaves<T>(
  run: () => Promise<T>,
  harness: ReturnType<typeof createDeferredPlanClient>,
) {
  let settled = false;
  let value: T | undefined;
  let failure: unknown;
  const tracked = run()
    .then((result) => {
      value = result;
    }, (error: unknown) => {
      failure = error;
    })
    .finally(() => {
      settled = true;
    });

  await flushMicrotasks();
  assert.deepEqual(harness.started, [], "las lecturas no deben preceder a la identidad");
  harness.resolveIdentity();
  await flushMicrotasks();

  let waves = 0;
  while (!settled) {
    const tables = harness.pendingTables;
    if (tables.length === 0) {
      await flushMicrotasks();
      assert.ok(settled, "la operación quedó pendiente sin una lectura resoluble");
      break;
    }
    waves += 1;
    for (const table of tables) harness.resolve(table);
    await flushMicrotasks();
  }

  await tracked;
  if (failure) throw failure;
  return { value: value as T, waves };
}

async function runSequentialReference(client: SupabaseClient) {
  const { data } = await client.auth.getUser();
  const userId = data.user?.id;
  assert.ok(userId);

  await client
    .from("training_cycle_routines")
    .select("id,cycle_id,name,sort_order,notes")
    .eq("user_id", userId)
    .eq("cycle_id", CYCLE_ID)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  await client
    .from("training_cycle_days")
    .select("id,cycle_id,routine_id,week_index,day_code,sort_order,notes")
    .eq("user_id", userId)
    .eq("cycle_id", CYCLE_ID)
    .is("deleted_at", null)
    .order("week_index", { ascending: true })
    .order("sort_order", { ascending: true });
  await client
    .from("training_cycle_exercises")
    .select("id,cycle_id,day_id,name,target_sets,target_reps,base_weight,side_weight,sort_order,created_at,notes,source_legacy_exercise_id,exercise_lineage_id")
    .eq("user_id", userId)
    .eq("cycle_id", CYCLE_ID)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
}

function getPlanLoaderSource(source: string) {
  const match = source.match(
    /export async function getCycleScopedTrainingPlan[\s\S]*?(?=export async function getCycleScopedTrainingSessionData)/,
  );
  assert.ok(match, "no se encontró el loader cycle-scoped");
  return match[0];
}

function assertPerf05dSourceContract(source: string) {
  const loader = getPlanLoaderSource(source);
  assert.match(loader, /cycleId: string,[\s\S]*expectedUserId: string \| undefined = undefined/);
  assert.match(loader, /isExpectedRequestCurrent\?: CycleScopedTrainingRequestGuard/);
  assert.match(loader, /getAuthenticatedCycleScopedRepository\(\s*getClient,\s*expectedUserId,\s*\)/);
  assert.match(loader, /\] = await Promise\.all\(\[/);
  assert.equal(
    (loader.match(/assertExpectedCycleScopedRequestCurrent\(expectedUserId, isExpectedRequestCurrent\);/g) ?? []).length,
    3,
  );

  const promiseIndex = loader.indexOf("await Promise.all");
  const guardIndex = loader.lastIndexOf("assertExpectedCycleScopedRequestCurrent");
  const returnIndex = loader.indexOf("return mapCycleScopedTrainingPlan");
  assert.ok(promiseIndex >= 0 && promiseIndex < guardIndex && guardIndex < returnIndex);

  for (const table of TABLES) {
    const queryStart = loader.indexOf(`.from("${table}")`);
    const nextQuery = TABLES
      .map((candidate) => loader.indexOf(`.from("${candidate}")`, queryStart + 1))
      .filter((index) => index > queryStart)
      .sort((left, right) => left - right)[0] ?? guardIndex;
    const query = loader.slice(queryStart, nextQuery);
    assert.ok(queryStart >= 0);
    assert.match(query, /\.eq\("user_id", userId\)/);
    assert.match(query, /\.eq\("cycle_id", cycleId\)/);
    assert.match(query, /\.is\("deleted_at", null\)/);
  }

  assert.match(
    loader,
    /return mapCycleScopedTrainingPlan\(\s*\(routines \?\? \[\]\)[\s\S]*?\(days \?\? \[\]\)[\s\S]*?\(exercises \?\? \[\]\)/,
  );
  assert.doesNotMatch(loader.slice(0, guardIndex), /return\s+\{|return mapCycleScopedTrainingPlan/);
  assert.doesNotMatch(loader, /input\.userId|input\.user_id|owner_id|profile_id/);
}

test("PERF-05D mide tres ondas secuenciales y una onda paralela después de identidad", async () => {
  const baseline = createDeferredPlanClient();
  const baselineMeasurement = await measureReadWaves(
    () => runSequentialReference(baseline.client),
    baseline,
  );
  assert.equal(baselineMeasurement.waves, 3);

  const candidate = createDeferredPlanClient();
  const candidateMeasurement = await measureReadWaves(
    () => getCycleScopedTrainingPlan(CYCLE_ID, USER_ID, () => candidate.client, () => true),
    candidate,
  );
  assert.equal(candidateMeasurement.waves, 1);
  assert.deepEqual(candidate.started, [...TABLES]);
  assert.equal(candidate.authCalls, 1);

  assert.deepEqual(candidateMeasurement.value, {
    routines: [
      {
        id: "routine-a",
        cycleId: CYCLE_ID,
        name: "Rutina A",
        sortOrder: 1,
        notes: "principal",
        days: [{
          id: "day-a",
          cycleId: CYCLE_ID,
          routineId: "routine-a",
          weekIndex: 1,
          dayCode: "monday",
          sortOrder: 1,
          notes: "día base",
          exercises: [{
            id: "exercise-a",
            cycleId: CYCLE_ID,
            dayId: "day-a",
            name: "Sentadilla",
            targetSets: 4,
            targetReps: 6,
            baseWeight: 80,
            sideWeight: null,
            sortOrder: 1,
            createdAt: "2026-08-01T00:00:00.000Z",
            notes: "control",
            sourceLegacyExerciseId: "legacy-a",
            exerciseLineageId: "lineage-a",
          }],
        }],
      },
      {
        id: "routine-b",
        cycleId: CYCLE_ID,
        name: "Rutina B",
        sortOrder: 2,
        notes: null,
        days: [{
          id: "day-b",
          cycleId: CYCLE_ID,
          routineId: "routine-b",
          weekIndex: 2,
          dayCode: "friday",
          sortOrder: 2,
          notes: null,
          exercises: [{
            id: "exercise-b",
            cycleId: CYCLE_ID,
            dayId: "day-b",
            name: "Peso muerto",
            targetSets: 3,
            targetReps: 5,
            baseWeight: 100,
            sideWeight: 20,
            sortOrder: 2,
            createdAt: "2026-08-02T00:00:00.000Z",
            notes: null,
            sourceLegacyExerciseId: null,
            exerciseLineageId: "lineage-b",
          }],
        }],
      },
    ],
  });
});

test("PERF-05D conserva filtros, selects y orden por tabla", async () => {
  const harness = createDeferredPlanClient();
  await measureReadWaves(
    () => getCycleScopedTrainingPlan(CYCLE_ID, USER_ID, () => harness.client, () => true),
    harness,
  );

  assert.deepEqual(harness.calls, [
    {
      table: "training_cycle_routines",
      select: "id,cycle_id,name,sort_order,notes",
      eq: [
        { column: "user_id", value: USER_ID },
        { column: "cycle_id", value: CYCLE_ID },
      ],
      is: [{ column: "deleted_at", value: null }],
      order: [
        { column: "sort_order", ascending: true },
        { column: "created_at", ascending: true },
      ],
    },
    {
      table: "training_cycle_days",
      select: "id,cycle_id,routine_id,week_index,day_code,sort_order,notes",
      eq: [
        { column: "user_id", value: USER_ID },
        { column: "cycle_id", value: CYCLE_ID },
      ],
      is: [{ column: "deleted_at", value: null }],
      order: [
        { column: "week_index", ascending: true },
        { column: "sort_order", ascending: true },
      ],
    },
    {
      table: "training_cycle_exercises",
      select: "id,cycle_id,day_id,name,target_sets,target_reps,base_weight,side_weight,sort_order,created_at,notes,source_legacy_exercise_id,exercise_lineage_id",
      eq: [
        { column: "user_id", value: USER_ID },
        { column: "cycle_id", value: CYCLE_ID },
      ],
      is: [{ column: "deleted_at", value: null }],
      order: [
        { column: "sort_order", ascending: true },
        { column: "created_at", ascending: true },
      ],
    },
  ]);
});

test("PERF-05D no publica snapshot parcial y rechaza owner capturado stale post-await", async () => {
  const harness = createDeferredPlanClient();
  let requestCurrent = true;
  let settled = false;
  const operation = getCycleScopedTrainingPlan(
    CYCLE_ID,
    USER_ID,
    () => harness.client,
    () => requestCurrent,
  )
    .finally(() => {
      settled = true;
    });

  harness.resolveIdentity();
  await flushMicrotasks();
  assert.deepEqual(harness.pendingTables, [...TABLES]);
  harness.resolve("training_cycle_routines");
  harness.resolve("training_cycle_days");
  await flushMicrotasks();
  assert.equal(settled, false);
  requestCurrent = false;
  harness.resolve("training_cycle_exercises");

  await assert.rejects(operation, (error: unknown) => (
    error instanceof CycleScopedTrainingRepositoryError &&
    error.code === "session_expired" &&
    error.message === "Tu sesion cambio. Intenta nuevamente con la cuenta activa."
  ));
  assert.equal(harness.authCalls, 1);
});

test("PERF-05D valida expectedUserId antes de iniciar lecturas", async () => {
  const harness = createDeferredPlanClient();
  const operation = getCycleScopedTrainingPlan(
    CYCLE_ID,
    OTHER_USER_ID,
    () => harness.client,
    () => true,
  );
  harness.resolveIdentity();

  await assert.rejects(operation, (error: unknown) => (
    error instanceof CycleScopedTrainingRepositoryError && error.code === "session_expired"
  ));
  assert.deepEqual(harness.started, []);
  assert.equal(harness.authCalls, 1);
});

test("PERF-05D conserva prioridad y mapeo de errores", async () => {
  const harness = createDeferredPlanClient({
    errors: {
      training_cycle_routines: { code: "42501" },
      training_cycle_days: { code: "P0001" },
      training_cycle_exercises: { code: "unexpected" },
    },
  });

  await assert.rejects(
    measureReadWaves(
      () => getCycleScopedTrainingPlan(CYCLE_ID, USER_ID, () => harness.client, () => true),
      harness,
    ),
    (error: unknown) => (
      error instanceof CycleScopedTrainingRepositoryError &&
      error.code === "permission_denied" &&
      error.message === "No tienes permisos para gestionar este plan de ciclo."
    ),
  );
  assert.equal(harness.authCalls, 1);
});

test("join histórico real filtra ownership y mapea sin duplicar cardinalidad", async () => {
  const harness = createHistoricalJoinClient();
  const rawData = await getCycleScopedTrainingSessionRawData(
    CYCLE_ID,
    USER_ID,
    () => harness.client,
    () => true,
  );
  const mapped = assembleCycleScopedTrainingSessionData(
    CYCLE_ID,
    createHistoricalPlan(),
    rawData,
  );

  assert.equal(harness.calls.length, 2, "sessions+entries consolidan toda la historia sin request posterior");
  const sessionsCall = harness.calls.find((call) => call.table === "training_sessions");
  const entriesCall = harness.calls.find((call) => call.table === "exercise_entries");
  assert.ok(sessionsCall && entriesCall);
  assert.deepEqual(sessionsCall.eq, [
    { column: "user_id", value: USER_ID },
    { column: "cycle_id", value: CYCLE_ID },
  ]);
  assert.deepEqual(sessionsCall.is, [{ column: "deleted_at", value: null }]);
  assert.ok(entriesCall.select.includes("training_sessions!inner"));
  assert.ok(entriesCall.select.includes("training_cycle_exercises(id,user_id,cycle_id"));
  assert.deepEqual(entriesCall.eq, [
    { column: "user_id", value: USER_ID },
    { column: "training_sessions.user_id", value: USER_ID },
    { column: "training_sessions.cycle_id", value: CYCLE_ID },
    { column: "training_cycle_exercises.user_id", value: USER_ID },
    { column: "training_cycle_exercises.cycle_id", value: CYCLE_ID },
  ]);
  assert.deepEqual(entriesCall.is, [
    { column: "training_sessions.deleted_at", value: null },
    { column: "training_cycle_exercises.deleted_at", value: null },
  ]);
  assert.equal(rawData.referencedExerciseRows.length, 1, "el embed duplicado se deduplica por id");
  assert.deepEqual(mapped.sessions.map((session) => session.id), ["session-new", "session-old"]);
  assert.deepEqual(mapped.entries.map((entry) => entry.id), ["entry-old", "entry-new"]);
  assert.equal(mapped.entries[0]?.exerciseName, "Sentadilla histórica");
  assert.equal(mapped.entries.some((entry) => entry.id === "entry-orphan"), false, "session_id ajeno se rechaza");
  assert.deepEqual(Object.keys(mapped.entries[0] ?? {}).sort(), [
    "cycleDayId", "cycleId", "date", "exerciseId", "exerciseLineageId", "exerciseName",
    "id", "notes", "previousWeight", "reps", "rir", "routine", "sessionId", "targetReps",
    "targetSets", "trainingCycleExerciseId", "week", "weight",
  ].sort(), "el mapper devuelve allowlist y no spreads de la fila remota");
});

for (const maliciousReference of [
  { name: "otro usuario", options: { relatedUserId: OTHER_USER_ID } },
  { name: "otro ciclo", options: { relatedCycleId: OTHER_CYCLE_ID } },
] as const) {
  test(`join histórico rechaza ejercicio de ${maliciousReference.name}`, async () => {
    const harness = createHistoricalJoinClient(maliciousReference.options);
    const rawData = await getCycleScopedTrainingSessionRawData(
      CYCLE_ID,
      USER_ID,
      () => harness.client,
      () => true,
    );
    await assert.rejects(
      async () => assembleCycleScopedTrainingSessionData(CYCLE_ID, createHistoricalPlan(), rawData),
      (error: unknown) => (
        error instanceof CycleScopedTrainingRepositoryError && error.code === "invalid_plan"
      ),
    );
  });
}

test("join histórico convierte metadata incompleta en invalid_plan", async () => {
  const harness = createHistoricalJoinClient({ relatedName: "" });
  const rawData = await getCycleScopedTrainingSessionRawData(
    CYCLE_ID,
    USER_ID,
    () => harness.client,
    () => true,
  );
  assert.throws(
    () => assembleCycleScopedTrainingSessionData(CYCLE_ID, createHistoricalPlan(), rawData),
    (error: unknown) => (
      error instanceof CycleScopedTrainingRepositoryError && error.code === "invalid_plan"
    ),
  );
});

test("join histórico rechaza A→B mediante owner stale después del await", async () => {
  const harness = createHistoricalJoinClient();
  let guardCalls = 0;
  await assert.rejects(
    getCycleScopedTrainingSessionRawData(
      CYCLE_ID,
      USER_ID,
      () => harness.client,
      () => {
        guardCalls += 1;
        return guardCalls < 3;
      },
    ),
    (error: unknown) => (
      error instanceof CycleScopedTrainingRepositoryError && error.code === "session_expired"
    ),
  );
  assert.equal(harness.calls.length, 2);
});

test("PERF-05D mata las siete mutaciones focalizadas", () => {
  const source = readFileSync(
    new URL("./cycle-scoped-training-repository.ts", import.meta.url),
    "utf8",
  );
  assertPerf05dSourceContract(source);
  const mutationSource = `${getPlanLoaderSource(source)}export async function getCycleScopedTrainingSessionData`;

  const mutations = [
    {
      name: "volver lecturas secuenciales",
      mutate: (value: string) => value.replace("] = await Promise.all([", "] = await sequentialReads(["),
    },
    {
      name: "eliminar expectedUserId",
      mutate: (value: string) => value.replace("    expectedUserId,\n", ""),
    },
    {
      name: "quitar guard post-await",
      mutate: (value: string) => value.replace(
        "  assertExpectedCycleScopedRequestCurrent(expectedUserId, isExpectedRequestCurrent);\n\n  if (routinesError)",
        "  if (routinesError)",
      ),
    },
    {
      name: "mezclar resultados de otro ciclo",
      mutate: (value: string) => value.replace('.eq("cycle_id", cycleId)', '.eq("cycle_id", otherCycleId)'),
    },
    {
      name: "retornar snapshot parcial",
      mutate: (value: string) => value.replace(
        "  assertExpectedCycleScopedRequestCurrent(expectedUserId, isExpectedRequestCurrent);\n\n  if (routinesError)",
        "  return { routines: [] };\n  assertExpectedCycleScopedRequestCurrent(expectedUserId, isExpectedRequestCurrent);\n\n  if (routinesError)",
      ),
    },
    {
      name: "alterar orden",
      mutate: (value: string) => value.replace(
        "    (routines ?? []) as unknown as CycleScopedRoutineRow[],\n    (days ?? []) as unknown as CycleScopedDayRow[],",
        "    (days ?? []) as unknown as CycleScopedDayRow[],\n    (routines ?? []) as unknown as CycleScopedRoutineRow[],",
      ),
    },
    {
      name: "aceptar ownership desde input crudo",
      mutate: (value: string) => value.replace('.eq("user_id", userId)', '.eq("user_id", input.userId)'),
    },
  ];

  for (const mutation of mutations) {
    const mutated = mutation.mutate(mutationSource);
    assert.notEqual(mutated, mutationSource, `la mutación no se aplicó: ${mutation.name}`);
    let killed = false;
    try {
      assertPerf05dSourceContract(mutated);
    } catch {
      killed = true;
    }
    assert.equal(killed, true, `el contrato sobrevivió: ${mutation.name}`);
  }
});
