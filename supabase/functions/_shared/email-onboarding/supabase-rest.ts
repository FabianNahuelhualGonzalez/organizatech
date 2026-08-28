export class SupabaseEmailBoundaryError extends Error {
  constructor() {
    super("Transactional email persistence is unavailable.");
    this.name = "SupabaseEmailBoundaryError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 3_000;

function baseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SupabaseEmailBoundaryError();
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new SupabaseEmailBoundaryError();
  }
  return url.toString().replace(/\/$/, "");
}

function apiCredential(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 16_384 || /[\u0000-\u0020\u007F]/.test(normalized)) {
    throw new SupabaseEmailBoundaryError();
  }
  return normalized;
}

function bearerAuthorization(value: string) {
  const normalized = value.trim();
  if (!/^Bearer [^\s]+$/.test(normalized) || normalized.length > 16_400) {
    throw new SupabaseEmailBoundaryError();
  }
  return normalized;
}

function requestTimeoutMilliseconds(value: number | undefined) {
  const normalized = value ?? DEFAULT_REQUEST_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(normalized) || normalized < 250 || normalized > 10_000) {
    throw new SupabaseEmailBoundaryError();
  }
  return normalized;
}

async function safeJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 262_144) {
    throw new SupabaseEmailBoundaryError();
  }
  try {
    return await response.json();
  } catch {
    throw new SupabaseEmailBoundaryError();
  }
}

async function fetchJson(input: {
  readonly url: string;
  readonly init: RequestInit;
  readonly timeoutMilliseconds: number | undefined;
  readonly fetchImpl?: typeof fetch;
}) {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    requestTimeoutMilliseconds(input.timeoutMilliseconds),
  );
  try {
    const response = await (input.fetchImpl ?? fetch)(input.url, {
      ...input.init,
      signal: abortController.signal,
    });
    if (!response.ok) throw new SupabaseEmailBoundaryError();
    return await safeJson(response);
  } catch {
    throw new SupabaseEmailBoundaryError();
  } finally {
    clearTimeout(timeout);
  }
}

export async function invokeEmailRpc(input: {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly authorization: string;
  readonly functionName:
    | "claim_auth_transactional_email"
    | "complete_auth_transactional_email"
    | "claim_own_transactional_welcome_emails"
    | "complete_own_transactional_welcome_email"
    | "claim_due_calendar_reminder_deliveries"
    | "complete_calendar_reminder_delivery";
  readonly body: Readonly<Record<string, unknown>>;
  readonly timeoutMilliseconds?: number;
  readonly fetchImpl?: typeof fetch;
}) {
  const url = baseUrl(input.supabaseUrl);
  const anonKey = apiCredential(input.anonKey);
  const authorization = bearerAuthorization(input.authorization);
  return fetchJson({
    url: `${url}/rest/v1/rpc/${input.functionName}`,
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: anonKey,
        authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.body),
    },
    timeoutMilliseconds: input.timeoutMilliseconds,
    fetchImpl: input.fetchImpl,
  });
}

export async function getAuthenticatedAuthUser(input: {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly authorization: string;
  readonly timeoutMilliseconds?: number;
  readonly fetchImpl?: typeof fetch;
}) {
  const url = baseUrl(input.supabaseUrl);
  const anonKey = apiCredential(input.anonKey);
  const authorization = bearerAuthorization(input.authorization);
  const payload = await fetchJson({
    url: `${url}/auth/v1/user`,
    init: {
      method: "GET",
      headers: {
        accept: "application/json",
        apikey: anonKey,
        authorization,
      },
    },
    timeoutMilliseconds: input.timeoutMilliseconds,
    fetchImpl: input.fetchImpl,
  });
  const record = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const id = typeof record?.id === "string" ? record.id : "";
  const email = typeof record?.email === "string" ? record.email.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(id) || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new SupabaseEmailBoundaryError();
  }
  return { id, email } as const;
}

export function bearerTokenFromRequest(request: Request) {
  return bearerAuthorization(request.headers.get("authorization") ?? "");
}
