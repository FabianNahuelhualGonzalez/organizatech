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
  appUrl: "https://organizatech-git-qa-owner.vercel.app",
  allowedOrigins: "https://organizatech-git-qa-owner.vercel.app",
};

const delivery = {
  delivery_id: "00000000-0000-4000-8000-000000000001",
  notification_id: "00000000-0000-4000-8000-000000000002",
  event_kind: "evaluation_received",
  payload: { templateName: "Seguimiento", coachName: "Coach QA", dueAt: null },
  idempotency_key: "00000000-0000-4000-8000-000000000003",
  recipient_email: "student@example.com",
  attempt_token: "00000000-0000-4000-8000-000000000004",
};

function userRequest() {
  return new Request("https://function.example.com", {
    method: "POST",
    headers: { origin: environment.appUrl, authorization: "Bearer user-jwt" },
  });
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deliveryBatch(length: number, offset: number) {
  return Array.from({ length }, (_, index) => {
    const suffix = String(offset + index).padStart(12, "0");
    return {
      ...delivery,
      delivery_id: `00000000-0000-4000-8000-${suffix}`,
      idempotency_key: `10000000-0000-4000-8000-${suffix}`,
      attempt_token: `20000000-0000-4000-8000-${suffix}`,
    };
  });
}

test("rechaza invocaciones sin sesión ni secreto del scheduler", async () => {
  const handler = createEvaluationEmailHandler(environment, async () => new Response("[]"));
  const response = await handler(new Request("https://function.example.com", { method: "POST" }));
  assert.equal(response.status, 401);
});

test("acepta sólo el origin QA estable configurado y refleja ese valor exacto", async () => {
  const handler = createEvaluationEmailHandler(environment, async () => json([]));
  const origin = "https://organizatech-git-qa-owner.vercel.app";
  assert.equal(environment.appUrl, origin);
  assert.equal(environment.allowedOrigins, origin);
  const preflight = await handler(new Request("https://function.example.com", {
    method: "OPTIONS",
    headers: { origin },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.equal(preflight.headers.get("vary"), "origin");

  const invocation = await handler(new Request("https://function.example.com", {
    method: "POST",
    headers: { origin, authorization: "Bearer user-jwt" },
  }));
  assert.equal(invocation.status, 202);
  assert.equal(invocation.headers.get("access-control-allow-origin"), origin);
});

test("rechaza previews no allowlisted y hosts que sólo imitan el sufijo permitido", async () => {
  const handler = createEvaluationEmailHandler(environment, async () => json([]));
  for (const origin of [
    "https://organizatech-commit-owner.vercel.app",
    "https://organizatech-git-qa-owner.vercel.app.attacker.test",
    "null",
  ]) {
    const preflight = await handler(new Request("https://function.example.com", {
      method: "OPTIONS",
      headers: { origin },
    }));
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);

    const invocation = await handler(new Request("https://function.example.com", {
      method: "POST",
      headers: { origin, authorization: "Bearer user-jwt" },
    }));
    assert.equal(invocation.status, 401);
    assert.equal(invocation.headers.get("access-control-allow-origin"), null);
  }
});

test("la configuración de origins falla cerrada ante comodines, paths o protocolos inseguros", () => {
  for (const allowedOrigins of [
    "https://*.vercel.app",
    "https://organizatech-git-qa-owner.vercel.app/login",
    "http://organizatech-git-qa-owner.vercel.app",
  ]) {
    assert.throws(
      () => createEvaluationEmailHandler({ ...environment, allowedOrigins }),
      /invalid allowed origin/,
    );
  }
  for (const appUrl of [
    "https://user@app.example.com",
    "https://app.example.com/hidden-path",
  ]) {
    assert.throws(
      () => createEvaluationEmailHandler({ ...environment, appUrl }),
      /invalid allowed origin/,
    );
  }
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
    headers: { origin: environment.appUrl, authorization: "Bearer user-jwt" },
  }));
  assert.equal(response.status, 202);
  assert.equal(requests[0]!.authorization, "Bearer user-jwt");
  assert.equal(requests[0]!.body.p_capability, environment.evaluationRpcSecret);
});

test("informa una entrega exitosa con agregados sin datos sensibles", async () => {
  const completions: Record<string, unknown>[] = [];
  const providerBodies: string[] = [];
  const handler = createEvaluationEmailHandler(environment, async (input, init) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) return json([delivery]);
    if (url.includes("api.brevo.com")) {
      providerBodies.push(String(init?.body));
      return json({ messageId: "brevo-message-id" });
    }
    completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return json(true);
  });

  const response = await handler(userRequest());
  const payload = await response.json();
  assert.equal(response.status, 202);
  assert.deepEqual(payload, {
    accepted: true, claimed: 1, sent: 1, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false,
  });
  assert.equal(completions[0]?.p_outcome, "sent");
  assert.doesNotMatch(JSON.stringify(payload), /student@example|Seguimiento|Coach QA/i);
  assert.match(providerBodies[0] ?? "", /https:\/\/organizatech-git-qa-owner\.vercel\.app\/login/);
});

test("informa fallo Brevo sólo después de persistir el estado failed", async () => {
  const completions: Record<string, unknown>[] = [];
  const handler = createEvaluationEmailHandler(environment, async (input, init) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) return json([delivery]);
    if (url.includes("api.brevo.com")) return json({ code: "invalid_parameter" }, 400);
    completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return json(true);
  });

  const response = await handler(userRequest());
  assert.deepEqual(await response.json(), {
    accepted: true, claimed: 1, sent: 0, failed: 1, ambiguous: 0, completionFailed: 0, truncated: false,
  });
  assert.equal(completions[0]?.p_outcome, "failed");
  assert.equal(completions[0]?.p_provider_error_code, "provider_rejected");
});

test("informa resultado ambiguo de Brevo sin afirmar entrega", async () => {
  const completions: Record<string, unknown>[] = [];
  const handler = createEvaluationEmailHandler(environment, async (input, init) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) return json([delivery]);
    if (url.includes("api.brevo.com")) return json({ code: "unavailable" }, 500);
    completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return json(true);
  });

  const response = await handler(userRequest());
  assert.deepEqual(await response.json(), {
    accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 0, truncated: false,
  });
  assert.equal(completions[0]?.p_outcome, "ambiguous");
});

test("un fallo al completar la cola convierte el intento en ambiguo", async () => {
  const handler = createEvaluationEmailHandler(environment, async (input) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) return json([delivery]);
    if (url.includes("api.brevo.com")) return json({ messageId: "brevo-message-id" });
    return json({ error: "completion unavailable" }, 503);
  });

  const response = await handler(userRequest());
  assert.deepEqual(await response.json(), {
    accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 1, truncated: false,
  });
});

test("el reintento conserva la clave idempotente y no confirma un duplicado", async () => {
  const providerKeys: string[] = [];
  let invocation = 0;
  const handler = createEvaluationEmailHandler(environment, async (input, init) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) return json([delivery]);
    if (url.includes("api.brevo.com")) {
      const body = JSON.parse(String(init?.body)) as { headers?: { idempotencyKey?: string } };
      providerKeys.push(body.headers?.idempotencyKey ?? "");
      return invocation === 0
        ? json({ messageId: "brevo-message-id" })
        : json({ code: "duplicate_parameter" }, 400);
    }
    if (invocation === 0) {
      invocation += 1;
      return json({ error: "completion unavailable" }, 503);
    }
    return json(true);
  });

  const first = await handler(userRequest());
  const second = await handler(userRequest());
  assert.deepEqual(await first.json(), {
    accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 1, truncated: false,
  });
  assert.deepEqual(await second.json(), {
    accepted: true, claimed: 1, sent: 0, failed: 0, ambiguous: 1, completionFailed: 0, truncated: false,
  });
  assert.deepEqual(providerKeys, [delivery.idempotency_key, delivery.idempotency_key]);
});

test("drena los 51 correos máximos de un envío en tres lotes acotados", async () => {
  const claimSizes = [25, 25, 1];
  let claim = 0;
  const handler = createEvaluationEmailHandler(environment, async (input) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) {
      const batch = claim;
      return json(deliveryBatch(claimSizes[claim++] ?? 0, batch * 25 + 1));
    }
    if (url.includes("api.brevo.com")) return json({ messageId: "brevo-message-id" });
    return json(true);
  });

  const response = await handler(userRequest());
  assert.deepEqual(await response.json(), {
    accepted: true, claimed: 51, sent: 51, failed: 0, ambiguous: 0, completionFailed: 0, truncated: false,
  });
  assert.equal(claim, 3);
});

test("marca truncated si tres lotes completos no vacían el trabajo reclamable", async () => {
  let claims = 0;
  const handler = createEvaluationEmailHandler(environment, async (input) => {
    const url = String(input);
    if (url.endsWith("claim_evaluation_email_deliveries")) {
      claims += 1;
      return json(deliveryBatch(25, (claims - 1) * 25 + 1));
    }
    if (url.includes("api.brevo.com")) return json({ messageId: "brevo-message-id" });
    return json(true);
  });

  const response = await handler(userRequest());
  assert.deepEqual(await response.json(), {
    accepted: true, claimed: 75, sent: 75, failed: 0, ambiguous: 0, completionFailed: 0, truncated: true,
  });
  assert.equal(claims, 3);
});
