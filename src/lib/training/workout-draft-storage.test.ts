import assert from "node:assert/strict";

import {
  clearWorkoutDraft,
  getDraftUserKey,
  getWorkoutDraftKey,
  loadWorkoutDraft,
  saveWorkoutDraft,
  type WorkoutDraftStorageLike,
  type WorkoutDraftStorageRecord,
} from "@/lib/training/workout-draft-storage";

const VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000_000;
const FIRST_STARTED_AT = "2026-06-18T12:00:00.000Z";
const SECOND_STARTED_AT = "2026-06-18T13:00:00.000Z";
const SETUP_DAYS = ["Lunes", "Martes", "Miercoles"];

interface Readiness {
  skipped: boolean;
}

interface ExerciseDraft {
  weight: string;
  reps: Array<number | "">;
  rir: string;
  registered: boolean;
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
    exerciseDrafts: {
      "exercise-1": {
        weight: "80",
        reps: [10, 10, ""],
        rir: "2",
        registered: false,
      },
    },
  };
}

function load(storage: WorkoutDraftStorageLike, createStartedAt = () => SECOND_STARTED_AT) {
  return loadWorkoutDraft({
    mode: "supabase",
    userId: "user-1",
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
    const { storage } = createStorage();
    assert.equal(load(storage), null);
  }

  {
    const { storage, values } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, "");
    assert.equal(load(storage), null);
  }

  {
    const { storage, values } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, "{not-json");
    assert.equal(load(storage), null);
  }

  {
    const { storage, values } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify("not-object"));
    assert.equal(load(storage), null);
  }

  {
    const { storage, values } = createStorage();
    const key = getWorkoutDraftKey("supabase", "user-1");
    values.set(key, JSON.stringify({ ...createDraft(), userKey: getDraftUserKey("supabase", "user-2") }));
    assert.equal(load(storage), null);
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
      userId: "user-2",
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
      futureField: "preserved",
    };
    saveWorkoutDraft(draft, storage);
    const loaded = load(storage) as ReturnType<typeof load> & { futureField?: string };

    assert.equal(loaded?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    assert.equal(loaded?.futureField, "preserved");
    assert.equal(writes.length, 1);
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
    assert.deepEqual(loaded?.legacyField, { keep: true });
    assert.equal(normalized.activeWorkoutStartedAt, SECOND_STARTED_AT);
    assert.deepEqual(normalized.legacyField, { keep: true });
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
    assert.equal(clearWorkoutDraft("supabase", "user-1", storage), true);

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
    assert.equal(clearWorkoutDraft("supabase", "user-1", storage), false);
  }

  {
    const { storage, removes } = createStorage();
    saveWorkoutDraft(createDraft(), storage);
    clearWorkoutDraft("supabase", "user-2", storage);

    assert.deepEqual(removes, [getWorkoutDraftKey("supabase", "user-2")]);
    assert.equal(load(storage)?.activeWorkoutStartedAt, FIRST_STARTED_AT);
  }

  {
    assert.equal(saveWorkoutDraft(createDraft(), null), false);
    assert.equal(loadWorkoutDraft({
      mode: "supabase",
      userId: "user-1",
      version: VERSION,
      maxAgeMs: MAX_AGE_MS,
      setupDays: SETUP_DAYS,
      normalizeReadiness,
      normalizeExerciseDrafts,
      storage: null,
    }), null);
    assert.equal(clearWorkoutDraft("supabase", "user-1", null), false);
  }
}

void run();
