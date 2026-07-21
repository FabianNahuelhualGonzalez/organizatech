import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BROWSER_STORAGE_PREFIXES,
  LEGACY_BROWSER_STORAGE_KEYS,
  PASSWORD_RECOVERY_STORAGE_KEY,
  PASSWORD_RECOVERY_STORAGE_VERSION,
  PASSWORD_RECOVERY_TTL_MS,
  clearBrowserStorageScope,
  clearPasswordRecoveryStorage,
  getBrowserLocalStorage,
  getBrowserSessionStorage,
  getBrowserStorageScope,
  getScopedBrowserStorageKey,
  hasStoredPasswordRecoveryFlow,
  loadPasswordRecoveryFlow,
  loadSeenNotificationRecords,
  migrateLegacyBrowserStorageToDemo,
  readScopedJson,
  removeScopedBrowserStorage,
  saveSeenNotificationRecords,
  startPasswordRecoveryFlow,
  writeScopedJson,
  type BrowserStorageLike,
} from "@/lib/storage/browser-storage";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function createStorage(
  initial: Record<string, string> = {},
  options: { failGetItemForKey?: string; failSetItemForKey?: string; failRemoveItemForKey?: string } = {},
) {
  const values = new Map(Object.entries(initial));
  const removed: string[] = [];
  const storage: BrowserStorageLike = {
    getItem: (key) => {
      if (key === options.failGetItemForKey) throw new Error("getItem blocked");
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (key === options.failSetItemForKey) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      values.set(key, value);
    },
    removeItem: (key) => {
      if (key === options.failRemoveItemForKey) throw new Error("removeItem blocked");
      removed.push(key);
      values.delete(key);
    },
  };
  return { storage, values, removed };
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function run() {
  assert.equal(getBrowserLocalStorage(), null);
  assert.equal(getBrowserSessionStorage(), null);

  const scopeA = getBrowserStorageScope("supabase", USER_A);
  const scopeB = getBrowserStorageScope("supabase", USER_B);
  assert.equal(scopeA, `supabase:${USER_A}`);
  assert.equal(scopeB, `supabase:${USER_B}`);
  assert.equal(getBrowserStorageScope("demo"), "demo");
  assert.equal(getBrowserStorageScope("supabase", "user-a"), null);
  assert.equal(getBrowserStorageScope("supabase"), null);
  assert.ok(scopeA && scopeB);

  {
    const { storage, values } = createStorage();
    const prefixes = [
      BROWSER_STORAGE_PREFIXES.trainingPlan,
      BROWSER_STORAGE_PREFIXES.cycleHistory,
      BROWSER_STORAGE_PREFIXES.seenNotifications,
      BROWSER_STORAGE_PREFIXES.activeFlow,
      BROWSER_STORAGE_PREFIXES.routineDraft,
      BROWSER_STORAGE_PREFIXES.workoutDraft,
    ];
    prefixes.forEach((prefix) => {
      values.set(getScopedBrowserStorageKey(prefix, scopeA), "a");
      values.set(getScopedBrowserStorageKey(prefix, scopeB), "b");
    });

    removeScopedBrowserStorage(storage, scopeA);
    prefixes.forEach((prefix) => {
      assert.equal(values.has(getScopedBrowserStorageKey(prefix, scopeA)), false);
      assert.equal(values.get(getScopedBrowserStorageKey(prefix, scopeB)), "b");
    });
  }

  {
    const key = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, scopeA);
    const { storage, values } = createStorage(
      { [key]: "preserved" },
      { failRemoveItemForKey: key },
    );
    assert.doesNotThrow(() => clearBrowserStorageScope(scopeA, storage));
    assert.equal(values.get(key), "preserved");
    assert.doesNotThrow(() => clearBrowserStorageScope(null, storage));
    assert.doesNotThrow(() => clearBrowserStorageScope(scopeA, null));
  }

  {
    const legacyExercises = JSON.stringify([{ id: "demo-exercise", name: "Sentadilla" }]);
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.exercises, "demo");
    const { storage, values } = createStorage({
      [LEGACY_BROWSER_STORAGE_KEYS.exercises]: legacyExercises,
      [LEGACY_BROWSER_STORAGE_KEYS.trainingPlan]: JSON.stringify({ cycleType: "micro" }),
      [LEGACY_BROWSER_STORAGE_KEYS.cycleHistory]: JSON.stringify([{
        id: "cycle-1",
        plan: {},
        exercises: [],
        entries: [],
      }]),
    });
    migrateLegacyBrowserStorageToDemo(storage);

    assert.equal(values.get(demoKey), legacyExercises);
    assert.equal(values.has(getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.exercises, scopeA)), false);
    assert.equal(values.has(LEGACY_BROWSER_STORAGE_KEYS.exercises), false);
    assert.equal(values.has(LEGACY_BROWSER_STORAGE_KEYS.trainingPlan), false);
    assert.equal(values.has(LEGACY_BROWSER_STORAGE_KEYS.cycleHistory), false);
  }

  {
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.entries, "demo");
    const { storage, values } = createStorage({
      [LEGACY_BROWSER_STORAGE_KEYS.entries]: "{invalid-json",
    });
    migrateLegacyBrowserStorageToDemo(storage);
    assert.equal(values.has(LEGACY_BROWSER_STORAGE_KEYS.entries), false);
    assert.equal(values.has(demoKey), false);
  }

  {
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.entries, "demo");
    const structurallyInvalidEntries = JSON.stringify([{ id: "entry-without-required-fields" }]);
    const { storage, values } = createStorage({
      [LEGACY_BROWSER_STORAGE_KEYS.entries]: structurallyInvalidEntries,
    });
    migrateLegacyBrowserStorageToDemo(storage);
    assert.equal(values.has(LEGACY_BROWSER_STORAGE_KEYS.entries), false);
    assert.equal(values.has(demoKey), false);
  }

  {
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.exercises, "demo");
    const existingDemo = JSON.stringify([{ id: "current-demo", name: "Peso muerto" }]);
    const legacyExercises = JSON.stringify([{ id: "legacy-demo", name: "Sentadilla" }]);
    const { storage, values } = createStorage({
      [demoKey]: existingDemo,
      [LEGACY_BROWSER_STORAGE_KEYS.exercises]: legacyExercises,
    });
    migrateLegacyBrowserStorageToDemo(storage);
    assert.equal(values.get(demoKey), existingDemo);
    assert.equal(values.has(LEGACY_BROWSER_STORAGE_KEYS.exercises), false);
  }

  {
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.exercises, "demo");
    const legacyExercises = JSON.stringify([{ id: "demo-exercise", name: "Sentadilla" }]);
    const { storage, values } = createStorage(
      { [LEGACY_BROWSER_STORAGE_KEYS.exercises]: legacyExercises },
      { failSetItemForKey: demoKey },
    );

    assert.doesNotThrow(() => migrateLegacyBrowserStorageToDemo(storage));
    assert.equal(values.has(demoKey), false);
    assert.equal(values.get(LEGACY_BROWSER_STORAGE_KEYS.exercises), legacyExercises);
  }

  {
    const demoDraftKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.workoutDraft, "demo");
    const legacyDemoDraftKey = `${BROWSER_STORAGE_PREFIXES.workoutDraft}:demo:local`;
    const { storage, values } = createStorage({
      [legacyDemoDraftKey]: JSON.stringify({ version: 1, userKey: "demo:local" }),
    });
    migrateLegacyBrowserStorageToDemo(storage);
    assert.equal(values.has(legacyDemoDraftKey), false);
    assert.equal(JSON.parse(values.get(demoDraftKey) ?? "{}").userKey, "demo");
  }

  {
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingSessions, "demo");
    const { storage } = createStorage();
    writeScopedJson(storage, demoKey, [{ id: "session-1" }]);
    assert.deepEqual(readScopedJson(storage, demoKey, isArray), [{ id: "session-1" }]);
  }

  {
    const { storage, values } = createStorage();
    const records = Array.from({ length: 65 }, (_, index) => ({
      id: `notification-${index}`,
      seenAt: index,
      content: "must-not-persist",
    }));
    saveSeenNotificationRecords(storage, scopeA, records, 60);
    saveSeenNotificationRecords(storage, scopeB, [{ id: "user-b", seenAt: 1 }], 60);

    const userARecords = loadSeenNotificationRecords(storage, scopeA, 60);
    assert.equal(userARecords.length, 60);
    assert.equal(userARecords[0]?.id, "notification-5");
    assert.deepEqual(loadSeenNotificationRecords(storage, scopeB, 60), [{ id: "user-b", seenAt: 1 }]);
    const rawA = values.get(getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.seenNotifications, scopeA)) ?? "";
    assert.equal(rawA.includes("must-not-persist"), false);
  }

  {
    const { storage: sessionStorage, values: sessionValues } = createStorage();
    const { storage: localStorage, values: localValues } = createStorage({
      [PASSWORD_RECOVERY_STORAGE_KEY]: "true",
    });
    const startedAt = 1_000_000;
    startPasswordRecoveryFlow(sessionStorage, localStorage, startedAt);

    assert.equal(localValues.has(PASSWORD_RECOVERY_STORAGE_KEY), false);
    assert.equal(hasStoredPasswordRecoveryFlow(sessionStorage), true);
    assert.deepEqual(loadPasswordRecoveryFlow(sessionStorage, localStorage, startedAt + 1), {
      version: PASSWORD_RECOVERY_STORAGE_VERSION,
      startedAt,
      expiresAt: startedAt + PASSWORD_RECOVERY_TTL_MS,
    });
    assert.equal(loadPasswordRecoveryFlow(sessionStorage, localStorage, startedAt + PASSWORD_RECOVERY_TTL_MS), null);
    assert.equal(sessionValues.has(PASSWORD_RECOVERY_STORAGE_KEY), false);

    startPasswordRecoveryFlow(sessionStorage, localStorage, startedAt);
    clearPasswordRecoveryStorage(sessionStorage, localStorage);
    assert.equal(sessionValues.has(PASSWORD_RECOVERY_STORAGE_KEY), false);
    assert.equal(localValues.has(PASSWORD_RECOVERY_STORAGE_KEY), false);
  }

  {
    const { storage, values } = createStorage(
      { [PASSWORD_RECOVERY_STORAGE_KEY]: "stored" },
      { failGetItemForKey: PASSWORD_RECOVERY_STORAGE_KEY },
    );
    assert.equal(hasStoredPasswordRecoveryFlow(storage), false);
    assert.doesNotThrow(() => clearPasswordRecoveryStorage(storage, null));
    assert.equal(values.has(PASSWORD_RECOVERY_STORAGE_KEY), false);
    assert.doesNotThrow(() => startPasswordRecoveryFlow(null, null));
    assert.equal(loadPasswordRecoveryFlow(null, null), null);
  }

  {
    const repositorySource = readFileSync("src/lib/data/repository.ts", "utf8");
    assert.match(repositorySource, /if \(mode === "demo"\) return loadLocalData\(\);/);
    assert.match(repositorySource, /const exercises = await fetchExercises\(userId\);/);
    assert.doesNotMatch(repositorySource, /if \(mode === "supabase"\)[\s\S]{0,200}loadLocalData/);
  }
}

run();
