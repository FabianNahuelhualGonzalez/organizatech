import { GOOGLE_OAUTH_INTENT_TTL_MS } from "./google-oauth-intent";
import type { AuthAccountType, AuthRouteState } from "./auth-route";

const MAX_EVENTS = 32;
const TRACE_VERSION = 1;
const STORAGE_KEY = "organizatech.qa.oauth-trace.v1";

type RouteKind = "login_usuario" | "login_coach" | "registro_usuario" | "registro_coach";

export type GoogleOAuthQaTraceEvent =
  | { readonly kind: "portal_requested"; readonly portal: AuthAccountType }
  | { readonly kind: "intent"; readonly state: "found" | "absent" }
  | { readonly kind: "callback"; readonly state: "detected" }
  | { readonly kind: "handoff"; readonly phase: "blocked" | "transferring" | "ready" | "rejected" }
  | { readonly kind: "set_session"; readonly phase: "start" | "end" }
  | { readonly kind: "clean_route"; readonly route: RouteKind }
  | { readonly kind: "auth_event"; readonly event: "INITIAL_SESSION" | "SIGNED_IN" }
  | { readonly kind: "bootstrap" }
  | { readonly kind: "routes"; readonly initial: RouteKind; readonly current: RouteKind }
  | { readonly kind: "backend_portal"; readonly portal: AuthAccountType }
  | { readonly kind: "coach_result"; readonly result: "authorized" | "rejected" | "error" };

export type GoogleOAuthQaTraceEntry = GoogleOAuthQaTraceEvent & {
  readonly order: number;
  readonly elapsedMs: number;
};

export interface GoogleOAuthQaTraceApi {
  read(): readonly GoogleOAuthQaTraceEntry[];
  clear(): void;
}

interface StoredTrace {
  readonly version: typeof TRACE_VERSION;
  readonly attemptId: string;
  /** Internal lifecycle deadline; never returned by the Inspector API. */
  readonly expiresAtMs: number;
  readonly nextOrder: number;
  readonly events: readonly GoogleOAuthQaTraceEntry[];
}

declare global {
  interface Window {
    __organizatechQaOAuthTrace?: GoogleOAuthQaTraceApi;
  }
}

/**
 * QA-only diagnostics. The persisted value contains only a random attempt id,
 * lifecycle metadata and a sanitized event schema; it is never read by Auth.
 */
function createGoogleOAuthQaTraceStore() {
  let enabled = false;
  let trace: StoredTrace | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let configuredWindow: Window | null = null;

  function configure(qaEnabled: boolean) {
    const nextEnabled = qaEnabled && typeof window !== "undefined";
    if (nextEnabled && enabled && configuredWindow === window) return;
    enabled = nextEnabled;
    if (!enabled) {
      clear();
      configuredWindow = null;
      if (typeof window !== "undefined") delete window.__organizatechQaOAuthTrace;
      return;
    }
    trace = loadTrace();
    configuredWindow = window;
    scheduleExpiry();
    installApi();
  }

  function record(event: GoogleOAuthQaTraceEvent) {
    if (!enabled) return;
    const initial = event.kind === "portal_requested" ? createTrace() : getCurrentTrace();
    const remainingMs = getRemainingMs(initial);
    if (remainingMs <= 0) {
      clear();
      return;
    }
    const sanitized = sanitizeEvent(event, initial.nextOrder, GOOGLE_OAUTH_INTENT_TTL_MS - remainingMs);
    if (!sanitized) return;
    trace = {
      ...initial,
      events: [...initial.events.slice(-(MAX_EVENTS - 1)), sanitized],
      nextOrder: initial.nextOrder + 1,
    };
    persistTrace(trace);
    scheduleExpiry();
  }

  function clear() {
    trace = null;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    removePersistedTrace();
  }

  function clearOnSignedOut(event: string) {
    if (event === "SIGNED_OUT") clear();
  }

  function getCurrentTrace(): StoredTrace {
    const current = trace ?? loadTrace();
    if (current) return current;
    return createTrace();
  }

  function createTrace(): StoredTrace {
    const nowMs = Date.now();
    const created: StoredTrace = {
      version: TRACE_VERSION,
      attemptId: createAttemptId(),
      expiresAtMs: nowMs + GOOGLE_OAUTH_INTENT_TTL_MS,
      nextOrder: 1,
      events: [],
    };
    trace = created;
    persistTrace(created);
    return created;
  }

  function loadTrace(): StoredTrace | null {
    const storage = getSessionStorage();
    if (!storage) return null;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
      const stored = sanitizeStoredTrace(parsed);
      if (!stored || getRemainingMs(stored) <= 0) {
        removePersistedTrace();
        return null;
      }
      return stored;
    } catch {
      removePersistedTrace();
      return null;
    }
  }

  function persistTrace(nextTrace: StoredTrace) {
    try {
      getSessionStorage()?.setItem(STORAGE_KEY, JSON.stringify(nextTrace));
    } catch {
      // Diagnostics must never affect OAuth when browser storage is unavailable.
    }
  }

  function removePersistedTrace() {
    try {
      getSessionStorage()?.removeItem(STORAGE_KEY);
    } catch {
      // Diagnostics must never affect OAuth when browser storage is unavailable.
    }
  }

  function scheduleExpiry() {
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    if (!trace) return;
    const remainingMs = getRemainingMs(trace);
    if (remainingMs <= 0) {
      clear();
      return;
    }
    expiryTimer = setTimeout(clear, remainingMs);
  }

  function installApi() {
    if (typeof window === "undefined" || window.__organizatechQaOAuthTrace) return;
    Object.defineProperty(window, "__organizatechQaOAuthTrace", {
      configurable: true,
      value: Object.freeze({
        read: () => Object.freeze((trace?.events ?? []).map((event) => Object.freeze({ ...event }))),
        clear,
      } satisfies GoogleOAuthQaTraceApi),
    });
  }

  return { configure, record, clear, clearOnSignedOut };
}

const qaTraceStore = createGoogleOAuthQaTraceStore();

export const configureGoogleOAuthQaTrace = qaTraceStore.configure;
export const traceGoogleOAuthQaEvent = qaTraceStore.record;
export const clearGoogleOAuthQaTrace = qaTraceStore.clear;
export const clearGoogleOAuthQaTraceOnSignedOut = qaTraceStore.clearOnSignedOut;

export function routeKind(route: AuthRouteState): RouteKind {
  return `${route.mode}_${route.accountType}` as RouteKind;
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function createAttemptId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `00000000-0000-4000-8000-${randomHex(12)}`;
}

function sanitizeStoredTrace(value: unknown): StoredTrace | null {
  if (!isRecord(value)
    || value.version !== TRACE_VERSION
    || !isAttemptId(value.attemptId)
    || typeof value.expiresAtMs !== "number"
    || !Number.isFinite(value.expiresAtMs)
    || typeof value.nextOrder !== "number"
    || !Number.isSafeInteger(value.nextOrder)
    || value.nextOrder < 1
    || !Array.isArray(value.events)) return null;

  const events = value.events
    .map(sanitizeStoredEvent)
    .filter((event): event is GoogleOAuthQaTraceEntry => event !== null)
    .slice(-MAX_EVENTS);
  return {
    version: TRACE_VERSION,
    attemptId: value.attemptId,
    expiresAtMs: Math.min(value.expiresAtMs, Date.now() + GOOGLE_OAUTH_INTENT_TTL_MS),
    nextOrder: value.nextOrder,
    events,
  };
}

function sanitizeStoredEvent(value: unknown): GoogleOAuthQaTraceEntry | null {
  if (!isRecord(value)) return null;
  const { order, elapsedMs } = value;
  if (typeof order !== "number"
    || !Number.isInteger(order)
    || order < 1
    || typeof elapsedMs !== "number"
    || elapsedMs < 0) return null;
  return sanitizeEvent(value as GoogleOAuthQaTraceEvent, order, elapsedMs);
}

function sanitizeEvent(
  event: GoogleOAuthQaTraceEvent,
  order: number,
  elapsedMs: number,
): GoogleOAuthQaTraceEntry | null {
  const common = { order, elapsedMs: Math.max(0, Math.floor(elapsedMs)) } as const;
  switch (event.kind) {
    case "portal_requested":
    case "backend_portal":
      return isPortal(event.portal) ? { kind: event.kind, portal: event.portal, ...common } : null;
    case "intent":
      return event.state === "found" || event.state === "absent" ? { kind: event.kind, state: event.state, ...common } : null;
    case "callback":
      return event.state === "detected" ? { kind: event.kind, state: event.state, ...common } : null;
    case "handoff":
      return ["blocked", "transferring", "ready", "rejected"].includes(event.phase)
        ? { kind: event.kind, phase: event.phase, ...common }
        : null;
    case "set_session":
      return event.phase === "start" || event.phase === "end" ? { kind: event.kind, phase: event.phase, ...common } : null;
    case "clean_route":
      return isRouteKind(event.route) ? { kind: event.kind, route: event.route, ...common } : null;
    case "auth_event":
      return event.event === "INITIAL_SESSION" || event.event === "SIGNED_IN"
        ? { kind: event.kind, event: event.event, ...common }
        : null;
    case "bootstrap":
      return { kind: event.kind, ...common };
    case "routes":
      return isRouteKind(event.initial) && isRouteKind(event.current)
        ? { kind: event.kind, initial: event.initial, current: event.current, ...common }
        : null;
    case "coach_result":
      return ["authorized", "rejected", "error"].includes(event.result)
        ? { kind: event.kind, result: event.result, ...common }
        : null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isPortal(value: unknown): value is AuthAccountType {
  return value === "usuario" || value === "coach";
}

function isRouteKind(value: unknown): value is RouteKind {
  return value === "login_usuario"
    || value === "login_coach"
    || value === "registro_usuario"
    || value === "registro_coach";
}

function isAttemptId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function randomHex(length: number) {
  let result = "";
  while (result.length < length) result += Math.floor(Math.random() * 0x100000000).toString(16);
  return result.slice(0, length);
}

function getRemainingMs(trace: StoredTrace) {
  return Math.max(0, Math.floor(trace.expiresAtMs - Date.now()));
}
