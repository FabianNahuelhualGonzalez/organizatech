import {
  isActiveFlow,
  type ActiveFlow,
} from "@/lib/navigation/app-navigation";
import type { DataMode } from "@/lib/supabase/session";
import {
  BROWSER_STORAGE_PREFIXES,
  getBrowserLocalStorage,
  getBrowserStorageScope,
  getScopedBrowserStorageKey,
  readScopedJson,
  removeBrowserStorageItem,
  writeScopedJson,
  type BrowserStorageLike,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";

export const NAVIGATION_RESTORATION_VERSION = 1;
export const NAVIGATION_RESTORATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type AuthenticatedPortal = "usuario" | "coach";
export type CoachNavigationDestination =
  | "home"
  | "profile"
  | "calendar"
  | "evaluations"
  | "evaluations-send";

export type NavigationRestorationTarget =
  | { readonly portal: "usuario"; readonly destination: ActiveFlow }
  | { readonly portal: "coach"; readonly destination: CoachNavigationDestination };

export interface NavigationRestorationRecord {
  readonly version: number;
  readonly updatedAt: number;
  readonly userKey: BrowserStorageScope;
  readonly target: NavigationRestorationTarget;
}

interface LoadNavigationRestorationOptions {
  readonly now?: () => number;
  readonly storage?: BrowserStorageLike | null;
}

const COACH_DESTINATIONS: readonly CoachNavigationDestination[] = [
  "home",
  "profile",
  "calendar",
  "evaluations",
  "evaluations-send",
];

export function saveNavigationRestoration(
  userKey: BrowserStorageScope,
  target: NavigationRestorationTarget,
  options: { readonly now?: () => number; readonly storage?: BrowserStorageLike | null } = {},
): void {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return;
  const record: NavigationRestorationRecord = {
    version: NAVIGATION_RESTORATION_VERSION,
    updatedAt: options.now?.() ?? Date.now(),
    userKey,
    target: target.portal === "usuario"
      ? { portal: "usuario", destination: target.destination }
      : { portal: "coach", destination: target.destination },
  };
  writeScopedJson(storage, getNavigationRestorationKey(userKey, target.portal), record);
}

export function loadNavigationRestoration(
  userKey: BrowserStorageScope,
  portal: AuthenticatedPortal,
  options: LoadNavigationRestorationOptions = {},
): NavigationRestorationTarget | null {
  const storage = options.storage === undefined ? getBrowserLocalStorage() : options.storage;
  if (!storage) return null;
  const now = options.now?.() ?? Date.now();
  const key = getNavigationRestorationKey(userKey, portal);
  const parsed = readScopedJson(storage, key, isUnknownRecord);

  if (!parsed && portal === "usuario") {
    return migrateLegacyUserActiveFlow(userKey, storage, now);
  }
  if (!isValidRecord(parsed, userKey, portal, now)) {
    if (parsed) removeBrowserStorageItem(storage, key);
    return null;
  }
  return parsed.target;
}

export function clearNavigationRestoration(
  userKey: BrowserStorageScope | null,
  portal?: AuthenticatedPortal,
  storage = getBrowserLocalStorage(),
): void {
  if (!storage || !userKey) return;
  const portals = portal ? [portal] : ["usuario", "coach"] as const;
  for (const targetPortal of portals) {
    removeBrowserStorageItem(storage, getNavigationRestorationKey(userKey, targetPortal));
  }
  if (!portal || portal === "usuario") {
    removeBrowserStorageItem(storage, getLegacyActiveFlowKey(userKey));
  }
}

export function getNavigationRestorationScope(
  mode: DataMode,
  userId?: string | null,
): BrowserStorageScope | null {
  return getBrowserStorageScope(mode, userId);
}

/**
 * Evita que el render inicial de una identidad nueva reemplace un destino que
 * todavía no se ha restaurado. El scope, y no un booleano global, mantiene el
 * aislamiento entre usuarios y entre demo/Supabase.
 */
export function isNavigationRestorationReadyForScope(
  activeScope: BrowserStorageScope | null,
  restoredScope: BrowserStorageScope | null,
): boolean {
  return activeScope !== null && activeScope === restoredScope;
}

export function resolveCoachNavigationRestorationDestination(
  target: NavigationRestorationTarget | null,
): CoachNavigationDestination {
  return target?.portal === "coach" ? target.destination : "home";
}

function getNavigationRestorationKey(userKey: BrowserStorageScope, portal: AuthenticatedPortal) {
  return `${getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.navigationRestoration, userKey)}:${portal}`;
}

function getLegacyActiveFlowKey(userKey: BrowserStorageScope) {
  return getScopedBrowserStorageKey(BROWSER_STORAGE_PREFIXES.activeFlow, userKey);
}

function migrateLegacyUserActiveFlow(
  userKey: BrowserStorageScope,
  storage: BrowserStorageLike,
  now: number,
): NavigationRestorationTarget | null {
  const legacyKey = getLegacyActiveFlowKey(userKey);
  const legacy = readScopedJson(storage, legacyKey, isUnknownRecord);
  if (!legacy) return null;
  const updatedAt = typeof legacy.updatedAt === "number" ? legacy.updatedAt : 0;
  const dataMode = userKey === "demo" ? "demo" : "supabase";
  if (
    legacy.version !== 1
    || legacy.userKey !== userKey
    || legacy.dataMode !== dataMode
    || !isActiveFlow(legacy.flow)
    || isExpired(updatedAt, now)
  ) {
    removeBrowserStorageItem(storage, legacyKey);
    return null;
  }
  const target = { portal: "usuario", destination: legacy.flow } as const;
  saveNavigationRestoration(userKey, target, { now: () => updatedAt, storage });
  removeBrowserStorageItem(storage, legacyKey);
  return target;
}

function isValidRecord(
  value: unknown,
  userKey: BrowserStorageScope,
  portal: AuthenticatedPortal,
  now: number,
): value is NavigationRestorationRecord {
  if (!isUnknownRecord(value) || value.version !== NAVIGATION_RESTORATION_VERSION) return false;
  if (value.userKey !== userKey || isExpired(value.updatedAt, now)) return false;
  const target = value.target;
  if (!isUnknownRecord(target) || target.portal !== portal) return false;
  return portal === "usuario"
    ? isActiveFlow(target.destination)
    : isCoachNavigationDestination(target.destination);
}

function isExpired(updatedAt: unknown, now: number) {
  return typeof updatedAt !== "number"
    || !Number.isSafeInteger(updatedAt)
    || updatedAt <= 0
    || updatedAt > now
    || now - updatedAt > NAVIGATION_RESTORATION_MAX_AGE_MS;
}

function isCoachNavigationDestination(value: unknown): value is CoachNavigationDestination {
  return typeof value === "string" && COACH_DESTINATIONS.includes(value as CoachNavigationDestination);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
