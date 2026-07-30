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
import {
  finalizeSessionOperationOwner,
  resolveActiveWorkoutSessionBoundary,
  resolveIncomingWorkoutDraftRecoveryScope,
  settleSessionOperationPromise,
  tryAcquireSessionOperationOwner,
  type SessionOperationOwner,
} from "@/lib/session/active-workout-session-boundary";

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

interface ActiveWorkoutPublicationState {
  value: string | null;
  error: string;
  message: string;
  screen: "dashboard" | "entrenamiento";
  loadingOwner: string | null;
  busyOwner: string | null;
  draftScopes: string[];
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

  {
    const identityChange = resolveActiveWorkoutSessionBoundary({
      currentIdentity: identityA,
      nextIdentity: identityB,
      event: "session_applied",
    });
    assert.deepEqual(identityChange, {
      invalidateEpoch: true,
      forceEpochAdvance: false,
      resetActiveWorkoutMemory: true,
      clearClosingStorageScope: false,
      clearIncomingWorkoutDraft: false,
    });

    const scopeChange = resolveActiveWorkoutSessionBoundary({
      currentIdentity: identityA,
      nextIdentity: scopeA2,
      event: "session_applied",
    });
    assert.equal(scopeChange.invalidateEpoch, true);
    assert.equal(scopeChange.resetActiveWorkoutMemory, true);
    assert.equal(scopeChange.clearIncomingWorkoutDraft, false);

    const tokenRefresh = resolveActiveWorkoutSessionBoundary({
      currentIdentity: identityA,
      nextIdentity: identityA,
      event: "session_applied",
    });
    assert.deepEqual(tokenRefresh, {
      invalidateEpoch: false,
      forceEpochAdvance: false,
      resetActiveWorkoutMemory: false,
      clearClosingStorageScope: false,
      clearIncomingWorkoutDraft: false,
    });

    const signedOut = resolveActiveWorkoutSessionBoundary({
      currentIdentity: identityA,
      nextIdentity: { userId: null, scope: null },
      event: "signed_out",
    });
    assert.equal(signedOut.invalidateEpoch, true);
    assert.equal(signedOut.forceEpochAdvance, true);
    assert.equal(signedOut.resetActiveWorkoutMemory, true);
    assert.equal(signedOut.clearClosingStorageScope, true);
    assert.equal(signedOut.clearIncomingWorkoutDraft, false);
  }

  {
    const currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
    );
    assert.ok(ownerA, "A adquiere el lock antes de iniciar readiness");
    lock.current = ownerA;
    assert.equal(
      tryAcquireSessionOperationOwner(lock.current, captureSessionDataRequestToken(currentEpoch)),
      null,
      "una segunda operacion de A no atraviesa el lock",
    );

    const readiness = createDeferred<string>();
    const state: ActiveWorkoutPublicationState = {
      value: null,
      error: "",
      message: "",
      screen: "entrenamiento",
      loadingOwner: "A-readiness",
      busyOwner: "A-readiness",
      draftScopes: [],
    };
    const pendingReadiness = settleSessionOperationPromise({
      request: readiness.promise,
      owner: ownerA,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    readiness.resolve("readiness-a");
    const result = await pendingReadiness;
    assert.deepEqual(result, { kind: "success", value: "readiness-a" });
    if (result.kind === "success") {
      state.value = result.value;
      state.message = "success:A-readiness";
      state.draftScopes.push(ownerA.requestToken.scope ?? "");
    }

    const finalization = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerA,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    lock.current = finalization.nextOwner;
    if (finalization.canFinalize && state.loadingOwner === "A-readiness") {
      state.loadingOwner = null;
    }
    if (finalization.canFinalize && state.busyOwner === "A-readiness") {
      state.busyOwner = null;
    }

    assert.equal(finalization.canFinalize, true, "el finally actual puede limpiar su estado visual");
    assert.equal(finalization.released, true, "el owner actual libera su lock");
    assert.equal(lock.current, null);
    assert.deepEqual(state, {
      value: "readiness-a",
      error: "",
      message: "success:A-readiness",
      screen: "entrenamiento",
      loadingOwner: null,
      busyOwner: null,
      draftScopes: [identityA.scope],
    });
  }

  {
    const expectedError = new Error("current failure");
    const currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const owner = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
    );
    assert.ok(owner);
    lock.current = owner;
    const request = createDeferred<string>();
    const pending = settleSessionOperationPromise({
      request: request.promise,
      owner,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    request.reject(expectedError);
    const result = await pending;
    assert.equal(result.kind, "error", "un error actual conserva su canal de error");
    if (result.kind === "error") assert.equal(result.error, expectedError);

    const finalization = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    assert.equal(finalization.canFinalize, true);
    assert.equal(finalization.released, true);
    assert.equal(finalization.nextOwner, null);
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
    );
    assert.ok(ownerA);
    lock.current = ownerA;
    const readinessA = createDeferred<string>();
    const state: ActiveWorkoutPublicationState = {
      value: "active-workout-a",
      error: "",
      message: "",
      screen: "entrenamiento",
      loadingOwner: "A-readiness",
      busyOwner: "B-readiness",
      draftScopes: [],
    };
    const pendingReadinessA = settleSessionOperationPromise({
      request: readinessA.promise,
      owner: ownerA,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });

    const boundary = resolveActiveWorkoutSessionBoundary({
      currentIdentity: currentEpoch,
      nextIdentity: identityB,
      event: "session_applied",
    });
    assert.equal(boundary.invalidateEpoch, true);
    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    assert.equal(boundary.resetActiveWorkoutMemory, true);
    state.value = "active-workout-b";
    state.loadingOwner = "B-readiness";
    lock.current = null;

    const ownerB = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
    );
    assert.ok(ownerB, "B puede adquirir el lock despues del reset de identidad");
    lock.current = ownerB;

    readinessA.resolve("readiness-a");
    const resultA = await pendingReadinessA;
    assert.deepEqual(resultA, { kind: "stale" });
    if (resultA.kind === "success") {
      state.value = resultA.value;
      state.message = "success:A-readiness";
      state.draftScopes.push(ownerA.requestToken.scope ?? "");
    }

    const finalizationA = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerA,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    lock.current = finalizationA.nextOwner;
    if (finalizationA.canFinalize && state.loadingOwner === "A-readiness") {
      state.loadingOwner = null;
    }

    assert.equal(state.value, "active-workout-b", "el exito stale de A no reemplaza estado de B");
    assert.equal(state.message, "", "el exito stale de A no publica mensajes");
    assert.equal(state.screen, "entrenamiento", "el exito stale de A no navega la sesion B");
    assert.equal(state.loadingOwner, "B-readiness", "el finally stale no limpia loading de B");
    assert.equal(state.busyOwner, "B-readiness", "el finally stale no limpia busy de B");
    assert.equal(finalizationA.canFinalize, false, "el finally stale no puede limpiar estado de B");
    assert.equal(finalizationA.released, false, "A no libera el lock adquirido por B");
    assert.equal(lock.current, ownerB, "el finally stale no libera el lock de B");
    assert.equal(state.draftScopes.includes(identityB.scope), false, "el draft de A no se guarda bajo scope B");
    assert.deepEqual(state.draftScopes, [], "el resultado stale de A no escribe draft bajo ningun scope nuevo");

    const readinessB = createDeferred<string>();
    const pendingReadinessB = settleSessionOperationPromise({
      request: readinessB.promise,
      owner: ownerB,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    readinessB.resolve("readiness-b");
    assert.deepEqual(await pendingReadinessB, { kind: "success", value: "readiness-b" });
    const finalizationB = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerB,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    assert.equal(finalizationB.canFinalize, true);
    assert.equal(finalizationB.released, true);
    assert.equal(finalizationB.nextOwner, null, "B libera su propio lock");
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
    );
    assert.ok(ownerA);
    lock.current = ownerA;
    const readinessSave = createDeferred<string>();
    const staleError = new Error("stale signed-out save");
    const state: ActiveWorkoutPublicationState = {
      value: null,
      error: "",
      message: "",
      screen: "entrenamiento",
      loadingOwner: null,
      busyOwner: "A-readiness-save",
      draftScopes: [],
    };
    const pendingSave = settleSessionOperationPromise({
      request: readinessSave.promise,
      owner: ownerA,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });

    const signedOut = resolveActiveWorkoutSessionBoundary({
      currentIdentity: currentEpoch,
      nextIdentity: { userId: null, scope: null },
      event: "signed_out",
    });
    currentEpoch = advanceSessionDataEpoch(
      currentEpoch,
      { userId: null, scope: null },
      { force: signedOut.forceEpochAdvance },
    );
    lock.current = null;
    state.busyOwner = null;
    readinessSave.reject(staleError);
    const result = await pendingSave;
    assert.deepEqual(result, { kind: "stale" }, "SIGNED_OUT vuelve stale incluso un rechazo tardio");
    const finalization = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerA,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    assert.equal(finalization.canFinalize, false);
    assert.equal(finalization.released, false);
    assert.equal(finalization.nextOwner, null);

    assert.deepEqual(state, {
      value: null,
      error: "",
      message: "",
      screen: "entrenamiento",
      loadingOwner: null,
      busyOwner: null,
      draftScopes: [],
    });
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
    );
    assert.ok(ownerA);
    lock.current = ownerA;
    const completion = createDeferred<string>();
    const pendingCompletion = settleSessionOperationPromise({
      request: completion.promise,
      owner: ownerA,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });

    const unchangedEpoch = advanceSessionDataEpoch(currentEpoch, identityA);
    assert.equal(unchangedEpoch, currentEpoch, "refresh de la misma identidad conserva el epoch");
    currentEpoch = unchangedEpoch;
    completion.resolve("summary-a");
    assert.deepEqual(
      await pendingCompletion,
      { kind: "success", value: "summary-a" },
      "la misma identidad puede publicar el resultado",
    );

    const finalization = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerA,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    assert.equal(finalization.canFinalize, true);
    assert.equal(finalization.released, true);
    assert.equal(finalization.nextOwner, null);
  }

  assert.equal(
    resolveIncomingWorkoutDraftRecoveryScope({
      scope: "demo",
      willAttemptAutomaticRecovery: false,
    }),
    null,
    "bootstrap demo sin sesion no mantiene una proteccion sin consumidor",
  );
  assert.equal(
    resolveIncomingWorkoutDraftRecoveryScope({
      scope: identityA.scope,
      willAttemptAutomaticRecovery: true,
    }),
    identityA.scope,
    "una sesion entrante protege su draft hasta intentar recuperarlo",
  );

  // Contrato estatico/source-based: valida wiring; no renderiza React ni sustituye los casos runtime anteriores.
  const componentSource = readFileSync(
    new URL("../../components/organizatech-app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(componentSource, /useRef\(createSessionDataEpoch\(\)\)/);
  assert.match(componentSource, /sessionDataMountedRef = useRef\(true\)/);
  assert.match(componentSource, /const advanceSessionDataIdentity = useCallback/);
  assert.match(componentSource, /if \(event === "SIGNED_OUT"\)[\s\S]*?clearUserSessionState/);
  assert.match(
    componentSource,
    /function settleActiveWorkoutOperation<[\s\S]*return settleSessionOperationPromise/,
    "El root delega la resolucion post-await al helper productivo probado en runtime",
  );
  assert.match(
    componentSource,
    /function finalizeActiveWorkoutOperation\([\s\S]*finalizeSessionOperationOwner/,
    "El root delega ownership y finally al helper productivo probado en runtime",
  );

  const applySessionSource = extractBetween(
    componentSource,
    "function applySessionState",
    "function clearUserSessionState",
  );
  assert.match(applySessionSource, /resolveActiveWorkoutSessionBoundary/);
  assert.ok(
    applySessionSource.indexOf("advanceSessionDataIdentity") < applySessionSource.indexOf("setSupabaseUser"),
    "El cambio de identidad debe avanzar el epoch antes de publicar la nueva sesion",
  );
  assert.ok(
    applySessionSource.indexOf("advanceSessionDataIdentity") < applySessionSource.indexOf("resetActiveWorkoutSessionState"),
    "El cambio de identidad debe invalidar el epoch antes del reset de Active Workout",
  );
  assert.ok(
    applySessionSource.indexOf("advanceSessionDataIdentity") < applySessionSource.indexOf("incomingWorkoutDraftRecoveryScopeRef.current = resolveIncomingWorkoutDraftRecoveryScope"),
    "La proteccion del draft entrante se publica solo despues de invalidar el epoch anterior",
  );
  assert.match(
    applySessionSource,
    /resolveIncomingWorkoutDraftRecoveryScope\(\{\s*scope: nextStorageScope,\s*willAttemptAutomaticRecovery: Boolean\(authState\.session\),\s*\}\)/,
    "El bootstrap sin sesion libera explicitamente la proteccion que no tendra recuperacion automatica",
  );
  assert.doesNotMatch(
    applySessionSource,
    /clearWorkoutDraft|clearStoredWorkoutDraft/,
    "Un cambio A→B no debe borrar el draft saliente ni el entrante",
  );

  const sessionClearSource = extractBetween(
    componentSource,
    "function clearUserSessionState",
    "function clearBrowserStorageScope",
  );
  assert.match(
    sessionClearSource,
    /advanceSessionDataIdentity\(signedOutIdentity, \{ force: sessionBoundary\.forceEpochAdvance \}\)/,
  );
  assert.ok(
    sessionClearSource.indexOf("advanceSessionDataIdentity") < sessionClearSource.indexOf("clearBrowserStorageScope"),
    "SIGNED_OUT debe invalidar el epoch antes de limpiar el estado",
  );
  assert.ok(
    sessionClearSource.indexOf("advanceSessionDataIdentity") < sessionClearSource.indexOf("resetActiveWorkoutSessionState"),
    "SIGNED_OUT debe invalidar el epoch antes del reset de Active Workout",
  );
  assert.ok(
    sessionClearSource.indexOf("resetActiveWorkoutSessionState") < sessionClearSource.indexOf("clearBrowserStorageScope"),
    "SIGNED_OUT resetea memoria y luego conserva la limpieza del scope que se cierra",
  );

  const activeWorkoutResetSource = extractBetween(
    componentSource,
    "const resetActiveWorkoutSessionState = useCallback",
    "function clearCycleScopedPlanState",
  );
  for (const resetContract of [
    "setActiveExerciseIndex(0)",
    "setExerciseDrafts({})",
    "setReadiness(null)",
    "setCheckingDailyReadiness(false)",
    "setSavingDailyReadiness(false)",
    'setDailyReadinessError("")',
    "setHasStartedTraining(false)",
    "setActiveWorkoutStartedAt(null)",
    "setActiveWorkoutAttemptId(null)",
    "setPendingWorkoutReadinessLink(null)",
    "setHasRecoverableWorkoutStart(false)",
    "setTrainingCompletionSummary(null)",
    "setLatestExercisePerformance",
    "setLatestExerciseObservation",
  ]) {
    assert.ok(activeWorkoutResetSource.includes(resetContract), `El reset central conserva ${resetContract}`);
  }
  for (const resetRef of [
    "isSavingTrainingRef.current = null",
    "workoutStartInFlightRef.current = null",
    "dailyReadinessSaveInFlightRef.current = null",
    "workoutCompletionInFlightRef.current = null",
    "activeWorkoutAttemptIdRef.current = null",
    "pendingReadinessLinkRef.current = null",
    "activeWorkoutReadinessContextRef.current = null",
  ]) {
    assert.ok(activeWorkoutResetSource.includes(resetRef), `El reset central conserva ${resetRef}`);
  }

  assert.match(
    componentSource,
    /const scope = getBrowserStorageScope\(dataMode, supabaseUser\?\.id\);\s*if \(scope && incomingWorkoutDraftRecoveryScopeRef\.current === scope\) return;\s*clearWorkoutDraft\(dataMode, supabaseUser\?\.id\)/,
    "La limpieza automatica no borra el draft del scope entrante antes de intentar su recuperacion",
  );
  assert.match(
    componentSource,
    /function restoreActiveFlowForSession[\s\S]*loadActiveFlow\(mode, userId\);[\s\S]*incomingWorkoutDraftRecoveryScopeRef\.current = null/,
    "La proteccion se libera al intentar la restauracion inicial del scope",
  );
  assert.match(
    componentSource,
    /function restoreActiveWorkoutForNavigation[\s\S]*loadWorkoutDraft\(dataMode, supabaseUser\?\.id\);[\s\S]*incomingWorkoutDraftRecoveryScopeRef\.current = null/,
    "La proteccion se libera al intentar la reentrada manual",
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
  // P3-07B: la navegación final del login pasa por el controlador canónico (transición
  // autoritativa con reset de historial), ya no por un setter directo de pantalla.
  const dashboardIndex = handleAuthSource.indexOf(
    'applyScreenTransition(createAuthNavigationReset("dashboard", "session-established"));',
    clearFormsIndex,
  );
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
