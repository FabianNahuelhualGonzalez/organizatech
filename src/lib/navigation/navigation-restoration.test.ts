import assert from "node:assert/strict";
import test from "node:test";

import {
  NAVIGATION_RESTORATION_MAX_AGE_MS,
  clearNavigationRestoration,
  loadNavigationRestoration,
  saveNavigationRestoration,
} from "@/lib/navigation/navigation-restoration";
import {
  BROWSER_STORAGE_PREFIXES,
  getScopedBrowserStorageKey,
  type BrowserStorageLike,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCOPE_A = `supabase:${USER_A}` as BrowserStorageScope;
const SCOPE_B = `supabase:${USER_B}` as BrowserStorageScope;
const NOW = 1_800_000_000_000;

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: BrowserStorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
  return { storage, values };
}

test("aísla el destino mínimo por identidad y portal", () => {
  const { storage } = memoryStorage();
  saveNavigationRestoration(SCOPE_A, { portal: "usuario", destination: "evaluations" }, { now: () => NOW, storage });
  saveNavigationRestoration(SCOPE_A, { portal: "coach", destination: "evaluations-send" }, { now: () => NOW, storage });
  saveNavigationRestoration(SCOPE_B, { portal: "usuario", destination: "profile" }, { now: () => NOW, storage });

  assert.deepEqual(loadNavigationRestoration(SCOPE_A, "usuario", { now: () => NOW, storage }), {
    portal: "usuario", destination: "evaluations",
  });
  assert.deepEqual(loadNavigationRestoration(SCOPE_A, "coach", { now: () => NOW, storage }), {
    portal: "coach", destination: "evaluations-send",
  });
  assert.deepEqual(loadNavigationRestoration(SCOPE_B, "usuario", { now: () => NOW, storage }), {
    portal: "usuario", destination: "profile",
  });
});

test("la allowlist no persiste campos extra ni datos de formularios", () => {
  const { storage, values } = memoryStorage();
  saveNavigationRestoration(SCOPE_A, {
    portal: "coach",
    destination: "evaluations-send",
    email: "should-not-persist@example.test",
    recipients: ["private"],
  } as never, { now: () => NOW, storage });
  const serialized = [...values.values()][0] ?? "";
  assert.doesNotMatch(serialized, /email|recipient|@|private/i);
  assert.match(serialized, /evaluations-send/);
});

test("rechaza destinos manipulados o vencidos y limpia sólo el scope solicitado", () => {
  const { storage, values } = memoryStorage();
  saveNavigationRestoration(SCOPE_A, { portal: "coach", destination: "calendar" }, { now: () => NOW, storage });
  saveNavigationRestoration(SCOPE_B, { portal: "coach", destination: "profile" }, { now: () => NOW, storage });
  assert.equal(loadNavigationRestoration(SCOPE_A, "coach", {
    now: () => NOW + NAVIGATION_RESTORATION_MAX_AGE_MS + 1,
    storage,
  }), null);
  assert.deepEqual(loadNavigationRestoration(SCOPE_B, "coach", { now: () => NOW, storage }), {
    portal: "coach", destination: "profile",
  });

  clearNavigationRestoration(SCOPE_B, undefined, storage);
  assert.equal(loadNavigationRestoration(SCOPE_B, "coach", { now: () => NOW, storage }), null);
  assert.equal(values.size, 0);
});

test("migra una sola vez el active-flow legacy de Usuario", () => {
  const { storage, values } = memoryStorage();
  const legacyKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, SCOPE_A);
  values.set(legacyKey, JSON.stringify({
    version: 1,
    updatedAt: NOW,
    dataMode: "supabase",
    userKey: SCOPE_A,
    flow: "calendar",
  }));

  assert.deepEqual(loadNavigationRestoration(SCOPE_A, "usuario", { now: () => NOW, storage }), {
    portal: "usuario", destination: "calendar",
  });
  assert.equal(values.has(legacyKey), false);
  assert.equal([...values.keys()].some((key) => key.endsWith(":usuario")), true);
});
