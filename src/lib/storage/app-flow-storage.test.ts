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
  loadRoutineDraft,
  saveActiveFlow,
  saveRoutineDraft,
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

function createStorage(options: { throwOnSet?: boolean } = {}) {
  const values = new Map<string, string>();
  const removes: string[] = [];
  const storage: BrowserStorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (options.throwOnSet) throw new Error("setItem failed");
      values.set(key, value);
    },
    removeItem: (key) => {
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
    const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
    assert.doesNotMatch(appSource, /function (?:get|save|load|clear)(?:ActiveFlow|RoutineDraft)/);
    assert.doesNotMatch(appSource, /BROWSER_STORAGE_PREFIXES\.(?:activeFlow|routineDraft)/);
    assert.match(appSource, /from "@\/lib\/storage\/app-flow-storage"/);
  }
}

run();
