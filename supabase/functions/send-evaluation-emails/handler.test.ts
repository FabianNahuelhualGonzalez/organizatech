import assert from "node:assert/strict";
import test from "node:test";

import { createEvaluationEmailHandler } from "./handler.ts";

const environment = {
  supabaseUrl: "https://project.example.com",
  supabaseAnonKey: "public-anon-key",
  evaluationRpcSecret: "e".repeat(40),
  schedulerSecret: "s".repeat(40),
  brevoApiKey: "brevo-key",
  senderEmail: "noreply@example.com",
  senderName: "Organizatech",
  appUrl: "https://app.example.com",
};

test("rechaza invocaciones sin sesión ni secreto del scheduler", async () => {
  const handler = createEvaluationEmailHandler(environment, async () => new Response("[]"));
  const response = await handler(new Request("https://function.example.com", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("el scheduler reclama con capacidad aislada y no usa service_role", async () => {
  const requests: Array<{ url: string; authorization: string; body: Record<string, unknown> }> = [];
  const handler = createEvaluationEmailHandler(environment, async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
  const response = await handler(new Request("https://function.example.com", {
    method: "POST", headers: { authorization: `Bearer ${environment.schedulerSecret}` },
  }));
  assert.equal(response.status, 202);
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.url, /claim_evaluation_email_deliveries$/);
  assert.equal(requests[0]!.authorization, `Bearer ${environment.supabaseAnonKey}`);
  assert.equal(requests[0]!.body.p_capability, environment.evaluationRpcSecret);
  assert.doesNotMatch(JSON.stringify(requests), /service_role/i);
});

test("la invocación del usuario conserva su JWT y agrega la capacidad sólo en servidor", async () => {
  const requests: Array<{ authorization: string; body: Record<string, unknown> }> = [];
  const handler = createEvaluationEmailHandler(environment, async (_input, init) => {
    requests.push({
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
  const response = await handler(new Request("https://function.example.com", {
    method: "POST",
    headers: { origin: "https://app.example.com", authorization: "Bearer user-jwt" },
  }));
  assert.equal(response.status, 202);
  assert.equal(requests[0]!.authorization, "Bearer user-jwt");
  assert.equal(requests[0]!.body.p_capability, environment.evaluationRpcSecret);
});
