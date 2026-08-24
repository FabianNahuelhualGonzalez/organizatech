import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  executePasswordRecoveryUpdate,
  getPasswordRecoveryClearedHref,
  hasPasswordRecoveryCallbackError,
  resolvePasswordRecoverySessionDecision,
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

const RECOVERY_USER = "11111111-1111-4111-8111-111111111111";
const RECOVERY_USER_UPPER = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const RECOVERY_USER_LOWER = RECOVERY_USER_UPPER.toLowerCase();
const DIFFERENT_USER = "22222222-2222-4222-8222-222222222222";

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
    auth: harness.auth,
    isRecoveryCurrent: (userId) => userId === RECOVERY_USER_LOWER,
    isOperationCurrent: () => true,
    isTerminalOperationCurrent: () => true,
    onPasswordUpdated: () => { publishedUpdates += 1; },
  });
  assert.deepEqual(result, { kind: "success" });
  assert.deepEqual(harness.calls(), {
    getSessionCalls: 1,
    updateUserCalls: 1,
    signOutCalls: 1,
    updatedPassword: "Password123",
  });
  assert.equal(publishedUpdates, 1);
  completedAsyncTests += 1;
});

test("double submit owns one awaited operation and cannot exit with pending work", async () => {
  const epoch = createSessionDataEpoch({ userId: RECOVERY_USER, scope: `supabase:${RECOVERY_USER}` });
  const lock: { current: SessionOperationOwner | null } = { current: null };
  const sessionDeferred = createDeferred<{
    data: { session: { user: { id: string } } | null };
    error: unknown | null;
  }>();
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
        auth: {
          getSession: () => {
            getSessionCalls += 1;
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
  assert.equal(getSessionCalls, 1);
  assert.equal(updateUserCalls, 0);
  assert.equal(signOutCalls, 0);
  sessionDeferred.resolve({
    data: { session: { user: { id: RECOVERY_USER } } },
    error: null,
  });
  assert.deepEqual(await withTimeout(firstSubmit, "first password update"), { kind: "success" });
  assert.deepEqual({ getSessionCalls, updateUserCalls, signOutCalls }, {
    getSessionCalls: 1,
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
