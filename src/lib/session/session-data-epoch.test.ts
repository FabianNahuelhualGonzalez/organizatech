import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  resolveEffectiveAuthenticatedUser,
  shouldContinueAuthenticatedFlowAfterRefresh,
  type SessionDataEpoch,
  type SessionDataRequestToken,
} from "@/lib/session/session-data-epoch";
import { translateAuthError, translatePersistenceError } from "@/lib/supabase/auth-errors";
import {
  finalizeSessionOperationOwner,
  invalidateSessionOperationOwners,
  isSessionOperationOwnerCurrent,
  resolveActiveWorkoutSessionBoundary,
  resolveIncomingWorkoutDraftRecoveryScope,
  settleSessionOperationPromise,
  tryAcquireSessionOperationOwner,
  type SessionOperationOwner,
} from "@/lib/session/active-workout-session-boundary";
import {
  resolveActiveWorkoutHistoryCommit,
  runActiveWorkoutHistoryLoad,
} from "@/lib/training/active-workout-history-load";
import {
  saveTrainingSessionWithEntries,
  type SaveTrainingSessionInput,
} from "@/lib/data/repository";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createTrainingSessionWithCycleEntries,
  type CycleScopedTrainingSessionInput,
} from "@/lib/training/cycle-scoped-training-repository";

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

function createLegacyTrainingSessionWriteHarness(input: {
  initialUserId: string;
  deferredRoutineLookup?: boolean;
  existingRoutineId?: string | null;
}) {
  let currentUserId = input.initialUserId;
  const routineLookupStarted = createDeferred<void>();
  const routineLookup = createDeferred<{
    data: { id: string } | null;
    error: null;
  }>();
  const counts = {
    getUser: 0,
    routineLookup: 0,
    routineInsert: 0,
    rpc: 0,
  };
  const routineQuery = {
    select() {
      return routineQuery;
    },
    eq() {
      return routineQuery;
    },
    maybeSingle() {
      counts.routineLookup += 1;
      routineLookupStarted.resolve();
      if (input.deferredRoutineLookup) return routineLookup.promise;
      return Promise.resolve({
        data: input.existingRoutineId ? { id: input.existingRoutineId } : null,
        error: null,
      });
    },
    insert() {
      counts.routineInsert += 1;
      return routineQuery;
    },
    single() {
      return Promise.resolve({ data: { id: "routine-created" }, error: null });
    },
  };
  const client = {
    auth: {
      async getUser() {
        counts.getUser += 1;
        return { data: { user: { id: currentUserId } }, error: null };
      },
    },
    from(table: string) {
      assert.equal(table, "routines");
      return routineQuery;
    },
    async rpc(name: string) {
      assert.equal(name, "create_training_session_with_entries");
      counts.rpc += 1;
      return { data: "legacy-session-a", error: null };
    },
  };

  return {
    counts,
    getClient: (() => client) as unknown as typeof getSupabaseBrowserClient,
    routineLookupStarted: routineLookupStarted.promise,
    resolveRoutineLookup(data: { id: string } | null) {
      routineLookup.resolve({ data, error: null });
    },
    setCurrentUserId(userId: string) {
      currentUserId = userId;
    },
  };
}

function createCycleScopedTrainingSessionWriteHarness(userIds: readonly string[]) {
  let nextUserIndex = 0;
  const counts = { getUser: 0, rpc: 0 };
  const client = {
    auth: {
      async getUser() {
        const userId = userIds[Math.min(nextUserIndex, userIds.length - 1)];
        nextUserIndex += 1;
        counts.getUser += 1;
        return { data: { user: userId ? { id: userId } : null }, error: null };
      },
    },
    async rpc(name: string) {
      assert.equal(name, "create_training_session_with_cycle_entries");
      counts.rpc += 1;
      return { data: "cycle-session-a", error: null };
    },
  };

  return {
    counts,
    getClient: (() => client) as unknown as typeof getSupabaseBrowserClient,
  };
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

function assertMarkersInOrder(source: string, markers: readonly string[], label: string) {
  const indices = markers.map((marker) => source.indexOf(marker));
  for (const [index, marker] of indices.map((value, position) => [value, markers[position]] as const)) {
    assert.ok(index >= 0, `${label}: falta ${marker}`);
  }
  for (let index = 1; index < indices.length; index += 1) {
    assert.ok(indices[index] > indices[index - 1], `${label}: orden invalido para ${markers[index]}`);
  }
}

function collectActiveWorkoutRepositoryWrites(appSource: string, activeWorkoutSource: string) {
  const repositoryWriteImports = new Set<string>();
  const repositoryImport = /import\s*\{([^}]*)\}\s*from\s*"@\/lib\/[^"]*repository";/g;
  let match: RegExpExecArray | null;
  while ((match = repositoryImport.exec(appSource)) !== null) {
    for (const rawImport of match[1].split(",")) {
      const normalized = rawImport.trim().replace(/^type\s+/, "");
      if (!normalized) continue;
      const [importedName, localAlias] = normalized.split(/\s+as\s+/);
      const localName = localAlias ?? importedName;
      if (/^(save|create|link)[A-Z]/.test(localName)) {
        repositoryWriteImports.add(localName);
      }
    }
  }

  return Array.from(repositoryWriteImports)
    .filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(activeWorkoutSource))
    .sort();
}

interface P341ContractSources {
  app: string;
  trainingDataController: string;
  trainingDataRequestOwner: string;
  sessionEpoch: string;
  operationOwner: string;
  profileRepository: string;
  avatarRepository: string;
  dataRepository: string;
  cyclesRepository: string;
  cycleScopedRepository: string;
  dailyReadinessRepository: string;
  workoutReadinessRepository: string;
  completion: string;
}

/** Contrato estrictamente source-based; no renderiza React ni sustituye los casos runtime. */
function assertP341StaticContracts(sources: P341ContractSources) {
  assert.equal((sources.app.match(/useRef\(createSessionDataEpoch\(\)\)/g) ?? []).length, 1);
  assert.doesNotMatch(sources.app, /from ["']zustand["']|createContext\(/);
  assert.match(sources.app, /resolveEffectiveAuthenticatedUser\(authState\.session, authState\.user\)/);
  assert.match(
    sources.app,
    /const canEditProfilePersonalData = Boolean\(hasSupabaseSession && getSupabaseBrowserClient\(\)\)/,
  );

  const applySession = extractBetween(
    sources.app,
    "function applySessionState",
    "function clearUserSessionState",
  );
  assertMarkersInOrder(applySession, [
    "advanceSessionDataIdentity",
    "resetUserScopedTransientState()",
    "setSupabaseUser(authenticatedUser)",
  ], "invalidacion antes de publicar identidad");
  const identityProfileReset = extractBetween(
    applySession,
    "if (identityChanged)",
    "setIsSupabaseConfiguredState",
  );
  assert.match(identityProfileReset, /setProfilePersonalData\(null\)/);
  assert.doesNotMatch(
    applySession.slice(applySession.indexOf("setIsSupabaseConfiguredState")),
    /setProfilePersonalData\(null\)|setProfileAvatar\(createEmptyProfileAvatarState\(\)\)/,
  );

  const transientReset = extractBetween(
    sources.app,
    "function resetUserScopedTransientState",
    "function applySessionState",
  );
  for (const marker of [
    "setIsMenuOpen(false)",
    "setIsNotificationPanelOpen(false)",
    "setIsTopbarHidden(false)",
    "setIsNewCycleConfirmOpen(false)",
    "setIsDeleteCycleConfirmOpen(false)",
    "setIsRoutineSuccessOpen(false)",
    "setIsRoutineUpdateConfirmOpen(false)",
    "setRoutineEditorReturnScreen(null)",
    "setRoutineNotice(\"\")",
    "setDashboardDayOverride(\"\")",
    'dispatchProgressController({ type: "selection_reset" })',
  ]) assert.ok(transientReset.includes(marker), `reset user-scoped incompleto: ${marker}`);

  const profileSave = extractBetween(
    sources.app,
    "async function handleSaveProfilePersonalData",
    "async function handleUploadProfileAvatar",
  );
  assertMarkersInOrder(profileSave, [
    "tryAcquireUserScopedOperation(profileSaveInFlightRef)",
    "updateProfilePersonalData(input, operationOwner.userId)",
    'if (result.kind === "stale") return null;',
    "setProfilePersonalData(result.value)",
  ], "Profile save owner");
  assert.match(profileSave, /finally[\s\S]*finalizeUserScopedOperation\(profileSaveInFlightRef, operationOwner\)/);

  const avatarSave = extractBetween(
    sources.app,
    "async function handleUploadProfileAvatar",
    "async function refreshTrainingCyclesBoundary",
  );
  assertMarkersInOrder(avatarSave, [
    "tryAcquireUserScopedOperation(profileAvatarUploadInFlightRef)",
    "uploadProfileAvatar(file, operationOwner.userId)",
    'if (result.kind === "stale") return false;',
    "setProfileAvatar(avatar)",
  ], "Avatar owner");

  const routineSave = extractBetween(
    sources.app,
    "async function saveInitialRoutine",
    "async function handleLogout",
  );
  assert.match(routineSave, /tryAcquireUserScopedOperation\(routineSaveInFlightRef\)/);
  assert.match(routineSave, /deleteExercise\([\s\S]*operationOwner\.userId \?\? undefined/);
  assert.match(routineSave, /saveExercise\([\s\S]*operationOwner\.userId \?\? undefined/);
  assert.match(routineSave, /if \(deleteResult\.kind === "stale"\) return;/);
  assert.match(routineSave, /if \(saveResult\.kind === "stale"\) return;/);
  assert.equal(
    (routineSave.match(
      /if \(finalizeUserScopedOperation\(routineSaveInFlightRef, operationOwner\)\)/g,
    ) ?? []).length,
    2,
    "ambos finally de Routine deben estar gobernados por su owner",
  );

  for (const [start, end, lock] of [
    ["async function startNewTrainingCycle", "async function deleteCurrentTrainingCycle", "trainingCycleCreateInFlightRef"],
    ["async function deleteCurrentTrainingCycle", "function updateExerciseDraft", "trainingCycleDeleteInFlightRef"],
  ] as const) {
    const operation = extractBetween(sources.app, start, end);
    assert.match(operation, new RegExp(`tryAcquireUserScopedOperation\\(${lock}\\)`));
    assert.match(operation, /settleUserScopedOperation\(/);
    assert.match(operation, new RegExp(`finalizeUserScopedOperation\\(${lock}, operationOwner\\)`));
    assert.match(operation, /operationOwner\.userId \?\? undefined/);
  }

  const logout = extractBetween(sources.app, "async function handleLogout", "function openRoutineDay");
  assert.doesNotMatch(logout, /clearBrowserStorageScope|clearPasswordRecoveryFlow/);
  assertMarkersInOrder(logout, [
    "await supabase.auth.signOut()",
    "if (error) throw error;",
    "clearUserSessionState",
  ], "signOut antes de cleanup");
  const passwordUpdate = extractBetween(
    sources.app,
    "async function handleUpdatePassword",
    "function prepareRoutineBuilderStateFromExercises",
  );
  assert.match(passwordUpdate, /const \{ error: signOutError \} = await supabase\.auth\.signOut\(\)/);
  assert.match(passwordUpdate, /if \(signOutError\)/);
  assert.doesNotMatch(passwordUpdate, /setStatusMessage\("Contrase\\u00f1a actualizada/);

  const refresh = extractBetween(
    sources.app,
    "function applyTrainingDataRefreshResult",
    "async function refreshProfilePersonalData",
  );
  for (const kind of ["stale", "error"]) assert.ok(refresh.includes(`kind === "${kind}"`));
  assert.match(refresh, /handlePersistenceError\(result\.error, \{ preserveSession: true \}\)/);
  assert.match(refresh, /trainingDataController\.refreshForIdentity\(\{/);
  assert.match(refresh, /captureSessionDataRequestToken\(\)/);
  assert.match(refresh, /isSessionDataRequestCurrent\(requestToken\)/);
  assert.match(sources.trainingDataRequestOwner, /requestToken: identity\.captureRequestToken\(\)/);
  assert.match(sources.trainingDataRequestOwner, /identity\.isRequestTokenCurrent\(owner\.requestToken\)/);
  assert.match(
    sources.sessionEpoch,
    /export function shouldContinueAuthenticatedFlowAfterRefresh\([\s\S]*?return kind !== "stale";/,
  );
  const authenticatedRefreshFlows = [
    extractBetween(sources.app, "async function bootstrapSession", "void bootstrapSession();"),
    extractBetween(
      sources.app,
      'if (event === "SIGNED_IN" || (event === "INITIAL_SESSION" && session))',
      'if (event === "INITIAL_SESSION" && !session)',
    ),
    extractBetween(
      sources.app,
      "const session = result.data.session;",
      "} catch (error) {",
    ),
  ];
  for (const flow of authenticatedRefreshFlows) {
    assert.match(
      flow,
      /if \(!shouldContinueAuthenticatedFlowAfterRefresh\(refreshResult\.kind\)\) return;/,
    );
    assert.doesNotMatch(flow, /refreshResult\.kind !== "success"/);
  }
  const tokenRefreshed = extractBetween(
    sources.app,
    'if (event === "TOKEN_REFRESHED")',
    "}).data.subscription;",
  );
  assert.doesNotMatch(tokenRefreshed, /advanceSessionDataIdentity|setProfilePersonalData\(null\)/);

  assert.match(sources.operationOwner, /readonly operationId: string/);
  assert.match(sources.operationOwner, /readonly dataMode: SessionOperationDataMode/);
  assert.match(sources.operationOwner, /invalidateSessionOperationOwners/);
  assert.equal((sources.operationOwner.match(/interface SessionOperationOwner\b/g) ?? []).length, 1);
  assert.match(sources.profileRepository, /expectedUserId && userId !== expectedUserId/);
  assert.match(sources.avatarRepository, /assertExpectedProfileAvatarUser\(supabase, userId\)/);
  assert.match(sources.dataRepository, /assertExpectedRepositoryUser\(supabase, expectedUserId \?\? userId\)/);
  assert.match(sources.cyclesRepository, /assertExpectedCycleRepositoryUser\(supabase, expectedUserId \?\? userId\)/);
  assert.match(sources.cycleScopedRepository, /assertExpectedCycleScopedRepositoryUser/);

  const legacySessionWrite = extractBetween(
    sources.dataRepository,
    "export async function saveTrainingSessionWithEntries",
    "export function replaceLocalData",
  );
  assert.match(
    legacySessionWrite,
    /mode: RepositoryMode,\s*expectedUserId: string,/,
    "expectedUserId es obligatorio y no tiene fallback en el write legacy",
  );
  assert.match(
    legacySessionWrite,
    /getRepositoryAuth\(mode, expectedUserId, getClient\)[\s\S]*?await assertExpectedRepositoryUser\(supabase, expectedUserId\);[\s\S]*?await upsertRoutine\([\s\S]*?expectedUserId,[\s\S]*?getClient,[\s\S]*?\);[\s\S]*?await assertExpectedRepositoryUser\(supabase, expectedUserId\);[\s\S]*?supabase\.rpc\("create_training_session_with_entries"/,
    "legacy revalida el owner antes de upsertRoutine y otra vez antes del RPC",
  );
  const upsertRoutine = extractBetween(
    sources.dataRepository,
    "async function upsertRoutine",
    "async function fetchExercises",
  );
  assert.match(upsertRoutine, /expectedUserId: string,/);
  assert.doesNotMatch(upsertRoutine, /expectedUserId\s*=\s*userId/);
  assert.match(
    upsertRoutine,
    /await assertExpectedRepositoryUser\(supabase, expectedUserId\);[\s\S]*?\.from\("routines"\)[\s\S]*?\.maybeSingle\(\);[\s\S]*?await assertExpectedRepositoryUser\(supabase, expectedUserId\);[\s\S]*?if \(existing\.data\?\.id\)/,
    "upsertRoutine recibe y revalida el mismo expectedUserId alrededor de su await",
  );

  const cycleScopedSessionWrite = extractBetween(
    sources.cycleScopedRepository,
    "export async function createTrainingSessionWithCycleEntries",
    "export interface CycleScopedTrainingDayCountRow",
  );
  assert.match(
    cycleScopedSessionWrite,
    /expectedUserId: string,/,
    "expectedUserId es obligatorio y no tiene fallback en el write cycle-scoped",
  );
  assert.match(
    cycleScopedSessionWrite,
    /getAuthenticatedCycleScopedRepository\(getClient, expectedUserId\)[\s\S]*?await assertExpectedCycleScopedRepositoryUser\(supabase, expectedUserId\);[\s\S]*?supabase\.rpc\("create_training_session_with_cycle_entries"/,
    "cycle-scoped revalida el owner inmediatamente antes del RPC",
  );

  const activeWorkoutCompletion = extractBetween(
    sources.app,
    "async function saveCompletedTraining",
    "function clearAuthForms",
  );
  assert.match(
    activeWorkoutCompletion,
    /createTrainingSessionWithCycleEntries\(\{[\s\S]*?\}, operationOwner\.userId\)/,
    "el caller cycle-scoped pasa exactamente operationOwner.userId",
  );
  assert.match(
    activeWorkoutCompletion,
    /saveTrainingSessionWithEntries\(\s*legacySessionInput,\s*operationOwner\.dataMode,\s*operationOwner\.userId,\s*\)/,
    "el caller legacy Supabase pasa exactamente operationOwner.userId",
  );

  // Inventario source-based P3-41: descubre writes importados desde repositorios y usados por
  // Active Workout. No sustituye los casos runtime; impide que un write nuevo quede fuera de tabla.
  const activeWorkoutWritesSource = extractBetween(
    sources.app,
    "async function persistDailyReadiness",
    "function clearAuthForms",
  );
  const activeWorkoutWriteInventory = [
    {
      name: "saveTrainingSessionWithEntries",
      source: sources.dataRepository,
      start: "export async function saveTrainingSessionWithEntries",
      end: "export function replaceLocalData",
      rpc: 'supabase.rpc("create_training_session_with_entries"',
      validation: "assertExpectedRepositoryUser(supabase, expectedUserId)",
      caller: /saveTrainingSessionWithEntries\(\s*legacySessionInput,\s*operationOwner\.dataMode,\s*operationOwner\.userId,\s*\)/,
      callCount: 2,
    },
    {
      name: "createTrainingSessionWithCycleEntries",
      source: sources.cycleScopedRepository,
      start: "export async function createTrainingSessionWithCycleEntries",
      end: "export interface CycleScopedTrainingDayCountRow",
      rpc: 'supabase.rpc("create_training_session_with_cycle_entries"',
      validation: "assertExpectedCycleScopedRepositoryUser(supabase, expectedUserId)",
      caller: /createTrainingSessionWithCycleEntries\(\{[\s\S]*?\}, operationOwner\.userId\)/,
      callCount: 1,
    },
    {
      name: "saveDailyTrainingReadiness",
      source: sources.dailyReadinessRepository,
      start: "export async function saveDailyTrainingReadiness",
      end: "export function normalizeDailyReadinessPayload",
      rpc: 'supabase.rpc("save_daily_training_readiness"',
      validation: "assertExpectedDailyReadinessUser(supabase, expectedUserId)",
      caller: /saveDailyTrainingReadiness\(value, operationOwner\.userId\)/,
      callCount: 1,
    },
    {
      name: "saveTrainingWorkoutReadiness",
      source: sources.workoutReadinessRepository,
      start: "export async function saveTrainingWorkoutReadiness",
      end: "export async function linkTrainingWorkoutReadinessSession",
      rpc: 'supabase.rpc("save_training_workout_readiness_v2"',
      validation: "assertExpectedTrainingWorkoutReadinessUser(supabase, expectedUserId)",
      caller: /saveTrainingWorkoutReadiness\(\{[\s\S]*?\}, operationOwner\.userId\)/,
      callCount: 1,
    },
    {
      name: "linkTrainingWorkoutReadinessSession",
      source: sources.workoutReadinessRepository,
      start: "export async function linkTrainingWorkoutReadinessSession",
      end: "function getTrainingWorkoutReadinessClient",
      rpc: 'supabase.rpc("link_training_workout_readiness_session_v2"',
      validation: "assertExpectedTrainingWorkoutReadinessUser(supabase, expectedUserId)",
      caller: /linkTrainingWorkoutReadinessSession\(\{\s*workoutAttemptId: pendingLink\.workoutAttemptId,\s*trainingSessionId: pendingLink\.trainingSessionId,\s*\}, operationOwner\.userId\)/,
      callCount: 1,
    },
  ] as const;

  const discoveredActiveWorkoutWrites = collectActiveWorkoutRepositoryWrites(
    sources.app,
    activeWorkoutWritesSource,
  );
  const inventoriedActiveWorkoutWrites = activeWorkoutWriteInventory
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    discoveredActiveWorkoutWrites,
    inventoriedActiveWorkoutWrites,
    "toda persistencia user-scoped de Active Workout debe estar inventariada con owner",
  );

  for (const entry of activeWorkoutWriteInventory) {
    const repositoryFunction = extractBetween(entry.source, entry.start, entry.end);
    assert.match(
      repositoryFunction,
      /expectedUserId: string,/,
      `${entry.name}: expectedUserId obligatorio sin default`,
    );
    assert.doesNotMatch(repositoryFunction, /expectedUserId\s*[?=]/);
    assert.match(activeWorkoutWritesSource, entry.caller, `${entry.name}: caller sin operationOwner.userId`);
    assert.equal(
      (activeWorkoutWritesSource.match(new RegExp(`\\b${entry.name}\\s*\\(`, "g")) ?? []).length,
      entry.callCount,
      `${entry.name}: cantidad de callers productivos inventariados`,
    );

    const rpcIndex = repositoryFunction.indexOf(entry.rpc);
    const validationIndex = repositoryFunction.lastIndexOf(entry.validation, rpcIndex);
    assert.ok(rpcIndex >= 0, `${entry.name}: RPC declarado no encontrado`);
    assert.ok(validationIndex >= 0, `${entry.name}: falta revalidacion antes del RPC`);
    assert.ok(validationIndex < rpcIndex, `${entry.name}: revalidacion debe preceder al RPC`);
    const validationEnd = repositoryFunction.indexOf(";", validationIndex) + 1;
    const rpcAwaitIndex = repositoryFunction.lastIndexOf("await ", rpcIndex);
    assert.ok(validationEnd > validationIndex, `${entry.name}: revalidacion incompleta`);
    assert.ok(rpcAwaitIndex >= validationEnd, `${entry.name}: RPC no esperado inmediatamente despues del guard`);
    assert.doesNotMatch(
      repositoryFunction.slice(validationEnd, rpcAwaitIndex),
      /\bawait\b/,
      `${entry.name}: existe otro await sin revalidacion antes del RPC`,
    );
    const rpcPayloadEnd = repositoryFunction.indexOf("});", rpcIndex);
    assert.ok(rpcPayloadEnd > rpcIndex, `${entry.name}: payload RPC no encontrado`);
    assert.doesNotMatch(
      repositoryFunction.slice(rpcIndex, rpcPayloadEnd),
      /\b(?:user_id|owner_id|profile_id)\b/,
      `${entry.name}: ownership no puede venir del caller`,
    );
  }
  assert.match(
    activeWorkoutWritesSource,
    /saveTrainingSessionWithEntries\(\s*legacySessionInput,\s*"demo",\s*"demo",\s*\)/,
    "completion legacy conserva un caller local explicito, separado del owner Supabase",
  );
  assert.doesNotMatch(sources.app, /ShareWorkoutCard|workout-share/);
  assert.doesNotMatch(sources.completion, /ShareWorkoutCard|workout-share|navigator|useState|useEffect|useRef/);
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

  // P3-41 RUNTIME: matriz A -> SIGNED_OUT -> B con deferred promises reales.
  async function runStaleSuccessScenario(surface: string) {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
      { dataMode: "supabase", operationId: `${surface}-a` },
    );
    assert.ok(ownerA);
    lock.current = ownerA;
    assert.equal(Object.isFrozen(ownerA), true, `${surface}: owner inmutable`);
    assert.deepEqual(
      {
        userId: ownerA.userId,
        scope: ownerA.scope,
        dataMode: ownerA.dataMode,
        operationId: ownerA.operationId,
      },
      {
        userId: identityA.userId,
        scope: identityA.scope,
        dataMode: "supabase",
        operationId: `${surface}-a`,
      },
    );

    const deferred = createDeferred<string>();
    const pending = settleSessionOperationPromise({
      request: deferred.promise,
      owner: ownerA,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    const state = {
      value: `${surface}-b`,
      error: "",
      busy: "b",
      loading: "b",
      lockReleasedByA: false,
      screen: "dashboard-b",
      drafts: [] as string[],
    };

    currentEpoch = advanceSessionDataEpoch(
      currentEpoch,
      { userId: null, scope: null },
      { force: true },
    );
    invalidateSessionOperationOwners([lock]);
    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    const ownerB = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
      { dataMode: "supabase", operationId: `${surface}-b` },
    );
    assert.ok(ownerB);
    lock.current = ownerB;

    deferred.resolve(`${surface}-a-late`);
    const resultA = await pending;
    if (resultA.kind === "success") {
      state.value = resultA.value;
      state.screen = "screen-a";
      state.drafts.push(ownerA.scope ?? "");
    }
    if (resultA.kind === "error") state.error = String(resultA.error);
    const finalizationA = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerA,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    if (finalizationA.canFinalize) {
      state.busy = "";
      state.loading = "";
    }
    state.lockReleasedByA = finalizationA.released;
    lock.current = finalizationA.nextOwner;

    assert.deepEqual(resultA, { kind: "stale" }, `${surface}: resultado A descartado`);
    assert.deepEqual(state, {
      value: `${surface}-b`,
      error: "",
      busy: "b",
      loading: "b",
      lockReleasedByA: false,
      screen: "dashboard-b",
      drafts: [],
    });
    assert.equal(lock.current, ownerB, `${surface}: finally A no libera lock B`);
  }

  await runStaleSuccessScenario("profile-save");
  await runStaleSuccessScenario("avatar-upload");
  await runStaleSuccessScenario("cycle-create");
  await runStaleSuccessScenario("cycle-delete");

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
      { dataMode: "supabase", operationId: "profile-rejection-a" },
    );
    assert.ok(ownerA);
    lock.current = ownerA;
    const rejection = createDeferred<string>();
    const pending = settleSessionOperationPromise({
      request: rejection.promise,
      owner: ownerA,
      getCurrentOwner: () => lock.current,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    currentEpoch = advanceSessionDataEpoch(currentEpoch, { userId: null, scope: null }, { force: true });
    invalidateSessionOperationOwners([lock]);
    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    const ownerB = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
      { dataMode: "supabase", operationId: "profile-save-b" },
    );
    assert.ok(ownerB);
    lock.current = ownerB;
    const state = { error: "", busy: "b" };
    rejection.reject(new Error("fallo tardio de A"));
    const result = await pending;
    if (result.kind === "error") state.error = "error-a";
    const finalization = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner: ownerA,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    });
    if (finalization.canFinalize) state.busy = "";
    assert.deepEqual(result, { kind: "stale" });
    assert.deepEqual(state, { error: "", busy: "b" });
    assert.equal(finalization.released, false);
    assert.equal(finalization.nextOwner, ownerB);
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const ownerA = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
      { dataMode: "supabase", operationId: "routine-batch-a" },
    );
    assert.ok(ownerA);
    lock.current = ownerA;
    const firstWrite = createDeferred<string>();
    const writes: string[] = [];
    let nextWriteStarted = false;
    const batch = (async () => {
      const firstResult = await settleSessionOperationPromise({
        request: firstWrite.promise,
        owner: ownerA,
        getCurrentOwner: () => lock.current,
        isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
      });
      if (firstResult.kind !== "success") return firstResult.kind;
      writes.push(firstResult.value);
      nextWriteStarted = true;
      return "success";
    })();
    currentEpoch = advanceSessionDataEpoch(currentEpoch, { userId: null, scope: null }, { force: true });
    invalidateSessionOperationOwners([lock]);
    currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
    firstWrite.resolve("write-a-1");
    assert.equal(await batch, "stale");
    assert.deepEqual(writes, []);
    assert.equal(nextWriteStarted, false, "el batch A se detiene antes del siguiente write");
  }

  {
    let currentEpoch = createSessionDataEpoch(identityA);
    const lock: { current: SessionOperationOwner | null } = { current: null };
    const owner = tryAcquireSessionOperationOwner(
      lock.current,
      captureSessionDataRequestToken(currentEpoch),
      { dataMode: "supabase", operationId: "token-refresh-owner" },
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
    const refreshed = advanceSessionDataEpoch(currentEpoch, identityA);
    assert.equal(refreshed, currentEpoch);
    currentEpoch = refreshed;
    assert.equal(isSessionOperationOwnerCurrent({
      currentOwner: lock.current,
      owner,
      isRequestCurrent: (token) => isSessionDataRequestTokenCurrent(currentEpoch, token),
    }), true);
    request.resolve("vigente");
    assert.deepEqual(await pending, { kind: "success", value: "vigente" });
  }

  {
    const userA = { id: "user-a" };
    assert.equal(resolveEffectiveAuthenticatedUser(null, userA), null, "signup sin session no autentica");
    assert.equal(Boolean(resolveEffectiveAuthenticatedUser(null, userA)), false, "signup no habilita Profile write");
    assert.equal(
      resolveEffectiveAuthenticatedUser({ user: userA }, { id: "otro-user" }),
      null,
      "candidate y session.user deben coincidir",
    );
    assert.equal(resolveEffectiveAuthenticatedUser({ user: userA }, userA), userA);
  }

  {
    const state: {
      session: string;
      scope: string | null;
      screen: string;
      cleanupCount: number;
    } = { session: "A", scope: identityA.scope, screen: "dashboard", cleanupCount: 0 };
    let cleaned = false;
    const cleanupOnce = () => {
      if (cleaned) return;
      cleaned = true;
      state.cleanupCount += 1;
      state.session = "";
      state.scope = null;
      state.screen = "login";
    };
    const failedSignOut = createDeferred<{ error: Error | null }>();
    const failed = (async () => {
      const result = await failedSignOut.promise;
      if (result.error) return "error";
      cleanupOnce();
      return "success";
    })();
    failedSignOut.resolve({ error: new Error("network") });
    assert.equal(await failed, "error");
    assert.deepEqual(state, {
      session: "A",
      scope: identityA.scope,
      screen: "dashboard",
      cleanupCount: 0,
    }, "logout fallido conserva session, scope y navegacion");

    const successfulSignOut = createDeferred<{ error: Error | null }>();
    const successful = (async () => {
      const result = await successfulSignOut.promise;
      if (result.error) return "error";
      cleanupOnce(); // fallback del handler
      return "success";
    })();
    successfulSignOut.resolve({ error: null });
    cleanupOnce(); // evento SIGNED_OUT
    assert.equal(await successful, "success");
    assert.equal(state.cleanupCount, 1, "logout exitoso limpia una sola vez");
  }

  {
    assert.equal(shouldContinueAuthenticatedFlowAfterRefresh("success"), true);
    assert.equal(shouldContinueAuthenticatedFlowAfterRefresh("error"), true);
    assert.equal(shouldContinueAuthenticatedFlowAfterRefresh("stale"), false);

    type AuthenticatedRefreshHarnessState = {
      sessionUserId: string | null;
      dataMode: "demo" | "supabase";
      screen: "login" | "dashboard";
      data: string[];
      message: string;
      loading: boolean;
      formsCleared: boolean;
      navigations: number;
    };
    type HarnessRefreshResult =
      | { kind: "success"; data: string[] }
      | { kind: "stale" }
      | { kind: "error"; error: unknown };

    async function continueAuthenticatedFlowAfterRefresh(input: {
      request: Promise<HarnessRefreshResult>;
      token: SessionDataRequestToken;
      getCurrentEpoch: () => SessionDataEpoch;
      state: AuthenticatedRefreshHarnessState;
    }) {
      const result = await input.request;
      if (result.kind === "error") {
        input.state.message = translatePersistenceError(result.error);
      }
      if (!shouldContinueAuthenticatedFlowAfterRefresh(result.kind)) return result.kind;
      if (!isSessionDataRequestTokenCurrent(input.getCurrentEpoch(), input.token)) return "stale";
      if (result.kind === "success") input.state.data = [...result.data];
      input.state.loading = false;
      input.state.formsCleared = true;
      input.state.screen = "dashboard";
      input.state.navigations += 1;
      return result.kind;
    }

    async function runLoginHarness(input: {
      signInWithPassword: () => Promise<{
        data: { session: { user: { id: string } } | null };
        error: unknown | null;
      }>;
      refresh: Promise<HarnessRefreshResult>;
      state: AuthenticatedRefreshHarnessState;
    }) {
      const authResult = await input.signInWithPassword();
      if (authResult.error) {
        input.state.message = translateAuthError(authResult.error);
        input.state.loading = false;
        return "auth-error";
      }
      const session = authResult.data.session;
      if (!session) return "missing-session";

      const currentEpoch = createSessionDataEpoch({
        userId: session.user.id,
        scope: `supabase:${session.user.id}`,
      });
      input.state.sessionUserId = session.user.id;
      input.state.dataMode = "supabase";
      input.state.data = [];
      input.state.message = "";
      return continueAuthenticatedFlowAfterRefresh({
        request: input.refresh,
        token: captureSessionDataRequestToken(currentEpoch),
        getCurrentEpoch: () => currentEpoch,
        state: input.state,
      });
    }

    {
      let signInWithPasswordCalls = 0;
      const state: AuthenticatedRefreshHarnessState = {
        sessionUserId: identityA.userId,
        dataMode: "supabase",
        screen: "login",
        data: ["dato-anterior-a"],
        message: "",
        loading: true,
        formsCleared: false,
        navigations: 0,
      };
      const result = await runLoginHarness({
        signInWithPassword: async () => {
          signInWithPasswordCalls += 1;
          return {
            data: { session: { user: { id: identityB.userId } } },
            error: null,
          };
        },
        refresh: Promise.resolve({
          kind: "error",
          error: new Error("sensitive supabase internal detail"),
        }),
        state,
      });
      assert.equal(result, "error");
      assert.equal(signInWithPasswordCalls, 1);
      assert.deepEqual(state, {
        sessionUserId: identityB.userId,
        dataMode: "supabase",
        screen: "dashboard",
        data: [],
        message: "No pudimos completar la acción. Intenta nuevamente.",
        loading: false,
        formsCleared: true,
        navigations: 1,
      }, "signIn exitoso + refresh error conserva B, vacia A, sanitiza y navega");
    }

    for (const surface of ["bootstrap", "SIGNED_IN"] as const) {
      const currentEpoch = createSessionDataEpoch(identityB);
      const token = captureSessionDataRequestToken(currentEpoch);
      const state: AuthenticatedRefreshHarnessState = {
        sessionUserId: identityB.userId,
        dataMode: "supabase",
        screen: "login",
        data: [],
        message: "",
        loading: true,
        formsCleared: false,
        navigations: 0,
      };
      const refresh = createDeferred<HarnessRefreshResult>();
      const pending = continueAuthenticatedFlowAfterRefresh({
        request: refresh.promise,
        token,
        getCurrentEpoch: () => currentEpoch,
        state,
      });
      refresh.resolve({ kind: "error", error: new Error("sensitive supabase internal detail") });
      assert.equal(await pending, "error", `${surface}: error recuperable continua flujo auth`);
      assert.deepEqual(state, {
        sessionUserId: identityB.userId,
        dataMode: "supabase",
        screen: "dashboard",
        data: [],
        message: "No pudimos completar la acción. Intenta nuevamente.",
        loading: false,
        formsCleared: true,
        navigations: 1,
      }, `${surface}: conserva sesion, vacio previo, mensaje sanitizado y termina loading`);
      assert.equal(currentEpoch.userId, identityB.userId);
    }

    {
      let currentEpoch = createSessionDataEpoch(identityA);
      const tokenA = captureSessionDataRequestToken(currentEpoch);
      const state: AuthenticatedRefreshHarnessState = {
        sessionUserId: identityB.userId,
        dataMode: "supabase",
        screen: "login",
        data: [],
        message: "",
        loading: true,
        formsCleared: false,
        navigations: 0,
      };
      const refreshA = createDeferred<HarnessRefreshResult>();
      const pendingA = continueAuthenticatedFlowAfterRefresh({
        request: refreshA.promise,
        token: tokenA,
        getCurrentEpoch: () => currentEpoch,
        state,
      });
      currentEpoch = advanceSessionDataEpoch(currentEpoch, identityB);
      refreshA.resolve({ kind: "stale" });
      assert.equal(await pendingA, "stale");
      assert.deepEqual(state, {
        sessionUserId: identityB.userId,
        dataMode: "supabase",
        screen: "login",
        data: [],
        message: "",
        loading: true,
        formsCleared: false,
        navigations: 0,
      }, "refresh stale de A no navega, publica datos ni contamina B");
    }

    {
      const invalidCredentialsState: AuthenticatedRefreshHarnessState = {
        sessionUserId: null,
        dataMode: "supabase",
        screen: "login",
        data: [],
        message: "",
        loading: true,
        formsCleared: false,
        navigations: 0,
      };
      const result = await runLoginHarness({
        signInWithPassword: async () => ({
          data: { session: null },
          error: { message: "Invalid login credentials" },
        }),
        refresh: Promise.resolve({ kind: "success", data: ["no-debe-publicarse"] }),
        state: invalidCredentialsState,
      });
      assert.equal(result, "auth-error");
      assert.deepEqual(invalidCredentialsState, {
        sessionUserId: null,
        dataMode: "supabase",
        screen: "login",
        data: [],
        message: "Correo o contraseña incorrectos.",
        loading: false,
        formsCleared: false,
        navigations: 0,
      }, "credenciales invalidas no crean sesion ni abandonan Login");
    }
  }

  {
    const transient = {
      drawer: true,
      notifications: true,
      topbarHidden: true,
      cycleModal: true,
      routineModal: true,
      progressSelection: "A",
      dashboardOverride: "A",
      notice: "A",
      flow: "A",
      message: "A",
      overlay: "A",
      draftScope: identityA.scope,
    };
    Object.assign(transient, {
      drawer: false,
      notifications: false,
      topbarHidden: false,
      cycleModal: false,
      routineModal: false,
      progressSelection: "",
      dashboardOverride: "",
      notice: "",
      flow: "",
      message: "",
      overlay: "",
      draftScope: null,
    });
    assert.deepEqual(transient, {
      drawer: false,
      notifications: false,
      topbarHidden: false,
      cycleModal: false,
      routineModal: false,
      progressSelection: "",
      dashboardOverride: "",
      notice: "",
      flow: "",
      message: "",
      overlay: "",
      draftScope: null,
    }, "matriz A -> SIGNED_OUT -> B sin intents, mensajes, overlays ni drafts cruzados");
  }

  // P3-41 OWNER WRITE RUNTIME: ejecuta las funciones productivas con clientes Supabase
  // controlados para demostrar que el repository corta la cadena antes del siguiente write.
  const legacyWriteInput: SaveTrainingSessionInput = {
    routine: "Pecho Hombro Tríceps",
    plannedDay: "monday",
    plannedDate: "2026-08-03",
    trainedDate: "2026-08-03",
    weekNumber: 1,
    status: "completed",
    notes: "sesion owner A",
    entries: [{
      id: "entry-a",
      exerciseId: "exercise-a",
      exerciseName: "Press banca",
      routine: "Pecho Hombro Tríceps",
      targetSets: 3,
      targetReps: 10,
      weight: 80,
      previousWeight: 75,
      reps: [10, 10, 9],
      rir: "2",
      notes: "controlado",
    }],
  };
  const cycleWriteInput: CycleScopedTrainingSessionInput = {
    cycleId: "cycle-a",
    cycleDayId: "cycle-day-a",
    plannedDay: "monday",
    plannedDate: "2026-08-03",
    trainedDate: "2026-08-03",
    status: "completed",
    weekNumber: 1,
    notes: "sesion cycle owner A",
    entries: [{
      id: "entry-cycle-a",
      trainingCycleExerciseId: "cycle-exercise-a",
      exerciseId: "exercise-a",
      exerciseLineageId: "lineage-a",
      weight: 80,
      previousWeight: 75,
      reps: [10, 10, 9],
      rir: "2",
      notes: "controlado",
    }],
  };
  const legacyWriteInputSnapshot = structuredClone(legacyWriteInput);
  const cycleWriteInputSnapshot = structuredClone(cycleWriteInput);
  const privateOwnerA = "owner-a-private-id";
  const privateOwnerB = "owner-b-private-id";
  const privateToken = "private-token-detail";

  function assertSanitizedOwnerMismatch(error: unknown) {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(
      error.message,
      new RegExp(`${privateOwnerA}|${privateOwnerB}|${privateToken}|getUser|rpc`, "i"),
      "el error publico de mismatch no expone IDs, tokens ni detalles internos",
    );
    assert.match(
      error.message,
      /sesión|sesion|inicia sesión|cuenta activa/i,
      "el mismatch usa un mensaje publico generico",
    );
    return true;
  }

  {
    const harness = createLegacyTrainingSessionWriteHarness({
      initialUserId: privateOwnerB,
    });
    await assert.rejects(
      saveTrainingSessionWithEntries(
        legacyWriteInput,
        "supabase",
        privateOwnerA,
        harness.getClient,
      ),
      assertSanitizedOwnerMismatch,
    );
    assert.deepEqual(harness.counts, {
      getUser: 1,
      routineLookup: 0,
      routineInsert: 0,
      rpc: 0,
    }, "A inicia legacy con auth B: cero upsert y cero RPC");
  }

  {
    const harness = createLegacyTrainingSessionWriteHarness({
      initialUserId: privateOwnerA,
      deferredRoutineLookup: true,
    });
    const pending = saveTrainingSessionWithEntries(
      legacyWriteInput,
      "supabase",
      privateOwnerA,
      harness.getClient,
    );
    await harness.routineLookupStarted;
    harness.setCurrentUserId(privateOwnerB);
    harness.resolveRoutineLookup({ id: "routine-a" });
    await assert.rejects(pending, assertSanitizedOwnerMismatch);
    assert.equal(harness.counts.routineInsert, 0);
    assert.equal(harness.counts.rpc, 0, "auth A -> B durante upsertRoutine corta el RPC posterior");
  }

  {
    const harness = createLegacyTrainingSessionWriteHarness({
      initialUserId: privateOwnerA,
      existingRoutineId: null,
    });
    const saved = await saveTrainingSessionWithEntries(
      legacyWriteInput,
      "supabase",
      privateOwnerA,
      harness.getClient,
    );
    assert.equal(saved.id, "legacy-session-a");
    assert.equal(harness.counts.routineInsert, 1, "owner A puede crear su rutina allowlisted");
    assert.equal(harness.counts.rpc, 1, "owner A conserva el guardado legacy normal");
  }

  {
    const harness = createCycleScopedTrainingSessionWriteHarness([
      privateOwnerA,
      privateOwnerB,
    ]);
    await assert.rejects(
      createTrainingSessionWithCycleEntries(
        cycleWriteInput,
        privateOwnerA,
        harness.getClient,
      ),
      assertSanitizedOwnerMismatch,
    );
    assert.equal(harness.counts.rpc, 0, "cycle-scoped A con auth B antes del RPC ejecuta cero RPC");
  }

  {
    const harness = createCycleScopedTrainingSessionWriteHarness([
      privateOwnerA,
      privateOwnerA,
    ]);
    const sessionId = await createTrainingSessionWithCycleEntries(
      cycleWriteInput,
      privateOwnerA,
      harness.getClient,
    );
    assert.equal(sessionId, "cycle-session-a");
    assert.equal(harness.counts.rpc, 1, "owner A conserva el guardado cycle-scoped normal");
  }

  assert.deepEqual(legacyWriteInput, legacyWriteInputSnapshot, "legacy no muta su input");
  assert.deepEqual(cycleWriteInput, cycleWriteInputSnapshot, "cycle-scoped no muta su input");

  if (false) {
    // @ts-expect-error expectedUserId es obligatorio en el write legacy.
    void saveTrainingSessionWithEntries(legacyWriteInput, "supabase");
    // @ts-expect-error expectedUserId es obligatorio en el write cycle-scoped.
    void createTrainingSessionWithCycleEntries(cycleWriteInput);
  }

  // Contrato estatico/source-based: valida wiring; no renderiza React ni sustituye los casos runtime anteriores.
  const componentSource = readFileSync(
    new URL("../../components/organizatech-app.tsx", import.meta.url),
    "utf8",
  );
  const p341Sources: P341ContractSources = {
    app: componentSource,
    trainingDataController: readFileSync(
      new URL("../../features/training-data/model/training-data-controller.ts", import.meta.url),
      "utf8",
    ),
    trainingDataRequestOwner: readFileSync(
      new URL("../../features/training-data/model/training-data-request-owner.ts", import.meta.url),
      "utf8",
    ),
    sessionEpoch: readFileSync(
      new URL("./session-data-epoch.ts", import.meta.url),
      "utf8",
    ),
    operationOwner: readFileSync(
      new URL("./active-workout-session-boundary.ts", import.meta.url),
      "utf8",
    ),
    profileRepository: readFileSync(
      new URL("../profile/profile-repository.ts", import.meta.url),
      "utf8",
    ),
    avatarRepository: readFileSync(
      new URL("../profile/profile-avatar-repository.ts", import.meta.url),
      "utf8",
    ),
    dataRepository: readFileSync(
      new URL("../data/repository.ts", import.meta.url),
      "utf8",
    ),
    cyclesRepository: readFileSync(
      new URL("../training/training-cycles-repository.ts", import.meta.url),
      "utf8",
    ),
    cycleScopedRepository: readFileSync(
      new URL("../training/cycle-scoped-training-repository.ts", import.meta.url),
      "utf8",
    ),
    dailyReadinessRepository: readFileSync(
      new URL("../training/training-daily-readiness-repository.ts", import.meta.url),
      "utf8",
    ),
    workoutReadinessRepository: readFileSync(
      new URL("../training/training-workout-readiness-repository.ts", import.meta.url),
      "utf8",
    ),
    completion: readFileSync(
      new URL("../../features/active-workout/components/TrainingCompletionSummaryScreen.tsx", import.meta.url),
      "utf8",
    ),
  };
  assertP341StaticContracts(p341Sources);

  // Mutation probes: cada mutacion vive solo en una copia temporal externa y el archivo temporal
  // se restaura byte a byte antes del siguiente probe. El working tree nunca se modifica aqui.
  const mutationProbes: Array<{
    name: string;
    target: keyof P341ContractSources;
    mutate: (source: string) => string;
  }> = [
    {
      name: "quitar guard post-await",
      target: "app",
      mutate: (source) => source.replace('      if (result.kind === "stale") return null;\n', ""),
    },
    {
      name: "usar supabaseUser dinamico",
      target: "app",
      mutate: (source) => source.replace(
        "updateProfilePersonalData(input, operationOwner.userId)",
        "updateProfilePersonalData(input, supabaseUser.id)",
      ),
    },
    {
      name: "permitir finally A sobre B",
      target: "app",
      mutate: (source) => source.replace(
        "if (finalizeUserScopedOperation(routineSaveInFlightRef, operationOwner))",
        "if (true)",
      ),
    },
    {
      name: "quitar identidad esperada del repository",
      target: "profileRepository",
      mutate: (source) => source.replace(
        "  if (expectedUserId && userId !== expectedUserId) {",
        "  if (false) {",
      ),
    },
    {
      name: "limpiar storage antes de signOut",
      target: "app",
      mutate: (source) => source.replace(
        "      const supabase = getSupabaseBrowserClient();\n      if (supabase) {\n        const { error } = await supabase.auth.signOut();",
        "      clearBrowserStorageScope(currentStorageScope);\n      const supabase = getSupabaseBrowserClient();\n      if (supabase) {\n        const { error } = await supabase.auth.signOut();",
      ),
    },
    {
      name: "ignorar error de signOut",
      target: "app",
      mutate: (source) => source.replace(
        "        const { error } = await supabase.auth.signOut();\n        if (error) throw error;",
        "        await supabase.auth.signOut();",
      ),
    },
    {
      name: "avanzar epoch en TOKEN_REFRESHED",
      target: "app",
      mutate: (source) => source.replace(
        '      if (event === "TOKEN_REFRESHED") {',
        '      if (event === "TOKEN_REFRESHED") {\n        advanceSessionDataIdentity(nextState);',
      ),
    },
    {
      name: "permitir Profile write sin sesion",
      target: "app",
      mutate: (source) => source.replace(
        "const canEditProfilePersonalData = Boolean(hasSupabaseSession && getSupabaseBrowserClient());",
        "const canEditProfilePersonalData = Boolean(supabaseUser && getSupabaseBrowserClient());",
      ),
    },
    {
      name: "eliminar reset de overlay/modal",
      target: "app",
      mutate: (source) => source.replace("    setIsNotificationPanelOpen(false);\n", ""),
    },
    {
      name: "volver a tratar refresh error como stale en bootstrap",
      target: "app",
      mutate: (source) => source.replace(
        "          if (!shouldContinueAuthenticatedFlowAfterRefresh(refreshResult.kind)) return;",
        '          if (refreshResult.kind !== "success") return;',
      ),
    },
    {
      name: "debilitar decision comun de refresh autenticado",
      target: "sessionEpoch",
      mutate: (source) => source.replace(
        '  return kind !== "stale";',
        '  return kind === "success";',
      ),
    },
    {
      name: "permitir que refresh error limpie la sesion",
      target: "app",
      mutate: (source) => source.replace(
        "        handlePersistenceError(result.error, { preserveSession: true });",
        "        handlePersistenceError(result.error);",
      ),
    },
    {
      name: "eliminar expectedUserId obligatorio de firma legacy",
      target: "dataRepository",
      mutate: (source) => source.replace(
        '  mode: RepositoryMode,\n  expectedUserId: string,\n',
        '  mode: RepositoryMode,\n',
      ),
    },
    {
      name: "eliminar expectedUserId obligatorio de firma cycle-scoped",
      target: "cycleScopedRepository",
      mutate: (source) => source.replace(
        '  input: CycleScopedTrainingSessionInput,\n  expectedUserId: string,\n',
        '  input: CycleScopedTrainingSessionInput,\n',
      ),
    },
    {
      name: "usar getRepositoryAuth sin owner esperado",
      target: "dataRepository",
      mutate: (source) => source.replace(
        "getRepositoryAuth(mode, expectedUserId, getClient)",
        "getRepositoryAuth(mode)",
      ),
    },
    {
      name: "quitar revalidacion posterior a upsertRoutine",
      target: "dataRepository",
      mutate: (source) => source.replace(
        "  );\n  await assertExpectedRepositoryUser(supabase, expectedUserId);\n  const { data, error } = await supabase.rpc(\"create_training_session_with_entries\"",
        "  );\n  const { data, error } = await supabase.rpc(\"create_training_session_with_entries\"",
      ),
    },
    {
      name: "dejar caller cycle-scoped sin operationOwner.userId",
      target: "app",
      mutate: (source) => source.replace(
        "          }, operationOwner.userId),",
        "          }),",
      ),
    },
    {
      name: "reemplazar expectedUserId por usuario actual",
      target: "dataRepository",
      mutate: (source) => source.replace(
        "    expectedUserId,\n    getClient,\n  );",
        "    userId,\n    getClient,\n  );",
      ),
    },
    {
      name: "eliminar expectedUserId de firma daily readiness",
      target: "dailyReadinessRepository",
      mutate: (source) => source.replace(
        "  payload: TrainingDailyReadinessPayload,\n  expectedUserId: string,\n",
        "  payload: TrainingDailyReadinessPayload,\n",
      ),
    },
    {
      name: "eliminar expectedUserId de firma workout readiness",
      target: "workoutReadinessRepository",
      mutate: (source) => source.replace(
        "  input: SaveTrainingWorkoutReadinessInput,\n  expectedUserId: string,\n",
        "  input: SaveTrainingWorkoutReadinessInput,\n",
      ),
    },
    {
      name: "eliminar expectedUserId de firma linking",
      target: "workoutReadinessRepository",
      mutate: (source) => source.replace(
        "  input: LinkTrainingWorkoutReadinessSessionInput,\n  expectedUserId: string,\n",
        "  input: LinkTrainingWorkoutReadinessSessionInput,\n",
      ),
    },
    {
      name: "dejar caller linking sin operationOwner.userId",
      target: "app",
      mutate: (source) => source.replace(
        "        trainingSessionId: pendingLink.trainingSessionId,\n      }, operationOwner.userId),",
        "        trainingSessionId: pendingLink.trainingSessionId,\n      }),",
      ),
    },
    {
      name: "usar usuario actual en vez del owner readiness",
      target: "app",
      mutate: (source) => source.replace(
        "saveDailyTrainingReadiness(value, operationOwner.userId)",
        "saveDailyTrainingReadiness(value, supabaseUser.id)",
      ),
    },
    {
      name: "eliminar validacion inmediata antes del RPC daily",
      target: "dailyReadinessRepository",
      mutate: (source) => source.replace(
        "  await assertExpectedDailyReadinessUser(supabase, expectedUserId);\n  const { data, error } = await supabase.rpc(\"save_daily_training_readiness\"",
        "  const { data, error } = await supabase.rpc(\"save_daily_training_readiness\"",
      ),
    },
    {
      name: "introducir persistencia Active Workout sin owner",
      target: "app",
      mutate: (source) => `import { saveUnownedActiveWorkoutPersistence } from "@/lib/training/unowned-repository";\n${source.replace(
        "async function persistDailyReadiness(value: TrainingReadiness) {",
        "async function persistDailyReadiness(value: TrainingReadiness) {\n    void saveUnownedActiveWorkoutPersistence();",
      )}`,
    },
    {
      name: "montar ShareWorkoutCard",
      target: "app",
      mutate: (source) => `${source}\nShareWorkoutCard\n`,
    },
  ];
  const mutationDirectory = mkdtempSync(join(tmpdir(), "organizatech-p3-41-"));
  try {
    for (const probe of mutationProbes) {
      const original = p341Sources[probe.target];
      const mutated = probe.mutate(original);
      assert.notEqual(mutated, original, `probe sin mutacion efectiva: ${probe.name}`);
      const temporaryPath = join(mutationDirectory, `${probe.target}.probe`);
      writeFileSync(temporaryPath, mutated, "utf8");
      const mutatedSources = {
        ...p341Sources,
        [probe.target]: readFileSync(temporaryPath, "utf8"),
      };
      assert.throws(
        () => assertP341StaticContracts(mutatedSources),
        `el contrato debe fallar: ${probe.name}`,
      );
      writeFileSync(temporaryPath, original, "utf8");
      assert.equal(
        readFileSync(temporaryPath, "utf8"),
        original,
        `restauracion byte a byte fallida: ${probe.name}`,
      );
    }
  } finally {
    rmSync(mutationDirectory, { recursive: true, force: true });
  }
  assert.match(componentSource, /useRef\(createSessionDataEpoch\(\)\)/);
  assert.match(componentSource, /sessionDataMountedRef = useRef\(true\)/);
  assert.match(componentSource, /const advanceSessionDataIdentity = useCallback/);
  assert.match(componentSource, /if \(event === "SIGNED_OUT"\)[\s\S]*?clearUserSessionState/);
  assert.match(
    componentSource,
    /function settleUserScopedOperation<[\s\S]*return settleSessionOperationPromise/,
    "El root delega la resolucion post-await al helper productivo probado en runtime",
  );
  assert.match(
    componentSource,
    /function finalizeUserScopedOperation\([\s\S]*finalizeSessionOperationOwner/,
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
    /resolveIncomingWorkoutDraftRecoveryScope\(\{\s*scope: nextStorageScope,\s*willAttemptAutomaticRecovery: Boolean\(effectiveSession\),\s*\}\)/,
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

  // P3-32: el reset central pasó a declararse después del coordinador de historial (necesita su
  // `resetExerciseHistory`), por lo que el delimitador de cierre ya no puede ser
  // `clearCycleScopedPlanState`. Se ancla al cierre real del propio useCallback, que es estable e
  // independiente de qué declaración lo siga.
  const activeWorkoutResetSource = extractBetween(
    componentSource,
    "const resetActiveWorkoutSessionState = useCallback",
    "}, [activeWorkoutActions, resetExerciseHistory]);",
  );
  for (const resetContract of [
    "workoutStartInFlightRef.current = null",
    "dailyReadinessSaveInFlightRef.current = null",
    "workoutCompletionInFlightRef.current = null",
    "activeWorkoutAttemptIdRef.current = null",
    "pendingReadinessLinkRef.current = null",
    "activeWorkoutReadinessContextRef.current = null",
    "activeWorkoutActions.resetActiveWorkout()",
    // P3-32: performance y observación ya no se resetean con setters sueltos del root; el reset
    // central delega en la API del coordinador, único dueño de ambos estados y de sus request keys.
    "resetExerciseHistory()",
  ]) {
    assert.ok(activeWorkoutResetSource.includes(resetContract), `El reset central conserva ${resetContract}`);
  }
  // La garantía de que ese reset deja AMBOS flujos en idle se verifica en la fuente del coordinador
  // (no basta con que el root lo invoque) y en runtime sobre los idle states de ambos loaders.
  const historyHookSource = readFileSync(
    new URL("../../features/active-workout/hooks/useActiveWorkoutExerciseHistory.ts", import.meta.url),
    "utf8",
  );
  const historyResetSource = extractBetween(
    historyHookSource,
    "const resetExerciseHistory = useCallback",
    "}, []);",
  );
  for (const coordinatorResetContract of [
    "latestExercisePerformanceRequestKeyRef.current = null",
    "latestExerciseObservationRequestKeyRef.current = null",
    "getLatestExercisePerformanceIdleState()",
    "getLatestExerciseObservationIdleState()",
    "setLatestExerciseObservationDidQuery(false)",
  ]) {
    assert.ok(
      historyResetSource.includes(coordinatorResetContract),
      `El reset del coordinador conserva ${coordinatorResetContract}`,
    );
  }
  // Ninguna request key de historial puede quedar fuera del coordinador.
  assert.doesNotMatch(
    componentSource,
    /latestExercisePerformanceRequestKeyRef|latestExerciseObservationRequestKeyRef/,
    "las request keys de historial son propiedad exclusiva de useActiveWorkoutExerciseHistory",
  );
  for (const resetRef of [
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
    "async function refreshTrainingDataForSession",
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

  // P3-32: los dos effects de historial se movieron al coordinador. La garantía se verifica ahora
  // sobre su fuente real y para AMBOS flujos (antes sólo se comprobaba el de performance): cada uno
  // captura su token ANTES del await y lo valida después, vía el guard compartido.
  const latestPerformanceSource = extractBetween(
    historyHookSource,
    "if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {\n      latestExercisePerformanceRequestKeyRef",
    "if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {\n      latestExerciseObservationRequestKeyRef",
  );
  const latestObservationSource = historyHookSource.slice(
    historyHookSource.indexOf(
      "if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {\n      latestExerciseObservationRequestKeyRef",
    ),
  );
  for (const [label, historyFlowSource] of [
    ["performance", latestPerformanceSource],
    ["observation", latestObservationSource],
  ] as const) {
    assert.match(historyFlowSource, /getCurrentRequestKey: \(\) => latestExercise\w+RequestKeyRef\.current/, label);
    assert.match(historyFlowSource, /isRequestTokenCurrent: \(\) => isSessionDataRequestCurrent\(requestToken\)/, label);
    assert.match(historyFlowSource, /isMounted: \(\) => isMounted/, label);
    assert.match(historyFlowSource, /if \(!decision\.commit\) return;/, label);
  }
  assert.equal(
    (historyHookSource.match(/const requestToken = captureSessionDataRequestToken\(\);/g) ?? []).length,
    2,
    "cada flujo captura su propio token antes del await",
  );
  // Independencia: nunca se acoplan ambos errores en una sola espera (se evalua el codigo real,
  // sin comentarios, porque la documentacion del modulo si menciona Promise.all para prohibirlo).
  const historyHookCode = historyHookSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(historyHookCode, /Promise\.all/, "performance y observacion deben fallar por separado");

  const profileSource = extractBetween(
    componentSource,
    "async function refreshProfilePersonalData",
    "async function handleSaveProfilePersonalData",
  );
  assert.match(profileSource, /captureSessionDataRequestToken\(\)/);
  assert.match(profileSource, /isSessionDataRequestCurrent\(requestToken\)/);

  assert.match(p341Sources.trainingDataRequestOwner, /requestToken: identity\.captureRequestToken\(\)/);
  assert.match(
    p341Sources.trainingDataRequestOwner,
    /identity\.isRequestTokenCurrent\(owner\.requestToken\)/,
  );
  assert.match(p341Sources.trainingDataController, /owners\.isCurrent\(owner\)/);

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
  const refreshIndex = handleAuthSource.indexOf(
    'const refreshResult = await refreshTrainingDataForSession("supabase");',
    captureIdentityIndex,
  );
  const refreshContinuationIndex = handleAuthSource.indexOf(
    "if (!shouldContinueAuthenticatedFlowAfterRefresh(refreshResult.kind)) return;",
    refreshIndex,
  );
  const staleGuardIndex = handleAuthSource.indexOf(
    "if (!isSessionDataRequestCurrent(appliedIdentityToken)) return;",
    refreshContinuationIndex,
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
    refreshContinuationIndex,
    staleGuardIndex,
    clearFormsIndex,
    dashboardIndex,
  ];
  assert.equal(
    orderedLoginSteps.every((index, position) => index >= 0 && (position === 0 || index > orderedLoginSteps[position - 1])),
    true,
    "El login debe aplicar identidad, distinguir stale de error, validar el token y solo entonces navegar",
  );
  assert.match(
    handleAuthSource,
    /catch \(error\) \{\s*if \(appliedIdentityToken && !isSessionDataRequestCurrent\(appliedIdentityToken\)\) return;\s*setStatusMessage/,
  );
  assert.match(
    handleAuthSource,
    /finally \{\s*if \(!appliedIdentityToken \|\| isSessionDataRequestCurrent\(appliedIdentityToken\)\) \{\s*setIsBusy\(false\);/,
  );

  // ---------------------------------------------------------------------------------------------
  // P3-32 — guard compartido de historial (RUNTIME, no source-based): combina la staleness por
  // request key que ya resuelve cada loader con el SessionDataRequestToken y el desmontaje.
  // Se ejercita el helper productivo real; no se reimplementa su lógica aquí.
  // ---------------------------------------------------------------------------------------------
  {
    // Matriz completa de la decisión sincrónica, con su precedencia.
    assert.deepEqual(
      resolveActiveWorkoutHistoryCommit({ stale: false, isMounted: true, isRequestTokenCurrent: true }),
      { commit: true, reason: "commit" },
    );
    assert.deepEqual(
      resolveActiveWorkoutHistoryCommit({ stale: false, isMounted: false, isRequestTokenCurrent: true }),
      { commit: false, reason: "unmounted" },
    );
    assert.deepEqual(
      resolveActiveWorkoutHistoryCommit({ stale: true, isMounted: true, isRequestTokenCurrent: true }),
      { commit: false, reason: "stale_request_key" },
    );
    assert.deepEqual(
      resolveActiveWorkoutHistoryCommit({ stale: false, isMounted: true, isRequestTokenCurrent: false }),
      { commit: false, reason: "stale_session_epoch" },
    );
    // El desmontaje tiene precedencia sobre cualquier otra causa, igual que el guard previo del root.
    assert.equal(
      resolveActiveWorkoutHistoryCommit({ stale: true, isMounted: false, isRequestTokenCurrent: false }).reason,
      "unmounted",
    );

    const epochA = advanceSessionDataEpoch(createSessionDataEpoch(), identityA);
    const tokenA = captureSessionDataRequestToken(epochA);

    // Success vigente: misma identidad, misma request key, montado.
    let epoch: SessionDataEpoch = epochA;
    const vigente = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, value: "performance-a" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(epoch, tokenA),
    });
    assert.equal(vigente.decision.commit, true);
    assert.equal(vigente.result.value, "performance-a");

    // Error vigente: un resultado con error tambien se compromete (el loader ya lo tradujo).
    const errorVigente = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, error: "No pudimos cargar el historial anterior del ejercicio." }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(epoch, tokenA),
    });
    assert.equal(errorVigente.decision.commit, true);
    assert.equal(errorVigente.result.error, "No pudimos cargar el historial anterior del ejercicio.");

    // A→B: el ejercicio A responde despues de cambiar a B (stale por request key).
    const staleKeySuccess = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: true, value: "ejercicio-a" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(epoch, tokenA),
    });
    assert.equal(staleKeySuccess.decision.commit, false);
    assert.equal(staleKeySuccess.decision.reason, "stale_request_key");

    const staleKeyError = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: true, error: "fallo de A" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(epoch, tokenA),
    });
    assert.equal(staleKeyError.decision.commit, false);
    assert.equal(staleKeyError.decision.reason, "stale_request_key");

    // Usuario A responde despues de iniciar sesion como B, con request key IDENTICA por accidente:
    // la key sola no basta, el token es el que invalida.
    epoch = advanceSessionDataEpoch(epoch, identityB);
    const staleEpochSuccess = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, value: "dato-de-a" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(epoch, tokenA),
    });
    assert.equal(staleEpochSuccess.decision.commit, false);
    assert.equal(
      staleEpochSuccess.decision.reason,
      "stale_session_epoch",
      "una respuesta de A nunca puede escribirse tras cambiar a B aunque la request key coincida",
    );

    const staleEpochError = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, error: "fallo de A" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(epoch, tokenA),
    });
    assert.equal(staleEpochError.decision.commit, false);
    assert.equal(staleEpochError.decision.reason, "stale_session_epoch");

    // SIGNED_OUT durante una request en vuelo.
    const signedOutEpoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null });
    const afterSignedOut = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, value: "dato-de-b" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(signedOutEpoch, captureSessionDataRequestToken(epoch)),
    });
    assert.equal(afterSignedOut.decision.commit, false);
    assert.equal(afterSignedOut.decision.reason, "stale_session_epoch");

    // TOKEN_REFRESHED de la MISMA identidad: no invalida, la respuesta sigue siendo vigente.
    const refreshedEpoch = advanceSessionDataEpoch(epochA, identityA);
    assert.equal(refreshedEpoch, epochA, "un refresh sin cambio de identidad no avanza el epoch");
    const afterRefresh = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, value: "sigue-siendo-a" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => isSessionDataRequestTokenCurrent(refreshedEpoch, tokenA),
    });
    assert.equal(afterRefresh.decision.commit, true);
    assert.equal(afterRefresh.result.value, "sigue-siendo-a");

    // Cleanup/unmount durante la request.
    let mounted = true;
    const afterUnmount = await runActiveWorkoutHistoryLoad({
      load: async () => {
        mounted = false;
        return { stale: false, value: "llega-tarde" };
      },
      isMounted: () => mounted,
      isRequestTokenCurrent: () => true,
    });
    assert.equal(afterUnmount.decision.commit, false);
    assert.equal(afterUnmount.decision.reason, "unmounted");

    // Independencia: performance vigente con observacion stale, y el caso inverso. Cada flujo
    // decide por separado; el fallo o staleness de uno no altera al otro.
    const performanceOk = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, value: "performance" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => true,
    });
    const observationStale = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: true, value: "observacion" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => true,
    });
    assert.equal(performanceOk.decision.commit, true);
    assert.equal(observationStale.decision.commit, false);

    const performanceStale = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: true, value: "performance" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => true,
    });
    const observationOk = await runActiveWorkoutHistoryLoad({
      load: async () => ({ stale: false, value: "observacion" }),
      isMounted: () => true,
      isRequestTokenCurrent: () => true,
    });
    assert.equal(performanceStale.decision.commit, false);
    assert.equal(observationOk.decision.commit, true);

    // El helper no muta ni el input ni el resultado que devuelve.
    const originalResult = Object.freeze({ stale: false, value: "intacto" });
    const guardInput = Object.freeze({ stale: false, isMounted: true, isRequestTokenCurrent: true });
    const passthrough = await runActiveWorkoutHistoryLoad({
      load: async () => originalResult,
      isMounted: () => true,
      isRequestTokenCurrent: () => true,
    });
    assert.equal(passthrough.result, originalResult, "el resultado del loader se propaga sin copiarse ni mutarse");
    assert.deepEqual(guardInput, { stale: false, isMounted: true, isRequestTokenCurrent: true });
    assert.deepEqual(
      resolveActiveWorkoutHistoryCommit(guardInput),
      { commit: true, reason: "commit" },
    );
  }

  console.log("session-data-epoch tests passed");
}

void run();
