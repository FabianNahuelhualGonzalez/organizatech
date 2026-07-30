import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  ACTIVE_FLOW_MAX_AGE_MS,
  ACTIVE_FLOW_VERSION,
  ROUTINE_DRAFT_MAX_AGE_MS,
  ROUTINE_DRAFT_VERSION,
  clearActiveFlow,
  clearRoutineDraft,
  loadActiveFlow,
  loadCycleHistory,
  loadRoutineDraft,
  loadTrainingPlan,
  saveActiveFlow,
  saveCycleHistory,
  saveRoutineDraft,
  saveTrainingPlan,
  type LoadRoutineDraftRecoveryOptions,
  type PersistableRoutineDraftStorageRecord,
  type RecoveredRoutineDraftStorageRecord,
  type RoutineDraftSetupRecoveryResult,
  type RoutineDraftStorageRecord,
} from "@/lib/storage/app-flow-storage";
import {
  BROWSER_STORAGE_PREFIXES,
  getBrowserStorageScope,
  getScopedBrowserStorageKey,
  type BrowserStorageLike,
} from "@/lib/storage/browser-storage";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type { SetupDayState } from "@/lib/training/training-routine-draft";
// Único punto del árbol de storage que referencia una feature: exclusivamente en este test,
// para construir el mismo adapter que usa el root. El código productivo de storage no importa
// features.
import {
  resolveRoutineBuilderDraftRecovery,
  type RoutineBuilderDraftRecovery,
} from "@/features/routine-builder/model/routine-builder-draft-recovery";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const NOW = 1_000_000_000;

interface TestSetupDay {
  routineName: string;
}

interface TestTrainingPlan {
  name: string;
}

type TestSetupByDay = Record<string, TestSetupDay>;
type TestRoutineDraft = RoutineDraftStorageRecord<TestSetupByDay, TestTrainingPlan>;

function createStorage(options: { throwOnGet?: boolean; throwOnSet?: boolean; throwOnRemove?: boolean } = {}) {
  const values = new Map<string, string>();
  const removes: string[] = [];
  const storage: BrowserStorageLike = {
    getItem: (key) => {
      if (options.throwOnGet) throw new Error("getItem failed");
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (options.throwOnSet) throw new Error("setItem failed");
      values.set(key, value);
    },
    removeItem: (key) => {
      if (options.throwOnRemove) throw new Error("removeItem failed");
      removes.push(key);
      values.delete(key);
    },
  };
  return { storage, values, removes };
}

function getScope(userId = USER_A) {
  const scope = getBrowserStorageScope("supabase", userId);
  assert.ok(scope);
  return scope;
}

function getActiveFlowKey(userId = USER_A) {
  return getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, getScope(userId));
}

function getRoutineDraftKey(userId = USER_A) {
  return getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.routineDraft, getScope(userId));
}

function createRoutineDraft(): TestRoutineDraft {
  return {
    version: ROUTINE_DRAFT_VERSION,
    updatedAt: NOW,
    dataMode: "supabase",
    userKey: getScope(),
    screen: "registro-entrenamiento",
    setupDay: "Martes",
    setupByDay: {
      Lunes: { routineName: "Pecho" },
      Martes: { routineName: "Piernas" },
    },
    trainingPlan: { name: "Plan actual" },
    isEditingRoutinePlan: true,
    routineEditorReturnScreen: "dashboard",
    activeRoutineDay: "Miercoles",
  };
}

function normalizeTrainingPlan(value: unknown): TestTrainingPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { name: "Fallback" };
  const name = (value as { name?: unknown }).name;
  return { name: typeof name === "string" ? name : "Fallback" };
}

// ---------------------------------------------------------------------------------------------
// Adapter de prueba equivalente al usado por el root. El código productivo de
// app-flow-storage.ts nunca conoce la feature; sólo conoce la forma genérica
// RoutineDraftSetupRecoveryResult<TSetupByDay, TRecovery>.
// ---------------------------------------------------------------------------------------------

type RecoverySetupByDay = Record<string, SetupDayState>;

function resolveSetupRecoveryAdapter(
  input: unknown,
): RoutineDraftSetupRecoveryResult<RecoverySetupByDay, RoutineBuilderDraftRecovery> {
  const result = resolveRoutineBuilderDraftRecovery(input);
  if (result.kind === "discard") {
    return { kind: "discard", shouldClearStoredDraft: result.shouldClearStoredDraft };
  }
  return {
    kind: "restore",
    setupDay: result.state.activeDay,
    setupByDay: result.state.setupByDay,
    recovery: result.recovery,
  };
}

function createRecoveryRoutineDraftPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: ROUTINE_DRAFT_VERSION,
    updatedAt: NOW,
    dataMode: "supabase",
    userKey: getScope(),
    screen: "registro-entrenamiento",
    setupDay: "Martes",
    setupByDay: {
      Martes: {
        routineName: "Piernas",
        rows: [{ id: "row-1", name: "Sentadilla", sets: 4, reps: 10, weight: "60" }],
      },
    },
    trainingPlan: { name: "Plan actual" },
    isEditingRoutinePlan: false,
    routineEditorReturnScreen: null,
    activeRoutineDay: "Martes",
    ...overrides,
  };
}

function loadRoutineWithRecovery(
  storage: BrowserStorageLike,
  now = NOW,
  resolveSetupRecovery = resolveSetupRecoveryAdapter,
) {
  return loadRoutineDraft("supabase", USER_A, {
    setupDays: TRAINING_DAY_LABELS,
    resolveSetupRecovery,
    normalizeTrainingPlan,
    now: () => now,
    storage,
  });
}

function createRecoverySpy() {
  let calls = 0;
  const resolveSetupRecovery = (input: unknown) => {
    calls += 1;
    return resolveSetupRecoveryAdapter(input);
  };
  return { resolveSetupRecovery, callCount: () => calls };
}

function run() {
  {
    const { storage, values } = createStorage();
    const flow = {
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase" as const,
      userKey: getScope(),
      flow: "comparison" as const,
    };

    saveActiveFlow(flow, storage);
    assert.deepEqual(JSON.parse(values.get(getActiveFlowKey()) ?? "{}"), flow);
    assert.deepEqual(loadActiveFlow("supabase", USER_A, { now: () => NOW, storage }), flow);
    assert.equal(loadActiveFlow("supabase", USER_B, { now: () => NOW, storage }), null);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getActiveFlowKey();
    values.set(key, JSON.stringify({
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getScope(),
      flow: "not-a-flow",
    }));

    assert.equal(loadActiveFlow("supabase", USER_A, { now: () => NOW, storage }), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values } = createStorage();
    const key = getActiveFlowKey();
    const flow = {
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getScope(),
      flow: "dashboard",
    };
    values.set(key, JSON.stringify(flow));

    assert.ok(loadActiveFlow("supabase", USER_A, { now: () => NOW + ACTIVE_FLOW_MAX_AGE_MS, storage }));
    assert.equal(loadActiveFlow("supabase", USER_A, { now: () => NOW + ACTIVE_FLOW_MAX_AGE_MS + 1, storage }), null);
    assert.equal(values.has(key), false);
  }

  {
    const { storage, values, removes } = createStorage();
    const key = getActiveFlowKey();
    values.set(key, "{invalid-json");

    assert.equal(loadActiveFlow("supabase", USER_A, { now: () => NOW, storage }), null);
    assert.deepEqual(removes, [key]);
  }

  {
    const { storage, values } = createStorage();
    const legacyKey = `${BROWSER_STORAGE_PREFIXES.activeFlow}:demo:local`;
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, "demo");
    values.set(legacyKey, JSON.stringify({
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "demo",
      userKey: "demo:local",
      flow: "profile",
    }));

    assert.equal(loadActiveFlow("demo", undefined, { now: () => NOW, storage })?.flow, "profile");
    assert.equal(values.has(legacyKey), false);
    assert.equal(values.has(demoKey), true);
  }

  {
    const { storage, values } = createStorage();
    values.set(getActiveFlowKey(), "active");
    values.set(getActiveFlowKey(USER_B), "other-user");
    clearActiveFlow("supabase", USER_A, storage);
    assert.equal(values.has(getActiveFlowKey()), false);
    assert.equal(values.get(getActiveFlowKey(USER_B)), "other-user");
    assert.equal(loadActiveFlow("supabase", undefined, { storage }), null);
  }

  {
    const { storage, values } = createStorage();
    const draft = createRoutineDraft();
    saveRoutineDraft(draft, storage);

    assert.deepEqual(JSON.parse(values.get(getRoutineDraftKey()) ?? "{}"), draft);
  }

  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), "draft");
    values.set(getRoutineDraftKey(USER_B), "other-user");
    clearRoutineDraft("supabase", USER_A, storage);
    assert.equal(values.has(getRoutineDraftKey()), false);
    assert.equal(values.get(getRoutineDraftKey(USER_B)), "other-user");
  }

  // La migración de la clave histórica demo conserva el mismo JSON y lo entrega al recovery
  // canónico, que actualiza scope/dataMode antes de validar el record.
  {
    const { storage, values } = createStorage();
    const legacyKey = `${BROWSER_STORAGE_PREFIXES.routineDraft}:demo:local`;
    const demoKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.routineDraft, "demo");
    values.set(legacyKey, JSON.stringify(createRecoveryRoutineDraftPayload({
      dataMode: "demo",
      userKey: "demo:local",
    })));

    const loaded = loadRoutineDraft("demo", undefined, {
      setupDays: TRAINING_DAY_LABELS,
      resolveSetupRecovery: resolveSetupRecoveryAdapter,
      normalizeTrainingPlan,
      now: () => NOW,
      storage,
    });

    assert.ok(loaded);
    assert.equal(loaded.dataMode, "demo");
    assert.equal(loaded.userKey, "demo");
    assert.equal(values.has(legacyKey), false);
    assert.equal(values.has(demoKey), true);
  }

  // -------------------------------------------------------------------------------------------
  // Recuperación canónica
  // -------------------------------------------------------------------------------------------

  // CASO — JSON persistido antes de existir metadata de recovery: se restaura completo sin
  // migrar el formato almacenado ni exigir un campo nuevo.
  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload()));

    const loaded = loadRoutineWithRecovery(storage);
    assert.ok(loaded);
    assert.equal(loaded.recovery.kind, "full");
    if (loaded.recovery.kind === "full") assert.equal(loaded.recovery.code, "routine_draft_recovered");
    assert.equal(loaded.setupDay, "Martes");
    assert.equal(loaded.setupByDay.Martes.rows.length, 1);
  }

  // CASO — los fallbacks de pantalla, día activo y plan se conservan al recuperar datos
  // persistidos malformados pero reparables.
  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload({
      screen: "dashboard",
      setupDay: "NoExiste",
      activeRoutineDay: "NoExiste",
      routineEditorReturnScreen: "invalid-screen",
      trainingPlan: { invalid: true },
    })));

    const restored = loadRoutineWithRecovery(storage);
    assert.equal(restored?.screen, "registro-entrenamiento");
    assert.equal(restored?.setupDay, "Lunes");
    assert.equal(restored?.activeRoutineDay, "Lunes");
    assert.equal(restored?.routineEditorReturnScreen, null);
    assert.deepEqual(restored?.trainingPlan, { name: "Fallback" });
  }

  // CASO — partial restore: discardedRowCount exacto, nunca se degrada a full.
  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload({
      setupByDay: {
        Martes: {
          routineName: "Piernas",
          rows: [
            { name: "Sin id, se descarta" },
            { id: "row-1", name: "Sentadilla", sets: 4, reps: 10, weight: "60" },
          ],
        },
      },
    })));

    const loaded = loadRoutineWithRecovery(storage);
    assert.ok(loaded);
    assert.equal(loaded.recovery.kind, "partial");
    if (loaded.recovery.kind === "partial") assert.equal(loaded.recovery.discardedRowCount, 1);
    assert.equal(loaded.setupByDay.Martes.rows.length, 1);
  }

  // CASO — recovery no forma parte del JSON persistido: se escribe sin `recovery` (payload
  // canónico de RoutineDraftStorageRecord) y se lee en modo recovery; `recovery` sólo existe en
  // el resultado de lectura, nunca en lo guardado.
  {
    const { storage, values } = createStorage();
    const draft = createRoutineDraft();
    saveRoutineDraft(draft, storage);
    const persisted = JSON.parse(values.get(getRoutineDraftKey()) ?? "{}");
    assert.ok(!("recovery" in persisted), "recovery nunca se escribe mediante saveRoutineDraft");

    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload()));
    const loaded = loadRoutineWithRecovery(storage);
    assert.ok(loaded && "recovery" in loaded, "recovery solo existe en el resultado de lectura");
  }

  // CASO (P3-24B.1, round-trip obligatorio) — un consumidor que rompe el contrato de TypeScript
  // via cast (p.ej. porque copio el objeto cargado y lo reenvio a saveRoutineDraft sin pasar por
  // el tipo correcto) NO logra persistir `recovery`: la defensa runtime (toPersistableRoutineDraft)
  // reconstruye el objeto campo por campo, sin depender de que TypeScript lo hubiera bloqueado.
  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload()));

    // 1. cargar mediante la API recovery.
    const loaded = loadRoutineWithRecovery(storage);
    assert.ok(loaded);
    // 2. confirmar que el resultado contiene recovery.
    assert.ok("recovery" in loaded, "el resultado de lectura recovery debe traer recovery");
    assert.equal(loaded.recovery.kind, "full");

    // 3. reenviar deliberadamente ese objeto a saveRoutineDraft mediante un cast controlado —
    // esto es exactamente lo que NO debe compilar sin el cast (ver runSaveRoutineDraftTypeChecks);
    // aqui se usa el cast para demostrar que, aun si un consumidor lo hace, la persistencia queda
    // protegida en runtime.
    saveRoutineDraft(loaded as unknown as PersistableRoutineDraftStorageRecord<RecoverySetupByDay, TestTrainingPlan>, storage);

    // 4-5. inspeccionar el JSON guardado y confirmar que recovery no existe.
    const persisted = JSON.parse(values.get(key) ?? "{}");
    assert.ok(!("recovery" in persisted), "recovery no debe persistirse ni siquiera via cast");

    // 6. confirmar que los campos canonicos si permanecen.
    assert.equal(persisted.version, loaded.version);
    assert.equal(persisted.updatedAt, loaded.updatedAt);
    assert.equal(persisted.dataMode, loaded.dataMode);
    assert.equal(persisted.userKey, loaded.userKey);
    assert.equal(persisted.screen, loaded.screen);
    assert.equal(persisted.setupDay, loaded.setupDay);
    // JSON.stringify descarta claves con valor undefined (p.ej. sourceExerciseId ausente) — se
    // compara contra la misma normalizacion, no contra el objeto en memoria tal cual.
    assert.deepEqual(persisted.setupByDay, JSON.parse(JSON.stringify(loaded.setupByDay)));
    assert.deepEqual(persisted.trainingPlan, loaded.trainingPlan);
    assert.equal(persisted.isEditingRoutinePlan, loaded.isEditingRoutinePlan);
    assert.equal(persisted.routineEditorReturnScreen, loaded.routineEditorReturnScreen);
    assert.equal(persisted.activeRoutineDay, loaded.activeRoutineDay);

    // 7. volver a cargar el draft y confirmar que funciona correctamente.
    const reloaded = loadRoutineWithRecovery(storage);
    assert.ok(reloaded);
    assert.equal(reloaded.setupDay, loaded.setupDay);
    assert.equal(reloaded.recovery.kind, "full");
  }

  // CASO (P3-24B.1) — una propiedad extra arbitraria (ajena por completo al contrato, no sólo
  // `recovery`) tampoco se persiste, porque la proyeccion runtime enumera exclusivamente los
  // campos canonicos conocidos.
  {
    const { storage, values } = createStorage();
    const draft = createRoutineDraft();
    const draftWithExtra = { ...draft, bogusExtraField: "no deberia persistirse" };
    saveRoutineDraft(draftWithExtra as unknown as PersistableRoutineDraftStorageRecord<TestSetupByDay, TestTrainingPlan>, storage);

    const persisted = JSON.parse(values.get(getRoutineDraftKey()) ?? "{}");
    assert.ok(!("bogusExtraField" in persisted), "propiedades extra arbitrarias no deben persistirse");
    assert.equal(persisted.setupDay, draft.setupDay);
  }

  // CASO — placeholder_only_content limpia: una fila unicamente placeholder no se restaura.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload({
      setupByDay: {
        Martes: { routineName: "", rows: [{ id: "row-1", name: "", sets: 0, reps: 0, weight: "" }] },
      },
    })));

    assert.equal(loadRoutineWithRecovery(storage), null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — all_recoverable_rows_discarded limpia: todas las filas sobrevivientes fueron
  // descartadas y no queda contenido.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload({
      setupByDay: { Martes: { rows: [{ name: "sin id 1" }, { name: "sin id 2" }] } },
    })));

    assert.equal(loadRoutineWithRecovery(storage), null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — no_recoverable_content limpia: objeto sin ninguna fila ni routineName.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload({ setupByDay: {} })));

    assert.equal(loadRoutineWithRecovery(storage), null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — discard generico limpia, sin importar la razon concreta: la capa de storage nunca
  // interpreta `reason`, solo actua sobre `kind`/`shouldClearStoredDraft`. NOTA: por construccion
  // del adapter (siempre envuelve setupDay/setupByDay en un objeto plano `{ setupDay, setupByDay }`
  // antes de invocar resolveRoutineBuilderDraftRecovery), la razon "invalid_top_level_input"
  // nunca es alcanzable a traves de esta integracion especifica — solo lo es invocando
  // resolveRoutineBuilderDraftRecovery directamente (ya cubierto en el test de P3-24A). Este caso
  // prueba el manejo generico de storage ante CUALQUIER discard con un resolver sintetico.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload()));

    const loaded = loadRoutineWithRecovery(storage, NOW, () => ({ kind: "discard", shouldClearStoredDraft: true }));
    assert.equal(loaded, null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — el resolver NO corre para: version invalida, userKey incorrecto, dataMode incorrecto,
  // expiracion. Los gates de seguridad se evaluan antes de invocar resolveSetupRecovery.
  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify({ ...createRecoveryRoutineDraftPayload(), version: ROUTINE_DRAFT_VERSION + 1 }));
    const spy = createRecoverySpy();
    assert.equal(loadRoutineDraft("supabase", USER_A, { setupDays: TRAINING_DAY_LABELS, resolveSetupRecovery: spy.resolveSetupRecovery, normalizeTrainingPlan, now: () => NOW, storage }), null);
    assert.equal(spy.callCount(), 0, "version invalida no debe invocar el resolver");
    assert.equal(values.has(key), false);
  }
  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify({ ...createRecoveryRoutineDraftPayload(), userKey: getScope(USER_B) }));
    const spy = createRecoverySpy();
    assert.equal(loadRoutineDraft("supabase", USER_A, { setupDays: TRAINING_DAY_LABELS, resolveSetupRecovery: spy.resolveSetupRecovery, normalizeTrainingPlan, now: () => NOW, storage }), null);
    assert.equal(spy.callCount(), 0, "userKey incorrecto no debe invocar el resolver");
    assert.equal(values.has(key), false);
  }
  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify({ ...createRecoveryRoutineDraftPayload(), dataMode: "demo" }));
    const spy = createRecoverySpy();
    assert.equal(loadRoutineDraft("supabase", USER_A, { setupDays: TRAINING_DAY_LABELS, resolveSetupRecovery: spy.resolveSetupRecovery, normalizeTrainingPlan, now: () => NOW, storage }), null);
    assert.equal(spy.callCount(), 0, "dataMode incorrecto no debe invocar el resolver");
    assert.equal(values.has(key), false);
  }
  {
    const { storage, values } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload()));
    const validSpy = createRecoverySpy();
    assert.ok(loadRoutineDraft("supabase", USER_A, { setupDays: TRAINING_DAY_LABELS, resolveSetupRecovery: validSpy.resolveSetupRecovery, normalizeTrainingPlan, now: () => NOW + ROUTINE_DRAFT_MAX_AGE_MS, storage }));
    assert.equal(validSpy.callCount(), 1, "el limite exacto del TTL sigue siendo recuperable");

    const expiredSpy = createRecoverySpy();
    assert.equal(loadRoutineDraft("supabase", USER_A, { setupDays: TRAINING_DAY_LABELS, resolveSetupRecovery: expiredSpy.resolveSetupRecovery, normalizeTrainingPlan, now: () => NOW + ROUTINE_DRAFT_MAX_AGE_MS + 1, storage }), null);
    assert.equal(expiredSpy.callCount(), 0, "draft expirado no debe invocar el resolver");
    assert.equal(values.has(key), false);
  }

  // CASO — JSON corrupto: resolveSetupRecovery no se ejecuta y el record se limpia.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, "{invalid-json");
    const spy = createRecoverySpy();

    assert.equal(loadRoutineDraft("supabase", USER_A, {
      setupDays: TRAINING_DAY_LABELS,
      resolveSetupRecovery: spy.resolveSetupRecovery,
      normalizeTrainingPlan,
      now: () => NOW,
      storage,
    }), null);
    assert.equal(spy.callCount(), 0, "JSON corrupto no debe invocar el resolver");
    assert.deepEqual(removes, [key]);
  }

  // CASO — normalizeTrainingPlan lanza después de una recuperación válida: cleanup + null.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload()));

    const throwingNormalizeTrainingPlan = (): TestTrainingPlan => {
      throw new Error("normalizeTrainingPlan roto");
    };
    assert.equal(loadRoutineDraft("supabase", USER_A, {
      setupDays: TRAINING_DAY_LABELS,
      resolveSetupRecovery: resolveSetupRecoveryAdapter,
      normalizeTrainingPlan: throwingNormalizeTrainingPlan,
      now: () => NOW,
      storage,
    }), null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — el resolver lanza: se limpia igual que cualquier otra excepcion interna.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload()));

    const throwingResolver = (): RoutineDraftSetupRecoveryResult<RecoverySetupByDay, RoutineBuilderDraftRecovery> => {
      throw new Error("resolver roto");
    };
    assert.equal(loadRoutineWithRecovery(storage, NOW, throwingResolver), null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — setupDay recuperado invalido (fuera de setupDays): se limpia y retorna null, en vez
  // de propagar un dia no-canonico.
  {
    const { storage, values, removes } = createStorage();
    const key = getRoutineDraftKey();
    values.set(key, JSON.stringify(createRecoveryRoutineDraftPayload()));

    const invalidDayResolver = (): RoutineDraftSetupRecoveryResult<RecoverySetupByDay, RoutineBuilderDraftRecovery> => ({
      kind: "restore",
      setupDay: "Funday",
      setupByDay: {},
      recovery: { kind: "full", code: "routine_draft_recovered" },
    });
    assert.equal(loadRoutineWithRecovery(storage, NOW, invalidDayResolver), null);
    assert.deepEqual(removes, [key]);
  }

  // CASO — activeRoutineDay valido y presente en setupDays se conserva.
  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload({ activeRoutineDay: "Lunes" })));
    const loaded = loadRoutineWithRecovery(storage);
    assert.equal(loaded?.activeRoutineDay, "Lunes");
  }

  // CASO — activeRoutineDay invalido/ausente cae al setupDay recuperado (no al literal "Lunes").
  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload({ activeRoutineDay: "NoExiste" })));
    const loaded = loadRoutineWithRecovery(storage);
    assert.equal(loaded?.activeRoutineDay, loaded?.setupDay);
    assert.equal(loaded?.activeRoutineDay, "Martes");
  }

  // CASO — normalizeTrainingPlan sigue funcionando igual en modo recovery (independiente de
  // setupByDay/setupDay).
  {
    const { storage, values } = createStorage();
    values.set(getRoutineDraftKey(), JSON.stringify(createRecoveryRoutineDraftPayload({ trainingPlan: { invalid: true } })));
    const loaded = loadRoutineWithRecovery(storage);
    assert.deepEqual(loaded?.trainingPlan, { name: "Fallback" });
  }

  // CASO — aislamiento userKey/dataMode en modo recovery: un draft de otro usuario no se
  // restaura ni se toca.
  {
    const { storage, values, removes } = createStorage();
    const keyA = getRoutineDraftKey(USER_A);
    const keyB = getRoutineDraftKey(USER_B);
    values.set(keyA, JSON.stringify(createRecoveryRoutineDraftPayload()));
    values.set(keyB, JSON.stringify({ ...createRecoveryRoutineDraftPayload(), userKey: getScope(USER_B) }));

    const loadedA = loadRoutineDraft("supabase", USER_A, {
      setupDays: TRAINING_DAY_LABELS, resolveSetupRecovery: resolveSetupRecoveryAdapter, normalizeTrainingPlan, now: () => NOW, storage,
    });
    assert.ok(loadedA);
    assert.equal(values.has(keyB), true, "el draft del otro usuario no debe tocarse");
    assert.deepEqual(removes, []);
  }

  // CASO — storage conserva una sola API recovery y nunca importa una feature.
  {
    const storageSource = readFileSync("src/lib/storage/app-flow-storage.ts", "utf8");
    assert.doesNotMatch(storageSource, /from ["']@\/features\//, "storage no debe importar features");
    assert.doesNotMatch(storageSource, /\bLoadRoutineDraftOptions\b|\bisLegacyLoadRoutineDraftOptions\b/);
    assert.doesNotMatch(storageSource, /\bnormalizeSetupByDay\b|\bhasSetupDraftContent\b/);
    assert.equal(
      (storageSource.match(/^export function loadRoutineDraft</gm) ?? []).length,
      1,
      "loadRoutineDraft debe tener una sola declaración productiva",
    );
  }

  {
    const { storage, values } = createStorage({ throwOnSet: true });
    assert.doesNotThrow(() => saveActiveFlow({
      version: ACTIVE_FLOW_VERSION,
      updatedAt: NOW,
      dataMode: "supabase",
      userKey: getScope(),
      flow: "dashboard",
    }, storage));
    assert.doesNotThrow(() => saveRoutineDraft(createRoutineDraft(), storage));
    assert.equal(values.size, 0);
  }

  {
    const { storage, values } = createStorage();
    const plan = { name: "Plan actual", days: ["Martes", "Lunes"] };
    assert.equal(saveTrainingPlan(plan, getScope(), {
      storage,
      serialize: (value) => ({ ...value, days: [...value.days].sort() }),
    }), true);
    assert.deepEqual(
      loadTrainingPlan(getScope(), {
        storage,
        normalize: (value) => value as typeof plan,
        createDefault: () => ({ name: "Fallback", days: [] }),
      }),
      { name: "Plan actual", days: ["Lunes", "Martes"] },
    );
    assert.deepEqual(plan.days, ["Martes", "Lunes"]);
    assert.ok(values.has(getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, getScope())));
  }

  {
    const { storage, values } = createStorage();
    const planKey = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, getScope());
    values.set(planKey, "{invalid-json");
    assert.deepEqual(loadTrainingPlan(getScope(), {
      storage,
      normalize: (value) => value as TestTrainingPlan,
      createDefault: () => ({ name: "Fallback" }),
    }), { name: "Fallback" });
    assert.equal(values.has(planKey), false);
  }

  {
    const { storage, values } = createStorage();
    const history = [{ id: "cycle-1" }, { id: "cycle-2" }];
    assert.equal(saveCycleHistory(history, getScope(), { storage }), true);
    assert.deepEqual(loadCycleHistory<{ id: string }>(getScope(), { storage }), history);
    assert.equal(loadCycleHistory<{ id: string }>(getScope(USER_B), { storage }).length, 0);
    assert.ok(values.has(getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.cycleHistory, getScope())));
  }

  {
    const blockedRead = createStorage({ throwOnGet: true }).storage;
    const blockedWrite = createStorage({ throwOnSet: true }).storage;
    const blockedRemove = createStorage({ throwOnRemove: true }).storage;
    assert.deepEqual(loadTrainingPlan(getScope(), {
      storage: blockedRead,
      normalize: (value) => value as TestTrainingPlan,
      createDefault: () => ({ name: "Fallback" }),
    }), { name: "Fallback" });
    assert.equal(saveTrainingPlan({ name: "Plan" }, getScope(), { storage: blockedWrite }), false);
    assert.deepEqual(loadCycleHistory(getScope(), { storage: blockedRead }), []);
    assert.equal(saveCycleHistory([{ id: "cycle" }], getScope(), { storage: blockedWrite }), false);
    assert.doesNotThrow(() => clearActiveFlow("supabase", USER_A, blockedRemove));
    assert.doesNotThrow(() => clearRoutineDraft("supabase", USER_A, blockedRemove));
  }

  {
    assert.deepEqual(loadTrainingPlan(getScope(), {
      storage: null,
      normalize: (value) => value as TestTrainingPlan,
      createDefault: () => ({ name: "Fallback" }),
    }), { name: "Fallback" });
    assert.equal(saveTrainingPlan({ name: "Plan" }, getScope(), { storage: null }), false);
    assert.deepEqual(loadCycleHistory(getScope(), { storage: null }), []);
    assert.equal(saveCycleHistory([], getScope(), { storage: null }), false);
  }

  {
    const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
    assert.equal(existsSync("src/app/page.backup.tsx"), false, "el backup obsoleto no debe existir");
    assert.doesNotMatch(appSource, /dailyReadinessRecord/i, "el root no debe conservar estado readiness sin lectores");
    assert.doesNotMatch(appSource, /function (?:get|save|load|clear)(?:ActiveFlow|RoutineDraft)/);
    assert.doesNotMatch(appSource, /BROWSER_STORAGE_PREFIXES\.(?:activeFlow|routineDraft)/);
    assert.doesNotMatch(appSource, /function (?:save|load)(?:TrainingPlan|CycleHistory)/);
    assert.doesNotMatch(appSource, /BROWSER_STORAGE_PREFIXES\.(?:trainingPlan|cycleHistory)/);
    assert.doesNotMatch(appSource, /window\.sessionStorage|PASSWORD_RECOVERY_STORAGE_KEY/);
    assert.match(appSource, /from "@\/lib\/storage\/app-flow-storage"/);
  }
}

// CASO (tipos) — la única API de lectura exige un resolver y devuelve metadata de recovery.
function runTypeCompatibilityChecks() {
  const { storage } = createStorage();

  // @ts-expect-error las opciones sin resolveSetupRecovery no satisfacen el único contrato de lectura.
  const incompleteRecoveryOptions: LoadRoutineDraftRecoveryOptions<RecoverySetupByDay, TestTrainingPlan, RoutineBuilderDraftRecovery> = { setupDays: TRAINING_DAY_LABELS, normalizeTrainingPlan, storage };
  void incompleteRecoveryOptions;

  // Confirmación positiva: las opciones completas son aceptadas por la API real.
  const recoveryOptions: LoadRoutineDraftRecoveryOptions<RecoverySetupByDay, TestTrainingPlan, RoutineBuilderDraftRecovery> = {
    setupDays: TRAINING_DAY_LABELS,
    resolveSetupRecovery: resolveSetupRecoveryAdapter,
    normalizeTrainingPlan,
    storage,
  };
  const result = loadRoutineDraft("supabase", USER_A, recoveryOptions);
  void result;
}

// CASO (tipos, P3-24B.1) — un RecoveredRoutineDraftStorageRecord ya existente (una VARIABLE, no
// un literal fresco) nunca es asignable al parametro de saveRoutineDraft, porque `recovery` (tipo
// obligatorio en el record recuperado) es incompatible con `recovery?: never` — no depende de
// excess-property-check.
function runSaveRoutineDraftTypeChecks() {
  const recovered: RecoveredRoutineDraftStorageRecord<TestSetupByDay, TestTrainingPlan, RoutineBuilderDraftRecovery> = {
    ...createRoutineDraft(),
    recovery: { kind: "full", code: "routine_draft_recovered" },
  };
  // @ts-expect-error un RecoveredRoutineDraftStorageRecord (variable ya tipada, no literal) no es asignable a PersistableRoutineDraftStorageRecord: recovery es obligatorio ahi y aqui debe estar ausente.
  saveRoutineDraft(recovered);

  // Confirmacion positiva: un record canonico (sin recovery) sigue siendo aceptado sin cast.
  const persistable: PersistableRoutineDraftStorageRecord<TestSetupByDay, TestTrainingPlan> = createRoutineDraft();
  saveRoutineDraft(persistable);
}

run();
runTypeCompatibilityChecks();
runSaveRoutineDraftTypeChecks();
