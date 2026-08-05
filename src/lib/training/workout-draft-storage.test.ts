import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveContextualBackNavigation,
  resolveContextualNavigation,
} from "@/lib/navigation/app-navigation";
import type { DataMode } from "@/lib/supabase/session";
import {
  ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS,
  ACTIVE_WORKOUT_DRAFT_VERSION,
  buildActiveWorkoutDraftSnapshot,
  clearActiveWorkoutDraft,
  loadActiveWorkoutDraft,
  saveActiveWorkoutDraft,
  type ActiveWorkoutDraftSnapshotInput,
} from "@/lib/training/active-workout-draft";
import {
  clearWorkoutDraft,
  getDraftUserKey as getStoredDraftUserKey,
  getWorkoutDraftKey as getStoredWorkoutDraftKey,
  loadWorkoutDraft,
  saveWorkoutDraft,
  type ActiveWorkoutReadinessContext,
  type PendingWorkoutReadinessLink,
  type WorkoutDraftStorageLike,
  type WorkoutDraftStorageRecord,
} from "@/lib/training/workout-draft-storage";

const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000_000;
const FIRST_STARTED_AT = "2026-06-18T12:00:00.000Z";
const SECOND_STARTED_AT = "2026-06-18T13:00:00.000Z";
const SETUP_DAYS = ["Lunes", "Martes", "Miercoles"];
const TEST_USER_IDS: Record<string, string> = {
  "user-1": "11111111-1111-4111-8111-111111111111",
  "user-2": "22222222-2222-4222-8222-222222222222",
};

function getDraftUserKey(mode: DataMode, userId?: string) {
  const scope = getStoredDraftUserKey(mode, userId ? TEST_USER_IDS[userId] ?? userId : userId);
  assert.ok(scope);
  return scope;
}

function getWorkoutDraftKey(mode: DataMode, userId?: string) {
  const key = getStoredWorkoutDraftKey(mode, userId ? TEST_USER_IDS[userId] ?? userId : userId);
  assert.ok(key);
  return key;
}

interface Readiness {
  skipped: boolean;
}

interface ExerciseDraft {
  weight: string;
  reps: Array<number | "">;
  rir: string;
  registered: boolean;
  observation: string;
}

function normalizeReadiness(value: unknown): Readiness | null {
  if (!value || typeof value !== "object") return null;
  return { skipped: Boolean((value as { skipped?: unknown }).skipped) };
}

function normalizeExerciseDrafts(value: unknown): Record<string, ExerciseDraft> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, ExerciseDraft>;
}

function createStorage(options: Partial<{
  throwOnGet: boolean;
  throwOnSet: boolean;
  throwOnRemove: boolean;
}> = {}) {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; value: string }> = [];
  const removes: string[] = [];
  const storage: WorkoutDraftStorageLike = {
    getItem: (key) => {
      if (options.throwOnGet) throw new Error("getItem failed");
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (options.throwOnSet) throw new Error("setItem failed");
      values.set(key, value);
      writes.push({ key, value });
    },
    removeItem: (key) => {
      if (options.throwOnRemove) throw new Error("removeItem failed");
      values.delete(key);
      removes.push(key);
    },
  };
  return { storage, values, writes, removes };
}

function createDraft(
  activeWorkoutStartedAt = FIRST_STARTED_AT,
): WorkoutDraftStorageRecord<Readiness | null, Record<string, ExerciseDraft>> {
  return {
    version: VERSION,
    updatedAt: NOW,
    dataMode: "supabase",
    userKey: getDraftUserKey("supabase", "user-1"),
    activeRoutineDay: "Lunes",
    activeExerciseIndex: 0,
    activeWorkoutStartedAt,
    hasStartedTraining: true,
    readiness: { skipped: true },
    workoutAttemptId: null,
    pendingReadinessLink: null,
    exerciseDrafts: {
      "exercise-1": {
        weight: "80",
        reps: [10, 10, ""],
        rir: "2",
        registered: false,
        observation: "Molestia leve en el hombro",
      },
    },
  };
}

function createActiveWorkoutDraftInput(): ActiveWorkoutDraftSnapshotInput {
  return {
    updatedAt: NOW,
    dataMode: "supabase",
    userId: TEST_USER_IDS["user-1"],
    activeRoutineDay: "Lunes",
    activeExerciseIndex: 2,
    activeWorkoutStartedAt: FIRST_STARTED_AT,
    hasStartedTraining: true,
    readiness: {
      motivation: 6,
      hydration: 5,
      sleep: 4,
      energy: 7,
      skipped: false,
    },
    exerciseDrafts: {
      "exercise-1": {
        weight: "82,5",
        reps: [10, 9, ""],
        rir: "1",
        registered: false,
        observation: "Controlar tecnica",
      },
    },
    workoutAttemptId: "attempt-1",
    pendingReadinessLink: {
      workoutAttemptId: "attempt-1",
      trainingSessionId: "session-1",
    },
    cycleId: "cycle-1",
    cycleDayId: "cycle-day-1",
    plannedDay: "wednesday",
    plannedDate: "2026-06-18",
  };
}

function load(storage: WorkoutDraftStorageLike, createStartedAt = () => SECOND_STARTED_AT) {
  return loadWorkoutDraft({
    mode: "supabase",
    userId: TEST_USER_IDS["user-1"],
    version: VERSION,
    maxAgeMs: MAX_AGE_MS,
    setupDays: SETUP_DAYS,
    normalizeReadiness,
    normalizeExerciseDrafts,
    now: () => NOW,
    createStartedAt,
    storage,
  });
}

async function run() {
  {
    assert.equal(ACTIVE_WORKOUT_DRAFT_VERSION, 1);
    assert.equal(ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS, 24 * 60 * 60 * 1000);

    const input = createActiveWorkoutDraftInput();
    const original = structuredClone(input);
    const draft = buildActiveWorkoutDraftSnapshot(input);
    assert.ok(draft);
    assert.deepEqual(draft, {
      version: 1,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getDraftUserKey("supabase", "user-1"),
      activeRoutineDay: "Lunes",
      activeExerciseIndex: 2,
      activeWorkoutStartedAt: FIRST_STARTED_AT,
      hasStartedTraining: true,
      readiness: {
        motivation: 6,
        hydration: 5,
        sleep: 4,
        energy: 7,
        skipped: false,
      },
      exerciseDrafts: {
        "exercise-1": {
          weight: "82,5",
          reps: [10, 9, ""],
          rir: "1",
          registered: false,
          observation: "Controlar tecnica",
        },
      },
      workoutAttemptId: "attempt-1",
      pendingReadinessLink: {
        workoutAttemptId: "attempt-1",
        trainingSessionId: "session-1",
      },
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      plannedDay: "wednesday",
      plannedDate: "2026-06-18",
    });
    assert.deepEqual(input, original, "el builder no muta su input");
    assert.notEqual(draft.readiness, input.readiness);
    assert.notEqual(draft.exerciseDrafts, input.exerciseDrafts);
    assert.notEqual(draft.exerciseDrafts["exercise-1"]?.reps, input.exerciseDrafts["exercise-1"]?.reps);
    assert.notEqual(draft.pendingReadinessLink, input.pendingReadinessLink);
  }

  {
    const { storage, writes } = createStorage();
    const withoutScope = { ...createActiveWorkoutDraftInput(), userId: undefined };
    assert.equal(buildActiveWorkoutDraftSnapshot(withoutScope), null);
    assert.equal(saveActiveWorkoutDraft(withoutScope, storage), false);
    assert.equal(writes.length, 0, "un scope Supabase ausente no persiste");

    const demoDraft = buildActiveWorkoutDraftSnapshot({
      ...withoutScope,
      dataMode: "demo",
    });
    assert.equal(demoDraft?.userKey, "demo", "demo conserva su scope canonico sin userId");
  }

  {
    const { storage, values } = createStorage();
    const input = createActiveWorkoutDraftInput();
    assert.equal(saveActiveWorkoutDraft(input, storage), true);
    const loaded = loadActiveWorkoutDraft("supabase", TEST_USER_IDS["user-1"], {
      storage,
      now: () => NOW,
      createStartedAt: () => SECOND_STARTED_AT,
    });
    assert.equal(loaded?.workoutAttemptId, "attempt-1");
    assert.deepEqual(loaded?.pendingReadinessLink, input.pendingReadinessLink);
    assert.equal(loaded?.cycleId, "cycle-1");
    assert.equal(loaded?.cycleDayId, "cycle-day-1");
    assert.equal(loaded?.plannedDay, "wednesday");
    assert.equal(loaded?.plannedDate, "2026-06-18");
    assert.deepEqual(loaded?.readiness, input.readiness);
    assert.equal(loaded?.exerciseDrafts["exercise-1"]?.observation, "Controlar tecnica");

    const key = getWorkoutDraftKey("supabase", "user-1");
    const legacy = JSON.parse(values.get(key) ?? "{}") as {
      exerciseDrafts?: Record<string, { observation?: string }>;
    };
    if (legacy.exerciseDrafts?.["exercise-1"]) {
      delete legacy.exerciseDrafts["exercise-1"].observation;
    }
    values.set(key, JSON.stringify(legacy));
    assert.equal(
      loadActiveWorkoutDraft("supabase", TEST_USER_IDS["user-1"], {
        storage,
        now: () => NOW,
      })?.exerciseDrafts["exercise-1"]?.observation,
      "",
      "un draft antiguo sin observation recupera string vacio",
    );

    assert.equal(clearActiveWorkoutDraft("supabase", TEST_USER_IDS["user-1"], storage), true);
    assert.equal(values.has(key), false);
  }

  {
    const { storage, values } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify({
      ...createDraft(),
      userId: "attacker-user",
      ownerId: "attacker-owner",
      token: "attacker-token",
      session: { access_token: "attacker-session" },
      unexpected: "must-not-survive",
    }));
    const loaded = load(storage);
    assert.ok(loaded);
    const loadedRecord = loaded as unknown as Record<string, unknown>;
    assert.equal("userId" in loadedRecord, false);
    assert.equal("ownerId" in loadedRecord, false);
    assert.equal("token" in loadedRecord, false);
    assert.equal("session" in loadedRecord, false);
    assert.equal("unexpected" in loadedRecord, false);
  }

  {
    const { storage } = createStorage();
    assert.equal(saveActiveWorkoutDraft({
      ...createActiveWorkoutDraftInput(),
      updatedAt: NOW - ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS - 1,
    }, storage), true);
    assert.equal(loadActiveWorkoutDraft("supabase", TEST_USER_IDS["user-1"], {
      storage,
      now: () => NOW,
    }), null, "el adaptador concreto aplica TTL de 24 horas");
  }

  {
    const activeContext = {
      workoutAttemptId: "attempt-1",
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      workoutStartedAt: FIRST_STARTED_AT,
      plannedDay: "wednesday",
      plannedDate: "2026-06-18",
    } satisfies ActiveWorkoutReadinessContext;
    const contextWithoutPlan = {
      ...activeContext,
      plannedDay: null,
      plannedDate: null,
    } satisfies ActiveWorkoutReadinessContext;

    assert.deepEqual(activeContext, {
      workoutAttemptId: "attempt-1",
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      workoutStartedAt: FIRST_STARTED_AT,
      plannedDay: "wednesday",
      plannedDate: "2026-06-18",
    });
    assert.equal(contextWithoutPlan.plannedDay, null);
    assert.equal(contextWithoutPlan.plannedDate, null);
  }

  {
    const { storage } = createStorage();
    assert.equal(load(storage), null);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, "");
    assert.equal(load(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, "{not-json");
    assert.equal(load(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify("not-object"));
    assert.equal(load(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify({ ...createDraft(), userKey: getDraftUserKey("supabase", "user-2") }));
    assert.equal(load(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage } = createStorage();
    const userOneDraft = createDraft(FIRST_STARTED_AT);
    const userTwoDraft = {
      ...createDraft(SECOND_STARTED_AT),
      userKey: getDraftUserKey("supabase", "user-2"),
      activeRoutineDay: "Martes",
    };

    saveWorkoutDraft(userOneDraft, storage);
    saveWorkoutDraft(userTwoDraft, storage);

    assert.equal(load(storage)?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    const userTwoLoaded = loadWorkoutDraft({
      mode: "supabase",
      userId: TEST_USER_IDS["user-2"],
      version: VERSION,
      maxAgeMs: MAX_AGE_MS,
      setupDays: SETUP_DAYS,
      normalizeReadiness,
      normalizeExerciseDrafts,
      now: () => NOW,
      storage,
    });

    assert.equal(userTwoLoaded?.activeWorkoutStartedAt, SECOND_STARTED_AT);
    assert.equal(userTwoLoaded?.activeRoutineDay, "Martes");
  }

  {
    const { storage, writes } = createStorage();
    const draft = createDraft();
    assert.equal(saveWorkoutDraft(draft, storage), true);
    const stored = JSON.parse(writes[0]?.value ?? "{}") as typeof draft;

    assert.equal(stored.activeWorkoutStartedAt, FIRST_STARTED_AT);
    assert.equal(new Date(stored.activeWorkoutStartedAt).toISOString(), FIRST_STARTED_AT);
  }

  {
    const { storage, writes } = createStorage();
    const draft = {
      ...createDraft(),
      futureField: "must-be-dropped",
    };
    saveWorkoutDraft(draft, storage);
    const loaded = load(storage) as ReturnType<typeof load> & { futureField?: string };

    assert.equal(loaded?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    assert.equal(loaded?.futureField, undefined, "la carga reconstruye sólo la allowlist conocida");
    assert.equal(writes.length, 1);
  }

  {
    const { storage } = createStorage();
    const draft = {
      ...createDraft(),
      exerciseDrafts: {
        "exercise-1": {
          weight: "80",
          reps: [10, 10, ""],
          rir: "2",
          registered: false,
          observation: "Molestia leve en el hombro",
        },
        "exercise-2": {
          weight: "40",
          reps: [12, 12],
          rir: "",
          registered: false,
          observation: "",
        },
      },
    } satisfies ReturnType<typeof createDraft>;
    saveWorkoutDraft(draft, storage);
    const loaded = load(storage);

    assert.equal(
      loaded?.exerciseDrafts["exercise-1"]?.observation,
      "Molestia leve en el hombro",
      "observation con texto sobrevive el round-trip JSON del draft",
    );
    assert.equal(
      loaded?.exerciseDrafts["exercise-2"]?.observation,
      "",
      "observation vacia de un ejercicio no se filtra desde otro ejercicio del mismo draft",
    );
  }

  {
    const { storage, values, writes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    const legacy = createDraft() as Partial<ReturnType<typeof createDraft>>;
    delete legacy.activeWorkoutStartedAt;
    Object.assign(legacy, { legacyField: { keep: true }, activeExerciseIndex: -2, activeRoutineDay: "No existe" });
    values.set(key, JSON.stringify(legacy));

    const loaded = load(storage) as ReturnType<typeof load> & { legacyField?: { keep: boolean } };
    const normalized = JSON.parse(writes[0]?.value ?? "{}") as ReturnType<typeof createDraft> & { legacyField?: { keep: boolean } };

    assert.equal(loaded?.activeWorkoutStartedAt, SECOND_STARTED_AT);
    assert.equal(loaded?.activeExerciseIndex, 0);
    assert.equal(loaded?.activeRoutineDay, "Lunes");
    assert.equal(loaded?.legacyField, undefined);
    assert.equal(normalized.activeWorkoutStartedAt, SECOND_STARTED_AT);
    assert.equal(normalized.legacyField, undefined);
    assert.equal(writes.length, 1);
  }

  {
    const { storage, values, writes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify(createDraft("invalid")));

    const loaded = load(storage);
    const loadedAgain = load(storage, () => "2026-06-18T14:00:00.000Z");

    assert.equal(loaded?.activeWorkoutStartedAt, SECOND_STARTED_AT);
    assert.equal(loadedAgain?.activeWorkoutStartedAt, SECOND_STARTED_AT);
    assert.equal(writes.length, 1);
  }

  {
    const { storage } = createStorage();
    const draft = createDraft();
    saveWorkoutDraft(draft, storage);

    const changedExercise = { ...draft, activeExerciseIndex: 1 };
    saveWorkoutDraft(changedExercise, storage);
    const changedReps = {
      ...changedExercise,
      exerciseDrafts: {
        "exercise-1": {
          ...changedExercise.exerciseDrafts["exercise-1"],
          reps: [12, 10, ""],
        },
      },
    };
    saveWorkoutDraft(changedReps, storage);
    const changedWeightAndNotes = {
      ...changedReps,
      exerciseDrafts: {
        "exercise-1": {
          ...changedReps.exerciseDrafts["exercise-1"],
          weight: "82.5",
          rir: "1",
        },
      },
    };
    saveWorkoutDraft(changedWeightAndNotes, storage);
    const changedReadiness = { ...changedWeightAndNotes, readiness: { skipped: false } };
    saveWorkoutDraft(changedReadiness, storage);
    const loaded = load(storage);

    assert.equal(loaded?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    assert.equal(loaded?.activeExerciseIndex, 1);
    assert.equal(loaded?.exerciseDrafts["exercise-1"]?.weight, "82.5");
    assert.deepEqual(loaded?.exerciseDrafts["exercise-1"]?.reps, [12, 10, ""]);
    assert.equal(loaded?.exerciseDrafts["exercise-1"]?.rir, "1");
    assert.deepEqual(loaded?.readiness, { skipped: false });
  }

  {
    const { storage, removes } = createStorage();
    const draft = createDraft();
    saveWorkoutDraft(draft, storage);
    assert.equal(clearWorkoutDraft("supabase", TEST_USER_IDS["user-1"], storage), true);

    assert.equal(load(storage), null);
    assert.deepEqual(removes, [getWorkoutDraftKey("supabase", "user-1")]);

    const nextDraft = createDraft(SECOND_STARTED_AT);
    saveWorkoutDraft(nextDraft, storage);
    assert.equal(load(storage)?.activeWorkoutStartedAt, SECOND_STARTED_AT);
  }

  {
    const { storage } = createStorage({ throwOnGet: true });
    assert.equal(load(storage), null);
  }

  {
    const { storage } = createStorage({ throwOnSet: true });
    assert.equal(saveWorkoutDraft(createDraft(), storage), false);
  }

  {
    const { storage, values } = createStorage({ throwOnSet: true });
    const key = getWorkoutDraftKey("supabase", "user-1");
    const legacy = createDraft() as Partial<ReturnType<typeof createDraft>>;
    delete legacy.activeWorkoutStartedAt;
    values.set(key, JSON.stringify(legacy));

    const loaded = load(storage);
    assert.equal(loaded?.activeWorkoutStartedAt, SECOND_STARTED_AT);
  }

  {
    const { storage } = createStorage({ throwOnRemove: true });
    assert.equal(clearWorkoutDraft("supabase", TEST_USER_IDS["user-1"], storage), false);
  }

  {
    const { storage, removes } = createStorage();
    saveWorkoutDraft(createDraft(), storage);
    clearWorkoutDraft("supabase", TEST_USER_IDS["user-2"], storage);

    assert.deepEqual(removes, [getWorkoutDraftKey("supabase", "user-2")]);
    assert.equal(load(storage)?.activeWorkoutStartedAt, FIRST_STARTED_AT);
  }


  {
    const { storage, values } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    const legacy = createDraft() as Partial<ReturnType<typeof createDraft>>;
    delete legacy.workoutAttemptId;
    delete legacy.pendingReadinessLink;
    values.set(key, JSON.stringify(legacy));

    const loaded = load(storage);
    assert.equal(loaded?.workoutAttemptId, null);
    assert.equal(loaded?.pendingReadinessLink, null);
    assert.equal(loaded?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    if (loaded) {
      const attempt: string | null = loaded.workoutAttemptId;
      const link: PendingWorkoutReadinessLink | null = loaded.pendingReadinessLink;
      assert.equal(attempt, null);
      assert.equal(link, null);
    }
  }

  {
    const { storage } = createStorage();
    const draft = { ...createDraft(), workoutAttemptId: "attempt-1" };
    saveWorkoutDraft(draft, storage);
    const loaded = load(storage);
    assert.equal(loaded?.workoutAttemptId, "attempt-1");
    assert.equal(loaded?.pendingReadinessLink, null);
  }

  {
    const { storage } = createStorage();
    const draft = {
      ...createDraft(),
      workoutAttemptId: "attempt-1",
      pendingReadinessLink: { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" },
    };
    saveWorkoutDraft(draft, storage);
    assert.deepEqual(load(storage)?.pendingReadinessLink, { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" });
  }

  {
    const { storage } = createStorage();
    let draft = { ...createDraft(), workoutAttemptId: "attempt-stable" };
    saveWorkoutDraft(draft, storage);
    draft = { ...draft, activeExerciseIndex: 2 };
    saveWorkoutDraft(draft, storage);
    draft = { ...draft, readiness: { skipped: false } };
    saveWorkoutDraft(draft, storage);
    assert.equal(load(storage)?.workoutAttemptId, "attempt-stable");
  }

  for (const invalid of [
    { ...createDraft(), workoutAttemptId: null, pendingReadinessLink: { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" } },
    { ...createDraft(), workoutAttemptId: "attempt-1", pendingReadinessLink: { workoutAttemptId: "attempt-2", trainingSessionId: "session-1" } },
        { ...createDraft(), workoutAttemptId: "attempt-1", pendingReadinessLink: { workoutAttemptId: "attempt-1", trainingSessionId: "" } },
    { ...createDraft(), workoutAttemptId: "attempt-1", pendingReadinessLink: { workoutAttemptId: "", trainingSessionId: "session-1" } },
    { ...createDraft(), workoutAttemptId: "attempt-1", pendingReadinessLink: { workoutAttemptId: "attempt-1" } },
    { ...createDraft(), workoutAttemptId: "attempt-1", pendingReadinessLink: "invalid" },
    { ...createDraft(), workoutAttemptId: 123 },
  ]) {
    const { storage, values } = createStorage();
    values.set(getWorkoutDraftKey("supabase", "user-1"), JSON.stringify(invalid));
    assert.equal(load(storage), null);
  }

  {
    const { storage } = createStorage();
    const draft = {
      ...createDraft(),
      workoutAttemptId: "attempt-1",
      pendingReadinessLink: { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" },
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      plannedDay: "monday",
      plannedDate: "2026-06-25",
    };
    saveWorkoutDraft(draft, storage);
    const loaded = load(storage) as ReturnType<typeof load> & {
      cycleId?: string;
      cycleDayId?: string;
      plannedDay?: string;
      plannedDate?: string;
    };
    assert.equal(loaded?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    assert.equal(loaded?.cycleId, "cycle-1");
    assert.equal(loaded?.cycleDayId, "cycle-day-1");
    assert.equal(loaded?.plannedDay, "monday");
    assert.equal(loaded?.plannedDate, "2026-06-25");
  }

  {
    const { storage } = createStorage();
    const initialDraft = {
      ...createDraft(),
      workoutAttemptId: "attempt-v2-1",
      pendingReadinessLink: { workoutAttemptId: "attempt-v2-1", trainingSessionId: "session-v2-1" },
      cycleId: "cycle-2",
      cycleDayId: "cycle-day-lunes",
      plannedDay: "monday",
      plannedDate: "2026-06-22",
    };
    saveWorkoutDraft(initialDraft, storage);
    const autosaveDraft = {
      ...initialDraft,
      activeExerciseIndex: 1,
      exerciseDrafts: {
        "exercise-1": {
          ...initialDraft.exerciseDrafts["exercise-1"],
          weight: "101.5",
          reps: [8, 8, 7],
        },
      },
    };
    saveWorkoutDraft(autosaveDraft, storage);
    const loaded = load(storage);

    assert.equal(loaded?.workoutAttemptId, "attempt-v2-1");
    assert.deepEqual(loaded?.pendingReadinessLink, { workoutAttemptId: "attempt-v2-1", trainingSessionId: "session-v2-1" });
    assert.equal(loaded?.cycleId, "cycle-2");
    assert.equal(loaded?.cycleDayId, "cycle-day-lunes");
    assert.equal(loaded?.plannedDay, "monday");
    assert.equal(loaded?.plannedDate, "2026-06-22");
    assert.equal(loaded?.activeExerciseIndex, 1);
    assert.equal(loaded?.exerciseDrafts["exercise-1"]?.weight, "101.5");
    assert.deepEqual(loaded?.exerciseDrafts["exercise-1"]?.reps, [8, 8, 7]);
  }

  for (const [field, value] of [
    ["cycleId", 42],
    ["cycleDayId", { id: "cycle-day-lunes" }],
    ["plannedDay", ""],
    ["plannedDate", []],
  ] as const) {
    const { storage, values, removes } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify({
      ...createDraft(),
      workoutAttemptId: "attempt-v2-1",
      [field]: value,
    }));
    assert.equal(load(storage), null, `draft invalido por ${field}`);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values, removes } = createStorage();
    const expired = { ...createDraft(), updatedAt: NOW - MAX_AGE_MS - 1, workoutAttemptId: "attempt-1" };
    values.set(getWorkoutDraftKey("supabase", "user-1"), JSON.stringify(expired));
    assert.equal(load(storage), null);
    assert.deepEqual(removes, [getWorkoutDraftKey("supabase", "user-1")]);
  }

  {
    const { storage, writes } = createStorage();
    const draft = { ...createDraft(), workoutAttemptId: "attempt-1" };
    const original = JSON.stringify(draft);
    saveWorkoutDraft(draft, storage);
    assert.equal(JSON.stringify(draft), original);
    const stored = JSON.parse(writes[0]?.value ?? "{}");
    assert.equal(stored.workoutAttemptId, "attempt-1");
  }

  {
    const { storage, values } = createStorage();
    const draft = {
      ...createDraft(),
      workoutAttemptId: "attempt-1",
      pendingReadinessLink: { workoutAttemptId: "attempt-1", trainingSessionId: "session-1" },
    };
    saveWorkoutDraft(draft, storage);
    assert.equal(clearWorkoutDraft("supabase", TEST_USER_IDS["user-1"], storage), true);
    assert.equal(values.has(getWorkoutDraftKey("supabase", "user-1")), false);
  }

  {
    // Contrato estatico/source-based: valida wiring productivo; no renderiza React ni reemplaza tests runtime.
    const storageSource = readFileSync("src/lib/training/workout-draft-storage.ts", "utf8");
    const activeDraftSource = readFileSync("src/lib/training/active-workout-draft.ts", "utf8");
    const completionSource = readFileSync("src/lib/training/active-workout-completion.ts", "utf8");
    const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
    const activeWorkoutBoundarySource = readFileSync("src/features/active-workout/hooks/useActiveWorkoutBoundary.ts", "utf8");
    const activeWorkoutOperationEngineSource = readFileSync("src/features/active-workout/model/active-workout-operation-engine.ts", "utf8");
    const activeWorkoutLifecycleSource = readFileSync("src/features/active-workout/hooks/useActiveWorkoutDraftLifecycle.ts", "utf8");
    const navigationControllerSource = readFileSync("src/features/app-shell/hooks/useAppNavigationController.ts", "utf8");
    const loginPageSource = readFileSync("src/app/login/page.tsx", "utf8");
    const legacyReadinessSource = readFileSync("src/lib/training/training-daily-readiness-repository.ts", "utf8");
    const packageJson = readFileSync("package.json", "utf8");
    assert.match(activeDraftSource, /export const ACTIVE_WORKOUT_DRAFT_VERSION = 1;/);
    assert.match(activeDraftSource, /export const ACTIVE_WORKOUT_DRAFT_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000;/);
    assert.match(activeDraftSource, /export function buildActiveWorkoutDraftSnapshot/);
    assert.match(
      activeDraftSource,
      /export function saveActiveWorkoutDraft[\s\S]*const draft = buildActiveWorkoutDraftSnapshot\(input\);[\s\S]*saveWorkoutDraft\(draft, storage\)/,
      "el adaptador concreto ejecuta el unico builder productivo antes de persistir",
    );
    assert.doesNotMatch(activeDraftSource, /React|organizatech-app|repository|Supabase|Date\.now|Math\.random/);
    assert.equal(
      ((appSource + activeWorkoutLifecycleSource).match(/saveActiveWorkoutDraft\(\{/g) ?? []).length,
      4,
      "las cuatro escrituras productivas usan el adaptador que ejecuta el builder canonico",
    );
    for (const [source, startMarker, endMarker] of [
      [activeWorkoutLifecycleSource, "function persistWorkoutDraft()", "persistWorkoutDraft();"],
      [appSource, "function persistCurrentWorkoutDraftSnapshot", "function syncPendingWorkoutReadinessLink"],
      [appSource, "function prepareWorkoutStartSnapshot", "async function startTrainingCommand"],
      [appSource, "function persistWorkoutDraftWithPendingLink", "function finishCompletedWorkout"],
    ] as const) {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start + startMarker.length);
      const block = start >= 0 && end > start ? source.slice(start, end) : "";
      assert.match(block, /saveActiveWorkoutDraft\(\{/, `${startMarker} debe usar el builder real`);
    }
    assert.doesNotMatch(appSource, /const WORKOUT_DRAFT_VERSION|const WORKOUT_DRAFT_MAX_AGE_MS/);
    assert.doesNotMatch(appSource, /function (?:saveWorkoutDraft|loadWorkoutDraft|clearWorkoutDraft)\(/);
    assert.match(appSource, /saveTrainingWorkoutReadiness/, "organizatech-app importa save readiness v2");
    assert.match(appSource, /linkTrainingWorkoutReadinessSession/, "organizatech-app integra link readiness v2 solo desde repositorio");
    assert.match(appSource, /resolveActiveWorkoutReentryDecision/, "organizatech-app usa una decision explicita de reentrada");
    assert.match(activeWorkoutLifecycleSource, /shouldRetainActiveWorkoutAttemptState/, "el lifecycle distingue dashboard pausado de cancelacion");
    assert.match(appSource, /async function confirmTrainingWorkoutReadinessLink\([\s\S]*pendingLink: PendingWorkoutReadinessLink,[\s\S]*operationContext: ActiveWorkoutOperationContext,[\s\S]*const operationOwner = operationContext\.owner;[\s\S]*linkTrainingWorkoutReadinessSession\(\{[\s\S]*workoutAttemptId: pendingLink\.workoutAttemptId,[\s\S]*trainingSessionId: pendingLink\.trainingSessionId,[\s\S]*\}, operationOwner\.userId\)/, "confirm link usa exclusivamente IDs del pending y pasa el owner capturado");
    assert.doesNotMatch(appSource, /save_training_workout_readiness_v2|link_training_workout_readiness_session_v2/, "organizatech-app no contiene nombres RPC v2 directos");
    for (const marker of ["startOwnerRef", "readinessOwnerRef", "completionOwnerRef", "pendingReadinessLinkRef", "attemptIdRef", "readinessContextRef"]) {
      assert.match(activeWorkoutBoundarySource, new RegExp(marker), `${marker} pertenece al boundary`);
      assert.doesNotMatch(appSource, new RegExp(`\\b${marker}\\b`), `${marker} no queda en el root`);
    }
    assert.match(activeWorkoutOperationEngineSource, /tryAcquireSessionOperationOwner[\s\S]*await input\.command\(context\)[\s\S]*finalizeSessionOperationOwner/);
    const persistReadinessStart = appSource.indexOf("async function submitReadinessCommand(");
    const persistReadinessEnd = appSource.indexOf("  function registerCurrentExercise", persistReadinessStart);
    const persistReadinessBlock = persistReadinessStart >= 0 && persistReadinessEnd > persistReadinessStart ? appSource.slice(persistReadinessStart, persistReadinessEnd) : "";
    assert.match(persistReadinessBlock, /const operationOwner = operationContext\.owner/);
    const saveLockIndex = persistReadinessBlock.indexOf("const operationOwner = operationContext.owner");
    for (const operation of ["savingDailyReadiness", "activeWorkoutActions.publishDailyReadinessError", "resolveCurrentReadinessMode", "toTrainingWorkoutReadinessPayload", "saveDailyTrainingReadiness", "saveTrainingWorkoutReadiness"]) {
      const operationIndex = persistReadinessBlock.indexOf(operation);
      assert.ok(saveLockIndex >= 0 && operationIndex > saveLockIndex, `${operation} ocurre despues del lock sincronico de readiness`);
    }
    assert.match(appSource, /activeWorkoutBoundary\.replaceRuntimeSnapshot\(\{[\s\S]*attemptId: start\.value\.activeWorkoutAttemptId,[\s\S]*readinessContext: createActiveWorkoutReadinessContext[\s\S]*activeWorkoutActions\.commitWorkoutStart\(start\.value\)/, "boundary sincroniza refs y contexto antes del start atomico");
    assert.match(appSource, /activeWorkoutBoundary\.replaceRuntimeSnapshot\(\{[\s\S]*attemptId: recovery\.value\.activeWorkoutAttemptId,[\s\S]*readinessContext: createActiveWorkoutReadinessContext[\s\S]*activeWorkoutActions\.recoverWorkout\(recovery\.value\)/, "boundary sincroniza refs, contexto y recovery atomico");
    assert.match(activeWorkoutBoundarySource, /replaceRuntimeSnapshot\(EMPTY_RUNTIME\)[\s\S]*controller\.actions\.(?:abortWorkoutStart|discardWorkout)/, "boundary limpia refs antes del estado definitivo");
    assert.match(activeWorkoutLifecycleSource, /hasRecoverableWorkoutStart/, "el lifecycle distingue inicio recuperable");
    assert.match(appSource, /if \(trainingWorkoutReadinessV2Enabled && startSnapshot\.attemptId\) \{[\s\S]*activeWorkoutActions\.markWorkoutStartRecoverable\(\)/, "la rama recuperable conserva attempt y startedAt");
    const recoverableBranch = appSource.match(/if \(trainingWorkoutReadinessV2Enabled && startSnapshot\.attemptId\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(recoverableBranch, /clearWorkoutDraft|resetWorkoutAttemptState|abortWorkoutStartState|clearPendingReadinessLink/, "la rama recuperable no destruye el snapshot");
    const attemptStartBranch = appSource.match(/if \(readinessMode === "attempt_v2"\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(attemptStartBranch, /getDailyTrainingReadiness/, "modo attempt_v2 no consulta readiness legacy al iniciar");
    assert.match(appSource, /operationContext\.settle\(getDailyTrainingReadiness\(\)\)/, "rama legacy conserva lookup readiness diario dentro del boundary productivo");
    const attemptPersistStart = appSource.indexOf("const context = operationContext.getRuntimeSnapshot().readinessContext;");
    const attemptPersistEnd = appSource.indexOf("  function registerCurrentExercise", attemptPersistStart);
    const attemptPersistBranch = attemptPersistStart >= 0 && attemptPersistEnd > attemptPersistStart
      ? appSource.slice(attemptPersistStart, attemptPersistEnd)
      : "";
    assert.match(attemptPersistBranch, /saveTrainingWorkoutReadiness\(\{[\s\S]*?\}, operationOwner\.userId\)/, "modo attempt_v2 guarda con repository v2 y owner capturado");
    assert.match(attemptPersistBranch, /operationContext\.getRuntimeSnapshot\(\)\.readinessContext/, "save v2 usa contexto inmutable");
    assert.doesNotMatch(attemptPersistBranch, /saveDailyTrainingReadiness/, "modo attempt_v2 no ejecuta save legacy");
    assert.match(appSource, /operationContext\.settle\([\s\S]*saveDailyTrainingReadiness\(value, operationOwner\.userId\)/, "rama legacy conserva save diario con owner dentro del boundary productivo");
    assert.match(appSource, /if \(record\.contextMismatch\) \{[\s\S]*activeWorkoutActions\.publishDailyReadinessError/, "context mismatch bloquea con error controlado");
    const mismatchBranch = appSource.match(/if \(record\.contextMismatch\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(mismatchBranch, /clearWorkoutDraft|resetWorkoutAttemptState|abortWorkoutStartState/, "context mismatch conserva draft y attempt");
    const saveErrorBranch = attemptPersistBranch.match(/\} else \{\s*activeWorkoutActions\.publishDailyReadinessError\([\s\S]*?translateTrainingWorkoutReadinessError\(saveResult\.error\),?\s*\);\s*\}/)?.[0] ?? "";
    assert.match(saveErrorBranch, /translateTrainingWorkoutReadinessError/, "error vigente de save v2 se entrega al caller");
    assert.doesNotMatch(saveErrorBranch, /clearWorkoutDraft|resetWorkoutAttemptState|abortWorkoutStartState/, "error temporal de save v2 conserva attempt");
    assert.match(appSource, /persistCurrentWorkoutDraftSnapshot\(record\.payload\)/, "success v2 persiste readiness confirmada en draft");
    assert.match(appSource, /workoutAttemptId: runtime\.attemptId \?\? activeWorkoutAttemptId/, "draft snapshot usa el attempt ref mas fresco");
    const autosaveStart = activeWorkoutLifecycleSource.indexOf("function persistWorkoutDraft()");
    const autosaveEnd = activeWorkoutLifecycleSource.indexOf("persistWorkoutDraft();", autosaveStart);
    const autosaveBlock = autosaveStart >= 0 && autosaveEnd > autosaveStart ? activeWorkoutLifecycleSource.slice(autosaveStart, autosaveEnd) : "";
    assert.match(autosaveBlock, /cycleId: runtime\.readinessContext\?\.cycleId \?\? null/, "autosave preserva cycleId del contexto v2");
    assert.match(autosaveBlock, /cycleDayId: runtime\.readinessContext\?\.cycleDayId \?\? null/, "autosave preserva cycleDayId del contexto v2");
    assert.match(autosaveBlock, /plannedDay: runtime\.readinessContext\?\.plannedDay \?\? null/, "autosave preserva plannedDay del contexto v2");
    assert.match(autosaveBlock, /plannedDate: runtime\.readinessContext\?\.plannedDate \?\? null/, "autosave preserva plannedDate del contexto v2");
    assert.doesNotMatch(autosaveBlock, /plannedDay: getTrainingDayCode\(visibleDay\)|plannedDate: null/, "autosave no reconstruye contexto v2 desde estado visual");
    assert.match(
      appSource,
      /const cancellationResult = await operation\.runRepositoryWrite\([\s\S]*cancelTrainingCycle\([\s\S]*cancellationResult\.kind === "stale"[\s\S]*cancellationResult\.kind === "error"[\s\S]*clearWorkoutDraft\(operation\.dataMode, operation\.userId \?\? undefined\)/,
      "deleteCurrentTrainingCycle limpia solo despues del cancel exitoso y vigente",
    );
    assert.match(appSource, /workoutAttemptId: start\.value\.activeWorkoutAttemptId/, "organizatech-app guarda el attempt validado en el draft inicial");
    assert.match(appSource, /pendingReadinessLink: start\.value\.pendingReadinessLink/, "organizatech-app guarda el pending link validado en el draft inicial");
    assert.match(activeWorkoutLifecycleSource, /pendingReadinessLink: runtime\.pendingReadinessLink/, "autosave usa el snapshot sincrono del boundary");
    assert.match(appSource, /resolveActiveWorkoutRecoveryTransition\(\{[\s\S]*activeWorkoutAttemptId: draft\.workoutAttemptId,[\s\S]*pendingReadinessLink: draft\.pendingReadinessLink,[\s\S]*activeWorkoutActions\.recoverWorkout\(recovery\.value\)/, "organizatech-app recupera attempt y pending mediante el boundary atomico");
    const restoreNavigationStart = appSource.indexOf("function resumeOrRestoreActiveWorkoutCommand()");
    const restoreNavigationEnd = appSource.indexOf("  function applyTrainingDataRefreshResult", restoreNavigationStart);
    const restoreNavigationBlock = restoreNavigationStart >= 0 && restoreNavigationEnd > restoreNavigationStart ? appSource.slice(restoreNavigationStart, restoreNavigationEnd) : "";
    assert.match(restoreNavigationBlock, /resolveActiveWorkoutReentryDecision/, "reentrada decide antes de iniciar readiness normal");
    assert.match(restoreNavigationBlock, /attemptV2: trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle/, "reentrada distingue memoria legacy de attempt_v2");
    assert.match(restoreNavigationBlock, /workoutAttemptId: runtime\.attemptId \?\? activeWorkoutAttemptId/, "reentrada valida attempt v2 desde snapshot fresco");
    assert.match(restoreNavigationBlock, /cycleId: runtime\.readinessContext\?\.cycleId \?\? null/, "reentrada exige cycleId para memoria v2");
    assert.match(restoreNavigationBlock, /cycleDayId: runtime\.readinessContext\?\.cycleDayId \?\? null/, "reentrada exige cycleDayId para memoria v2");
    assert.doesNotMatch(restoreNavigationBlock, /navigation\.(?:reset|transition)|closeMenu/, "el comando restaura estado y deja screen/history al controller");
    assert.match(navigationControllerSource, /applyActiveWorkoutReentry\(ports\.tryRestoreActiveWorkout\(\), \{[\s\S]*resetToWorkout: \(\) => reset\("entrenamiento"\),[\s\S]*closeMenu: ports\.closeMenu/, "controller centraliza reset y cierre para todo reentry exitoso");
    assert.match(restoreNavigationBlock, /const draft = loadWorkoutDraft\(dataMode, supabaseUser\?\.id\)/, "reentrada carga el draft una sola vez");
    assert.match(restoreNavigationBlock, /decision === "restore-draft"[\s\S]*restoreWorkoutDraftRecord\(draft\)/, "reentrada sin memoria completa aplica el draft ya cargado");
    assert.equal((restoreNavigationBlock.match(/loadWorkoutDraft/g) ?? []).length, 1, "reentrada evita doble lectura del draft");
    assert.doesNotMatch(restoreNavigationBlock, /saveTrainingWorkoutReadiness|createWorkoutAttemptId|resolveWorkoutAttemptId/, "reentrada no guarda readiness ni genera nuevo attempt");
    const navigateStart = appSource.indexOf("function navigateTo(nextScreen: Screen)");
    const navigateEnd = appSource.indexOf("  function goBack()", navigateStart);
    const navigateBlock = navigateStart >= 0 && navigateEnd > navigateStart ? appSource.slice(navigateStart, navigateEnd) : "";
    assert.match(navigateBlock, /navigation\.navigate\(nextScreen/, "navigateTo delega la decision contextual");
    assert.match(navigateBlock, /tryRestoreActiveWorkout: restoreActiveWorkoutForNavigation[\s\S]*clearTrainingStart: activeWorkoutActions\.clearTrainingStart/, "navigateTo entrega ports de reentry y reset al controller");
    const trainingNavigationDecision = resolveContextualNavigation({
      current: { screen: "dashboard", history: [] },
      nextScreen: "entrenamiento",
      hasRoutinePlan: true,
    });
    assert.equal(trainingNavigationDecision.tryRestoreActiveWorkout, true, "la capa pura solicita reentrada antes del reset");
    assert.equal(trainingNavigationDecision.resetTrainingStart, true, "la capa pura conserva el reset normal cuando no hay reentrada");
    const goBackStart = appSource.indexOf("function goBack()");
    const goBackEnd = appSource.indexOf("  function updateSetupRow", goBackStart);
    const goBackBlock = goBackStart >= 0 && goBackEnd > goBackStart ? appSource.slice(goBackStart, goBackEnd) : "";
    assert.match(goBackBlock, /navigation\.back\(/, "goBack delega la decision contextual");
    const activeBackDecision = resolveContextualBackNavigation({
      current: { screen: "entrenamiento", history: ["dashboard"] },
      hasStartedTraining: true,
      hasReadiness: true,
      isEditingRoutinePlan: false,
      hasRoutinePlan: true,
      routineEditorReturnScreen: null,
    });
    assert.equal(activeBackDecision.navigation.screen, "dashboard", "volver desde rutina activa pausa en dashboard");
    assert.equal(activeBackDecision.pauseTraining, true, "volver al dashboard ejecuta el port de pausa");
    assert.equal(activeBackDecision.stopTraining, false, "volver al dashboard no cancela el entrenamiento activo");
    assert.equal(activeBackDecision.clearReadiness, false, "volver al dashboard conserva readiness");
    assert.doesNotMatch(goBackBlock, /clearWorkoutDraft|resetWorkoutAttemptState/, "el adaptador de volver no elimina el intento activo");
    const openRoutineStart = appSource.indexOf("function openRoutineDay(day: string, keepTrainingStarted = false)");
    const openRoutineEnd = appSource.indexOf("  async function executeCycleCreateAdapter", openRoutineStart);
    const openRoutineBlock = openRoutineStart >= 0 && openRoutineEnd > openRoutineStart ? appSource.slice(openRoutineStart, openRoutineEnd) : "";
    assert.match(openRoutineBlock, /if \(!keepTrainingStarted && navigation\.reenterActiveWorkout\(\{[\s\S]*tryRestoreActiveWorkout: restoreActiveWorkoutForNavigation,[\s\S]*closeMenu: appShell\.closeMenu,[\s\S]*\}\)\) return;[\s\S]*routineBuilder\.selectActiveRoutineDay\(day\)/, "entrada desde dashboard usa el mismo commit central de reentry antes de reemplazar dia/indice activos");
    const attemptCleanupStart = activeWorkoutLifecycleSource.indexOf("const isActiveWorkout =");
    const attemptCleanupEnd = activeWorkoutLifecycleSource.indexOf("\n  ]);", attemptCleanupStart);
    const attemptCleanupEffect = attemptCleanupStart >= 0 && attemptCleanupEnd > attemptCleanupStart
      ? activeWorkoutLifecycleSource.slice(attemptCleanupStart, attemptCleanupEnd)
      : "";
    assert.match(attemptCleanupEffect, /shouldRetainActiveWorkoutAttemptState/, "cleanup de attempt conserva dashboard pausado");
    assert.match(attemptCleanupEffect, /!isPausedWorkoutOnDashboard[\s\S]*abortStart\(\)/, "cleanup no borra attempt mientras dashboard es pausa");
    const reentrySource = readFileSync("src/lib/training/active-workout-reentry.ts", "utf8");
    assert.match(reentrySource, /"dashboard"[\s\S]*"comparacion"[\s\S]*"historial-ciclos"[\s\S]*"perfil"/, "retencion cubre pantallas pasivas de navegacion");
    assert.match(reentrySource, /if \(!state\.attemptV2\) return true;[\s\S]*state\.workoutAttemptId && state\.cycleId && state\.cycleDayId/, "resume-memory de v2 exige identidad completa y legacy no exige attempt");
    const completionStart = appSource.indexOf("async function completeWorkoutCommand(");
    const completionEnd = appSource.indexOf("  function clearAuthForms", completionStart);
    const completionBlock = completionStart >= 0 && completionEnd > completionStart ? appSource.slice(completionStart, completionEnd) : "";
    assert.match(completionSource, /export function resolveActiveWorkoutCompletionStart\(/, "completion expone decision productiva de pending recuperado");
    assert.match(completionSource, /export function prepareActiveWorkoutCompletion\(/, "completion expone preparacion y validacion pura");
    assert.match(completionSource, /export function buildCycleScopedWorkoutCompletionEntries\(/, "completion expone builder cycle-scoped allowlist");
    assert.match(completionSource, /export function buildLegacyWorkoutCompletionEntries\(/, "completion expone builder legacy allowlist");
    assert.match(completionSource, /export function captureActiveWorkoutCompletionContext\(/, "completion captura un contexto asincrono independiente");
    assert.doesNotMatch(
      completionSource,
      /React|useState|useEffect|window|document|localStorage|sessionStorage|Date\.now|Math\.random|crypto\.randomUUID|createTrainingSessionWithCycleEntries|saveTrainingSessionWithEntries\(/,
      "la etapa pura no contiene React, browser, generacion de IDs ni escrituras productivas",
    );
    for (const helper of [
      "resolveActiveWorkoutCompletionStart",
      "prepareActiveWorkoutCompletion",
      "buildCycleScopedWorkoutCompletionEntries",
      "buildLegacyWorkoutCompletionEntries",
      "captureActiveWorkoutCompletionContext",
    ]) {
      assert.match(completionBlock, new RegExp(`${helper}\\(`), `el root consume ${helper}`);
    }
    assert.match(appSource, /async function confirmTrainingWorkoutReadinessLink[\s\S]*resolveWorkoutReadinessLinkConfirmation\(/, "confirm link delega la validacion del resultado al helper productivo");
    assert.match(activeWorkoutBoundarySource, /completionOwnerRef/);
    assert.match(activeWorkoutOperationEngineSource, /tryAcquireSessionOperationOwner/);
    assert.match(completionBlock, /const operationOwner = operationContext\.owner/);
    assert.ok(
      completionBlock.indexOf("resolveActiveWorkoutCompletionStart(") < completionBlock.indexOf("prepareActiveWorkoutCompletion("),
      "retry pending se decide antes de validar o guardar una nueva sesion",
    );
    const newSessionLinkStart = completionBlock.indexOf("persistWorkoutDraftWithPendingLink");
    const newSessionLinkEnd = completionBlock.indexOf("const summarySnapshot", newSessionLinkStart);
    const newSessionLinkBranch = newSessionLinkStart >= 0 && newSessionLinkEnd > newSessionLinkStart ? completionBlock.slice(newSessionLinkStart, newSessionLinkEnd) : "";
    assert.ok(newSessionLinkBranch.indexOf("persistWorkoutDraftWithPendingLink") < newSessionLinkBranch.indexOf("await confirmTrainingWorkoutReadinessLink("), "pending se persiste antes del link");
    assert.ok(newSessionLinkBranch.indexOf("await confirmTrainingWorkoutReadinessLink(") >= 0, "rama de sesion nueva confirma link antes de continuar a cleanup");
    const retryPendingStart = completionBlock.indexOf('if (completionStart.kind === "retry_pending_link")');
    const retryPendingEnd = completionBlock.indexOf("let readinessMode", retryPendingStart);
    const retryPendingBranch = retryPendingStart >= 0 && retryPendingEnd > retryPendingStart ? completionBlock.slice(retryPendingStart, retryPendingEnd) : "";
    assert.match(retryPendingBranch, /confirmTrainingWorkoutReadinessLink\([\s\S]*completionStart\.pendingLink,[\s\S]*operationContext/, "retry usa exclusivamente el pending capturado y su contexto owner");
    assert.match(retryPendingBranch, /operationContext\.isCurrent\(\)/, "retry pending valida identidad y owner despues del await");
    assert.doesNotMatch(retryPendingBranch, /createTrainingSessionWithCycleEntries|saveTrainingSessionWithEntries/, "retry con pending no guarda otra sesion");
    const legacyCompletionStart = completionBlock.lastIndexOf("const legacySessionInput");
    const legacyCompletionEnd = completionBlock.indexOf("    } finally {", legacyCompletionStart);
    const legacyCompletionBranch = legacyCompletionStart >= 0 && legacyCompletionEnd > legacyCompletionStart
      ? completionBlock.slice(legacyCompletionStart, legacyCompletionEnd)
      : "";
    assert.doesNotMatch(legacyCompletionBranch, /createWorkoutReadinessPendingLink|linkTrainingWorkoutReadinessSession|pendingReadinessLinkRef/, "rama legacy no crea pending ni llama link");
    assert.match(legacyCompletionBranch, /saveTrainingSessionWithEntries\(\s*legacySessionInput,\s*operationOwner\.dataMode,\s*operationOwner\.userId,\s*\)[\s\S]*operationContext\.settle\(legacySessionRequest\)[\s\S]*sessionSaveResult\.kind === "stale"[\s\S]*await buildCompletedTrainingSummarySnapshot/, "rama legacy pasa el owner exacto y usa el boundary productivo en save y summary");
    assert.match(completionBlock, /operationContext\.settle\([\s\S]*createTrainingSessionWithCycleEntries[\s\S]*sessionSaveResult\.kind === "stale"/, "cycle-scoped descarta save stale mediante el helper productivo");
    assert.match(completionBlock, /createTrainingSessionWithCycleEntries\(\{[\s\S]*?\}, operationOwner\.userId\)/, "cycle-scoped pasa exactamente el owner capturado al repository");
    assert.match(completionBlock, /trainingDataController\.reloadCycleSessions\(preparation\.cycleId/, "recarga cycle-scoped delega freshness y publicacion al boundary TrainingData");
    assert.match(completionBlock, /trainingDataController\.appendLegacySession\(savedSession, operationOwner\.requestToken\)/, "completion legacy entrega la sesion al boundary con el token P3-41 capturado");
    assert.doesNotMatch(completionBlock, /const entriesInput:|validExercises\.map\(\(exercise\) => \{\s*const draft = normalizeExerciseDraft/, "el root no reconstruye payloads de completion inline");
    const summaryStart = appSource.indexOf("async function buildCompletedTrainingSummarySnapshot");
    const summaryEnd = appSource.indexOf("  async function completeWorkoutCommand", summaryStart);
    const summaryBlock = summaryStart >= 0 && summaryEnd > summaryStart ? appSource.slice(summaryStart, summaryEnd) : "";
    assert.match(summaryBlock, /operationContext\.settle\([\s\S]*loadTrainingCompletionHistoricalInputs\(/, "summary historico sigue dentro del boundary de owner");
    assert.doesNotMatch(summaryBlock, /Promise\.allSettled|historicalEntries\.forEach/, "el root delega first-reference y unavailable al helper runtime probado");
    assert.match(completionBlock, /if \(ownsBusyState && operationContext\.isCurrent\(\)\)/, "finally solo limpia busy cuando el boundary confirma identidad y ownership");
    const useEffectBlocks = appSource.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[.*?\]\);/g) ?? [];
    assert.equal(useEffectBlocks.some((block) => block.includes("linkTrainingWorkoutReadinessSession")), false, "no existe link automatico en useEffect");
    assert.match(loginPageSource, /process\.env\.ENABLE_TRAINING_WORKOUT_READINESS_V2 === "true"/, "login/page.tsx activa readiness v2 solo con true exacto");
    assert.doesNotMatch(loginPageSource, /NEXT_PUBLIC_ENABLE_TRAINING_WORKOUT_READINESS_V2/, "readiness v2 usa flag server-only");
    assert.doesNotMatch(loginPageSource, /ENABLE_TRAINING_WORKOUT_READINESS_V2[\s\S]*(?:trim|toLowerCase|\|\| true|!== "false"|=== "1")/, "readiness v2 no acepta activacion laxa ni default activo");
    assert.doesNotMatch(loginPageSource, /VERCEL_ENV !== "production"/, "login/page.tsx no bloquea readiness v2 por entorno Production");
    assert.match(loginPageSource, /<OrganizatechApp[\s\S]*trainingWorkoutReadinessV2Enabled=\{trainingWorkoutReadinessV2Enabled\}/, "OrganizatechApp recibe la flag calculada server-side");
    assert.doesNotMatch(storageSource, /save_training_workout_readiness_v2|link_training_workout_readiness_session_v2|crypto\.randomUUID|getSupabaseBrowserClient/, "storage no llama RPCs, Supabase ni genera UUIDs");
    assert.doesNotMatch(storageSource, /window\.localStorage|JSON\.(?:parse|stringify)/, "workout draft delega acceso y serializacion al browser storage compartido");
    assert.match(legacyReadinessSource, /save_daily_training_readiness/, "readiness legacy permanece intacto");
    assert.equal((packageJson.match(/src\/lib\/training\/training-workout-readiness-repository\.test\.ts/g) ?? []).length, 1);
    assert.equal((packageJson.match(/src\/lib\/training\/workout-draft-storage\.test\.ts/g) ?? []).length, 1);
    assert.equal((packageJson.match(/src\/lib\/training\/training-workout-attempt-lifecycle\.test\.ts/g) ?? []).length, 1);
    assert.equal((packageJson.match(/src\/lib\/training\/training-workout-readiness-flow\.test\.ts/g) ?? []).length, 1);
    assert.equal((packageJson.match(/src\/lib\/training\/training-workout-readiness-link-flow\.test\.ts/g) ?? []).length, 1);
  }

  {
    assert.equal(saveWorkoutDraft(createDraft(), null), false);
    assert.equal(loadWorkoutDraft({
      mode: "supabase",
      userId: TEST_USER_IDS["user-1"],
      version: VERSION,
      maxAgeMs: MAX_AGE_MS,
      setupDays: SETUP_DAYS,
      normalizeReadiness,
      normalizeExerciseDrafts,
      storage: null,
    }), null);
    assert.equal(clearWorkoutDraft("supabase", TEST_USER_IDS["user-1"], null), false);
  }
}

void run();
