export const INITIAL_AUTH_READ_TIMEOUT_MILLISECONDS = 4_000;
export const INITIAL_AUTH_RETRY_DELAY_MILLISECONDS = 250;
export const AUTH_REFRESH_TRANSPORT_TIMEOUT_MILLISECONDS = 3_000;

const AUTH_REFRESH_PATH_SUFFIX = "/auth/v1/token";
const RETRYABLE_AUTH_RESPONSE_STATUSES = new Set([408, 425, 429]);
const TERMINAL_AUTH_RESPONSE_STATUSES = new Set([400, 401, 403]);

const TRANSIENT_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

const TRANSIENT_ERROR_NAMES = new Set([
  "AbortError",
  "AuthRetryableFetchError",
  "NetworkError",
  "SupabaseAuthReadTimeoutError",
  "TimeoutError",
]);

export interface IdempotentAuthReadOptions {
  timeoutMilliseconds?: number;
  retryDelayMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ResilientSupabaseAuthFetchOptions {
  fetch?: typeof globalThis.fetch;
  authOrigin?: string;
  timeoutMilliseconds?: number;
  captureRefreshIdentityScope?: () => SupabaseAuthRefreshIdentityScope | null;
  onTerminalRefreshRejection?: (
    status: number,
    identityScope: SupabaseAuthRefreshIdentityScope | null,
  ) => void;
}

export interface SupabaseAuthRefreshIdentityScope {
  readonly userId: string;
  readonly sessionEpoch: number;
}

export class SupabaseAuthReadTimeoutError extends Error {
  constructor(timeoutMilliseconds: number) {
    super(`Supabase Auth no respondió dentro de ${timeoutMilliseconds} ms.`);
    this.name = "SupabaseAuthReadTimeoutError";
  }
}

export class SupabaseAuthRefreshTransportError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "SupabaseAuthRefreshTransportError";
    this.status = status;
  }
}

export function isAuthoritativeSupabaseAuthRejection(error: unknown): boolean {
  return errorChain(error).some((candidate) => (
    Boolean(candidate)
    && typeof candidate === "object"
    && (candidate as Record<string, unknown>).authFailureKind === "authoritative_rejection"
  ));
}

export async function runIdempotentAuthReadWithSingleRetry<T>(
  operation: () => Promise<T>,
  options: IdempotentAuthReadOptions = {},
): Promise<T> {
  const timeoutMilliseconds = options.timeoutMilliseconds
    ?? INITIAL_AUTH_READ_TIMEOUT_MILLISECONDS;
  const retryDelayMilliseconds = options.retryDelayMilliseconds
    ?? INITIAL_AUTH_RETRY_DELAY_MILLISECONDS;
  const sleep = options.sleep ?? defaultSleep;

  validateNonNegativeFiniteNumber(timeoutMilliseconds, "timeoutMilliseconds");
  validateNonNegativeFiniteNumber(retryDelayMilliseconds, "retryDelayMilliseconds");

  try {
    return await runWithTimeout(operation, timeoutMilliseconds);
  } catch (error) {
    if (!isTransientSupabaseAuthError(error)) throw error;
    // getSession serializa lecturas mediante el mismo lock. Si la primera quedó colgada,
    // iniciar otra sólo espera ese lock y extiende la pantalla de arranque sin aportar resiliencia.
    if (error instanceof SupabaseAuthReadTimeoutError) throw error;
    await sleep(retryDelayMilliseconds);
    return runWithTimeout(operation, timeoutMilliseconds);
  }
}

export function createResilientSupabaseAuthFetch(
  options: ResilientSupabaseAuthFetchOptions = {},
): typeof globalThis.fetch {
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMilliseconds = options.timeoutMilliseconds
    ?? AUTH_REFRESH_TRANSPORT_TIMEOUT_MILLISECONDS;
  const authOrigin = options.authOrigin ? new URL(options.authOrigin).origin : null;
  validateNonNegativeFiniteNumber(timeoutMilliseconds, "timeoutMilliseconds");

  return async (input, init) => {
    if (!isRefreshTokenRequest(input, init, authOrigin)) {
      return fetchImplementation(input, init);
    }
    const requestIdentityScope = options.captureRefreshIdentityScope?.() ?? null;

    const controller = new AbortController();
    let rejectOnAbort: ((error: SupabaseAuthRefreshTransportError) => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = reject;
    });
    const rejectTransport = () => {
      rejectOnAbort?.(new SupabaseAuthRefreshTransportError(
        "Supabase Auth refresh transport was interrupted.",
        408,
      ));
    };
    controller.signal.addEventListener("abort", rejectTransport, { once: true });

    const inheritedSignal = readRequestSignal(input, init);
    const forwardAbort = () => controller.abort(inheritedSignal?.reason);
    if (inheritedSignal?.aborted) forwardAbort();
    else inheritedSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);

    try {
      const response = await Promise.race([
        fetchImplementation(input, { ...init, signal: controller.signal }),
        aborted,
      ]);
      if (isRetryableAuthResponseStatus(response.status)) {
        throw new SupabaseAuthRefreshTransportError(
          "Supabase Auth refresh transport is temporarily unavailable.",
          response.status,
        );
      }
      if (TERMINAL_AUTH_RESPONSE_STATUSES.has(response.status)) {
        options.onTerminalRefreshRejection?.(response.status, requestIdentityScope);
      }
      return response;
    } catch (error) {
      if (error instanceof SupabaseAuthRefreshTransportError) throw error;
      throw new SupabaseAuthRefreshTransportError(
        "Supabase Auth refresh transport failed.",
        0,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectTransport);
      inheritedSignal?.removeEventListener("abort", forwardAbort);
      rejectOnAbort = null;
    }
  };
}

export function isTransientSupabaseAuthError(error: unknown): boolean {
  for (const candidate of errorChain(error)) {
    if (!candidate || typeof candidate !== "object") continue;

    const record = candidate as Record<string, unknown>;
    const name = readString(record.name);
    if (name && TRANSIENT_ERROR_NAMES.has(name)) return true;

    const code = readString(record.code)?.toUpperCase();
    if (code && TRANSIENT_ERROR_CODES.has(code)) return true;

    const status = readStatus(record.status ?? record.statusCode);
    if (
      status === 408
      || status === 425
      || status === 429
      || (status !== null && status >= 500 && status <= 599)
    ) {
      return true;
    }

    const message = readString(record.message)?.toLowerCase() ?? "";
    if (
      /failed to fetch|fetch failed|network request failed|networkerror|load failed/.test(message)
      || /timed?\s*out|timeout/.test(message)
      || /temporarily unavailable|service unavailable|bad gateway|gateway timeout/.test(message)
      || /connection (?:reset|refused)|socket hang up/.test(message)
    ) {
      return true;
    }
  }

  return false;
}

async function runWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMilliseconds: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new SupabaseAuthReadTimeoutError(timeoutMilliseconds)),
      timeoutMilliseconds,
    );
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function validateNonNegativeFiniteNumber(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} debe ser un número finito no negativo.`);
  }
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let candidate: unknown = error;

  while (candidate && !seen.has(candidate) && chain.length < 5) {
    chain.push(candidate);
    seen.add(candidate);
    if (typeof candidate !== "object" || !("cause" in candidate)) break;
    candidate = (candidate as { cause?: unknown }).cause;
  }

  return chain;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStatus(value: unknown): number | null {
  const status = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(status) ? status : null;
}

function isRefreshTokenRequest(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
  authOrigin?: string | null,
): boolean {
  const request = typeof input === "object" && input !== null
    ? input as { method?: unknown; url?: unknown }
    : null;
  const method = String(init?.method ?? request?.method ?? "GET").toUpperCase();
  if (method !== "POST") return false;

  const rawUrl = typeof input === "string" || input instanceof URL
    ? String(input)
    : typeof request?.url === "string" ? request.url : "";
  try {
    const url = new URL(rawUrl);
    return (!authOrigin || url.origin === authOrigin)
      && url.pathname.endsWith(AUTH_REFRESH_PATH_SUFFIX)
      && url.searchParams.get("grant_type") === "refresh_token";
  } catch {
    return false;
  }
}

function readRequestSignal(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
): AbortSignal | null {
  if (init?.signal) return init.signal;
  if (typeof input !== "object" || input === null || !("signal" in input)) return null;
  return input.signal instanceof AbortSignal ? input.signal : null;
}

function isRetryableAuthResponseStatus(status: number): boolean {
  return RETRYABLE_AUTH_RESPONSE_STATUSES.has(status) || (status >= 500 && status <= 599);
}
