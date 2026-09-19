import { BrevoEmailError, sendBrevoTransactionalEmail } from "../_shared/email-onboarding/brevo-client.ts";
import { invokeEmailRpc } from "../_shared/email-onboarding/supabase-rest.ts";
import { renderEvaluationEmail, type EvaluationEmailEvent } from "../_shared/evaluations/templates.ts";

export interface EvaluationEmailEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly evaluationRpcSecret: string;
  readonly schedulerSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly appUrl: string;
}

interface Delivery {
  readonly deliveryId: string;
  readonly notificationId: string;
  readonly eventKind: EvaluationEmailEvent;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly recipientEmail: string;
  readonly attemptToken: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left); const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function response(status: number, body: Record<string, unknown>, origin = "") {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigin(request: Request, appUrl: string) {
  const origin = request.headers.get("origin") ?? "";
  try { return origin && origin === new URL(appUrl).origin ? origin : ""; } catch { return ""; }
}

function parseDeliveries(value: unknown): Delivery[] {
  if (!Array.isArray(value) || value.length > 25) throw new TypeError("invalid claim");
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("invalid claim");
    const row = candidate as Record<string, unknown>;
    const eventKind = row.event_kind as EvaluationEmailEvent;
    if (!["evaluation_received", "evaluation_sent", "evaluation_completed", "evaluation_due_reminder"].includes(eventKind)
      || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) throw new TypeError("invalid claim");
    const delivery = {
      deliveryId: String(row.delivery_id ?? ""), notificationId: String(row.notification_id ?? ""),
      eventKind, payload: row.payload as Record<string, unknown>,
      idempotencyKey: String(row.idempotency_key ?? ""), recipientEmail: String(row.recipient_email ?? ""),
      attemptToken: String(row.attempt_token ?? ""),
    };
    if (![delivery.deliveryId, delivery.notificationId, delivery.idempotencyKey, delivery.attemptToken].every((item) => UUID.test(item))
      || !EMAIL.test(delivery.recipientEmail)) throw new TypeError("invalid claim");
    return delivery;
  });
}

function actionUrl(appUrl: string, delivery: Delivery) {
  const url = new URL("/login", appUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new TypeError("invalid app url");
  const coach = delivery.eventKind === "evaluation_sent" || delivery.eventKind === "evaluation_completed";
  url.searchParams.set("tipo", coach ? "coach" : "usuario");
  url.searchParams.set("evaluationDestination", coach ? "review" : "list");
  return url.toString();
}

async function complete(environment: EvaluationEmailEnvironment, authorization: string, delivery: Delivery,
  outcome: "sent" | "failed" | "ambiguous", value: string, capability: string | null, fetchImpl?: typeof fetch) {
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey, authorization,
    functionName: "complete_evaluation_email_delivery",
    body: { p_capability: capability, p_delivery_id: delivery.deliveryId, p_attempt_token: delivery.attemptToken,
      p_outcome: outcome, p_provider_message_id: outcome === "sent" ? value : null,
      p_provider_error_code: outcome === "sent" ? null : value }, fetchImpl,
  });
}

export function createEvaluationEmailHandler(environment: EvaluationEmailEnvironment, fetchImpl?: typeof fetch) {
  return async (request: Request) => {
    const origin = allowedOrigin(request, environment.appUrl);
    if (request.method === "OPTIONS") {
      if (!origin) return response(403, { error: "origin_not_allowed" });
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "POST, OPTIONS", vary: "origin",
      } });
    }
    if (request.method !== "POST") return response(405, { error: "method_not_allowed" }, origin);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const scheduler = Boolean(environment.schedulerSecret) && constantTimeEqual(bearer, environment.schedulerSecret);
    if (!scheduler && (!origin || !bearer)) return response(401, { error: "unauthorized" }, origin);
    const authorization = scheduler ? `Bearer ${environment.supabaseAnonKey}` : `Bearer ${bearer}`;
    const capability = environment.evaluationRpcSecret;
    try {
      const claimed = await invokeEmailRpc({
        supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey, authorization,
        functionName: "claim_evaluation_email_deliveries",
        body: { p_capability: capability, p_limit: 25 }, fetchImpl,
      });
      const deliveries = parseDeliveries(claimed);
      await Promise.allSettled(deliveries.map(async (delivery) => {
        try {
          const rendered = renderEvaluationEmail({
            eventKind: delivery.eventKind,
            templateName: String(delivery.payload.templateName ?? ""),
            coachName: delivery.payload.coachName === undefined ? undefined : String(delivery.payload.coachName),
            studentName: delivery.payload.studentName === undefined ? undefined : String(delivery.payload.studentName),
            studentNames: delivery.payload.studentNames === undefined ? undefined : String(delivery.payload.studentNames),
            dueAt: delivery.payload.dueAt === null || delivery.payload.dueAt === undefined ? null : String(delivery.payload.dueAt),
            dueLabel: delivery.payload.dueLabel === null || delivery.payload.dueLabel === undefined ? null : String(delivery.payload.dueLabel),
            actionUrl: actionUrl(environment.appUrl, delivery),
          });
          const sent = await sendBrevoTransactionalEmail({
            apiKey: environment.brevoApiKey, senderEmail: environment.senderEmail,
            senderName: environment.senderName, recipientEmail: delivery.recipientEmail,
            ...rendered, idempotencyKey: delivery.idempotencyKey, fetchImpl,
          });
          await complete(environment, authorization, delivery, "sent", sent.messageId, capability, fetchImpl).catch(() => undefined);
        } catch (error) {
          const ambiguous = error instanceof BrevoEmailError && error.ambiguous;
          const code = error instanceof BrevoEmailError ? error.code : "invalid_configuration";
          await complete(environment, authorization, delivery, ambiguous ? "ambiguous" : "failed", code, capability, fetchImpl).catch(() => undefined);
        }
      }));
      return response(202, { accepted: true, claimed: deliveries.length }, origin);
    } catch {
      return response(503, { error: "worker_unavailable" }, origin);
    }
  };
}
