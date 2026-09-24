import { createClient } from "@supabase/supabase-js";

export async function authenticatedProgressClient(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization ?? "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!match || !url || !anonKey) return null;
  const token = match[1];
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { client, userId: data.user.id };
}

export const PRIVATE_PHOTO_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export function privateError(status: number): Response {
  return new Response(null, { status, headers: PRIVATE_PHOTO_HEADERS });
}

export async function boundedPhotoForm(request: Request): Promise<FormData> {
  const maxMultipartBytes = 21 * 1024 * 1024;
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxMultipartBytes)) {
    throw new Error("photo_too_large");
  }
  const contentType = request.headers.get("content-type");
  if (!contentType?.startsWith("multipart/form-data;") || !request.body) throw new Error("invalid_photo");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxMultipartBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("photo_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks, bytes);
  return new Request("http://local.invalid", {
    method: "POST", headers: { "content-type": contentType }, body,
  }).formData();
}
