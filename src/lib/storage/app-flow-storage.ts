import { isActiveFlow, isAppScreen, type ActiveFlow, type Screen } from "@/lib/navigation/app-navigation";
import type { DataMode } from "@/lib/supabase/session";
import {
  BROWSER_STORAGE_PREFIXES,
  getBrowserStorageScope,
  getBrowserLocalStorage,
  getScopedBrowserStorageKey,
  migrateLegacyBrowserStorageToDemo,
  readScopedJson,
  removeBrowserStorageItem,
  writeScopedJson,
  type BrowserStorageLike,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";

export const ROUTINE_DRAFT_VERSION = 1;
export const ACTIVE_FLOW_VERSION = 1;
export const ROUTINE_DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const ACTIVE_FLOW_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface ActiveFlowStorageRecord {
  version: number;
  updatedAt: number;
  dataMode: DataMode;
  userKey: BrowserStorageScope;
  flow: ActiveFlow;
}

export interface RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> {
  version: number;
  updatedAt: number;
  dataMode: DataMode;
  userKey: BrowserStorageScope;
  screen: Screen;
  setupDay: string;
  setupByDay: TSetupByDay;
  trainingPlan: TTrainingPlan;
  isEditingRoutinePlan: boolean;
  routineEditorReturnScreen: Screen | null;
  activeRoutineDay: string;
}

export interface LoadActiveFlowOptions {
  now?: () => number;
  storage?: BrowserStorageLike | null;
}

export interface LoadRoutineDraftOptions<TSetupByDay, TTrainingPlan> {
  setupDays: readonly string[];
  normalizeSetupByDay: (value: unknown) => TSetupByDay;
  normalizeTrainingPlan: (value: unknown) => TTrainingPlan;
  hasSetupDraftContent: (value: TSetupByDay) => boolean;
  now?: () => number;
  storage?: BrowserStorageLike | null;
}

/**
 * Resultado genérico (P3-24B) de una resolución de recuperación de `setupDay`/`setupByDay`,
 * proporcionada por el caller vía `LoadRoutineDraftRecoveryOptions.resolveSetupRecovery`. Este
 * módulo (`app-flow-storage.ts`) NUNCA importa `@/features/routine-builder/*` — desconoce por
 * completo `resolveRoutineBuilderDraftRecovery`/`RoutineBuilderState`; sólo conoce esta forma
 * genérica. La conexión real con la decisión pura de Routine Builder (P3-24A) es responsabilidad
 * de quien construya el callback (hoy sólo los tests de este archivo; P3-26 lo hará desde el
 * root). `TRecovery` es intencionalmente opaco aquí: viaja sin interpretarse hasta el resultado
 * cargado, para que P3-26 pueda distinguir `full`/`partial` sin que storage conozca esa forma.
 */
export type RoutineDraftSetupRecoveryResult<TSetupByDay, TRecovery> =
  | { kind: "restore"; setupDay: string; setupByDay: TSetupByDay; recovery: TRecovery }
  | { kind: "discard"; shouldClearStoredDraft: true };

/**
 * Modo recovery (P3-24B) de `loadRoutineDraft`: reemplaza `normalizeSetupByDay` +
 * `hasSetupDraftContent` (modo legacy) por un único `resolveSetupRecovery`, que recibe
 * `{ setupDay, setupByDay }` crudos (los mismos dos campos hermanos que
 * `normalizeRoutineBuilderDraftInput`, P3-22, ya exige — nunca sólo `setupByDay` solo) y decide
 * completa/parcial/descarte. Deliberadamente NO comparte campos con `LoadRoutineDraftOptions`
 * (ninguno de los dos tiene `normalizeSetupByDay`+`resolveSetupRecovery` a la vez ni
 * `hasSetupDraftContent`+`resolveSetupRecovery` a la vez) para que un objeto-literal que mezcle
 * ambos modos sea rechazado por el chequeo de propiedades excedentes de TypeScript contra AMBOS
 * overloads de `loadRoutineDraft` (ver tests con `@ts-expect-error`).
 */
export interface LoadRoutineDraftRecoveryOptions<TSetupByDay, TTrainingPlan, TRecovery> {
  setupDays: readonly string[];
  resolveSetupRecovery: (input: unknown) => RoutineDraftSetupRecoveryResult<TSetupByDay, TRecovery>;
  normalizeTrainingPlan: (value: unknown) => TTrainingPlan;
  now?: () => number;
  storage?: BrowserStorageLike | null;
}

/**
 * Record cargado en modo recovery: el mismo `RoutineDraftStorageRecord` de siempre, más
 * `recovery` — metadata OBLIGATORIA (no opcional) que sólo existe en el resultado de lectura.
 * `recovery` nunca se escribe por `saveRoutineDraft` (que sigue tipado sólo con
 * `RoutineDraftStorageRecord`, sin `recovery`) ni forma parte del JSON persistido — permite que
 * P3-26 distinga `full`/`partial` sin que el draft guardado en storage cargue ese dato.
 */
export type RecoveredRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan, TRecovery> =
  RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> & { recovery: TRecovery };

/**
 * Contrato de ESCRITURA (P3-24B.1, corrige hallazgo MEDIUM de auditoría): `saveRoutineDraft`
 * acepta esto, no `RoutineDraftStorageRecord` a secas. `recovery?: never` rechaza
 * `RecoveredRoutineDraftStorageRecord<...>` (que tiene `recovery: TRecovery`, obligatorio) por
 * INCOMPATIBILIDAD DE TIPOS real en una propiedad compartida — no por excess-property-check de
 * un literal fresco — por lo que también rechaza una VARIABLE ya tipada como
 * `RecoveredRoutineDraftStorageRecord`, no sólo un objeto literal inline (ver test con
 * `@ts-expect-error` sobre una variable, no un literal). `TRecovery` nunca es `never` en la
 * práctica (siempre es un objeto de metadata real), así que la única forma de satisfacer este
 * tipo es no tener `recovery` en absoluto.
 */
export type PersistableRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> =
  RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> & { recovery?: never };

export interface LoadTrainingPlanOptions<TTrainingPlan> {
  normalize: (value: unknown) => TTrainingPlan;
  createDefault: () => TTrainingPlan;
  storage?: BrowserStorageLike | null;
}

export interface SaveTrainingPlanOptions<TTrainingPlan> {
  serialize?: (plan: TTrainingPlan) => unknown;
  storage?: BrowserStorageLike | null;
}

export interface AppFlowStorageOptions {
  storage?: BrowserStorageLike | null;
}

export function saveActiveFlow(
  flow: ActiveFlowStorageRecord,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage) return;
  writeScopedJson(storage, getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, flow.userKey), flow);
}

export function loadActiveFlow(
  mode: DataMode,
  userId?: string,
  options: LoadActiveFlowOptions = {},
): ActiveFlowStorageRecord | null {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return null;

  try {
    migrateLegacyBrowserStorageToDemo(storage);
    const key = getActiveFlowKey(mode, userId);
    const userKey = getBrowserStorageScope(mode, userId);
    if (!key || !userKey) return null;
    const parsed = readScopedJson(storage, key, isUnknownRecord) as Partial<ActiveFlowStorageRecord> | null;
    if (!parsed) return null;
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    const now = options.now?.() ?? Date.now();
    const isExpired = updatedAt === 0 || now - updatedAt > ACTIVE_FLOW_MAX_AGE_MS;
    if (
      parsed.version !== ACTIVE_FLOW_VERSION ||
      parsed.userKey !== userKey ||
      parsed.dataMode !== mode ||
      !isActiveFlow(parsed.flow) ||
      isExpired
    ) {
      clearActiveFlow(mode, userId, storage);
      return null;
    }

    return {
      version: ACTIVE_FLOW_VERSION,
      updatedAt,
      dataMode: mode,
      userKey,
      flow: parsed.flow,
    };
  } catch {
    clearActiveFlow(mode, userId, storage);
    return null;
  }
}

export function clearActiveFlow(
  mode: DataMode,
  userId?: string,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage) return;
  const key = getActiveFlowKey(mode, userId);
  if (key) removeBrowserStorageItem(storage, key);
}

/**
 * Defensa RUNTIME (P3-24B.1), independiente del chequeo de tipos: reconstruye un objeto nuevo
 * enumerando explícitamente sólo los 11 campos canónicos de `RoutineDraftStorageRecord` — nunca
 * `{ ...draft }` ni pasar `draft` tal cual a `writeScopedJson`. Esto impide que `recovery` (o
 * cualquier otra propiedad extra que un consumidor haya adjuntado, típicamente vía un cast que
 * rompe el contrato de tipos) llegue al JSON persistido, incluso si el tipo lo hubiera permitido.
 */
function toPersistableRoutineDraft<TSetupByDay, TTrainingPlan>(
  draft: PersistableRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan>,
): RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> {
  return {
    version: draft.version,
    updatedAt: draft.updatedAt,
    dataMode: draft.dataMode,
    userKey: draft.userKey,
    screen: draft.screen,
    setupDay: draft.setupDay,
    setupByDay: draft.setupByDay,
    trainingPlan: draft.trainingPlan,
    isEditingRoutinePlan: draft.isEditingRoutinePlan,
    routineEditorReturnScreen: draft.routineEditorReturnScreen,
    activeRoutineDay: draft.activeRoutineDay,
  };
}

export function saveRoutineDraft<TSetupByDay, TTrainingPlan>(
  draft: PersistableRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan>,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage) return;
  const persistable = toPersistableRoutineDraft(draft);
  writeScopedJson(storage, getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.routineDraft, persistable.userKey), persistable);
}

/**
 * `LoadRoutineDraftOptions` (legacy) trae `normalizeSetupByDay` — ausente en
 * `LoadRoutineDraftRecoveryOptions` — por lo que esta propiedad basta como discriminante en
 * tiempo de ejecución entre los dos modos, sin necesitar un campo `kind`/`mode` redundante en las
 * opciones mismas.
 */
function isLegacyLoadRoutineDraftOptions<TSetupByDay, TTrainingPlan, TRecovery>(
  options:
    | LoadRoutineDraftOptions<TSetupByDay, TTrainingPlan>
    | LoadRoutineDraftRecoveryOptions<TSetupByDay, TTrainingPlan, TRecovery>,
): options is LoadRoutineDraftOptions<TSetupByDay, TTrainingPlan> {
  return "normalizeSetupByDay" in options;
}

/**
 * Campos comunes entre el modo legacy y el modo recovery, una vez resuelto `setupDay`: evita
 * duplicar la lógica de `screen`/`isEditingRoutinePlan`/`routineEditorReturnScreen`/
 * `activeRoutineDay` en ambas ramas de `loadRoutineDraft`.
 */
function buildRestoredRoutineDraftCommonFields(
  parsed: Partial<RoutineDraftStorageRecord<unknown, unknown>>,
  setupDays: readonly string[],
  resolvedSetupDay: string,
) {
  return {
    screen: "registro-entrenamiento" as const,
    isEditingRoutinePlan: Boolean(parsed.isEditingRoutinePlan),
    routineEditorReturnScreen: parsed.routineEditorReturnScreen && isAppScreen(parsed.routineEditorReturnScreen)
      ? parsed.routineEditorReturnScreen
      : null,
    activeRoutineDay: typeof parsed.activeRoutineDay === "string" && setupDays.includes(parsed.activeRoutineDay)
      ? parsed.activeRoutineDay
      : resolvedSetupDay,
  };
}

export function loadRoutineDraft<TSetupByDay, TTrainingPlan>(
  mode: DataMode,
  userId: string | undefined,
  options: LoadRoutineDraftOptions<TSetupByDay, TTrainingPlan>,
): RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> | null;
export function loadRoutineDraft<TSetupByDay, TTrainingPlan, TRecovery>(
  mode: DataMode,
  userId: string | undefined,
  options: LoadRoutineDraftRecoveryOptions<TSetupByDay, TTrainingPlan, TRecovery>,
): RecoveredRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan, TRecovery> | null;
export function loadRoutineDraft<TSetupByDay, TTrainingPlan, TRecovery>(
  mode: DataMode,
  userId: string | undefined,
  options:
    | LoadRoutineDraftOptions<TSetupByDay, TTrainingPlan>
    | LoadRoutineDraftRecoveryOptions<TSetupByDay, TTrainingPlan, TRecovery>,
):
  | RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan>
  | RecoveredRoutineDraftStorageRecord<TSetupByDay, TTrainingPlan, TRecovery>
  | null {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return null;

  try {
    migrateLegacyBrowserStorageToDemo(storage);
    const key = getRoutineDraftKey(mode, userId);
    const userKey = getBrowserStorageScope(mode, userId);
    if (!key || !userKey) return null;
    const parsed = readScopedJson(storage, key, isUnknownRecord) as Partial<RoutineDraftStorageRecord<unknown, unknown>> | null;
    if (!parsed) return null;
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    const now = options.now?.() ?? Date.now();
    const isExpired = updatedAt === 0 || now - updatedAt > ROUTINE_DRAFT_MAX_AGE_MS;
    if (
      parsed.version !== ROUTINE_DRAFT_VERSION ||
      parsed.userKey !== userKey ||
      parsed.dataMode !== mode ||
      isExpired
    ) {
      clearRoutineDraft(mode, userId, storage);
      return null;
    }

    if (isLegacyLoadRoutineDraftOptions(options)) {
      const setupDay = typeof parsed.setupDay === "string" && options.setupDays.includes(parsed.setupDay)
        ? parsed.setupDay
        : "Lunes";
      const setupByDay = options.normalizeSetupByDay(parsed.setupByDay);
      if (!options.hasSetupDraftContent(setupByDay)) {
        clearRoutineDraft(mode, userId, storage);
        return null;
      }
      const trainingPlan = options.normalizeTrainingPlan(parsed.trainingPlan);

      return {
        version: ROUTINE_DRAFT_VERSION,
        updatedAt,
        dataMode: mode,
        userKey,
        setupDay,
        setupByDay,
        trainingPlan,
        ...buildRestoredRoutineDraftCommonFields(parsed, options.setupDays, setupDay),
      };
    }

    // Modo recovery (P3-24B): `resolveSetupRecovery` recibe `setupDay`/`setupByDay` crudos como
    // campos hermanos de un mismo objeto — NUNCA sólo `setupByDay` — porque
    // `normalizeRoutineBuilderDraftInput` (P3-22) ya exige leer ambos juntos para producir
    // `activeDay`. El resolver decide completo/parcial/descarte; storage nunca interpreta esa
    // decisión, sólo actúa sobre `kind`/`shouldClearStoredDraft`.
    const recoveryResult = options.resolveSetupRecovery({ setupDay: parsed.setupDay, setupByDay: parsed.setupByDay });
    if (recoveryResult.kind === "discard") {
      clearRoutineDraft(mode, userId, storage);
      return null;
    }

    // El `setupDay` recuperado proviene del resolver (P3-24A), nunca se reconstruye desde el
    // valor crudo ignorando esa decisión — pero se valida defensivamente contra `setupDays`
    // igual que en modo legacy: un `setupDay` inválido devuelto por la callback limpia y
    // retorna null en vez de propagar un día no-canónico al resto de la app.
    if (!options.setupDays.includes(recoveryResult.setupDay)) {
      clearRoutineDraft(mode, userId, storage);
      return null;
    }
    const trainingPlan = options.normalizeTrainingPlan(parsed.trainingPlan);

    return {
      version: ROUTINE_DRAFT_VERSION,
      updatedAt,
      dataMode: mode,
      userKey,
      setupDay: recoveryResult.setupDay,
      setupByDay: recoveryResult.setupByDay,
      trainingPlan,
      ...buildRestoredRoutineDraftCommonFields(parsed, options.setupDays, recoveryResult.setupDay),
      recovery: recoveryResult.recovery,
    };
  } catch {
    clearRoutineDraft(mode, userId, storage);
    return null;
  }
}

export function clearRoutineDraft(
  mode: DataMode,
  userId?: string,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage) return;
  const key = getRoutineDraftKey(mode, userId);
  if (key) removeBrowserStorageItem(storage, key);
}

export function loadTrainingPlan<TTrainingPlan>(
  scope: BrowserStorageScope,
  options: LoadTrainingPlanOptions<TTrainingPlan>,
): TTrainingPlan {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return options.createDefault();

  migrateLegacyBrowserStorageToDemo(storage);
  const storedPlan = readScopedJson(
    storage,
    getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, scope),
    isUnknownRecord,
  );
  return storedPlan ? options.normalize(storedPlan) : options.createDefault();
}

export function saveTrainingPlan<TTrainingPlan>(
  plan: TTrainingPlan,
  scope: BrowserStorageScope,
  options: SaveTrainingPlanOptions<TTrainingPlan> = {},
): boolean {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return false;
  return writeScopedJson(
    storage,
    getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.trainingPlan, scope),
    options.serialize ? options.serialize(plan) : plan,
  );
}

export function loadCycleHistory<TCycleSnapshot>(
  scope: BrowserStorageScope,
  options: AppFlowStorageOptions = {},
): TCycleSnapshot[] {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return [];

  migrateLegacyBrowserStorageToDemo(storage);
  return readScopedJson(
    storage,
    getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.cycleHistory, scope),
    isUnknownArray,
  ) as TCycleSnapshot[] | null ?? [];
}

export function saveCycleHistory<TCycleSnapshot>(
  history: TCycleSnapshot[],
  scope: BrowserStorageScope,
  options: AppFlowStorageOptions = {},
): boolean {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return false;
  return writeScopedJson(
    storage,
    getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.cycleHistory, scope),
    history,
  );
}

function getActiveFlowKey(mode: DataMode, userId?: string) {
  const scope = getBrowserStorageScope(mode, userId);
  return scope ? getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, scope) : null;
}

function getRoutineDraftKey(mode: DataMode, userId?: string) {
  const scope = getBrowserStorageScope(mode, userId);
  return scope ? getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.routineDraft, scope) : null;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
