import { BrevoEmailError, sendBrevoTransactionalEmail } from "../_shared/email-onboarding/brevo-client.ts";
import { invokeEmailRpc } from "../_shared/email-onboarding/supabase-rest.ts";
import { renderCalendarReminderEmail } from "../_shared/calendar-reminders/templates.ts";

export interface CalendarReminderWorkerEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly calendarReminderRpcSecret: string;
  readonly schedulerSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly appUrl: string;
}

interface Delivery {
  deliveryId: string; userId: string; reminderId: string; occurrenceOn: string;
  idempotencyKey: string; recipientEmail: string; title: string; description: string;
  reminderTime: string; attemptToken: string;
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

function parseDeliveries(payload: unknown): Delivery[] {
  if (!Array.isArray(payload) || payload.length > 25) throw new TypeError("invalid claim");
  return payload.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("invalid claim");
    const row = item as Record<string, unknown>;
    const delivery: Delivery = {
      deliveryId: String(row.delivery_id ?? ""), userId: String(row.user_id ?? ""),
      reminderId: String(row.reminder_id ?? ""), occurrenceOn: String(row.occurrence_on ?? ""),
      idempotencyKey: String(row.idempotency_key ?? ""), recipientEmail: String(row.recipient_email ?? ""),
      title: String(row.title ?? ""), description: String(row.description ?? ""),
      reminderTime: String(row.reminder_time ?? ""), attemptToken: String(row.attempt_token ?? ""),
    };
    if (![delivery.deliveryId, delivery.userId, delivery.reminderId, delivery.idempotencyKey, delivery.attemptToken].every((value) => UUID.test(value))
      || !EMAIL.test(delivery.recipientEmail) || delivery.title.length > 120 || delivery.description.length > 1000) {
      throw new TypeError("invalid claim");
    }
    return delivery;
  });
}

type DeliveryOutcome = "sent" | "failed" | "rejected" | "ambiguous";

async function complete(environment: CalendarReminderWorkerEnvironment, delivery: Delivery, outcome: DeliveryOutcome, value: string, fetchImpl?: typeof fetch) {
  await invokeEmailRpc({
    supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey,
    authorization: `Bearer ${environment.supabaseAnonKey}`,
    functionName: "complete_calendar_reminder_delivery",
    body: { p_capability: environment.calendarReminderRpcSecret, p_delivery_id: delivery.deliveryId,
      p_attempt_token: delivery.attemptToken, p_outcome: outcome,
      p_provider_message_id: outcome === "sent" ? value : null,
      p_provider_error_code: outcome === "sent" ? null : value },
    fetchImpl,
  });
}

export function createCalendarReminderWorker(environment: CalendarReminderWorkerEnvironment, fetchImpl?: typeof fetch) {
  return async (request: Request) => {
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!environment.schedulerSecret || !constantTimeEqual(supplied, environment.schedulerSecret)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    try {
      const payload = await invokeEmailRpc({
        supabaseUrl: environment.supabaseUrl, anonKey: environment.supabaseAnonKey,
        authorization: `Bearer ${environment.supabaseAnonKey}`,
        functionName: "claim_due_calendar_reminder_deliveries",
        body: { p_capability: environment.calendarReminderRpcSecret }, fetchImpl,
      });
      const deliveries = parseDeliveries(payload);
      await Promise.allSettled(deliveries.map(async (delivery) => {
        let messageId: string;
        try {
          const rendered = renderCalendarReminderEmail({ ...delivery, appUrl: environment.appUrl });
          const sent = await sendBrevoTransactionalEmail({ apiKey: environment.brevoApiKey,
            senderEmail: environment.senderEmail, senderName: environment.senderName,
            recipientEmail: delivery.recipientEmail, ...rendered,
            idempotencyKey: delivery.idempotencyKey, fetchImpl });
          messageId = sent.messageId;
        } catch (error) {
          const ambiguous = error instanceof BrevoEmailError && error.ambiguous;
          const retryable = error instanceof BrevoEmailError && error.retryable;
          const code = error instanceof BrevoEmailError ? error.code : "invalid_configuration";
          const outcome: DeliveryOutcome = ambiguous ? "ambiguous" : retryable ? "failed" : "rejected";
          await complete(environment, delivery, outcome, code, fetchImpl).catch(() => undefined);
          return;
        }
        // Si Brevo aceptó el correo pero la confirmación falla, el claim queda en
        // `sending` y SQL lo reconcilia como ambiguo. Nunca se degrada a `failed`,
        // porque eso podría reenviar un mensaje que el proveedor ya entregó.
        await complete(environment, delivery, "sent", messageId, fetchImpl).catch(() => undefined);
      }));
      return new Response(JSON.stringify({ accepted: true, claimed: deliveries.length }), { status: 202, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch {
      return new Response(JSON.stringify({ error: "worker_unavailable" }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
  };
}
