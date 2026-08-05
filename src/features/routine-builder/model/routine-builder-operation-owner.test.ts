import assert from "node:assert/strict";
import test from "node:test";

import {
  completeRoutineSetupContinuation,
  createRoutineBuilderOperationRegistry,
  runCycleDeleteWrite,
  runCycleCreateWorkflow,
  runCycleDeleteWorkflow,
  runLegacyRoutineSaveBatch,
  runRoutineSaveWorkflow,
} from "./routine-builder-operation-owner";
import {
  createRoutineBuilderTrainingDataRefreshUpdater,
  createRoutineBuilderTransientState,
  createSetupByDay,
  disposeRoutineBuilderController,
  invalidateRoutineBuilderIdentity,
  loadRoutineBuilderDraft,
  persistRoutineBuilderDraft,
  persistRoutineBuilderPlan,
  reconcileRoutineBuilderTrainingDataState,
  routineBuilderTransientReducer,
  type RoutineBuilderTrainingDataProjection,
  type RoutineBuilderTrainingDataState,
} from "@/features/routine-builder/hooks/useRoutineBuilderController";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
} from "@/lib/session/session-data-epoch";
import { ROUTINE_DRAFT_MAX_AGE_MS, ROUTINE_DRAFT_VERSION, saveRoutineDraft } from "@/lib/storage/app-flow-storage";
import type { BrowserStorageLike } from "@/lib/storage/browser-storage";
import type { ExerciseTemplate } from "@/lib/progress/types";
import { createDefaultTrainingPlan } from "@/lib/training/training-plan-rules";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCOPE_A = `supabase:${USER_A}` as const;
const SCOPE_B = `supabase:${USER_B}` as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function watchdog<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("watchdog timeout")), timeoutMs);
    }),
  ]);
}

function harness() {
  let epoch = createSessionDataEpoch({ userId: "user-a", scope: "supabase:user-a" });
  const registry = createRoutineBuilderOperationRegistry({
    captureRequestToken: () => captureSessionDataRequestToken(epoch),
    isRequestTokenCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
  });
  return {
    registry,
    advanceToB() {
      epoch = advanceSessionDataEpoch(epoch, { userId: "user-b", scope: "supabase:user-b" });
    },
    switchToB() {
      epoch = advanceSessionDataEpoch(epoch, { userId: "user-b", scope: "supabase:user-b" });
      registry.invalidateAll();
    },
  };
}

function memoryStorage(): BrowserStorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function draftSnapshot() {
  return {
    activeDay: "Lunes",
    setupByDay: createSetupByDay(),
    draftPlan: createDefaultTrainingPlan(),
    activeRoutineDay: "Lunes",
    isEditingRoutinePlan: true,
    routineEditorReturnScreen: "dashboard" as const,
  };
}

function persistedPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    ...createDefaultTrainingPlan(),
    cycleType: "macro",
    macroObjective: "Rendimiento",
    macroDurationMonths: 9,
    ...overrides,
  };
}

function exercise(day: string, id = day): ExerciseTemplate {
  return {
    id,
    routine: `Rutina ${day}`,
    day,
    name: `Ejercicio ${day}`,
    targetSets: 3,
    targetReps: 8,
    baseWeight: 20,
  };
}

function legacyProjection(
  currentDraftPlan: TrainingPlan,
  exercises: readonly ExerciseTemplate[],
): RoutineBuilderTrainingDataProjection {
  return {
    mode: "legacy",
    plan: currentDraftPlan,
    exercises,
    hasActiveCycle: false,
    legacyExercises: exercises,
  };
}

test("resetTransient cierra cuatro modales y limpia notice/edit/return", () => {
  let state = createRoutineBuilderTransientState();
  state = routineBuilderTransientReducer(state, { type: "begin_edit", returnScreen: "dashboard" });
  state = routineBuilderTransientReducer(state, { type: "publish_notice", message: "A" });
  for (const modal of [
    "new-cycle-confirm",
    "delete-cycle-confirm",
    "routine-success",
    "routine-update-confirm",
  ] as const) state = routineBuilderTransientReducer(state, { type: "open_modal", modal });

  const reset = routineBuilderTransientReducer(state, { type: "reset_transient" });
  assert.deepEqual(reset, createRoutineBuilderTransientState());
});

test("persistencia de plan y draft exige scope y lifecycle autorizados", () => {
  const snapshot = draftSnapshot();
  let planWrites = 0;
  assert.equal(persistRoutineBuilderPlan({
    snapshot,
    dataMode: "supabase",
    userId: USER_A,
    activeStorageScope: SCOPE_B,
    write: () => { planWrites += 1; return true; },
  }), false);
  assert.equal(planWrites, 0);

  const records: unknown[] = [];
  const write = (record: unknown) => { records.push(record); };
  assert.equal(persistRoutineBuilderDraft({
    snapshot,
    screen: "dashboard",
    dataMode: "supabase",
    userId: USER_A,
    activeStorageScope: SCOPE_A,
    hasRoutinePlan: false,
    write,
  }), false);
  assert.equal(records.length, 0);
  assert.equal(persistRoutineBuilderDraft({
    snapshot,
    screen: "registro-entrenamiento",
    dataMode: "supabase",
    userId: USER_A,
    activeStorageScope: SCOPE_A,
    hasRoutinePlan: false,
    now: () => 10,
    write,
  }), true);
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0] as object).sort(), [
    "activeRoutineDay",
    "dataMode",
    "isEditingRoutinePlan",
    "routineEditorReturnScreen",
    "screen",
    "setupByDay",
    "setupDay",
    "trainingPlan",
    "updatedAt",
    "userKey",
    "version",
  ]);
});

test("bootstrap capturado reconcilia contra el plan persistido vigente y sólo persiste el resultado final", () => {
  const initialState: RoutineBuilderTrainingDataState = {
    draftPlan: createDefaultTrainingPlan(),
    activeRoutineDay: "Lunes",
  };
  const exercises = [exercise("Martes")];
  const capturedRefresh = createRoutineBuilderTrainingDataRefreshUpdater(
    (currentDraftPlan) => legacyProjection(currentDraftPlan, exercises),
  );

  const loadedState: RoutineBuilderTrainingDataState = {
    draftPlan: persistedPlan({ trainingDays: ["Lunes"] }),
    activeRoutineDay: "Lunes",
  };
  const reconciled = capturedRefresh(loadedState);

  assert.equal(initialState.draftPlan.cycleType, "meso");
  assert.equal(reconciled.draftPlan.cycleType, "macro");
  assert.equal(reconciled.draftPlan.macroObjective, "Rendimiento");
  assert.equal(reconciled.draftPlan.macroDurationMonths, 9);
  assert.deepEqual(reconciled.draftPlan.trainingDays, ["Martes"]);
  assert.equal(reconciled.activeRoutineDay, "Martes");

  const persisted: unknown[] = [];
  assert.equal(persistRoutineBuilderPlan({
    snapshot: { draftPlan: reconciled.draftPlan },
    dataMode: "supabase",
    userId: USER_A,
    activeStorageScope: SCOPE_A,
    write: (plan) => { persisted.push(plan); return true; },
  }), true);
  assert.equal(persisted.length, 1);
  assert.equal((persisted[0] as TrainingPlan).cycleType, "macro");
  assert.equal(persisted.some((plan) => (plan as TrainingPlan).cycleType === "meso"), false);
});

test("refresh capturado resuelve activeRoutineDay desde el día vigente", () => {
  const capturedRefresh = createRoutineBuilderTrainingDataRefreshUpdater(
    (currentDraftPlan) => legacyProjection(currentDraftPlan, [exercise("Lunes"), exercise("Martes")]),
  );
  const afterUserSelection: RoutineBuilderTrainingDataState = {
    draftPlan: persistedPlan({ trainingDays: ["Lunes", "Martes"] }),
    activeRoutineDay: "Martes",
  };

  assert.equal(capturedRefresh(afterUserSelection).activeRoutineDay, "Martes");
});

test("rama legacy mezcla días sin degradar campos no relacionados del plan vigente", () => {
  const current: RoutineBuilderTrainingDataState = {
    draftPlan: persistedPlan({
      trainingDays: ["Lunes"],
      microFocus: "Técnica",
      sessionFocus: "Control/RIR",
    }),
    activeRoutineDay: "Lunes",
  };
  const next = reconcileRoutineBuilderTrainingDataState(
    current,
    (currentDraftPlan) => legacyProjection(currentDraftPlan, [exercise("Jueves")]),
  );

  assert.deepEqual(next.draftPlan.trainingDays, ["Jueves"]);
  assert.equal(next.draftPlan.cycleType, "macro");
  assert.equal(next.draftPlan.macroObjective, "Rendimiento");
  assert.equal(next.draftPlan.macroDurationMonths, 9);
  assert.equal(next.draftPlan.microFocus, "Técnica");
  assert.equal(next.draftPlan.sessionFocus, "Control/RIR");
});

test("ciclo activo deriva fallback desde el draft vigente", () => {
  const current: RoutineBuilderTrainingDataState = {
    draftPlan: persistedPlan({ trainingDays: ["Viernes"] }),
    activeRoutineDay: "Viernes",
  };
  const next = reconcileRoutineBuilderTrainingDataState(current, (currentDraftPlan) => {
    assert.equal(currentDraftPlan.cycleType, "macro");
    assert.equal(currentDraftPlan.macroObjective, "Rendimiento");
    return {
      mode: "cycle-scoped",
      plan: { ...currentDraftPlan, trainingDays: ["Sábado"] },
      exercises: [exercise("Sábado")],
      hasActiveCycle: true,
    };
  });

  assert.equal(next.draftPlan.cycleType, "macro");
  assert.equal(next.draftPlan.macroObjective, "Rendimiento");
  assert.equal(next.draftPlan.macroDurationMonths, 9);
  assert.deepEqual(next.draftPlan.trainingDays, ["Sábado"]);
});

test("demo en el mismo evento procesa replaceIdentityScope antes del updater capturado", () => {
  const initial: RoutineBuilderTrainingDataState = {
    draftPlan: createDefaultTrainingPlan(),
    activeRoutineDay: "Lunes",
  };
  const loadedDemo: RoutineBuilderTrainingDataState = {
    draftPlan: persistedPlan({ trainingDays: ["Lunes"] }),
    activeRoutineDay: "Lunes",
  };
  const queuedUpdates: Array<(current: RoutineBuilderTrainingDataState) => RoutineBuilderTrainingDataState> = [];
  const capturedRefresh = () => queuedUpdates.push(
    createRoutineBuilderTrainingDataRefreshUpdater(
      (currentDraftPlan) => legacyProjection(currentDraftPlan, [exercise("Miércoles")]),
    ),
  );

  queuedUpdates.push(() => loadedDemo);
  capturedRefresh();
  const finalState = queuedUpdates.reduce((current, update) => update(current), initial);

  assert.equal(finalState.draftPlan.cycleType, "macro");
  assert.equal(finalState.draftPlan.macroObjective, "Rendimiento");
  assert.equal(finalState.draftPlan.macroDurationMonths, 9);
  assert.deepEqual(finalState.draftPlan.trainingDays, ["Miércoles"]);
});

test("A→B descarta refresh tardío de A y produce cero persistencias", () => {
  let current: RoutineBuilderTrainingDataState = {
    draftPlan: persistedPlan({ macroObjective: "Fuerza" }),
    activeRoutineDay: "Lunes",
  };
  const capturedA = (kind: "success" | "stale") => {
    if (kind === "stale") return false;
    current = createRoutineBuilderTrainingDataRefreshUpdater(
      (currentDraftPlan) => legacyProjection(currentDraftPlan, [exercise("Martes")]),
    )(current);
    return true;
  };
  current = {
    draftPlan: persistedPlan({ macroObjective: "Salud", macroDurationMonths: 10 }),
    activeRoutineDay: "Viernes",
  };
  let writes = 0;

  if (capturedA("stale")) {
    persistRoutineBuilderPlan({
      snapshot: { draftPlan: current.draftPlan },
      dataMode: "supabase",
      userId: USER_B,
      activeStorageScope: SCOPE_B,
      write: () => { writes += 1; return true; },
    });
  }

  assert.equal(writes, 0);
  assert.equal(current.draftPlan.macroObjective, "Salud");
  assert.equal(current.draftPlan.macroDurationMonths, 10);
  assert.equal(current.activeRoutineDay, "Viernes");
});

test("replaceIdentityScope invalida las tres lanes y A no libera B", async () => {
  const { registry, advanceToB } = harness();
  const pending = [deferred<void>(), deferred<void>(), deferred<void>()];
  const lanes = ["routine-save", "cycle-create", "cycle-delete"] as const;
  const ownersA = lanes.map((lane) => registry.acquire(lane, "supabase"));
  ownersA.forEach((owner) => assert.ok(owner));
  const settledA = ownersA.map((owner, index) => registry.settle(lanes[index], owner!, pending[index].promise));

  advanceToB();
  invalidateRoutineBuilderIdentity(registry);
  const ownersB = lanes.map((lane) => registry.acquire(lane, "supabase"));
  ownersB.forEach((owner) => assert.ok(owner));
  pending.forEach((item) => item.resolve());
  assert.deepEqual(await watchdog(Promise.all(settledA)), lanes.map(() => ({ kind: "stale" })));
  ownersA.forEach((owner, index) => assert.equal(registry.finalize(lanes[index], owner!), false));
  ownersB.forEach((owner, index) => assert.equal(registry.isCurrent(lanes[index], owner!), true));
});

test("unmount invalida tres lanes sin publicar ni liberar owners posteriores", async () => {
  const { registry } = harness();
  const lanes = ["routine-save", "cycle-create", "cycle-delete"] as const;
  const pending = lanes.map(() => deferred<void>());
  const ownersA = lanes.map((lane) => registry.acquire(lane, "supabase"));
  const settled = ownersA.map((owner, index) => registry.settle(lanes[index], owner!, pending[index].promise));
  let publications = 0;
  disposeRoutineBuilderController(registry);
  const ownersB = lanes.map((lane) => registry.acquire(lane, "supabase"));
  pending.forEach((item) => item.resolve());
  for (const result of await watchdog(Promise.all(settled))) {
    if (result.kind === "success") publications += 1;
    assert.deepEqual(result, { kind: "stale" });
  }
  assert.equal(publications, 0);
  ownersA.forEach((owner, index) => assert.equal(registry.finalize(lanes[index], owner!), false));
  ownersB.forEach((owner, index) => assert.equal(registry.isCurrent(lanes[index], owner!), true));
});

test("discard, expiración e identidad incorrecta nunca restauran draft", () => {
  const storage = memoryStorage();
  const now = 1_000_000;
  saveRoutineDraft({
    version: ROUTINE_DRAFT_VERSION,
    updatedAt: now,
    dataMode: "supabase",
    userKey: SCOPE_A,
    screen: "registro-entrenamiento",
    setupDay: "invalido",
    setupByDay: null,
    trainingPlan: createDefaultTrainingPlan(),
    isEditingRoutinePlan: true,
    routineEditorReturnScreen: "dashboard",
    activeRoutineDay: "Lunes",
  }, storage);
  assert.equal(loadRoutineBuilderDraft({ mode: "supabase", userId: USER_A, now: () => now, storage }), null);

  saveRoutineDraft({
    version: ROUTINE_DRAFT_VERSION,
    updatedAt: now - ROUTINE_DRAFT_MAX_AGE_MS - 1,
    dataMode: "supabase",
    userKey: SCOPE_A,
    screen: "registro-entrenamiento",
    setupDay: "Lunes",
    setupByDay: createSetupByDay(),
    trainingPlan: createDefaultTrainingPlan(),
    isEditingRoutinePlan: true,
    routineEditorReturnScreen: null,
    activeRoutineDay: "Lunes",
  }, storage);
  assert.equal(loadRoutineBuilderDraft({ mode: "supabase", userId: USER_A, now: () => now, storage }), null);
  assert.equal(loadRoutineBuilderDraft({ mode: "supabase", userId: USER_B, now: () => now, storage }), null);
});

test("doble submit adquiere un solo owner", () => {
  const { registry } = harness();
  const first = registry.acquire("routine-save", "supabase");
  const second = registry.acquire("routine-save", "supabase");
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(registry.finalize("routine-save", first), true);
  assert.ok(registry.acquire("routine-save", "supabase"));
});

test("los tres workflows feature-local adquieren, ejecutan y finalizan su owner", async () => {
  const { registry } = harness();
  const calls: string[] = [];

  assert.deepEqual(await runRoutineSaveWorkflow({
    registry,
    dataMode: "supabase",
    execute: async (operation) => {
      assert.equal(operation.isCurrent(), true);
      calls.push("routine-save");
    },
  }), { kind: "completed", value: undefined, finalized: true });
  assert.deepEqual(await runCycleCreateWorkflow({
    registry,
    dataMode: "supabase",
    execute: async (operation) => {
      assert.equal(operation.isCurrent(), true);
      calls.push("cycle-create");
    },
  }), { kind: "completed", value: undefined, finalized: true });
  assert.deepEqual(await runCycleDeleteWorkflow({
    registry,
    dataMode: "supabase",
    execute: async (operation) => {
      assert.equal(operation.isCurrent(), true);
      calls.push("cycle-delete");
    },
  }), { kind: "completed", value: undefined, finalized: true });

  assert.deepEqual(calls, ["routine-save", "cycle-create", "cycle-delete"]);
  for (const lane of calls) {
    const owner = registry.acquire(lane as "routine-save" | "cycle-create" | "cycle-delete", "supabase");
    assert.ok(owner, `${lane} quedó liberado`);
    assert.equal(registry.finalize(lane as "routine-save" | "cycle-create" | "cycle-delete", owner), true);
  }
});

test("A→SIGNED_OUT→B descarta success tardío y finally A no libera B", async () => {
  const { registry, switchToB } = harness();
  const pendingA = deferred<string>();
  const ownerA = registry.acquire("routine-save", "supabase");
  assert.ok(ownerA);
  const settledA = registry.settle("routine-save", ownerA, pendingA.promise);

  switchToB();
  const ownerB = registry.acquire("routine-save", "supabase");
  assert.ok(ownerB);
  pendingA.resolve("late-a");

  assert.deepEqual(await watchdog(settledA), { kind: "stale" });
  assert.equal(registry.finalize("routine-save", ownerA), false);
  assert.equal(registry.isCurrent("routine-save", ownerB), true);
});

test("error tardío de A es stale y no publica error bajo B", async () => {
  const { registry, switchToB } = harness();
  const pendingA = deferred<string>();
  const ownerA = registry.acquire("routine-save", "supabase");
  assert.ok(ownerA);
  const settledA = registry.settle("routine-save", ownerA, pendingA.promise);
  switchToB();
  pendingA.reject(new Error("late-a"));
  assert.deepEqual(await watchdog(settledA), { kind: "stale" });
});

test("batch se detiene antes del siguiente write al invalidar identidad", async () => {
  const { registry, switchToB } = harness();
  const firstWrite = deferred<void>();
  const writes: string[] = [];
  const owner = registry.acquire("routine-save", "supabase");
  assert.ok(owner);

  const batch = runLegacyRoutineSaveBatch(registry, owner, [
    () => { writes.push("first"); return firstWrite.promise; },
    async () => { writes.push("second"); },
  ]);

  firstWrite.resolve();
  queueMicrotask(switchToB);
  assert.deepEqual(await watchdog(batch), { kind: "stale" });
  assert.deepEqual(writes, ["first"]);
});

test("continue_setup finaliza routine-save y permite el siguiente submit", () => {
  const { registry } = harness();
  const owner = registry.acquire("routine-save", "supabase");
  assert.ok(owner);
  assert.equal(completeRoutineSetupContinuation(registry, owner), true);
  assert.ok(registry.acquire("routine-save", "supabase"));
});

test("cycle-delete revalida inmediatamente antes del repository write", async () => {
  const { registry, switchToB } = harness();
  const ownerA = registry.acquire("cycle-delete", "supabase");
  assert.ok(ownerA);
  switchToB();
  let staleWrites = 0;
  assert.deepEqual(await runCycleDeleteWrite(registry, ownerA, async () => {
    staleWrites += 1;
  }), { kind: "stale" });
  assert.equal(staleWrites, 0);

  const ownerB = registry.acquire("cycle-delete", "supabase");
  assert.ok(ownerB);
  let currentWrites = 0;
  assert.deepEqual(await runCycleDeleteWrite(registry, ownerB, async () => {
    currentWrites += 1;
  }), { kind: "success" });
  assert.equal(currentWrites, 1);
});

test("unmount invalida operación pendiente", async () => {
  const { registry } = harness();
  const pending = deferred<void>();
  const owner = registry.acquire("cycle-create", "supabase");
  assert.ok(owner);
  const settled = registry.settle("cycle-create", owner, pending.promise);
  disposeRoutineBuilderController(registry);
  pending.resolve();
  assert.deepEqual(await watchdog(settled), { kind: "stale" });
});
