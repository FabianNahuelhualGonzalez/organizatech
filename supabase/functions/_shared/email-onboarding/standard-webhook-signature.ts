export interface StandardWebhookVerificationInput {
  rawBody: string | Uint8Array;
  headers: Headers | Readonly<Record<string, string | undefined>>;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;
const SECRET_PREFIX = "v1,whsec_";

function readHeader(
  headers: StandardWebhookVerificationInput["headers"],
  name: string,
) {
  if (headers instanceof Headers) return headers.get(name);
  const expected = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === expected) return headers[key] ?? null;
  }
  return null;
}

function decodeBase64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const decoded = atob(padded);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeWebhookSecret(secret: string) {
  if (!secret.startsWith(SECRET_PREFIX)) return null;
  const encoded = secret.slice(SECRET_PREFIX.length);
  if (!encoded) return null;
  return decodeBase64(encoded);
}

function signatureCandidates(header: string) {
  const candidates: Uint8Array[] = [];
  for (const token of header.trim().split(/\s+/)) {
    const separator = token.indexOf(",");
    if (separator <= 0 || token.slice(0, separator) !== "v1") continue;
    const decoded = decodeBase64(token.slice(separator + 1));
    if (decoded?.length === 32) candidates.push(decoded);
  }
  return candidates;
}

function signedPayload(webhookId: string, timestamp: string, rawBody: string | Uint8Array) {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${webhookId}.${timestamp}.`);
  const body = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  const payload = new Uint8Array(prefix.length + body.length);
  payload.set(prefix, 0);
  payload.set(body, prefix.length);
  return payload;
}

function ownedArrayBuffer(bytes: Uint8Array) {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function verifyStandardWebhookSignature(
  input: StandardWebhookVerificationInput,
) {
  const webhookId = readHeader(input.headers, "webhook-id")?.trim() ?? "";
  const timestampHeader = readHeader(input.headers, "webhook-timestamp")?.trim() ?? "";
  const signatureHeader = readHeader(input.headers, "webhook-signature")?.trim() ?? "";
  if (
    !webhookId
    || !timestampHeader
    || !signatureHeader
    || webhookId.length > 1024
    || timestampHeader.length > 32
    || signatureHeader.length > 8192
    || input.secret.length > 8192
  ) return false;

  const timestamp = Number(timestampHeader);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (
    !Number.isSafeInteger(timestamp)
    || !Number.isFinite(nowSeconds)
    || !Number.isFinite(toleranceSeconds)
    || toleranceSeconds < 0
    || Math.abs(nowSeconds - timestamp) > toleranceSeconds
  ) {
    return false;
  }

  const secret = decodeWebhookSecret(input.secret);
  const signatures = signatureCandidates(signatureHeader);
  if (!secret?.length || signatures.length === 0) return false;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      ownedArrayBuffer(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return false;
  }

  const payload = signedPayload(webhookId, timestampHeader, input.rawBody);
  for (const signature of signatures) {
    try {
      if (await crypto.subtle.verify(
        "HMAC",
        key,
        ownedArrayBuffer(signature),
        ownedArrayBuffer(payload),
      )) return true;
    } catch {
      return false;
    }
  }
  return false;
}
