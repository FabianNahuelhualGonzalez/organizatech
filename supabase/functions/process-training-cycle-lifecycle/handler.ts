import {
  BrevoEmailError,
  sendBrevoTransactionalEmail,
} from "../_shared/email-onboarding/brevo-client.ts";
import {
  renderTrainingCycleLifecycleEmail,
  type TrainingCycleLifecycleEvent,
} from "../_shared/training-cycle-lifecycle/templates.ts";

export interface TrainingCycleLifecycleWorkerEnvironment {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly lifecycleRpcSecret: string;
  readonly schedulerSecret: string;
  readonly brevoApiKey: string;
  readonly senderEmail: string;
  readonly senderName: string;
  readonly appUrl: string;
}

interface Delivery {
  readonly deliveryId: string;
  readonly userId: string;
  readonly portalScope: "usuario" | "coach";
  readonly cycleId: string;
  readonly notificationId: string;
  readonly eventKind: TrainingCycleLifecycleEvent;
  readonly scheduledOn: string;
  readonly idempotencyKey: string;
  readonly recipientEmail: string;
  readonly title: string;
  readonly body: string;
  readonly attemptToken: string;
}

type DeliveryOutcome = "sent" | "failed" | "rejected" | "ambiguous";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@\u0000-\u001F\u007F]+@[^\s@\u0000-\u001F\u007F]+\.[^\s@\u0000-\u001F\u007F]+$/;
const EVENTS = new Set<TrainingCycleLifecycleEvent>([
  "expires_t3",
  "expires_t2",
  "expires_t1",
  "expires_t0",
  "closed_t1",
]);
const CLAIM_LIMIT = 25;
const MAX_PARALLEL_DELIVERIES = 5;
const RPC_TIMEOUT_MILLISECONDS = 10_000;
const MAX_RPC_RESPONSE_BYTES = 262_144;

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function validSecret(value: string) {
  return value.length >= 32
    && value.length <= 512
    && !/[\u0000-\u0020\u007F]/.test(value);
}

function baseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("invalid boundary");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) {
    throw new TypeError("invalid boundary");
  }
  return url.toString().replace(/\/$/, "");
}

function apiCredential(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 16_384 || /[\u0000-\u0020\u007F]/.test(normalized)) {
    throw new TypeError("invalid boundary");
  }
  return normalized;
}

function validSingleLine(value: string, maximumLength: number) {
  return value.length > 0
    && value.length <= maximumLength
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function validDeliveryConfiguration(
  environment: TrainingCycleLifecycleWorkerEnvironment,
) {
  try {
    if (!validSingleLine(environment.supabaseUrl, 2_048)) return false;
    baseUrl(environment.supabaseUrl);
    apiCredential(environment.supabaseAnonKey);
    const appUrl = new URL(environment.appUrl);
    if (
      !validSingleLine(environment.appUrl, 2_048)
      || appUrl.protocol !== "https:"
      || appUrl.username
      || appUrl.password
    ) {
      return false;
    }
  } catch {
    return false;
  }

  return validSingleLine(environment.brevoApiKey, 4_096)
    && !/\s/.test(environment.brevoApiKey)
    && validSingleLine(environment.senderEmail, 320)
    && EMAIL.test(environment.senderEmail)
    && validSingleLine(environment.senderName, 160);
}

async function readBoundedJson(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RPC_RESPONSE_BYTES)
  ) {
    throw new TypeError("invalid boundary");
  }
  if (!response.body) throw new TypeError("invalid boundary");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RPC_RESPONSE_BYTES) {
        await reader.cancel();
        throw new TypeError("invalid boundary");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TypeError("invalid boundary");
  }
}

async function invokeLifecycleRpc(input: {
  readonly environment: TrainingCycleLifecycleWorkerEnvironment;
  readonly functionName:
    | "claim_due_training_cycle_lifecycle_deliveries"
    | "complete_training_cycle_lifecycle_delivery";
  readonly body: Readonly<Record<string, unknown>>;
  readonly fetchImpl?: typeof fetch;
}) {
  const url = baseUrl(input.environment.supabaseUrl);
  const anonKey = apiCredential(input.environment.supabaseAnonKey);
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    RPC_TIMEOUT_MILLISECONDS,
  );
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${url}/rest/v1/rpc/${input.functionName}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input.body),
        signal: abortController.signal,
      },
    );
    if (!response.ok) {
      throw new TypeError("invalid boundary");
    }
    return await readBoundedJson(response);
  } catch {
    throw new TypeError("invalid boundary");
  } finally {
    clearTimeout(timeout);
  }
}

function parseDeliveries(payload: unknown): Delivery[] {
  if (!Array.isArray(payload) || payload.length > CLAIM_LIMIT) {
    throw new TypeError("invalid claim");
  }
  const deliveries = payload.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError("invalid claim");
    }
    const row = item as Record<string, unknown>;
    const delivery = {
      deliveryId: String(row.delivery_id ?? ""),
      userId: String(row.user_id ?? ""),
      portalScope: String(row.portal_scope ?? ""),
      cycleId: String(row.cycle_id ?? ""),
      notificationId: String(row.notification_id ?? ""),
      eventKind: String(row.event_kind ?? ""),
      scheduledOn: String(row.scheduled_on ?? ""),
      idempotencyKey: String(row.idempotency_key ?? ""),
      recipientEmail: String(row.recipient_email ?? ""),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      attemptToken: String(row.attempt_token ?? ""),
    };
    if (
      ![
        delivery.deliveryId,
        delivery.userId,
        delivery.cycleId,
        delivery.notificationId,
        delivery.idempotencyKey,
        delivery.attemptToken,
      ].every((value) => UUID.test(value))
      || (delivery.portalScope !== "usuario" && delivery.portalScope !== "coach")
      || !EVENTS.has(delivery.eventKind as TrainingCycleLifecycleEvent)
      || !/^\d{4}-\d{2}-\d{2}$/.test(delivery.scheduledOn)
      || !EMAIL.test(delivery.recipientEmail)
      || !delivery.title.trim()
      || delivery.title.length > 120
      || !delivery.body.trim()
      || delivery.body.length > 1000
    ) {
      throw new TypeError("invalid claim");
    }
    return delivery as Delivery;
  });
  if (
    new Set(deliveries.map((delivery) => delivery.deliveryId)).size !== deliveries.length
    || new Set(deliveries.map((delivery) => delivery.idempotencyKey)).size !== deliveries.length
  ) {
    throw new TypeError("invalid claim");
  }
  return deliveries;
}

async function complete(
  environment: TrainingCycleLifecycleWorkerEnvironment,
  delivery: Delivery,
  outcome: DeliveryOutcome,
  value: string,
  fetchImpl?: typeof fetch,
) {
  await invokeLifecycleRpc({
    environment,
    functionName: "complete_training_cycle_lifecycle_delivery",
    body: {
      p_capability: environment.lifecycleRpcSecret,
      p_delivery_id: delivery.deliveryId,
      p_attempt_token: delivery.attemptToken,
      p_outcome: outcome,
      p_provider_message_id: outcome === "sent" ? value : null,
      p_provider_error_code: outcome === "sent" ? null : value,
    },
    fetchImpl,
  });
}

async function processDelivery(
  environment: TrainingCycleLifecycleWorkerEnvironment,
  delivery: Delivery,
  fetchImpl?: typeof fetch,
) {
  let messageId: string;
  try {
    const rendered = renderTrainingCycleLifecycleEmail({
      eventKind: delivery.eventKind,
      scheduledOn: delivery.scheduledOn,
      title: delivery.title,
      body: delivery.body,
      appUrl: environment.appUrl,
    });
    const sent = await sendBrevoTransactionalEmail({
      apiKey: environment.brevoApiKey,
      senderEmail: environment.senderEmail,
      senderName: environment.senderName,
      recipientEmail: delivery.recipientEmail,
      ...rendered,
      idempotencyKey: delivery.idempotencyKey,
      timeoutMilliseconds: 3_500,
      fetchImpl,
    });
    messageId = sent.messageId;
  } catch (error) {
    const ambiguous = error instanceof BrevoEmailError && error.ambiguous;
    const retryable = error instanceof BrevoEmailError && error.retryable;
    const errorCode = error instanceof BrevoEmailError
      ? error.code
      : "invalid_configuration";
    const outcome: DeliveryOutcome = ambiguous
      ? "ambiguous"
      : retryable
        ? "failed"
        : "rejected";
    await complete(environment, delivery, outcome, errorCode, fetchImpl)
      .catch(() => undefined);
    return;
  }

  // A provider success followed by an uncertain completion remains `sending`;
  // SQL reconciles it to terminal `ambiguous`, never to a retryable state.
  await complete(environment, delivery, "sent", messageId, fetchImpl)
    .catch(() => undefined);
}

async function processBounded(
  environment: TrainingCycleLifecycleWorkerEnvironment,
  deliveries: readonly Delivery[],
  fetchImpl?: typeof fetch,
) {
  for (let offset = 0; offset < deliveries.length; offset += MAX_PARALLEL_DELIVERIES) {
    const batch = deliveries.slice(offset, offset + MAX_PARALLEL_DELIVERIES);
    await Promise.allSettled(
      batch.map((delivery) => processDelivery(environment, delivery, fetchImpl)),
    );
  }
}

function jsonResponse(status: number, payload: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export function createTrainingCycleLifecycleWorker(
  environment: TrainingCycleLifecycleWorkerEnvironment,
  fetchImpl?: typeof fetch,
) {
  return async (request: Request) => {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" });
    }
    if (
      !validSecret(environment.schedulerSecret)
      || !validSecret(environment.lifecycleRpcSecret)
      || constantTimeEqual(environment.schedulerSecret, environment.lifecycleRpcSecret)
    ) {
      return jsonResponse(503, { error: "worker_unavailable" });
    }
    const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!constantTimeEqual(supplied, environment.schedulerSecret)) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    if (!validDeliveryConfiguration(environment)) {
      return jsonResponse(503, { error: "worker_unavailable" });
    }

    try {
      const payload = await invokeLifecycleRpc({
        environment,
        functionName: "claim_due_training_cycle_lifecycle_deliveries",
        body: {
          p_capability: environment.lifecycleRpcSecret,
          p_limit: CLAIM_LIMIT,
        },
        fetchImpl,
      });
      const deliveries = parseDeliveries(payload);
      await processBounded(environment, deliveries, fetchImpl);
      return jsonResponse(202, { accepted: true, claimed: deliveries.length });
    } catch {
      return jsonResponse(503, { error: "worker_unavailable" });
    }
  };
}
