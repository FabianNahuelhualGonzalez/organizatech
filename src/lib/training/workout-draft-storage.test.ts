import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveContextualBackNavigation,
  resolveContextualNavigation,
} from "@/lib/navigation/app-navigation";
import type { DataMode } from "@/lib/supabase/session";
import {
  clearWorkoutDraft,
  getDraftUserKey as getStoredDraftUserKey,
  getWorkoutDraftKey as getStoredWorkoutDraftKey,
  loadWorkoutDraft,
  saveWorkoutDraft,
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
      futureField: "preserved",
    };
    saveWorkoutDraft(draft, storage);
    const loaded = load(storage) as ReturnType<typeof load> & { futureField?: string };

    assert.equal(loaded?.activeWorkoutStartedAt, FIRST_STARTED_AT);
    assert.equal(loaded?.futureField, "preserved");
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
    const storageSource = readFileSync("src/lib/training/workout-draft-storage.ts", "utf8");
    const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
    const loginPageSource = readFileSync("src/app/login/page.tsx", "utf8");
    const legacyReadinessSource = readFileSync("src/lib/training/training-daily-readiness-repository.ts", "utf8");
    const packageJson = readFileSync("package.json", "utf8");
    assert.match(appSource, /saveTrainingWorkoutReadiness/, "organizatech-app importa save readiness v2");
    assert.match(appSource, /linkTrainingWorkoutReadinessSession/, "organizatech-app integra link readiness v2 solo desde repositorio");
    assert.match(appSource, /resolveActiveWorkoutReentryDecision/, "organizatech-app usa una decision explicita de reentrada");
    assert.match(appSource, /shouldRetainActiveWorkoutAttemptState/, "organizatech-app distingue dashboard pausado de cancelacion");
    assert.match(appSource, /async function confirmTrainingWorkoutReadinessLink\(pendingLink: PendingWorkoutReadinessLink\)[\s\S]*linkTrainingWorkoutReadinessSession\(\{[\s\S]*workoutAttemptId: pendingLink\.workoutAttemptId,[\s\S]*trainingSessionId: pendingLink\.trainingSessionId/, "confirm link usa exclusivamente IDs del pending");
    assert.doesNotMatch(appSource, /save_training_workout_readiness_v2|link_training_workout_readiness_session_v2/, "organizatech-app no contiene nombres RPC v2 directos");
    assert.match(appSource, /workoutStartInFlightRef = useRef\(false\)/, "organizatech-app declara lock sincronico de inicio");
    assert.match(appSource, /dailyReadinessSaveInFlightRef = useRef\(false\)/, "organizatech-app declara lock sincronico del save readiness");
    assert.match(appSource, /workoutCompletionInFlightRef = useRef\(false\)/, "organizatech-app declara lock sincronico de completion");
    assert.match(appSource, /pendingReadinessLinkRef = useRef<PendingWorkoutReadinessLink \| null>\(null\)/, "organizatech-app declara ref sincronico del pending link");
    assert.match(appSource, /if \(!tryAcquireWorkoutStartLock\(workoutStartInFlightRef\)\) return;[\s\S]*prepareWorkoutStartSnapshot/, "el lock se adquiere antes de preparar snapshot o generar UUID");
    assert.match(appSource, /finally \{\s*releaseWorkoutStartLock\(workoutStartInFlightRef\);\s*\}/, "el lock se libera en finally");
    const persistReadinessStart = appSource.indexOf("async function persistDailyReadiness(value: TrainingReadiness)");
    const persistReadinessEnd = appSource.indexOf("  function registerCurrentExercise", persistReadinessStart);
    const persistReadinessBlock = persistReadinessStart >= 0 && persistReadinessEnd > persistReadinessStart ? appSource.slice(persistReadinessStart, persistReadinessEnd) : "";
    assert.match(persistReadinessBlock, /if \(!tryAcquireWorkoutStartLock\(dailyReadinessSaveInFlightRef\)\) return;/, "save readiness adquiere lock sincronico antes de operar");
    assert.match(persistReadinessBlock, /finally \{\s*releaseWorkoutStartLock\(dailyReadinessSaveInFlightRef\);\s*\}/, "save readiness libera lock en finally");
    const saveLockIndex = persistReadinessBlock.indexOf("tryAcquireWorkoutStartLock(dailyReadinessSaveInFlightRef)");
    for (const operation of ["savingDailyReadiness", "setDailyReadinessError", "resolveCurrentReadinessMode", "toTrainingWorkoutReadinessPayload", "saveDailyTrainingReadiness", "saveTrainingWorkoutReadiness"]) {
      const operationIndex = persistReadinessBlock.indexOf(operation);
      assert.ok(saveLockIndex >= 0 && operationIndex > saveLockIndex, `${operation} ocurre despues del lock sincronico de readiness`);
    }
    assert.match(appSource, /activeWorkoutAttemptIdRef = useRef<string \| null>\(null\)/, "organizatech-app declara ref sincronico del attempt");
    assert.match(appSource, /activeWorkoutReadinessContextRef = useRef<ActiveWorkoutReadinessContext \| null>\(null\)/, "organizatech-app declara contexto inmutable de readiness v2");
    assert.match(appSource, /activeWorkoutAttemptIdRef\.current = attemptId;[\s\S]*setActiveWorkoutAttemptId\(attemptId\)/, "organizatech-app sincroniza ref al generar o reutilizar attempt");
    assert.match(appSource, /activeWorkoutAttemptIdRef\.current = draft\.workoutAttemptId;[\s\S]*setPendingWorkoutReadinessLink\(draft\.pendingReadinessLink\);[\s\S]*activeWorkoutReadinessContextRef\.current = createActiveWorkoutReadinessContext/, "organizatech-app sincroniza ref, pending y contexto en recovery");
    assert.match(appSource, /activeWorkoutAttemptIdRef\.current = null;[\s\S]*activeWorkoutReadinessContextRef\.current = null;[\s\S]*setActiveWorkoutAttemptId\(null\);[\s\S]*setPendingWorkoutReadinessLink\(null\)/, "organizatech-app limpia ref/contexto/pending en limpieza definitiva");
    assert.match(appSource, /hasRecoverableWorkoutStart/, "organizatech-app distingue inicio recuperable");
    assert.match(appSource, /if \(trainingWorkoutReadinessV2Enabled && startSnapshot\.attemptId\) \{[\s\S]*setHasRecoverableWorkoutStart\(true\)/, "la rama recuperable conserva attempt y startedAt");
    const recoverableBranch = appSource.match(/if \(trainingWorkoutReadinessV2Enabled && startSnapshot\.attemptId\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(recoverableBranch, /clearWorkoutDraft|resetWorkoutAttemptState|setActiveWorkoutStartedAt\(null\)|setPendingReadinessLink\(null\)/, "la rama recuperable no destruye el snapshot");
    const attemptStartBranch = appSource.match(/if \(readinessMode === "attempt_v2"\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(attemptStartBranch, /getDailyTrainingReadiness/, "modo attempt_v2 no consulta readiness legacy al iniciar");
    assert.match(appSource, /const record = await getDailyTrainingReadiness\(\)/, "rama legacy conserva lookup readiness diario");
    const attemptPersistBranch = appSource.match(/const context = activeWorkoutReadinessContextRef\.current;[\s\S]*?finally \{\s*setSavingDailyReadiness\(false\);\s*\}/)?.[0] ?? "";
    assert.match(attemptPersistBranch, /saveTrainingWorkoutReadiness/, "modo attempt_v2 guarda con repository v2");
    assert.match(attemptPersistBranch, /activeWorkoutReadinessContextRef\.current/, "save v2 usa contexto inmutable");
    assert.doesNotMatch(attemptPersistBranch, /saveDailyTrainingReadiness/, "modo attempt_v2 no ejecuta save legacy");
    assert.match(appSource, /const record = await saveDailyTrainingReadiness\(value\)/, "rama legacy conserva save diario");
    assert.match(appSource, /if \(record\.contextMismatch\) \{[\s\S]*setDailyReadinessError/, "context mismatch bloquea con error controlado");
    const mismatchBranch = appSource.match(/if \(record\.contextMismatch\) \{[\s\S]*?return;\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(mismatchBranch, /clearWorkoutDraft|resetWorkoutAttemptState|setActiveWorkoutStartedAt\(null\)/, "context mismatch conserva draft y attempt");
    const saveCatchBranch = appSource.match(/catch \(error\) \{\s*setDailyReadinessError\(translateTrainingWorkoutReadinessError\(error\)\);\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(saveCatchBranch, /clearWorkoutDraft|resetWorkoutAttemptState|setActiveWorkoutStartedAt\(null\)/, "error temporal de save v2 conserva attempt");
    assert.match(appSource, /persistCurrentWorkoutDraftSnapshot\(record\.payload\)/, "success v2 persiste readiness confirmada en draft");
    assert.match(appSource, /workoutAttemptId: activeWorkoutAttemptIdRef\.current \?\? activeWorkoutAttemptId/, "draft snapshot usa el attempt ref mas fresco");
    const autosaveStart = appSource.indexOf("function persistWorkoutDraft()");
    const autosaveEnd = appSource.indexOf("persistWorkoutDraft();", autosaveStart);
    const autosaveBlock = autosaveStart >= 0 && autosaveEnd > autosaveStart ? appSource.slice(autosaveStart, autosaveEnd) : "";
    assert.match(autosaveBlock, /cycleId: activeWorkoutReadinessContextRef\.current\?\.cycleId \?\? null/, "autosave preserva cycleId del contexto v2");
    assert.match(autosaveBlock, /cycleDayId: activeWorkoutReadinessContextRef\.current\?\.cycleDayId \?\? null/, "autosave preserva cycleDayId del contexto v2");
    assert.match(autosaveBlock, /plannedDay: activeWorkoutReadinessContextRef\.current\?\.plannedDay \?\? null/, "autosave preserva plannedDay del contexto v2");
    assert.match(autosaveBlock, /plannedDate: activeWorkoutReadinessContextRef\.current\?\.plannedDate \?\? null/, "autosave preserva plannedDate del contexto v2");
    assert.doesNotMatch(autosaveBlock, /plannedDay: getTrainingDayCode\(visibleDay\)|plannedDate: null/, "autosave no reconstruye contexto v2 desde estado visual");
    assert.match(appSource, /await cancelTrainingCycle[\s\S]*clearWorkoutDraft\(dataMode, supabaseUser\?\.id\)/, "deleteCurrentTrainingCycle limpia solo despues del cancel exitoso");
    assert.match(appSource, /workoutAttemptId: attemptId/, "organizatech-app guarda el attempt recien resuelto en el draft inicial");
    assert.match(appSource, /pendingReadinessLink: nextPendingReadinessLink/, "organizatech-app guarda el pending link en el draft inicial");
    assert.match(appSource, /pendingReadinessLink: pendingReadinessLinkRef\.current/, "autosave usa pending ref como fuente primaria");
    assert.match(appSource, /setActiveWorkoutAttemptId\(draft\.workoutAttemptId\)/, "organizatech-app recupera workoutAttemptId del draft");
    assert.match(appSource, /setPendingWorkoutReadinessLink\(draft\.pendingReadinessLink\)/, "organizatech-app recupera pendingReadinessLink en state y ref");
    const restoreNavigationStart = appSource.indexOf("function restoreActiveWorkoutForNavigation()");
    const restoreNavigationEnd = appSource.indexOf("  async function refreshData", restoreNavigationStart);
    const restoreNavigationBlock = restoreNavigationStart >= 0 && restoreNavigationEnd > restoreNavigationStart ? appSource.slice(restoreNavigationStart, restoreNavigationEnd) : "";
    assert.match(restoreNavigationBlock, /resolveActiveWorkoutReentryDecision/, "reentrada decide antes de iniciar readiness normal");
    assert.match(restoreNavigationBlock, /attemptV2: trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle/, "reentrada distingue memoria legacy de attempt_v2");
    assert.match(restoreNavigationBlock, /workoutAttemptId: activeWorkoutAttemptIdRef\.current \?\? activeWorkoutAttemptId/, "reentrada valida attempt v2 desde ref fresca");
    assert.match(restoreNavigationBlock, /cycleId: activeWorkoutReadinessContextRef\.current\?\.cycleId \?\? null/, "reentrada exige cycleId para memoria v2");
    assert.match(restoreNavigationBlock, /cycleDayId: activeWorkoutReadinessContextRef\.current\?\.cycleDayId \?\? null/, "reentrada exige cycleDayId para memoria v2");
    assert.match(restoreNavigationBlock, /decision === "resume-memory"[\s\S]*applyContextualNavigation\(resetContextualNavigation\("entrenamiento"\)\)/, "reentrada con estado activo en memoria vuelve directo a rutina");
    assert.match(restoreNavigationBlock, /const draft = loadWorkoutDraft\(dataMode, supabaseUser\?\.id\)/, "reentrada carga el draft una sola vez");
    assert.match(restoreNavigationBlock, /decision === "restore-draft"[\s\S]*restoreWorkoutDraftRecord\(draft\)/, "reentrada sin memoria completa aplica el draft ya cargado");
    assert.equal((restoreNavigationBlock.match(/loadWorkoutDraft/g) ?? []).length, 1, "reentrada evita doble lectura del draft");
    assert.doesNotMatch(restoreNavigationBlock, /saveTrainingWorkoutReadiness|createWorkoutAttemptId|resolveWorkoutAttemptId/, "reentrada no guarda readiness ni genera nuevo attempt");
    const navigateStart = appSource.indexOf("function navigateTo(nextScreen: Screen)");
    const navigateEnd = appSource.indexOf("  function goBack()", navigateStart);
    const navigateBlock = navigateStart >= 0 && navigateEnd > navigateStart ? appSource.slice(navigateStart, navigateEnd) : "";
    assert.match(navigateBlock, /resolveContextualNavigation/, "navigateTo delega la decision contextual");
    assert.match(navigateBlock, /decision\.tryRestoreActiveWorkout[\s\S]*if \(restoreActiveWorkoutForNavigation\(\)\) return;[\s\S]*decision\.resetTrainingStart[\s\S]*setHasStartedTraining\(false\);[\s\S]*setReadiness\(null\)/, "navigateTo restaura entrenamiento activo antes de abrir readiness normal");
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
    assert.match(goBackBlock, /resolveContextualBackNavigation/, "goBack delega la decision contextual");
    const activeBackDecision = resolveContextualBackNavigation({
      current: { screen: "entrenamiento", history: ["dashboard"] },
      hasStartedTraining: true,
      hasReadiness: true,
      isEditingRoutinePlan: false,
      hasRoutinePlan: true,
      routineEditorReturnScreen: null,
    });
    assert.equal(activeBackDecision.navigation.screen, "dashboard", "volver desde rutina activa pausa en dashboard");
    assert.equal(activeBackDecision.stopTraining, false, "volver al dashboard no cancela el entrenamiento activo");
    assert.equal(activeBackDecision.clearReadiness, false, "volver al dashboard conserva readiness");
    assert.doesNotMatch(goBackBlock, /clearWorkoutDraft|resetWorkoutAttemptState/, "el adaptador de volver no elimina el intento activo");
    const openRoutineStart = appSource.indexOf("function openRoutineDay(day: string, keepTrainingStarted = false)");
    const openRoutineEnd = appSource.indexOf("  async function startNewTrainingCycle", openRoutineStart);
    const openRoutineBlock = openRoutineStart >= 0 && openRoutineEnd > openRoutineStart ? appSource.slice(openRoutineStart, openRoutineEnd) : "";
    assert.match(openRoutineBlock, /if \(!keepTrainingStarted && restoreActiveWorkoutForNavigation\(\)\) return;[\s\S]*setActiveRoutineDay\(day\)/, "entrada desde dashboard restaura intento antes de reemplazar dia/indice activos");
    const useEffectBlocksForReentry = appSource.match(/useEffect\(\(\) => \{[\s\S]*?\n  \}, \[.*?\]\);/g) ?? [];
    const attemptCleanupEffect = useEffectBlocksForReentry.find((block) => block.includes("resetWorkoutAttemptState") && block.includes("isActiveWorkout")) ?? "";
    assert.match(attemptCleanupEffect, /shouldRetainActiveWorkoutAttemptState/, "cleanup de attempt conserva dashboard pausado");
    assert.match(attemptCleanupEffect, /!isPausedWorkoutOnDashboard[\s\S]*resetWorkoutAttemptState\(\)/, "cleanup no borra attempt mientras dashboard es pausa");
    const reentrySource = readFileSync("src/lib/training/active-workout-reentry.ts", "utf8");
    assert.match(reentrySource, /"dashboard"[\s\S]*"comparacion"[\s\S]*"historial-ciclos"[\s\S]*"perfil"/, "retencion cubre pantallas pasivas de navegacion");
    assert.match(reentrySource, /if \(!state\.attemptV2\) return true;[\s\S]*state\.workoutAttemptId && state\.cycleId && state\.cycleDayId/, "resume-memory de v2 exige identidad completa y legacy no exige attempt");
    const completionStart = appSource.indexOf("async function saveCompletedTraining()");
    const completionEnd = appSource.indexOf("  function clearAuthForms", completionStart);
    const completionBlock = completionStart >= 0 && completionEnd > completionStart ? appSource.slice(completionStart, completionEnd) : "";
    assert.match(completionBlock, /if \(!tryAcquireWorkoutStartLock\(workoutCompletionInFlightRef\)\) return;/, "completion adquiere lock antes de operar");
    const completionLockIndex = completionBlock.indexOf("tryAcquireWorkoutStartLock(workoutCompletionInFlightRef)");
    for (const operation of ["pendingReadinessLinkRef.current", "createTrainingSessionWithCycleEntries", "saveTrainingSessionWithEntries", "confirmTrainingWorkoutReadinessLink"]) {
      const operationIndex = completionBlock.indexOf(operation);
      assert.ok(completionLockIndex >= 0 && operationIndex > completionLockIndex, `${operation} ocurre despues del lock sincronico de completion`);
    }
    assert.ok(completionBlock.indexOf("const recoveredPendingLink = pendingReadinessLinkRef.current") < completionBlock.indexOf("buildCurrentWorkoutSavePlan"), "retry pending se revisa antes de validar o guardar nueva sesion");
    const newSessionLinkStart = completionBlock.indexOf("persistWorkoutDraftWithPendingLink");
    const newSessionLinkEnd = completionBlock.indexOf("setExerciseDrafts", newSessionLinkStart);
    const newSessionLinkBranch = newSessionLinkStart >= 0 && newSessionLinkEnd > newSessionLinkStart ? completionBlock.slice(newSessionLinkStart, newSessionLinkEnd) : "";
    assert.ok(newSessionLinkBranch.indexOf("persistWorkoutDraftWithPendingLink") < newSessionLinkBranch.indexOf("await confirmTrainingWorkoutReadinessLink(nextPendingLink)"), "pending se persiste antes del link");
    assert.ok(newSessionLinkBranch.indexOf("await confirmTrainingWorkoutReadinessLink(nextPendingLink)") >= 0, "rama de sesion nueva confirma link antes de continuar a cleanup");
    const retryPendingStart = completionBlock.indexOf("if (recoveredPendingLink)");
    const retryPendingEnd = completionBlock.indexOf("let readinessMode", retryPendingStart);
    const retryPendingBranch = retryPendingStart >= 0 && retryPendingEnd > retryPendingStart ? completionBlock.slice(retryPendingStart, retryPendingEnd) : "";
    assert.match(retryPendingBranch, /confirmTrainingWorkoutReadinessLink\(recoveredPendingLink\)/, "retry usa los IDs del pending recuperado");
    assert.doesNotMatch(retryPendingBranch, /createTrainingSessionWithCycleEntries|saveTrainingSessionWithEntries/, "retry con pending no guarda otra sesion");
    const legacyCompletionBranch = completionBlock.match(/const savedSession = await saveTrainingSessionWithEntries[\s\S]*?finally \{\s*setIsBusy\(false\);\s*\}/)?.[0] ?? "";
    assert.doesNotMatch(legacyCompletionBranch, /createWorkoutReadinessPendingLink|linkTrainingWorkoutReadinessSession|pendingReadinessLinkRef/, "rama legacy no crea pending ni llama link");
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
