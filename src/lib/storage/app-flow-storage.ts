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

export function saveRoutineDraft<TSetupByDay, TTrainingPlan>(
  draft: RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan>,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage) return;
  writeScopedJson(storage, getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.routineDraft, draft.userKey), draft);
}

export function loadRoutineDraft<TSetupByDay, TTrainingPlan>(
  mode: DataMode,
  userId: string | undefined,
  options: LoadRoutineDraftOptions<TSetupByDay, TTrainingPlan>,
): RoutineDraftStorageRecord<TSetupByDay, TTrainingPlan> | null {
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

    const setupDay = typeof parsed.setupDay === "string" && options.setupDays.includes(parsed.setupDay)
      ? parsed.setupDay
      : "Lunes";
    const trainingPlan = options.normalizeTrainingPlan(parsed.trainingPlan);
    const setupByDay = options.normalizeSetupByDay(parsed.setupByDay);
    if (!options.hasSetupDraftContent(setupByDay)) {
      clearRoutineDraft(mode, userId, storage);
      return null;
    }

    return {
      version: ROUTINE_DRAFT_VERSION,
      updatedAt,
      dataMode: mode,
      userKey,
      screen: "registro-entrenamiento",
      setupDay,
      setupByDay,
      trainingPlan,
      isEditingRoutinePlan: Boolean(parsed.isEditingRoutinePlan),
      routineEditorReturnScreen: parsed.routineEditorReturnScreen && isAppScreen(parsed.routineEditorReturnScreen)
        ? parsed.routineEditorReturnScreen
        : null,
      activeRoutineDay: typeof parsed.activeRoutineDay === "string" && options.setupDays.includes(parsed.activeRoutineDay)
        ? parsed.activeRoutineDay
        : setupDay,
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
