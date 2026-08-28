import {
  buildAuthActionUrl,
  parseAuthEmailHookPayload,
  type ParsedAuthEmailHookPayload,
} from "../_shared/email-onboarding/auth-hook-payload.ts";
import {
  BrevoEmailError,
  sendBrevoTransactionalEmail,
} from "../_shared/email-onboarding/brevo-client.ts";
import { verifyStandardWebhookSignature } from "../_shared/email-onboarding/standard-webhook-signature.ts";
import {
  invokeEmailRpc,
  SupabaseEmailBoundaryError,
} from "../_shared/email-onboarding/supabase-rest.ts";
import {
  renderEmailTemplate,
  renderNeutralAuthEmail,
} from "../_shared/email-onboarding/templates.ts";

export interface AuthSendEmailHookEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly sendEmailHookSecret: string;
  readonly emailLedgerRpcSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
}

export interface AuthSendEmailHookDependencies {
  readonly environment: AuthSendEmailHookEnvironment;
  readonly fetchImpl?: typeof fetch;
  readonly nowSeconds?: () => number;
}

interface ClaimedAuthDelivery {
  readonly deliveryId: string;
  readonly userId: string;
  readonly templateKey: "auth_confirmation_user" | "auth_confirmation_coach" | "auth_fallback";
  readonly idempotencyKey: string;
  readonly recipientEmail: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly attemptToken: string;
}

const MAX_HOOK_BODY_BYTES = 65_536;

class HookBodyTooLargeError extends Error {}

async function readBoundedUtf8Body(request: Request): Promise<string> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_HOOK_BODY_BYTES) {
        await reader.cancel();
        throw new HookBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}
const AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS = 700;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;
const ORGANIZATECH_CONFIRMATION_TEMPLATES = new Set([
  "auth_confirmation_user",
  "auth_confirmation_coach",
  "auth_fallback",
]);

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedPresentation(value: unknown, maximumLength: number) {
  return typeof value === "string"
    && value.length <= maximumLength
    && !/[\u0000-\u001F\u007F]/.test(value)
    ? value
    : null;
}

function parseClaimedDelivery(
  payload: unknown,
  expected: ParsedAuthEmailHookPayload["deliveries"][number],
  parsedHook: ParsedAuthEmailHookPayload,
): ClaimedAuthDelivery | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  if (payload.length !== 1) throw new SupabaseEmailBoundaryError();
  const record = asRecord(payload[0]);
  const deliveryId = record?.delivery_id;
  const userId = record?.user_id;
  const templateKey = record?.template_key;
  const idempotencyKey = record?.idempotency_key;
  const recipientEmail = typeof record?.recipient_email === "string"
    ? record.recipient_email.trim().toLowerCase()
    : "";
  const firstName = boundedPresentation(record?.first_name, 201);
  const lastName = boundedPresentation(record?.last_name, 120);
  const attemptToken = record?.attempt_token;

  if (
    typeof deliveryId !== "string"
    || !UUID_PATTERN.test(deliveryId)
    || userId !== parsedHook.userId
    || typeof templateKey !== "string"
    || !ORGANIZATECH_CONFIRMATION_TEMPLATES.has(templateKey)
    || (parsedHook.action !== "signup" && templateKey !== "auth_fallback")
    || typeof idempotencyKey !== "string"
    || !UUID_PATTERN.test(idempotencyKey)
    || !EMAIL_PATTERN.test(recipientEmail)
    || recipientEmail !== expected.recipientEmail
    || firstName === null
    || lastName === null
    || typeof attemptToken !== "string"
    || !UUID_PATTERN.test(attemptToken)
  ) {
    throw new SupabaseEmailBoundaryError();
  }

  return {
    deliveryId,
    userId,
    templateKey: templateKey as ClaimedAuthDelivery["templateKey"],
    idempotencyKey,
    recipientEmail,
    firstName,
    lastName,
    attemptToken,
  };
}

function authRpcAuthorization(anonKey: string) {
  return `Bearer ${anonKey.trim()}`;
}

function renderedAuthEmail(
  parsedHook: ParsedAuthEmailHookPayload,
  expected: ParsedAuthEmailHookPayload["deliveries"][number],
  claimed: ClaimedAuthDelivery,
  authOrigin: string,
) {
  if (parsedHook.action === "reauthentication") {
    if (!expected.oneTimeCode || !parsedHook.redirectTo) {
      throw new TypeError("Invalid Auth reauthentication email.");
    }
    return renderNeutralAuthEmail({
      action: parsedHook.action,
      actionUrl: parsedHook.redirectTo,
      verificationCode: expected.oneTimeCode,
      firstName: claimed.firstName,
      lastName: claimed.lastName,
    });
  }

  const destinationUrl = parsedHook.redirectTo ?? parsedHook.siteUrl;
  const actionUrl = expected.tokenHash && destinationUrl
    ? buildAuthActionUrl({
      supabaseUrl: authOrigin,
      tokenHash: expected.tokenHash,
      action: parsedHook.action,
      redirectTo: destinationUrl,
    })
    : destinationUrl;
  if (!actionUrl) throw new TypeError("Invalid Auth email action URL.");

  if (claimed.templateKey === "auth_confirmation_user") {
    return renderEmailTemplate({
      kind: "confirmation_user",
      actionUrl,
      firstName: claimed.firstName,
    });
  }
  if (claimed.templateKey === "auth_confirmation_coach") {
    return renderEmailTemplate({
      kind: "confirmation_coach",
      actionUrl,
      firstName: claimed.firstName,
    });
  }
  return renderNeutralAuthEmail({
    action: parsedHook.action,
    actionUrl,
    firstName: claimed.firstName,
    lastName: claimed.lastName,
  });
}

function completionErrorCode(error: unknown) {
  if (error instanceof BrevoEmailError) {
    if (error.ambiguous) return null;
    return error.code;
  }
  return "invalid_configuration";
}

async function completeDelivery(input: {
  readonly dependencies: AuthSendEmailHookDependencies;
  readonly rawBody: string;
  readonly claimed: ClaimedAuthDelivery;
  readonly outcome: "sent" | "failed";
  readonly providerMessageId?: string;
  readonly providerErrorCode?: string;
}) {
  const { environment } = input.dependencies;
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl,
    anonKey: environment.supabaseAnonKey,
    authorization: authRpcAuthorization(environment.supabaseAnonKey),
    functionName: "complete_auth_transactional_email",
    body: {
      p_payload: input.rawBody,
      p_capability: environment.emailLedgerRpcSecret,
      p_delivery_id: input.claimed.deliveryId,
      p_attempt_token: input.claimed.attemptToken,
      p_outcome: input.outcome,
      p_provider_message_id: input.providerMessageId ?? null,
      p_provider_error_code: input.providerErrorCode ?? null,
    },
    timeoutMilliseconds: AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS,
    fetchImpl: input.dependencies.fetchImpl,
  });
}

async function processDelivery(input: {
  readonly dependencies: AuthSendEmailHookDependencies;
  readonly rawBody: string;
  readonly eventId: string;
  readonly parsedHook: ParsedAuthEmailHookPayload;
  readonly delivery: ParsedAuthEmailHookPayload["deliveries"][number];
}) {
  const { environment } = input.dependencies;
  const claimPayload = await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl,
    anonKey: environment.supabaseAnonKey,
    authorization: authRpcAuthorization(environment.supabaseAnonKey),
    functionName: "claim_auth_transactional_email",
    body: {
      p_payload: input.rawBody,
      p_recipient_slot: input.delivery.slot,
      p_event_id: input.eventId,
      p_capability: environment.emailLedgerRpcSecret,
    },
    timeoutMilliseconds: AUTH_LEDGER_REQUEST_TIMEOUT_MILLISECONDS,
    fetchImpl: input.dependencies.fetchImpl,
  });
  const claimed = parseClaimedDelivery(claimPayload, input.delivery, input.parsedHook);
  if (!claimed) return;

  let providerMessageId: string;
  try {
    const rendered = renderedAuthEmail(
      input.parsedHook,
      input.delivery,
      claimed,
      environment.supabaseUrl,
    );
    const result = await sendBrevoTransactionalEmail({
      apiKey: environment.brevoApiKey,
      senderEmail: environment.senderEmail,
      senderName: environment.senderName,
      recipientEmail: claimed.recipientEmail,
      subject: rendered.subject,
      htmlContent: rendered.htmlContent,
      textContent: rendered.textContent,
      idempotencyKey: claimed.idempotencyKey,
      timeoutMilliseconds: 2_500,
      fetchImpl: input.dependencies.fetchImpl,
    });
    providerMessageId = result.messageId;
  } catch (error) {
    const providerErrorCode = completionErrorCode(error);
    if (providerErrorCode) {
      try {
        await completeDelivery({
          dependencies: input.dependencies,
          rawBody: input.rawBody,
          claimed,
          outcome: "failed",
          providerErrorCode,
        });
      } catch {
        // The signed Auth transaction must not depend on provider trace finalization.
      }
    }
    return;
  }

  try {
    await completeDelivery({
      dependencies: input.dependencies,
      rawBody: input.rawBody,
      claimed,
      outcome: "sent",
      providerMessageId,
    });
  } catch {
    // A sent-but-unrecorded response is uncertain; keep pending for reconciliation.
  }
}

export function createAuthSendEmailHookHandler(
  dependencies: AuthSendEmailHookDependencies,
) {
  return async function handleAuthSendEmailHook(request: Request): Promise<Response> {
    if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_HOOK_BODY_BYTES) {
      return jsonResponse(413, { error: "invalid_request" });
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedUtf8Body(request);
    } catch (error) {
      if (error instanceof HookBodyTooLargeError) {
        return jsonResponse(413, { error: "invalid_request" });
      }
      return jsonResponse(400, { error: "invalid_request" });
    }

    const { environment } = dependencies;
    const isVerified = await verifyStandardWebhookSignature({
      rawBody,
      headers: request.headers,
      secret: environment.sendEmailHookSecret,
      nowSeconds: dependencies.nowSeconds?.(),
    });
    if (!isVerified) return jsonResponse(401, { error: "invalid_signature" });

    let parsedHook: ParsedAuthEmailHookPayload;
    try {
      parsedHook = parseAuthEmailHookPayload(rawBody);
    } catch {
      return jsonResponse(400, { error: "invalid_request" });
    }

    const eventId = request.headers.get("webhook-id")?.trim() ?? "";
    await Promise.allSettled(parsedHook.deliveries.map((delivery) => processDelivery({
      dependencies,
      rawBody,
      eventId,
      parsedHook,
      delivery,
    })));

    // Supabase expects an empty JSON object. Provider/ledger failures are kept
    // server-side and never roll back an otherwise valid Auth transaction.
    return jsonResponse(200, {});
  };
}
