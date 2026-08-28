import assert from "node:assert/strict";
import test from "node:test";

import { createWelcomeEmailHandler } from "./handler";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ATTACKER_ID = "99999999-9999-4999-8999-999999999999";
const DELIVERY_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-8333-8333-333333333333";
const ATTEMPT_TOKEN = "44444444-4444-4444-8444-444444444444";
const SUPABASE_URL = "https://project-ref.supabase.co";
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const AUTHORIZATION = "Bearer authenticated-user-jwt-for-tests";

const environment = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: "public-anon-key-for-tests",
  emailLedgerRpcSecret: "edge-ledger-capability-for-tests",
  brevoApiKey: "brevo-api-key-for-tests",
  senderEmail: "no-reply@organizatech.example",
  senderName: "Organizatech",
  appUrl: "https://app.organizatech.example/",
};

interface CapturedCall {
  readonly url: string;
  readonly init?: RequestInit;
}

function responseJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function request(body = "{}", authorization = AUTHORIZATION) {
  return new Request("https://edge.example/send-welcome-email", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      origin: "https://app.organizatech.example",
    },
    body,
  });
}

function welcomeFetch(input: {
  authUserId?: string;
  authEmail?: string;
  claimedUserId?: string;
  claimedEmail?: string;
  templateKey?: string;
  providerStatus?: number;
  providerAmbiguous?: "network" | "invalid-json" | "server" | "duplicate";
  emptyClaim?: boolean;
} = {}) {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });
    if (requestUrl === `${SUPABASE_URL}/auth/v1/user`) {
      return responseJson({
        id: input.authUserId ?? USER_ID,
        email: input.authEmail ?? "owner@example.com",
      });
    }
    if (requestUrl.endsWith("/rest/v1/rpc/claim_own_transactional_welcome_emails")) {
      if (input.emptyClaim) return responseJson([]);
      return responseJson([{
        delivery_id: DELIVERY_ID,
        user_id: input.claimedUserId ?? USER_ID,
        template_key: input.templateKey ?? "welcome_user",
        idempotency_key: IDEMPOTENCY_KEY,
        recipient_email: input.claimedEmail ?? "owner@example.com",
        first_name: "Ada",
        last_name: "Lovelace",
        attempt_token: ATTEMPT_TOKEN,
      }]);
    }
    if (requestUrl === BREVO_URL) {
      if (input.providerAmbiguous === "network") throw new Error("private network detail");
      if (input.providerAmbiguous === "invalid-json") {
        return new Response("not-json", { status: 200 });
      }
      if (input.providerAmbiguous === "server") {
        return responseJson({ code: "private provider detail" }, 503);
      }
      if (input.providerAmbiguous === "duplicate") {
        return responseJson({ code: "duplicate_parameter" }, 400);
      }
      if (input.providerStatus && input.providerStatus !== 200) {
        return responseJson({ code: "private provider detail" }, input.providerStatus);
      }
      return responseJson({ messageId: "brevo-message-welcome-01" });
    }
    if (requestUrl.endsWith("/rest/v1/rpc/complete_own_transactional_welcome_email")) {
      return responseJson(true);
    }
    return assert.fail(`fetch inesperado: ${requestUrl}`);
  };
  return { calls, fetchImpl };
}

function requestBody(call: CapturedCall) {
  const body = call.init?.body;
  assert.equal(typeof body, "string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

test("bienvenida deriva destinatario del JWT y template del claim own", async () => {
  const transport = welcomeFetch({ templateKey: "welcome_user" });
  const handler = createWelcomeEmailHandler({ environment, fetchImpl: transport.fetchImpl });
  const response = await handler(request());

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.deepEqual(transport.calls.map(({ url }) => url), [
    `${SUPABASE_URL}/auth/v1/user`,
    `${SUPABASE_URL}/rest/v1/rpc/claim_own_transactional_welcome_emails`,
    BREVO_URL,
    `${SUPABASE_URL}/rest/v1/rpc/complete_own_transactional_welcome_email`,
  ]);

  assert.equal(transport.calls[0]!.init?.method, "GET");
  assert.equal(transport.calls[0]!.init?.body, undefined);
  assert.deepEqual(requestBody(transport.calls[1]!), {
    p_capability: environment.emailLedgerRpcSecret,
  });
  const rpcHeaders = new Headers(transport.calls[1]!.init?.headers);
  assert.equal(rpcHeaders.get("authorization"), AUTHORIZATION);

  const provider = requestBody(transport.calls[2]!);
  assert.deepEqual(provider.to, [{
    email: "owner@example.com",
    contactPixelTrackingConsent: false,
  }]);
  assert.deepEqual(provider.headers, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(String(provider.htmlContent).includes("Bienvenido a Organizatech"), true);

  assert.deepEqual(requestBody(transport.calls[3]!), {
    p_capability: environment.emailLedgerRpcSecret,
    p_delivery_id: DELIVERY_ID,
    p_attempt_token: ATTEMPT_TOKEN,
    p_outcome: "sent",
    p_provider_message_id: "brevo-message-welcome-01",
    p_provider_error_code: null,
  });
});

test("mass assignment y portal falsificado se rechazan antes de consultar Auth", async () => {
  for (const body of [
    '{"portal":"coach"}',
    '{"email":"attacker@example.com"}',
    `{"user_id":"${ATTACKER_ID}"}`,
    '{"owner_id":"attacker"}',
    '{"template_key":"welcome_coach"}',
    "[]",
  ]) {
    const calls: CapturedCall[] = [];
    const handler = createWelcomeEmailHandler({
      environment,
      fetchImpl: async (url) => {
        calls.push({ url: String(url) });
        return assert.fail("body no allowlisted no debe hacer fetch");
      },
    });
    const response = await handler(request(body));
    assert.equal(response.status, 400, body);
    assert.equal(calls.length, 0, body);
  }
});

test("claim BOLA o destinatario distinto del Auth user nunca llega a Brevo", async () => {
  for (const input of [
    { claimedUserId: ATTACKER_ID },
    { claimedEmail: "attacker@example.com" },
    { templateKey: "auth_confirmation_user" },
  ]) {
    const transport = welcomeFetch(input);
    const handler = createWelcomeEmailHandler({ environment, fetchImpl: transport.fetchImpl });
    const response = await handler(request());

    assert.equal(response.status, 202);
    assert.equal(transport.calls.some(({ url }) => url === BREVO_URL), false);
    assert.equal(JSON.stringify(await response.json()).includes("attacker"), false);
  }
});

test("sin bearer válido no consulta Auth ni ledger", async () => {
  const calls: CapturedCall[] = [];
  const handler = createWelcomeEmailHandler({
    environment,
    fetchImpl: async (url) => {
      calls.push({ url: String(url) });
      return assert.fail("una solicitud no autenticada no debe hacer fetch");
    },
  });

  for (const authorization of ["", "Basic forged", "Bearer two tokens"]) {
    const response = await handler(request("{}", authorization));
    assert.equal(response.status, 401);
  }
  assert.equal(calls.length, 0);
});

test("claim vacío vuelve idempotente el doble submit", async () => {
  const transport = welcomeFetch({ emptyClaim: true });
  const handler = createWelcomeEmailHandler({ environment, fetchImpl: transport.fetchImpl });

  const response = await handler(request());
  assert.equal(response.status, 202);
  assert.equal(transport.calls.some(({ url }) => url === BREVO_URL), false);
  assert.deepEqual(transport.calls.map(({ url }) => url), [
    `${SUPABASE_URL}/auth/v1/user`,
    `${SUPABASE_URL}/rest/v1/rpc/claim_own_transactional_welcome_emails`,
  ]);
});

test("fallo explícito del proveedor no revierte membership y queda failed", async () => {
  const transport = welcomeFetch({ providerStatus: 400 });
  const handler = createWelcomeEmailHandler({ environment, fetchImpl: transport.fetchImpl });
  const response = await handler(request());

  assert.equal(response.status, 202);
  assert.deepEqual(requestBody(transport.calls[3]!), {
    p_capability: environment.emailLedgerRpcSecret,
    p_delivery_id: DELIVERY_ID,
    p_attempt_token: ATTEMPT_TOKEN,
    p_outcome: "failed",
    p_provider_message_id: null,
    p_provider_error_code: "provider_rejected",
  });
});

test("resultado ambiguo de Brevo queda pending sin completion falsa", async () => {
  for (const providerAmbiguous of ["network", "invalid-json", "server", "duplicate"] as const) {
    const transport = welcomeFetch({ providerAmbiguous });
    const handler = createWelcomeEmailHandler({ environment, fetchImpl: transport.fetchImpl });
    const response = await handler(request());

    assert.equal(response.status, 202);
    assert.deepEqual(transport.calls.map(({ url }) => url), [
      `${SUPABASE_URL}/auth/v1/user`,
      `${SUPABASE_URL}/rest/v1/rpc/claim_own_transactional_welcome_emails`,
      BREVO_URL,
    ]);
  }
});
