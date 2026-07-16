import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  type SessionDataEpoch,
  type SessionDataRequestToken,
} from "@/lib/session/session-data-epoch";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface HarnessState {
  data: string | null;
  error: string;
  loadingOwner: string | null;
}

interface LoginFlowHarnessState {
  formsCleared: boolean;
  screen: "login" | "dashboard";
  statusMessage: string;
  busyOwner: string | null;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleDeferredLoad(input: {
  token: SessionDataRequestToken;
  request: Promise<string>;
  getCurrentEpoch: () => SessionDataEpoch;
  state: HarnessState;
  owner: string;
}) {
  const isCurrent = () => isSessionDataRequestTokenCurrent(input.getCurrentEpoch(), input.token);
  try {
    const data = await input.request;
    if (!isCurrent()) return;
    input.state.data = data;
    input.state.error = "";
  } catch {
    if (!isCurrent()) return;
    input.state.error = `error:${input.owner}`;
  } finally {
    if (isCurrent() && input.state.loadingOwner === input.owner) {
      input.state.loadingOwner = null;
    }
  }
}

async function settleAppliedLoginFlow(input: {
  token: SessionDataRequestToken;
  refresh: Promise<void>;
  getCurrentEpoch: () => SessionDataEpoch;
  state: LoginFlowHarnessState;
  owner: string;
}) {
  const isCurrent = () => isSessionDataRequestTokenCurrent(input.getCurrentEpoch(), input.token);
  try {
    await input.refresh;
    if (!isCurrent()) return;
    input.state.formsCleared = true;
    input.state.screen = "dashboard";
  } catch {
    if (!isCurrent()) return;
    input.state.statusMessage = `error:${input.owner}`;
  } finally {
    if (isCurrent() && input.state.busyOwner === input.owner) {
      input.state.busyOwner = null;
    }
  }
}

function extractBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `No se encontro el inicio: ${startMarker}`);
  assert.notEqual(end, -1, `No se encontro el final: ${endMarker}`);
  return source.slice(start, end);
}

async function run() {
  const identityA = { userId: "user-a", scope: "supabase:user-a" };
  const identityB = { userId: "user-b", scope: "supabase:user-b" };
  const scopeA2 = { userId: "user-a", scope: "demo" };

  {
    const epoch = createSessionDataEpoch(identityA);
    const token = captureSessionDataRequestToken(epoch);
    assert.equal(isSessionDataRequestTokenCurrent(epoch, token), true);
  }

  {
    const epoch = createSessionDataEpoch(identityA);
    const token = captureSessionDataRequestToken(epoch);
    const advanced = advanceSessionDataEpoch(epoch, identityA, { force: true });
    assert.equal(isSessionDataRequestTokenCurrent(advanced, token), false);
  }

  {
    const epochA = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(epochA);
    const epochB = advanceSessionDataEpoch(epochA, identityB);
    assert.equal(isSessionDataRequestTokenCurrent(epochB, tokenA), false);
  }

  {
    const epochA = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(epochA);
    const nextScope = advanceSessionDataEpoch(epochA, scopeA2);
    assert.equal(isSessionDataRequestTokenCurrent(nextScope, tokenA), false);
  }

  {
    const epochA = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(epochA);
    const signedOut = advanceSessionDataEpoch(epochA, { userId: null, scope: null });
    assert.equal(isSessionDataRequestTokenCurrent(signedOut, tokenA), false);
  }

  {
    const epochA = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(epochA);
    const signedOut = advanceSessionDataEpoch(epochA, { userId: null, scope: null });
    const epochB = advanceSessionDataEpoch(signedOut, identityB);
    const tokenB = captureSessionDataRequestToken(epochB);
    assert.equal(isSessionDataRequestTokenCurrent(epochB, tokenA), false);
    assert.equal(isSessionDataRequestTokenCurrent(epochB, tokenB), true);
  }

  {
    const epochA = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(epochA);
    const epochB = advanceSessionDataEpoch(epochA, identityB);
    assert.equal(isSessionDataRequestTokenCurrent(epochB, tokenA), false);
  }

  {
    const epoch = createSessionDataEpoch(identityA);
    const first = captureSessionDataRequestToken(epoch);
    const second = captureSessionDataRequestToken(epoch);
    const unchanged = advanceSessionDataEpoch(epoch, identityA);
    assert.equal(unchanged, epoch);
    assert.equal(isSessionDataRequestTokenCurrent(epoch, first), true);
    assert.equal(isSessionDataRequestTokenCurrent(epoch, second), true);
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(currentEpoch);
    const deferredA = createDeferred<string>();
    const state: HarnessState = { data: null, error: "", loadingOwner: "A" };
    const loadA = settleDeferredLoad({
      token: tokenA,
      request: deferredA.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "A",
    });

    currentEpoch = advanceSessionDataEpoch(currentEpoch, { userId: null, scope: null });
    state.loadingOwner = null;
    deferredA.resolve("data-A");
    await loadA;

    assert.deepEqual(state, { data: null, error: "", loadingOwner: null });
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const appliedIdentityToken = captureSessionDataRequestToken(currentEpoch);
    const refresh = createDeferred<void>();
    const state: LoginFlowHarnessState = {
      formsCleared: false,
      screen: "login",
      statusMessage: "",
      busyOwner: "login-a",
    };
    const loginFlow = settleAppliedLoginFlow({
      token: appliedIdentityToken,
      refresh: refresh.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "login-a",
    });

    currentEpoch = advanceSessionDataEpoch(currentEpoch, { userId: null, scope: null });
    state.statusMessage = "signed-out";
    state.busyOwner = "signed-out";
    refresh.resolve();
    await loginFlow;

    assert.deepEqual(state, {
      formsCleared: false,
      screen: "login",
      statusMessage: "signed-out",
      busyOwner: "signed-out",
    });
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const appliedIdentityToken = captureSessionDataRequestToken(currentEpoch);
    const refresh = createDeferred<void>();
    const state: LoginFlowHarnessState = {
      formsCleared: false,
      screen: "login",
      statusMessage: "",
      busyOwner: "login-a",
    };
    const loginFlow = settleAppliedLoginFlow({
      token: appliedIdentityToken,
      refresh: refresh.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "login-a",
    });

    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    state.statusMessage = "identity-b-ready";
    state.busyOwner = "identity-b";
    refresh.reject(new Error("stale refresh"));
    await loginFlow;

    assert.deepEqual(state, {
      formsCleared: false,
      screen: "login",
      statusMessage: "identity-b-ready",
      busyOwner: "identity-b",
    });
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(currentEpoch);
    const deferredA = createDeferred<string>();
    const state: HarnessState = { data: null, error: "", loadingOwner: "A" };
    const loadA = settleDeferredLoad({
      token: tokenA,
      request: deferredA.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "A",
    });

    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    const tokenB = captureSessionDataRequestToken(currentEpoch);
    const deferredB = createDeferred<string>();
    state.loadingOwner = "B";
    const loadB = settleDeferredLoad({
      token: tokenB,
      request: deferredB.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "B",
    });

    deferredB.resolve("data-B");
    await loadB;
    deferredA.resolve("data-A");
    await loadA;

    assert.deepEqual(state, { data: "data-B", error: "", loadingOwner: null });
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(currentEpoch);
    const deferredA = createDeferred<string>();
    const state: HarnessState = { data: "data-B", error: "", loadingOwner: "B" };
    const loadA = settleDeferredLoad({
      token: tokenA,
      request: deferredA.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "A",
    });

    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    deferredA.reject(new Error("stale A"));
    await loadA;

    assert.deepEqual(state, { data: "data-B", error: "", loadingOwner: "B" });
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const tokenA = captureSessionDataRequestToken(currentEpoch);
    const deferredA = createDeferred<string>();
    const state: HarnessState = { data: null, error: "", loadingOwner: "A" };
    const loadA = settleDeferredLoad({
      token: tokenA,
      request: deferredA.promise,
      getCurrentEpoch: () => currentEpoch,
      state,
      owner: "A",
    });

    currentEpoch = advanceSessionDataEpoch(currentEpoch, scopeA2);
    state.loadingOwner = null;
    deferredA.resolve("scope-1-data");
    await loadA;

    assert.deepEqual(state, { data: null, error: "", loadingOwner: null });
  }

  const componentSource = readFileSync(
    new URL("../../components/organizatech-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(componentSource, /useRef\(createSessionDataEpoch\(\)\)/);
  assert.match(componentSource, /sessionDataMountedRef = useRef\(true\)/);
  assert.match(componentSource, /const advanceSessionDataIdentity = useCallback/);
  assert.match(componentSource, /if \(event === "SIGNED_OUT"\)[\s\S]*?clearUserSessionState/);

  const applySessionSource = extractBetween(
    componentSource,
    "function applySessionState",
    "function clearUserSessionState",
  );
  assert.ok(
    applySessionSource.indexOf("advanceSessionDataIdentity") < applySessionSource.indexOf("setSupabaseUser"),
    "El cambio de identidad debe avanzar el epoch antes de publicar la nueva sesion",
  );

  const sessionClearSource = extractBetween(
    componentSource,
    "function clearUserSessionState",
    "function clearBrowserStorageScope",
  );
  assert.match(
    sessionClearSource,
    /advanceSessionDataIdentity\(\{ userId: null, scope: null \}, \{ force: true \}\)/,
  );
  assert.ok(
    sessionClearSource.indexOf("advanceSessionDataIdentity") < sessionClearSource.indexOf("clearBrowserStorageScope"),
    "SIGNED_OUT debe invalidar el epoch antes de limpiar el estado",
  );

  const bootstrapSource = extractBetween(
    componentSource,
    "async function bootstrapSession",
    "void bootstrapSession();",
  );
  assert.match(bootstrapSource, /captureSessionDataRequestToken\(\)/);
  assert.match(bootstrapSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const refreshDataSource = extractBetween(
    componentSource,
    "async function refreshData",
    "async function refreshProfilePersonalData",
  );
  assert.match(refreshDataSource, /captureSessionDataRequestToken\(\)/);
  assert.match(refreshDataSource, /isSessionDataRequestCurrent\(requestToken\)/);
  assert.match(refreshDataSource, /finally[\s\S]*?isSessionDataRequestCurrent\(requestToken\)/);

  const profileAvatarSource = extractBetween(
    componentSource,
    "const refreshProfileAvatar = useCallback",
    "const completedTrainingDays",
  );
  assert.match(profileAvatarSource, /captureSessionDataRequestToken\(\)/);
  assert.match(profileAvatarSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const profileEffectSource = extractBetween(
    componentSource,
    'if (screen !== "perfil" || !canEditProfilePersonalData)',
    "function refreshAvatarOnResume",
  );
  assert.match(profileEffectSource, /captureSessionDataRequestToken\(\)/);
  assert.match(profileEffectSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const latestPerformanceSource = extractBetween(
    componentSource,
    "const requestToken = captureSessionDataRequestToken();\n\n    if (activeWorkoutExerciseLineageId",
    'if (screen !== "perfil" || !canEditProfilePersonalData)',
  );
  assert.match(latestPerformanceSource, /captureSessionDataRequestToken\(\)/);
  assert.match(latestPerformanceSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const profileSource = extractBetween(
    componentSource,
    "async function refreshProfilePersonalData",
    "async function handleSaveProfilePersonalData",
  );
  assert.match(profileSource, /captureSessionDataRequestToken\(\)/);
  assert.match(profileSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const cyclesSource = extractBetween(
    componentSource,
    "async function refreshPersistedTrainingCycles",
    "async function loadCycleScopedPlanIntoState",
  );
  assert.match(cyclesSource, /captureSessionDataRequestToken\(\)/);
  assert.match(cyclesSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const planSource = extractBetween(
    componentSource,
    "async function loadCycleScopedPlanIntoState",
    "async function createCycleScopedTrainingCycleFromSetup",
  );
  assert.match(planSource, /captureSessionDataRequestToken\(\)/);
  assert.match(planSource, /isSessionDataRequestCurrent\(requestToken\)/);

  const handleAuthSource = extractBetween(
    componentSource,
    "async function handleAuth",
    "async function handlePasswordRecovery",
  );
  const sessionResultIndex = handleAuthSource.indexOf("const session = result.data.session;");
  const applyIdentityIndex = handleAuthSource.indexOf("applySessionState({", sessionResultIndex);
  const captureIdentityIndex = handleAuthSource.indexOf(
    "appliedIdentityToken = captureSessionDataRequestToken();",
    applyIdentityIndex,
  );
  const refreshIndex = handleAuthSource.indexOf('await refreshData("supabase");', captureIdentityIndex);
  const staleGuardIndex = handleAuthSource.indexOf(
    "if (!isSessionDataRequestCurrent(appliedIdentityToken)) return;",
    refreshIndex,
  );
  const clearFormsIndex = handleAuthSource.indexOf("clearAuthForms();", staleGuardIndex);
  const dashboardIndex = handleAuthSource.indexOf('setScreen("dashboard");', clearFormsIndex);
  const orderedLoginSteps = [
    sessionResultIndex,
    applyIdentityIndex,
    captureIdentityIndex,
    refreshIndex,
    staleGuardIndex,
    clearFormsIndex,
    dashboardIndex,
  ];
  assert.equal(
    orderedLoginSteps.every((index, position) => index >= 0 && (position === 0 || index > orderedLoginSteps[position - 1])),
    true,
    "El login debe aplicar identidad, capturar su token, refrescar, validarlo y solo entonces navegar",
  );
  assert.match(
    handleAuthSource,
    /catch \(error\) \{\s*if \(appliedIdentityToken && !isSessionDataRequestCurrent\(appliedIdentityToken\)\) return;\s*setStatusMessage/,
  );
  assert.match(
    handleAuthSource,
    /finally \{\s*if \(!appliedIdentityToken \|\| isSessionDataRequestCurrent\(appliedIdentityToken\)\) \{\s*setIsBusy\(false\);/,
  );

  console.log("session-data-epoch tests passed");
}

void run();
