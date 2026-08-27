import assert from "node:assert/strict";
import test from "node:test";

import {
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  BrevoEmailError,
  createDeterministicEmailIdempotencyKey,
  sendBrevoTransactionalEmail,
  type BrevoTransactionalEmailInput,
} from "./brevo-client";

async function baseInput(
  fetchImpl: typeof fetch,
): Promise<BrevoTransactionalEmailInput> {
  return {
    apiKey: "test-brevo-key-not-a-secret",
    senderEmail: "no-reply@organizatech.cl",
    senderName: "Organizatech",
    recipientEmail: "persona@example.test",
    subject: "Bienvenido a Organizatech",
    htmlContent: "<html><body><p>Contenido seguro</p></body></html>",
    textContent: "Contenido seguro",
    idempotencyKey: await createDeterministicEmailIdempotencyKey([
      "user-a",
      "welcome_user",
      "membership-a",
    ]),
    fetchImpl,
  };
}

test("UUID de idempotencia es determinística, opaca y sensible a sus componentes", async () => {
  const first = await createDeterministicEmailIdempotencyKey([
    "user-a",
    "welcome_user",
    "membership-a",
  ]);
  const repeated = await createDeterministicEmailIdempotencyKey([
    "user-a",
    "welcome_user",
    "membership-a",
  ]);
  const different = await createDeterministicEmailIdempotencyKey([
    "user-a",
    "welcome_coach",
    "membership-a",
  ]);

  assert.equal(first, repeated);
  assert.notEqual(first, different);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.includes("user-a"), false);
});

test("POST Brevo usa endpoint y body allowlisted, sin tracking de contacto", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ messageId: "brevo-message-01" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const input = await baseInput(fetchImpl);

  assert.deepEqual(await sendBrevoTransactionalEmail(input), {
    messageId: "brevo-message-01",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, BREVO_TRANSACTIONAL_EMAIL_ENDPOINT);
  assert.equal(calls[0]?.init.method, "POST");
  const requestHeaders = new Headers(calls[0]?.init.headers);
  assert.equal(requestHeaders.get("api-key"), input.apiKey);
  assert.equal(requestHeaders.get("content-type"), "application/json");

  const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), [
    "sender",
    "to",
    "subject",
    "htmlContent",
    "textContent",
    "headers",
  ]);
  assert.deepEqual(body.sender, {
    email: input.senderEmail,
    name: input.senderName,
  });
  assert.deepEqual(body.to, [{
    email: input.recipientEmail,
    contactPixelTrackingConsent: false,
  }]);
  assert.equal(body.htmlContent, input.htmlContent);
  assert.equal(body.textContent, input.textContent);
  assert.deepEqual(body.headers, { idempotencyKey: input.idempotencyKey });
  assert.equal(JSON.stringify(body).includes(input.apiKey), false);
});

test("retry automático acotado conserva exactamente la misma Idempotency-Key", async () => {
  const keys: string[] = [];
  let attempts = 0;
  const fetchImpl: typeof fetch = async (_input, init = {}) => {
    attempts += 1;
    const body = JSON.parse(String(init.body)) as {
      headers: { idempotencyKey: string };
    };
    keys.push(body.headers.idempotencyKey);
    if (attempts === 1) {
      return new Response("provider-private-body", { status: 429 });
    }
    return new Response(JSON.stringify({ messageId: "brevo-message-retry" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const input = await baseInput(fetchImpl);

  assert.deepEqual(await sendBrevoTransactionalEmail(input), {
    messageId: "brevo-message-retry",
  });
  assert.deepEqual(keys, [input.idempotencyKey, input.idempotencyKey]);
});

test("resultado ambiguo nunca dispara retry automático", async () => {
  let attempts = 0;
  const input = await baseInput(async () => {
    attempts += 1;
    return new Response("provider-private-body", { status: 503 });
  });

  await assert.rejects(
    sendBrevoTransactionalEmail(input),
    (error: unknown) => (
      error instanceof BrevoEmailError
      && error.code === "provider_unavailable"
      && error.retryable
      && error.status === 503
      && error.ambiguous
    ),
  );
  assert.equal(attempts, 1);
});

test("429/5xx/network distinguen rechazo definitivo de resultado ambiguo", async () => {
  for (const candidate of [
    { status: 429, retryable: true, ambiguous: false, code: "provider_unavailable" },
    { status: 500, retryable: true, ambiguous: true, code: "provider_unavailable" },
    { status: 408, retryable: true, ambiguous: true, code: "provider_unavailable" },
    { status: 400, retryable: false, ambiguous: false, code: "provider_rejected" },
  ] as const) {
    const input = await baseInput(async () => new Response("private", {
      status: candidate.status,
    }));
    await assert.rejects(
      sendBrevoTransactionalEmail(input),
      (error: unknown) => (
        error instanceof BrevoEmailError
        && error.code === candidate.code
        && error.retryable === candidate.retryable
        && error.status === candidate.status
        && error.ambiguous === candidate.ambiguous
      ),
    );
  }

  const networkInput = await baseInput(async () => {
    throw new Error("private token and persona@example.test");
  });
  await assert.rejects(
    sendBrevoTransactionalEmail(networkInput),
    (error: unknown) => (
      error instanceof BrevoEmailError
      && error.code === "provider_unavailable"
      && error.retryable
      && error.status === null
      && error.ambiguous
    ),
  );
});

test("duplicate_parameter queda ambiguo y nunca expone el body del proveedor", async () => {
  const privateDetails = "persona@example.test test-brevo-key-not-a-secret private-provider-token";
  const input = await baseInput(async () => new Response(JSON.stringify({
    code: "duplicate_parameter",
    message: privateDetails,
  }), {
    status: 400,
    headers: { "content-type": "application/json" },
  }));

  await assert.rejects(
    sendBrevoTransactionalEmail(input),
    (error: unknown) => {
      assert.ok(error instanceof BrevoEmailError);
      assert.equal(error.code, "duplicate_request");
      assert.equal(error.retryable, false);
      assert.equal(error.status, 400);
      assert.equal(error.ambiguous, true);
      assert.equal(`${error.name} ${error.message}`.includes(privateDetails), false);
      return true;
    },
  );
});

test("errores del proveedor no exponen body, PII ni API key", async () => {
  const privateDetails = "persona@example.test test-brevo-key-not-a-secret private-provider-token";
  const input = await baseInput(async () => new Response(privateDetails, { status: 500 }));

  await assert.rejects(
    sendBrevoTransactionalEmail(input),
    (error: unknown) => {
      assert.ok(error instanceof BrevoEmailError);
      const publicError = `${error.name} ${error.message} ${error.code} ${error.status}`;
      assert.equal(publicError.includes(input.apiKey), false);
      assert.equal(publicError.includes(input.recipientEmail), false);
      assert.equal(publicError.includes("private-provider-token"), false);
      return true;
    },
  );
});

test("éxito sin messageId válido falla cerrado y queda retryable", async () => {
  for (const payload of [{}, { messageId: "" }, { messageId: 123 }]) {
    const input = await baseInput(async () => new Response(JSON.stringify(payload), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    await assert.rejects(
      sendBrevoTransactionalEmail(input),
      (error: unknown) => (
        error instanceof BrevoEmailError
        && error.code === "invalid_provider_response"
        && error.retryable
        && error.ambiguous
      ),
    );
  }
});

test("timeout aborta el fetch y conserva el resultado como ambiguo", async () => {
  let observedSignal: AbortSignal | undefined;
  const input = await baseInput(async (_url, init = {}) => {
    observedSignal = init.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      observedSignal?.addEventListener("abort", () => {
        reject(new DOMException("request aborted", "AbortError"));
      }, { once: true });
    });
  });

  await assert.rejects(
    sendBrevoTransactionalEmail({ ...input, timeoutMilliseconds: 250 }),
    (error: unknown) => (
      error instanceof BrevoEmailError
      && error.code === "provider_unavailable"
      && error.retryable
      && error.status === null
      && error.ambiguous
    ),
  );
  assert.ok(observedSignal);
  assert.equal(observedSignal.aborted, true);
});

test("timeout fuera de allowlist falla antes de invocar al proveedor", async () => {
  let called = false;
  const input = await baseInput(async () => {
    called = true;
    return Response.json({ messageId: "must-not-run" });
  });

  await assert.rejects(
    sendBrevoTransactionalEmail({ ...input, timeoutMilliseconds: 249 }),
    (error: unknown) => (
      error instanceof BrevoEmailError
      && error.code === "invalid_request"
      && !error.retryable
      && !error.ambiguous
    ),
  );
  assert.equal(called, false);
});
