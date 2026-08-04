import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
const boundary = readFileSync("src/features/active-workout/hooks/useActiveWorkoutBoundary.ts", "utf8");
const contract = readFileSync("src/features/active-workout/model/active-workout-boundary-contract.ts", "utf8");
const draftStorage = readFileSync("src/lib/training/workout-draft-storage.ts", "utf8");
const navigationModel = readFileSync("src/features/app-shell/model/app-navigation-controller-state.ts", "utf8");
const navigationHook = readFileSync("src/features/app-shell/hooks/useAppNavigationController.ts", "utf8");
const navigationDomain = readFileSync("src/lib/navigation/app-navigation.ts", "utf8");
const shellModel = readFileSync("src/features/app-shell/model/app-shell-controller-state.ts", "utf8");
const operationEngine = readFileSync("src/features/active-workout/model/active-workout-operation-engine.ts", "utf8");

for (const ref of [
  "activeWorkoutAttemptIdRef",
  "pendingReadinessLinkRef",
  "activeWorkoutReadinessContextRef",
  "incomingWorkoutDraftRecoveryScopeRef",
  "workoutStartInFlightRef",
  "dailyReadinessSaveInFlightRef",
  "workoutCompletionInFlightRef",
]) {
  assert.doesNotMatch(root, new RegExp(`\\b${ref}\\b`), `${ref} salió del composition root`);
}

assert.match(boundary, /startOwnerRef/);
assert.match(boundary, /readinessOwnerRef/);
assert.match(boundary, /completionOwnerRef/);
assert.match(operationEngine, /tryAcquireSessionOperationOwner/);
assert.match(operationEngine, /settleSessionOperationPromise/);
assert.match(operationEngine, /finalizeSessionOperationOwner/);
assert.match(boundary, /invalidateSessionOperationOwners/);
assert.match(boundary, /useEffect\(\(\) => \(\) => \{\s*invalidateOperations\(\)/, "unmount invalida owners pendientes");
assert.match(boundary, /replaceRuntimeSnapshot\(EMPTY_RUNTIME\)/);
assert.match(contract, /start\(\): Promise/);
assert.match(contract, /submitReadiness\(value:/);
assert.match(contract, /skipReadiness\(\): Promise/);
assert.match(contract, /pause\(\): void/);
assert.match(contract, /resumeOrRestore\(\): ActiveWorkoutReentryResult/);
assert.match(contract, /complete\(\): Promise/);
assert.match(contract, /discard\(\): void/);
assert.match(contract, /resetForIdentity/);

assert.doesNotMatch(draftStorage, /const draft = \{\s*\.\.\.parsed/);
assert.match(draftStorage, /Reconstruct the persisted record by allowlist/);
assert.doesNotMatch(root, /setEntries|setTrainingSessions|setCycleScoped/);
assert.match(root, /trainingDataController\.appendLegacySession/);
assert.match(root, /trainingDataController\.reloadCycleSessions/);
assert.doesNotMatch(root, /ShareWorkoutCard|workout-share/);
assert.doesNotMatch(root, /activeOverlayOwners/);

interface P343MutationSources {
  root: string;
  navigationModel: string;
  navigationHook: string;
  navigationDomain: string;
  shellModel: string;
  boundary: string;
  operationEngine: string;
  draftStorage: string;
}

function assertP343MutationContracts(sources: P343MutationSources) {
  assert.doesNotMatch(sources.root, /\bsetScreen(?:History)?\b/);
  assert.match(
    sources.navigationModel,
    /historyPolicy === "reset"[\s\S]*history: \[\][\s\S]*history: \[\.\.\.current\.history\]/,
  );
  assert.match(
    sources.navigationHook,
    /applyActiveWorkoutReentry\(ports\.tryRestoreActiveWorkout\(\), \{[\s\S]*resetToWorkout: \(\) => reset\("entrenamiento"\),[\s\S]*closeMenu: ports\.closeMenu/,
  );
  assert.match(sources.navigationHook, /if \(reenterActiveWorkout\(ports\)\) return decision/);
  assert.match(
    sources.navigationDomain,
    /current\.screen === "entrenamiento" && hasReadiness[\s\S]*resetContextualNavigation\("dashboard"\)[\s\S]*pauseTraining: true/,
  );
  assert.match(sources.root, /function openRoutineDay[\s\S]*navigation\.reenterActiveWorkout\(\{/);
  const menuToggleBlock = sources.shellModel.slice(
    sources.shellModel.indexOf('case "menu_toggled":'),
    sources.shellModel.indexOf('case "menu_closed":'),
  );
  const notificationsToggleBlock = sources.shellModel.slice(
    sources.shellModel.indexOf('case "notifications_toggled":'),
    sources.shellModel.indexOf('case "notifications_closed":'),
  );
  assert.match(menuToggleBlock, /isNotificationPanelOpen: false/);
  assert.match(notificationsToggleBlock, /isMenuOpen: false/);
  for (const owner of ["startOwnerRef", "readinessOwnerRef", "completionOwnerRef"]) {
    assert.match(sources.boundary, new RegExp(`const ${owner}`));
  }
  assert.match(
    sources.operationEngine,
    /tryAcquireSessionOperationOwner\(\s*ownerLock\.current,[\s\S]*const isCurrent = \(\) => isSessionOperationOwnerCurrent/,
  );
  assert.match(sources.operationEngine, /settleSessionOperationPromise/);
  assert.match(sources.boundary, /invalidateOperations\(\);[\s\S]*replaceRuntimeSnapshot\(EMPTY_RUNTIME\);[\s\S]*resetHistory\(\)/);
  assert.doesNotMatch(sources.root, /setEntries|setTrainingSessions|setCycleScoped/);
  assert.doesNotMatch(sources.root, /ShareWorkoutCard|workout-share|activeOverlayOwners/);
  assert.doesNotMatch(sources.draftStorage, /const draft = \{\s*\.\.\.parsed/);
}

const mutationSources: P343MutationSources = {
  root,
  navigationModel,
  navigationHook,
  navigationDomain,
  shellModel,
  boundary,
  operationEngine,
  draftStorage,
};
assertP343MutationContracts(mutationSources);

const mutationProbes: Array<{
  name: string;
  target: keyof P343MutationSources;
  mutate(source: string): string;
}> = [
  {
    name: "agregar segundo writer de screen en el root",
    target: "root",
    mutate: (source) => `${source}\nconst setScreen = () => undefined;\n`,
  },
  {
    name: "preserve reemplazado por reset de historial",
    target: "navigationModel",
    mutate: (source) => source.replace(
      "return { screen: transition.screen, history: [...current.history] };",
      "return { screen: transition.screen, history: [] };",
    ),
  },
  {
    name: "Drawer deja NotificationPanel abierto",
    target: "shellModel",
    mutate: (source) => source.replace(
      "isNotificationPanelOpen: false,\n      };",
      "isNotificationPanelOpen: state.isNotificationPanelOpen,\n      };",
    ),
  },
  {
    name: "eliminar owner de completion",
    target: "boundary",
    mutate: (source) => source.replace(
      "  const completionOwnerRef = useRef<SessionOperationOwner | null>(null);\n",
      "",
    ),
  },
  {
    name: "eliminar settlement stale del engine",
    target: "operationEngine",
    mutate: (source) => source.replaceAll("settleSessionOperationPromise", "settleWithoutOwner"),
  },
  {
    name: "owner de completion aparece siempre libre",
    target: "operationEngine",
    mutate: (source) => source.replace(
      "    ownerLock.current,\n    input.identity.captureRequestToken(),",
      "    null,\n    input.identity.captureRequestToken(),",
    ),
  },
  {
    name: "isCurrent retorna siempre true",
    target: "operationEngine",
    mutate: (source) => source.replace(
      "const isCurrent = () => isSessionOperationOwnerCurrent({",
      "const isCurrent = () => true || isSessionOperationOwnerCurrent({",
    ),
  },
  {
    name: "navigation reset conserva historial",
    target: "navigationModel",
    mutate: (source) => source.replace(
      "return { screen: transition.screen, history: [] };",
      "return { screen: transition.screen, history: [...current.history] };",
    ),
  },
  {
    name: "back con pausa conserva historial",
    target: "navigationDomain",
    mutate: (source) => source.replace(
      "createBackDecision(\"pause-active-workout\", resetContextualNavigation(\"dashboard\"),",
      "createBackDecision(\"pause-active-workout\", { screen: \"dashboard\", history: [...current.history] },",
    ),
  },
  {
    name: "restore-draft deja de navegar a entrenamiento",
    target: "navigationHook",
    mutate: (source) => source.replace(
      "      resetToWorkout: () => reset(\"entrenamiento\"),",
      "      resetToWorkout: () => undefined,",
    ),
  },
  {
    name: "restore-draft deja de cerrar el menu",
    target: "navigationHook",
    mutate: (source) => source.replace(
      "      closeMenu: ports.closeMenu,",
      "      closeMenu: () => undefined,",
    ),
  },
  {
    name: "omitir reset de refs runtime",
    target: "boundary",
    mutate: (source) => source.replaceAll("replaceRuntimeSnapshot(EMPTY_RUNTIME);", ""),
  },
  {
    name: "agregar setter paralelo P3-42",
    target: "root",
    mutate: (source) => `${source}\nsetTrainingSessions([]);\n`,
  },
  {
    name: "aceptar claves desconocidas del draft",
    target: "draftStorage",
    mutate: (source) => source.replace("const draft = {", "const draft = {\n      ...parsed,"),
  },
  {
    name: "conectar workout-share",
    target: "root",
    mutate: (source) => `${source}\nShareWorkoutCard\nworkout-share\n`,
  },
  {
    name: "duplicar overlay stack",
    target: "root",
    mutate: (source) => `${source}\nconst activeOverlayOwners = [];\n`,
  },
];

const mutationDirectory = mkdtempSync(join(tmpdir(), "organizatech-p3-43-"));
try {
  for (const probe of mutationProbes) {
    const original = mutationSources[probe.target];
    const mutated = probe.mutate(original);
    assert.notEqual(mutated, original, `probe sin mutacion efectiva: ${probe.name}`);
    const temporaryPath = join(mutationDirectory, `${probe.target}.probe`);
    writeFileSync(temporaryPath, mutated, "utf8");
    assert.throws(
      () => assertP343MutationContracts({
        ...mutationSources,
        [probe.target]: readFileSync(temporaryPath, "utf8"),
      }),
      `el contrato debe matar la mutacion: ${probe.name}`,
    );
  }
  console.log(`P3-43 mutation probes passed (${mutationProbes.length}): ${mutationProbes.map((probe) => probe.name).join(" | ")}`);
} finally {
  rmSync(mutationDirectory, { recursive: true, force: true });
}
