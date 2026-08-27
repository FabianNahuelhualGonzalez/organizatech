import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  completeGoogleOAuth,
  createTransientGoogleOAuthClient,
  GoogleOAuthStaleOperationError,
  type GoogleOAuthOperationGuard,
} from "./google-oauth-gateway";
import {
  createGoogleOAuthIntent,
  persistGoogleOAuthIntent,
  type OAuthIntentStorage,
} from "../model/google-oauth-intent";
import { transferGoogleOAuthAndNavigate } from "../model/google-oauth-operation-owner";

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

function memoryStorage(): OAuthIntentStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function oauthUser(id: string, identityUserId = id, provider = "google") {
  return {
    id,
    email: "oauth@example.test",
    identities: [{ provider, user_id: identityUserId }],
  };
}

function oauthSession(id: string) {
  return {
    access_token: `session-${id}`,
    refresh_token: `refresh-${id}`,
    user: oauthUser(id),
  };
}

test("auth-js real conserva sólo el verifier PKCE entre start y callback", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;
  const intentId = "0c".repeat(16);
  const storageKey = `organizatech:google-oauth:pkce:${intentId}`;
  const verifierKey = `${storageKey}-code-verifier`;
  const persisted = new Map<string, string>();
  const persistedWrites: string[] = [];
  const persistedRemovals: string[] = [];
  const storage: OAuthIntentStorage = {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => {
      persistedWrites.push(key);
      persisted.set(key, value);
    },
    removeItem: (key) => {
      persistedRemovals.push(key);
      persisted.delete(key);
    },
  };
  const exchangeCapture: { body?: Record<string, unknown> } = {};

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    assert.match(url, /\/auth\/v1\/token\?grant_type=pkce$/);
    exchangeCapture.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      access_token: "transient-access-token",
      refresh_token: "transient-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: {
        ...oauthUser(USER_A),
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "google", providers: ["google"] },
        user_metadata: {},
        created_at: "2026-08-26T00:00:00.000Z",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const starter = createTransientGoogleOAuthClient(intentId, storage);
    const started = await starter.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://organizatech.example/login",
        skipBrowserRedirect: true,
      },
    });
    assert.equal(started.error, null);
    assert.match(started.data.url, /code_challenge=/);
    assert.deepEqual([...persisted.keys()], [verifierKey]);
    assert.deepEqual(persistedWrites, [verifierKey]);
    const serializedVerifier = persisted.get(verifierKey);
    assert.ok(serializedVerifier);
    const verifier = JSON.parse(serializedVerifier) as string;
    assert.ok(verifier.length >= 43);

    const callback = createTransientGoogleOAuthClient(intentId, storage);
    const exchanged = await callback.auth.exchangeCodeForSession("oauth-code");
    assert.equal(exchanged.error, null);
    assert.equal(exchanged.data.user?.id, USER_A);
    assert.equal(exchangeCapture.body?.auth_code, "oauth-code");
    assert.equal(exchangeCapture.body?.code_verifier, verifier);
    assert.deepEqual([...persisted.keys()], []);
    assert.ok(persistedRemovals.includes(verifierKey));

    const inMemorySession = await callback.auth.getSession();
    assert.equal(inMemorySession.error, null);
    assert.equal(inMemorySession.data.session?.access_token, "transient-access-token");
    assert.equal(inMemorySession.data.session?.refresh_token, "transient-refresh-token");
    assert.deepEqual([...persisted.keys()], [], "la sesión transitoria no entra a Browser Storage");
    assert.equal(
      [...persisted.values()].some((value) => (
        value.includes("transient-access-token")
        || value.includes("transient-refresh-token")
      )),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
});

test("cada intent OAuth obtiene storageKey PKCE aislado", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const persisted = new Map<string, string>();
  const storage: OAuthIntentStorage = {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => { persisted.set(key, value); },
    removeItem: (key) => { persisted.delete(key); },
  };
  const intentA = "0a".repeat(16);
  const intentB = "0b".repeat(16);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";

  try {
    for (const intentId of [intentA, intentB]) {
      await createTransientGoogleOAuthClient(intentId, storage).auth.signInWithOAuth({
        provider: "google",
        options: { skipBrowserRedirect: true },
      });
    }
    assert.deepEqual(
      [...persisted.keys()].sort(),
      [
        `organizatech:google-oauth:pkce:${intentA}-code-verifier`,
        `organizatech:google-oauth:pkce:${intentB}-code-verifier`,
      ],
    );
    assert.equal(persisted.has("sb-example-auth-token"), false);
    assert.equal(
      [...persisted.keys()].some((key) => !key.endsWith("-code-verifier")),
      false,
    );
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
});

interface FakeClientOptions {
  userId?: string | null;
  identityUserId?: string;
  rpcUserId?: string;
  activatedUserId?: string;
  activatedSessionUserId?: string;
  activatedIdentityUserId?: string;
  provider?: string;
  onGetUser?: (count: number) => void;
  onGetSession?: (count: number) => void;
}

function fakeClient(options: FakeClientOptions = {}) {
  let currentUserId = options.userId === undefined ? USER_A : options.userId;
  let getUserCount = 0;
  let getSessionCount = 0;
  const rpcCalls: Array<{ name: string; payload: Record<string, string> }> = [];
  const setSessionCalls: Array<Record<string, string>> = [];
  let signOutCalls = 0;
  const client = {
    auth: {
      async exchangeCodeForSession() {
        const id = currentUserId ?? USER_A;
        return {
          data: {
            session: oauthSession(id),
            user: oauthUser(id, options.identityUserId, options.provider),
          },
          error: null,
        };
      },
      async getUser() {
        getUserCount += 1;
        options.onGetUser?.(getUserCount);
        if (!currentUserId) {
          return {
            data: { user: null },
            error: { code: "session_not_found", message: "Auth session missing" },
          };
        }
        return {
          data: { user: oauthUser(currentUserId, options.identityUserId, options.provider) },
          error: null,
        };
      },
      async getSession() {
        getSessionCount += 1;
        options.onGetSession?.(getSessionCount);
        return {
          data: { session: currentUserId ? oauthSession(currentUserId) : null },
          error: null,
        };
      },
      async setSession() {
        setSessionCalls.push({ kind: "set-session" });
        const activatedUserId = options.activatedUserId ?? USER_A;
        const activatedSessionUserId = options.activatedSessionUserId ?? activatedUserId;
        currentUserId = activatedSessionUserId;
        return {
          data: {
            session: oauthSession(activatedSessionUserId),
            user: oauthUser(activatedUserId, options.activatedIdentityUserId),
          },
          error: null,
        };
      },
      async signOut() {
        signOutCalls += 1;
        currentUserId = null;
        return { error: null };
      },
    },
    async rpc(name: string, payload: Record<string, string>) {
      rpcCalls.push({ name, payload });
      return { data: { user_id: options.rpcUserId ?? USER_A }, error: null };
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    rpcCalls,
    setSessionCalls,
    get signOutCalls() { return signOutCalls; },
    setUserId(userId: string | null) { currentUserId = userId; },
  };
}

function mutableGuard(): GoogleOAuthOperationGuard & { current: boolean } {
  return {
    current: true,
    isCurrent() { return this.current; },
  };
}

async function pendingOperation(input: {
  portal: "usuario" | "coach";
  mode?: "login" | "registro";
  transient?: ReturnType<typeof fakeClient>;
  guard?: ReturnType<typeof mutableGuard>;
}) {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({
    mode: input.mode ?? "registro",
    portal: input.portal,
    now: Date.now(),
    randomBytes: () => new Uint8Array(16).fill(input.portal === "coach" ? 2 : 1),
  });
  persistGoogleOAuthIntent(storage, intent);
  const transient = input.transient ?? fakeClient();
  const guard = input.guard ?? mutableGuard();
  const operation = await completeGoogleOAuth({
    code: "oauth-code",
    intentId: intent.id,
    storage,
    guard,
    transientClient: transient.client,
  });
  return { operation, transient, guard };
}

const userPayload = {
  first_name: "Ana",
  last_name: "Prueba",
  birth_date: "1992-04-03",
  gender: "female" as const,
  phone_number: "+56 9 1111 2222",
};

const coachPayload = {
  ...userPayload,
  professional_title: "Entrenadora",
  contact_email: "coach@example.test",
};

test("callback Usuario conserva sesión transitoria y escribe DTO completo sólo tras submit", async () => {
  const { operation, transient, guard } = await pendingOperation({ portal: "usuario" });
  assert.equal(transient.rpcCalls.length, 0, "callback no crea membresía anticipadamente");
  await operation.registerUser(userPayload, guard);
  assert.deepEqual(transient.rpcCalls, [{
    name: "register_own_google_user",
    payload: {
      p_first_name: "Ana",
      p_last_name: "Prueba",
      p_birth_date: "1992-04-03",
      p_gender: "female",
      p_phone_number: "+56 9 1111 2222",
    },
  }]);
});

test("Coach Google fresco e identidad compartida usan RPC propia sin booleano cliente", async () => {
  const fresh = await pendingOperation({ portal: "coach" });
  await fresh.operation.registerCoach(coachPayload, fresh.guard);
  const freshPrincipal = fakeClient({ userId: null });
  await fresh.operation.transferToPrincipal(freshPrincipal.client, fresh.guard);
  assert.equal(fresh.transient.rpcCalls[0]?.name, "register_own_google_coach");
  assert.equal(freshPrincipal.setSessionCalls.length, 1);

  const shared = await pendingOperation({ portal: "coach" });
  const principalA = fakeClient({ userId: USER_A });
  await shared.operation.assertPrincipalAvailable(principalA.client, shared.guard);
  await shared.operation.registerCoach(coachPayload, shared.guard);
  await shared.operation.transferToPrincipal(principalA.client, shared.guard);
  assert.equal(shared.transient.rpcCalls[0]?.name, "register_own_google_coach");
  assert.equal(principalA.setSessionCalls.length, 0, "same uid vigente no requiere transferencia");
});

test("login Google transfiere sin crear memberships", async () => {
  const { operation, transient, guard } = await pendingOperation({
    mode: "login",
    portal: "coach",
  });
  const principal = fakeClient({ userId: null });
  await operation.transferToPrincipal(principal.client, guard);
  assert.equal(transient.rpcCalls.length, 0);
  assert.equal(principal.setSessionCalls.length, 1);
});

test("identity.user_id, row.user_id y activated user id deben coincidir con A", async () => {
  await assert.rejects(
    pendingOperation({ portal: "usuario", transient: fakeClient({ identityUserId: USER_B }) }),
    /Google identity evidence/,
  );

  const crossedRow = await pendingOperation({
    portal: "usuario",
    transient: fakeClient({ rpcUserId: USER_B }),
  });
  await assert.rejects(
    crossedRow.operation.registerUser(userPayload, crossedRow.guard),
    /registration identity mismatch/,
  );

  const crossedActivation = await pendingOperation({ portal: "usuario" });
  const principal = fakeClient({
    userId: null,
    activatedUserId: USER_B,
    activatedSessionUserId: USER_A,
    activatedIdentityUserId: USER_A,
  });
  await assert.rejects(
    crossedActivation.operation.transferToPrincipal(principal.client, crossedActivation.guard),
    /session transfer failed/,
  );
});

test("otro provider no obtiene la excepción Google", async () => {
  await assert.rejects(
    pendingOperation({ portal: "coach", transient: fakeClient({ provider: "github" }) }),
    /Google identity evidence/,
  );
});

test("stale antes del write o transferencia termina sin RPC, setSession ni signOut", async () => {
  const beforeWrite = await pendingOperation({ portal: "usuario" });
  beforeWrite.guard.current = false;
  await assert.rejects(
    beforeWrite.operation.registerUser(userPayload, beforeWrite.guard),
    GoogleOAuthStaleOperationError,
  );
  assert.equal(beforeWrite.transient.rpcCalls.length, 0);

  const beforeTransfer = await pendingOperation({ portal: "usuario" });
  const principal = fakeClient({ userId: null });
  await beforeTransfer.operation.registerUser(userPayload, beforeTransfer.guard);
  beforeTransfer.guard.current = false;
  await assert.rejects(
    beforeTransfer.operation.transferToPrincipal(principal.client, beforeTransfer.guard),
    GoogleOAuthStaleOperationError,
  );
  assert.equal(principal.setSessionCalls.length, 0);
  assert.equal(principal.signOutCalls, 0);
});

test("A→B y sesión B previa fallan cerrado sin sobrescribir ni cerrar B", async () => {
  const existingB = await pendingOperation({ portal: "coach" });
  const principalB = fakeClient({ userId: USER_B });
  await assert.rejects(
    existingB.operation.assertPrincipalAvailable(principalB.client, existingB.guard),
    GoogleOAuthStaleOperationError,
  );
  assert.equal(principalB.setSessionCalls.length, 0);
  assert.equal(principalB.signOutCalls, 0);

  const race = await pendingOperation({ portal: "usuario" });
  const racingPrincipal = fakeClient({
    userId: null,
    onGetUser: () => racingPrincipal.setUserId(USER_B),
  });
  await assert.rejects(
    race.operation.transferToPrincipal(racingPrincipal.client, race.guard),
    GoogleOAuthStaleOperationError,
  );
  assert.equal(racingPrincipal.setSessionCalls.length, 0);
  assert.equal(racingPrincipal.signOutCalls, 0);
});

test("B inyectado en el último await transitorio produce cero setSession, signOut y navegación", async () => {
  const principal = fakeClient({ userId: null });
  const transient = fakeClient({
    onGetSession: (count) => {
      if (count === 3) principal.setUserId(USER_B);
    },
  });
  const lateRace = await pendingOperation({ portal: "usuario", transient });

  let navigationCalls = 0;
  await assert.rejects(
    transferGoogleOAuthAndNavigate({
      transfer: () => lateRace.operation.transferToPrincipal(principal.client, lateRace.guard),
      guard: lateRace.guard,
      navigate: () => { navigationCalls += 1; },
    }),
    GoogleOAuthStaleOperationError,
  );
  assert.equal(principal.setSessionCalls.length, 0);
  assert.equal(principal.signOutCalls, 0);
  assert.equal(navigationCalls, 0);
});
