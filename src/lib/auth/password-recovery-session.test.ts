import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import {
  executePasswordRecoveryUpdate,
  getPasswordRecoveryClearedHref,
  hasPasswordRecoveryCallbackError,
  resolvePasswordRecoverySessionDecision,
  signOutPasswordRecoveryIdentityLocally,
} from "@/lib/auth/password-recovery-session";
import { createPasswordRecoveryPortalGuard } from "@/features/auth/model/password-recovery-portal-guard";
import {
  finalizeSessionOperationOwner,
  isSessionOperationOwner,
  releaseSessionOperationOwner,
  tryAcquireSessionOperationOwner,
  type SessionOperationOwner,
} from "@/lib/session/active-workout-session-boundary";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
} from "@/lib/session/session-data-epoch";
import { translateAuthError } from "@/lib/supabase/auth-errors";
import { runSupabasePrincipalIdentityOperation } from "@/lib/supabase/auth-identity-operation";
import {
  recordSupabaseAuthIdentity,
  signOutSupabaseAuthIdentityLocallyIfCurrent,
} from "@/lib/supabase/client";
import type { SupabaseAuthRefreshIdentityScope } from "@/lib/supabase/auth-resilience";

const RECOVERY_USER = "11111111-1111-4111-8111-111111111111";
const RECOVERY_USER_UPPER = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const RECOVERY_USER_LOWER = RECOVERY_USER_UPPER.toLowerCase();
const DIFFERENT_USER = "22222222-2222-4222-8222-222222222222";
const RECOVERY_SCOPE: SupabaseAuthRefreshIdentityScope = Object.freeze({
  userId: RECOVERY_USER,
  sessionEpoch: 1,
});
const RECOVERY_LOWER_SCOPE: SupabaseAuthRefreshIdentityScope = Object.freeze({
  userId: RECOVERY_USER_LOWER,
  sessionEpoch: 1,
});

function recoveryIdentityScopeFields(
  scope: SupabaseAuthRefreshIdentityScope = RECOVERY_SCOPE,
) {
  return {
    expectedIdentityScope: scope,
    getCurrentIdentityScope: () => scope,
  };
}

type DecisionInput = Parameters<typeof resolvePasswordRecoverySessionDecision>[0];

function decide(patch: Partial<DecisionInput>): ReturnType<typeof resolvePasswordRecoverySessionDecision> {
  return resolvePasswordRecoverySessionDecision({
    routeState: "none",
    event: null,
    sessionLookup: "success",
    sessionUserId: null,
    hasCallbackEvidence: false,
    callbackMatchesSession: false,
    storedRecoveryStatus: null,
    confirmedRecoveryUserId: null,
    ...patch,
  });
}

test("recovery decision requires recovery evidence and a valid matching identity", () => {
  assert.equal(decide({
    routeState: "active",
    event: "bootstrap",
    sessionUserId: DIFFERENT_USER,
    storedRecoveryStatus: "pending",
  }), "pending");
  assert.equal(decide({
    routeState: "active",
    event: "INITIAL_SESSION",
    sessionUserId: DIFFERENT_USER,
    storedRecoveryStatus: "pending",
  }), "pending");
  assert.equal(decide({
    routeState: "active",
    event: "bootstrap",
    storedRecoveryStatus: "pending",
  }), "pending");
  assert.equal(decide({ routeState: "expired", event: "bootstrap" }), "invalid");
  assert.equal(decide({
    routeState: "active",
    event: "PASSWORD_RECOVERY",
    sessionUserId: RECOVERY_USER,
  }), "confirmed");
  assert.equal(decide({
    routeState: "active",
    event: "PASSWORD_RECOVERY",
    sessionUserId: null,
  }), "invalid");
  assert.equal(decide({
    routeState: "active",
    event: "PASSWORD_RECOVERY",
    sessionUserId: "not-a-uuid",
  }), "invalid");
  assert.equal(decide({
    routeState: "active",
    event: "bootstrap",
    sessionUserId: RECOVERY_USER,
    hasCallbackEvidence: true,
    callbackMatchesSession: true,
    storedRecoveryStatus: "pending",
  }), "confirmed");
  assert.equal(decide({
    routeState: "active",
    event: "bootstrap",
    sessionUserId: DIFFERENT_USER,
    hasCallbackEvidence: true,
    callbackMatchesSession: false,
    storedRecoveryStatus: "pending",
  }), "pending");
  assert.equal(decide({
    routeState: "active",
    event: "INITIAL_SESSION",
    sessionUserId: RECOVERY_USER_UPPER,
    storedRecoveryStatus: "confirmed",
    confirmedRecoveryUserId: RECOVERY_USER_LOWER,
  }), "confirmed");
  assert.equal(decide({
    routeState: "active",
    event: "INITIAL_SESSION",
    sessionUserId: DIFFERENT_USER,
    storedRecoveryStatus: "confirmed",
    confirmedRecoveryUserId: RECOVERY_USER,
  }), "invalid");
  assert.equal(decide({
    routeState: "active",
    event: "INITIAL_SESSION",
    sessionUserId: RECOVERY_USER,
    storedRecoveryStatus: "confirmed",
    confirmedRecoveryUserId: null,
  }), "invalid");
  assert.equal(decide({
    routeState: "active",
    event: "TOKEN_REFRESHED",
    sessionUserId: RECOVERY_USER,
    storedRecoveryStatus: "confirmed",
    confirmedRecoveryUserId: RECOVERY_USER,
  }), "confirmed");
  assert.equal(decide({
    routeState: "active",
    event: "bootstrap",
    sessionLookup: "error",
    hasCallbackEvidence: true,
    storedRecoveryStatus: "pending",
  }), "pending");
  assert.equal(decide({
    routeState: "none",
    event: "SIGNED_IN",
    sessionUserId: DIFFERENT_USER,
  }), "none");
});

function runRecoveryEventSequence(
  events: Array<"PASSWORD_RECOVERY" | "INITIAL_SESSION" | "SIGNED_IN" | "TOKEN_REFRESHED">,
) {
  const guard = createPasswordRecoveryPortalGuard();
  let confirmedRecoveryUserId: string | null = null;
  const decisions: string[] = [];

  for (const event of events) {
    if (event === "PASSWORD_RECOVERY") guard.begin();
    if (!guard.isBlocked()) guard.begin();
    const decision = decide({
      routeState: "active",
      event,
      sessionUserId: RECOVERY_USER,
      hasCallbackEvidence: true,
      callbackMatchesSession: event === "PASSWORD_RECOVERY",
      storedRecoveryStatus: confirmedRecoveryUserId ? "confirmed" : "pending",
      confirmedRecoveryUserId,
    });
    decisions.push(decision);
    if (decision === "confirmed") confirmedRecoveryUserId = RECOVERY_USER;
    assert.equal(guard.isBlocked(), true, `${event} no puede abrir el portal`);
  }

  return decisions;
}

for (const scenario of [
  {
    name: "PASSWORD_RECOVERY → INITIAL_SESSION",
    events: ["PASSWORD_RECOVERY", "INITIAL_SESSION"],
    expected: ["confirmed", "confirmed"],
  },
  {
    name: "INITIAL_SESSION → PASSWORD_RECOVERY",
    events: ["INITIAL_SESSION", "PASSWORD_RECOVERY"],
    expected: ["pending", "confirmed"],
  },
  {
    name: "PASSWORD_RECOVERY → SIGNED_IN",
    events: ["PASSWORD_RECOVERY", "SIGNED_IN"],
    expected: ["confirmed", "confirmed"],
  },
  {
    name: "PASSWORD_RECOVERY → TOKEN_REFRESHED",
    events: ["PASSWORD_RECOVERY", "TOKEN_REFRESHED"],
    expected: ["confirmed", "confirmed"],
  },
] as const) {
  test(`AUTH-RECOVERY-02 · ${scenario.name} mantiene cero portal`, () => {
    assert.deepEqual(runRecoveryEventSequence([...scenario.events]), [...scenario.expected]);
  });
}

test("late Usuario and Coach mount permits stay stale after recovery is released", () => {
  const guard = createPasswordRecoveryPortalGuard();
  const lateUserMount = guard.capturePortalMountPermit();
  const lateCoachMount = guard.capturePortalMountPermit();

  assert.equal(lateUserMount.isCurrent(), true);
  assert.equal(lateCoachMount.isCurrent(), true);
  assert.equal(guard.begin(), true);
  assert.equal(lateUserMount.isCurrent(), false, "callback Usuario previo queda invalidado");
  assert.equal(lateCoachMount.isCurrent(), false, "callback Coach previo queda invalidado");
  assert.equal(guard.release(), true);
  assert.equal(lateUserMount.isCurrent(), false, "Usuario no revive tras volver al login");
  assert.equal(lateCoachMount.isCurrent(), false, "Coach no revive tras volver al login");
  assert.equal(guard.capturePortalMountPermit().isCurrent(), true, "el login manual obtiene un permiso nuevo");
});

test("password recovery URL cleanup removes query credentials and the complete fragment", () => {
  assert.equal(
    getPasswordRecoveryClearedHref(
      "https://preview.example/login?flow=password-recovery&code=private-code&access_token=private-query#type=recovery&access_token=private-fragment&refresh_token=private-refresh",
    ),
    "/login",
  );
});

test("callback errors are detected without exposing their details as product copy", () => {
  assert.equal(hasPasswordRecoveryCallbackError({
    error: "access_denied",
    errorCode: "otp_expired",
    errorDescription: null,
  }), true);
  assert.equal(hasPasswordRecoveryCallbackError({
    error: "unexpected_callback_failure",
    errorCode: null,
    errorDescription: "internal detail that must never become UI copy",
  }), true);
  assert.equal(hasPasswordRecoveryCallbackError({
    error: null,
    errorCode: null,
    errorDescription: null,
  }), false);
});

function createAuthHarness(options: {
  sessionUserId?: string | null;
  updateError?: unknown;
  signOutError?: unknown;
  onGetSession?: () => void;
  onUpdateUser?: () => void;
  onSignOut?: () => void;
} = {}) {
  let getSessionCalls = 0;
  let updateUserCalls = 0;
  let signOutCalls = 0;
  let updatedPassword = "";

  return {
    auth: {
      async getSession() {
        getSessionCalls += 1;
        options.onGetSession?.();
        const userId = options.sessionUserId === undefined ? RECOVERY_USER : options.sessionUserId;
        return {
          data: { session: userId ? { user: { id: userId } } : null },
          error: null,
        };
      },
      async updateUser(attributes: { password: string }) {
        updateUserCalls += 1;
        updatedPassword = attributes.password;
        options.onUpdateUser?.();
        return { error: options.updateError ?? null };
      },
      async signOut(signOutOptions: { scope: "local" }) {
        assert.deepEqual(signOutOptions, { scope: "local" });
        signOutCalls += 1;
        options.onSignOut?.();
        return { error: options.signOutError ?? null };
      },
    },
    calls: () => ({ getSessionCalls, updateUserCalls, signOutCalls, updatedPassword }),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createAtomicRecoverySignOutHarness(options: {
  rotateToA2BeforeLock?: boolean;
  attemptA2WhenSignOutStarts?: boolean;
  lockAcquireTimeout?: unknown;
} = {}) {
  function createSession(epoch: number): Session {
    return {
      access_token: `access-token-${epoch}`,
      refresh_token: `refresh-token-${epoch}`,
      expires_in: 3_600,
      token_type: "bearer",
      user: { id: RECOVERY_USER } as Session["user"],
    };
  }

  let storedSession: Session | null = createSession(1);
  let currentScope = recordSupabaseAuthIdentity(storedSession);
  assert.ok(currentScope);
  const scopeA1 = currentScope;
  let lockHeld = false;
  let beforeLockHookPending = options.rotateToA2BeforeLock === true;
  let queuedA2 = false;
  let signOutCalls = 0;
  let publicSignOutCalls = 0;
  const closedRefreshTokens: string[] = [];
  const attemptA2WhenSignOutStarts = options.attemptA2WhenSignOutStarts === true;
  const expectedLockAcquireTimeout = Object.prototype.hasOwnProperty.call(
    options,
    "lockAcquireTimeout",
  )
    ? options.lockAcquireTimeout
    : undefined;

  function installA2() {
    storedSession = createSession(2);
    currentScope = recordSupabaseAuthIdentity(storedSession);
  }

  const atomicAuth = {
    initializePromise: Promise.resolve(),
    lockAcquireTimeout: expectedLockAcquireTimeout,
    async signOut() {
      publicSignOutCalls += 1;
      installA2();
      if (storedSession) closedRefreshTokens.push(storedSession.refresh_token);
      storedSession = null;
      currentScope = null;
      recordSupabaseAuthIdentity(null);
      return { error: null };
    },
    async _acquireLock<T>(_timeout: number | undefined, operation: () => Promise<T>): Promise<T> {
      assert.equal(
        _timeout,
        expectedLockAcquireTimeout,
        "se conserva exactamente el timeout interno de auth-js sin inventar otro valor",
      );
      assert.equal(lockHeld, false, "el helper no debe adquirir dos veces el lock auth-js");
      if (beforeLockHookPending) {
        beforeLockHookPending = false;
        installA2();
      }
      lockHeld = true;
      try {
        return await operation();
      } finally {
        lockHeld = false;
        if (queuedA2) installA2();
      }
    },
    async _useSession<T>(operation: (result: {
      data: { session: Session | null };
      error: unknown | null;
    }) => Promise<T>): Promise<T> {
      assert.equal(lockHeld, true, "la lectura autoritativa ocurre dentro del lock auth-js");
      return operation({ data: { session: storedSession }, error: null });
    },
    async _signOut(options: { scope: "local" }) {
      assert.deepEqual(options, { scope: "local" });
      assert.equal(lockHeld, true, "la mutación ocurre dentro del mismo lock auth-js");
      signOutCalls += 1;
      if (options.scope === "local" && attemptA2WhenSignOutStarts) {
        queuedA2 = true;
      }
      if (storedSession) closedRefreshTokens.push(storedSession.refresh_token);
      storedSession = null;
      currentScope = null;
      recordSupabaseAuthIdentity(null);
      return { error: null };
    },
  };

  const authPort = {
    getSession: async () => ({
      data: { session: storedSession ? { user: { id: storedSession.user.id } } : null },
      error: null,
    }),
    updateUser: async (_attributes: { password: string }) => ({ error: null }),
    signOut: (
      _signOutOptions: { scope: "local" },
      expectedIdentityScope: SupabaseAuthRefreshIdentityScope,
    ) => signOutSupabaseAuthIdentityLocallyIfCurrent(
      atomicAuth as unknown as SupabaseClient["auth"],
      expectedIdentityScope,
    ),
  };

  return {
    authPort,
    atomicAuth,
    scopeA1,
    currentScope: () => currentScope,
    closedRefreshTokens: () => [...closedRefreshTokens],
    publicSignOutCalls: () => publicSignOutCalls,
    signOutCalls: () => signOutCalls,
    cleanup: () => recordSupabaseAuthIdentity(null),
  };
}

function createInstalledSupabaseAuthHarness() {
  const storageKey = "auth-js-installed-runtime-test";
  const session = {
    access_token: "installed-access-token",
    refresh_token: "installed-refresh-token",
    expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    expires_in: 3_600,
    token_type: "bearer",
    user: { id: RECOVERY_USER },
  } as Session;
  const values = new Map<string, string>([[storageKey, JSON.stringify(session)]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  let logoutRequests = 0;
  const client = createClient(
    "https://abcdefghijklmnopqrst.supabase.co",
    "installed-runtime-anon-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage,
        storageKey,
      },
      global: {
        fetch: async (input) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/auth/v1/logout?scope=local")) logoutRequests += 1;
          return new Response(null, { status: 204 });
        },
      },
    },
  );
  const runtimeAuth = client.auth as unknown as {
    lockAcquireTimeout: unknown;
  };
  assert.equal(
    Object.prototype.hasOwnProperty.call(runtimeAuth, "lockAcquireTimeout"),
    true,
  );
  assert.equal(
    runtimeAuth.lockAcquireTimeout,
    undefined,
    "supabase-js 2.57/auth-js 2.105.4 entrega undefined al cliente real instalado",
  );
  const scope = recordSupabaseAuthIdentity(session);
  assert.ok(scope);

  return {
    auth: client.auth,
    scope,
    session,
    storedSession: () => values.get(storageKey) ?? null,
    logoutRequests: () => logoutRequests,
    cleanup: () => recordSupabaseAuthIdentity(null),
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timeout: ${label}`)), 1_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test("cancel/back and duplicate recovery events share one local signOut without touching another device", async () => {
  const guard = createPasswordRecoveryPortalGuard();
  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false, "el evento PASSWORD_RECOVERY duplicado no reinicia el intento");
  let localSessionActive = true;
  const otherDeviceSessionActive = true;
  let localSignOutCalls = 0;

  const signOut = () => guard.runLocalSignOut(async () => {
    localSignOutCalls += 1;
    localSessionActive = false;
    return { error: null };
  });
  const fromCancel = signOut();
  const fromBack = signOut();
  assert.equal(fromCancel, fromBack, "cancelar y volver comparten la misma promesa terminal");
  assert.deepEqual(await Promise.all([fromCancel, fromBack]), [{ error: null }, { error: null }]);
  assert.equal(localSignOutCalls, 1);
  assert.equal(localSessionActive, false);
  assert.equal(otherDeviceSessionActive, true);
});

test("update error keeps every portal permit blocked until the local recovery session closes", async () => {
  const guard = createPasswordRecoveryPortalGuard(true);
  const portalPermit = guard.capturePortalMountPermit();
  const updateError = new Error("private update diagnostic");
  const harness = createAuthHarness({ updateError });
  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: harness.auth,
    isRecoveryCurrent: () => guard.isBlocked(),
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => assert.fail("un update fallido no publica éxito"),
  });

  assert.deepEqual(result, { kind: "update-error", error: updateError });
  assert.equal(harness.calls().signOutCalls, 0, "el owner terminal del root ejecuta el cierre local");
  assert.equal(portalPermit.isCurrent(), false);
  await guard.runLocalSignOut(async () => ({ error: null }));
  assert.equal(portalPermit.isCurrent(), false);
});

let completedAsyncTests = 0;
after(() => {
  assert.equal(completedAsyncTests, 7, "todos los escenarios async deben terminar realmente");
});

test("invalid or mismatched recovery performs zero writes", async () => {
  const missingConfirmation = createAuthHarness();
  assert.deepEqual(await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: null,
    expectedIdentityScope: null,
    getCurrentIdentityScope: () => null,
    auth: missingConfirmation.auth,
    isRecoveryCurrent: () => false,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => assert.fail("no debe publicar"),
  }), { kind: "invalid-recovery" });
  assert.equal(missingConfirmation.calls().getSessionCalls, 0);

  const mismatch = createAuthHarness({ sessionUserId: DIFFERENT_USER });
  assert.deepEqual(await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: mismatch.auth,
    isRecoveryCurrent: () => true,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => assert.fail("no debe publicar"),
  }), { kind: "invalid-recovery" });
  assert.equal(mismatch.calls().updateUserCalls, 0);
  assert.equal(mismatch.calls().signOutCalls, 0);
  completedAsyncTests += 1;
});

test("successful update keeps the write allowlist and one signOut", async () => {
  const harness = createAuthHarness({ sessionUserId: RECOVERY_USER_UPPER });
  let publishedUpdates = 0;
  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER_LOWER,
    ...recoveryIdentityScopeFields(RECOVERY_LOWER_SCOPE),
    auth: harness.auth,
    isRecoveryCurrent: (userId) => userId === RECOVERY_USER_LOWER,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => { publishedUpdates += 1; },
  });
  assert.deepEqual(result, { kind: "success" });
  assert.deepEqual(harness.calls(), {
    getSessionCalls: 2,
    updateUserCalls: 1,
    signOutCalls: 1,
    updatedPassword: "Password123",
  });
  assert.equal(publishedUpdates, 1);
  completedAsyncTests += 1;
});

test("recovery A mantiene revalidación y cierre atómicos antes de permitir login B", async () => {
  const updateStarted = createDeferred<void>();
  const releaseUpdate = createDeferred<void>();
  let activeUserId: string | null = RECOVERY_USER;
  let loginBEntered = false;
  let signOutCalls = 0;

  const pendingRecoveryA = executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: {
      getSession: async () => ({
        data: { session: activeUserId ? { user: { id: activeUserId } } : null },
        error: null,
      }),
      updateUser: async () => {
        updateStarted.resolve();
        await releaseUpdate.promise;
        return { error: null };
      },
      signOut: async () => {
        signOutCalls += 1;
        assert.equal(activeUserId, RECOVERY_USER);
        activeUserId = null;
        return { error: null };
      },
    },
    isRecoveryCurrent: (userId) => userId === RECOVERY_USER,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => undefined,
  });
  await updateStarted.promise;

  const pendingLoginB = runSupabasePrincipalIdentityOperation(async () => {
    loginBEntered = true;
    activeUserId = DIFFERENT_USER;
  });
  await Promise.resolve();
  assert.equal(loginBEntered, false, "B no entra antes de la revalidación y cierre de recovery A");

  releaseUpdate.resolve();
  assert.deepEqual(await pendingRecoveryA, { kind: "success" });
  await pendingLoginB;
  assert.equal(signOutCalls, 1);
  assert.equal(activeUserId, DIFFERENT_USER, "el cierre A nunca revoca la sesión B posterior");
});

test("revalidación final detecta B aunque cambie fuera del coordinador y no ejecuta signOut", async () => {
  let activeUserId: string | null = RECOVERY_USER;
  let sessionReads = 0;
  let signOutCalls = 0;

  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: {
      getSession: async () => {
        sessionReads += 1;
        return {
          data: { session: activeUserId ? { user: { id: activeUserId } } : null },
          error: null,
        };
      },
      updateUser: async () => {
        activeUserId = DIFFERENT_USER;
        return { error: null };
      },
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    },
    isRecoveryCurrent: (userId) => userId === RECOVERY_USER,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => undefined,
  });

  assert.deepEqual(result, { kind: "stale" });
  assert.equal(sessionReads, 2);
  assert.equal(signOutCalls, 0);
  assert.equal(activeUserId, DIFFERENT_USER);
});

test("recovery A1 no cierra A2 del mismo usuario si cambia la época después del update", async () => {
  const recoveryScopeA1 = Object.freeze({ userId: RECOVERY_USER, sessionEpoch: 41 });
  const recoveryScopeA2 = Object.freeze({ userId: RECOVERY_USER, sessionEpoch: 42 });
  let currentScope: SupabaseAuthRefreshIdentityScope = recoveryScopeA1;
  let updateUserCalls = 0;
  let signOutCalls = 0;

  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    expectedIdentityScope: recoveryScopeA1,
    getCurrentIdentityScope: () => currentScope,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: RECOVERY_USER } } },
        error: null,
      }),
      updateUser: async () => {
        updateUserCalls += 1;
        currentScope = recoveryScopeA2;
        return { error: null };
      },
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    },
    isRecoveryCurrent: () => true,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => assert.fail("A1 stale no publica éxito para A2"),
  });

  assert.deepEqual(result, { kind: "stale" });
  assert.equal(updateUserCalls, 1);
  assert.equal(signOutCalls, 0);
  assert.equal(currentScope, recoveryScopeA2);
});

test("cancel/back de recovery A1 no cierra A2 del mismo usuario", async () => {
  const recoveryScopeA1 = Object.freeze({ userId: RECOVERY_USER, sessionEpoch: 51 });
  const recoveryScopeA2 = Object.freeze({ userId: RECOVERY_USER, sessionEpoch: 52 });
  let currentScope: SupabaseAuthRefreshIdentityScope = recoveryScopeA1;
  let sessionReads = 0;
  let signOutCalls = 0;

  const result = await signOutPasswordRecoveryIdentityLocally({
    expectedIdentityScope: recoveryScopeA1,
    getCurrentIdentityScope: () => currentScope,
    auth: {
      getSession: async () => {
        sessionReads += 1;
        currentScope = recoveryScopeA2;
        return {
          data: { session: { user: { id: RECOVERY_USER } } },
          error: null,
        };
      },
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    },
  });

  assert.equal(sessionReads, 1);
  assert.equal(signOutCalls, 0);
  assert.match(String(result.error), /identity changed/i);
  assert.equal(currentScope, recoveryScopeA2);
});

for (const scenario of [
  {
    name: "A2 gana antes del lock interno",
    options: { rotateToA2BeforeLock: true },
    expectedUpdateKind: "stale",
    expectedCloseError: true,
    expectedSignOutCalls: 0,
    expectedClosedRefreshTokens: [],
    expectedCurrentIdentity: "a2",
  },
  {
    name: "A2 intenta entrar al comenzar el cierre",
    options: { attemptA2WhenSignOutStarts: true },
    expectedUpdateKind: "success",
    expectedCloseError: false,
    expectedSignOutCalls: 1,
    expectedClosedRefreshTokens: ["refresh-token-1"],
    expectedCurrentIdentity: "a2",
  },
  {
    name: "A1 sano",
    options: {},
    expectedUpdateKind: "success",
    expectedCloseError: false,
    expectedSignOutCalls: 1,
    expectedClosedRefreshTokens: ["refresh-token-1"],
    expectedCurrentIdentity: "none",
  },
] as const) {
  test(`cierre atómico post-update · ${scenario.name} nunca elimina A2`, async () => {
    const harness = createAtomicRecoverySignOutHarness(scenario.options);
    try {
      const result = await executePasswordRecoveryUpdate({
        password: "Password123",
        confirmedUserId: RECOVERY_USER,
        expectedIdentityScope: harness.scopeA1,
        getCurrentIdentityScope: harness.currentScope,
        auth: harness.authPort,
        isRecoveryCurrent: () => true,
        isOperationCurrent: () => true,
        isTerminalOperationCurrent: () => true,
        onPasswordUpdated: () => undefined,
      });

      assert.equal(result.kind, scenario.expectedUpdateKind);
      assert.equal(harness.publicSignOutCalls(), 0, "el cierre público vulnerable nunca se invoca");
      assert.equal(harness.signOutCalls(), scenario.expectedSignOutCalls);
      assert.deepEqual(harness.closedRefreshTokens(), scenario.expectedClosedRefreshTokens);
      if (scenario.expectedCurrentIdentity === "a2") {
        assert.equal(harness.currentScope()?.userId, RECOVERY_USER);
        assert.notEqual(harness.currentScope()?.sessionEpoch, harness.scopeA1.sessionEpoch);
      } else {
        assert.equal(harness.currentScope(), null);
      }
    } finally {
      harness.cleanup();
    }
  });

  test(`cierre atómico cancel/back · ${scenario.name} nunca elimina A2`, async () => {
    const harness = createAtomicRecoverySignOutHarness(scenario.options);
    try {
      const result = await signOutPasswordRecoveryIdentityLocally({
        expectedIdentityScope: harness.scopeA1,
        getCurrentIdentityScope: harness.currentScope,
        auth: harness.authPort,
      });

      assert.equal(Boolean(result.error), scenario.expectedCloseError);
      assert.equal(harness.publicSignOutCalls(), 0, "el cierre público vulnerable nunca se invoca");
      assert.equal(harness.signOutCalls(), scenario.expectedSignOutCalls);
      assert.deepEqual(harness.closedRefreshTokens(), scenario.expectedClosedRefreshTokens);
      if (scenario.expectedCurrentIdentity === "a2") {
        assert.equal(harness.currentScope()?.userId, RECOVERY_USER);
        assert.notEqual(harness.currentScope()?.sessionEpoch, harness.scopeA1.sessionEpoch);
      } else {
        assert.equal(harness.currentScope(), null);
      }
    } finally {
      harness.cleanup();
    }
  });
}

for (const recoveryPath of ["update", "cancel"] as const) {
  test(`cliente Supabase instalado con timeout undefined cierra A1 sano en ${recoveryPath}`, async () => {
    const harness = createInstalledSupabaseAuthHarness();
    try {
      if (recoveryPath === "update") {
        const result = await executePasswordRecoveryUpdate({
          password: "Password123",
          confirmedUserId: RECOVERY_USER,
          expectedIdentityScope: harness.scope,
          getCurrentIdentityScope: () => harness.scope,
          auth: {
            getSession: () => harness.auth.getSession(),
            updateUser: async () => ({ error: null }),
            signOut: (_options, expectedIdentityScope) => (
              signOutSupabaseAuthIdentityLocallyIfCurrent(harness.auth, expectedIdentityScope)
            ),
          },
          isRecoveryCurrent: () => true,
          isOperationCurrent: () => true,
          isTerminalOperationCurrent: () => true,
          onPasswordUpdated: () => undefined,
        });
        assert.deepEqual(result, { kind: "success" });
      } else {
        const result = await signOutPasswordRecoveryIdentityLocally({
          expectedIdentityScope: harness.scope,
          getCurrentIdentityScope: () => harness.scope,
          auth: {
            getSession: () => harness.auth.getSession(),
            signOut: (_options, expectedIdentityScope) => (
              signOutSupabaseAuthIdentityLocallyIfCurrent(harness.auth, expectedIdentityScope)
            ),
          },
        });
        assert.equal(result.error, null);
      }

      assert.equal(harness.logoutRequests(), 1);
      assert.equal(harness.storedSession(), null, "sólo A1 se elimina del storage instalado");
    } finally {
      harness.cleanup();
    }
  });
}

for (const [label, invalidTimeout] of [
  ["null", null],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["string", "5000"],
] as const) {
  test(`timeout auth-js inválido (${label}) falla cerrado antes del lock`, async () => {
    const session = {
      refresh_token: `invalid-timeout-${label}`,
      user: { id: RECOVERY_USER },
    } as Pick<Session, "refresh_token" | "user">;
    const expectedScope = recordSupabaseAuthIdentity(session);
    assert.ok(expectedScope);
    let acquireLockCalls = 0;
    let signOutCalls = 0;
    const incompatibleAuth = {
      initializePromise: Promise.resolve(),
      lockAcquireTimeout: invalidTimeout,
      async _acquireLock<T>(_timeout: unknown, operation: () => Promise<T>): Promise<T> {
        acquireLockCalls += 1;
        return operation();
      },
      async _useSession<T>(operation: (result: {
        data: { session: Session | null };
        error: unknown | null;
      }) => Promise<T>): Promise<T> {
        return operation({ data: { session: session as Session }, error: null });
      },
      async _signOut() {
        signOutCalls += 1;
        return { error: null };
      },
    };

    try {
      const result = await signOutSupabaseAuthIdentityLocallyIfCurrent(
        incompatibleAuth as unknown as SupabaseClient["auth"],
        expectedScope,
      );
      assert.equal(result.identityChanged, false);
      assert.ok(result.error instanceof Error);
      assert.equal(acquireLockCalls, 0);
      assert.equal(signOutCalls, 0);
      assert.equal(recordSupabaseAuthIdentity(session), expectedScope);
    } finally {
      recordSupabaseAuthIdentity(null);
    }
  });
}

test("seam auth-js incompatible falla cerrado sin mutar la sesión", async () => {
  const session = {
    refresh_token: "refresh-token-control",
    user: { id: RECOVERY_USER },
  } as Pick<Session, "refresh_token" | "user">;
  const expectedScope = recordSupabaseAuthIdentity(session);
  assert.ok(expectedScope);
  try {
    const result = await signOutSupabaseAuthIdentityLocallyIfCurrent(
      {} as SupabaseClient["auth"],
      expectedScope,
    );
    assert.equal(result.identityChanged, false);
    assert.ok(result.error instanceof Error);
    assert.equal(
      translateAuthError(result.error),
      "No pudimos completar la acción. Intenta nuevamente.",
      "la UI no expone detalles del seam privado",
    );
    assert.equal(recordSupabaseAuthIdentity(session), expectedScope, "la identidad A1 sigue intacta");
  } finally {
    recordSupabaseAuthIdentity(null);
  }
});

test("double submit owns one awaited operation and cannot exit with pending work", async () => {
  const epoch = createSessionDataEpoch({ userId: RECOVERY_USER, scope: `supabase:${RECOVERY_USER}` });
  const lock: { current: SessionOperationOwner | null } = { current: null };
  const sessionDeferred = createDeferred<{
    data: { session: { user: { id: string } } | null };
    error: unknown | null;
  }>();
  const sessionReadStarted = createDeferred<void>();
  let getSessionCalls = 0;
  let updateUserCalls = 0;
  let signOutCalls = 0;

  async function submit() {
    const owner = tryAcquireSessionOperationOwner(lock.current, captureSessionDataRequestToken(epoch));
    if (!owner) return { kind: "locked" } as const;
    lock.current = owner;
    try {
      return await executePasswordRecoveryUpdate({
        password: "Password123",
        confirmedUserId: RECOVERY_USER,
        ...recoveryIdentityScopeFields(),
        auth: {
          getSession: () => {
            getSessionCalls += 1;
            sessionReadStarted.resolve();
            return sessionDeferred.promise;
          },
          updateUser: async () => {
            updateUserCalls += 1;
            return { error: null };
          },
          signOut: async (options) => {
            assert.deepEqual(options, { scope: "local" });
            signOutCalls += 1;
            return { error: null };
          },
        },
        isRecoveryCurrent: () => true,
        isOperationCurrent: () => (
          isSessionOperationOwner(lock.current, owner)
          && isSessionDataRequestTokenCurrent(epoch, owner.requestToken)
        ),
        isTerminalOperationCurrent: () => isSessionOperationOwner(lock.current, owner),
        onPasswordUpdated: () => undefined,
      });
    } finally {
      const finalization = finalizeSessionOperationOwner({
        currentOwner: lock.current,
        owner,
        isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
      });
      lock.current = finalization.nextOwner;
    }
  }

  const firstSubmit = submit();
  assert.deepEqual(await submit(), { kind: "locked" });
  await sessionReadStarted.promise;
  assert.equal(getSessionCalls, 1);
  assert.equal(updateUserCalls, 0);
  assert.equal(signOutCalls, 0);
  sessionDeferred.resolve({
    data: { session: { user: { id: RECOVERY_USER } } },
    error: null,
  });
  assert.deepEqual(await withTimeout(firstSubmit, "first password update"), { kind: "success" });
  assert.deepEqual({ getSessionCalls, updateUserCalls, signOutCalls }, {
    getSessionCalls: 2,
    updateUserCalls: 1,
    signOutCalls: 1,
  });
  assert.equal(lock.current, null);
  completedAsyncTests += 1;
});

test("identity or epoch stale before updateUser performs zero writes", async () => {
  let operationCurrent = true;
  const harness = createAuthHarness({ onGetSession: () => { operationCurrent = false; } });
  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: harness.auth,
    isRecoveryCurrent: () => true,
    isOperationCurrent: () => operationCurrent,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => assert.fail("no debe publicar"),
  });
  assert.deepEqual(result, { kind: "stale" });
  assert.equal(harness.calls().updateUserCalls, 0);
  assert.equal(harness.calls().signOutCalls, 0);
  completedAsyncTests += 1;
});

test("stale before signOut stops after the single password write", async () => {
  let operationCurrent = true;
  const harness = createAuthHarness({ onUpdateUser: () => { operationCurrent = false; } });
  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: harness.auth,
    isRecoveryCurrent: () => true,
    isOperationCurrent: () => operationCurrent,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => assert.fail("stale no debe publicar éxito"),
  });
  assert.deepEqual(result, { kind: "stale" });
  assert.equal(harness.calls().updateUserCalls, 1);
  assert.equal(harness.calls().signOutCalls, 0);
  completedAsyncTests += 1;
});

test("signOut error is not a false success and its UI translation is sanitized", async () => {
  const signOutError = new Error("private signOut diagnostic");
  const harness = createAuthHarness({ signOutError });
  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: harness.auth,
    isRecoveryCurrent: () => true,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => undefined,
  });
  assert.deepEqual(result, { kind: "sign-out-error", error: signOutError });
  assert.equal(harness.calls().updateUserCalls, 1);
  assert.equal(harness.calls().signOutCalls, 1);
  assert.doesNotMatch(translateAuthError(signOutError), /private signOut diagnostic/);
  completedAsyncTests += 1;
});

test("own SIGNED_OUT may advance epoch before signOut resolves and still completes exactly once", async () => {
  let epoch = createSessionDataEpoch({ userId: RECOVERY_USER, scope: `supabase:${RECOVERY_USER}` });
  const lock: { current: SessionOperationOwner | null } = { current: null };
  const owner = tryAcquireSessionOperationOwner(lock.current, captureSessionDataRequestToken(epoch));
  assert.ok(owner);
  lock.current = owner;

  const mounted = true;
  let recoveryCurrent = true;
  let recoveryFlowStored = true;
  let recoveryUrl = "/?flow=password-recovery#type=recovery";
  let passwordDraft = "Password123";
  let confirmDraft = "Password123";
  let navigation = "nueva-password";
  let busy = true;
  let successPending = false;
  let completionCalls = 0;
  let updateUserCalls = 0;
  let signOutCalls = 0;
  const order: string[] = [];

  function completeOnce() {
    if (!successPending) return false;
    successPending = false;
    completionCalls += 1;
    recoveryFlowStored = false;
    recoveryUrl = "/";
    passwordDraft = "";
    confirmDraft = "";
    navigation = "login";
    busy = false;
    recoveryCurrent = false;
    return true;
  }

  const isOperationCurrent = () => (
    mounted
    && isSessionOperationOwner(lock.current, owner)
    && isSessionDataRequestTokenCurrent(epoch, owner.requestToken)
  );
  const isTerminalOperationCurrent = () => mounted && isSessionOperationOwner(lock.current, owner);

  const result = await executePasswordRecoveryUpdate({
    password: "Password123",
    confirmedUserId: RECOVERY_USER,
    ...recoveryIdentityScopeFields(),
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: RECOVERY_USER } } },
        error: null,
      }),
      updateUser: async (attributes) => {
        updateUserCalls += 1;
        order.push("updateUser");
        assert.deepEqual(attributes, { password: "Password123" });
        return { error: null };
      },
      signOut: async (options) => {
        assert.deepEqual(options, { scope: "local" });
        signOutCalls += 1;
        order.push("signOut:start");
        order.push("SIGNED_OUT");
        epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null }, { force: true });
        order.push("epoch:advanced");
        completeOnce();
        order.push("signOut:resolve");
        return { error: null };
      },
    },
    isRecoveryCurrent: (userId) => recoveryCurrent && userId === RECOVERY_USER,
    isOperationCurrent,
    isTerminalOperationCurrent,
    onPasswordUpdated: () => {
      successPending = true;
    },
  });

  assert.deepEqual(result, { kind: "success" });
  assert.deepEqual(order, [
    "updateUser",
    "signOut:start",
    "SIGNED_OUT",
    "epoch:advanced",
    "signOut:resolve",
  ]);
  assert.equal(completeOnce(), false, "handler y listener comparten una limpieza idempotente");

  const operationStillAuthorized = isOperationCurrent();
  const hasTerminalOwnership = mounted && isSessionOperationOwner(lock.current, owner);
  if (operationStillAuthorized) {
    const finalization = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
    });
    lock.current = finalization.nextOwner;
  } else if (hasTerminalOwnership) {
    lock.current = releaseSessionOperationOwner(lock.current, owner);
    busy = false;
  }

  assert.equal(updateUserCalls, 1);
  assert.equal(signOutCalls, 1);
  assert.equal(completionCalls, 1);
  assert.equal(recoveryFlowStored, false);
  assert.equal(recoveryUrl, "/");
  assert.equal(passwordDraft, "");
  assert.equal(confirmDraft, "");
  assert.equal(navigation, "login");
  assert.equal(busy, false);
  assert.equal(lock.current, null);
  assert.equal(mounted, true);
  completedAsyncTests += 1;
});
