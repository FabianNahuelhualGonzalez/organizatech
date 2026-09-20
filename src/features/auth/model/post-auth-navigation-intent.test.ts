import assert from "node:assert/strict";
import test from "node:test";

import {
  POST_AUTH_NAVIGATION_TTL_MS,
  consumePostAuthNavigationIntent,
  persistPostAuthNavigationIntent,
} from "./post-auth-navigation-intent";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

test("el destino post-auth queda ligado a la identidad y se consume una vez", () => {
  const storage = memoryStorage();
  assert.equal(persistPostAuthNavigationIntent(storage, USER_A, "user-coach-profile", 100), true);
  assert.equal(consumePostAuthNavigationIntent(storage, USER_B, 101), null);
  assert.equal(consumePostAuthNavigationIntent(storage, USER_A, 101), "user-coach-profile");
  assert.equal(consumePostAuthNavigationIntent(storage, USER_A, 101), null);
});

test("no persiste tokens, correos ni payload de vínculo y vence cerrado", () => {
  const storage = memoryStorage();
  persistPostAuthNavigationIntent(storage, USER_A, "user-coach-profile", 100);
  const serialized = [...storage.values.values()][0] ?? "";
  assert.doesNotMatch(serialized, /@|email|token|code|episode|recipient/i);
  assert.equal(
    consumePostAuthNavigationIntent(storage, USER_A, 100 + POST_AUTH_NAVIGATION_TTL_MS + 1),
    null,
  );
});
