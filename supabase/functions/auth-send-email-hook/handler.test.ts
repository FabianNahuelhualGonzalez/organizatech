import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { createAuthSendEmailHookHandler } from "./handler";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DELIVERY_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-8333-8333-333333333333";
const ATTEMPT_TOKEN = "44444444-4444-4444-8444-444444444444";
const TIMESTAMP = 1_787_777_200;
const WEBHOOK_ID = "msg_email_onboarding_auth_test";
const SECRET_BYTES = Buffer.from("organizatech-auth-hook-test-secret", "utf8");
const HOOK_SECRET = `v1,whsec_${SECRET_BYTES.toString("base64")}`;
const SUPABASE_URL = "https://project-ref.supabase.co";
const APP_SITE_URL = "https://organizatech.cl/";
const APP_REDIRECT_TO = "https://organizatech.cl/auth/callback?portal=usuario";
const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

const environment = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: "public-anon-key-for-tests",
  sendEmailHookSecret: HOOK_SECRET,
  emailLedgerRpcSecret: "edge-ledger-capability-for-tests",
  brevoApiKey: "brevo-api-key-for-tests",
  senderEmail: "no-reply@organizatech.example",
  senderName: "Organizatech",
};

type LinkAuthAction = "signup" | "recovery" | "magiclink" | "invite" | "email_change";

function authPayload(action: LinkAuthAction | "reauthentication") {
  return JSON.stringify({
    user: {
      id: USER_ID,
      email: "owner@example.com",
      ...(action === "email_change" ? { new_email: "new.owner@example.com" } : {}),
      user_metadata: {
        display_name: "Ada Lovelace",
        organizatech_email_presentation: {
          portal: "usuario",
        },
      },
    },
    email_data: {
      email_action_type: action,
      token: action === "reauthentication" ? "87654321" : "12345678",
      token_hash: `opaque-${action}-token`,
      redirect_to: APP_REDIRECT_TO,
      site_url: APP_SITE_URL,
    },
  });
}

function signupPayload() {
  return authPayload("signup");
}

function signedRequest(rawBody: string, signatureOverride?: string) {
  const signature = createHmac("sha256", SECRET_BYTES)
    .update(`${WEBHOOK_ID}.${TIMESTAMP}.${rawBody}`, "utf8")
    .digest("base64");
  return new Request("https://edge.example/auth-send-email-hook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": WEBHOOK_ID,
      "webhook-timestamp": String(TIMESTAMP),
      "webhook-signature": signatureOverride ?? `v1,${signature}`,
    },
    body: rawBody,
  });
}

function streamedRequest(rawBody: string, contentLength?: string) {
  const bytes = new TextEncoder().encode(rawBody);
  const headers = new Headers({
    "content-type": "application/json",
    "webhook-id": WEBHOOK_ID,
    "webhook-timestamp": String(TIMESTAMP),
    "webhook-signature": "v1,invalid",
  });
  if (contentLength !== undefined) headers.set("content-length", contentLength);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const midpoint = Math.floor(bytes.byteLength / 2);
      controller.enqueue(bytes.slice(0, midpoint));
      controller.enqueue(bytes.slice(midpoint));
      controller.close();
    },
  });
  return new Request("https://edge.example/auth-send-email-hook", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

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

function successfulFetch(input: {
  recipientEmail?: string;
  templateKey?: string;
  providerStatus?: number;
  providerRetryOnce?: boolean;
  providerAmbiguous?: "network" | "invalid-json" | "server" | "duplicate";
} = {}) {
  const calls: CapturedCall[] = [];
  let providerAttempts = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, init });
    if (requestUrl.endsWith("/rest/v1/rpc/claim_auth_transactional_email")) {
      return responseJson([{
        delivery_id: DELIVERY_ID,
        user_id: USER_ID,
        template_key: input.templateKey ?? "auth_confirmation_user",
        idempotency_key: IDEMPOTENCY_KEY,
        recipient_email: input.recipientEmail ?? "owner@example.com",
        first_name: "Ada Lovelace",
        last_name: "",
        attempt_token: ATTEMPT_TOKEN,
      }]);
    }
    if (requestUrl === BREVO_URL) {
      providerAttempts += 1;
      if (input.providerRetryOnce && providerAttempts === 1) {
        return responseJson({ code: "too_many_requests" }, 429);
      }
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
        return responseJson({ code: "provider detail must stay private" }, input.providerStatus);
      }
      return responseJson({ messageId: "brevo-message-auth-01" });
    }
    if (requestUrl.endsWith("/rest/v1/rpc/complete_auth_transactional_email")) {
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

function authActionUrlFromProvider(call: CapturedCall) {
  const textContent = requestBody(call).textContent;
  if (typeof textContent !== "string") {
    return assert.fail("el payload del proveedor debe incluir textContent");
  }
  const match = textContent.match(/https:\/\/[^\s]+/);
  assert.ok(match, "el correo debe incluir una URL de acción");
  return new URL(match[0]);
}

test("signup firmado envía confirmación específica y completa trazabilidad", async () => {
  const transport = successfulFetch();
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });
  const rawBody = signupPayload();
  const response = await handler(signedRequest(rawBody));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
  assert.deepEqual(transport.calls.map(({ url }) => url), [
    `${SUPABASE_URL}/rest/v1/rpc/claim_auth_transactional_email`,
    BREVO_URL,
    `${SUPABASE_URL}/rest/v1/rpc/complete_auth_transactional_email`,
  ]);

  const claim = requestBody(transport.calls[0]!);
  assert.deepEqual(claim, {
    p_payload: rawBody,
    p_recipient_slot: "primary",
    p_event_id: WEBHOOK_ID,
    p_capability: environment.emailLedgerRpcSecret,
  });
  assert.equal(new Headers(transport.calls[0]!.init?.headers).get("authorization"),
    `Bearer ${environment.supabaseAnonKey}`);

  const provider = requestBody(transport.calls[1]!);
  assert.deepEqual(provider.to, [{
    email: "owner@example.com",
    contactPixelTrackingConsent: false,
  }]);
  assert.deepEqual(provider.headers, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(typeof provider.htmlContent, "string");
  assert.equal(typeof provider.textContent, "string");
  assert.equal(String(provider.htmlContent).includes("Sólo falta un paso"), true);
  const actionUrl = authActionUrlFromProvider(transport.calls[1]!);
  assert.equal(actionUrl.origin, SUPABASE_URL);
  assert.equal(actionUrl.pathname, "/auth/v1/verify");
  assert.equal(actionUrl.searchParams.get("redirect_to"), APP_REDIRECT_TO);

  assert.deepEqual(requestBody(transport.calls[2]!), {
    p_payload: rawBody,
    p_capability: environment.emailLedgerRpcSecret,
    p_delivery_id: DELIVERY_ID,
    p_attempt_token: ATTEMPT_TOKEN,
    p_outcome: "sent",
    p_provider_message_id: "brevo-message-auth-01",
    p_provider_error_code: null,
  });
});

test("acciones Auth con link usan el endpoint Supabase y la aplicación sólo como redirect", async () => {
  const actions: readonly LinkAuthAction[] = [
    "signup",
    "recovery",
    "magiclink",
    "invite",
    "email_change",
  ];

  for (const action of actions) {
    const recipientEmail = action === "email_change"
      ? "new.owner@example.com"
      : "owner@example.com";
    const transport = successfulFetch({
      recipientEmail,
      templateKey: action === "signup" ? "auth_confirmation_user" : "auth_fallback",
    });
    const handler = createAuthSendEmailHookHandler({
      environment,
      fetchImpl: transport.fetchImpl,
      nowSeconds: () => TIMESTAMP,
    });

    const response = await handler(signedRequest(authPayload(action)));
    assert.equal(response.status, 200, action);
    const providerCall = transport.calls.find(({ url }) => url === BREVO_URL);
    assert.ok(providerCall, `${action} debe enviar el correo`);
    const actionUrl = authActionUrlFromProvider(providerCall);

    assert.equal(actionUrl.origin, SUPABASE_URL, action);
    assert.equal(actionUrl.pathname, "/auth/v1/verify", action);
    assert.equal(actionUrl.searchParams.get("token"), `opaque-${action}-token`, action);
    assert.equal(actionUrl.searchParams.get("type"), action, action);
    assert.equal(actionUrl.searchParams.get("redirect_to"), APP_REDIRECT_TO, action);
    assert.notEqual(actionUrl.origin, new URL(APP_SITE_URL).origin, action);
  }
});

test("reauthentication conserva OTP y no genera un link de verificación", async () => {
  const transport = successfulFetch({ templateKey: "auth_fallback" });
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });

  const response = await handler(signedRequest(authPayload("reauthentication")));
  assert.equal(response.status, 200);
  const providerCall = transport.calls.find(({ url }) => url === BREVO_URL);
  assert.ok(providerCall);
  const provider = requestBody(providerCall);
  assert.match(String(provider.htmlContent), />87654321</);
  assert.match(String(provider.textContent), /Código de verificación: 87654321/);
  assert.doesNotMatch(String(provider.htmlContent), /auth\/v1\/verify|token=/);
  assert.doesNotMatch(String(provider.textContent), /auth\/v1\/verify|token=/);
});

test("rechazo transitorio explícito reintenta una vez con la misma clave", async () => {
  const transport = successfulFetch({ providerRetryOnce: true });
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });

  const response = await handler(signedRequest(signupPayload()));
  assert.equal(response.status, 200);
  assert.deepEqual(transport.calls.map(({ url }) => url), [
    `${SUPABASE_URL}/rest/v1/rpc/claim_auth_transactional_email`,
    BREVO_URL,
    BREVO_URL,
    `${SUPABASE_URL}/rest/v1/rpc/complete_auth_transactional_email`,
  ]);
  assert.deepEqual(requestBody(transport.calls[1]!).headers, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.deepEqual(requestBody(transport.calls[2]!).headers, { idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(requestBody(transport.calls[3]!).p_outcome, "sent");
});

test("firma inválida o payload firmado inválido falla antes de RPC y proveedor", async () => {
  const calls: CapturedCall[] = [];
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: async (url) => {
      calls.push({ url: String(url) });
      return assert.fail("una solicitud inválida no debe hacer fetch");
    },
    nowSeconds: () => TIMESTAMP,
  });

  const invalidSignature = await handler(signedRequest(signupPayload(), "v1,invalid"));
  assert.equal(invalidSignature.status, 401);

  const invalidPayload = await handler(signedRequest("{}"));
  assert.equal(invalidPayload.status, 400);
  assert.equal(calls.length, 0);
});

test("body real se limita por bytes antes de HMAC aunque falte o mienta Content-Length", async () => {
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: async () => assert.fail("un body sobredimensionado no debe hacer fetch"),
    nowSeconds: () => TIMESTAMP,
  });

  const oversizedAscii = "x".repeat(65_537);
  assert.equal((await handler(streamedRequest(oversizedAscii))).status, 413);
  assert.equal((await handler(streamedRequest(oversizedAscii, "1"))).status, 413);

  const oversizedMultibyte = "é".repeat(32_769);
  assert.equal(oversizedMultibyte.length < 65_536, true);
  assert.equal(new TextEncoder().encode(oversizedMultibyte).byteLength > 65_536, true);
  assert.equal((await handler(streamedRequest(oversizedMultibyte))).status, 413);
});

test("destinatario BOLA devuelto por RPC nunca llega a Brevo", async () => {
  const transport = successfulFetch({ recipientEmail: "attacker@example.com" });
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });

  const response = await handler(signedRequest(signupPayload()));
  assert.equal(response.status, 200, "el fallo de trazabilidad no revierte Auth");
  assert.deepEqual(transport.calls.map(({ url }) => url), [
    `${SUPABASE_URL}/rest/v1/rpc/claim_auth_transactional_email`,
  ]);
});

test("rechazo explícito de Brevo se registra como failed sin revertir la cuenta", async () => {
  const transport = successfulFetch({ providerStatus: 400 });
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });

  const response = await handler(signedRequest(signupPayload()));
  assert.equal(response.status, 200);
  assert.equal(transport.calls.length, 3);
  assert.deepEqual(requestBody(transport.calls[2]!), {
    p_payload: signupPayload(),
    p_capability: environment.emailLedgerRpcSecret,
    p_delivery_id: DELIVERY_ID,
    p_attempt_token: ATTEMPT_TOKEN,
    p_outcome: "failed",
    p_provider_message_id: null,
    p_provider_error_code: "provider_rejected",
  });
});

test("acción Auth no-signup sólo admite template fallback", async () => {
  const rawBody = JSON.stringify({
    user: { id: USER_ID, email: "owner@example.com" },
    email_data: {
      email_action_type: "password_changed_notification",
      site_url: "https://app.organizatech.example/",
    },
  });
  const transport = successfulFetch({ templateKey: "auth_confirmation_coach" });
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });

  const response = await handler(signedRequest(rawBody));
  assert.equal(response.status, 200);
  assert.equal(transport.calls.some(({ url }) => url === BREVO_URL), false);
});

test("notificación Auth usa redirect_to de la aplicación antes que site_url", async () => {
  const rawBody = JSON.stringify({
    user: { id: USER_ID, email: "owner@example.com" },
    email_data: {
      email_action_type: "password_changed_notification",
      redirect_to: "https://app.organizatech.example/security",
      site_url: APP_SITE_URL,
    },
  });
  const transport = successfulFetch({ templateKey: "auth_fallback" });
  const handler = createAuthSendEmailHookHandler({
    environment,
    fetchImpl: transport.fetchImpl,
    nowSeconds: () => TIMESTAMP,
  });

  const response = await handler(signedRequest(rawBody));
  assert.equal(response.status, 200);
  assert.equal(transport.calls.length, 3);
  const provider = requestBody(transport.calls[1]!);
  assert.match(String(provider.htmlContent), /https:\/\/app\.organizatech\.example\/security/);
  assert.doesNotMatch(String(provider.htmlContent), /organizatech\.cl/);
});

test("resultado ambiguo de Brevo queda pending para reconciliación", async () => {
  for (const providerAmbiguous of ["network", "invalid-json", "server", "duplicate"] as const) {
    const transport = successfulFetch({ providerAmbiguous });
    const handler = createAuthSendEmailHookHandler({
      environment,
      fetchImpl: transport.fetchImpl,
      nowSeconds: () => TIMESTAMP,
    });

    const response = await handler(signedRequest(signupPayload()));
    assert.equal(response.status, 200);
    assert.deepEqual(transport.calls.map(({ url }) => url), [
      `${SUPABASE_URL}/rest/v1/rpc/claim_auth_transactional_email`,
      BREVO_URL,
    ]);
  }
});
