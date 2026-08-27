import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { verifyStandardWebhookSignature } from "./standard-webhook-signature";

const SECRET_BYTES = Buffer.from("organizatech-standard-webhook-test-secret", "utf8");
const SECRET = `v1,whsec_${SECRET_BYTES.toString("base64")}`;
const WEBHOOK_ID = "msg_email_onboarding_01";
const TIMESTAMP = 1_787_777_200;
const RAW_BODY = '{"user":{"id":"user-a"},"email_data":{"token_hash":"opaque"}}';

function signature(rawBody = RAW_BODY, timestamp = TIMESTAMP) {
  return createHmac("sha256", SECRET_BYTES)
    .update(`${WEBHOOK_ID}.${timestamp}.${rawBody}`, "utf8")
    .digest("base64");
}

function signedHeaders(rawBody = RAW_BODY, timestamp = TIMESTAMP) {
  return new Headers({
    "webhook-id": WEBHOOK_ID,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature(rawBody, timestamp)}`,
  });
}

test("firma Standard Webhooks válida sobre el body raw", async () => {
  assert.equal(await verifyStandardWebhookSignature({
    rawBody: RAW_BODY,
    headers: signedHeaders(),
    secret: SECRET,
    nowSeconds: TIMESTAMP,
  }), true);
});

test("acepta rotación con múltiples firmas y compara todas las candidatas v1", async () => {
  const headers = signedHeaders();
  headers.set(
    "webhook-signature",
    `v1,${Buffer.alloc(32, 7).toString("base64")} v1,${signature()}`,
  );
  assert.equal(await verifyStandardWebhookSignature({
    rawBody: new TextEncoder().encode(RAW_BODY),
    headers,
    secret: SECRET,
    nowSeconds: TIMESTAMP,
  }), true);
});

test("firma, body, secreto o headers alterados fallan cerrados", async () => {
  const invalidCases = [
    {
      rawBody: `${RAW_BODY} `,
      headers: signedHeaders(),
      secret: SECRET,
    },
    {
      rawBody: RAW_BODY,
      headers: new Headers({
        "webhook-id": WEBHOOK_ID,
        "webhook-timestamp": String(TIMESTAMP),
        "webhook-signature": `v1,${Buffer.alloc(32).toString("base64")}`,
      }),
      secret: SECRET,
    },
    {
      rawBody: RAW_BODY,
      headers: signedHeaders(),
      secret: "whsec_invalid-format",
    },
    {
      rawBody: RAW_BODY,
      headers: new Headers(),
      secret: SECRET,
    },
  ] as const;

  for (const candidate of invalidCases) {
    assert.equal(await verifyStandardWebhookSignature({
      ...candidate,
      nowSeconds: TIMESTAMP,
    }), false);
  }
});

test("timestamp vencido, futuro o no entero se rechaza", async () => {
  for (const { timestamp, nowSeconds } of [
    { timestamp: TIMESTAMP, nowSeconds: TIMESTAMP + 301 },
    { timestamp: TIMESTAMP, nowSeconds: TIMESTAMP - 301 },
  ]) {
    assert.equal(await verifyStandardWebhookSignature({
      rawBody: RAW_BODY,
      headers: signedHeaders(RAW_BODY, timestamp),
      secret: SECRET,
      nowSeconds,
      toleranceSeconds: 300,
    }), false);
  }

  const decimalTimestamp = `${TIMESTAMP}.5`;
  const headers = new Headers({
    "webhook-id": WEBHOOK_ID,
    "webhook-timestamp": decimalTimestamp,
    "webhook-signature": `v1,${createHmac("sha256", SECRET_BYTES)
      .update(`${WEBHOOK_ID}.${decimalTimestamp}.${RAW_BODY}`, "utf8")
      .digest("base64")}`,
  });
  assert.equal(await verifyStandardWebhookSignature({
    rawBody: RAW_BODY,
    headers,
    secret: SECRET,
    nowSeconds: TIMESTAMP,
  }), false);
});
