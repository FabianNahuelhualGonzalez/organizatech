export const BREVO_TRANSACTIONAL_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export type BrevoEmailErrorCode =
  | "invalid_request"
  | "provider_unavailable"
  | "provider_rejected"
  | "duplicate_request"
  | "invalid_provider_response";

export class BrevoEmailError extends Error {
  readonly code: BrevoEmailErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly ambiguous: boolean;

  constructor(
    code: BrevoEmailErrorCode,
    retryable: boolean,
    status: number | null = null,
    ambiguous = false,
  ) {
    super("No se pudo procesar el correo transaccional.");
    this.name = "BrevoEmailError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

export interface BrevoTransactionalEmailInput {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  idempotencyKey: string;
  timeoutMilliseconds?: number;
  fetchImpl?: typeof fetch;
}

export interface BrevoTransactionalEmailResult {
  messageId: string;
}

const EMAIL_PATTERN = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_NAMESPACE = "organizatech:email-onboarding:v1";
const MAX_SAFE_PROVIDER_ATTEMPTS = 2;

function validText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function validSingleLineText(value: unknown, maximumLength: number): value is string {
  return validText(value, maximumLength)
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function assertValidInput(input: BrevoTransactionalEmailInput) {
  if (
    !validSingleLineText(input.apiKey, 4096)
    || !validSingleLineText(input.senderEmail, 320)
    || !EMAIL_PATTERN.test(input.senderEmail)
    || !validSingleLineText(input.recipientEmail, 320)
    || !EMAIL_PATTERN.test(input.recipientEmail)
    || !validSingleLineText(input.senderName, 160)
    || !validSingleLineText(input.subject, 998)
    || !validText(input.htmlContent, 1_500_000)
    || !validText(input.textContent, 500_000)
    || !UUID_PATTERN.test(input.idempotencyKey)
    || (
      input.timeoutMilliseconds !== undefined
      && (
        !Number.isSafeInteger(input.timeoutMilliseconds)
        || input.timeoutMilliseconds < 250
        || input.timeoutMilliseconds > 10_000
      )
    )
  ) {
    throw new BrevoEmailError("invalid_request", false);
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isAmbiguousStatus(status: number) {
  return status === 408 || status >= 500;
}

async function isDuplicateIdempotencyResponse(response: Response) {
  if (response.status !== 400) return false;
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 65_536) return false;
  try {
    const payload = await response.json() as unknown;
    return payload !== null
      && typeof payload === "object"
      && !Array.isArray(payload)
      && "code" in payload
      && (payload as { code?: unknown }).code === "duplicate_parameter";
  } catch {
    return false;
  }
}

function validMessageId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 512
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export async function createDeterministicEmailIdempotencyKey(
  components: readonly string[],
) {
  if (
    components.length === 0
    || components.length > 16
    || components.some((component) => (
      component.length === 0
      || component.length > 2048
      || /[\u0000-\u001F\u007F]/.test(component)
    ))
  ) {
    throw new TypeError("Los componentes de idempotencia no son válidos.");
  }

  const canonicalInput = JSON.stringify([IDEMPOTENCY_NAMESPACE, ...components]);
  const canonicalBytes = new TextEncoder().encode(canonicalInput);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", canonicalBytes.slice().buffer as ArrayBuffer),
  );
  const uuidBytes = digest.slice(0, 16);
  uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x80;
  uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;
  const hexadecimal = [...uuidBytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join("-");
}

export async function sendBrevoTransactionalEmail(
  input: BrevoTransactionalEmailInput,
): Promise<BrevoTransactionalEmailResult> {
  assertValidInput(input);
  const requestBody = {
    sender: {
      email: input.senderEmail,
      name: input.senderName,
    },
    to: [
      {
        email: input.recipientEmail,
        contactPixelTrackingConsent: false,
      },
    ],
    subject: input.subject,
    htmlContent: input.htmlContent,
    textContent: input.textContent,
    headers: {
      idempotencyKey: input.idempotencyKey,
    },
  };

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    input.timeoutMilliseconds ?? 3_500,
  );
  try {
    for (let attempt = 1; attempt <= MAX_SAFE_PROVIDER_ATTEMPTS; attempt += 1) {
      try {
        const response = await (input.fetchImpl ?? fetch)(BREVO_TRANSACTIONAL_EMAIL_ENDPOINT, {
          method: "POST",
          headers: {
            accept: "application/json",
            "api-key": input.apiKey,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (!response.ok) {
          if (await isDuplicateIdempotencyResponse(response)) {
            throw new BrevoEmailError("duplicate_request", false, response.status, true);
          }
          throw new BrevoEmailError(
            isRetryableStatus(response.status) ? "provider_unavailable" : "provider_rejected",
            isRetryableStatus(response.status),
            response.status,
            isAmbiguousStatus(response.status),
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new BrevoEmailError("invalid_provider_response", true, response.status, true);
        }
        const messageId = payload && typeof payload === "object" && "messageId" in payload
          ? (payload as { messageId?: unknown }).messageId
          : null;
        if (!validMessageId(messageId)) {
          throw new BrevoEmailError("invalid_provider_response", true, response.status, true);
        }

        return { messageId: messageId.trim() };
      } catch (error) {
        const providerError = error instanceof BrevoEmailError
          ? error
          : new BrevoEmailError("provider_unavailable", true, null, true);
        const canRetrySafely = attempt < MAX_SAFE_PROVIDER_ATTEMPTS
          && providerError.retryable
          && !providerError.ambiguous
          && !abortController.signal.aborted;
        if (!canRetrySafely) throw providerError;
      }
    }
    throw new BrevoEmailError("provider_unavailable", true, null, true);
  } finally {
    clearTimeout(timeout);
  }
}
