import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTIVE_FLOW_MAX_AGE_MS,
  ACTIVE_FLOW_VERSION,
  ROUTINE_DRAFT_MAX_AGE_MS,
  ROUTINE_DRAFT_VERSION,
  clearActiveFlow,
  clearRoutineDraft,
  loadActiveFlow,
  loadCycleHistory,
  loadRoutineDraft,
  loadTrainingPlan,
  saveActiveFlow,
  saveCycleHistory,
  saveRoutineDraft,
  saveTrainingPlan,
  type RoutineDraftStorageRecord,
} from "@/lib/storage/app-flow-storage";
import {
  BROWSER_STORAGE_PREFIXES,
  getBrowserStorageScope,
  getScopedBrowserStorageKey,
  type BrowserStorageLike,
} from "@/lib/storage/browser-storage";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const NOW = 1_000_000_000;
const SETUP_DAYS = ["Lunes", "Martes", "Miercoles"];

interface TestSetupDay {
  routineName: string;
}

interface TestTrainingPlan {
  name: string;
}

type TestSetupByDay = Record<string, TestSetupDay>;
type TestRoutineDraft = RoutineDraftStorageRecord<TestSetupByDay, TestTrainingPlan>;

function createStorage(options: { throwOnGet?: boolean; throwOnSet?: boolean; throwOnRemove?: boolean } = {}) {
  const values = new Map<string, string>();
  const removes: string[] = [];
  const storage: BrowserStorageLike = {
    getItem: (key) => {
      if (options.throwOnGet) throw new Error("getItem failed");
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (options.throwOnSet) throw new Error("setItem failed");
      values.set(key, value);
    },
    removeItem: (key) => {
      if (options.throwOnRemove) throw new Error("removeItem failed");
      removes.push(key);
      values.delete(key);
    },
  };
  return { storage, values, removes };
}

function getScope(userId = USER_A) {
  const scope = getBrowserStorageScope("supabase", userId);
  assert.ok(scope);
  return scope;
}

function getActiveFlowKey(userId = USER_A) {
  return getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, getScope(userId));
}

function getRoutineDraftKey(userId = USER_A) {
  return getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.routineDraft, getScope(userId));
}

function createRoutineDraft(): TestRoutineDraft {
  return {
    version: ROUTINE_DRAFT_VERSION,
    updatedAt: NOW,
    dataMode: "supabase",
    userKey: getScope(),
    screen: "registro-entrenamiento",
    setupDay: "Martes",
    setupByDay: {
      Lunes: { routineName: "Pecho" },
      Martes: { routineName: "Piernas" },
    },
    trainingPlan: { name: "Plan actual" },
    isEditingRoutinePlan: true,
    routineEditorReturnScreen: "dashboard",
    activeRoutineDay: "Miercoles",
  };
}

function normalizeSetupByDay(value: unknown): TestSetupByDay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as TestSetupByDay;
}

function normalizeTrainingPlan(value: unknown): TestTrainingPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { name: "Fallback" };
  const name = (value as { name?: unknown }).name;
  return { name: typeof name === "string" ? name : "Fallback" };
}

function hasSetupDraftContent(value: TestSetupByDay) {
  return Object.values(value).some((day) => day.routineName.trim().length > 0);
}

function loadRoutine(storage: BrowserStorageLike, now = NOW) {
  return loadRoutineDraft("supabase", USER_A, {
    setupDays: SETUP_DAYS,
    normalizeSetupByDay,
    normalizeTrainingPlan,
    hasSetupDraftContent,
    now: () => now,
    storage,
  });
}

function run() {
  {
    const { storage, values } = createStorage();
    const flow = {
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase" as const,
      userKey: getScope(),
      flow: "comparison" as const,
    };

    saveActiveFlow(flow, storage);
    assert.deepEqual(JSON.parse(values.get(getActiveFlowKey()) ?? "{}"), flow);
    assert.deepEqual(loadActiveFlow("supabase", USER_A, { now: () => NOW, storage }), flow);
    assert.equal(loadActiveFlow("supabase", USER_B, { now: () => NOW, storage }), null);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getActiveFlowKey();
    values.set(key, JSON.stringify({
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getScope(),
      flow: "not-a-flow",
    }));

    assert.equal(loadActiveFlow("supabase", USER_A, { now: () => NOW, storage }), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values } = createStorage();
    const key = getActiveFlowKey();
    const flow = {
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getScope(),
      flow: "dashboard",
    };
    values.set(key, JSON.stringify(flow));

    assert.ok(loadActiveFlow("supabase", USER_A, { now: () => NOW + ACTIVE_FLOW_MAX_AGE_MS, storage }));
    assert.equal(loadActiveFlow("supabase", USER_A, { now: () => NOW + ACTIVE_FLOW_MAX_AGE_MS + 1, storage }), null);
    assert.equal(values.has(key), false);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getActiveFlowKey();
    values.set(key, "{invalid-json");

    assert.equal(loadActiveFlow("supabase", USER_A, { now: () => NOW, storage }), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values } = createStorage();
    const legacyKey = `${BROWSER_STORAGE_PREFIXES.activeFlow}:demo:local`;
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, "demo");
    values.set(legacyKey, JSON.stringify({
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "demo",
      userKey: "demo:local",
      flow: "profile",
    }));

    assert.equal(loadActiveFlow("demo", undefined, { now: () => NOW, storage })?.flow, "profile");
    assert.equal(values.has(legacyKey), false);
    assert.equal(values.has(demoKey), true);
  }

  {
    const { storage, values } = createStorage();
    values.set(getActiveFlowKey(), "active");
    values.set(getActiveFlowKey(USER_B), "other-user");
    clearActiveFlow("supabase", USER_A, storage);
    assert.equal(values.has(getActiveFlowKey()), false);
    assert.equal(values.get(getActiveFlowKey(USER_B)), "other-user");
    assert.equal(loadActiveFlow("supabase", undefined, { storage }), null);
  }

  {
    const { storage, values } = createStorage();
    const draft = createRoutineDraft();
    saveRoutineDraft(draft, storage);

    assert.deepEqual(JSON.parse(values.get(getRoutineDraftKey()) ?? "{}"), draft);
    assert.deepEqual(loadRoutine(storage), draft);
  }

  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify({
      ...createRoutineDraft(),
      screen: "dashboard",
      setupDay: "Viernes",
      activeRoutineDay: "Sabado",
      routineEditorReturnScreen: "invalid-screen",
      trainingPlan: { invalid: true },
    }));

    const restored = loadRoutine(storage);
    assert.equal(restored?.screen, "registro-entrenamiento");
    assert.equal(restored?.setupDay, "Lunes");
    assert.equal(restored?.activeRoutineDay, "Lunes");
    assert.equal(restored?.routineEditorReturnScreen, null);
    assert.deepEqual(restored?.trainingPlan, { name: "Fallback" });
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify({
      ...createRoutineDraft(),
      setupByDay: { Lunes: { routineName: "" } },
    }));

    assert.equal(loadRoutine(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, "{invalid-json");

    assert.equal(loadRoutine(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify({
      ...createRoutineDraft(),
      userKey: getScope(USER_B),
    }));

    assert.equal(loadRoutine(storage), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRoutineDraft()));

    assert.ok(loadRoutine(storage, NOW + ROUTINE_DRAFT_MAX_AGE_MS));
    assert.equal(loadRoutine(storage, NOW + ROUTINE_DRAFT_MAX_AGE_MS + 1), null);
    assert.equal(values.has(key), false);
  }

  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), "draft");
    values.set(getRoutineDraftKey(USER_B), "other-user");
    clearRoutineDraft("supabase", USER_A, storage);
    assert.equal(values.has(getRoutineDraftKey()), false);
    assert.equal(values.get(getRoutineDraftKey(USER_B)), "other-user");
  }

  {
    const { storage, values } = createStorage({ throwOnSet: true });
    assert.doesNotThrow(() => saveActiveFlow({
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getScope(),
      flow: "dashboard",
    }, storage));
    assert.doesNotThrow(() => saveRoutineDraft(createRoutineDraft(), storage));
    assert.equal(values.size, 0);
  }

  {
    const { storage, values } = createStorage();
    const plan = { name: "Plan actual", days: ["Martes", "Lunes"] };
    assert.equal(saveTrainingPlan(plan, getScope(), {
      storage,
      serialize: (value) => ({ ...value, days: [...value.days].sort() }),
    }), true);
    assert.deepEqual(
      loadTrainingPlan(getScope(), {
        storage,
        normalize: (value) => value as typeof plan,
        createDefault: () => ({ name: "Fallback", days: [] }),
      }),
      { name: "Plan actual", days: ["Lunes", "Martes"] },
    );
    assert.deepEqual(plan.days, ["Martes", "Lunes"]);
    assert.ok(values.has(getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, getScope())));
  }

  {
    const { storage, values } = createStorage();
    const planKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, getScope());
    values.set(planKey, "{invalid-json");
    assert.deepEqual(loadTrainingPlan(getScope(), {
      storage,
      normalize: (value) => value as TestTrainingPlan,
      createDefault: () => ({ name: "Fallback" }),
    }), { name: "Fallback" });
    assert.equal(values.has(planKey), false);
  }

  {
    const { storage, values } = createStorage();
    const history = [{ id: "cycle-1" }, { id: "cycle-2" }];
    assert.equal(saveCycleHistory(history, getScope(), { storage }), true);
    assert.deepEqual(loadCycleHistory<{ id: string }>(getScope(), { storage }), history);
    assert.equal(loadCycleHistory<{ id: string }>(getScope(USER_B), { storage }).length, 0);
    assert.ok(values.has(getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.cycleHistory, getScope())));
  }

  {
    const blockedRead = createStorage({ throwOnGet: true }).storage;
    const blockedWrite = createStorage({ throwOnSet: true }).storage;
    const blockedRemove = createStorage({ throwOnRemove: true }).storage;
    assert.deepEqual(loadTrainingPlan(getScope(), {
      storage: blockedRead,
      normalize: (value) => value as TestTrainingPlan,
      createDefault: () => ({ name: "Fallback" }),
    }), { name: "Fallback" });
    assert.equal(saveTrainingPlan({ name: "Plan" }, getScope(), { storage: blockedWrite }), false);
    assert.deepEqual(loadCycleHistory(getScope(), { storage: blockedRead }), []);
    assert.equal(saveCycleHistory([{ id: "cycle" }], getScope(), { storage: blockedWrite }), false);
    assert.doesNotThrow(() => clearActiveFlow("supabase", USER_A, blockedRemove));
    assert.doesNotThrow(() => clearRoutineDraft("supabase", USER_A, blockedRemove));
  }

  {
    assert.deepEqual(loadTrainingPlan(getScope(), {
      storage: null,
      normalize: (value) => value as TestTrainingPlan,
      createDefault: () => ({ name: "Fallback" }),
    }), { name: "Fallback" });
    assert.equal(saveTrainingPlan({ name: "Plan" }, getScope(), { storage: null }), false);
    assert.deepEqual(loadCycleHistory(getScope(), { storage: null }), []);
    assert.equal(saveCycleHistory([], getScope(), { storage: null }), false);
  }

  {
    const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
    assert.doesNotMatch(appSource, /function (?:get|save|load|clear)(?:ActiveFlow|RoutineDraft)/);
    assert.doesNotMatch(appSource, /BROWSER_STORAGE_PREFIXES\.(?:activeFlow|routineDraft)/);
    assert.doesNotMatch(appSource, /function (?:save|load)(?:TrainingPlan|CycleHistory)/);
    assert.doesNotMatch(appSource, /BROWSER_STORAGE_PREFIXES\.(?:trainingPlan|cycleHistory)/);
    assert.doesNotMatch(appSource, /window\.sessionStorage|PASSWORD_RECOVERY_STORAGE_KEY/);
    assert.match(appSource, /from "@\/lib\/storage\/app-flow-storage"/);
  }
}

run();
