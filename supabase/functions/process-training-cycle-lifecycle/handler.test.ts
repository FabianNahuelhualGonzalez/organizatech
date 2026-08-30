import assert from "node:assert/strict";
import test from "node:test";

import { BREVO_TRANSACTIONAL_EMAIL_ENDPOINT } from "../_shared/email-onboarding/brevo-client";
import {
  createTrainingCycleLifecycleWorker,
  type TrainingCycleLifecycleWorkerEnvironment,
} from "./handler";

const environment: TrainingCycleLifecycleWorkerEnvironment = {
  supabaseUrl: "https://qa-project.supabase.co",
  supabaseAnonKey: "qa-anon-key",
  lifecycleRpcSecret: "cycle-lifecycle-rpc-capability-32-chars",
  schedulerSecret: "cycle-lifecycle-scheduler-secret-32-char",
  brevoApiKey: "brevo-test-key",
  senderEmail: "cuentas@organizatech.cl",
  senderName: "Organizatech",
  appUrl: "https://qa.organizatech.cl",
};

const delivery = {
  delivery_id: "10000000-0000-8000-8000-000000000001",
  user_id: "10000000-0000-8000-8000-000000000002",
  portal_scope: "coach",
  cycle_id: "10000000-0000-8000-8000-000000000003",
  notification_id: "10000000-0000-8000-8000-000000000004",
  event_kind: "expires_t1",
  scheduled_on: "2026-09-07",
  idempotency_key: "10000000-0000-8000-8000-000000000005",
  recipient_email: "persona@example.test",
  title: "Mañana termina tu ciclo",
  body: "Puedes extenderlo antes del cierre automático.",
  attempt_token: "10000000-0000-8000-8000-000000000006",
};

function request(secret = environment.schedulerSecret) {
  return new Request("https://edge.example/process-training-cycle-lifecycle", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

test("scheduler válido reclama, envía y completa con estados separados", async () => {
  const rpcBodies: Record<string, unknown>[] = [];
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_training_cycle_lifecycle_deliveries")) {
      rpcBodies.push(JSON.parse(String(init.body)));
      return Response.json([delivery]);
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) {
      providerCalls += 1;
      return Response.json({ messageId: "cycle-message-1" }, { status: 201 });
    }
    if (url.endsWith("/rpc/complete_training_cycle_lifecycle_delivery")) {
      rpcBodies.push(JSON.parse(String(init.body)));
      return Response.json(true);
    }
    throw new Error(`unexpected ${url}`);
  };

  const response = await createTrainingCycleLifecycleWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 202);
  assert.equal(providerCalls, 1);
  assert.deepEqual(rpcBodies[0], {
    p_capability: environment.lifecycleRpcSecret,
    p_limit: 25,
  });
  assert.equal(rpcBodies[1]?.p_outcome, "sent");
  assert.equal(rpcBodies[1]?.p_provider_message_id, "cycle-message-1");
});

test("éxito del proveedor con completion incierta nunca se convierte en retry", async () => {
  const outcomes: unknown[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_training_cycle_lifecycle_deliveries")) {
      return Response.json([delivery]);
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) {
      return Response.json({ messageId: "accepted-unconfirmed" }, { status: 201 });
    }
    if (url.endsWith("/rpc/complete_training_cycle_lifecycle_delivery")) {
      outcomes.push((JSON.parse(String(init.body)) as Record<string, unknown>).p_outcome);
      return new Response("unavailable", { status: 503 });
    }
    throw new Error(`unexpected ${url}`);
  };

  const response = await createTrainingCycleLifecycleWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 202);
  assert.deepEqual(outcomes, ["sent"]);
});

test("secreto scheduler inválido falla antes de tocar RPC o proveedor", async () => {
  let calls = 0;
  const response = await createTrainingCycleLifecycleWorker(environment, async () => {
    calls += 1;
    return Response.json({});
  })(request("incorrect-secret-with-32-characters"));

  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test("configuración de entrega inválida falla antes de reclamar", async () => {
  for (const invalidEnvironment of [
    { ...environment, brevoApiKey: "" },
    { ...environment, senderEmail: "not-an-email" },
    { ...environment, senderName: "" },
    { ...environment, appUrl: "" },
  ]) {
    let calls = 0;
    const response = await createTrainingCycleLifecycleWorker(
      invalidEnvironment,
      async () => {
        calls += 1;
        return Response.json([delivery]);
      },
    )(request());

    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  }
});

test("fallo transitorio se marca retryable sólo después del claim", async () => {
  const outcomes: unknown[] = [];
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_training_cycle_lifecycle_deliveries")) {
      return Response.json([delivery]);
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) {
      providerCalls += 1;
      return Response.json({ code: "rate_limited" }, { status: 429 });
    }
    if (url.endsWith("/rpc/complete_training_cycle_lifecycle_delivery")) {
      outcomes.push((JSON.parse(String(init.body)) as Record<string, unknown>).p_outcome);
      return Response.json(true);
    }
    throw new Error(`unexpected ${url}`);
  };

  const response = await createTrainingCycleLifecycleWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 202);
  assert.equal(providerCalls, 2);
  assert.deepEqual(outcomes, ["failed"]);
});

test("claim sobredimensionado falla cerrado antes de Brevo", async () => {
  let providerCalls = 0;
  const oversized = Array.from({ length: 26 }, () => delivery);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_training_cycle_lifecycle_deliveries")) {
      return Response.json(oversized);
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) providerCalls += 1;
    return Response.json({});
  };

  const response = await createTrainingCycleLifecycleWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test("respuesta RPC chunked excedida se corta antes de parsear o enviar", async () => {
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_training_cycle_lifecycle_deliveries")) {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(" ".repeat(262_145)));
          controller.enqueue(new TextEncoder().encode("[]"));
          controller.close();
        },
      }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) providerCalls += 1;
    return Response.json({});
  };

  const response = await createTrainingCycleLifecycleWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});

test("claim duplicado no puede provocar dos envíos concurrentes", async () => {
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_due_training_cycle_lifecycle_deliveries")) {
      return Response.json([delivery, delivery]);
    }
    if (url === BREVO_TRANSACTIONAL_EMAIL_ENDPOINT) providerCalls += 1;
    return Response.json({});
  };

  const response = await createTrainingCycleLifecycleWorker(environment, fetchImpl)(request());
  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
});
