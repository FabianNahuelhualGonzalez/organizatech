import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_OAUTH_INTENT_TTL_MS,
  buildGoogleOAuthCallbackUrl,
  consumeGoogleOAuthIntent,
  createGoogleOAuthIntent,
  parseGoogleOAuthCallback,
  persistGoogleOAuthIntent,
} from "./google-oauth-intent";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("intent opaco usa 128 bits, no contiene PII y se consume una sola vez", () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({
    mode: "registro",
    portal: "coach",
    now: 100,
    randomBytes: () => new Uint8Array(16).fill(10),
  });
  assert.equal(intent.id, "0a".repeat(16));
  assert.doesNotMatch(JSON.stringify(intent), /@|email|password|token/i);
  persistGoogleOAuthIntent(storage, intent);
  assert.deepEqual(consumeGoogleOAuthIntent(storage, intent.id, 101), intent);
  assert.equal(consumeGoogleOAuthIntent(storage, intent.id, 101), null);
});

test("intent vencido, manipulado o con entropía insuficiente falla cerrado", () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({ mode: "login", portal: "usuario", now: 100, randomBytes: () => new Uint8Array(16) });
  persistGoogleOAuthIntent(storage, intent);
  assert.equal(consumeGoogleOAuthIntent(storage, intent.id, 100 + GOOGLE_OAUTH_INTENT_TTL_MS + 1), null);
  assert.equal(consumeGoogleOAuthIntent(storage, "../../session", 100), null);
  assert.throws(() => createGoogleOAuthIntent({ mode: "login", portal: "usuario", randomBytes: () => new Uint8Array(15) }));
});

test("callback es same-origin exacto y parser exige flow, code e intent", () => {
  const id = "ab".repeat(16);
  const url = buildGoogleOAuthCallbackUrl("https://organizatech.cl/path", id);
  assert.equal(url, `https://organizatech.cl/login?flow=google-oauth&intent=${id}`);
  assert.deepEqual(parseGoogleOAuthCallback({ pathname: "/login", search: `?flow=google-oauth&intent=${id}&code=one` }), { invalid: false, code: "one", intentId: id });
  assert.deepEqual(parseGoogleOAuthCallback({ pathname: "/login", search: `?flow=google-oauth&intent=${id}` }), { invalid: true });
  assert.equal(parseGoogleOAuthCallback({ pathname: "/", search: "" }), null);
  assert.throws(() => buildGoogleOAuthCallbackUrl("javascript:alert(1)", id));
});

test("callback Google conserva el alias estable de la rama QA y su intent PKCE", () => {
  const id = "cd".repeat(16);
  const qaOrigin = "https://organizatech-git-qa-owner.vercel.app";
  const callback = new URL(buildGoogleOAuthCallbackUrl(`${qaOrigin}/login?mode=login`, id));
  callback.searchParams.set("code", "supabase-auth-code");

  assert.equal(callback.origin, qaOrigin);
  assert.equal(callback.pathname, "/login");
  assert.deepEqual(parseGoogleOAuthCallback(callback), {
    invalid: false,
    code: "supabase-auth-code",
    intentId: id,
  });
});

test("destino post-auth tipado sobrevive al intent sin incluir PII", () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({
    mode: "login",
    portal: "usuario",
    postAuthDestination: "user-coach-profile",
    now: 100,
    randomBytes: () => new Uint8Array(16).fill(11),
  });
  persistGoogleOAuthIntent(storage, intent);
  assert.equal(consumeGoogleOAuthIntent(storage, intent.id, 101)?.postAuthDestination, "user-coach-profile");
  assert.doesNotMatch(JSON.stringify(intent), /@|email|token|coachCode/i);
});
