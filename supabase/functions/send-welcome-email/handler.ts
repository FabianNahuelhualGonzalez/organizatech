import {
  BrevoEmailError,
  sendBrevoTransactionalEmail,
} from "../_shared/email-onboarding/brevo-client.ts";
import {
  bearerTokenFromRequest,
  getAuthenticatedAuthUser,
  invokeEmailRpc,
  SupabaseEmailBoundaryError,
} from "../_shared/email-onboarding/supabase-rest.ts";
import {
  renderEmailTemplate,
  type OrganizatechEmailTemplateKind,
} from "../_shared/email-onboarding/templates.ts";

export interface WelcomeEmailEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly emailLedgerRpcSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly appUrl: string;
}

export interface WelcomeEmailDependencies {
  readonly environment: WelcomeEmailEnvironment;
  readonly fetchImpl?: typeof fetch;
}

interface ClaimedWelcomeDelivery {
  readonly deliveryId: string;
  readonly userId: string;
  readonly templateKey: "welcome_user" | "welcome_coach";
  readonly idempotencyKey: string;
  readonly recipientEmail: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly attemptToken: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;
const WELCOME_INTERNAL_REQUEST_TIMEOUT_MILLISECONDS = 1_000;
const TEMPLATE_MAP: Readonly<Record<
  ClaimedWelcomeDelivery["templateKey"],
  OrganizatechEmailTemplateKind
>> = {
  welcome_user: "welcome_user",
  welcome_coach: "welcome_coach",
};

function allowedOrigin(appUrl: string) {
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function corsHeaders(request: Request, appUrl: string): Record<string, string> {
  const configuredOrigin = allowedOrigin(appUrl);
  const requestOrigin = request.headers.get("origin");
  if (!configuredOrigin || requestOrigin !== configuredOrigin) return {};
  return {
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": configuredOrigin,
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function jsonResponse(
  request: Request,
  appUrl: string,
  status: number,
  body: Readonly<Record<string, unknown>>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, appUrl),
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

function parseClaimedWelcomeDeliveries(
  payload: unknown,
  authenticatedUser: { readonly id: string; readonly email: string },
): ClaimedWelcomeDelivery[] {
  if (!Array.isArray(payload) || payload.length > 2) {
    throw new SupabaseEmailBoundaryError();
  }
  const seen = new Set<string>();
  return payload.map((value) => {
    const record = asRecord(value);
    const deliveryId = record?.delivery_id;
    const userId = record?.user_id;
    const templateKey = record?.template_key;
    const idempotencyKey = record?.idempotency_key;
    const recipientEmail = typeof record?.recipient_email === "string"
      ? record.recipient_email.trim().toLowerCase()
      : "";
    const firstName = boundedPresentation(record?.first_name, 80);
    const lastName = boundedPresentation(record?.last_name, 120);
    const attemptToken = record?.attempt_token;

    if (
      typeof deliveryId !== "string"
      || !UUID_PATTERN.test(deliveryId)
      || seen.has(deliveryId)
      || userId !== authenticatedUser.id
      || (templateKey !== "welcome_user" && templateKey !== "welcome_coach")
      || typeof idempotencyKey !== "string"
      || !UUID_PATTERN.test(idempotencyKey)
      || !EMAIL_PATTERN.test(recipientEmail)
      || recipientEmail !== authenticatedUser.email
      || firstName === null
      || lastName === null
      || typeof attemptToken !== "string"
      || !UUID_PATTERN.test(attemptToken)
    ) {
      throw new SupabaseEmailBoundaryError();
    }
    seen.add(deliveryId);
    return {
      deliveryId,
      userId,
      templateKey,
      idempotencyKey,
      recipientEmail,
      firstName,
      lastName,
      attemptToken,
    };
  });
}

function completionErrorCode(error: unknown) {
  if (error instanceof BrevoEmailError) {
    if (error.ambiguous) return null;
    return error.code;
  }
  return "invalid_configuration";
}

async function completeWelcomeDelivery(input: {
  readonly dependencies: WelcomeEmailDependencies;
  readonly authorization: string;
  readonly delivery: ClaimedWelcomeDelivery;
  readonly outcome: "sent" | "failed";
  readonly providerMessageId?: string;
  readonly providerErrorCode?: string;
}) {
  const { environment } = input.dependencies;
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl,
    anonKey: environment.supabaseAnonKey,
    authorization: input.authorization,
    functionName: "complete_own_transactional_welcome_email",
    body: {
      p_capability: environment.emailLedgerRpcSecret,
      p_delivery_id: input.delivery.deliveryId,
      p_attempt_token: input.delivery.attemptToken,
      p_outcome: input.outcome,
      p_provider_message_id: input.providerMessageId ?? null,
      p_provider_error_code: input.providerErrorCode ?? null,
    },
    timeoutMilliseconds: WELCOME_INTERNAL_REQUEST_TIMEOUT_MILLISECONDS,
    fetchImpl: input.dependencies.fetchImpl,
  });
}

async function processWelcomeDelivery(input: {
  readonly dependencies: WelcomeEmailDependencies;
  readonly authorization: string;
  readonly delivery: ClaimedWelcomeDelivery;
}) {
  const { environment } = input.dependencies;
  let providerMessageId: string;
  try {
    const rendered = renderEmailTemplate({
      kind: TEMPLATE_MAP[input.delivery.templateKey],
      actionUrl: environment.appUrl,
      firstName: input.delivery.firstName,
      lastName: input.delivery.lastName,
    });
    const result = await sendBrevoTransactionalEmail({
      apiKey: environment.brevoApiKey,
      senderEmail: environment.senderEmail,
      senderName: environment.senderName,
      recipientEmail: input.delivery.recipientEmail,
      subject: rendered.subject,
      htmlContent: rendered.htmlContent,
      textContent: rendered.textContent,
      idempotencyKey: input.delivery.idempotencyKey,
      timeoutMilliseconds: 3_000,
      fetchImpl: input.dependencies.fetchImpl,
    });
    providerMessageId = result.messageId;
  } catch (error) {
    const providerErrorCode = completionErrorCode(error);
    if (providerErrorCode) {
      try {
        await completeWelcomeDelivery({
          ...input,
          outcome: "failed",
          providerErrorCode,
        });
      } catch {
        // A delivery trace failure cannot change an already-created membership.
      }
    }
    return;
  }

  try {
    await completeWelcomeDelivery({
      ...input,
      outcome: "sent",
      providerMessageId,
    });
  } catch {
    // A sent-but-unrecorded response is uncertain; keep pending for reconciliation.
  }
}

function isEmptyJsonObject(rawBody: string) {
  if (rawBody.length < 2 || rawBody.length > 128) return false;
  try {
    const parsed = JSON.parse(rawBody);
    return asRecord(parsed) !== null && Object.keys(parsed as Record<string, unknown>).length === 0;
  } catch {
    return false;
  }
}

export function createWelcomeEmailHandler(dependencies: WelcomeEmailDependencies) {
  return async function handleWelcomeEmail(request: Request): Promise<Response> {
    const { environment } = dependencies;
    if (request.method === "OPTIONS") {
      if (!Object.keys(corsHeaders(request, environment.appUrl)).length) {
        return jsonResponse(request, environment.appUrl, 403, { error: "origin_not_allowed" });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, environment.appUrl),
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(request, environment.appUrl, 405, { error: "method_not_allowed" });
    }

    let authorization: string;
    try {
      authorization = bearerTokenFromRequest(request);
    } catch {
      return jsonResponse(request, environment.appUrl, 401, { error: "unauthorized" });
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return jsonResponse(request, environment.appUrl, 400, { error: "invalid_request" });
    }
    if (!isEmptyJsonObject(rawBody)) {
      return jsonResponse(request, environment.appUrl, 400, { error: "invalid_request" });
    }

    let authenticatedUser: { readonly id: string; readonly email: string };
    try {
      authenticatedUser = await getAuthenticatedAuthUser({
        supabaseUrl: environment.supabaseUrl,
        anonKey: environment.supabaseAnonKey,
        authorization,
        timeoutMilliseconds: WELCOME_INTERNAL_REQUEST_TIMEOUT_MILLISECONDS,
        fetchImpl: dependencies.fetchImpl,
      });
    } catch {
      return jsonResponse(request, environment.appUrl, 401, { error: "unauthorized" });
    }

    try {
      const claimPayload = await invokeEmailRpc({
        supabaseUrl: environment.supabaseUrl,
        anonKey: environment.supabaseAnonKey,
        authorization,
        functionName: "claim_own_transactional_welcome_emails",
        body: { p_capability: environment.emailLedgerRpcSecret },
        timeoutMilliseconds: WELCOME_INTERNAL_REQUEST_TIMEOUT_MILLISECONDS,
        fetchImpl: dependencies.fetchImpl,
      });
      const deliveries = parseClaimedWelcomeDeliveries(claimPayload, authenticatedUser);
      await Promise.allSettled(deliveries.map((delivery) => processWelcomeDelivery({
        dependencies,
        authorization,
        delivery,
      })));
    } catch {
      // The authenticated registration result stays authoritative; retries are ledger-backed.
    }

    return jsonResponse(request, environment.appUrl, 202, { accepted: true });
  };
}
