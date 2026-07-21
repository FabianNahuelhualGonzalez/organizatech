import type { DataMode } from "@/lib/supabase/session";

export type BrowserStorageScope = "demo" | `supabase:${string}`;

export interface BrowserStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface SeenNotificationStorageRecord {
  id: string;
  seenAt: number;
}

export const BROWSER_STORAGE_PREFIXES = {
  exercises: "organizatech:exercises",
  entries: "organizatech:entries",
  trainingSessions: "organizatech:training-sessions",
  trainingPlan: "organizatech:training-plan",
  cycleHistory: "organizatech:cycle-history",
  activeFlow: "organizatech:active-flow",
  routineDraft: "organizatech:routine-draft",
  workoutDraft: "organizatech:workout-draft",
  seenNotifications: "organizatech:seen-notifications-v2",
} as const;

export const LEGACY_BROWSER_STORAGE_KEYS = {
  exercises: "organizatech:exercises",
  entries: "organizatech:entries",
  trainingSessions: "organizatech:training-sessions",
  trainingPlan: "organizatech:training-plan",
  cycleHistory: "organizatech:cycle-history",
  seenNotifications: "organizatech:seen-notifications-v1",
} as const;

export const PASSWORD_RECOVERY_STORAGE_KEY = "organizatech:password-recovery-flow";
export const PASSWORD_RECOVERY_STORAGE_VERSION = 1;
export const PASSWORD_RECOVERY_TTL_MS = 60 * 60 * 1000;

interface PasswordRecoveryStorageRecord {
  version: number;
  startedAt: number;
  expiresAt: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const legacyDemoMigrations: Array<{
  legacyKey: string;
  targetPrefix: string;
  validate: (value: unknown) => boolean;
}> = [
  { legacyKey: LEGACY_BROWSER_STORAGE_KEYS.exercises, targetPrefix: BROWSER_STORAGE_PREFIXES.exercises, validate: isLegacyExerciseArray },
  { legacyKey: LEGACY_BROWSER_STORAGE_KEYS.entries, targetPrefix: BROWSER_STORAGE_PREFIXES.entries, validate: isLegacyEntryArray },
  { legacyKey: LEGACY_BROWSER_STORAGE_KEYS.trainingSessions, targetPrefix: BROWSER_STORAGE_PREFIXES.trainingSessions, validate: isLegacySessionArray },
  { legacyKey: LEGACY_BROWSER_STORAGE_KEYS.trainingPlan, targetPrefix: BROWSER_STORAGE_PREFIXES.trainingPlan, validate: isPlainObject },
  { legacyKey: LEGACY_BROWSER_STORAGE_KEYS.cycleHistory, targetPrefix: BROWSER_STORAGE_PREFIXES.cycleHistory, validate: isLegacyCycleHistoryArray },
  { legacyKey: LEGACY_BROWSER_STORAGE_KEYS.seenNotifications, targetPrefix: BROWSER_STORAGE_PREFIXES.seenNotifications, validate: isLegacySeenNotificationArray },
];

const oldDemoScopedPrefixes = [
  BROWSER_STORAGE_PREFIXES.activeFlow,
  BROWSER_STORAGE_PREFIXES.routineDraft,
  BROWSER_STORAGE_PREFIXES.workoutDraft,
];

export function getBrowserStorageScope(mode: DataMode, userId?: string | null): BrowserStorageScope | null {
  if (mode === "demo") return "demo";
  if (!userId || !UUID_PATTERN.test(userId)) return null;
  return `supabase:${userId.toLowerCase()}`;
}

export function isBrowserStorageScope(value: unknown): value is BrowserStorageScope {
  if (value === "demo") return true;
  if (typeof value !== "string" || !value.startsWith("supabase:")) return false;
  return UUID_PATTERN.test(value.slice("supabase:".length));
}

export function getScopedBrowserStorageKey(prefix: string, scope: BrowserStorageScope) {
  return `${prefix}:${scope}`;
}

export function getBrowserLocalStorage(): BrowserStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getBrowserSessionStorage(): BrowserStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function migrateLegacyBrowserStorageToDemo(storage: BrowserStorageLike): void {
  legacyDemoMigrations.forEach(({ legacyKey, targetPrefix, validate }) => {
    migrateLegacyValue(storage, legacyKey, getScopedBrowserStorageKey(targetPrefix, "demo"), validate);
  });

  oldDemoScopedPrefixes.forEach((prefix) => {
    migrateLegacyValue(
      storage,
      `${prefix}:demo:local`,
      getScopedBrowserStorageKey(prefix, "demo"),
      isPlainObject,
      (value) => ({ ...(value as Record<string, unknown>), userKey: "demo", dataMode: "demo" }),
    );
  });
}

export function readScopedJson<T>(
  storage: BrowserStorageLike,
  key: string,
  validate: (value: unknown) => value is T,
): T | null {
  const raw = safeGet(storage, key);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!validate(parsed)) {
      removeBrowserStorageItem(storage, key);
      return null;
    }
    return parsed;
  } catch {
    removeBrowserStorageItem(storage, key);
    return null;
  }
}

export function writeScopedJson(storage: BrowserStorageLike, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeScopedBrowserStorage(storage: BrowserStorageLike, scope: BrowserStorageScope): void {
  const sharedPrefixes = [
    BROWSER_STORAGE_PREFIXES.trainingPlan,
    BROWSER_STORAGE_PREFIXES.cycleHistory,
    BROWSER_STORAGE_PREFIXES.activeFlow,
    BROWSER_STORAGE_PREFIXES.routineDraft,
    BROWSER_STORAGE_PREFIXES.workoutDraft,
    BROWSER_STORAGE_PREFIXES.seenNotifications,
  ];
  const demoPrefixes = [
    BROWSER_STORAGE_PREFIXES.exercises,
    BROWSER_STORAGE_PREFIXES.entries,
    BROWSER_STORAGE_PREFIXES.trainingSessions,
  ];

  [...sharedPrefixes, ...(scope === "demo" ? demoPrefixes : [])]
    .forEach((prefix) => removeBrowserStorageItem(storage, getScopedBrowserStorageKey(prefix, scope)));
}

export function clearBrowserStorageScope(
  scope: BrowserStorageScope | null,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage || !scope) return;
  removeScopedBrowserStorage(storage, scope);
}

export function loadSeenNotificationRecords(
  storage: BrowserStorageLike,
  scope: BrowserStorageScope,
  maxRecords = 60,
): SeenNotificationStorageRecord[] {
  const key = getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.seenNotifications, scope);
  const parsed = readScopedJson(storage, key, isUnknownArray);
  if (!parsed) return [];

  return parsed
    .map((item): SeenNotificationStorageRecord | null => {
      if (!isPlainObject(item) || typeof item.id !== "string" || typeof item.seenAt !== "number") return null;
      return { id: item.id, seenAt: item.seenAt };
    })
    .filter((item): item is SeenNotificationStorageRecord => Boolean(item))
    .slice(-maxRecords);
}

export function saveSeenNotificationRecords(
  storage: BrowserStorageLike,
  scope: BrowserStorageScope,
  records: SeenNotificationStorageRecord[],
  maxRecords = 60,
): boolean {
  const sanitized = records
    .filter((record) => typeof record.id === "string" && Number.isFinite(record.seenAt))
    .map((record) => ({ id: record.id, seenAt: record.seenAt }))
    .slice(-maxRecords);
  return writeScopedJson(
    storage,
    getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.seenNotifications, scope),
    sanitized,
  );
}

export function startPasswordRecoveryFlow(
  sessionStorage: BrowserStorageLike | null = getBrowserSessionStorage(),
  localStorage: BrowserStorageLike | null = getBrowserLocalStorage(),
  now = Date.now(),
): void {
  if (!sessionStorage) return;
  if (localStorage) removeBrowserStorageItem(localStorage, PASSWORD_RECOVERY_STORAGE_KEY);
  const current = loadPasswordRecoveryFlow(sessionStorage, null, now);
  if (current) return;
  writeScopedJson(sessionStorage, PASSWORD_RECOVERY_STORAGE_KEY, {
    version: PASSWORD_RECOVERY_STORAGE_VERSION,
    startedAt: now,
    expiresAt: now + PASSWORD_RECOVERY_TTL_MS,
  } satisfies PasswordRecoveryStorageRecord);
}

export function loadPasswordRecoveryFlow(
  sessionStorage: BrowserStorageLike | null = getBrowserSessionStorage(),
  localStorage: BrowserStorageLike | null = getBrowserLocalStorage(),
  now = Date.now(),
): PasswordRecoveryStorageRecord | null {
  if (!sessionStorage) return null;
  if (localStorage) removeBrowserStorageItem(localStorage, PASSWORD_RECOVERY_STORAGE_KEY);
  const record = readScopedJson(sessionStorage, PASSWORD_RECOVERY_STORAGE_KEY, isPasswordRecoveryRecord);
  if (!record) return null;
  if (record.expiresAt <= now || record.startedAt > now || record.expiresAt - record.startedAt > PASSWORD_RECOVERY_TTL_MS) {
    removeBrowserStorageItem(sessionStorage, PASSWORD_RECOVERY_STORAGE_KEY);
    return null;
  }
  return record;
}

export function hasStoredPasswordRecoveryFlow(
  sessionStorage: BrowserStorageLike | null = getBrowserSessionStorage(),
): boolean {
  return sessionStorage ? safeGet(sessionStorage, PASSWORD_RECOVERY_STORAGE_KEY) !== null : false;
}

export function clearPasswordRecoveryStorage(
  sessionStorage: BrowserStorageLike | null = getBrowserSessionStorage(),
  localStorage: BrowserStorageLike | null = getBrowserLocalStorage(),
): void {
  if (sessionStorage) removeBrowserStorageItem(sessionStorage, PASSWORD_RECOVERY_STORAGE_KEY);
  if (localStorage) removeBrowserStorageItem(localStorage, PASSWORD_RECOVERY_STORAGE_KEY);
}

function migrateLegacyValue(
  storage: BrowserStorageLike,
  legacyKey: string,
  targetKey: string,
  validate: (value: unknown) => boolean,
  transform?: (value: unknown) => unknown,
) {
  const legacyRaw = safeGet(storage, legacyKey);
  if (legacyRaw === null) return;

  if (safeGet(storage, targetKey) !== null) {
    removeBrowserStorageItem(storage, legacyKey);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch {
    removeBrowserStorageItem(storage, legacyKey);
    return;
  }

  if (!validate(parsed)) {
    removeBrowserStorageItem(storage, legacyKey);
    return;
  }

  const targetRaw = transform ? JSON.stringify(transform(parsed)) : legacyRaw;
  try {
    storage.setItem(targetKey, targetRaw);
  } catch {
    // Preserve the valid legacy value when browser storage cannot accept it.
    removeBrowserStorageItem(storage, targetKey);
    return;
  }

  removeBrowserStorageItem(storage, legacyKey);
}

function isLegacyExerciseArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    isPlainObject(item) && typeof item.id === "string" && typeof item.name === "string");
}

function isLegacyEntryArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    isPlainObject(item)
    && typeof item.id === "string"
    && typeof item.exerciseId === "string"
    && Array.isArray(item.reps));
}

function isLegacySessionArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    isPlainObject(item)
    && typeof item.id === "string"
    && typeof item.trainedDate === "string"
    && Array.isArray(item.entries));
}

function isLegacyCycleHistoryArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    isPlainObject(item)
    && typeof item.id === "string"
    && isPlainObject(item.plan)
    && Array.isArray(item.exercises)
    && Array.isArray(item.entries));
}

function isLegacySeenNotificationArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    typeof item === "string"
    || (isPlainObject(item) && typeof item.id === "string" && typeof item.seenAt === "number"));
}

function isPasswordRecoveryRecord(value: unknown): value is PasswordRecoveryStorageRecord {
  return isPlainObject(value)
    && value.version === PASSWORD_RECOVERY_STORAGE_VERSION
    && typeof value.startedAt === "number"
    && Number.isFinite(value.startedAt)
    && typeof value.expiresAt === "number"
    && Number.isFinite(value.expiresAt);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeGet(storage: BrowserStorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function removeBrowserStorageItem(storage: BrowserStorageLike, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    // Storage cleanup is best effort when the browser blocks persistence.
    return false;
  }
}
