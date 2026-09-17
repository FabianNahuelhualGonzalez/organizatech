import { BrevoEmailError, sendBrevoTransactionalEmail } from "../_shared/email-onboarding/brevo-client.ts";
import {
  bearerTokenFromRequest,
  getAuthenticatedAuthUser,
  invokeEmailRpc,
} from "../_shared/email-onboarding/supabase-rest.ts";
import { renderCoachLinkEmail, type CoachLinkEmailAudience } from "../_shared/coach-linking/templates.ts";

export interface CoachLinkEmailEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly emailLedgerRpcSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly appUrl: string;
}

interface Delivery {
  deliveryId: string; episodeId: string; studentUserId: string; recipientUserId: string;
  audience: CoachLinkEmailAudience; idempotencyKey: string; recipientEmail: string;
  recipientFirstName: string; coachName: string; studentName: string; attemptToken: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;

function cors(request: Request, appUrl: string): Record<string, string> {
  try {
    const allowed = new URL(appUrl);
    const origin = request.headers.get("origin");
    if (allowed.protocol !== "https:" || allowed.username || allowed.password || origin !== allowed.origin) return {};
    return { "access-control-allow-origin": allowed.origin,
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" };
  } catch { return {}; }
}

function response(request: Request, appUrl: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(request, appUrl),
    "content-type": "application/json", "cache-control": "no-store" } });
}

function safeText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0
    && value.length <= maximum && !/[\u0000-\u001F\u007F]/u.test(value);
}

function parseDeliveries(value: unknown, studentUserId: string): Delivery[] {
  if (!Array.isArray(value) || value.length > 2) throw new TypeError("invalid claim");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("invalid claim");
    const row = item as Record<string, unknown>;
    const delivery: Delivery = {
      deliveryId: String(row.delivery_id ?? ""), episodeId: String(row.episode_id ?? ""),
      studentUserId: String(row.student_user_id ?? ""), recipientUserId: String(row.recipient_user_id ?? ""),
      audience: row.audience as CoachLinkEmailAudience, idempotencyKey: String(row.idempotency_key ?? ""),
      recipientEmail: String(row.recipient_email ?? ""), recipientFirstName: String(row.recipient_first_name ?? ""),
      coachName: String(row.coach_name ?? ""), studentName: String(row.student_name ?? ""),
      attemptToken: String(row.attempt_token ?? ""),
    };
    if (seen.has(delivery.deliveryId)
      || ![delivery.deliveryId, delivery.episodeId, delivery.studentUserId, delivery.recipientUserId,
        delivery.idempotencyKey, delivery.attemptToken].every((candidate) => UUID.test(candidate))
      || delivery.studentUserId !== studentUserId
      || (delivery.audience !== "student" && delivery.audience !== "coach")
      || (delivery.audience === "student" && delivery.recipientUserId !== studentUserId)
      || !EMAIL.test(delivery.recipientEmail)
      || !safeText(delivery.recipientFirstName, 80) || !safeText(delivery.coachName, 201)
      || !safeText(delivery.studentName, 201)) throw new TypeError("invalid claim");
    seen.add(delivery.deliveryId);
    return delivery;
  });
}

function actionUrl(appUrl: string, delivery: Delivery) {
  const url = new URL("/login", appUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("invalid app url");
  if (delivery.audience === "student") {
    url.searchParams.set("tipo", "usuario");
    url.searchParams.set("coachLinkDestination", "profile-coaching");
  } else {
    url.searchParams.set("tipo", "coach");
    url.searchParams.set("coachLinkEpisode", delivery.episodeId);
  }
  return url.toString();
}

async function complete(environment: CoachLinkEmailEnvironment, authorization: string, delivery: Delivery,
  outcome: "sent" | "failed" | "ambiguous", value: string, fetchImpl?: typeof fetch) {
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey, authorization,
    functionName: "complete_own_coach_link_email",
    body: { p_capability: environment.emailLedgerRpcSecret, p_delivery_id: delivery.deliveryId,
      p_attempt_token: delivery.attemptToken, p_outcome: outcome,
      p_provider_message_id: outcome === "sent" ? value : null,
      p_provider_error_code: outcome === "sent" ? null : value }, fetchImpl,
  });
}

async function processDelivery(environment: CoachLinkEmailEnvironment, authorization: string,
  delivery: Delivery, fetchImpl?: typeof fetch) {
  try {
    const rendered = renderCoachLinkEmail({ audience: delivery.audience,
      recipientFirstName: delivery.recipientFirstName, coachName: delivery.coachName,
      studentName: delivery.studentName, actionUrl: actionUrl(environment.appUrl, delivery) });
    const sent = await sendBrevoTransactionalEmail({ apiKey: environment.brevoApiKey,
      senderEmail: environment.senderEmail, senderName: environment.senderName,
      recipientEmail: delivery.recipientEmail, ...rendered,
      idempotencyKey: delivery.idempotencyKey, fetchImpl });
    await complete(environment, authorization, delivery, "sent", sent.messageId, fetchImpl).catch(() => undefined);
  } catch (error) {
    const ambiguous = error instanceof BrevoEmailError && error.ambiguous;
    const code = error instanceof BrevoEmailError ? error.code : "invalid_configuration";
    await complete(environment, authorization, delivery, ambiguous ? "ambiguous" : "failed", code, fetchImpl)
      .catch(() => undefined);
  }
}

export function createCoachLinkEmailHandler(environment: CoachLinkEmailEnvironment, fetchImpl?: typeof fetch) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") {
      const headers = cors(request, environment.appUrl);
      return Object.keys(headers).length
        ? new Response(null, { status: 204, headers })
        : response(request, environment.appUrl, 403, { error: "origin_not_allowed" });
    }
    if (request.method !== "POST") return response(request, environment.appUrl, 405, { error: "method_not_allowed" });
    let authorization: string;
    try { authorization = bearerTokenFromRequest(request); }
    catch { return response(request, environment.appUrl, 401, { error: "unauthorized" }); }
    let body: unknown;
    try { body = await request.json(); } catch { return response(request, environment.appUrl, 400, { error: "invalid_request" }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
      return response(request, environment.appUrl, 400, { error: "invalid_request" });
    }
    try {
      const user = await getAuthenticatedAuthUser({ supabaseUrl: environment.supabaseUrl,
        anonKey: environment.supabaseAnonKey, authorization, fetchImpl });
      const payload = await invokeEmailRpc({ supabaseUrl: environment.supabaseUrl,
        anonKey: environment.supabaseAnonKey, authorization,
        functionName: "claim_own_coach_link_emails",
        body: { p_capability: environment.emailLedgerRpcSecret }, fetchImpl });
      const deliveries = parseDeliveries(payload, user.id);
      await Promise.allSettled(deliveries.map((delivery) => processDelivery(
        environment, authorization, delivery, fetchImpl,
      )));
      return response(request, environment.appUrl, 202, { accepted: true, claimed: deliveries.length });
    } catch {
      return response(request, environment.appUrl, 503, { error: "delivery_unavailable" });
    }
  };
}
